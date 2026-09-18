import { expect, test, type Page } from '@playwright/test';
import type { Issue, Requirement, Session, WorkItem } from '../../src/client/types';
import {mockGanttReport} from './gantt-fixture';
import {closeGraphProperties} from './graph-interactions';

type Source = 'requirement' | 'my-work' | 'issue';
const invalidBodies = { html: '<html>invalid API response</html>', truncated: '{"id":', empty: '' };
const adminSession: Session = { authenticated: true, accountId: 'admin', username: 'admin', httpWarning: true, role: 'admin', globalRole: 'admin', personId: 'u1', mustChangePassword: false, managedProjectIds: [] };
const item: WorkItem = {
  id: 'w1', requirementId: 'r1', templateItemId: null, title: '接口开发', ownerId: 'u1', ownerName: '张三',
  collaborators: [], assigneeIds: ['u1'], assigneeNames: ['张三'], status: 'in_progress', progress: 40,
  plannedStart: '2026-09-01', plannedEnd: '2026-09-10', actualStart: '2026-09-01', actualEnd: null,
  forecastEnd: null, blockedAt: null, blockedReason: null, milestoneLabel: null, sortOrder: 0, version: 1,
  createdAt: '2026-09-01', updatedAt: '2026-09-01',
};
const requirement: Requirement = {
  id: 'r1', projectId: 'p1', projectName: '测试项目', templateId: null, templateName: null, title: '刷新保护测试',
  ownerId: 'u1', ownerName: '张三', status: 'in_progress', plannedStart: '2026-09-01', plannedEnd: '2026-09-10',
  progress: 40, plannedProgress: 40, progressGap: 0, acceptedAt: null, acceptedByAccountId: null, version: 1,
  riskLevel: 'low', riskEvaluated: true, riskReason: '', priority: 'P2', createdAt: '2026-09-01', updatedAt: '2026-09-01',
  workItems: [item], progressUpdates: [], delayed: false, highRisk: false, finishVariance: 0, durationVariance: 0,
  effectiveEnd: '2026-09-10',
};
const issue: Issue = {
  id: 'i1', projectId: 'p1', projectName: '测试项目', requirementId: 'r1', requirementTitle: requirement.title,
  sourceRef: null, title: '受限问题详情', impact: '问题影响', reporter: '测试', ownerId: 'u1', ownerName: '张三',
  status: 'in_progress', priority: 'P2', progress: 40, discoveredAt: '2026-09-01', dueDate: '2026-09-10',
  resolvedAt: null, version: 1, createdAt: '2026-09-01', updatedAt: '2026-09-01', latestUpdate: null,
  latestUpdateAt: null, overdue: false, updates: [],
};
const readPaths = { requirement: '/api/requirements/r1', 'my-work': '/api/my-work', issue: '/api/issues/i1' };
const urls = { requirement: '/requirements/r1', 'my-work': '/my-work', issue: '/issues?projectId=p1&issueId=i1' };
const resourceSelectors = { requirement: '.detail-workspace[aria-label="需求详情"]', 'my-work': '.my-work-summary', issue: '.issue-settings-summary' };

async function fixture(page: Page, source: Source) {
  const state = { failure: 0 as number | 'network' | keyof typeof invalidBodies, errorBody: undefined as string | undefined, failedReads: 0, reads: 0 };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === readPaths[source]) {
      state.reads++;
      if (state.failure) {
        state.failedReads++;
        if (state.failure === 'network') return route.abort('connectionrefused');
        if (typeof state.failure === 'string') return route.fulfill({ status: 200, contentType: state.failure === 'html' ? 'text/html' : 'application/json', body: invalidBodies[state.failure] });
        if (state.errorBody !== undefined) return route.fulfill({ status: state.failure, contentType: 'application/json', body: state.errorBody });
        return route.fulfill({ status: state.failure, json: { error: `读取失败 ${state.failure}` } });
      }
    }
    if (path === '/api/session') return route.fulfill({ json: adminSession });
    if (path === '/api/projects') return route.fulfill({ json: [{ id: 'p1', name: '测试项目', status: 'active', defaultTemplateId: null, isSample: false }] });
    if (path === '/api/people') return route.fulfill({ json: [{ id: 'u1', name: '张三', active: 1, projectRole: 'member' }] });
    if (path === '/api/templates') return route.fulfill({ json: [] });
    if (path === '/api/requirements') return route.fulfill({ json: [requirement] });
    if (path === '/api/requirements/r1') return route.fulfill({ json: requirement });
    if (path === '/api/my-work') return route.fulfill({ json: {
      summary: { total: 1, notStarted: 0, inProgress: 1, blocked: 0, overdue: 0, completed: 0 }, requirements: [],
      items: [{ ...item, projectId: 'p1', projectName: '测试项目', requirementTitle: requirement.title, requirementStatus: requirement.status, assignmentType: 'owner', overdue: false }],
      completionTrend: [], upcoming: [], recentProgress: [],
    } });
    if (path === '/api/issues') return route.fulfill({ json: { items: [issue], total: 1, page: 1, pageSize: 50, pages: 1, summary: { total: 1, inProgress: 1, deferred: 0, resolved: 0, active: 1, highPriority: 0, overdue: 0, unassigned: 0, closureRate: 0 } } });
    if (path === '/api/issues/i1') return route.fulfill({ json: issue });
    return route.fulfill({ json: {} });
  });
  await mockGanttReport(page,()=>[requirement]);
  return state;
}
const refresh = (page: Page) => page.evaluate(() => {
  window.dispatchEvent(new Event('offline'));
  window.dispatchEvent(new Event('online'));
});

