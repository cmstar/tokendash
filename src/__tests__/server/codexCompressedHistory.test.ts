import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as rollout from '../../server/codexRollout.js';
import { buildCodexResponsesFromSessions, deduplicateParsedSessions, parseAllSessions, parseCodexSession, scanCodexSessions } from '../../server/codexParser.js';
import { getSessionAnalytics, getSessionDetail, invalidateSessionAnalyticsSource } from '../../server/sessionAnalyticsParser.js';
import { clearUsageFileIndexMemory } from '../../server/usageFileIndex.js';

let root: string;
const stamp = '2026-10-01T10:00:00Z';
const usage = (n: number) => ({ input_tokens: n - 10, cached_input_tokens: 20, output_tokens: 10, reasoning_output_tokens: 5, total_tokens: n });
const meta = (id = 'thread', extra = {}) => ({ type: 'session_meta', ordinal: 0, payload: { id, cwd: '/project', timestamp: stamp, ...extra } });
const context = (turn_id: string, model = 'gpt-6.1-sol') => ({ type: 'turn_context', payload: { turn_id, model } });
const response = (response_id: string, n: number, total = n, extra = {}) => ({ type: 'token_usage_record', timestamp: stamp, payload: { thread_id: 'thread', turn_id: 'new-turn', response_id, usage: usage(n), thread_token_usage: usage(total), ...extra } });
const legacy = (n: number, last = n) => ({ type: 'event_msg', timestamp: stamp, payload: { type: 'token_count', info: { total_token_usage: usage(n), last_token_usage: usage(last) } } });
const user = (message: string, ordinal = 2) => ({ type: 'event_msg', ordinal, timestamp: stamp, payload: { type: 'user_message', message } });
const text = (rows: unknown[]) => rows.map(row => JSON.stringify(row)).join('\n') + '\n';

// A standards-compliant single-segment Zstd frame with a raw block, so fixtures
// can be generated even on Node 20, which has neither compression nor decompression.
function zstdFrame(value: string): Buffer {
  const body = Buffer.from(value);
  const header = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0xa0, 0, 0, 0, 0]);
  header.writeUInt32LE(body.length, 5);
  const block = Buffer.alloc(3);
  block.writeUIntLE((body.length << 3) | 1, 0, 3);
  return Buffer.concat([header, block, body]);
}

function write(name: string, rows: unknown[], archived = false): string {
  const path = join(root, archived ? 'archived_sessions' : 'sessions', name);
  writeFileSync(path, name.endsWith('.zst') ? zstdFrame(text(rows)) : text(rows));
  return path;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'codex compressed '));
  mkdirSync(join(root, 'sessions'));
  mkdirSync(join(root, 'archived_sessions'));
  vi.stubEnv('CODEX_HOME', root);
  vi.stubEnv('TOKENDASH_CODEX_HOME', '');
  vi.stubEnv('TOKENDASH_CODEX_HOMES', '');
  vi.stubEnv('TOKENDASH_SETTINGS_FILE', join(root, 'settings.json'));
  vi.stubEnv('TOKENDASH_USAGE_INDEX_DIR', join(root, 'index'));
  clearUsageFileIndexMemory();
  invalidateSessionAnalyticsSource();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  clearUsageFileIndexMemory();
  invalidateSessionAnalyticsSource();
  rmSync(root, { recursive: true, force: true });
});

