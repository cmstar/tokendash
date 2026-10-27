import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SCHEMA_VERSION = 1;
const DEFAULT_INDEX_DIR = join(homedir(), '.tokendash', 'usage-index-v1');

export interface UsageFileRef {
  path: string;
}

interface PersistedFile<T> {
  path: string;
  mtimeMs: number;
  size: number;
  value: T;
}

interface PersistedIndex<T> {
  schemaVersion: number;
  parserVersion: string;
  files: PersistedFile<T>[];
}

export interface UsageFileIndexResult<T> {
  values: T[];
  signature: string;
  parsedFiles: number;
  reusedFiles: number;
  removedFiles: number;
}

interface BuildUsageFileIndexOptions<T, TRef extends UsageFileRef> {
  cacheName: string;
  parserVersion: string;
  files: TRef[];
  parseFile: (file: TRef) => T;
}

const memoryIndexes = new Map<string, PersistedIndex<unknown>>();

function indexDir(): string {
  return process.env.TOKENDASH_USAGE_INDEX_DIR || DEFAULT_INDEX_DIR;
}

function indexPath(cacheName: string): string {
  const safe = cacheName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(indexDir(), `${safe}.json`);
}

function loadIndex<T>(cacheName: string, parserVersion: string): PersistedIndex<T> {
  const cached = memoryIndexes.get(indexPath(cacheName)) as PersistedIndex<T> | undefined;
  if (cached?.schemaVersion === SCHEMA_VERSION && cached.parserVersion === parserVersion) {
    return cached;
  }

  try {
    const parsed = JSON.parse(readFileSync(indexPath(cacheName), 'utf-8')) as PersistedIndex<T>;
    if (parsed.schemaVersion === SCHEMA_VERSION && parsed.parserVersion === parserVersion && Array.isArray(parsed.files)) {
      memoryIndexes.set(indexPath(cacheName), parsed as PersistedIndex<unknown>);
      return parsed;
    }
  } catch {
    // Missing or corrupt indexes are rebuilt from source files.
  }

  return { schemaVersion: SCHEMA_VERSION, parserVersion, files: [] };
}

function saveIndex<T>(cacheName: string, index: PersistedIndex<T>): void {
  try {
    const dir = indexDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = indexPath(cacheName);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(index), 'utf-8');
    renameSync(tmp, path);
    memoryIndexes.set(indexPath(cacheName), index as PersistedIndex<unknown>);
  } catch {
    // The index is an optimization; parsing from source remains correct.
  }
}

export function clearUsageFileIndexMemory(): void {
  memoryIndexes.clear();
}

export function buildUsageFileIndex<T, TRef extends UsageFileRef>(
  options: BuildUsageFileIndexOptions<T, TRef>,
): UsageFileIndexResult<T> {
  const sortedFiles = [...options.files].sort((a, b) => a.path.localeCompare(b.path));
  const previous = loadIndex<T>(options.cacheName, options.parserVersion);
  const previousByPath = new Map(previous.files.map(file => [file.path, file]));

  const nextFiles: PersistedFile<T>[] = [];
  const signatureParts: string[] = [];
  let parsedFiles = 0;
  let reusedFiles = 0;
  let changed = previous.schemaVersion !== SCHEMA_VERSION || previous.parserVersion !== options.parserVersion;

  for (const file of sortedFiles) {
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(file.path);
    } catch {
      continue;
    }

    const previousFile = previousByPath.get(file.path);
    const mtimeMs = st.mtimeMs;
    const size = st.size;
    signatureParts.push(`${file.path}:${mtimeMs}:${size}`);

    if (previousFile && previousFile.mtimeMs === mtimeMs && previousFile.size === size) {
      nextFiles.push(previousFile);
      reusedFiles += 1;
      continue;
    }

    nextFiles.push({
      path: file.path,
      mtimeMs,
      size,
      value: options.parseFile(file),
    });
    parsedFiles += 1;
    changed = true;
  }

  const nextPaths = new Set(nextFiles.map(file => file.path));
  const removedFiles = previous.files.filter(file => !nextPaths.has(file.path)).length;
  if (removedFiles > 0 || previous.files.length !== nextFiles.length) {
    changed = true;
  }

  const nextIndex: PersistedIndex<T> = {
    schemaVersion: SCHEMA_VERSION,
    parserVersion: options.parserVersion,
    files: nextFiles,
  };
  if (changed) {
    saveIndex(options.cacheName, nextIndex);
  } else {
    memoryIndexes.set(indexPath(options.cacheName), nextIndex as PersistedIndex<unknown>);
  }

  return {
    values: nextFiles.map(file => file.value),
    signature: signatureParts.join('|'),
    parsedFiles,
    reusedFiles,
    removedFiles,
  };
}