test('失权后迟到的问题操作响应不能重新填回已清除的详情', async ({ page }) => {
  const state = await fixture(page, 'issue');
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let writes = 0;
  await page.route('**/api/issues/i1/resolve', async (route) => {
    writes++;
    await pending;
    await route.fulfill({ json: { ...issue, status: 'resolved', progress: 100, version: 2, resolvedAt: '2026-09-04' } });
  });
  try {
    await page.goto(urls.issue);
    await page.locator('.issue-settings-summary .issue-status-trigger').click();
    await page.locator('.issue-status-note summary').click();
    await page.locator('.issue-status-note textarea').fill('请求已发送后权限发生变更');
    await page.getByRole('button', { name: /确认解决/ }).click();
    await expect.poll(() => writes).toBe(1);
    state.failure = 403;
    await refresh(page);
    await expect(page.getByText('读取失败 403', { exact: true })).toBeVisible();
    const operationResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/issues/i1/resolve');
    release();
    await operationResponse;
    await expect(page.locator('.issue-settings-summary')).toHaveCount(0);
    state.failure = 503;
    await page.getByRole('button', { name: '重新加载', exact: true }).click();
    await expect(page.getByText('读取失败 503', { exact: true })).toBeVisible();
    await expect(page.locator('.issue-settings-summary')).toHaveCount(0);
    state.failure = 0;
    await page.getByRole('button', { name: '重新加载', exact: true }).click();
    await expect(page.locator('.issue-settings-summary')).toBeVisible();
  } finally { release(); }
});

async function openDraft(page: Page, source: Source) {
  await page.goto(urls[source]);
  if (source === 'requirement') {
    await expect(page.locator(resourceSelectors.requirement)).toBeVisible();
    if(!await page.getByRole('dialog',{name:'更新工作项进度',exact:true}).isVisible()){
      await page.getByRole('tab',{name:/^工作项 /}).click();
      await page.getByRole('button',{name:'更新 接口开发 进度',exact:true}).click();
    }
  }
  if (source === 'my-work') await page.getByRole('button', { name: '为接口开发更新进度', exact: true }).click();
  const field = source === 'issue' ? page.locator('.issue-update-form textarea') : page.getByRole('textbox', { name: '说明（可选）', exact: true });
  await field.fill('不能丢失的草稿');
  return field;
}

async function failRootRead(page: Page, resource: 'session' | 'projects') {
  const state = { failure: 0 as number | 'network' | 'html', reads: 0 };
  await page.route(`**/api/${resource}`, (route) => {
    state.reads++;
    if (state.failure === 'network') return route.abort('connectionrefused');
    if (state.failure === 'html') return route.fulfill({ contentType: 'text/html', body: '<html>bad gateway</html>' });
    if (state.failure) return route.fulfill({ status: state.failure, json: { error: `${resource}读取失败 ${state.failure}` } });
    return route.fallback();
  });
  return state;
}

