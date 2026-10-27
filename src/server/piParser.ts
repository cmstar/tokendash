import './appSettings.js';
import { modelCost, getPricingExchangeRate } from '../shared/modelPricing.js';
import { readFileSync, readdirSync, statSync, accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { DailyEntry, DailyResponse, ProjectsResponse, BlockEntry, BlocksResponse, ModelBreakdown } from '../shared/types.js';
import { buildUsageFileIndex } from './usageFileIndex.js';
import { type BlockGranularity } from './claudeJsonlParser.js';

// ---------------------------------------------------------------------------
// Pi JSONL 格式说明
//
// 会话文件位于 ~/.pi/agent/sessions/<project-dir-slug>/<timestamp>_<id>.jsonl
// 每行 type 之一：
//   session        — {"type":"session","id":"...","timestamp":"...","cwd":"D:\\file\\Zed"}
//   model_change   — {"type":"model_change","provider":"amax","modelId":"qwen3.8-max-preview"}
//   message        — role=assistant 时携带 usage 字段：
//                    {input, output, cacheRead, cacheWrite, reasoning, totalTokens,
//                     cost:{input,output,cacheRead,cacheWrite,total}}
//                    以及 message.model / message.provider
// ---------------------------------------------------------------------------

const PI_INDEX_VERSION = 'pi-session-v4-1min';
const DEFAULT_TZ = 'Asia/Shanghai';

// 估算基线：pi 会话的 system prompt + 工具 schema 不在 JSONL 里，
// 但每轮请求都会携带，按典型 pi 会话体量取 4k tokens 打底。
const BASELINE_CONTEXT_TOKENS = 4000;
// 图片内容（toolResult 中的 image）按 VLM 常规切块体量估算
const IMAGE_TOKEN_ESTIMATE = 1000;

// ---------------------------------------------------------------------------
// 内部类型
// ---------------------------------------------------------------------------

export interface PiTokenEvent {
  timestamp: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cost: number;
  /** true = provider 未返回 usage，token 数由消息内容估算 */
  estimated: boolean;
}

export interface PiSession {
  id: string;
  cwd: string;
  createdAt: string;
  tokenEvents: PiTokenEvent[];
}

interface TokenAccumulator {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cost: number;
  estimatedTokens: number;
}

interface AggregateBucket {
  acc: TokenAccumulator;
  models: Map<string, TokenAccumulator>;
}

// ---------------------------------------------------------------------------
// 目录检测
// ---------------------------------------------------------------------------

function getPiSessionsDir(): string {
  return join(homedir(), '.pi', 'agent', 'sessions');
}

export function isPiAccessible(): boolean {
  try {
    accessSync(getPiSessionsDir(), constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 文件扫描
// ---------------------------------------------------------------------------

export function scanPiSessions(): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
      } else if (entry.endsWith('.jsonl')) {
        results.push(full);
      }
    }
  }

  walk(getPiSessionsDir());
  return results.sort();
}

// ---------------------------------------------------------------------------
// 单文件解析
// ---------------------------------------------------------------------------

/** 粗略 token 估算：CJK ≈ 1 token/字，其他（英文/代码）≈ 3.5 字符/token。 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||   // CJK 统一表意文字
      (code >= 0x3400 && code <= 0x4dbf) ||   // 扩展 A
      (code >= 0x3000 && code <= 0x303f) ||   // CJK 标点
      (code >= 0xff00 && code <= 0xffef)      // 全角形式
    ) {
      cjk++;
    }
  }
  const chars = [...text].length;
  return Math.round(cjk + (chars - cjk) / 3.5);
}

/** user / assistant / toolResult 的 content 统一估算（string 或 part 数组）。 */
function estimateContentTokens(content: unknown): number {
  if (content == null) return 0;
  if (typeof content === 'string') return estimateTokens(content);
  if (!Array.isArray(content)) return 0;
  let total = 0;
  for (const part of content) {
    const p = part as Record<string, unknown> | null;
    if (!p) continue;
    if (p.type === 'text' && typeof p.text === 'string') total += estimateTokens(p.text);
    else if (p.type === 'thinking' && typeof p.thinking === 'string') total += estimateTokens(p.thinking);
    else if (p.type === 'toolCall') total += estimateTokens(`${p.name ?? ''}${JSON.stringify(p.arguments ?? {})}`);
    else if (p.type === 'image') total += IMAGE_TOKEN_ESTIMATE;
  }
  return total;
}

