import { describe, expect, it } from 'vitest';
import { buildCodexTiming, parseCodexTiming, type ParsedTimingTurn } from '../../server/codexTiming.js';
import type { CodexRecord } from '../../server/codexRollout.js';
import { TimingResponseSchema } from '../../shared/schemas.js';

const MIN = 60_000;
const base = Date.parse('2026-10-01T00:00:00Z');
const interval = (id: string, from: number, to: number, model = 'model-a'): ParsedTimingTurn => ({ id, model, startedAt: base + from * MIN, completedAt: base + to * MIN, terminalStatus: 'completed', estimated: false });
const session = (id: string, turns: ParsedTimingTurn[], parentId?: string, cwd = '/repo/demo') => ({ id, cwd, createdAt: '2026-10-01T00:00:00Z', timing: { kind: parentId ? 'subagent' as const : 'main' as const, parentId, turns } });
const options = { startDate: '2026-10-01', endDate: '2026-10-03' };
const meta = (extra = {}) => ({ id: 'main', cwd: '/repo/demo', timestamp: '2026-10-01T00:00:00Z', source: 'cli', ...extra });
const event = (type: string, payload = {}, timestamp?: string): CodexRecord => ({ type: 'event_msg', timestamp, payload: { type, ...payload } });

describe('Codex timing turn parsing', () => {
  it('uses native duration/end over replay timestamps and keeps initial model', () => {
    const turns = parseCodexTiming([
      event('task_started', { turn_id: 't', started_at: base / 1000 }),
      { type: 'turn_context', payload: { turn_id: 't', model: 'initial' } },
      { type: 'turn_context', payload: { turn_id: 't', model: 'later' } },
      event('task_complete', { turn_id: 't', duration_ms: 2 * MIN, completed_at: (base + 2 * MIN) / 1000 }, '2026-11-01T00:00:00Z'),
    ], meta()).turns;
    expect(turns).toEqual([{ id: 't', model: 'initial', startedAt: base, completedAt: base + 2 * MIN, terminalStatus: 'completed', estimated: false }]);
  });

  it('recovers end-only native durations and handles aborted/fallback and incomplete turns', () => {
    const turns = parseCodexTiming([
      event('task_complete', { turn_id: 'native', duration_ms: MIN, completed_at: (base + MIN) / 1000 }),
      event('task_started', { turn_id: 'old' }, '2026-10-01T00:02:00Z'),
      event('turn_aborted', { turn_id: 'old' }, '2026-10-01T00:05:00Z'),
      event('task_started', { turn_id: 'pending' }, '2026-10-01T00:06:00Z'),
      event('task_complete', { turn_id: 'no-start' }, '2026-10-01T00:07:00Z'),
      event('task_started', { turn_id: 'invalid', started_at: (base + 8 * MIN) / 1000 }),
      event('task_complete', { turn_id: 'invalid', completed_at: (base + 7 * MIN) / 1000 }),
    ], meta()).turns;
    const result = buildCodexTiming([session('main', turns)], options);
    expect(result.totals.workMs).toBe(4 * MIN);
    expect(result.quality).toEqual({ incompleteTurns: 3, estimatedTurns: 1, unattributedTurns: 0 });
    expect(turns.find(turn => turn.id === 'old')?.terminalStatus).toBe('aborted');
    expect(turns.find(turn => turn.id === 'pending')?.terminalStatus).toBeUndefined();
    expect(result.totals).toMatchObject({ completedTurnCount: 1, completedTurnElapsedMs: MIN });
  });

  it('does not conflate child turn_id with root_turn_id and resolves world-state model', () => {
    const timing = parseCodexTiming([
      event('task_started', { turn_id: 'child-turn', root_turn_id: 'root-turn', started_at: base / 1000 }),
      { type: 'world_state', payload: { state: { model: { model: 'child-model' } } } },
      event('task_complete', { turn_id: 'child-turn', root_turn_id: 'root-turn', started_at: base / 1000, completed_at: (base + MIN) / 1000 }),
    ], meta({ source: { subagent: { thread_spawn: { parent_thread_id: 'parent', depth: 1 } } } }));
    expect(timing).toMatchObject({ kind: 'subagent', parentId: 'parent', turns: [{ id: 'child-turn', model: 'child-model', estimated: false }] });
  });

  it('attributes each turn to its first explicit model snapshot rather than the previous turn model', () => {
    const timing = parseCodexTiming([
      event('task_started', { turn_id: 'first', started_at: base / 1000 }),
      { type: 'world_state', payload: { state: { model: 'first-model' } } },
      event('task_complete', { turn_id: 'first', completed_at: (base + MIN) / 1000, duration_ms: MIN }),
      event('task_started', { turn_id: 'second', started_at: (base + MIN) / 1000 }),
      { type: 'turn_context', payload: { turn_id: 'second' } },
      { type: 'world_state', payload: { state: { model: { model: 'second-model' } } } },
      { type: 'world_state', payload: { state: { model: 'later-model' } } },
      { type: 'turn_context', payload: { turn_id: 'second', model: 'later-context' } },
      event('task_complete', { turn_id: 'second', completed_at: (base + 2 * MIN) / 1000, duration_ms: MIN }),
      { type: 'turn_context', payload: { turn_id: 'third', model: 'context-first' } },
      event('task_started', { turn_id: 'third', started_at: (base + 2 * MIN) / 1000 }),
      { type: 'world_state', payload: { state: { model: 'later-state' } } },
      event('task_complete', { turn_id: 'third', completed_at: (base + 3 * MIN) / 1000, duration_ms: MIN }),
    ], meta());
    expect(timing.turns.map(turn => [turn.id, turn.model])).toEqual([['first', 'first-model'], ['second', 'second-model'], ['third', 'context-first']]);
  });

  it('preserves a legacy model context emitted before task_started without a turn id', () => {
    const timing = parseCodexTiming([
      { type: 'turn_context', payload: { model: 'legacy-model' } },
      event('task_started', { turn_id: 'legacy', started_at: base / 1000 }),
      event('task_complete', { turn_id: 'legacy', completed_at: (base + MIN) / 1000, duration_ms: MIN }),
    ], meta());
    expect(timing.turns[0].model).toBe('legacy-model');
  });

  it('excludes explicit inherited ordinals while retaining a delegated own turn', () => {
    const timing = parseCodexTiming([
      { ...event('task_complete', { turn_id: 'copied', duration_ms: MIN }, '2026-10-01T00:01:00Z'), ordinal: 3 },
      { ...event('task_complete', { turn_id: 'own', duration_ms: MIN }, '2026-10-01T00:02:00Z'), ordinal: 10 },
    ], meta({ subagent_history_start_ordinal: 10, source: { subagent: { thread_spawn: { parent_thread_id: 'parent' } } } }));
    expect(timing.turns.map(t => t.id)).toEqual(['own']);
  });

  it('preserves original ownership when only a fork copy survives', () => {
    const parentMeta = meta({ id: 'parent', cwd: 'C:\\repo\\original' });
    const timing = parseCodexTiming([
      { type: 'session_meta', payload: parentMeta },
      event('task_complete', { turn_id: 'original', duration_ms: 2 * MIN, completed_at: (base + 2 * MIN) / 1000 }, '2026-10-02T00:00:00Z'),
    ], meta({ id: 'fork', timestamp: '2026-10-02T00:00:00Z', forked_from_id: 'parent' }));
    const result = buildCodexTiming([{ ...session('fork', []), timing }], options);
    expect(result.projects).toEqual([{ project: 'original', workMs: 2 * MIN, elapsedMs: 2 * MIN }]);
    expect(result.totals.conversationCount).toBe(1);
    expect(result.totals).toMatchObject({ completedTurnCount: 1, completedTurnElapsedMs: 2 * MIN });
    expect(buildCodexTiming([{ ...session('fork', []), timing }], { ...options, project: 'demo' }).totals.workMs).toBe(0);
  });
});

