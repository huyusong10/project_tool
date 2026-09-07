import { expect, test, type Page, type Route } from '@playwright/test';
import type { Issue, IssuePage, Person, Project } from '../../src/client/types';

const project: Project = {
  id: 'p1', name: 'DCIM', status: 'active', plannedStart: null, plannedEnd: null,
  defaultTemplateId: null, isSample: false, createdAt: '2026-09-01', updatedAt: '2026-09-01',
};

const people: Person[] = [
  { id: 'u1', name: '一位名字较长的负责人', jobTitle: '产品经理', active: 1, createdAt: '2026-09-01', updatedAt: '2026-09-01' },
];

const baseIssue: Issue = {
  id: 'issue-1', projectId: project.id, projectName: project.name, requirementId: null, requirementTitle: null,
  sourceRef: '公共问题', title: '低分辨率下也必须完整显示优先级与编辑入口', impact: '影响多个团队的公共问题',
  reporter: '提出人', ownerId: people[0].id, ownerName: people[0].name, status: 'in_progress', priority: 'P0', progress: 45,
  discoveredAt: '2026-08-20', dueDate: '2026-09-01', resolvedAt: null, version: 1,
  createdAt: '2026-08-20', updatedAt: '2026-09-03', latestUpdate: '正在协调相关人员处理，这是一段用于验证响应式布局的较长进展说明。',
  latestUpdateAt: '2026-09-03T09:30:00.000Z', overdue: true,
};

const issuePage: IssuePage = {
  items: [baseIssue, { ...baseIssue, id: 'issue-2', title: '普通优先级问题', priority: 'P2', overdue: false, dueDate: '2026-09-10' }],
  total: 2, page: 1, pageSize: 50, pages: 1,
  summary: { total: 2, inProgress: 2, deferred: 0, resolved: 0, active: 2, highPriority: 1, overdue: 1, unassigned: 0, closureRate: 0 },
};

async function mockIssues(page: Page, state: { listFailure?: boolean } = {}) {
  await page.route('**/api/**', async (route: Route) => {
    const pathname = new URL(route.request().url()).pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (pathname === '/api/branding') return json({ systemName: '项目管理', shortName: 'PM', logoUrl: null, updatedAt: null });
    if (pathname === '/api/session') return json({ authenticated: true, accountId: 'admin', username: 'admin', httpWarning: true, role: 'admin', globalRole: 'admin', personId: null, mustChangePassword: false, managedProjectIds: [] });
    if (pathname === '/api/projects') return json([project]);
    if (pathname === '/api/people') return json(people);
    if (pathname === '/api/requirements') return json([]);
    if (pathname === '/api/issues') return state.listFailure ? json({ error: '问题列表暂不可用' }, 503) : json(issuePage);
    if (pathname === '/api/issues/issue-1') return json({ ...baseIssue, updates: [] });
    if (pathname === '/api/issues/does-not-exist') return json({ error: '问题不存在' }, 404);
    return json({});
  });
}

test('问题列表失败时显示错误并可重新加载', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1080p', '错误态只需在一个桌面视口执行');
  const state = { listFailure: true };
  await mockIssues(page, state);
  await page.goto('/issues');
  await expect(page.getByText('问题列表加载失败', { exact: true })).toBeVisible();
  await expect(page.getByText('问题列表暂不可用', { exact: true })).toBeVisible();
  await expect(page.getByText('没有符合条件的问题', { exact: true })).toHaveCount(0);
  state.listFailure = false;
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.locator('.issue-data-row')).toHaveCount(2);
});

test('问题列表在低分辨率下不遮挡优先级和编辑控件', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1080p', '在一个浏览器内覆盖多种内容宽度');
  await mockIssues(page);

  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1280, height: 800 },
    { width: 1024, height: 768 },
    { width: 900, height: 760 },
    { width: 760, height: 760 },
    { width: 620, height: 760 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/issues');
    await expect(page.locator('.issue-data-row')).toHaveCount(2);
    await expect(page.locator('.issue-data-priority .priority-badge').first()).toHaveText('P0 · 紧急');

    const layout = await page.locator('.issue-data-list').evaluate((list) => ({
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      escapedPriorities: [...list.querySelectorAll<HTMLElement>('.issue-data-priority .priority-badge')].filter((badge) => {
        const cell = badge.closest<HTMLElement>('.issue-data-priority')?.getBoundingClientRect();
        const rect = badge.getBoundingClientRect();
        return !cell || rect.left < cell.left - 1 || rect.right > cell.right + 1;
      }).length,
      escapedEditors: [...list.querySelectorAll<HTMLElement>('.inline-edit-trigger')].filter((button) => {
        const cell = button.closest<HTMLElement>('.adaptive-data-cell')?.getBoundingClientRect();
        const rect = button.getBoundingClientRect();
        return !cell || rect.left < cell.left - 1 || rect.right > cell.right + 1;
      }).length,
    }));
    expect(layout.pageOverflow).toBeLessThanOrEqual(1);
    expect(layout.escapedPriorities).toBe(0);
    expect(layout.escapedEditors).toBe(0);
  }

  await page.locator('.issue-data-priority').first().getByRole('button', { name: /问题优先级/ }).click();
  const popover = page.locator('.inline-select-popover');
  await expect(popover).toBeVisible();
  const rect = await popover.boundingBox();
  expect(rect).not.toBeNull();
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(620);
});

test('问题筛选、详情错误态和嵌套Esc保持正确', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1080p', '交互流程只需在一个桌面视口执行');
  await mockIssues(page);
  await page.goto('/issues');
  await page.locator('.issue-filters select').nth(1).selectOption('P1');
  await expect(page).toHaveURL(/priority=P1/);
  await page.locator('.issue-title-button').first().click();
  await expect(page).toHaveURL(/priority=P1.*issueId=issue-1|issueId=issue-1.*priority=P1/);
  const dialog = page.getByRole('dialog', { name: '问题详情' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /关联需求：/ }).click();
  const search = dialog.getByPlaceholder('搜索需求编号或名称');
  await expect(search).toBeVisible();
  await search.press('Escape');
  await expect(search).toBeHidden();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('.issue-filters select').nth(1)).toHaveValue('P1');

  await page.goto('/issues?issueId=does-not-exist');
  await expect(page.getByText('问题详情加载失败')).toBeVisible();
  await expect(page.getByText('正在加载问题详情…')).toHaveCount(0);
});

test('问题互斥筛选会清理旧地址参数', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1080p', '筛选状态只需在一个桌面视口执行');
  await mockIssues(page);
  await page.goto('/issues?active=true&overdue=true');

  const filters = page.locator('.issue-filters');
  await filters.locator('select').nth(0).selectOption('resolved');
  let params = new URL(page.url()).searchParams;
  expect(params.get('status')).toBe('resolved');
  expect(params.has('active')).toBe(false);
  expect(params.has('overdue')).toBe(false);

  await filters.getByRole('button', { name: '仅逾期', exact: true }).click();
  params = new URL(page.url()).searchParams;
  expect(params.get('status')).toBe('active');
  expect(params.get('overdue')).toBe('true');

  await filters.getByRole('button', { name: '未分配', exact: true }).click();
  await filters.locator('select').nth(2).selectOption('u1');
  params = new URL(page.url()).searchParams;
  expect(params.get('ownerId')).toBe('u1');
  expect(params.has('unassigned')).toBe(false);
});
