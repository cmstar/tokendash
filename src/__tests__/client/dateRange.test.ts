import { afterEach, describe, expect, it, vi } from 'vitest';
import { customTimeRangeError, dateRangeError, filterByTime, localDateKey, recentDateRange, recentDaysError } from '../../shared/dateRange.js';

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
    // This assertion needs only the wall clock; leave Vitest's timeout clock
    // untouched, including on the minimum supported Node 20.10 runtime.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 29, 0, 30));
    expect(localDateKey()).toBe('2026-07-29');
    expect(filterByTime([{ date: '2026-07-28' }, { date: '2026-07-29' }], 'today')).toEqual([{ date: '2026-07-29' }]);
  });
});

describe('recent calendar days', () => {
  it.each([['2d', 2], ['3d', 3], ['7d', 7], ['30d', 30], ['60d', 60]] as const)('matches %s to a custom day count at midnight and late in the day', (range, days) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    for (const hour of [0, 23]) {
      vi.setSystemTime(new Date(2026, 9, 27, hour, 30));
      const entries = Array.from({ length: 65 }, (_, i) => ({ date: localDateKey(new Date(2026, 9, 28 - i)) }));
      const hours = entries.map(entry => ({ startTime: `${entry.date}T00:00:00` }));
      const custom = { ...recentDateRange(days), days };
      expect(filterByTime(entries, range)).toEqual(entries.slice(1, days + 1));
      expect(filterByTime(entries, 'recent', custom)).toEqual(filterByTime(entries, range));
      expect(filterByTime(hours, range)).toEqual(hours.slice(1, days + 1));
    }
  });

  it('handles one day, leap days, year boundaries and moving forward on the next day', () => {
    expect(recentDateRange(1, '2026-10-27')).toEqual({ startDate: '2026-10-27', endDate: '2026-10-27' });
    expect(recentDateRange(2, '2024-03-01').startDate).toBe('2024-02-29');
    expect(recentDateRange(3, '2026-01-02').startDate).toBe('2025-12-31');
    expect(recentDateRange(14, '2026-10-27')).toEqual({ startDate: '2026-10-14', endDate: '2026-10-27' });
    expect(recentDateRange(14, '2026-10-28')).toEqual({ startDate: '2026-10-15', endDate: '2026-10-28' });
  });

  it('uses calendar arithmetic across daylight saving changes', () => {
    vi.stubEnv('TZ', 'America/New_York');
    try {
      expect(recentDateRange(3, '2026-03-09').startDate).toBe('2026-03-07');
      expect(recentDateRange(3, '2026-11-02').startDate).toBe('2026-10-31');
    } finally { vi.unstubAllEnvs(); }
  });

  it('rejects missing, fractional, nonpositive and unrepresentable day counts without restricting valid manual choices', () => {
    for (const days of [undefined, NaN, Infinity, 0, -1, 1.5, Number.MAX_SAFE_INTEGER]) expect(recentDaysError(days)).toBeDefined();
    for (const days of [1, 5, 14, 365, 10000]) expect(recentDaysError(days)).toBeUndefined();
    expect(customTimeRangeError({ mode: 'recent', days: 14, startDate: '', endDate: '' })).toBeUndefined();
    expect(customTimeRangeError({ startDate: '2020-01-01', endDate: '2020-01-02' })).toBeUndefined();
  });
});
