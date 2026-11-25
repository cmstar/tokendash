import { constants as bufferConstants } from 'node:buffer';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import * as zlib from 'node:zlib';
import { Decompress } from 'fzstd';
import { ZstdDecompress } from 'minizlib';

export interface CodexRecord {
  type: string;
  timestamp?: string;
  ordinal?: number;
  payload: Record<string, unknown>;
}

const CHUNK_SIZE = 128 * 1024;

function* fileChunks(fd: number, size: number): Generator<Buffer> {
  for (let position = 0; position < size;) {
    const chunk = Buffer.allocUnsafe(Math.min(CHUNK_SIZE, size - position));
    const count = readSync(fd, chunk, 0, chunk.length, position);
    if (!count) throw new Error('Codex rollout was truncated while reading');
    position += count;
    yield chunk.subarray(0, count);
  }
}

// RFC 8878 frame boundaries are needed even with native Zstd: some Node
// releases stop after the first frame or accept truncated input at EOF.
function* zstdChunks(chunks: Iterator<Buffer>, size: number, useNative: boolean): Generator<Uint8Array> {
  let buffer: Buffer = Buffer.alloc(0);
  let remaining = size;
  function take(length: number): Buffer {
    if (length > remaining) throw new Error('Truncated Zstandard rollout');
    remaining -= length;
    const parts: Buffer[] = [];
    while (length > buffer.length) {
      parts.push(buffer);
      length -= buffer.length;
      const next = chunks.next();
      if (next.done) throw new Error('Truncated Zstandard rollout');
      buffer = next.value;
    }
    const tail = buffer.subarray(0, length);
    buffer = buffer.subarray(length);
    return parts.length ? Buffer.concat([...parts, tail]) : tail;
  }

  if (!remaining) throw new Error('Empty Zstandard rollout');
  const output: Uint8Array[] = [];
  const onData = (chunk: Uint8Array) => { if (chunk.length) output.push(chunk); };
  const native = useNative && typeof zlib.createZstdDecompress === 'function'
    ? new ZstdDecompress({}).on('data', onData) : undefined;
  let decodedFrame = false;
  try {
    while (remaining) {
      const magic = take(4);
      const tag = magic.readUInt32LE();
      if ((tag >>> 4) === 0x184d2a5) {
        let skip = take(4).readUInt32LE();
        while (skip > 0) {
          const count = Math.min(skip, CHUNK_SIZE);
          take(count);
          skip -= count;
        }
        continue;
      }
      if (tag !== 0xfd2fb528) throw new Error('Invalid Zstandard rollout frame');
      const flags = take(1);
      const descriptor = flags[0];
      const single = (descriptor & 0x20) !== 0;
      const sizeFlag = descriptor >> 6;
      const headerSize = (single ? 0 : 1) + [0, 1, 2, 4][descriptor & 3]
        + (sizeFlag ? 1 << sizeFlag : single ? 1 : 0);
      const header = Buffer.concat([magic, flags, take(headerSize)]);
      // Reuse a single native context: a synchronous scan of thousands of small
      // frames can otherwise allocate native handles faster than Node frees them.
      if (decodedFrame) native?.reset();
      const fallback = native ? undefined : new Decompress(onData);
      let first = true;
      let last = false;
      while (!last) {
        const block = take(3);
        const bits = block.readUIntLE(0, 3);
        const type = (bits >> 1) & 3;
        if (type === 3 || (bits >>> 3) > CHUNK_SIZE) throw new Error('Invalid Zstandard rollout block');
        last = (bits & 1) !== 0;
        const parts = first ? [header, block] : [block];
        parts.push(take(type === 1 ? 1 : bits >>> 3));
        if (last && (descriptor & 4)) parts.push(take(4));
        const input = Buffer.concat(parts);
        if (native) native.write(input);
        else fallback!.push(input, last);
        yield* output;
        output.length = 0;
        first = false;
      }
      decodedFrame = true;
    }
    if (native && decodedFrame) {
      native.end();
      yield* output;
    }
  } finally {
    native?.close();
  }
}

export function parseCodexRecord(line: string): CodexRecord | undefined {
  try {
    const row = JSON.parse(line);
    if (row && typeof row.type === 'string' && row.payload && typeof row.payload === 'object') return row;
  } catch { /* Ignore malformed JSON or an unfinished final line in an active file. */ }
}

// A fork can replay its parent's metadata after its own.
export function firstCodexMetadata(records: Iterable<CodexRecord>): Record<string, unknown> {
  for (const row of records) {
    if (row.type === 'session_meta') return row.payload;
  }
  return {};
}

function* rolloutRecords(chunks: Iterable<Uint8Array>, path: string): Generator<CodexRecord> {
  const decoder = new StringDecoder('utf8');
  const fragments: string[] = [];
  let length = 0;
  function* lines(text: string, final: boolean) {
    let start = 0;
    while (start < text.length || final) {
      const newline = text.indexOf('\n', start);
      const end = newline === -1 ? text.length : newline;
      length += end - start;
      if (length <= bufferConstants.MAX_STRING_LENGTH) {
        if (end > start) fragments.push(text.slice(start, end));
      } else {
        fragments.length = 0;
      }
      if (newline === -1 && !final) break;
      if (length > bufferConstants.MAX_STRING_LENGTH) {
        console.warn(`[codexParser] Skipping oversized JSONL record in ${path}`);
      } else if (length) {
        const row = parseCodexRecord(fragments.length === 1 ? fragments[0] : fragments.join(''));
        if (row) yield row;
      }
      length = 0;
      fragments.length = 0;
      if (newline === -1) break;
      start = newline + 1;
    }
  }
  for (const chunk of chunks) yield* lines(decoder.write(chunk), false);
  yield* lines(decoder.end(), true);
}

// Multiple iterations see the same file descriptor and ignore later appends.
// A metadata lookahead can stop early without leaving a native decoder open.
export function readCodexRollout<T>(path: string, consume: (records: Iterable<CodexRecord>) => T, useNative = true): T {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    path = path.endsWith('.jsonl.zst') ? path.slice(0, -4) : `${path}.zst`;
    fd = openSync(path, 'r');
  }
  try {
    const size = fstatSync(fd).size;
    return consume({
      *[Symbol.iterator]() {
        const chunks = fileChunks(fd, size);
        yield* rolloutRecords(path.endsWith('.zst') ? zstdChunks(chunks, size, useNative) : chunks, path);
      },
    });
  } finally {
    closeSync(fd);
  }
}

export function isInheritedCodexRecord(record: CodexRecord, meta: Record<string, unknown>): boolean {
  const start = meta.subagent_history_start_ordinal;
  return typeof start === 'number' && typeof record.ordinal === 'number' && record.ordinal < start;
}