export function parsePiSession(filepath: string): PiSession | null {
  let content: string;
  try {
    content = readFileSync(filepath, 'utf-8');
  } catch {
    return null;
  }

  let sessionId = '';
  let cwd = '';
  let createdAt = '';
  let currentModel = '';
  const tokenEvents: PiTokenEvent[] = [];
  // 当前轮请求携带的上下文体量（估算），真实 usage 出现时按实际值重锚定
  let contextTokens = BASELINE_CONTEXT_TOKENS;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = obj.type as string;

    if (type === 'session') {
      sessionId = (obj.id as string) || '';
      cwd = (obj.cwd as string) || '';
      createdAt = (obj.timestamp as string) || '';
      continue;
    }

    if (type === 'model_change') {
      currentModel = (obj.modelId as string) || currentModel;
      continue;
    }

    // 压缩后历史被 summary 取代，上下文回落到底线 + summary
    if (type === 'compaction') {
      contextTokens = BASELINE_CONTEXT_TOKENS + estimateTokens((obj.summary as string) || '');
      continue;
    }

    if (type !== 'message') continue;

    const msg = obj.message as Record<string, unknown> | undefined;
    if (!msg) continue;
    const role = msg.role as string;

    // 非 assistant 消息只累积上下文，不产生 token 事件
    if (role === 'user' || role === 'toolResult') {
      contextTokens += estimateContentTokens(msg.content);
      continue;
    }
    if (role !== 'assistant') continue;

    const usage = msg.usage as Record<string, unknown> | undefined;
    const totalTokens = (usage?.totalTokens as number) || 0;
    const model = (msg.model as string) || currentModel || 'unknown';
    const timestamp = (obj.timestamp as string) || '';
    const contentTokens = estimateContentTokens(msg.content);

    if (totalTokens > 0) {
      const input = (usage!.input as number) || 0;
      const reasoning = (usage!.reasoning as number) || 0;
      let output = (usage!.output as number) || 0;
      if (input + output === 0 && reasoning === 0) output = totalTokens; // 部分 provider 只报 total
      // reasoning 是模型生成的思维链 token，计入输出与总量
      output += reasoning;
      const cacheRead = (usage!.cacheRead as number) || 0;
      const cacheWrite = (usage!.cacheWrite as number) || 0;
      const costObj = (usage!.cost as Record<string, unknown>) || {};
      tokenEvents.push({
        timestamp,
        model,
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        totalTokens: (totalTokens || input + output + cacheRead) + reasoning,
        cost: modelCost(model, input, output, cacheRead, cacheWrite, timestamp) ?? ((costObj.total as number) || 0),
        estimated: false,
      });
      // 本条 assistant 内容会在下一轮被回放；有真实 input 时用它重锚定
      contextTokens = (input > 0 ? input : contextTokens) + output;
      continue;
    }

    // provider 未返回 usage（本地模型 / 部分代理）：有实际输出才按内容估算，
    // 空内容（如中途 aborted）不记录
    if (contentTokens === 0) continue;
    tokenEvents.push({
      timestamp,
      model,
      inputTokens: contextTokens,
      outputTokens: contentTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: contextTokens + contentTokens,
      cost: 0,
      estimated: true,
    });
    contextTokens += contentTokens;
  }

  if (!sessionId) return null;
  return { id: sessionId, cwd, createdAt, tokenEvents };
}

