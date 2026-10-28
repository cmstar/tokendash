import type { TimingResponse } from '../shared/types.js';
import { projectName } from '../shared/projectNames.js';
import { isInheritedCodexRecord, type CodexRecord } from './codexRollout.js';

type ThreadKind = 'main' | 'subagent' | 'system' | 'unknown';
interface ThreadIdentity { id: string; kind: ThreadKind; parentId?: string; project: string; allowSystemModelFallback?: boolean }
export interface ParsedTimingTurn {
  id: string;
  model: string;
  startedAt?: number;
  completedAt?: number;
  terminalStatus?: 'completed' | 'aborted';
  estimated?: boolean;
  inherited?: boolean;
  /** Only present for retained replay whose original owner differs from this file. */
  owner?: ThreadIdentity;
}
export interface ParsedTiming {
  kind: ThreadKind;
  parentId?: string;
  allowSystemModelFallback?: boolean;
  turns: ParsedTimingTurn[];
}
interface TimingSession { id: string; cwd: string; createdAt: string; timing?: ParsedTiming }
export interface TimingOptions {
  startDate?: string;
  endDate?: string;
  project?: string | null;
  includeSystem?: boolean;
  timezone?: string;
}

function timestamp(value: unknown): number | undefined {
  const ms = typeof value === 'number' ? value * 1000 : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(ms) && ms >= 0 && ms <= 8.64e15 ? ms : undefined;
}
function modelName(value: unknown): string | undefined {
  const model = typeof value === 'string' ? value : (value as { model?: unknown } | null)?.model;
  return typeof model === 'string' && model.trim() ? model : undefined;
}
function identity(meta: Record<string, unknown>): ThreadIdentity {
  const subagent = (meta.source as { subagent?: unknown } | undefined)?.subagent;
  const spawn = (subagent as { thread_spawn?: { parent_thread_id?: unknown } } | undefined)?.thread_spawn;
  const other = (subagent as { other?: unknown } | undefined)?.other;
  const internalRole = typeof subagent === 'string' ? subagent : other;
  const parentId = typeof spawn?.parent_thread_id === 'string' ? spawn.parent_thread_id : undefined;
  return {
    id: typeof meta.id === 'string' ? meta.id : '',
    project: typeof meta.cwd === 'string' ? projectName(meta.cwd) || 'unknown' : 'unknown',
    kind: ['guardian', 'codex-auto-review', 'review', 'compact', 'compaction'].includes(String(internalRole)) ? 'system'
      : spawn ? 'subagent' : subagent !== undefined || meta.source === 'subagent' ? 'unknown' : 'main',
    parentId,
    allowSystemModelFallback: meta.source == null || (subagent !== undefined && !spawn),
  };
}

