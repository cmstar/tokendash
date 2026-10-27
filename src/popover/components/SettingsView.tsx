import { useEffect, useState } from 'react';

import type { QuotaProviderStatus, QuotaSnapshot } from '../../server/quota/types.js';
import { EDITABLE_PROVIDERS, validateCredential } from '../api.js';
import { configuredProviders, deleteCredential, openDashboard, openExternal, saveCredential } from '../host.js';
import {
  APPEARANCE_CHOICES,
  REFRESH_CHOICES,
  type Appearance,
  type DesktopSettings,
} from '../types.js';

interface SettingsViewProps {
  settings: DesktopSettings;
  quotas: QuotaSnapshot[];
  version: string;
  onPatch: (patch: Partial<DesktopSettings>) => void;
  onClose: () => void;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <span className="toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span />
    </span>
  );
}

function validationMessage(status: QuotaProviderStatus): string {
  if (status.message && status.message.length > 0) return status.message;
  switch (status.state) {
    case 'auth_failed':
      return 'The token was rejected. Check it and try again.';
    case 'rate_limited':
      return 'The provider is rate-limiting validation. Try again shortly.';
    case 'timed_out':
      return 'Validation timed out. Check your connection and try again.';
    case 'upstream_unavailable':
      return 'The provider is currently unavailable.';
    case 'malformed_response':
      return 'The provider returned an unexpected response.';
    default:
      return 'Unable to validate this token.';
  }
}

function CredentialSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [stored, setStored] = useState<string[]>([]);
  const [states, setStates] = useState<Record<string, 'validating' | 'valid' | { invalid: string }>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void configuredProviders()
      .then((providers) => {
        if (active) setStored(providers);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    if (saving) return;
    const proposed = EDITABLE_PROVIDERS.map((provider) => ({
      id: provider.id,
      token: (keys[provider.id] ?? '').trim(),
    })).filter((entry) => entry.token.length > 0);

    setSaving(true);
    setFeedback(null);
    setStates({});

    let allValid = true;
    const next: Record<string, 'validating' | 'valid' | { invalid: string }> = {};
    for (const entry of proposed) {
      next[entry.id] = 'validating';
      setStates({ ...next });
      try {
        const result = await validateCredential(entry.id, entry.token);
        if (result.valid) {
          next[entry.id] = 'valid';
        } else {
          next[entry.id] = { invalid: validationMessage(result.status) };
          allValid = false;
        }
      } catch (error) {
        next[entry.id] = { invalid: error instanceof Error ? error.message : String(error) };
        allValid = false;
      }
      setStates({ ...next });
    }

    if (!allValid) {
      setSaving(false);
      return;
    }
    if (proposed.length === 0) {
      onClose();
      return;
    }

    try {
      for (const entry of proposed) await saveCredential(entry.id, entry.token);
      setFeedback('Credentials verified and saved.');
      setStored((previous) => [...new Set([...previous, ...proposed.map((entry) => entry.id)])]);
      onSaved();
      window.setTimeout(onClose, 700);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function remove(provider: string) {
    try {
      await deleteCredential(provider);
      setStored((previous) => previous.filter((id) => id !== provider));
      setKeys((previous) => {
        const next = { ...previous };
        delete next[provider];
        return next;
      });
      setFeedback('Removed.');
      onSaved();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="sheet">
      <div style={{ padding: '18px 18px 4px', fontSize: 14, fontWeight: 700 }}>Coding Plan Credentials</div>
      <div style={{ padding: '0 18px 12px', fontSize: 10, color: 'var(--secondary)' }}>
        Keys are stored locally in ~/.tokendash/credentials.json and read by the local server only. They never leave
        your machine.
      </div>

      <div className="sheet-body">
        {EDITABLE_PROVIDERS.map((provider) => {
          const state = states[provider.id];
          return (
            <div key={provider.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div className="provider-row">
                <span style={{ fontSize: 12, fontWeight: 600 }}>{provider.name}</span>
                {state === 'valid' ? <span className="badge">verified</span> : null}
                {state === 'validating' ? <span className="spinner" /> : null}
                <span style={{ flex: 1 }} />
                {stored.includes(provider.id) ? (
                  <button type="button" className="text-btn" style={{ color: 'var(--danger)' }} onClick={() => remove(provider.id)} disabled={saving}>
                    Remove
                  </button>
                ) : null}
              </div>
              {state && typeof state === 'object' ? (
                <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--danger)' }}>{state.invalid}</span>
              ) : null}
              <input
                type="password"
                placeholder={provider.hint}
                value={keys[provider.id] ?? ''}
                disabled={saving}
                onChange={(event) => {
                  setKeys((previous) => ({ ...previous, [provider.id]: event.target.value }));
                  setStates((previous) => {
                    const next = { ...previous };
                    delete next[provider.id];
                    return next;
                  });
                }}
              />
            </div>
          );
        })}

        {feedback ? <div className="status-line ok">{feedback}</div> : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="text-btn" style={{ color: 'var(--secondary)' }} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="text-btn" onClick={() => void save()} disabled={saving}>
            {saving ? 'Validating…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SettingsView({ settings, quotas, version, onPatch, onClose }: SettingsViewProps) {
  const [showCredentials, setShowCredentials] = useState(false);
  const connected = quotas.filter((quota) => quota.status.state === 'ok').length;

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <div className="settings-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" className="text-btn" style={{ fontSize: 13, color: 'var(--secondary)' }} onClick={onClose}>
            ‹
          </button>
          <h2>Settings</h2>
        </div>
      </div>

      <div className="settings-body">
        <div className="card">
          <div className="card-title">General</div>
          <div className="row">
            <span className="row-label">Launch at Login</span>
            <Toggle
              checked={settings.launchAtLogin}
              onChange={(value) => onPatch({ launchAtLogin: value })}
            />
          </div>
          <div className="row">
            <span className="row-label">Background Refresh</span>
            <select
              value={settings.backgroundRefreshSecs}
              onChange={(event) => onPatch({ backgroundRefreshSecs: Number(event.target.value) })}
            >
              {REFRESH_CHOICES.map((choice) => (
                <option key={choice.secs} value={choice.secs}>
                  {choice.label}
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            <span className="row-label">Appearance</span>
            <select
              value={settings.appearance}
              onChange={(event) => onPatch({ appearance: event.target.value as Appearance })}
            >
              {APPEARANCE_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Data Sources</div>
          <div className="row">
            <span className="row-label">
              Codex Data Paths
              <span className="row-hint">Configure in the web dashboard</span>
            </span>
            <button type="button" className="text-btn" onClick={() => void openDashboard()}>
              Configure
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Coding Plans</div>
          <div className="row">
            <span className="row-label">
              {connected > 0 ? `API Credentials · ${connected} Connected` : 'API Credentials'}
            </span>
            <button type="button" className="text-btn" onClick={() => setShowCredentials(true)}>
              Manage
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Notifications</div>
          <div className="row">
            <span className="row-label">Low Quota Alerts</span>
            <Toggle
              checked={settings.lowQuotaNotifications}
              onChange={(value) => onPatch({ lowQuotaNotifications: value })}
            />
          </div>
          <div className="row">
            <span className="row-label">Alert Threshold</span>
            <input
              type="number"
              min={50}
              max={95}
              step={5}
              value={settings.lowQuotaThresholdPercent}
              onChange={(event) => onPatch({ lowQuotaThresholdPercent: Number(event.target.value) })}
            />
          </div>
        </div>

        <div className="card">
          <div className="card-title">About</div>
          <div className="row">
            <span className="row-label">Version {version}</span>
          </div>
          <div className="row">
            <button
              type="button"
              className="text-btn"
              onClick={() => void openExternal('https://github.com/zhangferry/tokendash')}
            >
              GitHub Repository ↗
            </button>
          </div>
        </div>
      </div>

      {showCredentials ? (
        <CredentialSheet onClose={() => setShowCredentials(false)} onSaved={() => undefined} />
      ) : null}
    </div>
  );
}