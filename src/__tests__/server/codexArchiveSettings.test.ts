import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readAppSettings, updateCodexCustomDataPaths } from '../../server/appSettings.js';
import { getCodexDailyResponse, getCodexProjectsResponse, getCodexBlocksResponse } from '../../server/codexResponseService.js';
import { scanCodexSessions, isSessionsDirAccessible } from '../../server/codexParser.js';
import { getSessionAnalytics } from '../../server/sessionAnalyticsParser.js';

let root: string;
let live: string;
let archived: string;

function transcript(id: string, tokens: number): string {
  return [
    { type: 'session_meta', payload: { id, cwd: '/repo/demo', timestamp: '2026-07-01T10:00:00Z' } },
    { type: 'turn_context', payload: { model: 'gpt-5.5' } },
    { type: 'event_msg', timestamp: '2026-07-01T10:01:00Z', payload: { type: 'token_count', info: {
      total_token_usage: { input_tokens: tokens, total_tokens: tokens },
    } } },
  ].map(line => JSON.stringify(line)).join('\n');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tokendash-archive-settings-'));
  vi.stubEnv('CODEX_HOME', root);
  vi.stubEnv('TOKENDASH_CODEX_HOME', '');
  vi.stubEnv('TOKENDASH_CODEX_HOMES', '');
  vi.stubEnv('TOKENDASH_SETTINGS_FILE', join(root, 'settings.json'));
  vi.stubEnv('TOKENDASH_USAGE_INDEX_DIR', join(root, 'index'));
  vi.stubEnv('TOKENDASH_DISABLE_CODEX_WORKER', '0');
  live = join(root, 'sessions');
  archived = join(root, 'archived_sessions');
  mkdirSync(live);
  mkdirSync(archived);
  writeFileSync(join(live, 'live.jsonl'), transcript('live', 100));
  writeFileSync(join(archived, 'archived.jsonl'), transcript('archived', 200));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe('archived Codex conversation settings', () => {
  it('defaults to enabled for new and existing settings, and preserves the choice when updating paths', () => {
    expect(readAppSettings().codex.includeArchived).toBe(true);
    writeFileSync(join(root, 'settings.json'), JSON.stringify({ codex: { customDataPaths: [] } }));
    expect(readAppSettings().codex.includeArchived).toBe(true);
    updateCodexCustomDataPaths([], false);
    updateCodexCustomDataPaths([root]);
    expect(readAppSettings().codex.includeArchived).toBe(false);
  });

  it('excludes official and direct custom archive folders while keeping archive-only sources detectable', () => {
    const customArchive = join(root, 'custom', 'archived_sessions');
    mkdirSync(customArchive, { recursive: true });
    writeFileSync(join(customArchive, 'custom.jsonl'), transcript('custom', 300));
    updateCodexCustomDataPaths([customArchive], true);
    expect(scanCodexSessions()).toHaveLength(3);
    updateCodexCustomDataPaths([customArchive], false);
    expect(scanCodexSessions()).toEqual([join(live, 'live.jsonl')]);
    vi.stubEnv('CODEX_HOME', archived);
    expect(scanCodexSessions()).toEqual([]);
    expect(isSessionsDirAccessible()).toBe(true);
  });

  it('updates cached usage and session analytics immediately when disabled and re-enabled', async () => {
    for (const includeArchived of [true, false, true]) {
      updateCodexCustomDataPaths([], includeArchived);
      const expectedTokens = includeArchived ? 300 : 100;
      expect((await getCodexDailyResponse()).totals.totalTokens).toBe(expectedTokens);
      const projects = await getCodexProjectsResponse();
      expect(projects.projects.demo[0].totalTokens).toBe(expectedTokens);
      const blocks = await getCodexBlocksResponse();
      expect(blocks.blocks.reduce((total, block) => total + block.totalTokens, 0)).toBe(expectedTokens);
      expect(getSessionAnalytics('codex').summary.sessionCount).toBe(includeArchived ? 2 : 1);
    }
  });
});
