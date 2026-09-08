import { useState } from 'react';
import { dateRangeError, localDateKey, type CustomDateRange } from '../../shared/dateRange.js';

export function CustomDateRangePicker({ value, onApply }: { value: CustomDateRange; onApply: (value: CustomDateRange) => void }) {
  const [draft, setDraft] = useState(value);
  const error = dateRangeError(draft);
  const inputClass = 'min-w-0 rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20';

  return <form className="flex flex-col gap-2" onSubmit={event => {
    event.preventDefault();
    if (!dateRangeError(draft)) onApply(draft);
  }}>
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex min-w-0 flex-col gap-1 text-[11px] font-medium text-stone-500">
        Start date
        <input type="date" required value={draft.startDate} max={draft.endDate && draft.endDate < localDateKey() ? draft.endDate : localDateKey()}
          className={inputClass} aria-describedby={error ? 'date-range-error' : undefined}
          onChange={event => setDraft(current => ({ ...current, startDate: event.target.value }))} />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-[11px] font-medium text-stone-500">
        End date
        <input type="date" required value={draft.endDate} min={draft.startDate} max={localDateKey()}
          className={inputClass} aria-describedby={error ? 'date-range-error' : undefined}
          onChange={event => setDraft(current => ({ ...current, endDate: event.target.value }))} />
      </label>
      <button type="submit" disabled={Boolean(error)} className="rounded-lg bg-stone-800 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">Apply</button>
    </div>
    {error ? <p id="date-range-error" role="alert" className="text-xs text-red-600">{error}</p>
      : <p className="text-[11px] text-stone-400">Includes both dates. Applied: {value.startDate} – {value.endDate}</p>}
  </form>;
}
