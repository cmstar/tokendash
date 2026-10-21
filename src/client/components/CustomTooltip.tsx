import type { MetricMode } from '../../shared/types.js';
import { formatTokens } from '../utils/formatters.js';
import { useCurrency } from '../hooks/useCurrency.js';

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string; dataKey?: string }>;
  label?: string;
  mode: MetricMode;
}

export function CustomTooltip({ active, payload, label, mode }: CustomTooltipProps) {
  const { formatCost } = useCurrency();
  if (!active || !payload || !label) {
    return null;
  }

  return (
    <div style={{
      backgroundColor: 'rgba(255, 255, 255, 0.95)',
      border: '1px solid #e5e7eb',
      borderRadius: '6px',
      padding: '8px 12px',
      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
      fontSize: '14px',
      minWidth: '150px'
    }}>
      <div style={{
        fontWeight: '600',
        marginBottom: '6px',
        paddingBottom: '4px',
        borderBottom: '1px solid #e5e7eb',
        color: '#111827'
      }}>
        {label}
      </div>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          {payload.map((entry, index) => (
            <tr key={index}>
              <td style={{
                padding: '2px 8px 2px 0',
                textAlign: 'left',
                color: '#6b7280',
                fontSize: '13px'
              }}>
                <span style={{
                  display: 'inline-block',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: entry.color,
                  marginRight: '6px'
                }} />
                {entry.name}:
              </td>
              <td style={{
                padding: '2px 0',
                textAlign: 'right',
                fontWeight: '500',
                color: '#111827',
                fontSize: '13px'
              }}>
                {mode === 'usd' ? formatCost(entry.value) : formatTokens(entry.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