describe('compressed Codex rollouts', () => {
  it.each([true, false])('decodes actual compressed Unicode data with native preference=%s', useNative => {
    const bytes = Buffer.from('KLUv/WAUBKUAAGhDb2RleCDljoblj7IKAQAEwT+/', 'base64');
    expect(Buffer.from(rollout.decompressCodexRollout(bytes, useNative)).toString()).toBe('Codex 历史\n'.repeat(100));
  });

  it.each([true, false])('rejects a truncated compressed frame with native preference=%s', useNative => {
    const bytes = Buffer.from('KLUv/WAUBKUAAGhDb2RleCDljoblj7IKAQAEwT+/', 'base64');
    expect(() => rollout.decompressCodexRollout(bytes.subarray(0, 15), useNative)).toThrow();
  });

  it.each([true, false])('reads concatenated frames and skips metadata frames with native preference=%s', useNative => {
    const skipped = Buffer.from([0x50, 0x2a, 0x4d, 0x18, 2, 0, 0, 0, 42, 42]);
    const bytes = Buffer.concat([zstdFrame('first\n'), skipped, zstdFrame('second\n')]);
    expect(Buffer.from(rollout.decompressCodexRollout(bytes, useNative)).toString()).toBe('first\nsecond\n');
  });

  it('includes compressed live and archived files and prefers a live plain sibling', () => {
    write('same.jsonl.zst', [meta(), legacy(100)]);
    const plain = write('same.jsonl', [meta(), legacy(200)]);
    const archive = write('archived.jsonl.zst', [meta('archived'), legacy(300)], true);
    expect(scanCodexSessions()).toEqual([archive, plain].sort());
    expect(buildCodexResponsesFromSessions(parseAllSessions()).daily.totals.totalTokens).toBe(500);
  });

  it('preserves totals across compression and retries a sibling if the scanned path moved', () => {
    const rows = [meta(), context('old-turn'), legacy(150)];
    const plain = write('moving.jsonl', rows);
    expect(parseAllSessions()[0].tokenEvents[0].totalTokens).toBe(150);
    write('moving.jsonl.zst', rows);
    rmSync(plain);
    expect(parseCodexSession(plain)?.tokenEvents[0].totalTokens).toBe(150);
    expect(buildCodexResponsesFromSessions(parseAllSessions()).daily.totals.totalTokens).toBe(150);
  });

  it('reports a corrupt file without discarding healthy history', () => {
    write('good.jsonl.zst', [meta(), legacy(100)]);
    writeFileSync(join(root, 'sessions', 'bad.jsonl.zst'), 'not a Zstandard frame');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseAllSessions()).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Cannot read rollout'));
  });
});

