export type TimeRangeKey = 'today' | '2d' | '3d' | '7d' | '30d' | '60d' | 'all' | 'custom' | 'recent';

export interface CustomDateRange {
  startDate: string;
  endDate: string;
}

/** Optional fields keep existing saved date intervals compatible. */
export interface CustomTimeRange extends CustomDateRange {
  mode?: 'dates' | 'recent';
  days?: number;
}

export function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && localDateKey(new Date(`${value}T00:00:00`)) === value;
}

export function dateRangeError(range: CustomDateRange, today = localDateKey()): string | undefined {
  if (!isDate(range.startDate) || !isDate(range.endDate)) return 'Choose a valid start and end date.';
  if (range.endDate > today) return 'End date cannot be later than today.';
  if (range.startDate > range.endDate) return 'Start date cannot be later than end date.';
  return undefined;
}

/** Include today and the preceding N - 1 local calendar dates, including across DST. */
export function recentDateRange(days: number, today = localDateKey()): CustomDateRange {
  const start = new Date(`${today}T00:00:00`);
  start.setDate(start.getDate() - days + 1);
  return { startDate: localDateKey(start), endDate: today };
}

export function recentDaysError(days: number | undefined, today = localDateKey()): string | undefined {
  if (!Number.isSafeInteger(days) || (days ?? 0) < 1) return 'Enter a positive whole number of days.';
  if (!isDate(recentDateRange(days!, today).startDate)) return 'Number of days is too large.';
  return undefined;
}

export function customTimeRangeError(range: CustomTimeRange, today = localDateKey()): string | undefined {
  return range.mode === 'recent' ? recentDaysError(range.days, today) : dateRangeError(range, today);
}

export function timeRangeDates(range: TimeRangeKey, custom?: CustomTimeRange, today = localDateKey()): CustomDateRange | undefined {
  if (range === 'all') return undefined;
  if (range === 'custom') return custom;
  const days = range === 'recent' ? custom?.days : range === 'today' ? 1 : Number.parseInt(range, 10);
  return recentDaysError(days, today) ? undefined : recentDateRange(days!, today);
}

/** Date-only values are calendar dates; timestamps are interpreted in local time. */
export function isInCustomRange(value: string, range?: CustomDateRange): boolean {
  if (!range) return false;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : localDateKey(new Date(value));
  return date >= range.startDate && date <= range.endDate;
}

export function filterByTime<T extends { date?: string; startTime?: string }>(data: T[], range: TimeRangeKey, custom?: CustomTimeRange): T[] {
  if (range === 'all') return data;
  const dates = timeRangeDates(range, custom);
  return data.filter(item => isInCustomRange(item.date || item.startTime || '', dates));
}
