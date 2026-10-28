import type { Page } from '@playwright/test';
import type { TimingResponse } from '../src/shared/types.js';

export const TIMING_PROJECT = '/Users/test/codex-project';
export const TIMING_ONLY_PROJECT = '/Users/test/timing-only-project';
const MINUTE = 60_000;
const DAY = 86_400_000;

// Keep browser and fixture dates aligned on every platform, including UTC CI.
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

export function timingDate(daysAgo = 0): string {
  return new Date(Date.parse(`${today}T12:00:00Z`) - daysAgo * DAY).toISOString().slice(0, 10);
}

interface Interval {
  turnId: string;
  role: 'main' | 'child' | 'system';
  outcome: 'completed' | 'aborted';
  date: string;
  project: string;
  conversation: string;
  model: string;
  start: number;
  end: number;
}

// Two overlapping conversations and a parallel child agent each day. Summing
// conversation elapsed time intentionally differs from global elapsed time.
// Today-a has two completed main turns, while yesterday-b has a completed and
// an aborted turn. Their boundaries preserve the existing work/elapsed totals.
const intervals: Interval[] = [
  { turnId: 'older-1', role: 'main', outcome: 'completed', date: timingDate(2), project: TIMING_PROJECT, conversation: 'older', model: 'o3', start: 480, end: 510 },
  { turnId: 'yesterday-a-1', role: 'main', outcome: 'completed', date: timingDate(1), project: TIMING_PROJECT, conversation: 'yesterday-a', model: 'o3', start: 540, end: 600 },
  { turnId: 'yesterday-a-child', role: 'child', outcome: 'completed', date: timingDate(1), project: TIMING_PROJECT, conversation: 'yesterday-a', model: 'o4-mini', start: 540, end: 570 },
  { turnId: 'yesterday-b-1', role: 'main', outcome: 'completed', date: timingDate(1), project: TIMING_ONLY_PROJECT, conversation: 'yesterday-b', model: 'o4-mini', start: 570, end: 630 },
  { turnId: 'yesterday-b-2', role: 'main', outcome: 'aborted', date: timingDate(1), project: TIMING_ONLY_PROJECT, conversation: 'yesterday-b', model: 'o4-mini', start: 630, end: 660 },
  { turnId: 'today-a-1', role: 'main', outcome: 'completed', date: timingDate(), project: TIMING_PROJECT, conversation: 'today-a', model: 'o3', start: 540, end: 570 },
  { turnId: 'today-a-2', role: 'main', outcome: 'completed', date: timingDate(), project: TIMING_PROJECT, conversation: 'today-a', model: 'o3', start: 570, end: 600 },
  { turnId: 'today-a-child', role: 'child', outcome: 'completed', date: timingDate(), project: TIMING_PROJECT, conversation: 'today-a', model: 'o4-mini', start: 555, end: 585 },
  { turnId: 'today-b-1', role: 'main', outcome: 'completed', date: timingDate(), project: TIMING_ONLY_PROJECT, conversation: 'today-b', model: 'o4-mini', start: 570, end: 630 },
  { turnId: 'system-1', role: 'system', outcome: 'completed', date: timingDate(), project: TIMING_PROJECT, conversation: 'system', model: 'codex-auto-review', start: 660, end: 690 },
];

function workMs(rows: Interval[]): number {
  return rows.reduce((total, row) => total + (row.end - row.start) * MINUTE, 0);
}

function elapsedMs(rows: Interval[]): number {
  const ranges = rows.map(row => ({
    start: Date.parse(`${row.date}T00:00:00Z`) + row.start * MINUTE,
    end: Date.parse(`${row.date}T00:00:00Z`) + row.end * MINUTE,
  })).sort((a, b) => a.start - b.start);
  let total = 0;
  let end = -Infinity;
  for (const range of ranges) {
    total += Math.max(0, range.end - Math.max(end, range.start));
    end = Math.max(end, range.end);
  }
  return total;
}