describe('Codex timing interval aggregation', () => {
  it('sums main, child and sibling work but unions concurrency, grouping transitive conversation families', () => {
    const result = buildCodexTiming([
      session('main', [interval('m', 0, 60)]),
      session('child', [interval('c', 10, 50, 'model-b')], 'main'),
      session('grandchild', [interval('gc', 20, 40, 'model-c')], 'child'),
      session('other', [interval('o', 30, 75)], undefined, '/repo/other'),
    ], options);
    expect(result.totals).toEqual({ workMs: 165 * MIN, elapsedMs: 75 * MIN, calendarDays: 3, conversationCount: 2, conversationElapsedMs: 105 * MIN, completedTurnCount: 2, completedTurnElapsedMs: 105 * MIN });
    expect(result.daily[0].models).toEqual({ 'model-a': 105 * MIN, 'model-b': 40 * MIN, 'model-c': 20 * MIN });
    expect(result.projects.reduce((sum, p) => sum + p.elapsedMs, 0)).toBe(105 * MIN);
    expect(result.hourly.reduce((sum, h) => sum + h.workMs, 0)).toBe(165 * MIN);
  });

  it('deduplicates globally before project filtering and never charges copied parent history to a child', () => {
    const parent = session('parent', [interval('shared', 0, 60)], undefined, '/repo/parent');
    const child = session('child', [{ ...interval('shared', 0, 60), inherited: true, owner: { id: 'parent', kind: 'main', project: 'parent' } }, interval('child-own', 10, 20)], 'parent', '/repo/child');
    for (const data of [[parent, child], [child, parent, child]]) {
      const result = buildCodexTiming(data, { ...options, project: 'child' });
      expect(result.totals).toMatchObject({ workMs: 10 * MIN, elapsedMs: 10 * MIN, conversationCount: 1, conversationElapsedMs: 10 * MIN });
      expect(result.availableProjects).toEqual(['child', 'parent']);
    }
  });

  it('excludes guardian and review-model work by default, including descendant threads', () => {
    const guardian = { ...session('guardian', [interval('g', 30, 60)]), timing: { kind: 'system' as const, turns: [interval('g', 30, 60)] } };
    const review = session('review', [interval('r', 50, 70, 'codex-auto-review')]);
    const sessions = [session('main', [interval('m', 0, 20)]), guardian,
      { ...review, timing: { ...review.timing, allowSystemModelFallback: true } },
      session('system-child', [interval('sc', 55, 65)], 'guardian')];
    expect(buildCodexTiming(sessions, options).totals.workMs).toBe(20 * MIN);
    expect(buildCodexTiming(sessions, { ...options, includeSystem: true }).totals).toMatchObject({ workMs: 80 * MIN, elapsedMs: 60 * MIN });
    expect(buildCodexTiming([session('explicit-main', [interval('review-model', 0, 10, 'codex-auto-review')])], options).totals.workMs).toBe(10 * MIN);
  });

  it('reports unresolved/cyclic lineage without dropping work or inventing conversation averages', () => {
    const sessions = [session('orphan', [interval('o', 0, 5)], 'missing'), session('cycle1', [interval('c', 0, 5)], 'cycle2'), session('cycle2', [], 'cycle1')];
    const result = buildCodexTiming(sessions, options);
    expect(result.quality.unattributedTurns).toBe(2);
    expect(result.totals).toMatchObject({ workMs: 10 * MIN, elapsedMs: 5 * MIN, conversationCount: 0, conversationElapsedMs: 0 });
  });

  it('propagates fallback system identity to descendants but does not reclassify mixed-model main threads', () => {
    const parent = session('review-parent', [interval('r', 0, 10, 'codex-auto-review')]);
    const fallbackParent = { ...parent, timing: { ...parent.timing, allowSystemModelFallback: true } };
    const child = session('review-child', [interval('rc', 2, 8)], parent.id);
    const grandchild = session('review-grandchild', [interval('rg', 4, 6)], child.id);
    const system = [fallbackParent, child, grandchild];
    expect(buildCodexTiming(system, options).totals).toMatchObject({ workMs: 0, conversationCount: 0 });
    expect(buildCodexTiming(system, { ...options, includeSystem: true }).totals).toMatchObject({ workMs: 18 * MIN, elapsedMs: 10 * MIN, conversationCount: 0 });
    const mixedParent = { ...fallbackParent, timing: { ...fallbackParent.timing, turns: [...fallbackParent.timing.turns, interval('normal', 10, 20)] } };
    expect(buildCodexTiming([mixedParent, child, grandchild], options).totals).toMatchObject({ workMs: 18 * MIN, conversationCount: 1, conversationElapsedMs: 16 * MIN });
    expect(buildCodexTiming([parent, child, grandchild], options).totals.workMs).toBe(18 * MIN);
  });

  it('treats manual forks as distinct conversations for their own new turns', () => {
    const result = buildCodexTiming([session('parent', [interval('p', 0, 30)]), session('manual-fork', [interval('f', 10, 40)])], options);
    expect(result.totals).toMatchObject({ workMs: 60 * MIN, elapsedMs: 40 * MIN, conversationCount: 2, conversationElapsedMs: 60 * MIN });
  });

  it('splits actual intervals at Shanghai midnight and hours, clips dates before aggregation, excludes idle gaps', () => {
    const crossMidnight = { ...interval('night', 0, 1), startedAt: Date.parse('2026-10-01T15:30:00Z'), completedAt: Date.parse('2026-10-01T17:30:00Z') };
    const next = { ...interval('later', 0, 1), startedAt: Date.parse('2026-10-02T02:00:00Z'), completedAt: Date.parse('2026-10-02T02:30:00Z') };
    const sessions = [session('main', [crossMidnight, next])];
    const result = buildCodexTiming(sessions, options);
    expect(result.daily.map(d => [d.date, d.workMs])).toEqual([['2026-10-01', 30 * MIN], ['2026-10-02', 120 * MIN]]);
    expect(result.hourly).toEqual([
      { date: '2026-10-01', hour: 23, workMs: 30 * MIN },
      { date: '2026-10-02', hour: 0, workMs: 60 * MIN },
      { date: '2026-10-02', hour: 1, workMs: 30 * MIN },
      { date: '2026-10-02', hour: 10, workMs: 30 * MIN },
    ]);
    expect(buildCodexTiming(sessions, { startDate: '2026-10-02', endDate: '2026-10-02' }).totals).toMatchObject({ workMs: 120 * MIN, elapsedMs: 120 * MIN, calendarDays: 1 });
    expect(buildCodexTiming(sessions, { endDate: '2026-10-03' }).totals.calendarDays).toBe(3);
  });

  it('uses selected project activity for ALL calendar denominator and explicit empty ranges retain their days', () => {
    const sessions = [session('early', [interval('early', 0, 1)]), session('late', [{ ...interval('late', 0, 1), startedAt: base + 2 * 86400000, completedAt: base + 2 * 86400000 + MIN }], undefined, '/repo/late')];
    expect(buildCodexTiming(sessions, { endDate: '2026-10-05', project: 'late' }).totals.calendarDays).toBe(3);
    expect(buildCodexTiming([], options).totals.calendarDays).toBe(3);
    expect(buildCodexTiming([], { endDate: '2026-10-05' }).totals.calendarDays).toBe(0);
  });

  it('handles repeated DST hours as actual elapsed time', () => {
    const turn = { ...interval('dst', 0, 1), startedAt: Date.parse('2026-11-01T05:30:00Z'), completedAt: Date.parse('2026-11-01T07:30:00Z') };
    const result = buildCodexTiming([session('main', [turn])], { startDate: '2026-11-01', endDate: '2026-11-01', timezone: 'America/New_York' });
    expect(result.hourly).toEqual([{ date: '2026-11-01', hour: 1, workMs: 90 * MIN }, { date: '2026-11-01', hour: 2, workMs: 30 * MIN }]);
    expect(result.totals.elapsedMs).toBe(120 * MIN);
  });
});

