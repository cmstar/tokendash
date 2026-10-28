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
      dailyWorkMs: 4 * hour, dailyElapsedMs: 4 * hour / 3, conversationMs: 3 * hour, turnMs: 7 * hour / 4,
    });
    expect(timingAverages({ workMs: 0, elapsedMs: 0, calendarDays: 0, conversationCount: 0, conversationElapsedMs: 0, completedTurnCount: 0, completedTurnElapsedMs: 0 })).toEqual({ dailyWorkMs: 0, dailyElapsedMs: 0, conversationMs: null, turnMs: null });
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
