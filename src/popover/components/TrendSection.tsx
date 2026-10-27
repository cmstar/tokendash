import { useState } from 'react';

import { formatTokens, shortDate, weekdayShort } from '../format.js';
import type { TrendPoint } from '../types.js';

interface TrendSectionProps {
  trend: TrendPoint[];
}

export function TrendSection({ trend }: TrendSectionProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  const weekTokens = trend.reduce((total, point) => total + point.tokens, 0);
  const activeDays = Math.max(trend.filter((point) => point.tokens > 0).length, 1);
  const dailyAvg = Math.floor(weekTokens / activeDays);
  const peak = Math.max(...trend.map((point) => point.tokens), 1);
  const hoveredPoint = trend.find((point) => point.date === hovered) ?? null;

  return (
    <div className="section">
      <div className="section-head">
        <span className="section-title">7-Day Tokens</span>
        <span className="bar-pct mono-num" style={{ minWidth: 0, fontSize: 10, color: 'var(--secondary)' }}>
          {formatTokens(weekTokens)} wk · {formatTokens(dailyAvg)}/day
        </span>
      </div>

      {trend.every((point) => point.tokens === 0) ? (
        <div className="empty">No history yet.</div>
      ) : (
        <div className="trend" style={{ height: 54, position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 44, paddingTop: 8 }}>
            {trend.map((point) => {
              const isToday = point.date === trend[trend.length - 1]?.date;
              const height = point.tokens > 0 ? Math.max(2, (point.tokens / peak) * 36) : 2;
              return (
                <div
                  key={point.date}
                  style={{ flex: 1, display: 'flex', alignItems: 'flex-end', height: '100%', cursor: 'default' }}
                  onMouseEnter={() => setHovered(point.date)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <div
                    style={{
                      width: '100%',
                      height,
                      borderRadius: 2,
                      background: isToday
                        ? 'var(--accent)'
                        : 'color-mix(in srgb, var(--accent) 30%, transparent)',
                    }}
                  />
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {trend.map((point) => (
              <span
                key={point.date}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  fontSize: 9,
                  color: 'var(--tertiary)',
                  whiteSpace: 'nowrap',
                }}
              >
                {weekdayShort(point.date)}
              </span>
            ))}
          </div>
          {hoveredPoint ? (
            <div
              className="chart-tooltip"
              style={{
                top: 0,
                left: `${((trend.findIndex((point) => point.date === hoveredPoint.date) + 0.5) / trend.length) * 100}%`,
              }}
            >
              <span className="tooltip-meta">{shortDate(hoveredPoint.date)}</span>
              <span className="tooltip-value mono-num">{formatTokens(hoveredPoint.tokens)} tokens</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}