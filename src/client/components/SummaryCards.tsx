import type { DailyEntry, Totals } from '../../shared/types.js';
import { formatTokens } from '../utils/formatters.js';
import { useCurrency } from '../hooks/useCurrency.js';

interface SummaryCardsProps {
  daily: DailyEntry[];
  totals: Totals;
}

export function SummaryCards({ daily, totals }: SummaryCardsProps) {
  const { formatCost } = useCurrency();
  const activeDays = daily.filter((entry) => entry.totalTokens > 0).length;
  const avgDailyCost = activeDays > 0 ? totals.totalCost / activeDays : 0;

  const cards = [
    {
      label: 'Total Tokens',
      value: formatTokens(totals.totalTokens),
      color: '#3b82f6'
    },
    {
      label: 'Total Cost',
      value: formatCost(totals.totalCost),
      color: '#10b981'
    },
    {
      label: 'Avg Daily Cost',
      value: formatCost(avgDailyCost),
      color: '#8b5cf6'
    },
    {
      label: 'Active Days',
      value: activeDays.toString(),
      color: '#f59e0b'
    }
  ];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: '16px',
      marginBottom: '24px'
    }}>
      {cards.map((card) => (
        <div
          key={card.label}
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            padding: '16px',
            boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
            transition: 'box-shadow 0.2s'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = '0 1px 3px 0 rgba(0, 0, 0, 0.1)';
          }}
        >
          <div style={{
            fontSize: '13px',
            fontWeight: '500',
            color: '#6b7280',
            marginBottom: '8px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }}>
            {card.label}
          </div>
          <div style={{
            fontSize: '28px',
            fontWeight: '700',
            color: card.color,
            lineHeight: '1'
          }}>
            {card.value}
          </div>
        </div>
      ))}
    </div>
  );
}
