import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadBuiltin: vi.fn(), execFileSync: vi.fn(), prepare: vi.fn(), all: vi.fn(), close: vi.fn(),
}));
vi.mock('node:module', () => ({ createRequire: () => mocks.loadBuiltin }));
vi.mock('node:child_process', () => ({ execFileSync: mocks.execFileSync }));

import { openSqliteReader } from '../../server/sqliteReader.js';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('SQLite runtime compatibility', () => {
  it('prefers the native read-only database when the builtin is available', () => {
    const database = vi.fn(function () {
      return { prepare: mocks.prepare, close: mocks.close };
    });
    mocks.loadBuiltin.mockReturnValue({ DatabaseSync: database });
    mocks.prepare.mockReturnValue({ all: mocks.all });
    mocks.all.mockReturnValue([{ name: 'message' }]);
    const reader = openSqliteReader('/tmp/opencode.db');
    expect(reader.all('SELECT name FROM sqlite_master')).toEqual([{ name: 'message' }]);
    reader.close();
    expect(database).toHaveBeenCalledWith('/tmp/opencode.db', { readOnly: true });
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.execFileSync).not.toHaveBeenCalled();
  });

  it('uses argument-based sqlite3 execution when Node has no builtin', () => {
    mocks.loadBuiltin.mockImplementation(() => { throw Object.assign(new Error('unsupported'), { code: 'ERR_UNKNOWN_BUILTIN_MODULE' }); });
    mocks.execFileSync.mockReturnValue('[{"id":"ses_real"}]\n');
    const path = '/tmp/space and $(touch unwanted)/opencode.db';
    const reader = openSqliteReader(path);
    expect(reader.all('SELECT id FROM message')).toEqual([{ id: 'ses_real' }]);
    expect(mocks.execFileSync).toHaveBeenCalledWith('sqlite3', ['-readonly', '-json', path, 'SELECT id FROM message'], {
      encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 10_000,
    });
    reader.close();
  });

  it('treats empty sqlite3 output as no rows', () => {
    mocks.loadBuiltin.mockImplementation(() => { throw Object.assign(new Error('unsupported'), { code: 'MODULE_NOT_FOUND' }); });
    mocks.execFileSync.mockReturnValue('');
    expect(openSqliteReader('/tmp/opencode.db').all('SELECT * FROM message')).toEqual([]);
  });

  it('preserves native open failures instead of masking them with the CLI', () => {
    mocks.loadBuiltin.mockReturnValue({ DatabaseSync: function () { throw new Error('database is locked'); } });
    expect(() => openSqliteReader('/tmp/opencode.db')).toThrow('database is locked');
    expect(mocks.execFileSync).not.toHaveBeenCalled();
  });
});
