import { useState } from 'react';

import {
  align,
  HOUR_RANGES,
  reaggregate,
  rangeBucketMinutes,
  rangeShortLabel,
  startOfDay,
  startOfHour,
  type HourlyRange,
  type TimeBucket,
} from '../aggregate.js';
import { formatTokens } from '../format.js';

const WIDTH = 340;
const HEIGHT = 110;
const GUTTER = 30;
const PLOT_WIDTH = WIDTH - GUTTER;

interface ActivityChartProps {
  base: TimeBucket[];
  realtime: TimeBucket[];
  range: HourlyRange;
  onRangeChange: (range: HourlyRange) => void;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function hoverLabel(bucket: TimeBucket, range: HourlyRange): string {
  if (range === '1d') return `${pad(bucket.start.getHours())}:00`;
  return `${pad(bucket.start.getHours())}:${pad(bucket.start.getMinutes())}`;
}

/** Catmull-Rom through the points converted to cubic Béziers, matching the SwiftUI chart smoothing. */
function smoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index];
    const current = points[index];
    const next = points[index + 1];
    const after = points[index + 2] ?? next;
    const control1 = { x: current.x + (next.x - previous.x) / 6, y: current.y + (next.y - previous.y) / 6 };
    const control2 = { x: next.x - (after.x - current.x) / 6, y: next.y - (after.y - current.y) / 6 };
    path += ` C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${next.x} ${next.y}`;
  }
  return path;
}

