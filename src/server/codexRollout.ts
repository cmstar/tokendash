import { readFileSync } from 'node:fs';
import * as zlib from 'node:zlib';
import { decompress } from 'fzstd';

export interface CodexRecord {
  type: string;
  timestamp?: string;
  ordinal?: number;
  payload: Record<string, unknown>;
}

// Some Node releases return partial output for truncated Zstd input. Check
// frame/block boundaries before caching any result (including concatenated frames).
// Layout: facebook/zstd doc/zstd_compression_format.md, Frames and Blocks.
function zstdFrames(data: Uint8Array): Array<{ start: number; end: number }> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const frames: Array<{ start: number; end: number }> = [];
  let offset = 0;
  const requireBytes = (count: number) => {
    if (offset + count > data.length) throw new Error('Truncated Zstandard rollout');
  };
  if (!data.length) throw new Error('Empty Zstandard rollout');
  while (offset < data.length) {
    const start = offset;
    requireBytes(4);
    const magic = view.getUint32(offset, true);
    if ((magic & 0xfffffff0) === 0x184d2a50) {
      requireBytes(8);
      const size = view.getUint32(offset + 4, true);
      requireBytes(8 + size);
      offset += 8 + size;
      continue;
    }
    if (magic !== 0xfd2fb528) throw new Error('Invalid Zstandard rollout frame');
    offset += 4;
    requireBytes(1);
    const descriptor = data[offset++];
    const single = (descriptor & 0x20) !== 0;
    const sizeFlag = descriptor >> 6;
    const headerSize = (single ? 0 : 1) + [0, 1, 2, 4][descriptor & 3]
      + (sizeFlag ? 1 << sizeFlag : single ? 1 : 0);
    requireBytes(headerSize);
    offset += headerSize;
    let last = false;
    while (!last) {
      requireBytes(3);
      const header = data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16);
      offset += 3;
      last = (header & 1) !== 0;
      const type = (header >> 1) & 3;
      if (type === 3) throw new Error('Invalid Zstandard rollout block');
      const size = type === 1 ? 1 : header >> 3;
      requireBytes(size);
      offset += size;
    }
    if (descriptor & 4) { requireBytes(4); offset += 4; }
    frames.push({ start, end: offset });
  }
  return frames;
}

/** Node 20 has no native Zstandard decoder; keep the fallback in the npm package. */
export function decompressCodexRollout(data: Uint8Array, useNative = true): Uint8Array {
  const frames = zstdFrames(data);
  const native = (zlib as { zstdDecompressSync?: (data: Uint8Array) => Uint8Array }).zstdDecompressSync;
  if (!useNative || !native) return decompress(data);
  // Node versions can stop after the first frame. Decode each complete frame
  // explicitly so appended history and skippable metadata never hide records.
  const decoded = frames.map(frame => native(data.subarray(frame.start, frame.end)));
  return decoded.length === 1 ? decoded[0] : Buffer.concat(decoded);
}

/** Read without materializing an uncompressed copy beside Codex's own history. */
export function readCodexRollout(path: string): string {
  let actualPath = path;
  let bytes: Buffer;
  try {
    bytes = readFileSync(actualPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // A live Codex process may compress or restore a file after our directory scan.
    actualPath = path.endsWith('.jsonl.zst') ? path.slice(0, -4) : `${path}.zst`;
    bytes = readFileSync(actualPath);
  }
  return actualPath.endsWith('.zst')
    ? Buffer.from(decompressCodexRollout(bytes)).toString('utf8')
    : bytes.toString('utf8');
}

export function parseCodexRollout(raw: string): { meta: Record<string, unknown>; records: CodexRecord[] } {
  const records: CodexRecord[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && typeof row.type === 'string' && row.payload && typeof row.payload === 'object') records.push(row);
    } catch { /* An active rollout can end in an incomplete JSON line. */ }
  }
  // Forks start with their own metadata, then may replay the parent's metadata.
  // The replay must never replace the owning thread's id, cwd or creation date.
  const meta = records.find(row => row.type === 'session_meta')?.payload ?? {};
  return { meta, records };
}

export function isInheritedCodexRecord(record: CodexRecord, meta: Record<string, unknown>): boolean {
  const start = meta.subagent_history_start_ordinal;
  return typeof start === 'number' && typeof record.ordinal === 'number' && record.ordinal < start;
}
