import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prepareAll: vi.fn(),
  prepareGet: vi.fn(),
  close: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock('../../server/sqliteReader.js', () => ({
  openSqliteReader: () => ({
    all: (sql: string) => sql.includes('sqlite_master') ? [mocks.prepareGet()] : mocks.prepareAll(),
    close: mocks.close,
  }),
}));
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
  statSync: mocks.statSync,
}));

const parser = await import('../../server/opencodeParser.js');

// 新版 session_message 结构：model 为对象，tokens 含 reasoning，项目目录来自 join。
const message = JSON.stringify({
  time: { created: Date.UTC(2026, 7, 14, 8) },
  model: { id: 'gpt-test', providerID: 'opencode' },
  tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 3, write: 2 } },
  cost: 0.01,
});

describe('OpenCode source cache', () => {
  beforeEach(() => {
    mocks.prepareAll.mockReset().mockReturnValue([{ data: message, directory: '/tmp/project-a' }]);
    mocks.prepareGet.mockReset().mockReturnValue({ name: 'session_message' });
    mocks.close.mockReset();
    mocks.statSync.mockReset().mockReturnValue({ mtimeMs: 100, size: 200 });
    parser.clearOpenCodeEventCache();
  });

  it('shares one SQLite scan across daily, projects, and blocks aggregation', () => {
    parser.getDailyResponse();
    parser.getProjectsResponse();
    parser.getBlocksResponse();

    expect(mocks.prepareAll).toHaveBeenCalledTimes(1);
  });

  it('re-scans when the database fingerprint changes', () => {
    parser.getDailyResponse();
    mocks.statSync.mockReturnValue({ mtimeMs: 101, size: 220 });
    parser.getDailyResponse();

    expect(mocks.prepareAll).toHaveBeenCalledTimes(2);
  });

  it('filters projects from the shared event set without another SQLite scan', () => {
    expect(parser.parseAllOpenCodeEvents('/tmp/project-a')).toHaveLength(1);
    expect(parser.parseAllOpenCodeEvents('/tmp/project-b')).toHaveLength(0);

    expect(mocks.prepareAll).toHaveBeenCalledTimes(1);
  });

  it('counts reasoning tokens in output and total', () => {
    const events = parser.parseAllOpenCodeEvents();
    expect(events).toHaveLength(1);
    expect(events[0].outputTokens).toBe(7); // 5 output + 2 reasoning
    expect(events[0].totalTokens).toBe(22); // 10 + 7 + 3 cacheRead + 2 cacheWrite
    expect(events[0].model).toBe('gpt-test');
    expect(events[0].project).toBe('/tmp/project-a');
  });
});