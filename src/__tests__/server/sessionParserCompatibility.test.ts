import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({ homedir: vi.fn() }));
vi.mock('node:os', async importOriginal => ({
  ...await importOriginal<typeof import('node:os')>(),
  homedir: mocks.homedir,
}));

let home: string;
let transcripts: typeof import('../../server/sessionTranscripts.js');
let analytics: typeof import('../../server/sessionAnalyticsParser.js');

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'tokendash-session-compatibility-'));
  mocks.homedir.mockReturnValue(home);
  const directory = join(home, '.local', 'share', 'opencode');
  mkdirSync(directory, { recursive: true });
  const data = JSON.stringify({
    role: 'assistant', modelID: 'gpt-5.4', path: { cwd: '/work/project' },
    time: { created: Date.now() }, tokens: { input: 100, output: 10 },
    content: [{ type: 'text', text: 'Completed' }],
  });
  execFileSync('sqlite3', [join(directory, 'opencode.db'),
    `CREATE TABLE message (id TEXT, session_id TEXT, data TEXT);
     INSERT INTO message VALUES ('msg1', 'ses_real', '${data.replace(/'/g, "''")}');`]);
  transcripts = await import('../../server/sessionTranscripts.js');
  analytics = await import('../../server/sessionAnalyticsParser.js');
});

afterAll(() => rmSync(home, { recursive: true, force: true }));

describe('legacy OpenCode session usage', () => {
  it.each(['all', 'today'] as const)('keeps usage on the real session for range %s', range => {
    const result = analytics.getSessionAnalytics('opencode', { range });
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({ id: 'ses_real', totalTokens: 110, llmCallCount: 1 });
    expect(result.sessions[0].totalCost).toBeCloseTo(0.0004, 10);
    expect(result.summary.totalTokens).toBe(110);
    expect(result.summary.totalCost).toBeCloseTo(0.0004, 10);
  });
});

describe('Pi transcript recovery', () => {
  const message = (id: string, timestamp: string) => JSON.stringify({
    type: 'message', id, timestamp, message: { role: 'assistant', content: 'Valid response' },
  });

  it('retains valid messages around malformed JSON and a partially appended last row', () => {
    const file = join(home, 'partial.jsonl');
    writeFileSync(file, [message('first', '2026-10-19T00:00:00Z'), 'not-json',
      message('second', '2026-10-19T00:00:01Z'), '{"type":'].join('\n'));
    expect(transcripts.readPiTranscript(file).map(row => row.id)).toEqual(['first', 'second']);
  });

  it('skips invalid message and runtime timestamps without losing valid rows', () => {
    const file = join(home, 'invalid-timestamps.jsonl');
    writeFileSync(file, [message('first', '2026-10-19T00:00:00Z'), message('bad', 'invalid'),
      JSON.stringify({ type: 'compaction', id: 'runtime-bad', timestamp: 'invalid', summary: 'Summary' }),
      'null', message('second', '2026-10-19T00:00:01Z')].join('\n'));
    expect(transcripts.readPiTranscript(file).map(row => row.id)).toEqual(['first', 'second']);
  });
});
