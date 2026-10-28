import type { TimingResponse } from '../../shared/types.js';

export interface TimingRequest {
  startDate?: string;
  endDate: string;
  project: string;
  includeSystem: boolean;
}

export async function fetchTiming(request: TimingRequest, signal?: AbortSignal, refresh = false): Promise<TimingResponse> {
  const params = new URLSearchParams({
    agent: 'codex',
    ...(request.startDate ? { startDate: request.startDate } : {}),
    endDate: request.endDate,
    ...(request.project ? { project: request.project } : {}),
    includeSystem: String(request.includeSystem),
    ...(refresh ? { refresh: '1' } : {}),
  });
  const response = await fetch(`/api/timing?${params}`, { signal });
  if (!response.ok) throw new Error(`Failed to fetch timing data: ${response.status} ${response.statusText}`);
  return response.json();
}
