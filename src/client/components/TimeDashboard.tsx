import { useMemo, type ReactNode } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { TimingResponse } from '../../shared/types.js';
import { formatProjectName } from '../utils/formatters.js';
import { shortModelName } from '../utils/modelNames.js';
import { formatDuration, timingAverages, timingMeanDurations, timingDisplayDays, timingHeatmap, timingModelSeries, WEEKDAYS } from '../utils/timing.js';

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ec4899', '#0ea5e9', '#8b5cf6', '#a8a29e'];
const ELAPSED_COLOR = '#0d9488';

function Panel({ title, subtitle, children, testId }: { title: string; subtitle: string; children: ReactNode; testId?: string }) {
  return <section aria-label={title} data-testid={testId} className="min-w-0 rounded-2xl bg-white p-5 shadow-[0_1px_3px_rgba(120,113,108,0.06)]">
    <h3 className="text-[15px] font-semibold tracking-tight text-stone-900">{title}</h3>
    <p className="mb-5 mt-1 text-[13px] leading-relaxed text-stone-400">{subtitle}</p>
    {children}
  </section>;
}

function EmptyChart() {
  return <div className="flex h-60 items-center justify-center text-sm text-stone-400">No recorded time in this period.</div>;
}

function DurationTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string; payload?: { project?: string } }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return <div className="max-w-xs rounded-xl border border-stone-200/50 bg-white p-3 text-xs shadow-lg">
    <div className="mb-2 break-all font-medium text-stone-500">{payload[0]?.payload?.project ?? label}</div>
    {payload.map((entry, index) => <div key={index} className="flex items-center justify-between gap-4 py-0.5">
      <span className="flex min-w-0 items-center gap-1.5 text-stone-600"><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />{entry.name}</span>
      <span className="whitespace-nowrap font-mono text-stone-800">{formatDuration(Number(entry.value))}</span>
    </div>)}
  </div>;
}

