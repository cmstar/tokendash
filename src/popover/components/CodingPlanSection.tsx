import type { QuotaProviderStatus, QuotaSnapshot, QuotaWindow } from '../../server/quota/types.js';
import { formatResetCountdown } from '../format.js';
import { WarningIcon } from './icons.js';

interface CodingPlanSectionProps {
  quotas: QuotaSnapshot[];
}

/** Short window tag mirroring the macOS helper: 5h / Wk / MCP / Opus / Now. */
function shortWindowTag(window: QuotaWindow): string {
  const lower = `${window.label} ${window.id}`.toLowerCase();
  if (lower.includes('5-hour') || lower.includes('5h')) return '5h';
  if (lower.includes('weekly') || lower.includes('7d') || lower.includes('7-day')) return 'Wk';
  if (lower.includes('mcp')) return 'MCP';
  if (lower.includes('opus')) return 'Opus';
  if (lower.includes('primary')) return 'Now';
  return window.label.split(' ')[0] ?? window.label;
}

/** MCP / tool-call limits are not a general coding capability. */
function isMcpWindow(window: QuotaWindow): boolean {
  const lower = `${window.id} ${window.label}`.toLowerCase();
  return lower.includes('mcp') || lower.includes('time_limit') || lower.includes('monthly-tool');
}

function usageColor(usedPercent: number): string {
  if (usedPercent >= 80) return 'var(--danger)';
  if (usedPercent >= 50) return 'var(--cached-color)';
  return 'var(--accent)';
}

function statusMessage(status: QuotaProviderStatus): string {
  switch (status.state) {
    case 'auth_failed':
      return 'Authentication failed — check credentials';
    case 'upstream_unavailable':
      return 'Provider unavailable right now';
    case 'rate_limited':
      return 'Provider throttled the request';
    case 'timed_out':
      return 'Provider timed out';
    case 'malformed_response':
      return 'Unexpected provider response';
    default:
      return status.message ?? 'Unavailable';
  }
}

function WindowChip({ window }: { window: QuotaWindow }) {
  const unlimited = window.isUnlimited === true;
  const reset = window.resetsAt ? formatResetCountdown(window.resetsAt) : null;
  const color = usageColor(window.usedPercent);

  return (
    <div className="quota-chip">
      <div className="chip-head">
        <span className="chip-tag">{shortWindowTag(window)}</span>
        <span className="chip-pct mono-num" style={{ color: unlimited ? 'var(--accent)' : color }}>
          {unlimited ? '∞' : `${Math.round(window.usedPercent)}%`}
        </span>
      </div>
      <div className="chip-track">
        {unlimited ? null : (
          <div className="chip-fill" style={{ background: color, width: `${Math.max(1.5, window.usedPercent)}%` }} />
        )}
      </div>
      <div className="chip-reset">{reset ?? ' '}</div>
    </div>
  );
}

export function CodingPlanSection({ quotas }: CodingPlanSectionProps) {
  return (
    <div className="section" style={{ paddingBottom: 10 }}>
      <div className="section-head">
        <span className="section-title">Coding Plan</span>
      </div>

      {quotas.length === 0 ? (
        <div className="empty">No coding plan configured.</div>
      ) : (
        <div className="quota-list">
          {quotas.map((quota) => {
            const windows = quota.windows.filter((window) => !isMcpWindow(window));
            return (
              <div className="quota-card" key={quota.provider}>
                <div className="quota-title">
                  <span className="quota-name">{quota.displayName}</span>
                  {quota.planName ? <span className="quota-plan">{quota.planName}</span> : null}
                  {quota.freshness === 'stale' ? <span className="quota-stale">stale</span> : null}
                </div>

                {quota.status.state === 'ok' && windows.length > 0 ? (
                  <div className="quota-chips">
                    {windows.map((window) => (
                      <WindowChip key={window.id} window={window} />
                    ))}
                  </div>
                ) : quota.status.state !== 'ok' ? (
                  <div className="quota-status">
                    <span className="warn">
                      <WarningIcon size={9} />
                    </span>
                    <span>{statusMessage(quota.status)}</span>
                  </div>
                ) : (
                  <div className="quota-status">No active limits reported.</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}