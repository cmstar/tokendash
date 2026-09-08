import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const mocks = vi.hoisted(() => ({ analytics: vi.fn(() => ({ sessions: [] })) }));
vi.mock('../../server/sessionAnalyticsParser.js', () => ({
  getSessionAnalytics: mocks.analytics,
  getSessionAnalyticsSourceRevision: () => 'test-revision',
  getSessionDetail: vi.fn(),
  invalidateSessionAnalyticsSource: vi.fn(),
}));
vi.mock('../../shared/schemas.js', () => ({ validateSessionAnalytics: (data: unknown) => data, validateSessionDetail: vi.fn() }));
const { getSessionAnalyticsRoute } = await import('../../server/routes/sessionAnalytics.js');
const { cache } = await import('../../server/cache.js');

async function request(query: Record<string, unknown>) {
  const res = { json: vi.fn(), status: vi.fn() };
  res.status.mockReturnValue(res);
  await getSessionAnalyticsRoute({ query } as unknown as Request, res as unknown as Response);
  return res;
}

describe('custom session range requests', () => {
  beforeEach(() => { cache.clear(); vi.clearAllMocks(); });

  it.each([
    {},
    { startDate: '2020-01-02', endDate: '2020-01-01' },
    { startDate: '2020-01-01', endDate: '9999-01-01' },
    { startDate: '2020-02-30', endDate: '2020-03-01' },
    { startDate: ['2020-01-01'], endDate: '2020-01-02' },
  ])('rejects invalid custom dates %j', async dates => {
    const res = await request({ range: 'custom', ...dates });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mocks.analytics).not.toHaveBeenCalled();
  });

  it('caches distinct date intervals separately and reuses the same interval', async () => {
    for (const endDate of ['2020-01-01', '2020-01-02', '2020-01-01']) {
      const res = await request({ range: 'custom', startDate: '2020-01-01', endDate });
      expect(res.status).not.toHaveBeenCalled();
    }
    expect(mocks.analytics).toHaveBeenCalledTimes(2);
    expect(mocks.analytics).toHaveBeenLastCalledWith('claude', expect.objectContaining({
      range: 'custom', startDate: '2020-01-01', endDate: '2020-01-02',
    }), 'test-revision');
  });
});
