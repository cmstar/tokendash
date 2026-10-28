import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTiming } from '../../client/api/timing.js';

describe('timing API requests', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('encodes date, system-agent and cross-platform project filters and supports cancellation', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    await fetchTiming({ startDate: '2026-10-27', endDate: '2026-10-28', project: 'D:\\work\\a b & c', includeSystem: false }, controller.signal, true);
    const [url, options] = fetchMock.mock.calls[0];
    const params = new URL(url, 'http://localhost').searchParams;
    expect(Object.fromEntries(params)).toEqual({ agent: 'codex', startDate: '2026-10-27', endDate: '2026-10-28', project: 'D:\\work\\a b & c', includeSystem: 'false', refresh: '1' });
    expect(options.signal).toBe(controller.signal);
  });

  it('leaves the start date and project out for all history, and reports HTTP errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'Unavailable' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchTiming({ endDate: '2026-10-28', project: '', includeSystem: true })).rejects.toThrow('Failed to fetch timing data: 503 Unavailable');
    const params = new URL(fetchMock.mock.calls[0][0], 'http://localhost').searchParams;
    expect(Object.fromEntries(params)).toEqual({ agent: 'codex', endDate: '2026-10-28', includeSystem: 'true' });
  });
});
