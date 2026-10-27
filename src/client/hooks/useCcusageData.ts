import { useState, useEffect, useCallback, useRef } from 'react';

const DEFAULT_INTERVAL_MS = 60_000; // 60 秒自动刷新

export function useCcusageData<T>(fetcher: (refresh?: boolean) => Promise<T>, intervalMs: number = DEFAULT_INTERVAL_MS) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const requestSequence = useRef(0);

  const fetchData = useCallback(async (refresh = false) => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher(refresh);
      if (sequence !== requestSequence.current) return;
      setData(result);
      setLastUpdated(new Date());
    } catch (err) {
      if (sequence !== requestSequence.current) return;
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [fetcher]);

  // 首次加载 + fetcher 变化时重新拉取
  useEffect(() => {
    setData(null);
    fetchData();
    return () => { requestSequence.current += 1; };
  }, [fetchData]);

  // 定时自动刷新
  useEffect(() => {
    if (intervalMs <= 0) return;
    timerRef.current = setInterval(() => { void fetchData(false); }, intervalMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchData, intervalMs]);

  const refetch = useCallback(() => fetchData(true), [fetchData]);

  return { data, loading, error, refetch, lastUpdated };
}