describe('average completed question/answer time', () => {
  it('averages individual main turns independently of conversation totals and overlap', () => {
    const result = buildCodexTiming([
      session('main', [interval('first', 0, 60), interval('second', 120, 140)]),
      session('parallel', [interval('parallel', 30, 90)]),
      session('child', [interval('delegated', 10, 50)], 'main'),
      session('other-child', [interval('other-delegated', 30, 50)], 'main'),
    ], options);
    expect(result.totals).toMatchObject({ completedTurnCount: 3, completedTurnElapsedMs: 140 * MIN, conversationCount: 2, conversationElapsedMs: 140 * MIN, elapsedMs: 110 * MIN });
    expect(result.totals.completedTurnElapsedMs / result.totals.completedTurnCount).toBeCloseTo(140 * MIN / 3);
    expect(result.totals.workMs).toBe(200 * MIN);
  });

  it('excludes aborted, ongoing, unknown-terminal and system turns without removing them from work totals', () => {
    const main = session('main', [interval('complete', 0, 10),
      { ...interval('aborted', 10, 20), terminalStatus: 'aborted' },
      { id: 'ongoing', model: 'model-a', startedAt: base + 20 * MIN },
      { ...interval('unknown-terminal', 30, 40), terminalStatus: undefined },
    ]);
    const system = { ...session('system', [interval('system-turn', 0, 10)]), timing: { kind: 'system' as const, turns: [interval('system-turn', 0, 10)] } };
    const result = buildCodexTiming([main, system], { ...options, includeSystem: true });
    expect(result.totals).toMatchObject({ completedTurnCount: 1, completedTurnElapsedMs: 10 * MIN, workMs: 40 * MIN });
  });

  it('selects by completion date and main project, retaining full cross-midnight duration', () => {
    const night = { ...interval('night', 0, 1), startedAt: Date.parse('2026-10-01T15:30:00Z'), completedAt: Date.parse('2026-10-01T16:30:00Z') };
    const result = buildCodexTiming([
      session('main', [night], undefined, '/repo/main-project'),
      session('child', [{ ...night, id: 'child' }], 'main', '/repo/child-project'),
      session('other', [{ ...night, id: 'other' }], undefined, '/repo/other-project'),
    ], { startDate: '2026-10-02', endDate: '2026-10-02', project: 'main-project' });
    expect(result.totals).toMatchObject({ completedTurnCount: 1, completedTurnElapsedMs: 60 * MIN, workMs: 30 * MIN, elapsedMs: 30 * MIN });
    expect(buildCodexTiming([session('main', [night])], { startDate: '2026-10-01', endDate: '2026-10-01' }).totals).toMatchObject({ completedTurnCount: 0, completedTurnElapsedMs: 0, workMs: 30 * MIN });
  });

  it('assigns midnight completions to the new day and counts legitimate zero-duration completions', () => {
    const end = Date.parse('2026-10-01T16:00:00Z');
    const main = session('main', [{ ...interval('midnight', 0, 1), startedAt: end - 60 * MIN, completedAt: end }, { ...interval('zero', 0, 0), startedAt: end, completedAt: end }]);
    const nextDay = buildCodexTiming([main], { startDate: '2026-10-02', endDate: '2026-10-02' });
    expect(nextDay.totals).toMatchObject({ completedTurnCount: 2, completedTurnElapsedMs: 60 * MIN, workMs: 0 });
    expect(nextDay.availableProjects).toEqual(['demo']);
    expect(nextDay.daily).toEqual([{
      date: '2026-10-02', workMs: 0, elapsedMs: 0, models: {},
      conversationCount: 0, conversationElapsedMs: 0, completedTurnCount: 2, completedTurnElapsedMs: 60 * MIN,
    }]);
    expect(buildCodexTiming([main], { startDate: '2026-10-01', endDate: '2026-10-01' }).totals.completedTurnCount).toBe(0);
  });

  it('deduplicates inherited copies before choosing the main owner and applying project filters', () => {
    const turn = interval('original', 0, 20);
    const original = session('original', [turn], undefined, '/repo/original');
    const fork = session('fork', [{ ...turn, completedAt: base + 100 * MIN, terminalStatus: 'aborted', inherited: true, owner: { id: 'original', kind: 'main', project: 'original' } }, interval('new-question', 20, 30)], undefined, '/repo/fork');
    for (const sessions of [[original, fork], [fork, original, fork]]) {
      expect(buildCodexTiming(sessions, { ...options, project: 'original' }).totals).toMatchObject({ completedTurnCount: 1, completedTurnElapsedMs: 20 * MIN });
      expect(buildCodexTiming(sessions, { ...options, project: 'fork' }).totals).toMatchObject({ completedTurnCount: 1, completedTurnElapsedMs: 10 * MIN });
    }
  });

  it('validates required finite nonnegative turn totals in the API response schema', () => {
    const response = buildCodexTiming([], options);
    expect(TimingResponseSchema.parse(response)).toEqual(response);
    for (const invalid of [{ completedTurnCount: -1 }, { completedTurnCount: 1.5 }, { completedTurnElapsedMs: Infinity }, { completedTurnElapsedMs: -1 }, { completedTurnCount: undefined }, { completedTurnElapsedMs: undefined }]) {
      expect(TimingResponseSchema.safeParse({ ...response, totals: { ...response.totals, ...invalid } }).success).toBe(false);
    }
  });
});