function dateLabel(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function DailyCharts({ data }: { data: TimingResponse }) {
  const modelData = useMemo(() => timingModelSeries(data.daily), [data.daily]);
  return <>
    <Panel title="Daily agent work time" subtitle="Recorded agent turns, grouped by the model at the start of each turn.">
      {data.totals.workMs > 0 ? <div className="h-72 min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart accessibilityLayer data={modelData.days} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e5e4" />
            <XAxis dataKey="date" tickFormatter={dateLabel} tick={{ fontSize: 11, fill: '#78716c' }} axisLine={false} tickLine={false} minTickGap={24} />
            <YAxis tickFormatter={formatDuration} width={65} tick={{ fontSize: 11, fill: '#78716c' }} axisLine={false} tickLine={false} />
            <Tooltip content={<DurationTooltip />} />
            <Legend iconType="square" wrapperStyle={{ fontSize: 11, paddingTop: 16 }} />
            {modelData.series.map((model, index) => <Bar key={model.key} dataKey={model.key} name={shortModelName(model.name)} stackId="work" fill={COLORS[index % COLORS.length]} maxBarSize={40} />)}
          </BarChart>
        </ResponsiveContainer>
      </div> : <EmptyChart />}
    </Panel>
    <Panel title="Daily elapsed time" subtitle="Overlapping agent intervals count once. Time between turns is excluded.">
      {data.totals.elapsedMs > 0 ? <div className="h-72 min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart accessibilityLayer data={data.daily} margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e5e4" />
            <XAxis dataKey="date" tickFormatter={dateLabel} tick={{ fontSize: 11, fill: '#78716c' }} axisLine={false} tickLine={false} minTickGap={24} />
            <YAxis tickFormatter={formatDuration} width={65} tick={{ fontSize: 11, fill: '#78716c' }} axisLine={false} tickLine={false} />
            <Tooltip content={<DurationTooltip />} />
            <Bar dataKey="elapsedMs" name="Elapsed time" fill={ELAPSED_COLOR} radius={[3, 3, 0, 0]} maxBarSize={40} />
          </BarChart>
        </ResponsiveContainer>
      </div> : <EmptyChart />}
    </Panel>
  </>;
}

function ProjectChart({ data, elapsed = false }: { data: TimingResponse; elapsed?: boolean }) {
  const field = elapsed ? 'elapsedMs' : 'workMs';
  const projects = useMemo(() => [...data.projects].filter(project => project[field] > 0)
    .sort((a, b) => b[field] - a[field]).slice(0, 8)
    .map(project => ({ ...project, label: formatProjectName(project.project, data.availableProjects) })), [data.projects, data.availableProjects, field]);
  return <Panel title={elapsed ? 'Project elapsed time' : 'Project agent work time'}
    subtitle={elapsed ? 'Top 8 projects. Projects can overlap in time, so their elapsed times do not add up to the overall total.' : 'Top 8 projects by total agent work time, including parallel turns.'}>
    {projects.length ? <div className="h-72 min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart accessibilityLayer layout="vertical" data={projects} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e7e5e4" />
          <XAxis type="number" tickFormatter={formatDuration} tick={{ fontSize: 11, fill: '#78716c' }} axisLine={false} tickLine={false} minTickGap={28} />
          <YAxis type="category" dataKey="label" width={90} tickFormatter={(name: string) => name.length > 13 ? `${name.slice(0, 12)}…` : name} tick={{ fontSize: 11, fill: '#78716c' }} axisLine={false} tickLine={false} />
          <Tooltip content={<DurationTooltip />} />
          <Bar dataKey={field} name={elapsed ? 'Elapsed time' : 'Agent work time'} fill={elapsed ? ELAPSED_COLOR : COLORS[0]} maxBarSize={28} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div> : <EmptyChart />}
  </Panel>;
}

function ActivityHeatmap({ data, today }: { data: TimingResponse; today?: string }) {
  const values = useMemo(() => timingHeatmap(data.hourly, today), [data.hourly, today]);
  const max = Math.max(0, ...values.flat());
  const currentHour = today ? Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: data.timezone }).format(new Date())) : 23;
  const labels = today ? ['Today'] : WEEKDAYS;
  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  return <Panel title="24-Hour Activity Heatmap" testId="timing-heatmap"
    subtitle={today ? `Today's agent work time by hour · ${data.timezone}` : `Agent work time summed by weekday and hour · ${data.timezone}`}>
    <div className="overflow-x-auto pb-1">
      <div className="min-w-[480px]" role="table" aria-label="Agent work time by hour">
        <div className="mb-2 grid gap-1" role="row" style={{ gridTemplateColumns: '42px repeat(24, minmax(0, 1fr))' }}>
          <span role="columnheader" aria-label="Day" />
          {hours.map(hour => <span key={hour} role="columnheader" className="text-center text-[10px] text-stone-400">{hour % 3 === 0 ? `${hour.toString().padStart(2, '0')}` : ''}</span>)}
        </div>
        {values.map((row, day) => <div key={labels[day]} role="row" className="mb-1 grid items-center gap-1" style={{ gridTemplateColumns: '42px repeat(24, minmax(0, 1fr))' }}>
          <span role="rowheader" className="text-[11px] font-medium text-stone-500">{labels[day]}</span>
          {row.map((ms, hour) => {
            const future = Boolean(today && hour > currentHour);
            const label = `${labels[day]} ${String(hour).padStart(2, '0')}:00: ${future ? 'not yet elapsed' : `${formatDuration(ms)} agent work time`}`;
            return <div key={hour} role="cell" tabIndex={future ? undefined : 0} title={label} aria-label={label} data-work-ms={future ? undefined : ms}
              className={`h-7 rounded-sm outline-offset-2 focus-visible:outline-indigo-600 ${future ? 'border border-dashed border-stone-200' : 'transition-shadow hover:ring-1 hover:ring-indigo-400'}`}
              style={future ? undefined : { backgroundColor: ms > 0 ? `rgba(79, 70, 229, ${0.15 + 0.85 * ms / max})` : '#f5f5f4' }} />;
          })}
        </div>)}
      </div>
    </div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[11px] text-stone-400">
      <span>Parallel agents add up; one hour can contain more than 1h of work.</span>
      <span className="flex items-center gap-1.5">0s <span className="h-2.5 w-24 rounded-sm bg-gradient-to-r from-stone-100 to-indigo-600" /> {formatDuration(max)}</span>
    </div>
  </Panel>;
}

interface TimeDashboardProps {
  data: TimingResponse | null;
  loading: boolean;
  error: string | null;
  includeSystem: boolean;
  onIncludeSystemChange: (value: boolean) => void;
  onRetry: () => void;
  startDate?: string;
  endDate: string;
  isToday: boolean;
}

