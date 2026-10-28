import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { cache } from '../cache.js';
import { getCodexUsageScopeKey } from '../codexDataSources.js';
import { getCodexTimingResponse } from '../codexResponseService.js';
import { isTimingDate } from '../codexTiming.js';
import { validateTiming } from '../../shared/schemas.js';

const date = z.string().refine(isTimingDate, 'Expected a valid YYYY-MM-DD date');
const querySchema = z.object({
  agent: z.literal('codex').default('codex'),
  startDate: date.optional(),
  endDate: date.optional(),
  project: z.string().min(1).optional(),
  includeSystem: z.enum(['true', 'false']).default('false'),
});

export async function getTiming(req: Request, res: Response): Promise<void> {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid timing query', hint: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') });
    return;
  }
  const dateParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(Date.now());
  const today = ['year', 'month', 'day'].map(type => dateParts.find(part => part.type === type)!.value).join('-');
  const options = { startDate: parsed.data.startDate, endDate: parsed.data.endDate ?? today, project: parsed.data.project, includeSystem: parsed.data.includeSystem === 'true' };
  if (options.endDate > today) {
    res.status(400).json({ error: 'Invalid timing query', hint: 'endDate must not be in the future' });
    return;
  }
  if (options.startDate && options.startDate > options.endDate) {
    res.status(400).json({ error: 'Invalid timing query', hint: 'startDate must not be after endDate' });
    return;
  }
  const force = req.query.refresh === '1' || req.query.refresh === 'true';
  const key = `timing:v3:${createHash('sha256').update(`${getCodexUsageScopeKey()}:${JSON.stringify(options)}`).digest('hex')}`;
  const fetchData = async () => validateTiming(await getCodexTimingResponse(options, force));
  try {
    if (!force) {
      const fresh = cache.get(key);
      if (fresh) { res.json(fresh); return; }
      const stale = cache.getStale(key);
      if (stale) {
        void fetchData().then(data => cache.set(key, data)).catch(error => console.error('Background refresh failed (timing):', error));
        res.json(stale);
        return;
      }
    }
    const data = await fetchData();
    cache.set(key, data);
    res.json(data);
  } catch (error) {
    res.status(502).json({ error: 'Failed to fetch Codex timing data', hint: error instanceof Error ? error.message : 'Unknown error' });
  }
}