test('项目中心区分首次加载失败、旧数据刷新失败和真实空列表', async ({ page }, testInfo) => {
  await fixture(page, 'requirement');
  const projects = [{ id: 'p1', name: '测试项目', status: 'active', defaultTemplateId: null, isSample: false }];
  await page.route('**/api/projects', route => route.fulfill({ json: projects }));
  const root = await failRootRead(page, 'projects');
  const errors: string[] = [];
  const writes: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(request.method())) writes.push(request.url());
  });
  const table = page.locator('.project-table');
  const notice = page.locator('.app-refresh-notice');
  root.failure = 503;
  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: '项目列表加载失败', exact: true })).toBeVisible();
  await expect(page.getByText('projects读取失败 503', { exact: true })).toBeVisible();
  await expect(table).toHaveCount(0);
  await expect(notice).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('projects-first-read-failed-1280.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('projects-first-read-failed-390.png'), animations: 'disabled' });

  root.failure = 0;
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(table.getByText('测试项目', { exact: true })).toBeVisible();
  root.failure = 503;
  await refresh(page);
  await expect(notice).toContainText('暂时显示上次加载的数据');
  await expect(table.getByText('测试项目', { exact: true })).toBeVisible();
  await expect(table.getByText('还没有项目', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('projects-background-failed-390.png'), animations: 'disabled' });
  projects[0].name = '重试后更新的项目';
  root.failure = 0;
  await notice.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(notice).toHaveCount(0);
  await expect(table.getByText('重试后更新的项目', { exact: true })).toBeVisible();
  await expect(table.getByText('测试项目', { exact: true })).toHaveCount(0);

  root.failure = 403;
  await refresh(page);
  await expect(page.getByText('projects读取失败 403', { exact: true })).toBeVisible();
  await expect(table).toHaveCount(0);
  root.failure = 503;
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.getByText('projects读取失败 503', { exact: true })).toBeVisible();
  await expect(table).toHaveCount(0);
  projects.length = 0;
  root.failure = 0;
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(table.getByText('还没有项目', { exact: true })).toBeVisible();
  await expect(notice).toHaveCount(0);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

for (const resource of ['session', 'projects'] as const) {
  for (const [source, failure] of [['requirement', 503], ['my-work', 'network'], ['issue', 'html']] as const) {
    test(`全局读取 ${resource}后台${failure}保留${source}草稿`, async ({ page }, testInfo) => {
      await fixture(page, source);
      const root = await failRootRead(page, resource);
      const field = await openDraft(page, source);
      root.failure = failure;
      await refresh(page);
      await expect(page.locator('.app-refresh-notice')).toContainText('刷新失败');
      await expect(field).toHaveValue('不能丢失的草稿');
      await expect(page.locator(resourceSelectors[source])).toBeVisible();
      root.failure = 0;
      await refresh(page);
      await expect(page.locator('.app-refresh-notice')).toHaveCount(0);
      await expect(field).toHaveValue('不能丢失的草稿');
      if(source==='issue')await closeGraphProperties(page);else await page.getByRole('dialog',{name:'更新工作项进度',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();
      await closeGraphProperties(page);
      root.failure = 503;
      await refresh(page);
      await expect(page.locator('.app-refresh-notice')).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('root-refresh.png'), animations: 'disabled' });
      root.failure = 0;
      await page.locator('.app-refresh-notice').getByRole('button', { name: '重新加载', exact: true }).click();
      await expect(page.locator('.app-refresh-notice')).toHaveCount(0);
    });
  }

  test(`全局读取 ${resource}拒绝后503不能重新展示旧页面`, async ({ page }) => {
    await fixture(page, 'requirement');
    const root = await failRootRead(page, resource);
    const field = await openDraft(page, 'requirement');
    root.failure = 403;
    await refresh(page);
    await expect(page.getByText(`${resource}读取失败 403`, { exact: true })).toBeVisible();
    await expect(field).toHaveCount(0);
    root.failure = 503;
    await page.getByRole('button', { name: '重新加载', exact: true }).click();
    await expect(page.getByText(`${resource}读取失败 503`, { exact: true })).toBeVisible();
    await expect(page.locator('.detail-workspace[aria-label="需求详情"]')).toHaveCount(0);
    root.failure = 0;
    await page.getByRole('button', { name: '重新加载', exact: true }).click();
    await expect(page.locator('.detail-workspace[aria-label="需求详情"]')).toBeVisible();
    await expect(field).toHaveCount(0);
  });

  test(`全局读取 ${resource}首次失败不显示虚假空项目`, async ({ page }) => {
    await fixture(page, 'requirement');
    const root = await failRootRead(page, resource);
    root.failure = 503;
    await page.goto(urls.requirement);
    await expect(page.getByText(`${resource}读取失败 503`, { exact: true })).toBeVisible();
    await expect(page.locator('.detail-workspace[aria-label="需求详情"]')).toHaveCount(0);
    await expect(page.getByText('尚未创建项目', { exact: true })).toHaveCount(0);
    root.failure = 0;
    await page.getByRole('button', { name: '重新加载', exact: true }).click();
    await expect(page.locator('.detail-workspace[aria-label="需求详情"]')).toBeVisible();
  });
}

