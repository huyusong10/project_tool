import { expect, test, type Page } from '@playwright/test';
import { analyticsCatalog, defaultAnalyticsLayout, type AnalyticsLayout } from '../../src/shared/analytics';

async function mockAnalytics(page: Page) {
  let layout = structuredClone(defaultAnalyticsLayout);
  let updatedAt = '2026-09-04T00:00:00.000Z';
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/session') return route.fulfill({ json: { authenticated: true, accountId: 'admin', username: 'admin', role: 'admin', globalRole: 'admin', personId: null, mustChangePassword: false, managedProjectIds: [] } });
    if (url.pathname === '/api/projects') return route.fulfill({ json: [{ id: 'p1', name: '分析测试项目', status: 'active', plannedStart: '2026-01-01', plannedEnd: '2026-12-31', defaultTemplateId: null, isSample: false }] });
    if (url.pathname === '/api/analytics/catalog') return route.fulfill({ json: analyticsCatalog });
    if (url.pathname === '/api/analytics/layout' && route.request().method() === 'GET') return route.fulfill({ json: { layout, source: 'personal', canCustomize: true, updatedAt } });
    if (url.pathname === '/api/analytics/query') return route.fulfill({ json: { range: route.request().postDataJSON().range, results: [] } });
    return route.fulfill({ json: {} });
  });
  return {
    setLayout(next: AnalyticsLayout, nextUpdatedAt: string) { layout = next; updatedAt = nextUpdatedAt; },
  };
}

test.describe('北京时间分析默认范围', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('自定义范围跨日更新系统默认并保留手动范围', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-05T15:59:30.000Z') });
    await mockAnalytics(page);
    await page.goto('/analytics');
    await page.getByRole('button', { name: '自定义', exact: true }).click();
    const from = page.getByLabel('分析开始日期', { exact: true });
    const to = page.getByLabel('分析结束日期', { exact: true });
    await expect(from).toHaveValue('2026-06-08');
    await expect(to).toHaveValue('2026-09-05');

    await page.clock.fastForward(90_000);
    await expect(from).toHaveValue('2026-06-09');
    await expect(to).toHaveValue('2026-09-06');

    await to.fill('2026-09-04');
    await page.clock.setSystemTime(new Date('2026-09-06T16:01:00.000Z'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(from).toHaveValue('2026-06-09');
    await expect(to).toHaveValue('2026-09-04');
  });
});

test('分析卡片显示服务端快照日期', async ({ page }) => {
  await mockAnalytics(page);
  await page.route('**/api/analytics/query', (route) => {
    const request = route.request().postDataJSON();
    return route.fulfill({ json: {
      asOfDate: '2026-02-16',
      range: request.range,
      results: request.panels.map((panel: { id: string; measure: string; timeScope: string }) => ({
        panelId: panel.id,
        rows: [{ key: 'all', label: '全部', value: 1 }],
        measureLabel: panel.measure,
        unit: 'count',
        snapshot: panel.timeScope === 'snapshot',
      })),
    } });
  });
  await page.goto('/analytics');
  const snapshot = page.locator('.analytics-panel').filter({ hasText: '活跃需求' });
  await expect(snapshot.locator('header span')).toHaveText('截至 2026-02-16');
  const future = page.locator('.analytics-panel').filter({ hasText: '未来30天到期需求' });
  await expect(future.locator('header span')).toHaveText('2026-02-16 起30天');
});