describe('daily conversation and question/answer averages', () => {
  it('unions each family per day while period totals keep a single conversation identity across days', () => {
    const dated = (id: string, start: string, end: string) => ({ ...interval(id, 0, 1), startedAt: Date.parse(start), completedAt: Date.parse(end) });
    const result = buildCodexTiming([
      session('main', [dated('main-turn', '2026-10-01T15:30:00Z', '2026-10-01T16:30:00Z')]),
      session('child', [dated('child-turn', '2026-10-01T15:45:00Z', '2026-10-01T17:00:00Z')], 'main'),
      session('other', [dated('other-turn', '2026-10-01T16:15:00Z', '2026-10-01T16:45:00Z')]),
    ], options);
    expect(result.daily).toEqual([
      { date: '2026-10-01', workMs: 45 * MIN, elapsedMs: 30 * MIN, models: { 'model-a': 45 * MIN }, conversationCount: 1, conversationElapsedMs: 30 * MIN, completedTurnCount: 0, completedTurnElapsedMs: 0 },
      { date: '2026-10-02', workMs: 120 * MIN, elapsedMs: 60 * MIN, models: { 'model-a': 120 * MIN }, conversationCount: 2, conversationElapsedMs: 90 * MIN, completedTurnCount: 2, completedTurnElapsedMs: 90 * MIN },
    ]);
    expect(result.totals).toMatchObject({ workMs: 165 * MIN, elapsedMs: 90 * MIN, conversationCount: 2, conversationElapsedMs: 120 * MIN, completedTurnCount: 2, completedTurnElapsedMs: 90 * MIN });
    expect(result.daily.reduce((sum, day) => sum + day.conversationCount, 0)).toBe(3);
    expect(result.daily.reduce((sum, day) => sum + day.completedTurnCount, 0)).toBe(result.totals.completedTurnCount);
    expect(result.daily.reduce((sum, day) => sum + day.completedTurnElapsedMs, 0)).toBe(result.totals.completedTurnElapsedMs);
  });

  it('applies main-family eligibility and project filters consistently to both daily averages', () => {
    const system = { ...session('system', [interval('system', 10, 20)], undefined, '/repo/system'), timing: { kind: 'system' as const, turns: [interval('system', 10, 20)] } };
    const sessions = [
      session('main', [interval('main', 0, 10)], undefined, '/repo/main'),
      session('child', [interval('child', 5, 15)], 'main', '/repo/child'),
      system, session('orphan', [interval('orphan', 0, 5)], 'missing', '/repo/orphan'),
    ];
    const included = buildCodexTiming(sessions, { ...options, includeSystem: true });
    expect(included.daily[0]).toMatchObject({ workMs: 35 * MIN, elapsedMs: 20 * MIN, conversationCount: 1, conversationElapsedMs: 15 * MIN, completedTurnCount: 1, completedTurnElapsedMs: 10 * MIN });
    expect(buildCodexTiming(sessions, { ...options, project: 'child' }).daily[0]).toMatchObject({ conversationCount: 1, conversationElapsedMs: 10 * MIN, completedTurnCount: 0, completedTurnElapsedMs: 0 });
    expect(buildCodexTiming(sessions, { ...options, project: 'main' }).daily[0]).toMatchObject({ conversationCount: 1, conversationElapsedMs: 10 * MIN, completedTurnCount: 1, completedTurnElapsedMs: 10 * MIN });
    for (const project of ['system', 'orphan']) {
      expect(buildCodexTiming(sessions, { ...options, includeSystem: true, project }).daily[0]).toMatchObject({ conversationCount: 0, conversationElapsedMs: 0, completedTurnCount: 0, completedTurnElapsedMs: 0 });
    }
  });

  it('keeps interrupted activity in daily conversation time but out of completed-answer averages', () => {
    const result = buildCodexTiming([session('main', [{ ...interval('abort', 0, 10), terminalStatus: 'aborted' }, interval('complete', 10, 20)])], options);
    expect(result.daily[0]).toMatchObject({ conversationCount: 1, conversationElapsedMs: 20 * MIN, completedTurnCount: 1, completedTurnElapsedMs: 10 * MIN });
  });

  it('requires valid daily average numerators and denominators in the API schema', () => {
    const response = buildCodexTiming([session('main', [interval('complete', 0, 10)])], options);
    expect(TimingResponseSchema.parse(response)).toEqual(response);
    for (const key of ['conversationCount', 'conversationElapsedMs', 'completedTurnCount', 'completedTurnElapsedMs']) {
      for (const value of [undefined, -1, Infinity]) {
        expect(TimingResponseSchema.safeParse({ ...response, daily: [{ ...response.daily[0], [key]: value }] }).success).toBe(false);
      }
    }
  });
});
