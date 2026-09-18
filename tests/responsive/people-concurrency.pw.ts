import { expect, test, type Page } from '@playwright/test';
import { addCalendarDays } from '../../src/shared/domain';

async function mockPeople(page: Page, initiallyUnavailable = false, count = 5) {
  let unavailable = initiallyUnavailable;
  const ranges: string[] = [];
  const people = Array.from({ length: count }, (_, index) => ({
    id: `person-${index}`, name: `人员${index}·跨项目协同验证长姓名`, jobTitle: '资产与机房基础设施平台开发工程师', active: true,
  }));
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/session') return route.fulfill({ json: { authenticated: true, accountId: 'admin', username: 'admin', globalRole: 'admin', personId: null, mustChangePassword: false, managedProjectIds: [] } });
    if (url.pathname === '/api/projects') return route.fulfill({ json: [{ id: 'people-project', name: '人员并发验证', status: 'active' }] });
    if (url.pathname === '/api/people') return route.fulfill({ json: people });
    if (url.pathname === '/api/analytics/people-concurrency') {
      const from = url.searchParams.get('from') || '2026-09-14';
      ranges.push(from);
      if (unavailable) return route.fulfill({ status: 503, json: { message: '临时读取失败' } });
      const dates = Array.from({ length: 5 }, (_, index) => addCalendarDays(from, index));
      const rows = people.filter(person => !url.searchParams.get('personId') || url.searchParams.get('personId') === person.id).map(person => ({
        ...person, currentCount: 2, peakCount: 2,
        days: dates.map(date => ({ date, count: 2, plannedCount: 2, actualCount: 2, items: [] })),
      }));
      return route.fulfill({ json: { asOfDate: '2026-09-14', from, to: addCalendarDays(from, 6), dates, people: rows, currentTop: rows.slice(0, 5) } });
    }
    return route.fulfill({ json: {} });
  });
  return { recover: () => { unavailable = false; }, ranges };
}

test('人员并发重试后适配窗口，纵向查看不加载日期而向右滚动继续加载', async ({ page }, info) => {
  const server = await mockPeople(page, true, 50);
  await page.goto('/people?view=analysis');
  await expect(page.getByText('人力分析加载失败', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1920, height: 1080 });
  server.recover();
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  const table = page.getByRole('table', { name: '人员工作日并发度矩阵' });
  await expect(table.locator('tbody tr')).toHaveCount(50);
  await page.screenshot({ path: info.outputPath('recovered-wide.png'), animations: 'disabled' });
  const widthDifference = () => table.evaluate(element => Math.abs(element.getBoundingClientRect().width - element.closest('.human-matrix-scroll')!.clientWidth));
  await expect.poll(widthDifference).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1366, height: 768 });
  await expect.poll(widthDifference).toBeLessThanOrEqual(1);
  const matrix = page.locator('.human-matrix-scroll'), reads = server.ranges.length;
  await matrix.hover(); await page.mouse.wheel(0, 600);
  await expect.poll(() => matrix.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(server.ranges).toHaveLength(reads);
  await expect(table.locator('thead th')).toHaveCount(6);
  await matrix.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await expect(table.locator('thead th')).toHaveCount(11);
  expect(server.ranges.slice(reads)).toEqual(['2026-09-21']);
  await page.getByRole('button', { name: '回到今天', exact: true }).click();
  await expect.poll(() => matrix.evaluate(element => element.scrollLeft)).toBe(0);
  expect(server.ranges).toHaveLength(reads + 1);
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
