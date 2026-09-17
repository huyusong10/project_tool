import { expect, test, type Page } from '@playwright/test';

async function mockPeople(page: Page, initiallyUnavailable = false) {
  let unavailable = initiallyUnavailable;
  const people = Array.from({ length: 5 }, (_, index) => ({
    id: `person-${index}`, name: `人员${index}·跨项目协同验证长姓名`, jobTitle: '资产与机房基础设施平台开发工程师', active: true,
  }));
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/session') return route.fulfill({ json: { authenticated: true, accountId: 'admin', username: 'admin', globalRole: 'admin', personId: null, mustChangePassword: false, managedProjectIds: [] } });
    if (url.pathname === '/api/projects') return route.fulfill({ json: [{ id: 'people-project', name: '人员并发验证', status: 'active' }] });
    if (url.pathname === '/api/people') return route.fulfill({ json: people });
    if (url.pathname === '/api/analytics/people-concurrency') {
      if (unavailable) return route.fulfill({ status: 503, json: { message: '临时读取失败' } });
      const dates = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'];
      const rows = people.filter(person => !url.searchParams.get('personId') || url.searchParams.get('personId') === person.id).map(person => ({
        ...person, currentCount: 2, peakCount: 2,
        days: dates.map(date => ({ date, count: 2, plannedCount: 2, actualCount: 2, items: [] })),
      }));
      return route.fulfill({ json: { asOfDate: '2026-09-14', from: '2026-09-14', to: '2026-09-20', dates, people: rows, currentTop: rows } });
    }
    return route.fulfill({ json: {} });
  });
  return { recover: () => { unavailable = false; } };
}

test('人员并发首次失败重试后，表格继续适配窗口宽度', async ({ page }, info) => {
  const server = await mockPeople(page, true);
  await page.goto('/people?view=analysis');
  await expect(page.getByText('人力分析加载失败', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1920, height: 1080 });
  server.recover();
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  const table = page.getByRole('table', { name: '人员工作日并发度矩阵' });
  await expect(table.locator('tbody tr')).toHaveCount(5);
  await page.screenshot({ path: info.outputPath('recovered-wide.png'), animations: 'disabled' });
  const widthDifference = () => table.evaluate(element => Math.abs(element.getBoundingClientRect().width - element.closest('.human-matrix-scroll')!.clientWidth));
  await expect.poll(widthDifference).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1366, height: 768 });
  await expect.poll(widthDifference).toBeLessThanOrEqual(1);
});

test('人力分析往返和刷新保留筛选，人员矩阵的搜索互不影响', async ({ page }) => {
  await mockPeople(page);
  await page.goto('/people?view=analysis');
  const filters=page.locator('.human-filter-bar select');
  const jobTitle='资产与机房基础设施平台开发工程师';
  await filters.nth(0).selectOption(jobTitle);
  await filters.nth(1).selectOption('person-2');
  const rows=page.getByRole('table',{name:'人员工作日并发度矩阵'}).locator('tbody tr');
  await expect(rows).toHaveCount(1);await expect(rows).toContainText('人员2');
  const views=page.getByRole('group',{name:'人员页面视图'});
  await views.getByRole('button',{name:'人员矩阵',exact:true}).click();
  const search=page.getByRole('searchbox');
  await search.fill('人员3');
  await views.getByRole('button',{name:'人力分析',exact:true}).click();
  await expect(filters.nth(0)).toHaveValue(jobTitle);
  await expect(filters.nth(1)).toHaveValue('person-2');
  await expect(rows).toHaveCount(1);
  await page.reload();await expect(filters.nth(1)).toHaveValue('person-2');
  await page.goto('/projects');await page.goto('/people');
  await expect(filters.nth(1)).toHaveValue('person-2');await expect(rows).toHaveCount(1);
  await filters.nth(0).selectOption('');
  await expect(filters.nth(1)).toHaveValue('');await expect(rows).toHaveCount(5);
  await views.getByRole('button',{name:'人员矩阵',exact:true}).click();
  await expect(search).toHaveValue('人员3');
  await views.getByRole('button',{name:'人力分析',exact:true}).click();
  await expect(filters.nth(0)).toHaveValue('');await expect(filters.nth(1)).toHaveValue('');
  await expect(rows).toHaveCount(5);
});

test('人员并发窄屏长姓名下，今日工作数量和返回今天入口可见', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockPeople(page);
  await page.goto('/people?view=analysis');
  const leaders = page.getByRole('region', { name: '今日工作最多人员' });
  await expect(leaders.locator('article')).toHaveCount(5);
  await page.screenshot({ path: info.outputPath('narrow-people.png'), animations: 'disabled' });
  const back = page.getByRole('button', { name: '回到今天', exact: true });
  const bounds = await back.boundingBox();
  const frame = await page.locator('.human-matrix-frame').boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(frame!.x + frame!.width);
  const count = await leaders.locator('article').first().locator('em').boundingBox();
  const leaderBounds = await leaders.boundingBox();
  expect(count!.x + count!.width).toBeLessThanOrEqual(leaderBounds!.x + leaderBounds!.width);
  expect((await page.locator('.human-matrix-heading').boundingBox())!.height).toBeLessThan(120);
  await leaders.locator(':scope > div').evaluate(element => { element.scrollLeft = element.scrollWidth; });
  const lastCount = await leaders.locator('article').last().locator('em').boundingBox();
  expect(lastCount!.x + lastCount!.width).toBeLessThanOrEqual(leaderBounds!.x + leaderBounds!.width);
  expect(lastCount!.x).toBeGreaterThanOrEqual(leaderBounds!.x);
  await back.click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
