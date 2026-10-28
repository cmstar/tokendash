import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { getTiming } from '../../server/routes/timing.js';
import { getCodexTimingResponse } from '../../server/codexResponseService.js';
import { buildCodexTiming } from '../../server/codexTiming.js';

vi.mock('../../server/codexResponseService.js', () => ({ getCodexTimingResponse: vi.fn() }));
vi.mock('../../server/cache.js', () => ({ cache: { get: vi.fn(() => null), getStale: vi.fn(() => null), set: vi.fn() } }));
vi.mock('../../server/codexDataSources.js', () => ({ getCodexUsageScopeKey: () => 'test-scope' }));

const response = () => {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
};
beforeEach(() => { vi.clearAllMocks(); vi.mocked(getCodexTimingResponse).mockResolvedValue(buildCodexTiming([], { endDate: '2026-10-28' })); });

describe('timing API', () => {
  it.each([
    { agent: 'claude' }, { agent: ['codex'] }, { startDate: '2026-02-30' }, { endDate: 'not-a-date' },
    { startDate: '2026-10-29', endDate: '2026-10-28' }, { includeSystem: 'yes' }, { project: ['a', 'b'] },
    { endDate: '9999-12-31' },
  ])('rejects invalid query %j without parsing history', async query => {
    const res = response();
    await getTiming({ query } as unknown as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(getCodexTimingResponse).not.toHaveBeenCalled();
  });

  it('passes validated date/project/system scope and force refresh to the worker service', async () => {
    const res = response();
    await getTiming({ query: { agent: 'codex', startDate: '2026-10-01', endDate: '2026-10-28', project: 'demo', includeSystem: 'true', refresh: '1' } } as unknown as Request, res as unknown as Response);
    expect(getCodexTimingResponse).toHaveBeenCalledWith({ startDate: '2026-10-01', endDate: '2026-10-28', project: 'demo', includeSystem: true }, true);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ timezone: 'Asia/Shanghai', totals: expect.objectContaining({ workMs: 0, completedTurnCount: 0, completedTurnElapsedMs: 0 }) }));
  });

  it('defaults system agents off and leaves ALL start date omitted', async () => {
    const res = response();
    await getTiming({ query: { agent: 'codex', endDate: '2026-10-28' } } as unknown as Request, res as unknown as Response);
    expect(getCodexTimingResponse).toHaveBeenCalledWith(expect.objectContaining({ includeSystem: false, startDate: undefined }), false);
  });
});
