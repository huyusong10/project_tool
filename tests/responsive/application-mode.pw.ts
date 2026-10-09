import { expect, test, type APIRequestContext } from '@playwright/test';

async function post(request: APIRequestContext, url: string, data: Record<string, unknown>) {
  const response = await request.post(url, { data });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

async function setMode(request: APIRequestContext, issueTrackingOnly: boolean) {
  const branding = await (await request.get('/api/branding')).json();
  const response = await request.put('/api/system/application-mode', { data: {
    issueTrackingOnly, expectedUpdatedAt: branding.applicationMode.updatedAt,
  } });
  expect(response.ok(), await response.text()).toBe(true);
}

async function fixture(request: APIRequestContext) {
  const suffix = Date.now();
  const project = await post(request, '/api/projects', { name: '遗留问题项目 ' + suffix });
  const member = await post(request, '/api/people', { projectId: project.id, name: '遗留问题成员' + suffix });
  const requirement = await post(request, '/api/requirements', { projectId: project.id, title: '历史关联需求 ' + suffix });
  const issue = await post(request, '/api/issues', { projectId: project.id, requirementId: requirement.id, title: '历史遗留问题 ' + suffix, ownerId: member.id });
  return { project, member, requirement, issue };
}

test.beforeEach(async ({ page }) => {
  await post(page.request, '/api/login', { username: 'admin', password: '41_xc7q0qOjo4Inw!' });
  await setMode(page.request, false);
});
test.afterEach(async ({ page }) => { await setMode(page.request, false); });

test('管理员切换全局模式，刷新后保留，其他账号同步，关闭后恢复导航', async ({ page, browser, baseURL }) => {
  const f = await fixture(page.request);
  await page.goto('/system');
  const toggle = page.getByRole('switch', { name: '仅启用问题跟踪功能' });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(toggle).toBeEnabled();
  await expect(page.locator('.sidebar-nav a')).toHaveText(['个人设置', '问题跟踪', '项目成员', '人员权限', '系统管理']);
  await page.reload();
  await expect(toggle).toBeChecked();
  const context = await browser.newContext({ baseURL });
  try {
    await post(context.request, '/api/login', { username: f.member.name, password: '888888' });
    await post(context.request, '/api/account/change-password', { currentPassword: '888888', newPassword: 'Mode-member-password' });
    const actor = await context.newPage();
    await actor.goto('/?projectId=' + f.project.id);
    await expect(actor).toHaveURL('/issues?projectId=' + f.project.id);
    await expect(actor.locator('.sidebar-nav a')).toHaveText(['个人设置', '问题跟踪']);
    await expect(actor.locator('.issue-data-row')).toContainText(f.issue.title);
  } finally { await context.close(); }
  await toggle.uncheck();
  await expect(page.getByRole('link', { name: '项目空间', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Jira 进展管理', exact: true })).toBeVisible();
  await page.reload();
  await expect(toggle).not.toBeChecked();
});

test('旧页面地址统一进入问题跟踪，不读取被隐藏对象，项目切换保持问题页', async ({ page }) => {
  const f = await fixture(page.request);
  const other = await post(page.request, '/api/projects', { name: '第二个遗留项目 ' + Date.now() });
  await setMode(page.request, true);
  const hiddenReads: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path === '/api/requirements/' + f.requirement.id || path.startsWith('/api/templates') || path.startsWith('/api/analytics')) hiddenReads.push(path);
  });
  for (const path of ['/', '/requirements/' + f.requirement.id, '/execution', '/paths', '/features', '/my-work', '/analytics', '/actions', '/people', '/templates', '/jira', '/jira/prs/old', '/projects', '/archives', '/logs', '/project-logs', '/concurrency']) {
    await page.goto(path + '?projectId=' + f.project.id);
    await expect(page).toHaveURL('/issues?projectId=' + f.project.id);
    await expect(page.locator('.issue-data-row')).toContainText(f.issue.title);
  }
  expect(hiddenReads).toEqual([]);
  await page.locator('.project-switcher-button').click();
  await page.getByRole('option', { name: other.name, exact: true }).click();
  await expect(page).toHaveURL('/issues?projectId=' + other.id);
  await page.getByRole('link', { name: '返回主页' }).click();
  await expect(page).toHaveURL('/issues?projectId=' + other.id);
});

test('历史需求问题可编辑并保留关联，新问题不绑定需求', async ({ page }) => {
  const f = await fixture(page.request);
  await setMode(page.request, true);
  await page.goto(`/issues?projectId=${f.project.id}&detailId=issue:${f.issue.id}&detailTab=basic`);
  const dialog = page.getByRole('dialog', { name: '问题详情', exact: true });
  await expect(dialog).toContainText(f.requirement.title);
  await expect(dialog.getByRole('link', { name: /^查看关联需求/ })).toHaveCount(0);
  await expect(dialog.locator('[name=requirementId]')).toHaveCount(0);
  await dialog.getByRole('textbox', { name: '问题标题', exact: true }).fill(f.issue.title + ' 已核对');
  await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const saved = await (await page.request.get('/api/issues/' + f.issue.id)).json();
  expect(saved.requirementId).toBe(f.requirement.id);
  expect(saved.title).toBe(f.issue.title + ' 已核对');
  await page.getByRole('button', { name: '新建问题', exact: true }).click();
  const form = page.getByRole('dialog', { name: '新建问题', exact: true });
  await expect(form.locator('[name=requirementId]')).toHaveCount(0);
  await form.getByRole('textbox', { name: '问题标题', exact: true }).fill('独立遗留问题');
  await form.getByRole('textbox', { name: '范围标识', exact: true }).fill('LEGACY-01');
  await form.getByRole('button', { name: '创建问题', exact: true }).click();
  await expect(form).toHaveCount(0);
  const list = await (await page.request.get('/api/issues?projectId=' + f.project.id)).json();
  expect(list.items.find((issue: { title: string }) => issue.title === '独立遗留问题')).toMatchObject({ requirementId: null, sourceRef: 'LEGACY-01' });
});

test('必要维护页面收起项目配置与集成，游客只显示登录入口', async ({ page, browser, baseURL }) => {
  const f = await fixture(page.request);
  await setMode(page.request, true);
  const unrelatedReads: string[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/tokens') || path.startsWith('/api/jira') || path.startsWith('/api/archives')) unrelatedReads.push(path);
  });
  await page.goto('/project-settings?projectId=' + f.project.id);
  await expect(page.getByRole('heading', { name: '项目成员', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '添加成员', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '编辑项目', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '项目归档', exact: true })).toHaveCount(0);
  await page.goto('/settings');
  await expect(page.getByRole('button', { name: '修改密码', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'MCP 接入', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /创建.*Token/ })).toHaveCount(0);
  expect(unrelatedReads).toEqual([]);
  const context = await browser.newContext({ baseURL });
  try {
    const guest = await context.newPage();
    await guest.goto('/');
    await expect(guest).toHaveURL('/issues');
    await expect(guest.getByRole('heading', { name: '问题跟踪', exact: true }).last()).toBeVisible();
    await expect(guest.getByText('登录有项目权限的账号后查看和处理遗留问题。')).toBeVisible();
    await expect(guest.getByRole('link', { name: '项目空间', exact: true })).toHaveCount(0);
    await guest.getByRole('button', { name: '登录', exact: true }).last().click();
    await expect(guest.getByRole('dialog', { name: '用户登录' })).toBeVisible();
  } finally { await context.close(); }
});