export function generateTimingResponse(url: URL, empty = false): TimingResponse {
  const startDate = url.searchParams.get('startDate') || timingDate(2);
  const endDate = url.searchParams.get('endDate') || timingDate();
  const project = url.searchParams.get('project');
  const selected = empty ? [] : intervals.filter(row => row.date >= startDate && row.date <= endDate
    && (!project || row.project === project)
    && (row.role !== 'system' || url.searchParams.get('includeSystem') === 'true'));
  // These fixture turns all finish on their start date. Filter full completed
  // main turns independently: child/system/aborted records are never answers.
  const completedTurns = empty ? [] : intervals.filter(row => row.role === 'main' && row.outcome === 'completed'
    && row.date >= startDate && row.date <= endDate && (!project || row.project === project));
  const calendarDays = Math.max(0, Math.round((Date.parse(endDate) - Date.parse(startDate)) / DAY) + 1);
  const conversationRows = selected.filter(row => row.role !== 'system');
  const conversations = [...new Set(conversationRows.map(row => row.conversation))];
  const dates = [...new Set(selected.map(row => row.date))].sort();
  return {
    timezone: 'Asia/Shanghai',
    totals: {
      workMs: workMs(selected),
      elapsedMs: elapsedMs(selected),
      calendarDays,
      conversationCount: conversations.length,
      conversationElapsedMs: conversations.reduce((sum, conversation) => sum + elapsedMs(conversationRows.filter(row => row.conversation === conversation)), 0),
      completedTurnCount: new Set(completedTurns.map(row => row.turnId)).size,
      completedTurnElapsedMs: workMs(completedTurns),
    },
    daily: dates.map(date => {
      const rows = selected.filter(row => row.date === date);
      const dailyConversationRows = conversationRows.filter(row => row.date === date);
      const dailyConversations = [...new Set(dailyConversationRows.map(row => row.conversation))];
      const dailyCompletedTurns = completedTurns.filter(row => row.date === date);
      const models: Record<string, number> = {};
      for (const row of rows) models[row.model] = (models[row.model] || 0) + workMs([row]);
      return {
        date, workMs: workMs(rows), elapsedMs: elapsedMs(rows), models,
        conversationCount: dailyConversations.length,
        conversationElapsedMs: dailyConversations.reduce((sum, conversation) => sum + elapsedMs(dailyConversationRows.filter(row => row.conversation === conversation)), 0),
        completedTurnCount: new Set(dailyCompletedTurns.map(row => row.turnId)).size,
        completedTurnElapsedMs: workMs(dailyCompletedTurns),
      };
    }),
    projects: [...new Set(selected.map(row => row.project))].map(project => {
      const rows = selected.filter(row => row.project === project);
      return { project, workMs: workMs(rows), elapsedMs: elapsedMs(rows) };
    }),
    hourly: dates.flatMap(date => Array.from({ length: 24 }, (_, hour) => ({
      date,
      hour,
      workMs: selected.filter(row => row.date === date).reduce((sum, row) =>
        sum + Math.max(0, Math.min(row.end, (hour + 1) * 60) - Math.max(row.start, hour * 60)) * MINUTE, 0),
    }))).filter(row => row.workMs > 0),
    quality: { incompleteTurns: empty ? 0 : 2, estimatedTurns: empty ? 0 : 1, unattributedTurns: 0 },
    availableProjects: [TIMING_PROJECT, TIMING_ONLY_PROJECT],
  };
}

export async function mockTimingRoute(page: Page, options: { empty?: boolean; error?: boolean } = {}): Promise<void> {
  await page.route('**/api/timing?*', async route => {
    const url = new URL(route.request().url());
    if (options.error) {
      await route.fulfill({ status: 500, json: { error: 'Timing fixture unavailable' } });
    } else {
      await route.fulfill({ json: generateTimingResponse(url, options.empty) });
    }
  });
}
