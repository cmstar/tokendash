import assert from 'node:assert/strict';
import { mergeDailyResponses, mergeProjects } from '../src/client/utils/agentAggregation.js';
import { projectName } from '../src/shared/projectNames.js';
import type { DailyResponse, ProjectsResponse } from '../src/shared/types.js';

const origin = process.env.TOKENDASH_TEST_ORIGIN ?? 'http://localhost:3457';
async function read(path: string) {
  const response = await fetch(origin + path, { signal: AbortSignal.timeout(120_000) });
  assert.ok(response.ok, `${path}: HTTP ${response.status}`);
  assert.ok(response.headers.get('content-type')?.includes('application/json'));
  return response.json();
}

const agents = await read('/api/agents') as { available: string[] };
const sources = await Promise.all(agents.available.map(async agent => ({ agent, data: await read(`/api/daily?agent=${agent}&refresh=1`) as DailyResponse })));
const merged = mergeDailyResponses(sources.map(source => source.data));
const projectSources = await Promise.all(agents.available.map(agent => read(`/api/projects?agent=${agent}&refresh=1`) as Promise<ProjectsResponse>));
const projects = mergeProjects(projectSources);
const originalProjects = projectSources.flatMap(source => Object.entries(source.projects));
assert.equal(Object.keys(projects.projects).length, new Set(originalProjects.map(([name]) => projectName(name))).size);
for (const [name, days] of Object.entries(projects.projects)) {
  assert.equal(days.reduce((sum, day) => sum + day.totalTokens, 0), originalProjects.filter(([path]) => projectName(path) === name).flatMap(([, days]) => days).reduce((sum, day) => sum + day.totalTokens, 0));
}
assert.equal(merged.totals.totalTokens, sources.reduce((sum, source) => sum + source.data.daily.reduce((value, day) => value + day.totalTokens, 0), 0));
assert.ok(Math.abs(merged.totals.totalCost - sources.reduce((sum, source) => sum + source.data.daily.reduce((value, day) => value + day.totalCost, 0), 0)) < 1e-6);
assert.equal(merged.daily.length, new Set(sources.flatMap(source => source.data.daily.map(day => day.date))).size);
for (const day of merged.daily) {
  assert.equal(day.totalTokens, sources.flatMap(source => source.data.daily).filter(source => source.date === day.date).reduce((sum, source) => sum + source.totalTokens, 0));
}
const before = await read('/api/settings');
const rejected = await fetch(origin + '/api/settings/billing', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ exchangeRate: 0 }) });
assert.equal(rejected.status, 400);
const after = await read('/api/settings');
assert.equal(before.billing.exchangeRate, after.billing.exchangeRate);
console.log(JSON.stringify({ agents: sources.map(source => ({ agent: source.agent, tokens: source.data.totals.totalTokens })), combinedTokens: merged.totals.totalTokens, combinedCostUSD: merged.totals.totalCost, dates: merged.daily.length, mergedProjects: Object.keys(projects.projects).length, originalProjects: originalProjects.length, exchangeRate: after.billing.exchangeRate, invalidRateRejected: true }, null, 2));