export function ActivityChart({ base, realtime, range, onRangeChange }: ActivityChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const now = new Date();

  // The realtime tab needs live 1-minute buckets; without them it falls back to
  // the Today view, and a legacy daemon only serves hour-aligned buckets.
  const effectiveRange: HourlyRange =
    range === '15m' && realtime[0]?.minutes === 1
      ? '15m'
      : range !== '1d' && base[0]?.minutes === 60
        ? '1d'
        : range;

  const buckets = (() => {
    if (effectiveRange === '15m') return realtime;
    if (base[0]?.minutes === 60) {
      const currentHour = startOfHour(now);
      return base.filter((bucket) => bucket.start.getTime() <= currentHour.getTime());
    }
    const derived = reaggregate(base, effectiveRange, now);
    if (effectiveRange !== '1d') return derived;
    const currentHour = startOfHour(now);
    return derived.filter((bucket) => bucket.start.getTime() <= currentHour.getTime());
  })();

  const upperBound = Math.max(1, Math.ceil(Math.max(...buckets.map((bucket) => bucket.tokens), 0) * 1.15));
  const currentBucketStart = align(now, rangeBucketMinutes(effectiveRange)).getTime();

  const domain = (() => {
    if (effectiveRange === '1d') {
      const start = startOfDay(now);
      return { min: start.getTime(), max: start.getTime() + 24 * 3600_000 };
    }
    const minutes = rangeBucketMinutes(effectiveRange);
    const windowMs = effectiveRange === '3h' ? 3 * 3600_000 : 15 * 60_000;
    const min = align(new Date(now.getTime() - windowMs), minutes).getTime();
    const max = align(now, minutes).getTime() + minutes * 60_000;
    return { min, max };
  })();

  const xPos = (time: number) => GUTTER + ((time - domain.min) / (domain.max - domain.min)) * PLOT_WIDTH;
  const yPos = (tokens: number) => HEIGHT - 6 - (tokens / upperBound) * (HEIGHT - 16);

  const points = buckets.map((bucket) => ({ x: xPos(bucket.start.getTime()), y: yPos(bucket.tokens) }));
  const linePath = smoothPath(points);
  const areaPath =
    points.length > 0
      ? `${linePath} L ${points[points.length - 1].x} ${HEIGHT - 6} L ${points[0].x} ${HEIGHT - 6} Z`
      : '';

  const axisValues = (() => {
    if (effectiveRange === '1d') {
      const start = startOfDay(now);
      return [0, 3, 6, 9, 12, 15, 18, 21].map((hour) => start.getTime() + hour * 3600_000);
    }
    const step = effectiveRange === '3h' ? 3600_000 : 5 * 60_000;
    const values: number[] = [];
    for (let cursor = domain.min; cursor <= domain.max; cursor += step) values.push(cursor);
    return values;
  })();

  const gridValues = [0, Math.round(upperBound / 2), upperBound];
  const hoveredBucket = hovered === null ? null : buckets.find((bucket) => bucket.start.getTime() === hovered) ?? null;
  const empty = effectiveRange === '1d' && base.every((bucket) => bucket.tokens === 0);

  function handleMove(event: React.MouseEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * WIDTH;
    if (x < GUTTER) {
      setHovered(null);
      return;
    }
    const time = domain.min + ((x - GUTTER) / PLOT_WIDTH) * (domain.max - domain.min);
    const aligned = align(new Date(time), rangeBucketMinutes(effectiveRange)).getTime();
    setHovered(buckets.some((bucket) => bucket.start.getTime() === aligned) ? aligned : null);
  }

  return (
    <div className="section">
      <div className="section-head">
        <span className="section-title">Activity</span>
        <div className="segmented">
          {HOUR_RANGES.map((option) => (
            <button
              key={option}
              type="button"
              className={range === option ? 'active' : ''}
              onClick={() => onRangeChange(option)}
            >
              {rangeShortLabel(option)}
            </button>
          ))}
        </div>
      </div>

      {empty ? (
        <div className="empty">
          <div style={{ fontWeight: 600, color: 'color-mix(in srgb, var(--fg) 50%, transparent)' }}>No usage yet</div>
          <div style={{ fontSize: 10, marginTop: 6 }}>Start a session to see your hourly breakdown.</div>
        </div>
      ) : (
        <div className="chart">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="none"
            onMouseMove={handleMove}
            onMouseLeave={() => setHovered(null)}
          >
            <defs>
              <linearGradient id="activity-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
              </linearGradient>
            </defs>

            {gridValues.map((value) => (
              <g key={value}>
                <line
                  x1={GUTTER}
                  x2={WIDTH}
                  y1={yPos(value)}
                  y2={yPos(value)}
                  stroke="color-mix(in srgb, var(--fg) 5%, transparent)"
                  strokeWidth="0.5"
                />
                <text x={GUTTER - 6} y={yPos(value) + 3} textAnchor="end" fontSize="9" fill="var(--tertiary)">
                  {formatTokens(value)}
                </text>
              </g>
            ))}

            {areaPath ? <path d={areaPath} fill="url(#activity-fill)" /> : null}
            {linePath ? <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" /> : null}

            {axisValues.map((time) => {
              const isEdge = time === axisValues[axisValues.length - 1] || time === axisValues[0];
              const anchor = effectiveRange === '1d' ? 'middle' : isEdge ? (time === axisValues[0] ? 'start' : 'end') : 'middle';
              const color =
                time === currentBucketStart ? 'var(--accent)' : time > now.getTime() ? 'var(--future)' : 'var(--tertiary)';
              const label =
                effectiveRange === '1d'
                  ? String(new Date(time).getHours())
                  : `${pad(new Date(time).getHours())}:${pad(new Date(time).getMinutes())}`;
              return (
                <text
                  key={time}
                  x={xPos(time)}
                  y={HEIGHT - 1}
                  textAnchor={anchor}
                  fontSize="9"
                  fill={color}
                  fontWeight={time === currentBucketStart ? 600 : 500}
                >
                  {label}
                </text>
              );
            })}

            {points.map((point, index) =>
              buckets[index].start.getTime() === currentBucketStart ? (
                <g key={buckets[index].start.getTime()}>
                  <circle cx={point.x} cy={point.y} r="3.6" fill="var(--accent)" fillOpacity="0.12" />
                  <circle cx={point.x} cy={point.y} r="1.9" fill="var(--accent)" />
                </g>
              ) : null,
            )}

            {hoveredBucket
              ? (() => {
                  const x = xPos(hoveredBucket.start.getTime());
                  const y = yPos(hoveredBucket.tokens);
                  return (
                    <g>
                      <line x1={x} x2={x} y1={6} y2={HEIGHT - 6} stroke="var(--fg)" strokeOpacity="0.25" strokeWidth="1" strokeDasharray="2 3" />
                      <circle cx={x} cy={y} r="2.3" fill="var(--accent)" />
                    </g>
                  );
                })()
              : null}
          </svg>

          {hoveredBucket ? (
            <div
              className="chart-tooltip"
              style={{ left: `${(xPos(hoveredBucket.start.getTime()) / WIDTH) * 100}%` }}
            >
              <span className="tooltip-meta">{hoverLabel(hoveredBucket, effectiveRange)}</span>
              <span className="tooltip-value mono-num">{formatTokens(hoveredBucket.tokens)} tokens</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}