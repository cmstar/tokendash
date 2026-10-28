import { describe, expect, it } from 'vitest';
import { formatDuration, timingAverages, timingMeanDurations, timingDisplayDays, timingHeatmap, timingModelSeries } from '../../client/utils/timing.js';

const hour = 3_600_000;

describe('timing display', () => {
  it('keeps cumulative work above 24 hours and shows small non-zero durations', () => {
    expect(formatDuration(30 * hour + 7 * 60_000)).toBe('30h 7m');
    expect(formatDuration(65_999)).toBe('1m 5s');
    expect(formatDuration(500)).toBe('<1s');
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(Number.NaN)).toBe('0s');
  });

  it('uses calendar days and per-conversation elapsed totals as distinct denominators', () => {
    expect(timingAverages({ workMs: 12 * hour, elapsedMs: 4 * hour, calendarDays: 3, conversationCount: 2, conversationElapsedMs: 6 * hour, completedTurnCount: 4, completedTurnElapsedMs: 7 * hour })).toEqual({
      averageDays: 3, excludedDays: 0, dailyWorkMs: 4 * hour, dailyElapsedMs: 4 * hour / 3, conversationMs: 3 * hour, turnMs: 7 * hour / 4,
    });
    expect(timingAverages({ workMs: 0, elapsedMs: 0, calendarDays: 0, conversationCount: 0, conversationElapsedMs: 0, completedTurnCount: 0, completedTurnElapsedMs: 0 })).toEqual({ averageDays: 0, excludedDays: 0, dailyWorkMs: 0, dailyElapsedMs: 0, conversationMs: null, turnMs: null });
  });

  it('optionally excludes zero-usage dates while counting weekend work and preserving conversation and turn means', () => {
    const totals = { workMs: 6 * hour, elapsedMs: 4 * hour, calendarDays: 5, conversationCount: 3, conversationElapsedMs: 6 * hour, completedTurnCount: 2, completedTurnElapsedMs: 6 * hour };
    const daily = [
      { date: '2026-10-24', workMs: 6 * hour, elapsedMs: 3 * hour, models: {}, conversationCount: 2, conversationElapsedMs: 5 * hour, completedTurnCount: 1, completedTurnElapsedMs: 2 * hour },
      { date: '2026-10-25', workMs: 0, elapsedMs: hour, models: {}, conversationCount: 1, conversationElapsedMs: hour, completedTurnCount: 0, completedTurnElapsedMs: 0 },
      { date: '2026-10-26', workMs: 0, elapsedMs: 0, models: {}, conversationCount: 0, conversationElapsedMs: 0, completedTurnCount: 1, completedTurnElapsedMs: 4 * hour },
      { date: '2026-10-27', workMs: 0, elapsedMs: 0, models: {}, conversationCount: 0, conversationElapsedMs: 0, completedTurnCount: 0, completedTurnElapsedMs: 0 },
    ];
    const before = structuredClone({ totals, daily });
    // Oct 23 is absent; Oct 26 has only a midnight answer; Oct 27 is explicit zero.
    // Both positive dates are a weekend and must count, regardless of weekday.
    expect(timingAverages(totals, daily, true)).toEqual({ averageDays: 2, excludedDays: 3, dailyWorkMs: 3 * hour, dailyElapsedMs: 2 * hour, conversationMs: 2 * hour, turnMs: 3 * hour });
    expect(timingAverages(totals, daily)).toEqual({ averageDays: 5, excludedDays: 0, dailyWorkMs: 6 * hour / 5, dailyElapsedMs: 4 * hour / 5, conversationMs: 2 * hour, turnMs: 3 * hour });
    expect({ totals, daily }).toEqual(before);
  });

  it('uses zero for daily means when no dates have usage, even with completed-turn duration', () => {
    const daily = [{ date: '2026-10-28', workMs: 0, elapsedMs: 0, models: {}, conversationCount: 0, conversationElapsedMs: 0, completedTurnCount: 1, completedTurnElapsedMs: 3 * hour }];
    const totals = { ...daily[0], calendarDays: 7 };
    const averages = timingAverages(totals, daily, true);
    expect(averages).toEqual({ averageDays: 0, excludedDays: 7, dailyWorkMs: 0, dailyElapsedMs: 0, conversationMs: null, turnMs: 3 * hour });
    expect(formatDuration(averages.dailyWorkMs)).toBe('0s');
    expect(formatDuration(averages.dailyElapsedMs)).toBe('0s');
    expect(timingAverages({ ...totals, completedTurnCount: 0, completedTurnElapsedMs: 0 }, [], true).averageDays).toBe(0);
  });

  it('counts only dates present in the filtered response, even for ranges beyond the zero-fill limit', () => {
    const day = { date: '2026-10-28', workMs: hour, elapsedMs: hour, models: {}, conversationCount: 1, conversationElapsedMs: hour, completedTurnCount: 1, completedTurnElapsedMs: hour };
    expect(timingAverages({ ...day, calendarDays: 20_000 }, [day], true)).toMatchObject({ averageDays: 1, excludedDays: 19_999, dailyWorkMs: hour, dailyElapsedMs: hour });
  });

  it('keeps full completed-turn duration separate from clipped period work and partial conversations', () => {
    // A completed answer can belong to today while its question started yesterday.
    const averages = timingAverages({ workMs: hour, elapsedMs: hour, calendarDays: 1, conversationCount: 1, conversationElapsedMs: hour, completedTurnCount: 1, completedTurnElapsedMs: 3 * hour });
    expect(averages.conversationMs).toBe(hour);
    expect(averages.turnMs).toBe(3 * hour);
  });

  it('adds idle calendar dates across month and DST boundaries without shifting the reporting date', () => {
    const active = { date: '2026-03-08', workMs: hour, elapsedMs: hour, models: { codex: hour }, conversationCount: 1, conversationElapsedMs: hour, completedTurnCount: 2, completedTurnElapsedMs: 3 * hour };
    const result = timingDisplayDays([active], '2026-03-07', '2026-03-09');
    expect(result.sparse).toBe(false);
    expect(result.days.map(day => [day.date, day.workMs])).toEqual([
      ['2026-03-07', 0], ['2026-03-08', hour], ['2026-03-09', 0],
    ]);
    expect(timingMeanDurations(result.days[0])).toEqual({ conversationMs: null, turnMs: null });
    expect(timingMeanDurations(result.days[1])).toEqual({ conversationMs: hour, turnMs: 1.5 * hour });
    expect(timingDisplayDays([active], undefined, '2026-03-09').days).toHaveLength(2);
    expect(timingDisplayDays([], '2026-09-30', '2026-10-02').days.map(day => day.date)).toEqual(['2026-09-30', '2026-10-01', '2026-10-02']);
  });

  it('does not allocate an unbounded number of zero buckets for a huge custom range', () => {
    expect(timingDisplayDays([], '1900-01-01', '2026-10-28')).toEqual({ days: [], sparse: true });
  });

  it('sums repeated weekdays and concurrent work without capping heatmap cells to one hour', () => {
    const hourly = [
      { date: '2026-10-19', hour: 9, workMs: 2 * hour },
      { date: '2026-10-26', hour: 9, workMs: 3 * hour },
      { date: '2026-10-25', hour: 23, workMs: hour },
    ];
    const week = timingHeatmap(hourly);
    expect(week[0][9]).toBe(5 * hour);
    expect(week[6][23]).toBe(hour);
    expect(week.flat().reduce((sum, ms) => sum + ms, 0)).toBe(6 * hour);
    const today = timingHeatmap(hourly, '2026-10-26');
    expect(today).toHaveLength(1);
    expect(today[0][9]).toBe(3 * hour);
    expect(today[0][23]).toBe(0);
  });

  it('keeps all models in stacked totals and treats model names with dots as literal keys', () => {
    const models = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`gpt.6.${index}`, (index + 1) * hour]));
    const result = timingModelSeries([{ date: '2026-10-28', workMs: 36 * hour, elapsedMs: hour, models, conversationCount: 0, conversationElapsedMs: 0, completedTurnCount: 0, completedTurnElapsedMs: 0 }]);
    expect(result.series).toHaveLength(7);
    expect(result.series[0].name).toBe('gpt.6.7');
    expect(result.days[0].otherModels).toBe(3 * hour);
    expect(result.series.reduce((sum, model) => sum + Number(result.days[0][model.key]), 0)).toBe(36 * hour);
  });
});