test('saving an analytics layout locks the draft and duplicate submit', async ({ page }) => {
  const server = await mockAnalytics(page);
  let releaseSave!: () => void;
  const waitingSave = new Promise<void>((resolve) => { releaseSave = resolve; });
  let requests = 0;
  const payloads: Array<Record<string, unknown>> = [];
  await page.route('**/api/analytics/layout', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    requests++;
    const body = route.request().postDataJSON() as AnalyticsLayout & { expectedUpdatedAt: string | null };
    payloads.push(body);
    const layout = { version: body.version, panels: body.panels } as AnalyticsLayout;
    await waitingSave;
    if (requests === 1) return route.fulfill({ status: 500, json: { error: '布局暂时无法保存' } });
    server.setLayout(layout, '2026-09-05T00:00:00.000Z');
    return route.fulfill({ json: { layout, source: 'personal', canCustomize: true, updatedAt: '2026-09-05T00:00:00.000Z' } });
  });

  try {
    await page.goto('/analytics');
    await page.getByRole('button', { name: '编辑看板', exact: true }).click();
    const save = page.getByRole('button', { name: '保存布局', exact: true });
    await save.evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect.poll(() => requests).toBe(1);
    await expect(save).toBeDisabled();
    await expect(page.getByRole('button', { name: '取消编辑', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '新增图表', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '恢复默认', exact: true })).toBeDisabled();
    await expect(page.locator('.analytics-drag-handle').first()).toBeDisabled();
    await expect(page.locator('.analytics-panel-actions button').first()).toBeDisabled();
  } finally { releaseSave(); }
  await expect(page.getByText('布局暂时无法保存', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存布局', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '取消编辑', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '保存布局', exact: true }).click();
  await expect.poll(() => requests).toBe(2);
  expect(payloads.map((payload) => payload.expectedUpdatedAt)).toEqual(['2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z']);
  await expect(page.getByRole('button', { name: '编辑看板', exact: true })).toBeVisible();
});

test('stale analytics draft reloads the latest layout before retrying', async ({ page }) => {
  const server = await mockAnalytics(page);
  const expectedVersions: Array<string | null> = [];
  let requests = 0;
  await page.route('**/api/analytics/layout', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    requests++;
    const body = route.request().postDataJSON() as AnalyticsLayout & { expectedUpdatedAt: string | null };
    expectedVersions.push(body.expectedUpdatedAt);
    if (requests === 1) {
      const latest = structuredClone(defaultAnalyticsLayout);
      latest.panels[0].title = '其他会话保存的布局';
      server.setLayout(latest, '2026-09-05T00:00:00.000Z');
      return route.fulfill({ status: 409, json: { error: '个人分析布局已被其他会话修改，请重新读取后再保存', code: 'STALE_WRITE' } });
    }
    const layout = { version: body.version, panels: body.panels } as AnalyticsLayout;
    return route.fulfill({ json: { layout, source: 'personal', canCustomize: true, updatedAt: '2026-09-06T00:00:00.000Z' } });
  });

  await page.goto('/analytics');
  await page.getByRole('button', { name: '编辑看板', exact: true }).click();
  await page.getByRole('button', { name: '保存布局', exact: true }).click();
  await expect(page.getByRole('button', { name: '放弃草稿并读取最新布局', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '放弃草稿并读取最新布局', exact: true }).click();
  await expect(page.getByText('其他会话保存的布局', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保存布局', exact: true }).click();
  await expect.poll(() => requests).toBe(2);
  expect(expectedVersions).toEqual(['2026-09-04T00:00:00.000Z', '2026-09-05T00:00:00.000Z']);
});

test('analytics layout result unknown reads back and confirms the saved layout', async ({ page }) => {
  const server = await mockAnalytics(page);
  let requests = 0;
  await page.route('**/api/analytics/layout', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    requests++;
    const body = route.request().postDataJSON() as AnalyticsLayout & { expectedUpdatedAt: string | null };
    server.setLayout({ version: body.version, panels: body.panels }, '2026-09-05T00:00:00.000Z');
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>invalid write response</html>' });
  });
  await page.goto('/analytics');
  await page.getByRole('button', { name: '编辑看板', exact: true }).click();
  const save = page.getByRole('button', { name: '保存布局', exact: true });
  await save.click();
  await expect(page.getByRole('button', { name: '编辑看板', exact: true })).toBeVisible();
  await expect(page.getByText(/操作结果暂时无法确认/)).toHaveCount(0);
  expect(requests).toBe(1);
});

test('analytics layout reset result unknown reads back and confirms the default layout', async ({ page }) => {
  await mockAnalytics(page);
  let personal = true;
  let requests = 0;
  await page.route('**/api/analytics/layout', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: {
      layout: defaultAnalyticsLayout,
      source: personal ? 'personal' : 'default',
      canCustomize: true,
      updatedAt: personal ? '2026-09-04T00:00:00.000Z' : null,
    } });
    if (route.request().method() !== 'DELETE') return route.fallback();
    requests++;
    personal = false;
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>invalid write response</html>' });
  });

  await page.goto('/analytics');
  await page.getByRole('button', { name: '编辑看板', exact: true }).click();
  await page.getByRole('button', { name: '恢复默认', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '恢复默认看板', exact: true });
  await dialog.getByRole('button', { name: '恢复默认', exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: '编辑看板', exact: true })).toBeVisible();
  await expect(page.getByText(/操作结果暂时无法确认/)).toHaveCount(0);
  expect(requests).toBe(1);
});