// ---------------------------------------------------------------------------
// 索引加载
// ---------------------------------------------------------------------------

function loadSessions(): PiSession[] {
  const result = buildUsageFileIndex<PiSession | null, { path: string }>({
    cacheName: 'pi-sessions',
    parserVersion: `${PI_INDEX_VERSION}:pricing-v2:${getPricingExchangeRate()}`,
    files: scanPiSessions().map(path => ({ path })),
    parseFile: file => parsePiSession(file.path),
  });
  return result.values.filter((s): s is PiSession => s !== null);
}

// ---------------------------------------------------------------------------
// 时区 / 日期工具
// ---------------------------------------------------------------------------

const TZ_OFFSETS: Record<string, number> = {
  'Asia/Shanghai': 8,
  'Asia/Tokyo': 9,
  'America/New_York': -5,
  'America/Los_Angeles': -8,
  'Europe/London': 0,
  'UTC': 0,
};

function getTzOffsetHours(tz: string): number {
  return TZ_OFFSETS[tz] ?? 8;
}

function toLocalISO(ts: string, tz: string): Date {
  const d = new Date(ts);
  return new Date(d.getTime() + getTzOffsetHours(tz) * 3600_000);
}

function getDateKey(ts: string, tz: string): string {
  return toLocalISO(ts, tz).toISOString().slice(0, 10);
}

function getHourKey(ts: string, tz: string): string {
  const local = toLocalISO(ts, tz);
  return local.toISOString().slice(0, 13).replace('T', ' ') + ':00';
}

// Re-declared locally (same values as the Claude parser) to avoid a runtime
// dependency beyond the type-only import above.
const GRANULARITY_MINUTES: Record<BlockGranularity, number> = { hour: 60, '15m': 15, '5m': 5, '1m': 1 };