test('设置写入冲突后先重新读取，再次切换使用最新版本', async ({ page }) => {
  await page.goto('/system');
  const toggle = page.getByRole('switch', { name: '仅启用问题跟踪功能' });
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toBeEnabled();
  await setMode(page.request, true);
  // 当前标签仍持有旧版本，与另一个管理员的更新冲突。
  await toggle.click();
  await expect(page.getByRole('alert').filter({ hasText: '功能设置已被其他管理员修改' })).toBeVisible();
  await expect(toggle).toBeDisabled();
  await page.getByRole('button', { name: '重新读取功能设置' }).click();
  await expect(toggle).toBeEnabled();
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(page.getByRole('link', { name: '项目空间', exact: true })).toBeVisible();
});

test('已打开的页面自动同步模式，并收起已打开的集成和项目编辑弹窗', async ({ page }) => {
  const f = await fixture(page.request);
  await page.clock.install();
  await page.goto('/settings');
  await page.getByRole('button', { name: /创建.*Token/ }).click();
  await expect(page.getByRole('dialog', { name: '创建 MCP Token' })).toBeVisible();
  await setMode(page.request, true);
  await page.clock.fastForward(61_000);
  await expect(page.getByRole('dialog', { name: '创建 MCP Token' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '项目空间', exact: true })).toHaveCount(0);
  await setMode(page.request, false);
  await page.clock.fastForward(61_000);
  await expect(page.getByRole('link', { name: '项目空间', exact: true })).toBeVisible();
  await page.goto('/project-settings?projectId=' + f.project.id);
  await page.getByRole('button', { name: '编辑项目', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '编辑项目' })).toBeVisible();
  await setMode(page.request, true);
  await page.clock.fastForward(61_000);
  await expect(page.getByRole('dialog', { name: '编辑项目' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '添加成员', exact: true })).toBeVisible();
});
