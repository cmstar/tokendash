import { test, expect, type Page } from '@playwright/test';
import { mockApiRoutes } from './fixtures.js';
import { generateTimingResponse, mockTimingRoute, timingDate, TIMING_PROJECT, TIMING_ONLY_PROJECT } from './timingFixtures.js';

test.use({ timezoneId: 'Asia/Shanghai' });

async function setup(page: Page, options: { metric?: string; agent?: string; empty?: boolean; error?: boolean } = {}) {
  // Recharts uses Date.now for animation progress, so preserve an advancing
  // clock while fixing the reporting day and ensuring morning hours elapsed.
  await page.clock.install({ time: new Date(`${timingDate()}T12:00:00+08:00`) });
  await page.clock.resume();
  await page.addInitScript(({ metric, agent }) => {
    if (localStorage.getItem('dashboard_agent') === null) localStorage.setItem('dashboard_agent', JSON.stringify(agent));
    if (localStorage.getItem('dashboard_metric') === null) localStorage.setItem('dashboard_metric', JSON.stringify(metric));
    if (localStorage.getItem('dashboard_timeRange') === null) localStorage.setItem('dashboard_timeRange', JSON.stringify('2d'));
  }, { metric: options.metric || 'tokens', agent: options.agent || 'codex' });
  await mockApiRoutes(page, { agents: ['claude', 'codex', 'opencode'] });
  await mockTimingRoute(page, options);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Tokens', exact: true })).toBeVisible();
}

async function selectAgent(page: Page, name: string) {
  await page.locator('button[aria-haspopup="menu"]').click();
  await page.getByRole('menuitemradio', { name }).click();
}

function timingRequest(page: Page, matches: (url: URL) => boolean) {
  return page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === '/api/timing' && matches(url);
  });
}

async function openTime(page: Page) {
  await page.getByRole('button', { name: 'Time', exact: true }).click();
  await expect(page.getByTestId('timing-summary')).toBeVisible();
}

async function expectKpi(page: Page, label: string, value: string) {
  const card = page.getByTestId('timing-summary').getByText(label, { exact: true }).locator('..');
  await expect(card.locator('p').first()).toHaveText(value);
}

async function expectChartBars(page: Page) {
  await page.clock.runFor(2_000);
  for (const title of ['Daily agent work time', 'Daily elapsed time', 'Project agent work time', 'Project elapsed time']) {
    const chart = page.getByRole('region', { name: title, exact: true });
    await expect.poll(() => chart.locator('.recharts-bar-rectangle path').evaluateAll(bars => bars.some(bar => {
      const bounds = (bar as SVGGraphicsElement).getBBox();
      return bounds.width > 1 && bounds.height > 1;
    })), { message: `${title} must render a visible non-zero bar` }).toBe(true);
  }
}

