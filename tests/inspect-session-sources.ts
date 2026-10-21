import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { scanPiSessions } from '../src/server/piParser.js';

const db = new DatabaseSync(join(homedir(), '.local/share/opencode/opencode.db'), { readOnly: true });
const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'").all();
console.log('消息类型计数', JSON.stringify(db.prepare('SELECT type, COUNT(*) AS count FROM session_message GROUP BY type').all()));
for (const type of ['system', 'synthetic', 'shell', 'compaction', 'idle', 'location-switched', 'model-switched']) {
  const row = db.prepare('SELECT data FROM session_message WHERE type=? ORDER BY rowid DESC LIMIT 1').get(type);
  const data = row ? JSON.parse(String(row.data)) : {};
  console.log('附加消息结构', type, JSON.stringify(Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value && typeof value === 'object' ? Object.keys(value) : typeof value]))));
}
console.log('用户消息结构', JSON.stringify(db.prepare("SELECT type, data FROM session_message WHERE type='user' ORDER BY rowid DESC LIMIT 2").all().map(row => { const data = JSON.parse(String(row.data)); return { type: row.type, keys: Object.keys(data), contentType: typeof data.content, contentKeys: data.content && !Array.isArray(data.content) ? Object.keys(data.content) : undefined, parts: Array.isArray(data.content) ? data.content.map((part: Record<string, unknown>) => ({ type: part.type, keys: Object.keys(part) })) : undefined }; })));
const examples = db.prepare("SELECT data FROM session_message WHERE type='assistant' ORDER BY rowid DESC LIMIT 200").all();
const toolShapes = new Map();
for (const row of examples) for (const part of JSON.parse(String(row.data)).content ?? []) if (part.type === 'tool') toolShapes.set(part.name, { name: part.name, status: part.state?.status, input: Object.keys(part.state?.input ?? {}), metadata: Object.keys(part.state?.metadata ?? {}), metadataShape: Object.fromEntries(Object.entries(part.state?.metadata ?? {}).map(([key, value]) => [key, value && typeof value === 'object' ? Object.keys(value) : typeof value])) });
console.log('工具结构', JSON.stringify([...toolShapes.values()]));
console.log(JSON.stringify(tables.filter(row => /session|message|part/.test(String(row.name))), null, 2));
for (const table of ['message', 'part', 'session_message', 'session_part', 'session_v2']) {
  if (!tables.some(row => row.name === table)) continue;
  const rows = db.prepare(`SELECT * FROM ${table} ORDER BY rowid DESC LIMIT 30`).all();
  const structures = rows.map(row => {
    const data = typeof row.data === 'string' ? JSON.parse(row.data) : {};
    return { columns: Object.keys(row), type: row.type ?? data.type, role: data.role, keys: Object.keys(data), parts: Array.isArray(data.content) ? data.content.map((part: Record<string, unknown>) => ({ type: part.type, keys: Object.keys(part), stateKeys: part.state && typeof part.state === 'object' ? Object.keys(part.state) : undefined })) : typeof data.content, state: typeof data.state === 'object' && data.state ? Object.keys(data.state) : undefined };
  });
  console.log(table, JSON.stringify(structures.slice(0, 12)));
}
db.close();
const structures = new Map<string, unknown>();
for (const file of scanPiSessions().slice(-3)) {
  for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(line);
    if (row.type !== 'message') continue;
    const message = row.message;
    const key = String(message.role);
    structures.set(key, { role: message.role, keys: Object.keys(message), parts: Array.isArray(message.content) ? [...new Set(message.content.map((part: Record<string, unknown>) => JSON.stringify({ type: part.type, keys: Object.keys(part) })))] : typeof message.content });
  }
}
console.log('pi', JSON.stringify([...structures.values()]));
