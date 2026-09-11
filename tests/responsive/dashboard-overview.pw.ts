import { expect, test, type Page } from '@playwright/test';
import { mockGanttData, requirement } from './gantt-fixture';
import type { Requirement } from '../../src/client/types';
import { dashboardOverview } from '../../src/shared/dashboard';

const row = (id: string, extra: Partial<Requirement> = {}) => ({ ...requirement, id, title: id,
  plannedEnd: '2026-09-17', createdAt: '2026-08-01T00:00:00.000Z', riskLevel: 'low', highRisk: false, delayed: false, ...extra });
const fixtureRows = () => [
  row('正常进行'),
  row('进行且延期', { plannedEnd: '2026-09-09', highRisk: true, delayed: true, riskLevel: 'high' }),
  row('未开始高风险', { status: 'not_started', plannedEnd: '2026-09-16', highRisk: true, riskLevel: 'high' }),
  row('排期待确认', { plannedStart: null, plannedEnd: null, scheduleComplete: false, riskEvaluated: false }),
  row('最近完成但曾延期', { status: 'completed', actualEnd: '2026-09-08', executionCompletedAt: '2026-09-08', highRisk: true, delayed: true }),
  row('历史完成', { status: 'completed', actualEnd: '2026-08-01' }),
  row('已取消', { status: 'cancelled', actualEnd: '2026-09-10', highRisk: true, delayed: true }),
  row('最近新增', { status: 'not_started', plannedEnd: '2026-09-25', createdAt: '2026-09-11T00:00:00.000Z' }),
];
async function setup(page: Page, fallback = false) {
  await mockGanttData(page);
  const state = { asOfDate: '2026-09-11', rows: fixtureRows() };
  await page.route('**/api/dashboard**', route => route.fulfill({ json: {
    asOfDate: state.asOfDate,
    summary: { total: 8, active: 5, completed: 2, delayed: 3, highRisk: 4, completionRate: 25 },
    ...fallback ? {} : { overview: dashboardOverview(state.rows, state.asOfDate) },
    requirements: state.rows, issues: { summary: {}, attention: [] }, charts: { statuses: [], risks: [], weeks: [], varianceTop: [] },
  } }));
  return state;
}
const cards = (page: Page) => page.locator('.dashboard-top-stats');
const selectCard = (page: Page, label: string) => cards(page).getByRole('button', { name: new RegExp(`^${label} \\d+ 项$`) }).click();
async function expectRows(page: Page, names: string[]) {
  await expect(page.locator('.gantt-requirement-link')).toHaveCount(names.length);
  expect((await page.locator('.gantt-requirement-link').allTextContents()).sort()).toEqual([...names].sort());
}

test('四卡统计、主按钮和辅助入口使用同一范围，旧搜索不会吞掉卡片结果', async ({ page }) => {
  await setup(page); await page.goto('/');
  await expect(cards(page).locator('.stat-card strong')).toHaveText(['3', '2', '2', '1']);
  await expect(cards(page)).not.toContainText('完成率');
  await expectRows(page, ['正常进行', '进行且延期', '排期待确认']);
  await page.getByPlaceholder('搜索需求、工作项或拼音').fill('完全不匹配');
  await page.getByLabel('按人员筛选', { exact: true }).selectOption('u1');
  await expect(page.locator('.gantt-requirement-link')).toHaveCount(0);
  await expect(cards(page).locator('.stat-card strong')).toHaveText(['3', '2', '2', '1']);
  await selectCard(page, '需要关注');
  await expect(page.getByPlaceholder('搜索需求、工作项或拼音')).toHaveValue('');
  await expect(page.getByLabel('按人员筛选', { exact: true })).toHaveValue('');
  await expectRows(page, ['进行且延期', '未开始高风险']);
  await expect(page.locator('.gantt-dashboard-scope')).toHaveText('需要关注');
  await cards(page).getByRole('button', { name: '已延期 1', exact: true }).click();
  await expectRows(page, ['进行且延期']);
  await cards(page).getByRole('button', { name: '未延期高风险 1', exact: true }).click();
  await expectRows(page, ['未开始高风险']);
  await selectCard(page, '近期到期'); await expectRows(page, ['正常进行', '未开始高风险']);
  await expect(cards(page)).toContainText('09/11—09/17');
  await cards(page).getByRole('button', { name: '关注 1', exact: true }).click(); await expectRows(page, ['未开始高风险']);
  await selectCard(page, '近 7 天完成'); await expectRows(page, ['最近完成但曾延期']);
  await cards(page).getByRole('button', { name: '同期新增 1 项', exact: true }).click(); await expectRows(page, ['最近新增']);
  await cards(page).getByRole('button', { name: '待确认 1', exact: true }).click(); await expectRows(page, ['排期待确认']);
  await cards(page).getByRole('button', { name: '未开始 2', exact: true }).click(); await expectRows(page, ['未开始高风险', '最近新增']);
  await page.getByTitle('重置为进行中和风险排序', { exact: true }).click();
  await expectRows(page, ['正常进行', '进行且延期', '排期待确认']);
  await expect(page.locator('.gantt-dashboard-scope')).toHaveCount(0);
});