test('全局读取 退出成功后会话503也必须立即清除身份', async ({ page }) => {
  await fixture(page, 'requirement');
  const root = await failRootRead(page, 'session');
  let releaseLogout!: () => void;
  const waitingLogout = new Promise<void>((resolve) => { releaseLogout = resolve; });
  let logoutRequests = 0;
  await page.route('**/api/logout', async (route) => {
    logoutRequests++;
    root.failure = 503;
    await waitingLogout;
    return route.fulfill({ json: { ok: true } });
  });
  try {
    await page.goto(urls.requirement);
    await expect(page.locator('.detail-workspace[aria-label="需求详情"]')).toBeVisible();
    await closeGraphProperties(page);await closeGraphProperties(page);await page.getByRole('button',{name:/^账号菜单[:：]/}).click();await page.getByRole('menuitem',{ name:'退出登录', exact: true }).evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect.poll(() => logoutRequests).toBe(1);
    await expect(page.getByRole('button',{name:/^账号菜单[:：]/})).toBeDisabled();
  } finally { releaseLogout(); }
  await expect(page.getByRole('button', { name: '游客登录', exact: true })).toBeVisible();
  await expect(page.getByRole('button',{name:/^账号菜单[:：]/})).toHaveCount(0);
  await expect(page.locator('.detail-workspace[aria-label="需求详情"]')).toHaveCount(0);
});

test('全局读取 整站503保留草稿，资源401后会话503必须关闭旧页面', async ({ page }) => {
  const state = await fixture(page, 'requirement');
  const session = await failRootRead(page, 'session');
  const projects = await failRootRead(page, 'projects');
  const field = await openDraft(page, 'requirement');
  session.failure = projects.failure = state.failure = 503;
  await refresh(page);
  await expect(page.locator('.app-refresh-notice')).toBeVisible();
  await expect(field).toHaveValue('不能丢失的草稿');
  state.failure = 401;
  await refresh(page);
  await expect(page.getByRole('heading', { name: '登录状态加载失败', exact: true })).toBeVisible();
  await expect(page.getByRole('button',{name:/^账号菜单[:：]/})).toHaveCount(0);
  await expect(field).toHaveCount(0);
  await expect(page.locator('.detail-workspace[aria-label="需求详情"]')).toHaveCount(0);
  session.failure = projects.failure = state.failure = 0;
  await refresh(page);
  await expect(page.locator('.detail-workspace[aria-label="需求详情"]')).toBeVisible();
});

for (const change of ['account', 'password', 'role'] as const) {
  test(`全局读取 会话${change}变化不能沿用旧业务缓存和草稿`, async ({ page }) => {
    const state = await fixture(page, 'my-work');
    let current = adminSession;
    await page.route('**/api/session', (route) => route.fulfill({ json: current }));
    const field = await openDraft(page, 'my-work');
    current = change === 'account' ? { ...adminSession, accountId: 'a2', username: '第二账号' }
      : change === 'password' ? { ...adminSession, mustChangePassword: true }
        : { ...adminSession, globalRole: 'user', role: 'user' };
    state.failure = 503;
    await refresh(page);
    if (change === 'password') await expect(page.getByRole('dialog', { name: '修改初始密码', exact: true })).toBeVisible();
    else await expect(page.getByText('读取失败 503', { exact: true })).toBeVisible();
    await expect(page.locator('.my-work-summary')).toHaveCount(0);
    await expect(field).toHaveCount(0);
    if (change === 'account') await expect(page.getByRole('button',{name:/^账号菜单[:：]/})).toHaveText('第二账号');
    if (change === 'role') await expect(page.getByRole('link', { name: '人员与权限', exact: true })).toHaveCount(0);
  });
}

