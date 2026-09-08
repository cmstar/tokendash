import { afterEach, describe, expect, it, vi } from 'vitest';
import { dateRangeError, filterByTime, localDateKey } from '../../shared/dateRange.js';

afterEach(() => vi.useRealTimers());

describe('custom date ranges', () => {
  it('includes both calendar dates and the final millisecond of the end day', () => {
    const entries = ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30'].map(date => ({ date }));
    const range = { startDate: '2026-07-28', endDate: '2026-07-29' };
    expect(filterByTime(entries, 'custom', range)).toEqual(entries.slice(1, 3));
    const blocks = [
      { startTime: new Date(2026, 6, 28, 0).toISOString() },
      { startTime: new Date(2026, 6, 29, 23, 59, 59, 999).toISOString() },
      { startTime: new Date(2026, 6, 30, 0).toISOString() },
    ];
    expect(filterByTime(blocks, 'custom', range)).toEqual(blocks.slice(0, 2));
  });

  it('allows one day, returns no data for an empty interval, and preserves all', () => {
    const entries = [{ date: '2026-07-28' }, { date: '2026-07-29' }];
    expect(filterByTime(entries, 'custom', { startDate: '2026-07-28', endDate: '2026-07-28' })).toEqual([entries[0]]);
    expect(filterByTime(entries, 'custom', { startDate: '2026-06-01', endDate: '2026-06-02' })).toEqual([]);
    expect(filterByTime(entries, 'all')).toBe(entries);
  });

  it('validates missing, impossible, future and reversed dates, allowing today and leap day', () => {
    const today = '2026-07-29';
    for (const range of [
      { startDate: '', endDate: today },
      { startDate: '2026-02-30', endDate: today },
      { startDate: today, endDate: '2026-07-30' },
      { startDate: today, endDate: '2026-07-28' },
    ]) expect(dateRangeError(range, today)).toBeDefined();
    expect(dateRangeError({ startDate: today, endDate: today }, today)).toBeUndefined();
    expect(dateRangeError({ startDate: '2024-02-29', endDate: today }, today)).toBeUndefined();
  });

  it('treats date-only data as local calendar dates in Today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 29, 0, 30));
    expect(localDateKey()).toBe('2026-07-29');
    expect(filterByTime([{ date: '2026-07-28' }, { date: '2026-07-29' }], 'today')).toEqual([{ date: '2026-07-29' }]);
  });
});