describe('Codex response usage and lineage', () => {
  it('counts per-response usage once even when status totals disagree and are replayed', () => {
    const file = write('new.jsonl.zst', [
      meta(), context('new-turn'), legacy(90), response('r1', 100), legacy(100),
      response('r1', 100), response('r2', 125, 225), legacy(500, 125),
    ]);
    const session = parseCodexSession(file)!;
    expect(session.tokenEvents.map(event => event.totalTokens)).toEqual([100, 125]);
    expect(session.tokenEvents.map(event => event.responseId)).toEqual(['r1', 'r2']);
  });

  it('keeps old turns when a rollout switches to response records and world-state models', () => {
    const file = write('mixed.jsonl', [
      meta(), context('old-turn', 'gpt-5.5'), legacy(150), context('new-turn'),
      { type: 'world_state', payload: { state: { model: { model: 'gpt-6-astra', instructions: 'hash' } } } },
      response('r1', 100, 250), legacy(250, 100),
      { type: 'world_state', payload: { state: { model: 'gpt-6.1-sol' } } },
      response('r2', 110, 360),
    ]);
    const events = parseCodexSession(file)!.tokenEvents;
    expect(events.map(event => [event.totalTokens, event.model])).toEqual([[150, 'gpt-5.5'], [100, 'gpt-6-astra'], [110, 'gpt-6.1-sol']]);
  });

  it('supports response-only files without cumulative counters', () => {
    const file = write('responses.jsonl.zst', [meta(), context('new-turn'), response('r1', 100, 100, { thread_token_usage: undefined }), response('r2', 100, 100, { thread_token_usage: undefined })]);
    expect(parseCodexSession(file)!.tokenEvents.map(event => event.totalTokens)).toEqual([100, 100]);
  });

  it('does not let invalid response records suppress valid legacy usage', () => {
    const invalid = response('bad', 100);
    invalid.payload.usage.input_tokens = 'invalid' as unknown as number;
    const file = write('invalid.jsonl', [meta(), context('new-turn'), invalid, legacy(150)]);
    expect(parseCodexSession(file)!.tokenEvents[0].totalTokens).toBe(150);
  });

  it('retains the child identity and excludes explicit inherited ordinals and foreign responses', () => {
    const file = write('fork.jsonl.zst', [
      meta('child', { subagent_history_start_ordinal: 10, forked_from_id: 'parent' }),
      { ...meta('parent'), ordinal: 1 }, user('Inherited question', 2),
      { ...response('parent-r', 500, 500, { thread_id: 'parent' }), ordinal: 3 },
      { ...legacy(500), ordinal: 4 }, context('child-turn'), user('Child question', 10),
      { ...response('child-r', 100, 100, { thread_id: 'child', turn_id: 'child-turn' }), ordinal: 11 },
      { ...legacy(600, 100), ordinal: 12 },
    ]);
    const parsed = parseCodexSession(file)!;
    expect(parsed.id).toBe('child');
    expect(parsed.tokenEvents.map(event => event.totalTokens)).toEqual([100]);
    const analytics = getSessionAnalytics('codex');
    expect(analytics.sessions[0]).toMatchObject({ id: 'child', userTurnCount: 1, totalTokens: 100, title: 'Child question' });
  });

  it('counts only a shared-history fork own responses, without adding the parent baseline', () => {
    const file = write('shared.jsonl.zst', [
      meta('thread', { history_base: { thread_id: 'parent', end_ordinal_exclusive: 100, end_byte_offset: 9000 } }),
      context('new-turn'), response('r', 150, 10150), legacy(10150, 150),
    ]);
    expect(parseCodexSession(file)!.tokenEvents.map(event => event.totalTokens)).toEqual([150]);
  });

  it('prefers response identities across overlapping modern and legacy copies', () => {
    const old = parseCodexSession(write('old.jsonl', [meta(), context('new-turn'), legacy(100)]))!;
    const modern = parseCodexSession(write('new.jsonl.zst', [meta(), context('new-turn'), response('r1', 100)]))!;
    for (const sessions of [[old, modern], [modern, old, modern]]) {
      const merged = deduplicateParsedSessions(sessions);
      expect(merged[0].tokenEvents).toHaveLength(1);
      expect(merged[0].tokenEvents[0].responseId).toBe('r1');
    }
  });
});

describe('persistent Codex metadata and usage caches', () => {
  it('reuses both indexes after restart, reparses only changes, and loads bodies on demand', () => {
    const compressed = write('history.jsonl.zst', [meta(), context('new-turn'), user('A historical request with details'), response('r1', 100)]);
    const active = write('active.jsonl', [meta('active'), context('active-turn'), legacy(200)]);
    const read = vi.spyOn(rollout, 'readCodexRollout');
    expect(getSessionAnalytics('codex').summary.sessionCount).toBe(2);
    expect(read).toHaveBeenCalledWith(compressed);
    const cached = JSON.parse(readFileSync(join(root, 'index', 'codex-transcripts.json'), 'utf8'));
    const cachedEvents = cached.files.flatMap((file: { value: { metadata: { events: object[] } } }) => file.value.metadata.events);
    expect(cachedEvents.some((event: object) => 'content' in event)).toBe(false);

    clearUsageFileIndexMemory();
    invalidateSessionAnalyticsSource();
    read.mockClear();
    expect(getSessionAnalytics('codex').summary.sessionCount).toBe(2);
    expect(read).not.toHaveBeenCalled();
    expect(getSessionDetail('codex', 'thread')?.events.some(event => event.content)).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect(getSessionDetail('codex', 'thread', undefined, true)?.events.find(event => event.type === 'user_message')?.content).toBe('A historical request with details');
    expect(read.mock.calls.map(call => call[0])).toEqual([compressed]);

    read.mockClear();
    appendFileSync(active, text([user('A new request')]));
    expect(getSessionAnalytics('codex').summary.sessionCount).toBe(2);
    expect(read.mock.calls.length).toBeGreaterThan(0);
    expect(read.mock.calls.every(call => call[0] === active)).toBe(true);
  });
});