test('全局读取 项目授权移除后不能因详情503继续展示旧数据', async ({ page }) => {
  const state = await fixture(page, 'requirement');
  const field = await openDraft(page, 'requirement');
  await page.route('**/api/projects', (route) => route.fulfill({ json: [] }));
  state.failure = 503;
  await refresh(page);
  await expect(page.getByRole('heading',{name:'项目不可用',exact:true})).toBeVisible();
  await expect(page.locator('.detail-workspace[aria-label="需求详情"]')).toHaveCount(0);
  await expect(field).toHaveCount(0);
});

test('全局读取 登录成功后使用返回会话，后续503不误报登录失败', async ({ page }) => {
  await fixture(page, 'my-work');
  await page.route('**/api/session', (route) => route.fulfill({ json: {
    ...adminSession, authenticated: false, accountId: undefined, username: null, globalRole: 'guest', role: 'guest', personId: null,
  } }));
  const root = await failRootRead(page, 'session');
  await page.route('**/api/login', (route) => {
    root.failure = 503;
    return route.fulfill({ json: adminSession });
  });
  await page.route('**/api/dashboard?*', (route) => route.fulfill({ status: 503, json: { error: '仪表盘临时不可用' } }));
  await page.goto('/');
  await page.getByRole('button', { name: '游客登录', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '用户登录', exact: true });
  await dialog.getByLabel('密码', { exact: true }).fill('test-password');
  await dialog.getByRole('button', { name: '用户登录', exact: true }).click();
  await expect(page.getByRole('button',{name:/^账号菜单[:：]/})).toHaveText('admin');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('link', { name: '我的工作', exact: true }).click();
  await expect(page.locator('.my-work-summary')).toBeVisible();
  await expect(page.locator('.app-refresh-notice')).toBeVisible();
});

test('全局读取 改名不重置草稿，切换身份后迟到写响应不回填旧详情', async ({ page }) => {
  const state = await fixture(page, 'issue');
  let current = adminSession;
  await page.route('**/api/session', (route) => route.fulfill({ json: current }));
  const field = await openDraft(page, 'issue');
  current = { ...adminSession, username: '管理员新名字' };
  await refresh(page);
  await expect(page.getByRole('button',{name:/^账号菜单[:：]/})).toHaveText('管理员新名字');
  await expect(field).toHaveValue('不能丢失的草稿');
  let release!: () => void;
  let returned!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const responseReturned = new Promise<void>((resolve) => { returned = resolve; });
  let writes = 0;
  await page.route('**/api/issues/i1/resolve', async (route) => {
    writes++;
    await pending;
    await route.fulfill({ json: { ...issue, status: 'resolved', progress: 100, version: 2 } });
    returned();
  });
  try {
    await page.locator('.issue-settings-summary .issue-status-trigger').click();
    await page.locator('.issue-status-note summary').click();
    await page.locator('.issue-status-note textarea').fill('旧身份的待返回操作');
    await page.getByRole('button', { name: /确认解决/ }).click();
    await expect.poll(() => writes).toBe(1);
    state.failure = 503;
    current = { ...adminSession, accountId: 'a2', username: '第二账号' };
    await refresh(page);
    await expect(page.getByRole('button',{name:/^账号菜单[:：]/})).toHaveText('第二账号');
    await expect(page.getByText('读取失败 503', { exact: true })).toBeVisible();
    release();
    await responseReturned;
    // 等一次明确的后续读取，避免在迟到响应尚未处理时提前断言。
    const readsBefore = state.reads;
    await refresh(page);
    await expect.poll(() => state.reads).toBeGreaterThan(readsBefore);
    await expect(page.getByText('读取失败 503', { exact: true })).toBeVisible();
    await expect(page.locator('.issue-settings-summary')).toHaveCount(0);
    await expect(field).toHaveCount(0);
    expect(writes).toBe(1);
  } finally { release(); }
});

