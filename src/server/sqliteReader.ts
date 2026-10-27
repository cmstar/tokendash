import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

export interface SqliteReader {
  all(sql: string): Record<string, unknown>[];
  close(): void;
}

interface NativeDatabase {
  prepare(sql: string): { all(): Record<string, unknown>[] };
  close(): void;
}

/** Node 20 uses the sqlite3 CLI; newer Node versions can read SQLite directly. */
export function openSqliteReader(path: string): SqliteReader {
  let DatabaseSync: (new (path: string, options: { readOnly: boolean }) => NativeDatabase) | undefined;
  try {
    ({ DatabaseSync } = createRequire(import.meta.url)('node:sqlite'));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ERR_UNKNOWN_BUILTIN_MODULE' && code !== 'MODULE_NOT_FOUND') throw error;
  }
  if (DatabaseSync) {
    const db = new DatabaseSync(path, { readOnly: true });
    return { all: sql => db.prepare(sql).all(), close: () => db.close() };
  }
  return {
    all: sql => {
      const output = execFileSync('sqlite3', ['-readonly', '-json', path, sql], {
        encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 10_000,
      });
      return output.trim() ? JSON.parse(output) as Record<string, unknown>[] : [];
    },
    close: () => {},
  };
}