export function TimeDashboard({ data, loading, error, includeSystem, onIncludeSystemChange, onRetry, startDate, endDate, isToday }: TimeDashboardProps) {
  const displayDays = useMemo(() => timingDisplayDays(data?.daily ?? [], startDate, endDate), [data?.daily, startDate, endDate]);
  const averages = data ? timingAverages(data.totals) : null;
  const days = data?.totals.calendarDays ?? 0;
  const period = `${startDate ?? data?.daily[0]?.date ?? 'First recorded day'} – ${endDate}`;
  const cards = data && averages ? [
    { label: 'Total agent work time', value: formatDuration(data.totals.workMs), detail: `Main + delegated${includeSystem ? ' + system' : ''} agents. Parallel turns add up.` },
    { label: 'Daily avg work time', value: formatDuration(averages.dailyWorkMs), detail: `${days} calendar ${days === 1 ? 'day' : 'days'}, including days with no activity.` },
    { label: 'Total elapsed time', value: formatDuration(data.totals.elapsedMs), detail: 'Overlapping intervals count once across all selected agents.' },
    { label: 'Daily avg elapsed time', value: formatDuration(averages.dailyElapsedMs), detail: `Elapsed time averaged over ${days} calendar ${days === 1 ? 'day' : 'days'}.` },
    { label: 'Avg conversation time', value: averages.conversationMs === null ? '—' : formatDuration(averages.conversationMs), detail: `${data.totals.conversationCount} active ${data.totals.conversationCount === 1 ? 'conversation' : 'conversations'} (sessions). Main + child intervals merged per session.` },
    { label: 'Avg turn time', value: averages.turnMs === null ? '—' : formatDuration(averages.turnMs), detail: `${data.totals.completedTurnCount} completed Q&A ${data.totals.completedTurnCount === 1 ? 'turn' : 'turns'}. Full main-turn elapsed time, selected by answer date; includes child waiting once.` },
  ] : [];

  return <div data-testid="timing-dashboard" className="space-y-5" aria-busy={loading}>
    <div className="flex flex-col justify-between gap-4 rounded-2xl border border-stone-200/60 bg-white/60 p-4 md:flex-row md:items-center">
      <div className="max-w-3xl text-xs leading-relaxed text-stone-500">
        <p>Agent work time includes tools and waiting within recorded turns. Elapsed time removes overlaps; time between turns is excluded.</p>
        {data && <p className="mt-1">Reporting timezone: {data.timezone}.</p>}
      </div>
      <div className="shrink-0">
        <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-stone-700">
          <input type="checkbox" checked={includeSystem} onChange={event => onIncludeSystemChange(event.target.checked)} className="h-4 w-4 accent-indigo-600" />
          Include system agents
        </label>
        <p className="mt-1 pl-6 text-[11px] text-stone-400">Guardian, auto-review and similar agents.</p>
      </div>
    </div>
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      <span>{error}</span><button type="button" onClick={onRetry} className="rounded-md border border-red-200 bg-white px-3 py-1.5 font-medium">Retry</button>
    </div>}
    {!data && loading && <div role="status" className="space-y-5">
      <p className="text-sm text-stone-500">Loading timing data…</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">{Array.from({ length: 6 }, (_, index) => <div key={index} className="skeleton h-36 rounded-2xl" />)}</div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2"><div className="skeleton h-80 rounded-2xl" /><div className="skeleton h-80 rounded-2xl" /></div>
    </div>}
    {data && <>
      <div data-testid="timing-summary" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {cards.map((card, index) => <div key={card.label} className="min-w-0 rounded-2xl bg-white p-5 shadow-[0_1px_3px_rgba(120,113,108,0.06)]">
          <h3 className="text-[12px] font-medium text-stone-400">{card.label}</h3>
          <p className={`mt-2 break-words font-mono text-2xl font-extrabold tracking-tight ${index === 0 ? 'text-indigo-600' : index === 2 ? 'text-teal-600' : 'text-stone-900'}`}>{card.value}</p>
          <p className="mt-3 border-t border-stone-100 pt-2.5 text-[11px] leading-relaxed text-stone-500">{card.detail}</p>
        </div>)}
      </div>
      {(data.quality.incompleteTurns > 0 || data.quality.estimatedTurns > 0 || data.quality.unattributedTurns > 0) && <div role="status" className="rounded-xl border border-amber-200/60 bg-amber-50/60 px-4 py-3 text-xs leading-relaxed text-amber-800">
        {data.quality.incompleteTurns > 0 && <p>{data.quality.incompleteTurns} ongoing or incomplete {data.quality.incompleteTurns === 1 ? 'turn' : 'turns'} excluded.</p>}
        {data.quality.estimatedTurns > 0 && <p>{data.quality.estimatedTurns} older {data.quality.estimatedTurns === 1 ? 'turn uses' : 'turns use'} estimated start or end boundaries.</p>}
        {data.quality.unattributedTurns > 0 && <p>{data.quality.unattributedTurns} {data.quality.unattributedTurns === 1 ? 'turn' : 'turns'} could not be linked to a parent conversation; conversation averages may be incomplete.</p>}
      </div>}
      {data.totals.workMs === 0 && <p role="status" className="text-sm text-stone-500">No agent work intervals overlap the selected period and project.</p>}
      {displayDays.sparse && <p className="text-xs text-stone-500">This extended range shows recorded days only in charts and details. Daily averages still include every calendar day.</p>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2"><DailyCharts data={{ ...data, daily: displayDays.days }} /><ProjectChart data={data} /><ProjectChart data={data} elapsed /></div>
      <ActivityHeatmap data={data} today={isToday ? endDate : undefined} />
      <Panel title="Daily detail" subtitle={`${period} · ${data.timezone} · Most recent first`} testId="timing-detail">
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-xs">
            <thead><tr className="border-b border-stone-200 text-stone-400">
              <th scope="col" className="px-3 py-3 text-left font-semibold">Date</th>
              <th scope="col" className="px-3 py-3 text-right font-semibold">Agent work time</th>
              <th scope="col" className="px-3 py-3 text-right font-semibold">Elapsed time</th>
              <th scope="col" className="px-3 py-3 text-right font-semibold">Avg conversation time</th>
              <th scope="col" className="px-3 py-3 text-right font-semibold">Avg turn time</th>
            </tr></thead>
            <tbody>{[...displayDays.days].reverse().map(day => {
              const dayAverages = timingMeanDurations(day);
              return <tr key={day.date} className="border-b border-stone-100 hover:bg-stone-50/60">
                <th scope="row" className="px-3 py-3 text-left font-medium text-stone-700">{day.date}</th>
                <td className="px-3 py-3 text-right font-mono text-indigo-600">{formatDuration(day.workMs)}</td>
                <td className="px-3 py-3 text-right font-mono text-teal-600">{formatDuration(day.elapsedMs)}</td>
                <td className="px-3 py-3 text-right font-mono text-stone-700" title={`${day.conversationCount} active ${day.conversationCount === 1 ? 'session' : 'sessions'}`}>{dayAverages.conversationMs === null ? '—' : formatDuration(dayAverages.conversationMs)}</td>
                <td className="px-3 py-3 text-right font-mono text-stone-700" title={`${day.completedTurnCount} completed Q&A ${day.completedTurnCount === 1 ? 'turn' : 'turns'}`}>{dayAverages.turnMs === null ? '—' : formatDuration(dayAverages.turnMs)}</td>
              </tr>;
            })}</tbody>
            <tfoot><tr className="border-t border-stone-200 font-semibold">
              <th scope="row" className="px-3 py-3 text-left text-stone-700">Total</th>
              <td className="px-3 py-3 text-right font-mono text-indigo-600">{formatDuration(data.totals.workMs)}</td>
              <td className="px-3 py-3 text-right font-mono text-teal-600">{formatDuration(data.totals.elapsedMs)}</td>
              <td className="px-3 py-3 text-right font-mono text-stone-700">{averages?.conversationMs == null ? '—' : formatDuration(averages.conversationMs)}</td>
              <td className="px-3 py-3 text-right font-mono text-stone-700">{averages?.turnMs == null ? '—' : formatDuration(averages.turnMs)}</td>
            </tr></tfoot>
          </table>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-stone-400">Conversation averages use each session's elapsed time within that day. Turn averages use full durations of answers completed that day. The Total row uses overall averages for the selected period, matching the summary cards.</p>
      </Panel>
    </>}
  </div>;
}
