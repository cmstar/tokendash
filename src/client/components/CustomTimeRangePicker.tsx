import { useRef, useState } from 'react';
import { customTimeRangeError, localDateKey, recentDateRange, type CustomTimeRange } from '../../shared/dateRange.js';

const DAY_CHOICES = [2, 3, 7, 14, 30, 60, 90, 180, 365];

export function CustomTimeRangePicker({ value, onApply }: { value: CustomTimeRange; onApply: (value: CustomTimeRange) => void }) {
  const [draft, setDraft] = useState(value);
  const [days, setDays] = useState(String(value.days ?? 30));
  const daysInput = useRef<HTMLInputElement>(null);
  const recent = draft.mode === 'recent';
  const pending = { ...draft, days: Number(days) };
  const error = customTimeRangeError(pending);
  const appliedDates = value.mode === 'recent' ? recentDateRange(value.days!) : value;
  const inputClass = 'min-w-0 rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20';

  return <form className="flex flex-col gap-2 rounded-xl border border-stone-200/70 bg-stone-50/60 p-3" onSubmit={event => {
    event.preventDefault();
    if (!error) onApply(pending);
  }}>
    <div role="group" aria-label="Custom range mode" className="flex flex-wrap gap-1">
      {([{ key: 'dates', label: 'Date range' }, { key: 'recent', label: 'Last X days' }] as const).map(mode => (
        <button key={mode.key} type="button" aria-pressed={(draft.mode ?? 'dates') === mode.key}
          onClick={() => setDraft(current => ({ ...current, mode: mode.key }))}
          className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${(draft.mode ?? 'dates') === mode.key ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-stone-200' : 'text-stone-500 hover:bg-white'}`}>
          {mode.label}
        </button>
      ))}
    </div>
    <div className="flex flex-wrap items-end gap-2">
      {recent ? <>
        <label className="flex min-w-0 flex-col gap-1 text-[11px] font-medium text-stone-500">
          Quick choices
          <select className={inputClass} value={DAY_CHOICES.some(day => String(day) === days) ? days : ''}
            onChange={event => { setDays(event.target.value); if (!event.target.value) daysInput.current?.focus(); }}>
            <option value="">Enter days manually</option>
            {DAY_CHOICES.map(day => <option key={day} value={day}>Last {day} days</option>)}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-[11px] font-medium text-stone-500">
          Number of days
          <input ref={daysInput} type="number" min="1" step="1" required value={days} inputMode="numeric"
            className={`${inputClass} w-28`} aria-describedby={error ? 'time-range-error' : undefined}
            onChange={event => setDays(event.target.value)} />
        </label>
      </> : <>
      <label className="flex min-w-0 flex-col gap-1 text-[11px] font-medium text-stone-500">
        Start date
        <input type="date" required value={draft.startDate} max={draft.endDate && draft.endDate < localDateKey() ? draft.endDate : localDateKey()}
          className={inputClass} aria-describedby={error ? 'time-range-error' : undefined}
          onChange={event => setDraft(current => ({ ...current, startDate: event.target.value }))} />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-[11px] font-medium text-stone-500">
        End date
        <input type="date" required value={draft.endDate} min={draft.startDate} max={localDateKey()}
          className={inputClass} aria-describedby={error ? 'time-range-error' : undefined}
          onChange={event => setDraft(current => ({ ...current, endDate: event.target.value }))} />
      </label>
      </>}
      <button type="submit" disabled={Boolean(error)} className="rounded-lg bg-stone-800 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">Apply</button>
    </div>
    <p className="text-[11px] text-stone-500">{recent ? 'Includes today. Moves forward each day.' : 'Includes both start and end dates.'}</p>
    {error && <p id="time-range-error" role="alert" className="text-xs text-red-600">{error}</p>}
    <p className="text-[11px] text-stone-400">Applied: {value.mode === 'recent' ? `Last ${value.days} ${value.days === 1 ? 'day' : 'days'} · ` : ''}{appliedDates.startDate} – {appliedDates.endDate}</p>
  </form>;
}
