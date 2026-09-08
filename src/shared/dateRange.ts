export type TimeRangeKey = 'today' | '7d' | '30d' | '60d' | 'all' | 'custom';

export interface CustomDateRange {
  startDate: string;
  endDate: string;
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

/** Date-only values are calendar dates; timestamps are interpreted in local time. */
export function isInCustomRange(value: string, range?: CustomDateRange): boolean {
  if (!range) return false;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : localDateKey(new Date(value));
  return date >= range.startDate && date <= range.endDate;
}

export function filterByTime<T extends { date?: string; startTime?: string }>(data: T[], range: TimeRangeKey, custom?: CustomDateRange): T[] {
  if (range === 'all') return data;
  if (range === 'custom') return data.filter(item => isInCustomRange(item.date || item.startTime || '', custom));
  if (range === 'today') {
    const today = localDateKey();
    return data.filter(item => isInCustomRange(item.date || item.startTime || '', { startDate: today, endDate: today }));
  }
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (range === '7d' ? 7 : range === '60d' ? 60 : 30));
  return data.filter(item => new Date(item.date || item.startTime || '') >= cutoff);
}
