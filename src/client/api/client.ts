import { projectName } from '../../shared/projectNames.js';
import type { DailyResponse, MonthlyResponse, SessionResponse, ProjectsResponse, BlocksResponse, AnalyticsResponse, AppSettingsResponse, SessionAnalyticsResponse, SessionDetail } from '../../shared/types.js';
import { mergeDailyResponses, mergeAnalytics, mergeProjects } from '../utils/agentAggregation.js';

const BASE = '/api';

export interface AgentsResponse {
  available: string[];
  default: string | null;
}


export async function fetchSettings(): Promise<AppSettingsResponse> {
  const res = await fetch(`${BASE}/settings`);
  if (!res.ok) {
    throw new Error(`Failed to fetch settings: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function updateCodexDataPaths(paths: string[]): Promise<AppSettingsResponse> {
  const res = await fetch(`${BASE}/settings/codex-data-paths`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths }),
  });
  if (!res.ok) {
    throw new Error(`Failed to update Codex data paths: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function fetchAgents(): Promise<AgentsResponse> {
  const res = await fetch(`${BASE}/agents`);
  if (!res.ok) {
    throw new Error(`Failed to fetch agents: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function qs(agent: string, extra?: Record<string, string>): string {
  const parts: string[] = [];
  if (agent !== 'claude') parts.push(`agent=${agent}`);
  if (extra) {
    const keys = Object.keys(extra);
    for (let i = 0; i < keys.length; i++) {
      const val = extra[keys[i]];
      if (val) parts.push(encodeURIComponent(keys[i]) + '=' + encodeURIComponent(val));
    }
  }
  return parts.length > 0 ? '?' + parts.join('&') : '';
}

export async function fetchDaily(agent = 'claude', refresh = false): Promise<DailyResponse> {
  if (agent === 'all') {
    const { available } = await fetchAgents();
    return mergeDailyResponses(await Promise.all(available.map(source => fetchDaily(source, refresh))));
  }
  const res = await fetch(`${BASE}/daily${qs(agent, refresh ? { refresh: '1' } : undefined)}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch daily data: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function fetchMonthly(agent = 'claude'): Promise<MonthlyResponse> {
  const res = await fetch(`${BASE}/monthly${qs(agent)}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch monthly data: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function fetchSession(agent = 'claude'): Promise<SessionResponse> {
  const res = await fetch(`${BASE}/session${qs(agent)}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch session data: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function fetchProjects(agent = 'claude', refresh = false): Promise<ProjectsResponse> {
  if (agent === 'all') {
    const { available } = await fetchAgents();
    return mergeProjects(await Promise.all(available.map(source => fetchProjects(source, refresh))));
  }
  const res = await fetch(`${BASE}/projects${qs(agent, refresh ? { refresh: '1' } : undefined)}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch projects data: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function fetchBlocks(agent = 'claude', project = '', refresh = false): Promise<BlocksResponse> {
  if (agent === 'all') {
    const sources = (await fetchAgents()).available;
    const responses = await Promise.all(sources.map(async source => {
      const projects = project ? Object.keys((await fetchProjects(source, refresh)).projects).filter(name => projectName(name) === project) : [''];
      const responses = await Promise.all(projects.map(name => fetchBlocks(source, name, refresh)));
      return responses.flatMap((response, index) => response.blocks.map(block => ({ ...block, id: source + ':' + index + ':' + block.id })));
    }));
    return { blocks: responses.flat().sort((a, b) => a.startTime.localeCompare(b.startTime)) };
  }
  const res = await fetch(`${BASE}/blocks${qs(agent, { ...(project ? { project } : {}), ...(refresh ? { refresh: '1' } : {}) })}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch blocks data: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function fetchAnalytics(agent = 'claude', project = '', refresh = false): Promise<AnalyticsResponse> {
  if (agent === 'all') {
    const sources = (await fetchAgents()).available;
    const responses = await Promise.all(sources.filter(source => source !== 'codex').map(async source => {
      const projects = project ? Object.keys((await fetchProjects(source, refresh)).projects).filter(name => projectName(name) === project) : [''];
      return Promise.all(projects.map(name => fetchAnalytics(source, name, refresh)));
    }));
    return mergeAnalytics(responses.flat());
  }
  const res = await fetch(`${BASE}/analytics${qs(agent, { ...(project ? { project } : {}), ...(refresh ? { refresh: '1' } : {}) })}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch analytics: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export interface SessionAnalyticsRequest {
  agent: string;
  project?: string;
  range: string;
  model?: string;
  status?: string;
  query?: string;
  cursor?: string;
  limit?: number;
  refresh?: boolean;
  signal?: AbortSignal;
}

export async function fetchSessionAnalytics(request: SessionAnalyticsRequest): Promise<SessionAnalyticsResponse> {
  const params: Record<string, string> = {
    agent: request.agent,
    range: request.range,
    ...(request.project ? { project: request.project } : {}),
    ...(request.model ? { model: request.model } : {}),
    ...(request.status ? { status: request.status } : {}),
    ...(request.query ? { query: request.query } : {}),
    ...(request.cursor ? { cursor: request.cursor } : {}),
    ...(request.limit ? { limit: String(request.limit) } : {}),
    ...(request.refresh ? { refresh: '1' } : {}),
  };
  const res = await fetch(`${BASE}/session-analytics?${new URLSearchParams(params)}`, { signal: request.signal });
  if (!res.ok) throw new Error(`Failed to fetch session analytics: ${res.status} ${res.statusText}`);
  return res.json();
}

export async function fetchSessionDetail(agent: string, id: string, includeContent = false): Promise<SessionDetail> {
  const params = new URLSearchParams({ agent, ...(includeContent ? { include: 'content' } : {}) });
  const res = await fetch(`${BASE}/sessions/${encodeURIComponent(id)}?${params}`);
  if (!res.ok) throw new Error(`Failed to fetch session detail: ${res.status} ${res.statusText}`);
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('Session detail service returned an unexpected response. Start the current TokenDash development server and retry.');
  }
  return res.json();
}

export async function updateBillingExchangeRate(exchangeRate: number): Promise<AppSettingsResponse> {
  const response = await fetch(BASE + '/settings/billing', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ exchangeRate }) });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('当前后端未加载汇率设置接口，请启动当前版本的 TokenDash 服务');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '汇率保存失败');
  return data;
}
