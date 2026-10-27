import { useEffect, useState } from 'react';
import { fetchAgents, fetchDaily, fetchProjects } from '../api/client.js';
import type { DailyResponse, ProjectsResponse } from '../../shared/types.js';
import { formatTokens } from '../utils/formatters.js';
import { useCurrency } from '../hooks/useCurrency.js';
import { getPricing } from '../../shared/modelPricing.js';

const AGENT_LABELS: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  openclaw: 'OpenClaw',
  opencode: 'OpenCode',
  pi: 'Pi',
};

interface AgentStat {
  agent: string;
  totalTokens: number;
  totalCost: number;
  projectCount: number;
  activeDays: number;
  models: Set<string>;
  dates: string[];
  projects: string[];
  error?: string;
}

export function AllAgentsStats({ range, onClose }: { range: string; onClose: () => void }) {
  const { formatCost } = useCurrency();
  const [stats, setStats] = useState<AgentStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const agents = await fetchAgents();
        const results: AgentStat[] = [];
        for (const agent of agents.available) {
          try {
            const [daily, projects]: [DailyResponse, ProjectsResponse] = await Promise.all([
              fetchDaily(agent, revision > 0),
              fetchProjects(agent, revision > 0),
            ]);
            const now = new Date();
            const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - (range === 'today' ? 0 : Number.parseInt(range, 10)));
            cutoff.setHours(0, 0, 0, 0);
            const inRange = (day: { date: string }) => range === 'all' || (range === 'today' ? day.date === today : new Date(day.date) >= cutoff);
            const entries = daily.daily.filter(inRange);
            const models = new Set<string>();
            for (const d of entries) {
              for (const m of d.modelsUsed) models.add(m);
            }
            results.push({
              agent,
              totalTokens: entries.reduce((sum, day) => sum + day.totalTokens, 0),
              totalCost: entries.reduce((sum, day) => sum + day.totalCost, 0),
              projectCount: Object.values(projects.projects).filter(days => days.some(day => inRange(day) && day.totalTokens > 0)).length,
              activeDays: entries.filter(d => d.totalTokens > 0).length,
              dates: entries.filter(day => day.totalTokens > 0).map(day => day.date),
              projects: Object.entries(projects.projects).filter(([, days]) => days.some(day => inRange(day) && day.totalTokens > 0)).map(([name]) => `${AGENT_LABELS[agent] || agent}: ${name}`),
              models,
            });
          } catch (e) {
            results.push({
              agent,
              totalTokens: 0,
              totalCost: 0,
              projectCount: 0,
              activeDays: 0,
              models: new Set(),
              dates: [],
              projects: [],
              error: e instanceof Error ? e.message : 'failed',
            });
          }
        }
        if (!cancelled) setStats(results);
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : '无法读取 Agent 列表');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [range, revision]);

  const totalTokens = stats.reduce((s, r) => s + r.totalTokens, 0);
  const totalCost = stats.reduce((s, r) => s + r.totalCost, 0);
  const totalProjects = stats.reduce((s, r) => s + r.projectCount, 0);
  const totalDays = new Set(stats.flatMap(row => row.dates)).size;
  const incomplete = stats.some(row => row.error);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-950/30 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="All agents statistics">
      <div className="w-full max-w-3xl rounded-2xl bg-white shadow-[0_24px_80px_rgba(28,25,23,0.22)] border border-stone-200/70 max-h-[88vh] overflow-auto">
        <div className="flex items-start justify-between gap-4 border-b border-stone-100 px-6 py-5 sticky top-0 bg-white">
          <div>
            <h2 className="text-lg font-extrabold tracking-tight text-stone-900">所有 Agent 统计</h2>
            <p className="mt-1 text-[13px] font-medium leading-relaxed text-stone-500">当前范围：{range}。项目按 Agent 区分，活跃天数按日期去重。费用为模型单价估算值。</p>
            <button type="button" onClick={() => setRevision(value => value + 1)} disabled={loading} className="mt-2 text-sm text-indigo-600 disabled:opacity-40">刷新所有 Agent</button>
          </div>
          <button type="button" aria-label="关闭所有 Agent 统计" onClick={onClose} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-6 py-5">
          {loading ? (
            <div className="py-12 text-center text-stone-400">加载中…</div>
          ) : error ? <p role="alert" className="text-rose-600">{error}</p> : (
            <>
              {incomplete && <p role="alert" className="mb-3 text-rose-600">部分来源读取失败，以下合计不完整。请查看对应错误并刷新。</p>}
              {stats.some(row => [...row.models].some(model => !getPricing(model))) && <p className="mb-3 text-xs text-amber-700">部分模型价格未配置；有会话费用时保留原值，否则未计价。</p>}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <Kpi label="总 Token" value={formatTokens(totalTokens)} />
                <Kpi label="总成本" value={formatCost(totalCost)} />
                <Kpi label="项目数" value={totalProjects.toString()} />
                <Kpi label="活跃天数" value={totalDays.toString()} />
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-100 text-left text-[11px] uppercase tracking-wider text-stone-400">
                    <th className="py-2 px-3">Agent</th>
                    <th className="py-2 px-3 text-right">Token</th>
                    <th className="py-2 px-3 text-right">成本</th>
                    <th className="py-2 px-3 text-right">项目</th>
                    <th className="py-2 px-3 text-right">活跃天</th>
                    <th className="py-2 px-3">模型</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map(r => (
                    <tr key={r.agent} className="border-b border-stone-50">
                      <td className="py-2.5 px-3 font-semibold text-stone-700">{AGENT_LABELS[r.agent] || r.agent}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-stone-600">{r.error ? '—' : formatTokens(r.totalTokens)}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-stone-600">{r.error ? '—' : formatCost(r.totalCost)}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-stone-500">{r.projectCount}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-stone-500">{r.activeDays}</td>
                      <td className="py-2.5 px-3 text-[11px] text-stone-400 truncate max-w-[180px]">{r.error ? <span className="text-rose-500">{r.error}</span> : [...r.models].join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {stats.flatMap(row => row.projects).length > 0 && <details className="mt-4 text-xs text-stone-500"><summary>来源与项目</summary><ul className="mt-2 space-y-1">{stats.flatMap(row => row.projects).map(name => <li key={name}>{name}</li>)}</ul></details>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-stone-100 bg-stone-50/50 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">{label}</p>
      <p className="mt-1 font-mono text-base font-bold text-stone-800">{value}</p>
    </div>
  );
}