/** Stored in the existing usage index: no second file read or decompression. */
export function parseCodexTiming(records: CodexRecord[], meta: Record<string, unknown>): ParsedTiming {
  const own = identity(meta);
  const turns = new Map<string, ParsedTimingTurn>();
  const owners = new Map<string, ThreadIdentity>();
  const contextualModels = new Set<string>();
  const nativeStarts = new Set<string>();
  let replayOwner = own;
  let activeTurn = '';
  let currentModel = '';
  const createdAt = timestamp(meta.timestamp);
  for (const record of records) {
    if (isInheritedCodexRecord(record, meta)) continue;
    const p = record.payload;
    if (record.type === 'session_meta') { replayOwner = identity(p); continue; }
    if (record.type === 'world_state') {
      const explicitModel = modelName((p.state as Record<string, unknown> | undefined)?.model);
      currentModel = explicitModel ?? currentModel;
      const active = turns.get(activeTurn);
      if (active && explicitModel && !contextualModels.has(activeTurn)) {
        active.model = explicitModel;
        contextualModels.add(activeTurn);
      }
      continue;
    }
    const kind = record.type === 'event_msg' ? p.type : record.type;
    if (!['turn_context', 'task_started', 'task_complete', 'turn_aborted'].includes(String(kind))) continue;
    const contextModel = kind === 'turn_context' ? modelName(p.model) : undefined;
    // Older contexts have no turn_id and can precede task_started. They still
    // establish the current model, even though no timed turn exists yet.
    currentModel = contextModel ?? currentModel;
    // root_turn_id identifies the root request, not the child's own turn identity.
    const id = typeof p.turn_id === 'string' && p.turn_id ? p.turn_id : activeTurn;
    if (!id) continue;
    if (kind === 'task_started' || kind === 'turn_context') activeTurn = id;
    let turn = turns.get(id);
    if (!turn) {
      turn = { id, model: currentModel || 'unknown' };
      turns.set(id, turn);
      owners.set(id, replayOwner);
    }
    if (kind === 'turn_context') {
      if (!contextualModels.has(id) && contextModel) { turn.model = contextModel; contextualModels.add(id); }
      continue;
    }
    const start = timestamp(p.started_at);
    if (kind === 'task_started') {
      turn.startedAt ??= start ?? timestamp(record.timestamp);
      if (start !== undefined) nativeStarts.add(id);
      continue;
    }
    const duration = typeof p.duration_ms === 'number' && Number.isFinite(p.duration_ms) && p.duration_ms >= 0 ? p.duration_ms : undefined;
    const end = timestamp(p.completed_at) ?? (start !== undefined && duration !== undefined ? start + duration : timestamp(record.timestamp));
    if (end === undefined || end > 8.64e15 || (turn.completedAt !== undefined && end < turn.completedAt)) continue;
    turn.startedAt ??= start;
    if (start !== undefined) nativeStarts.add(id);
    turn.completedAt = end;
    turn.terminalStatus = kind === 'task_complete' ? 'completed' : 'aborted';
    if (duration !== undefined && duration <= end) {
      turn.startedAt = end - duration;
      turn.estimated = false;
    } else if (turn.startedAt !== undefined && end >= turn.startedAt) {
      turn.estimated = !(nativeStarts.has(id) && timestamp(p.completed_at) !== undefined);
    }
    if (activeTurn === id) activeTurn = '';
  }
  return {
    kind: own.kind, parentId: own.parentId, allowSystemModelFallback: own.allowSystemModelFallback,
    turns: [...turns.values()].filter(turn => turn.startedAt !== undefined || turn.completedAt !== undefined).map(turn => {
      // Older forks replay the original timing with new envelope timestamps.
      // Native payload times and original metadata preserve that ownership.
      if ((meta.forked_from_id || own.kind !== 'main') && createdAt !== undefined
        && (turn.completedAt ?? turn.startedAt ?? Infinity) < createdAt) {
        const recordedOwner = owners.get(turn.id)!;
        const parent = own.parentId ?? (typeof meta.forked_from_id === 'string' ? meta.forked_from_id : undefined);
        return { ...turn, inherited: true, owner: recordedOwner.id !== own.id ? recordedOwner
          : { id: parent ?? `unknown:${turn.id}`, kind: 'unknown' as const, project: 'unknown' } };
      }
      return turn;
    }),
  };
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
export function isTimingDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1000-01-01'
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function calendar(timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const parts = (ms: number) => Object.fromEntries(formatter.formatToParts(ms).map(p => [p.type, p.value]));
  const dateKey = (ms: number) => { const p = parts(ms); return `${p.year}-${p.month}-${p.day}`; };
  const offset = (ms: number) => {
    const p = parts(ms);
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - Math.floor(ms / 1000) * 1000;
  };
  const midnight = (date: string) => {
    const utc = Date.parse(`${date}T00:00:00Z`);
    let result = utc;
    for (let i = 0; i < 3; i++) result = utc - offset(result);
    return result;
  };
  return {
    dateKey, midnight,
    hour: (ms: number) => Number(parts(ms).hour),
    nextHour: (ms: number) => { const off = offset(ms); return (Math.floor((ms + off) / HOUR) + 1) * HOUR - off; },
  };
}

type Interval = [number, number];
export function unionDuration(intervals: Interval[]): number {
  let end = -Infinity;
  let total = 0;
  for (const [start, stop] of [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    total += Math.max(0, stop - Math.max(end, start));
    end = Math.max(end, stop);
  }
  return total;
}

/** Dedupe before filtering; elapsed time is an interval union, never work minus child time. */
export function buildCodexTiming(sessions: TimingSession[], options: TimingOptions = {}): TimingResponse {
  const timezone = options.timezone ?? 'Asia/Shanghai';
  const cal = calendar(timezone);
  const endDate = options.endDate ?? cal.dateKey(Date.now());
  if (!isTimingDate(endDate) || (options.startDate !== undefined && (!isTimingDate(options.startDate) || options.startDate > endDate))) throw new Error('Invalid timing date range');
  const identities = new Map<string, ThreadIdentity>();
  for (const session of sessions) identities.set(session.id, {
    id: session.id, project: projectName(session.cwd) || 'unknown',
    kind: session.timing?.kind ?? 'main', parentId: session.timing?.parentId,
    allowSystemModelFallback: session.timing?.allowSystemModelFallback,
  });
  const unique = new Map<string, { turn: ParsedTimingTurn; session: TimingSession }>();
  const complete = (t: ParsedTimingTurn) => t.startedAt !== undefined && t.completedAt !== undefined && t.completedAt >= t.startedAt;
  const rank = (t: ParsedTimingTurn) => (complete(t) ? 4 : 0) + (t.inherited ? 0 : 2) + (t.estimated ? 0 : 1);
  for (const session of sessions) for (const turn of session.timing?.turns ?? []) {
    if (turn.owner && !identities.has(turn.owner.id)) identities.set(turn.owner.id, turn.owner);
    const prev = unique.get(turn.id);
    if (!prev || rank(turn) > rank(prev.turn) || (rank(turn) === rank(prev.turn) && session.createdAt < prev.session.createdAt)) unique.set(turn.id, { turn, session });
  }
  // Metadata takes precedence. A metadata-less thread whose own turns are all
  // auto-review can also be classified as internal, including its descendants.
  // A mixed-model thread is not reclassified wholesale from one review turn.
  const ownerModels = new Map<string, Set<string>>();
  for (const { turn, session } of unique.values()) {
    const ownerId = turn.owner?.id ?? session.id;
    if (!ownerModels.has(ownerId)) ownerModels.set(ownerId, new Set());
    ownerModels.get(ownerId)!.add(turn.model);
  }
  const fallbackSystemThreads = new Set([...ownerModels].filter(([id, models]) => identities.get(id)?.allowSystemModelFallback
    && models.size === 1 && models.has('codex-auto-review')).map(([id]) => id));
  const lineage = (id: string) => {
    let current = identities.get(id);
    let root = id;
    let unknown = false;
    let system = false;
    const seen = new Set<string>();
    while (current) {
      if (seen.has(current.id)) { unknown = true; break; }
      seen.add(current.id);
      root = current.id;
      system ||= current.kind === 'system' || fallbackSystemThreads.has(current.id);
      unknown ||= current.kind === 'unknown';
      if (current.kind !== 'subagent') break;
      if (!current.parentId) { unknown = true; break; }
      root = current.parentId;
      current = identities.get(current.parentId);
      if (!current) unknown = true;
    }
    return { root, unknown, system };
  };
  const until = cal.midnight(new Date(Date.parse(`${endDate}T00:00:00Z`) + DAY).toISOString().split('T')[0]);
  const explicitSince = options.startDate ? cal.midnight(options.startDate) : -Infinity;
  const selected = [...unique.values()].map(({ turn, session }) => {
    const owner = identities.get(turn.owner?.id ?? session.id)!;
    const family = lineage(owner.id);
    return { turn, owner, family };
  }).filter(({ turn, owner, family }) => options.includeSystem || (!family.system && !(owner.allowSystemModelFallback && turn.model === 'codex-auto-review')));
  const inRange = (turn: ParsedTimingTurn) => complete(turn)
    ? turn.completedAt! > explicitSince && turn.startedAt! < until
    : (turn.startedAt ?? turn.completedAt ?? -Infinity) >= explicitSince && (turn.startedAt ?? turn.completedAt ?? Infinity) < until;
  const isCompletedMainTurnInRange = ({ turn, owner, family }: typeof selected[number]) => turn.terminalStatus === 'completed'
    && complete(turn) && owner.kind === 'main' && !family.system && !family.unknown
    && !(owner.allowSystemModelFallback && turn.model === 'codex-auto-review')
    && turn.completedAt! >= explicitSince && turn.completedAt! < until;
  const availableProjects = [...new Set(selected.filter(item => inRange(item.turn) || isCompletedMainTurnInRange(item)).map(({ owner }) => owner.project))].sort();
  const filtered = selected.filter(({ owner, turn }) => (!options.project || owner.project === options.project) && inRange(turn));
  const earliest = filtered.filter(({ turn }) => complete(turn) && turn.completedAt! > turn.startedAt!).reduce((min, { turn }) => Math.min(min, turn.startedAt!), Infinity);
  const startDate = options.startDate ?? (Number.isFinite(earliest) ? cal.dateKey(earliest) : undefined);
  const since = startDate ? cal.midnight(startDate) : explicitSince;
  const response: TimingResponse = {
    timezone, totals: { workMs: 0, elapsedMs: 0, calendarDays: startDate ? Math.round((Date.parse(endDate) - Date.parse(startDate)) / DAY) + 1 : 0, conversationCount: 0, conversationElapsedMs: 0, completedTurnCount: 0, completedTurnElapsedMs: 0 },
    daily: [], projects: [], hourly: [], availableProjects,
    quality: { incompleteTurns: 0, estimatedTurns: 0, unattributedTurns: 0 },
  };
  const daily = new Map<string, TimingResponse['daily'][number]>();
  const dayBucket = (date: string) => {
    if (!daily.has(date)) daily.set(date, {
      date, workMs: 0, elapsedMs: 0, models: {},
      conversationCount: 0, conversationElapsedMs: 0, completedTurnCount: 0, completedTurnElapsedMs: 0,
    });
    return daily.get(date)!;
  };
  // A question/answer lifecycle is one main-agent turn. Use its completion date
  // and full duration; clipping or unioning independent turns changes the mean.
  for (const item of selected) {
    const { turn, owner } = item;
    if (!isCompletedMainTurnInRange(item) || (options.project && owner.project !== options.project)) continue;
    const duration = turn.completedAt! - turn.startedAt!;
    response.totals.completedTurnCount++;
    response.totals.completedTurnElapsedMs += duration;
    const day = dayBucket(cal.dateKey(turn.completedAt!));
    day.completedTurnCount++;
    day.completedTurnElapsedMs += duration;
  }
  const all: Interval[] = [];
  const dayIntervals = new Map<string, Interval[]>();
  const projectIntervals = new Map<string, Interval[]>();
  const conversations = new Map<string, Interval[]>();
  const dailyConversations = new Map<string, Map<string, Interval[]>>();
  const projects = new Map<string, TimingResponse['projects'][number]>();
  const hourly = new Map<string, TimingResponse['hourly'][number]>();
  const push = (map: Map<string, Interval[]>, key: string, interval: Interval) => { if (!map.has(key)) map.set(key, []); map.get(key)!.push(interval); };
  for (const { turn, owner, family } of filtered) {
    if (!complete(turn)) { response.quality.incompleteTurns++; if (family.unknown) response.quality.unattributedTurns++; continue; }
    const start = Math.max(since, turn.startedAt!);
    const end = Math.min(until, turn.completedAt!);
    if (end <= start) continue;
    if (turn.estimated) response.quality.estimatedTurns++;
    if (family.unknown) response.quality.unattributedTurns++;
    all.push([start, end]);
    push(projectIntervals, owner.project, [start, end]);
    const belongsToMainConversation = !family.unknown && !family.system && identities.get(family.root)?.kind === 'main'
      && !(owner.allowSystemModelFallback && turn.model === 'codex-auto-review');
    if (belongsToMainConversation) push(conversations, family.root, [start, end]);
    response.totals.workMs += end - start;
    const project = projects.get(owner.project) ?? { project: owner.project, workMs: 0, elapsedMs: 0 };
    project.workMs += end - start;
    projects.set(owner.project, project);
    let cursor = start;
    while (cursor < end) {
      const stop = Math.min(cal.nextHour(cursor), end);
      const date = cal.dateKey(cursor);
      const hour = cal.hour(cursor);
      const ms = stop - cursor;
      const day = dayBucket(date);
      day.workMs += ms;
      day.models[turn.model] = (day.models[turn.model] ?? 0) + ms;
      push(dayIntervals, date, [cursor, stop]);
      if (belongsToMainConversation) {
        if (!dailyConversations.has(date)) dailyConversations.set(date, new Map());
        push(dailyConversations.get(date)!, family.root, [cursor, stop]);
      }
      const key = `${date}:${hour}`;
      const block = hourly.get(key) ?? { date, hour, workMs: 0 };
      block.workMs += ms;
      hourly.set(key, block);
      cursor = stop;
    }
  }
  response.totals.elapsedMs = unionDuration(all);
  response.totals.conversationCount = conversations.size;
  response.totals.conversationElapsedMs = [...conversations.values()].reduce((sum, intervals) => sum + unionDuration(intervals), 0);
  for (const [date, families] of dailyConversations) {
    const day = dayBucket(date);
    day.conversationCount = families.size;
    day.conversationElapsedMs = [...families.values()].reduce((sum, intervals) => sum + unionDuration(intervals), 0);
  }
  response.daily = [...daily.values()].map(day => ({ ...day, elapsedMs: unionDuration(dayIntervals.get(day.date) ?? []) })).sort((a, b) => a.date.localeCompare(b.date));
  response.projects = [...projects.values()].map(project => ({ ...project, elapsedMs: unionDuration(projectIntervals.get(project.project)!) })).sort((a, b) => b.workMs - a.workMs || a.project.localeCompare(b.project));
  response.hourly = [...hourly.values()].sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour);
  return response;
}