test.describe('Codex Time metric', () => {
  test('shows concurrent work, union elapsed time, and conversation-based averages in their own report', async ({ page }) => {
    const browserErrors: string[] = [];
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()); });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await setup(page);
    await expect(page.getByRole('button', { name: /^(Tokens|Cost|Time|Sessions)$/ })).toHaveText(['Tokens', 'Cost', 'Time', 'Sessions']);
    const request = timingRequest(page, url => url.searchParams.get('agent') === 'codex');
    await openTime(page);
    const query = new URL((await request).url()).searchParams;
    expect(query.get('startDate')).toBe(timingDate(1));
    expect(query.get('endDate')).toBe(timingDate());

    await expectKpi(page, 'Total agent work time', '5h 30m');
    await expectKpi(page, 'Daily avg work time', '2h 45m');
    await expectKpi(page, 'Total elapsed time', '3h 30m');
    await expectKpi(page, 'Daily avg elapsed time', '1h 45m');
    // 4h30m summed conversation elapsed / 4 conversations, not 3h30m / 4.
    await expectKpi(page, 'Avg conversation time', '1h 7m');
    // 4h of completed main Q&A / 5 turns. The aborted 30m, two children,
    // and system turn are excluded, and overlapping questions stay separate.
    await expectKpi(page, 'Avg turn time', '48m');
    await expect(page.getByTestId('timing-summary').getByText('Avg turn time', { exact: true }).locator('..')).toContainText('5 completed Q&A turns.');
    for (const title of ['Daily agent work time', 'Daily elapsed time', 'Project agent work time', 'Project elapsed time']) {
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    }
    await expectChartBars(page);
    await expect(page.getByTestId('timing-dashboard')).toContainText('o3');
    await expect(page.getByTestId('timing-dashboard')).toContainText('o4-mini');
    await expect(page.getByTestId('timing-dashboard')).toContainText('Asia/Shanghai');
    const detail = page.getByTestId('timing-detail');
    await expect(detail.getByRole('columnheader')).toHaveText(['Date', 'Agent work time', 'Elapsed time', 'Avg conversation time', 'Avg turn time']);
    await expect(detail.getByRole('row').filter({ hasText: timingDate() }).getByRole('cell')).toHaveText(['2h 30m', '1h 30m', '1h', '40m']);
    await expect(detail.getByRole('row').filter({ hasText: timingDate(1) }).getByRole('cell')).toHaveText(['3h', '2h', '1h 15m', '1h']);
    // Period average comes from completed-turn totals, not the mean of 40m and 1h.
    await expect(detail.locator('tfoot').getByRole('cell')).toHaveText(['5h 30m', '3h 30m', '1h 7m', '48m']);
    await expect(detail).not.toContainText(/NaN|Infinity/);
    await expect(page.getByText('Cache hit', { exact: true })).toHaveCount(0);
    await expect(page.getByText('2 ongoing or incomplete turns excluded.', { exact: true })).toBeVisible();
    await expect(page.getByText(/1 older turns? use[s]? estimated start or end boundaries\./)).toBeVisible();
    await page.reload();
    await expectKpi(page, 'Total agent work time', '5h 30m');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('dashboard_metric') || 'null'))).toBe('time');
    await expectChartBars(page);
    await page.screenshot({ path: 'tmp/time-redesign-validation/desktop.png', fullPage: true });
    await page.setViewportSize({ width: 1600, height: 1100 });
    await expectChartBars(page);
    const cardTops = await page.getByTestId('timing-summary').locator(':scope > div').evaluateAll(cards => cards.map(card => Math.round(card.getBoundingClientRect().top)));
    expect(cardTops).toHaveLength(6);
    expect(new Set(cardTops).size).toBe(1);
    await page.screenshot({ path: 'tmp/time-redesign-validation/wide.png', fullPage: true });
    expect(browserErrors).toEqual([]);
  });

  test('heatmap cells show accumulated agent durations, including more than one hour of parallel work', async ({ page }) => {
    await setup(page);
    await openTime(page);
    const request = timingRequest(page, url => url.searchParams.get('startDate') === timingDate());
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await request;
    await expectKpi(page, 'Total agent work time', '2h 30m');
    await expectKpi(page, 'Avg turn time', '40m');
    const heatmap = page.getByTestId('timing-heatmap');
    await expect(heatmap.getByText('24-Hour Activity Heatmap', { exact: true })).toBeVisible();
    // 09:00 contains a full main turn, 30m child and 30m second conversation.
    const peak = heatmap.locator('[data-work-ms="7200000"]');
    await expect(peak).toHaveCount(1);
    await expect(peak).toHaveAttribute('aria-label', /Today 09:00: 2h.*agent work time/);
    const total = await heatmap.locator('[data-work-ms]').evaluateAll(cells => cells.reduce((sum, cell) => sum + Number(cell.getAttribute('data-work-ms')), 0));
    expect(total).toBe(2.5 * 3_600_000);
  });

  test('Tokens and Cost retain their original summaries, charts, and detail columns', async ({ page }) => {
    await setup(page);
    for (const metric of ['Tokens', 'Cost']) {
      await page.getByRole('button', { name: metric, exact: true }).click();
      await expect(page.getByText('Cache hit', { exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Model trend', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Project distribution', exact: true })).toBeVisible();
      await expect(page.getByTestId('timing-dashboard')).toHaveCount(0);
      await expect(page.getByText('Total agent work time', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('columnheader', { name: /work time|elapsed time/i })).toHaveCount(0);
    }
    await openTime(page);
    await page.getByRole('button', { name: 'Tokens', exact: true }).click();
    await expect(page.locator('span:text-is("Total tokens")')).toBeVisible();
    await expect(page.getByTestId('timing-dashboard')).toHaveCount(0);
  });

  test('only Codex exposes Time and switching agents restores a supported metric', async ({ page }) => {
    await setup(page);
    await openTime(page);
    await selectAgent(page, 'Claude Code');
    await expect(page.getByRole('button', { name: 'Time', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^(Tokens|Cost|Time|Sessions)$/ })).toHaveText(['Tokens', 'Cost', 'Sessions']);
    await expect(page.locator('span:text-is("Total tokens")')).toBeVisible();
    await selectAgent(page, '所有 Agent');
    await expect(page.getByRole('button', { name: 'Time', exact: true })).toHaveCount(0);
    await expect(page.locator('span:text-is("Total tokens")')).toBeVisible();
    await selectAgent(page, 'Codex');
    await expect(page.getByRole('button', { name: 'Time', exact: true })).toBeVisible();
  });

  for (const agent of ['claude', 'all']) {
    test(`a stored Time metric falls back for ${agent}`, async ({ page }) => {
      await setup(page, { metric: 'time', agent });
      await expect(page.getByRole('button', { name: 'Time', exact: true })).toHaveCount(0);
      await expect(page.locator('span:text-is("Total tokens")')).toBeVisible();
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('dashboard_metric') || 'null'))).toBe('tokens');
    });
  }

  test('custom date and recent-day modes send inclusive bounds and refresh report totals', async ({ page }) => {
    await setup(page);
    await openTime(page);
    await page.getByRole('button', { name: 'Custom', exact: true }).click();
    await page.getByLabel('Start date', { exact: true }).fill(timingDate(1));
    await page.getByLabel('End date', { exact: true }).fill(timingDate(1));
    const datesRequest = timingRequest(page, url => url.searchParams.get('startDate') === timingDate(1) && url.searchParams.get('endDate') === timingDate(1));
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await datesRequest;
    await expectKpi(page, 'Total agent work time', '3h');
    await expectKpi(page, 'Avg turn time', '1h');
    await expect(page.getByTestId('timing-detail').locator('tbody tr')).toHaveCount(1);
    await page.getByRole('button', { name: 'Last X days', exact: true }).click();
    await page.getByRole('combobox', { name: 'Quick choices', exact: true }).selectOption('7');
    await page.getByLabel('Number of days', { exact: true }).fill('3');
    const recentRequest = timingRequest(page, url => url.searchParams.get('startDate') === timingDate(2) && url.searchParams.get('endDate') === timingDate());
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await recentRequest;
    await expectKpi(page, 'Total agent work time', '6h');
    await expectKpi(page, 'Daily avg work time', '2h');
    await expectKpi(page, 'Avg turn time', '45m');
    await expect(page.getByTestId('timing-detail').locator('tbody tr')).toHaveCount(3);
    // Unequal daily conversation/turn counts require the period denominators.
    // Averaging daily averages would incorrectly give 55m and 43m20s here.
    await expect(page.getByTestId('timing-detail').locator('tfoot').getByRole('cell')).toHaveText(['6h', '4h', '1h', '45m']);
    await page.getByRole('button', { name: '7D', exact: true }).click();
    // The four empty days still contribute to the calendar-day denominator.
    await expect(page.getByRole('checkbox', { name: 'Exclude zero-usage days', exact: true })).not.toBeChecked();
    await expectKpi(page, 'Daily avg work time', '51m 25s');
    await expectKpi(page, 'Daily avg elapsed time', '34m 17s');
    await expectKpi(page, 'Avg turn time', '45m');
    await expect(page.getByTestId('timing-detail').locator('tbody tr')).toHaveCount(7);
    await expect(page.getByTestId('timing-detail').getByRole('row').filter({ hasText: timingDate(6) }).getByRole('cell')).toHaveText(['0s', '0s', '—', '—']);
  });

  test('excluding zero-usage days changes only daily averages and persists across reloads, metrics, and project filters', async ({ page }) => {
    await setup(page);
    await openTime(page);
    await page.getByRole('button', { name: '7D', exact: true }).click();
    await expectKpi(page, 'Daily avg work time', '51m 25s');
    await expectKpi(page, 'Daily avg elapsed time', '34m 17s');
    const excludeZeroDays = page.getByRole('checkbox', { name: 'Exclude zero-usage days', exact: true });
    await expect(excludeZeroDays).not.toBeChecked();
    const detail = page.getByTestId('timing-detail');
    const previousRows = await detail.getByRole('row').allTextContents();
    await expectChartBars(page);
    const chartBars = page.getByTestId('timing-dashboard').locator('.recharts-bar-rectangle path');
    const previousShapes = await chartBars.evaluateAll(bars => bars.map(bar => bar.getAttribute('d')));
    const timingRequests: string[] = [];
    const recordTimingRequest = (request: import('@playwright/test').Request) => {
      if (new URL(request.url()).pathname === '/api/timing') timingRequests.push(request.url());
    };
    page.on('request', recordTimingRequest);

    await excludeZeroDays.check();
    await expectKpi(page, 'Daily avg work time', '2h');
    await expectKpi(page, 'Daily avg elapsed time', '1h 20m');
    await expectKpi(page, 'Total agent work time', '6h');
    await expectKpi(page, 'Total elapsed time', '4h');
    await expectKpi(page, 'Avg conversation time', '1h');
    await expectKpi(page, 'Avg turn time', '45m');
    expect(await detail.getByRole('row').allTextContents()).toEqual(previousRows);
    await expectChartBars(page);
    expect(await chartBars.evaluateAll(bars => bars.map(bar => bar.getAttribute('d')))).toEqual(previousShapes);
    expect(timingRequests).toEqual([]);
    page.off('request', recordTimingRequest);
    await page.screenshot({ path: 'tmp/time-redesign-validation/exclude-zero-days.png', fullPage: true });

    await page.reload();
    await expect(excludeZeroDays).toBeChecked();
    await expectKpi(page, 'Daily avg work time', '2h');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('dashboard_timing_exclude_zero_days') || 'null'))).toBe(true);
    const refreshRequest = timingRequest(page, url => url.searchParams.get('refresh') === '1');
    await page.getByRole('button', { name: '刷新数据（每 60 秒自动刷新）' }).click();
    await refreshRequest;
    await expect(excludeZeroDays).toBeChecked();
    await expectKpi(page, 'Daily avg elapsed time', '1h 20m');
    await page.getByRole('button', { name: 'Tokens', exact: true }).click();
    await expect(excludeZeroDays).toHaveCount(0);
    await openTime(page);
    await expect(excludeZeroDays).toBeChecked();
    await expectKpi(page, 'Daily avg elapsed time', '1h 20m');

    // This project has activity on two dates, instead of the overall three.
    const project = page.getByRole('combobox', { name: 'Project', exact: true });
    await project.selectOption(TIMING_ONLY_PROJECT);
    await expectKpi(page, 'Total agent work time', '2h 30m');
    await expectKpi(page, 'Daily avg work time', '1h 15m');
    await expectKpi(page, 'Daily avg elapsed time', '1h 15m');
    await expect(detail.locator('tbody tr')).toHaveCount(7);
    await project.selectOption('');
    await expectKpi(page, 'Daily avg work time', '2h');
    await excludeZeroDays.uncheck();
    await expectKpi(page, 'Daily avg work time', '51m 25s');
    await expectKpi(page, 'Daily avg elapsed time', '34m 17s');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('dashboard_timing_exclude_zero_days') || 'null'))).toBe(false);
  });

  test('time-only projects are selectable and system-agent filtering reaches the API', async ({ page }) => {
    await setup(page);
    await openTime(page);
    const project = page.getByRole('combobox', { name: 'Project', exact: true });
    await expect(project.locator(`option[value="${TIMING_ONLY_PROJECT}"]`)).toHaveCount(1);
    const projectRequest = timingRequest(page, url => url.searchParams.get('project') === TIMING_ONLY_PROJECT);
    await project.selectOption(TIMING_ONLY_PROJECT);
    await projectRequest;
    await expectKpi(page, 'Total agent work time', '2h 30m');
    await expectKpi(page, 'Total elapsed time', '2h 30m');
    await expectKpi(page, 'Avg turn time', '1h');
    const mainRequest = timingRequest(page, url => url.searchParams.get('project') === TIMING_PROJECT);
    await project.selectOption(TIMING_PROJECT);
    await mainRequest;
    await expectKpi(page, 'Total agent work time', '3h');
    await expectKpi(page, 'Avg conversation time', '1h');
    await expectKpi(page, 'Avg turn time', '40m');
    const includeSystem = page.getByRole('checkbox', { name: 'Include system agents', exact: true });
    await expect(includeSystem).not.toBeChecked();
    const systemRequest = timingRequest(page, url => url.searchParams.get('includeSystem') === 'true' && url.searchParams.get('project') === TIMING_PROJECT);
    await includeSystem.check();
    await systemRequest;
    await expectKpi(page, 'Total agent work time', '3h 30m');
    await expectKpi(page, 'Total elapsed time', '2h 30m');
    await expectKpi(page, 'Avg conversation time', '1h');
    await expectKpi(page, 'Avg turn time', '40m');
  });

  test('empty timing history keeps zero totals finite', async ({ page }) => {
    await setup(page, { empty: true });
    await openTime(page);
    await page.getByRole('checkbox', { name: 'Exclude zero-usage days', exact: true }).check();
    for (const label of ['Total agent work time', 'Daily avg work time', 'Total elapsed time', 'Daily avg elapsed time']) {
      await expectKpi(page, label, '0s');
    }
    await expectKpi(page, 'Avg conversation time', '—');
    await expectKpi(page, 'Avg turn time', '—');
    await expect(page.getByTestId('timing-dashboard')).not.toContainText(/NaN|Infinity/);
    await expect(page.getByText('No agent work intervals overlap the selected period and project.', { exact: true })).toBeVisible();
    await expect(page.getByTestId('timing-detail').locator('tbody tr')).toHaveCount(2);
    await expect(page.getByTestId('timing-detail').locator('tbody tr').first().getByRole('cell')).toHaveText(['0s', '0s', '—', '—']);
    await expect(page.getByTestId('timing-detail').locator('tfoot').getByRole('cell')).toHaveText(['0s', '0s', '—', '—']);
  });

  test('a main answer completed at midnight retains its full turn average with no work in the selected day', async ({ page }) => {
    await setup(page);
    await page.route('**/api/timing?*', async route => {
      const response = generateTimingResponse(new URL(route.request().url()), true);
      // A main turn from yesterday 23:00 to today 00:00 is counted by its
      // completion date, while [start, end) work intervals contribute no time today.
      response.totals.completedTurnCount = 1;
      response.totals.completedTurnElapsedMs = 3_600_000;
      response.daily = [{
        date: timingDate(), workMs: 0, elapsedMs: 0, models: {},
        conversationCount: 0, conversationElapsedMs: 0,
        completedTurnCount: 1, completedTurnElapsedMs: 3_600_000,
      }];
      await route.fulfill({ json: response });
    });
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await openTime(page);
    await page.getByRole('checkbox', { name: 'Exclude zero-usage days', exact: true }).check();
    await expectKpi(page, 'Total agent work time', '0s');
    await expectKpi(page, 'Daily avg work time', '0s');
    await expectKpi(page, 'Daily avg elapsed time', '0s');
    await expectKpi(page, 'Avg conversation time', '—');
    await expectKpi(page, 'Avg turn time', '1h');
    await expect(page.getByTestId('timing-dashboard')).not.toContainText(/NaN|Infinity/);
    await expect(page.getByText('No agent work intervals overlap the selected period and project.', { exact: true })).toBeVisible();
    await expect(page.getByTestId('timing-detail').locator('tbody tr').getByRole('cell')).toHaveText(['0s', '0s', '—', '1h']);
    await expect(page.getByTestId('timing-detail').locator('tfoot').getByRole('cell')).toHaveText(['0s', '0s', '—', '1h']);
  });

  test('timing request errors remain visible and do not break Tokens', async ({ page }) => {
    await setup(page, { error: true });
    await page.getByRole('button', { name: 'Time', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await mockTimingRoute(page);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expectKpi(page, 'Total agent work time', '5h 30m');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: 'Tokens', exact: true }).click();
    await expect(page.locator('span:text-is("Total tokens")')).toBeVisible();
  });

  test('a stored Time report can load independently of failed token usage requests', async ({ page }) => {
    await setup(page, { metric: 'time' });
    await expectKpi(page, 'Total agent work time', '5h 30m');
    await page.route('**/api/daily?*', route => route.fulfill({ status: 500, json: { error: 'Usage fixture unavailable' } }));
    await page.reload();
    await expectKpi(page, 'Total agent work time', '5h 30m');
    await expect(page.getByTestId('timing-detail')).toBeVisible();
  });

  test('Time report fits a narrow viewport with readable summary and detail', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setup(page);
    await openTime(page);
    await expectKpi(page, 'Total agent work time', '5h 30m');
    const excludeZeroDays = page.getByRole('checkbox', { name: 'Exclude zero-usage days', exact: true });
    await expect(excludeZeroDays).toBeVisible();
    const toggleBounds = await excludeZeroDays.locator('..').boundingBox();
    expect(toggleBounds).not.toBeNull();
    expect(toggleBounds!.x).toBeGreaterThanOrEqual(0);
    expect(toggleBounds!.x + toggleBounds!.width).toBeLessThanOrEqual(390);
    for (const id of ['timing-summary', 'timing-heatmap', 'timing-detail']) {
      const panel = page.getByTestId(id);
      const bounds = await panel.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const detail = page.getByTestId('timing-detail');
    const tableScroller = detail.locator('table').locator('..');
    expect(await tableScroller.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    expect(await tableScroller.evaluate(element => getComputedStyle(element).overflowX)).toMatch(/auto|scroll/);
    await tableScroller.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    expect(await tableScroller.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    const lastColumn = await detail.getByRole('columnheader', { name: 'Avg turn time', exact: true }).boundingBox();
    expect(lastColumn).not.toBeNull();
    expect(lastColumn!.x + lastColumn!.width).toBeLessThanOrEqual(390);
    await detail.screenshot({ path: 'tmp/time-redesign-validation/mobile-detail.png' });
    await tableScroller.evaluate(element => { element.scrollLeft = 0; });
    await expectChartBars(page);
    await page.screenshot({ path: 'tmp/time-redesign-validation/mobile.png', fullPage: true });
  });
});
