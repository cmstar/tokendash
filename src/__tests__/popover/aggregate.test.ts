import { describe, expect, it } from 'vitest';

import type { BlocksResponse } from '../../shared/types.js';
import { aggregate, computeBuckets, reaggregate, realtimeWindow } from '../../popover/aggregate.js';
import { formatCost, formatTokens, shortModelName } from '../../popover/format.js';
import { evaluateLowQuota } from '../../popover/usePopoverData.js';
import type { DesktopSettings } from '../../popover/types.js';

function blocks(entries: Array<{ startTime: string; totalTokens: number }>): BlocksResponse {
  return {
    blocks: entries.map((entry, index) => ({
      id: `b${index}`,
      startTime: entry.startTime,
      endTime: entry.startTime,
      actualEndTime: null,
      isActive: false,
      isGap: false,
      entries: 1,
      tokenCounts: {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
      totalTokens: entry.totalTokens,
    })),
  } as BlocksResponse;
}

const SETTINGS: DesktopSettings = {
  backgroundRefreshSecs: 3600,
  appearance: 'system',
  hourlyRange: '1d',
  launchAtLogin: false,
  lowQuotaNotifications: true,
  lowQuotaThresholdPercent: 80,
};

describe('popover aggregation', () => {
  it('skeletonises the trailing 48h window on the 5-minute grid', () => {
    const now = new Date(2026, 9, 17, 13, 7, 30);
    const result = aggregate([blocks([{ startTime: '2026-10-17T13:05:00', totalTokens: 120 }])], now);
    // 48h plus the in-progress bucket, inclusive of the closing edge.
    expect(result.buckets.length).toBe((48 * 60) / 5 + 1);
    expect(result.granularityMatched).toBe(true);
    const peak = result.buckets.filter((bucket) => bucket.tokens > 0);
    expect(peak).toHaveLength(1);
    expect(peak[0].tokens).toBe(120);
    expect(peak[0].start.getTime()).toBe(new Date(2026, 9, 17, 13, 5).getTime());
  });

  it('falls back to today hour buckets for a legacy hour-aligned daemon', () => {
    const now = new Date(2026, 9, 17, 13, 30);
    const result = computeBuckets([blocks([{ startTime: '2026-10-17T13:00:00', totalTokens: 900 }])], now);
    expect(result.granularityMatched).toBe(false);
    expect(result.buckets).toHaveLength(24);
    expect(result.buckets[13].tokens).toBe(900);
    expect(result.buckets[13].isPeak).toBe(true);
  });

  it('reaggregates the 5-minute base into every chart range', () => {
    const now = new Date(2026, 9, 17, 13, 30);
    const base = aggregate(
      [
        blocks([
          { startTime: '2026-10-17T13:00:00', totalTokens: 100 },
          { startTime: '2026-10-17T13:05:00', totalTokens: 50 },
        ]),
      ],
      now,
    ).buckets;

    const hourly = reaggregate(base, '1d', now);
    expect(hourly).toHaveLength(24);
    expect(hourly[13].tokens).toBe(150);

    const fifteen = reaggregate(base, '15m', now);
    expect(fifteen.every((bucket) => bucket.minutes === 1)).toBe(true);
    expect(fifteen.reduce((sum, bucket) => sum + bucket.tokens, 0)).toBe(0);
  });

  it('covers 16 minutes of 1-minute buckets in the realtime window', () => {
    const now = new Date(2026, 9, 17, 13, 30, 40);
    const window = realtimeWindow(now);
    const result = aggregate([blocks([{ startTime: '2026-10-17T13:30:00', totalTokens: 7 }])], now, 1, window);
    expect(result.buckets).toHaveLength(16);
    expect(result.buckets[15].tokens).toBe(7);
  });
});

describe('popover formatting', () => {
  it('matches the macOS badge thresholds', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1_234)).toBe('1.2K');
    expect(formatTokens(1_045_000)).toBe('1.0M');
    expect(formatTokens(999_999_999)).toBe('1B');
    expect(formatCost(0.049)).toBe('$0');
    expect(formatCost(4.5)).toBe('$4.50');
    expect(formatCost(45)).toBe('$45.0');
    expect(formatCost(1234)).toBe('$1234');
  });

  it('shortens Claude model names and leaves others alone', () => {
    expect(shortModelName('claude-sonnet-4-6')).toBe('Sonnet 4');
    expect(shortModelName('claude-opus-4-1')).toBe('Opus 4');
    expect(shortModelName('GLM-5.1')).toBe('GLM-5.1');
  });
});

describe('low quota notifications', () => {
  const snapshot = (remainingPercent: number, state = 'ok') => ({
    provider: 'glm' as const,
    displayName: 'GLM Coding Plan',
    fetchedAt: '2026-10-17T13:00:00Z',
    freshness: 'live' as const,
    windows: [
      {
        id: 'five_hour',
        label: '5-Hour Window',
        usedPercent: 100 - remainingPercent,
        remainingPercent,
        isUnlimited: false,
      },
    ],
    status: { state } as never,
  });

  it('fires once per window and resets when usage recovers', () => {
    const alerted = new Set<string>();
    const first = evaluateLowQuota([snapshot(15)], SETTINGS, alerted);
    expect(first).toHaveLength(1);
    expect(first[0].title).toBe('GLM Coding Plan quota low');
    expect(evaluateLowQuota([snapshot(15)], SETTINGS, alerted)).toHaveLength(0);
    expect(evaluateLowQuota([snapshot(90)], SETTINGS, alerted)).toHaveLength(0);
    expect(alerted.size).toBe(0);
    expect(evaluateLowQuota([snapshot(10)], SETTINGS, alerted)).toHaveLength(1);
  });

  it('stays silent when notifications are off or the provider is not ok', () => {
    const alerted = new Set<string>();
    expect(evaluateLowQuota([snapshot(10)], { ...SETTINGS, lowQuotaNotifications: false }, alerted)).toHaveLength(0);
    expect(evaluateLowQuota([snapshot(10, 'error')], SETTINGS, alerted)).toHaveLength(0);
    expect(alerted.size).toBe(0);
  });
});
