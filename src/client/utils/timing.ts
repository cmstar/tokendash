import type { TimingResponse } from '../../shared/types.js';

/** Hours deliberately never wrap into days: concurrent work can exceed 24h/day. */
export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '0s';
  if (milliseconds < 1_000) return '<1s';
  const seconds = Math.floor(milliseconds / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${seconds % 60 ? ` ${seconds % 60}s` : ''}`;
  const hours = Math.floor(minutes / 60);
  return `${hours.toLocaleString('en-US')}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;
}

export function timingMeanDurations(totals: Pick<TimingResponse['totals'], 'conversationCount' | 'conversationElapsedMs' | 'completedTurnCount' | 'completedTurnElapsedMs'>) {
  return {
    conversationMs: totals.conversationCount > 0 ? totals.conversationElapsedMs / totals.conversationCount : null,
    turnMs: totals.completedTurnCount > 0 ? totals.completedTurnElapsedMs / totals.completedTurnCount : null,
  };
}

export function timingAverages(totals: TimingResponse['totals']) {
  return {
    dailyWorkMs: totals.calendarDays > 0 ? totals.workMs / totals.calendarDays : 0,
    dailyElapsedMs: totals.calendarDays > 0 ? totals.elapsedMs / totals.calendarDays : 0,
    ...timingMeanDurations(totals),
  };
}

export function timingDisplayDays(daily: TimingResponse['daily'], startDate: string | undefined, endDate: string) {
  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  const first = startDate ?? sorted[0]?.date;
  if (!first) return { days: sorted, sparse: false };
  const start = Date.parse(`${first}T00:00:00Z`);
  const count = Math.floor((Date.parse(`${endDate}T00:00:00Z`) - start) / 86_400_000) + 1;
  // Arbitrary "Last X days" inputs must not allocate millions of empty buckets.
  // Long ranges still show every recorded day and keep the complete denominator.
  if (!Number.isFinite(count) || count < 1 || count > 3_660) return { days: sorted, sparse: true };
  const recorded = new Map(sorted.map(day => [day.date, day]));
  return {
    sparse: false,
    days: Array.from({ length: count }, (_, index) => {
      const date = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
      return recorded.get(date) ?? { date, workMs: 0, elapsedMs: 0, models: {}, conversationCount: 0, conversationElapsedMs: 0, completedTurnCount: 0, completedTurnElapsedMs: 0 };
    }),
  };
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Interpret date-only buckets in the reporting calendar, independent of browser timezone. */
export function timingHeatmap(hourly: TimingResponse['hourly'], onlyDate?: string) {
  const values = Array.from({ length: onlyDate ? 1 : 7 }, () => Array<number>(24).fill(0));
  for (const entry of hourly) {
    if (onlyDate && entry.date !== onlyDate) continue;
    if (!Number.isInteger(entry.hour) || entry.hour < 0 || entry.hour > 23) continue;
    const weekday = (new Date(`${entry.date}T00:00:00Z`).getUTCDay() + 6) % 7;
    const row = onlyDate ? 0 : weekday;
    if (!values[row]) continue;
    values[row][entry.hour] += entry.workMs;
  }
  return values;
}

export function timingModelSeries(daily: TimingResponse['daily']) {
  const totals = new Map<string, number>();
  for (const day of daily) for (const [model, ms] of Object.entries(day.models)) totals.set(model, (totals.get(model) ?? 0) + ms);
  const ranked = [...totals].sort((a, b) => b[1] - a[1]);
  const models = ranked.slice(0, 6).map(([name], index) => ({ name, key: `model${index}` }));
  const otherModels = ranked.slice(6).map(([name]) => name);
  const series = [...models, ...(otherModels.length ? [{ name: 'Other models', key: 'otherModels' }] : [])];
  return {
    series,
    days: daily.map(day => {
      const values: Record<string, string | number> = { date: day.date };
      for (const model of models) values[model.key] = day.models[model.name] ?? 0;
      if (otherModels.length) values.otherModels = otherModels.reduce((sum, name) => sum + (day.models[name] ?? 0), 0);
      return values;
    }),
  };
}
