import type { BlockEntry, BlocksResponse } from '../shared/types.js';

export interface TimeBucket {
  start: Date;
  minutes: number;
  tokens: number;
  isPeak: boolean;
}

export type HourlyRange = '1d' | '3h' | '15m';

export const HOUR_RANGES: HourlyRange[] = ['1d', '3h', '15m'];

/** Trailing window kept in the shared 5-minute base, matching the macOS build. */
const BASE_WINDOW_HOURS = 48;

const REALTIME_INTERVAL_MS = 60_000;

export function rangeShortLabel(range: HourlyRange): string {
  if (range === '1d') return '1D';
  if (range === '3h') return '3H';
  return '15M';
}

export function rangeLabel(range: HourlyRange): string {
  if (range === '1d') return 'Today';
  if (range === '3h') return 'Last 3 Hours';
  return 'Last 15 Minutes';
}

export function rangeBucketMinutes(range: HourlyRange): number {
  if (range === '1d') return 60;
  if (range === '3h') return 15;
  return 1;
}

/** Floors a local wall-clock time onto the minute grid the daemon buckets use. */
export function align(date: Date, minutes: number): Date {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const minuteOfDay = date.getHours() * 60 + date.getMinutes();
  const alignedMinute = minuteOfDay - (minuteOfDay % minutes);
  return new Date(dayStart.getTime() + alignedMinute * 60_000);
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function startOfHour(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours());
}

/** The naive local timestamps the daemon emits ("2026-10-17T13:05:00") parse as local time. */
export function parseBlockStart(block: BlockEntry): Date | null {
  const value = new Date(block.startTime);
  return Number.isNaN(value.getTime()) ? null : value;
}

function skeletonBuckets(
  from: Date,
  to: Date,
  minutes: number,
  totals: Map<number, number>,
): TimeBucket[] {
  let maxTokens = 0;
  for (const tokens of totals.values()) maxTokens = Math.max(maxTokens, tokens);

  const buckets: TimeBucket[] = [];
  const step = minutes * 60_000;
  for (let cursor = from.getTime(); cursor < to.getTime(); cursor += step) {
    const tokens = totals.get(cursor) ?? 0;
    buckets.push({ start: new Date(cursor), minutes, tokens, isPeak: tokens > 0 && tokens === maxTokens });
  }
  return buckets;
}

export interface Aggregation {
  buckets: TimeBucket[];
  /** false when the daemon answered hour-aligned only (granularity ignored). */
  granularityMatched: boolean;
}

export function aggregate(
  responses: BlocksResponse[],
  now: Date,
  bucketMinutes = 5,
  window?: { start: Date; end: Date },
): Aggregation {
  const alignedNow = align(now, bucketMinutes);
  const windowStart =
    window?.start ?? align(new Date(alignedNow.getTime() - BASE_WINDOW_HOURS * 3600_000), bucketMinutes);
  const windowEnd = window?.end ?? new Date(alignedNow.getTime() + bucketMinutes * 60_000);

  const totals = new Map<number, number>();
  let sawSubHourBucket = false;

  for (const response of responses) {
    for (const block of response.blocks) {
      const start = parseBlockStart(block);
      if (!start) continue;
      if (start.getTime() < windowStart.getTime() || start.getTime() > alignedNow.getTime()) continue;
      const bucketStart = align(start, bucketMinutes);
      totals.set(bucketStart.getTime(), (totals.get(bucketStart.getTime()) ?? 0) + block.totalTokens);
      if (start.getMinutes() % 60 !== 0) sawSubHourBucket = true;
    }
  }

  const buckets = skeletonBuckets(windowStart, windowEnd, bucketMinutes, totals);
  const matched = sawSubHourBucket || buckets.every((bucket) => bucket.tokens === 0);
  return { buckets, granularityMatched: matched };
}

/** Rolling 15-minute window ending on the in-progress minute. */
export function realtimeWindow(now: Date): { start: Date; end: Date } {
  const end = new Date(align(now, 1).getTime() + 60_000);
  return { start: new Date(end.getTime() - 16 * 60_000), end };
}

/** Today-shaped hour buckets from a legacy (pre-1.9.0) hour-aligned daemon. */
export function legacyHourBuckets(responses: BlocksResponse[], now: Date): TimeBucket[] {
  const dayStart = startOfDay(now);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000);

  const totals = new Map<number, number>();
  for (const response of responses) {
    for (const block of response.blocks) {
      const start = parseBlockStart(block);
      if (!start) continue;
      if (start.getTime() < dayStart.getTime() || start.getTime() >= dayEnd.getTime()) continue;
      const bucketStart = align(start, 60);
      totals.set(bucketStart.getTime(), (totals.get(bucketStart.getTime()) ?? 0) + block.totalTokens);
    }
  }
  return skeletonBuckets(dayStart, dayEnd, 60, totals);
}

export function computeBuckets(responses: BlocksResponse[], now: Date): Aggregation {
  const result = aggregate(responses, now);
  if (!result.granularityMatched) {
    return { buckets: legacyHourBuckets(responses, now), granularityMatched: false };
  }
  return result;
}

/** Derives any chart range from the shared 5-minute base without a refetch. */
export function reaggregate(base: TimeBucket[], range: HourlyRange, now: Date): TimeBucket[] {
  const minutes = rangeBucketMinutes(range);

  let windowStart: Date;
  let windowEnd: Date;
  if (range === '1d') {
    windowStart = startOfDay(now);
    windowEnd = new Date(windowStart.getTime() + 24 * 3600_000);
  } else {
    // One bucket more than a window-width fit keeps the oldest bucket's usage.
    const windowMs = range === '3h' ? 3 * 3600_000 : 15 * 60_000;
    windowStart = align(new Date(now.getTime() - windowMs), minutes);
    windowEnd = new Date(align(now, minutes).getTime() + minutes * 60_000);
  }

  const totals = new Map<number, number>();
  for (const bucket of base) {
    const startMs = bucket.start.getTime();
    if (startMs < windowStart.getTime() || startMs >= windowEnd.getTime()) continue;
    const bucketStart = align(bucket.start, minutes);
    totals.set(bucketStart.getTime(), (totals.get(bucketStart.getTime()) ?? 0) + bucket.tokens);
  }
  return skeletonBuckets(windowStart, windowEnd, minutes, totals);
}

export const REALTIME_REFRESH_MS = REALTIME_INTERVAL_MS;