test('全局读取 修改初始密码成功后会话503不再锁住工作台', async ({ page }) => {
  await fixture(page, 'my-work');
  await page.route('**/api/session', (route) => route.fulfill({ json: { ...adminSession, mustChangePassword: true } }));
  const root = await failRootRead(page, 'session');
  const writes: unknown[] = [];
  await page.route('**/api/account/change-password', (route) => {
    writes.push(route.request().postDataJSON());
    root.failure = 503;
    return route.fulfill({ json: { session: adminSession } });
  });
  await page.goto('/my-work');
  const dialog = page.getByRole('dialog', { name: '修改初始密码', exact: true });
  await dialog.getByLabel('当前密码', { exact: true }).fill('old-test-password');
  await dialog.getByLabel('新密码', { exact: true }).fill('new-test-password');
  await dialog.getByLabel('确认新密码', { exact: true }).fill('new-test-password');
  await dialog.getByRole('button', { name: '保存新密码', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.my-work-summary')).toBeVisible();
  await expect(page.locator('.app-refresh-notice')).toBeVisible();
  expect(writes).toEqual([{ currentPassword: 'old-test-password', newPassword: 'new-test-password' }]);
});

for (const source of ['requirement', 'my-work', 'issue'] as const) {
  test(`${source}异常错误正文保留403与503语义，不恢复失权详情`, async ({ page }) => {
    const state = await fixture(page, source);
    const field = await openDraft(page, source);
    state.failure = 403;
    state.errorBody = 'null';
    await refresh(page);
    await expect(page.getByText('请求失败（403）', { exact: true })).toBeVisible();
    await expect(field).toHaveCount(0);
    await expect(page.locator(resourceSelectors[source])).toHaveCount(0);
    state.failure = 503;
    state.errorBody = '<html>upstream secret</html>';
    await page.getByRole('button', { name: /^(重新加载|重新读取)$/, exact: true }).click();
    await expect(page.getByText('请求失败（503）', { exact: true })).toBeVisible();
    await expect(page.locator(resourceSelectors[source])).toHaveCount(0);
    await expect(page.getByText(/upstream secret/)).toHaveCount(0);
    state.failure = 0;
    await page.getByRole('button', { name: /^(重新加载|重新读取)$/, exact: true }).click();
    await expect(page.locator(resourceSelectors[source])).toBeVisible();
  });

  for (const failure of [503, 'network', 'html', 'truncated', 'empty'] as const) {
    test(`${source}后台${failure}保留页面和草稿，恢复后可重新加载`, async ({ page }, testInfo) => {
      const state = await fixture(page, source);
      const field = await openDraft(page, source);
      state.failure = failure;
      await refresh(page);
      await expect(page.getByRole('alert').filter({ hasText: '刷新失败' })).toBeVisible();
      await expect(page.locator(resourceSelectors[source])).toBeVisible();
      await expect(field).toHaveValue('不能丢失的草稿');
      state.failure = 0;
      await refresh(page);
      await expect(page.getByRole('alert').filter({ hasText: '刷新失败' })).toHaveCount(0);
      await expect(field).toHaveValue('不能丢失的草稿');
      if(source==='issue')await closeGraphProperties(page);else await page.getByRole('dialog',{name:'更新工作项进度',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();
      if (source === 'issue') {
        await page.goto(urls[source]);
        await expect(page.locator(resourceSelectors[source])).toBeVisible();
      }
      state.failure = 503;
      await refresh(page);
      await expect(page.getByRole('alert').filter({ hasText: '刷新失败' })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('refresh-warning.png'), animations: 'disabled' });
      state.failure = 0;
      await page.getByRole('button', { name: /^(重新加载|重新读取)$/, exact: true }).click();
      await expect(page.getByRole('alert').filter({ hasText: '刷新失败' })).toHaveCount(0);
    });
  }

  test(`${source}失权或记录不存在后清除缓存，随后503不会重新展示旧数据`, async ({ page }) => {
    const state = await fixture(page, source);
    for (const status of [403, 404, 401]) {
      state.failure = 0;
      const field = await openDraft(page, source);
      state.failure = status;
      await refresh(page);
      await expect(page.getByText(`读取失败 ${status}`, { exact: true })).toBeVisible();
      await expect(field).toHaveCount(0);
      await expect(page.locator(resourceSelectors[source])).toHaveCount(0);
      state.failure = 503;
      await page.getByRole('button', { name: /^(重新加载|重新读取)$/, exact: true }).click();
      await expect(page.getByText('读取失败 503', { exact: true })).toBeVisible();
      await expect(page.locator(resourceSelectors[source])).toHaveCount(0);
      await expect(field).toHaveCount(0);
    }
  });

  test(`${source}首次加载失败不伪装成空数据并可重试`, async ({ page }) => {
    const state = await fixture(page, source);
    state.failure = 503;
    await page.goto(urls[source]);
    await expect(page.getByText('读取失败 503', { exact: true })).toBeVisible();
    await expect(page.locator(resourceSelectors[source])).toHaveCount(0);
    state.failure = 0;
    await page.getByRole('button', { name: /^(重新加载|重新读取)$/, exact: true }).click();
    await expect(page.locator(resourceSelectors[source])).toBeVisible();
  });
}
