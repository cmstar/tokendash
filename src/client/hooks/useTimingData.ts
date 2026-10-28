import { useEffect, useState } from 'react';
import type { TimingResponse } from '../../shared/types.js';
import { fetchTiming, type TimingRequest } from '../api/timing.js';

interface TimingState {
  key: string;
  data: TimingResponse | null;
  loading: boolean;
  error: string | null;
}

export function useTimingData(enabled: boolean, request: TimingRequest, refreshVersion: number) {
  const key = JSON.stringify([enabled, request.startDate, request.endDate, request.project, request.includeSystem, refreshVersion]);
  const [state, setState] = useState<TimingState>({ key: '', data: null, loading: false, error: null });

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let controller: AbortController | undefined;
    const load = async (refresh: boolean) => {
      controller?.abort();
      controller = new AbortController();
      const current = controller;
      setState(previous => ({ key, data: previous.key === key ? previous.data : null, loading: true, error: null }));
      try {
        const data = await fetchTiming(request, current.signal, refresh);
        if (active && !current.signal.aborted) setState({ key, data, loading: false, error: null });
      } catch (error) {
        if (active && !current.signal.aborted) setState(previous => ({
          key, data: previous.key === key ? previous.data : null, loading: false,
          error: error instanceof Error ? error.message : 'Could not load timing data.',
        }));
      }
    };
    void load(refreshVersion > 0);
    const timer = setInterval(() => { void load(false); }, 60_000);
    return () => { active = false; controller?.abort(); clearInterval(timer); };
    // The serialized key includes every request field, the enabled flag, and refresh version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // A filter change must never display totals from the previous selection, even
  // during the render before its effect runs.
  return state.key === key && enabled
    ? state
    : { key, data: null, loading: enabled, error: null };
}