test('范围恢复、项目隔离及跨日刷新；零结果不自动扩大', async ({ page }) => {
  const state = await setup(page, true);
  await page.route('**/api/projects', route => route.fulfill({ json: [{ id: 'p1', name: '项目一', status: 'active' }, { id: 'p2', name: '项目二', status: 'active' }] }));
  await page.goto('/'); await selectCard(page, '近期到期'); await page.reload();
  await expectRows(page, ['正常进行', '未开始高风险']);
  await expect(page.locator('.gantt-dashboard-scope')).toHaveText('近期到期');
  await page.locator('.project-switcher-button').click(); await page.getByRole('option', { name: '项目二', exact: true }).click();
  await expectRows(page, ['正常进行', '进行且延期', '排期待确认']);
  await page.locator('.project-switcher-button').click(); await page.getByRole('option', { name: '项目一', exact: true }).click();
  await expectRows(page, ['正常进行', '未开始高风险']);
  state.asOfDate = '2026-09-18'; await page.reload();
  await expect(page.getByText('没有匹配的需求', { exact: true })).toBeVisible();
  await expect(cards(page).locator('.stat-card').nth(2).locator('strong')).toHaveText('0');
  await page.getByRole('button', { name: '恢复进行中', exact: true }).click();
  await expectRows(page, ['正常进行', '进行且延期', '排期待确认']);
  state.rows = []; await page.reload();
  await expect(cards(page).locator('.stat-card strong')).toHaveText(['0', '0', '0', '0']);
  await expect(page.getByText('项目暂无需求', { exact: true })).toBeVisible();
});

test('键盘可直接选择卡片，桌面和窄屏卡片不溢出', async ({ page }, testInfo) => {
  await setup(page); await page.goto('/');
  const target = cards(page).getByRole('button', { name: '需要关注 2 项', exact: true });
  await target.focus(); await page.keyboard.press('Enter'); await expectRows(page, ['进行且延期', '未开始高风险']);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(cards(page).locator('.stat-card')).toHaveCount(4);
    const bounds = await cards(page).locator('.stat-card').evaluateAll(nodes => nodes.map(node => {
      const r = node.getBoundingClientRect();
      return { x: r.x, right: r.right, y: r.y, height: r.height, overflow: node.scrollWidth > node.clientWidth + 1 };
    }));
    for (const b of bounds) { expect(b.x).toBeGreaterThanOrEqual(0); expect(b.right).toBeLessThanOrEqual(width); expect(b.overflow).toBe(false); }
    if (width === 1280) { expect(new Set(bounds.map(b => b.y)).size).toBe(1); expect(Math.max(...bounds.map(b => b.height))).toBeLessThanOrEqual(110); }
    await cards(page).screenshot({ path: testInfo.outputPath(`dashboard-metrics-${width}.png`) });
  }
});

test('所有主题及日夜模式保留统计与筛选，卡片高度稳定', async ({ page }, testInfo) => {
  await setup(page); await page.goto('/');
  await selectCard(page, '需要关注');
  for (const theme of ['classic', 'swiss', 'forest', 'midnight', 'soft', 'industrial', 'dcim']) {
    await page.evaluate(value => {
      localStorage.setItem('project-manage:theme', value);
      window.dispatchEvent(new StorageEvent('storage', { key: 'project-manage:theme', newValue: value }));
    }, theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectRows(page, ['进行且延期', '未开始高风险']);
    await expect(cards(page).locator('.stat-card strong')).toHaveText(['3', '2', '2', '1']);
    const heights = await cards(page).locator('.stat-card').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().height));
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
    expect(Math.max(...heights)).toBeLessThanOrEqual(110);
    if (theme === 'dcim') await cards(page).screenshot({ path: testInfo.outputPath('dashboard-metrics-dark.png') });
  }
});

test('日志页分页调用可运行，换页大小回到第一页', async ({ page }) => {
  await mockGanttData(page);
  const requests: URLSearchParams[] = [];
  await page.route('**/api/audit/search?*', route => {
    const params = new URL(route.request().url()).searchParams; requests.push(params);
    return route.fulfill({ json: { items: [{ id: 'log', createdAt: '2026-09-11T00:00:00.000Z', actorType: 'user', actorName: '管理员', action: 'update', entityType: 'requirement', summary: '更新需求' }],
      total: 120, page: Number(params.get('page')), pageSize: Number(params.get('pageSize')), pages: Math.ceil(120 / Number(params.get('pageSize'))), snapshot: 777 } });
  });
  await page.goto('/logs');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.get('page')).toBe('2');
  expect(requests.at(-1)?.get('snapshot')).toBe('777');
  await page.getByLabel('每页数量', { exact: true }).selectOption('20');
  await expect.poll(() => requests.at(-1)?.get('pageSize')).toBe('20');
  expect(requests.at(-1)?.get('page')).toBe('1');
});
