import { expect, test, type Page } from '@playwright/test';
import { analyticsCatalog, type AnalyticsPanelConfig } from '../../src/shared/analytics';
import { mockGanttData, requirement } from './gantt-fixture';

async function setup(page: Page) {
  await mockGanttData(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const items = [
    { ...requirement, id: 'pending', title: '待验收样本', status: 'pending_acceptance', progress: 100, riskLevel: 'high', highRisk: true, riskReason: '验收条件阻塞项目交付' },
    { ...requirement, id: 'planning', title: '待规划样本', status: 'planning', plannedStart: null, plannedEnd: null, scheduleComplete: false, riskEvaluated: false, workItems: [] },
    ...Array.from({ length: 25 }, (_, i) => ({ ...requirement, id: `r${i}`, title: `普通样本 ${String(i).padStart(2, '0')}` })),
  ];
  await page.route('**/api/requirements**', route => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: url.pathname === '/api/requirements' ? items : items.find(r => url.pathname === '/api/requirements/' + r.id) || requirement });
  });
  await page.route('**/api/action-items?**', route => {
    const current = Number(new URL(route.request().url()).searchParams.get('page') || 1);
    return route.fulfill({ json: { asOfDate: '2026-09-09', total: 40, pages: 2, page: current, pageSize: 20,
      summary: { total: 40, high: 40, medium: 0, low: 0, byReason: {} }, ownerOptions: [],
      items: [{ id: 'a', title: '处理验收阻塞', severity: 'high', reasons: [{ label: '验收阻塞' }], targetPath: '/requirements/pending', overdueWorkdays: 0 }],
    } });
  });
  return items;
}

test('列表与详情共享风险和偏差含义，返回、刷新恢复查询和排序', async ({ page }) => {
  await setup(page);
  await page.goto('/requirements');
  await page.getByPlaceholder('搜索需求或负责人').fill('待验收');
  await page.getByRole('button', { name: '风险', exact: true }).click();
  const source = page.url();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr')).toContainText('高风险');
  await page.getByRole('link', { name: '待验收样本', exact: true }).click();
  await expect(page.locator('.detail-kpis article').last()).toContainText('高风险');
  await expect(page.getByText('风险已关闭', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page).toHaveURL(source);
  await expect(page.getByPlaceholder('搜索需求或负责人')).toHaveValue('待验收');
  await page.reload();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.goto('/requirements?q=待规划');
  await expect(page.locator('tbody tr')).toContainText('待排期');
  await page.getByRole('link', { name: '待规划样本', exact: true }).click();
  await expect(page.locator('.detail-kpis article').nth(2)).toContainText('待排期');
  await expect(page.locator('.detail-kpis article').nth(2)).not.toContainText('0 工作日');
});

test('长列表往返恢复滚动；侧栏重新进入恢复原筛选；显式链接优先', async ({ page }) => {
  await setup(page);
  await page.goto('/requirements?q=普通&sort=title&direction=asc');
  const target = page.getByRole('link', { name: '普通样本 20', exact: true });
  await target.scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => scrollY);
  await target.click();
  await expect(page.locator('.requirement-page')).toBeVisible();
  await page.goBack();
  await expect(target).toBeVisible();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(scroll - 5);
  await page.goto('/requirements');
  await expect(page.getByPlaceholder('搜索需求或负责人')).toHaveValue('普通');
  await page.goto('/requirements?q=待规划');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr')).toContainText('待规划样本');
});

test('异常行动的自动优先级和分页在往返后保持', async ({ page }) => {
  await setup(page);
  await page.goto('/actions?severity=high&page=2');
  await expect(page.getByLabel('严重度')).toHaveValue('high');
  await page.getByRole('button', { name: /处理验收阻塞/ }).click();
  await expect(page.locator('.requirement-page')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/severity=high&page=2/);
  await expect(page.getByLabel('严重度')).toHaveValue('high');
  await page.goto('/actions');
  await expect(page).toHaveURL(/page=2/);
});

test('项目之间分别记忆筛选，显式链接不混入历史条件', async ({ page }) => {
  await setup(page);
  await page.route('**/api/projects', route => route.fulfill({ json: [
    { id: 'p1', name: '第一项目', status: 'active' }, { id: 'p2', name: '第二项目', status: 'active' },
  ] }));
  await page.goto('/requirements?q=普通');
  await expect(page.getByPlaceholder('搜索需求或负责人')).toHaveValue('普通');
  await page.locator('.project-switcher-button').click();
  await page.getByRole('option', { name: '第二项目' }).click();
  await expect(page.getByPlaceholder('搜索需求或负责人')).toHaveValue('');
  await page.getByPlaceholder('搜索需求或负责人').fill('待验收');
  await page.locator('.project-switcher-button').click();
  await page.getByRole('option', { name: '第一项目' }).click();
  await expect(page.getByPlaceholder('搜索需求或负责人')).toHaveValue('普通');
  await page.goto('/requirements?status=pending_acceptance');
  await expect(page.getByPlaceholder('搜索需求或负责人')).toHaveValue('');
  await expect(page.locator('tbody tr')).toHaveCount(1);
});

test('问题全部状态与分页在刷新后保持', async ({ page }) => {
  await setup(page);
  await page.route('**/api/issues?**', route => route.fulfill({ json: {
    items: [], total: 120, pages: 3, page: Number(new URL(route.request().url()).searchParams.get('page') || 1), pageSize: 50,
    summary: { total: 120, active: 120, inProgress: 120, deferred: 0, resolved: 0, highPriority: 0, overdue: 0, unassigned: 0 },
  } }));
  await page.goto('/issues?status=&page=2');
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator('.table-pagination')).toContainText('第 2 / 3 页');
  await page.reload();
  await expect(page).toHaveURL(/status=&page=2/);
  await expect(page.locator('.table-pagination')).toContainText('第 2 / 3 页');
});

test('统计页区分零数量、无完成样本和真实零按期率，并恢复时间范围', async ({ page }) => {
  await setup(page);
  const panels: AnalyticsPanelConfig[] = [
    { id: 'rate', title: '按期完成率', dataset: 'requirements', measure: 'on_time_rate', visualization: 'kpi', size: 'small', timeScope: 'range' },
    { id: 'count', title: '完成数量', dataset: 'requirements', measure: 'completed_count', visualization: 'kpi', size: 'small', timeScope: 'range' },
  ];
  let sampleCount = 0;
  await page.route('**/api/analytics/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('catalog')) return route.fulfill({ json: analyticsCatalog });
    if (path.endsWith('layout')) return route.fulfill({ json: { layout: { version: 1, panels }, canCustomize: true, source: 'default', updatedAt: null } });
    return route.fulfill({ json: { asOfDate: '2026-09-09', results: panels.map(p => ({ panelId: p.id, rows: [{ key: 'total', label: '总计', value: 0, sampleCount }], measureLabel: p.title, unit: p.id === 'rate' ? 'percent' : 'count', snapshot: false })) } });
  });
  await page.goto('/analytics');
  await expect(page.locator('.analytics-kpi').first()).toContainText('暂无完成样本');
  await expect(page.locator('.analytics-kpi strong').nth(1)).toHaveText('0');
  await page.getByRole('button', { name: '近30天', exact: true }).click();
  await page.goto('/requirements');
  await page.goto('/analytics');
  await expect(page).toHaveURL(/range=30/);
  sampleCount = 2;
  await page.reload();
  await expect(page.locator('.analytics-kpi strong').first()).toHaveText('0%');
});