/** Bucket key at a fixed 5-minute granularity ('yyyy-MM-dd HH:mm'), the fine base the index layer always stores. */
export function getMinuteKey(ts: string, tz: string): string {
  const offset = (TZ_OFFSETS[tz] ?? 8) * 3_600_000;
  const d = new Date(new Date(ts).getTime() + offset);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const minute = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${minute}`;
}

/** Coarsen a 5-min bucket key ('yyyy-MM-dd HH:mm') up to the requested granularity ('hour' yields 'yyyy-MM-dd HH'). */
export function coarsenBucketKey(key: string, granularity: BlockGranularity): string {
  if (granularity === '1m') return key;
  if (granularity === 'hour') return key.slice(0, 13);   // 'yyyy-MM-dd HH'
  const minutes = GRANULARITY_MINUTES[granularity];
  const minute = String(Math.floor(Number(key.slice(14, 16)) / minutes) * minutes).padStart(2, '0');
  return `${key.slice(0, 14)}${minute}`;
}

/** Keep the full working-directory path so same-named projects do not merge. */
export function normalizePiProjectPath(cwd: string): string {
  if (!cwd) return 'unknown';
  return cwd.replace(/[\\/]+$/, '') || 'unknown';
}

// ---------------------------------------------------------------------------
// 聚合核心
// ---------------------------------------------------------------------------

function emptyAcc(): TokenAccumulator {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, cost: 0, estimatedTokens: 0 };
}

function addEvent(acc: TokenAccumulator, ev: PiTokenEvent): void {
  acc.inputTokens += ev.inputTokens;
  acc.outputTokens += ev.outputTokens;
  acc.cacheReadTokens += ev.cacheReadTokens;
  acc.cacheWriteTokens += ev.cacheWriteTokens;
  acc.totalTokens += ev.totalTokens;
  acc.cost += ev.cost;
  if (ev.estimated) acc.estimatedTokens += ev.totalTokens;
}

function mergeAcc(target: TokenAccumulator, source: TokenAccumulator): void {
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.cacheReadTokens += source.cacheReadTokens;
  target.cacheWriteTokens += source.cacheWriteTokens;
  target.totalTokens += source.totalTokens;
  target.cost += source.cost;
  target.estimatedTokens += source.estimatedTokens;
}

function addToBucket(bucket: AggregateBucket, ev: PiTokenEvent): void {
  addEvent(bucket.acc, ev);
  if (!bucket.models.has(ev.model)) bucket.models.set(ev.model, emptyAcc());
  addEvent(bucket.models.get(ev.model)!, ev);
}

function mergeAggregateBucket(target: AggregateBucket, source: AggregateBucket): void {
  mergeAcc(target.acc, source.acc);
  for (const [model, m] of source.models) {
    if (!target.models.has(model)) target.models.set(model, emptyAcc());
    mergeAcc(target.models.get(model)!, m);
  }
}

function accToEntry(date: string, acc: TokenAccumulator, modelAccs: Map<string, TokenAccumulator>): DailyEntry {
  const modelBreakdowns: ModelBreakdown[] = [...modelAccs.entries()].map(([modelName, m]) => ({
    modelName,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    cacheCreationTokens: m.cacheWriteTokens,
    cacheReadTokens: m.cacheReadTokens,
    cost: m.cost,
    estimatedTokens: m.estimatedTokens,
  }));
  return {
    date,
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    cacheCreationTokens: acc.cacheWriteTokens,
    cacheReadTokens: acc.cacheReadTokens,
    totalTokens: acc.totalTokens,
    totalCost: acc.cost,
    modelsUsed: [...modelAccs.keys()],
    modelBreakdowns,
    estimatedTokens: acc.estimatedTokens,
  };
}

function groupSessions(
  sessions: PiSession[],
  groupBy: 'day' | 'hour' | 'project' | 'onemin',
  tz: string,
  projectFilter?: string | null,
): Map<string, AggregateBucket> {
  const grouped = new Map<string, AggregateBucket>();

  for (const session of sessions) {
    const projectName = normalizePiProjectPath(session.cwd);
    if (projectFilter && projectName !== projectFilter) continue;

    for (const ev of session.tokenEvents) {
      let key: string;
      if (groupBy === 'hour') {
        key = getHourKey(ev.timestamp, tz);
      } else if (groupBy === 'onemin') {
        key = getMinuteKey(ev.timestamp, tz);
      } else if (groupBy === 'project') {
        key = projectName;
      } else {
        key = getDateKey(ev.timestamp, tz);
      }
      if (!grouped.has(key)) grouped.set(key, { acc: emptyAcc(), models: new Map() });
      addToBucket(grouped.get(key)!, ev);
    }
  }

  return grouped;
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

export function getDailyResponse(options?: { timezone?: string }): DailyResponse {
  const tz = options?.timezone || DEFAULT_TZ;
  return buildDailyFromSessions(loadSessions(), tz);
}

/** 纯函数：按日聚合已解析的会话，便于单元测试注入 fixture。 */
export function buildDailyFromSessions(sessions: PiSession[], tz: string): DailyResponse {
  const grouped = groupSessions(sessions, 'day', tz);

  const daily: DailyEntry[] = [];
  const totalsAcc = emptyAcc();
  const totalModels = new Map<string, TokenAccumulator>();

  for (const [date, { acc, models }] of grouped) {
    daily.push(accToEntry(date, acc, models));
    mergeAcc(totalsAcc, acc);
    for (const [model, m] of models) {
      if (!totalModels.has(model)) totalModels.set(model, emptyAcc());
      mergeAcc(totalModels.get(model)!, m);
    }
  }

  daily.sort((a, b) => a.date.localeCompare(b.date));

  return {
    daily,
    totals: {
      inputTokens: totalsAcc.inputTokens,
      outputTokens: totalsAcc.outputTokens,
      cacheCreationTokens: totalsAcc.cacheWriteTokens,
      cacheReadTokens: totalsAcc.cacheReadTokens,
      totalTokens: totalsAcc.totalTokens,
      totalCost: totalsAcc.cost,
      estimatedTokens: totalsAcc.estimatedTokens,
    },
  };
}

export function getProjectsResponse(options?: { timezone?: string }): ProjectsResponse {
  const tz = options?.timezone || DEFAULT_TZ;
  const sessions = loadSessions();

  // 按项目 → 日期二级分组
  const projectDaily = new Map<string, Map<string, AggregateBucket>>();

  for (const session of sessions) {
    const projectName = normalizePiProjectPath(session.cwd);
    if (!projectDaily.has(projectName)) projectDaily.set(projectName, new Map());
    const dailyMap = projectDaily.get(projectName)!;

    for (const ev of session.tokenEvents) {
      const dayKey = getDateKey(ev.timestamp, tz);
      if (!dailyMap.has(dayKey)) dailyMap.set(dayKey, { acc: emptyAcc(), models: new Map() });
      addToBucket(dailyMap.get(dayKey)!, ev);
    }
  }

  const projects: Record<string, DailyEntry[]> = {};
  for (const [projectName, dailyMap] of projectDaily) {
    projects[projectName] = [...dailyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { acc, models }]) => accToEntry(date, acc, models));
  }

  return { projects };
}

export function getBlocksResponse(options?: { project?: string | null; timezone?: string; granularity?: BlockGranularity }): BlocksResponse {
  const tz = options?.timezone || DEFAULT_TZ;
  const granularity = options?.granularity ?? 'hour';
  const sessions = loadSessions();

  // Group at a fixed 5-min base, then coarsen to the target granularity so the
  // on-disk index stays decoupled from the requested bucket size.
  const grouped = groupSessions(sessions, 'onemin', tz, options?.project);

  const blockBuckets = new Map<string, AggregateBucket>();
  for (const [key, bucket] of grouped) {
    const coarseKey = coarsenBucketKey(key, granularity);
    if (!blockBuckets.has(coarseKey)) blockBuckets.set(coarseKey, { acc: emptyAcc(), models: new Map() });
    mergeAggregateBucket(blockBuckets.get(coarseKey)!, bucket);
  }

  const granMinutes = GRANULARITY_MINUTES[granularity];
  // 1-minute responses cover only the trailing 15 minutes — the realtime tab
  // polls every 60s and must not pull the full minute-level history.
  const windowStartKey = granularity === '1m'
    ? getMinuteKey(new Date(Date.now() - 15 * 60_000).toISOString(), DEFAULT_TZ)
    : '';
  const blocks: BlockEntry[] = [...blockBuckets.entries()]
    .filter(([key]) => !windowStartKey || key >= windowStartKey)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, { acc, models }], idx) => {
      const [datePart, timePart] = key.split(' ');
      const hour = timePart.slice(0, 2);

      return {
        id: `pi-${granularity}-${idx}`,
        startTime: granularity === 'hour' ? `${datePart}T${hour}:00:00` : `${datePart}T${timePart}:00`,
        endTime: granularity === 'hour'
          ? `${datePart}T${hour}:59:59`
          : `${datePart}T${timePart.slice(0, 3)}${String(Number(timePart.slice(3, 5)) + granMinutes - 1).padStart(2, '0')}:59`,
        actualEndTime: null,
        isActive: false,
        isGap: false,
        entries: acc.totalTokens > 0 ? 1 : 0,
        tokenCounts: {
          inputTokens: acc.inputTokens,
          outputTokens: acc.outputTokens,
          cacheCreationInputTokens: acc.cacheWriteTokens,
          cacheReadInputTokens: acc.cacheReadTokens,
        },
        totalTokens: acc.totalTokens,
        costUSD: acc.cost,
        models: [...models.keys()],
      };
    });

  return { blocks };
}
