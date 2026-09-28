import { expect, test, type APIRequestContext } from '@playwright/test';
import type { Requirement } from '../../src/client/types';

async function post(request: APIRequestContext, path: string, data: object) {
  const response = await request.post(path, { data });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

test('共享任务登录后恢复详情，直接执行需求进入清单后仍能开始并回读', async ({ page, browser, baseURL }) => {
  await post(page.request, '/api/login', { username: 'admin', password: '41_xc7q0qOjo4Inw!' });
  const project = await post(page.request, '/api/projects', { name: '共享任务接续' + Date.now() });
  const owner = await post(page.request, '/api/people', { projectId: project.id, name: '链接接收人' + Date.now() });
  const requirement = await post(page.request, '/api/requirements', {
    projectId: project.id, title: '核对共享交付资料', ownerId: owner.id,
    background: '核对第二批交付资料。', acceptanceCriteria: '保留核对记录供经理读取。',
  }) as Requirement;
  const detail = async () => (await (await page.request.get('/api/requirements/' + requirement.id)).json()) as Requirement;
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  try {
    // 完成测试账号的初始设置，再以未登录状态模拟收到任务链接。
    await post(context.request, '/api/login', { username: owner.name, password: '888888' });
    await post(context.request, '/api/account/change-password', { currentPassword: '888888', newPassword: 'shared-task-member-password' });
    await context.clearCookies();
    const actor = await context.newPage();
    const link = '/?' + new URLSearchParams({ projectId: project.id, workspaceView: 'list', scopeType: 'project', scopeId: project.id, detailId: requirement.id, detailTab: 'overview' });
    await actor.goto(link);
    await expect(actor.getByRole('heading', { name: '项目不可用', exact: true })).toBeVisible();
    await expect(actor.getByRole('heading', { name: requirement.title, exact: true })).toHaveCount(0);
    await actor.getByRole('button', { name: '切换账号', exact: true }).click();
    const login = actor.getByRole('dialog', { name: '用户登录', exact: true });
    await login.getByLabel('用户名', { exact: true }).fill(owner.name);
    await login.getByLabel('密码', { exact: true }).fill('shared-task-member-password');
    await login.getByRole('button', { name: '用户登录', exact: true }).click();
    const inspector = actor.getByRole('dialog', { name: requirement.title, exact: true });
    await expect(inspector.getByRole('region', { name: '需求说明', exact: true }).getByText(requirement.background!, { exact: true })).toBeVisible();
    await expect(actor).toHaveURL(url => url.searchParams.get('detailId') === requirement.id);
    await inspector.getByRole('button', { name: '进入需求', exact: true }).click();
    const empty = actor.locator('.workspace-outline .workspace-empty');
    await expect(empty.getByRole('button', { name: '查看需求', exact: true })).toBeInViewport();
    await expect(empty.getByRole('button', { name: '新建工作项', exact: true })).toHaveCount(0);
    await actor.reload();
    await empty.getByRole('button', { name: '查看需求', exact: true }).click();
    await expect(inspector.getByRole('tab', { name: '概况', exact: true })).toHaveAttribute('aria-selected', 'true');
    expect(await detail()).toEqual(requirement);
    await inspector.getByRole('button', { name: '开始需求', exact: true }).click();
    await expect.poll(async () => (await detail()).status).toBe('in_progress');
    await inspector.getByRole('tab', { name: '记录', exact: true }).click();
    await expect(inspector).toContainText(owner.name);
    await actor.reload();
    await expect(inspector.getByRole('tab', { name: '记录', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(inspector).toContainText('开始需求');
    await inspector.getByRole('button', { name: '关闭', exact: true }).click();
    await actor.getByRole('button', { name: '进展表', exact: true }).click();
    await actor.getByRole('button', { name: requirement.title, exact: true }).click();
    await expect(inspector).toContainText('进行中');
    const saved = await detail();
    expect(saved).toMatchObject({ ownerId: owner.id, progress: 0, status: 'in_progress', workItems: [], background: requirement.background, acceptanceCriteria: requirement.acceptanceCriteria });
    expect(saved.progressUpdates).toHaveLength(1);
    await page.goto('/?' + new URLSearchParams({ projectId: project.id, workspaceView: 'list', scopeType: 'requirement', scopeId: requirement.id }));
    await expect(page.locator('.workspace-outline .workspace-empty').getByRole('button', { name: '查看需求', exact: true })).toBeVisible();
    await expect(page.locator('.workspace-outline .workspace-empty').getByRole('button', { name: '新建工作项', exact: true })).toBeVisible();
  } finally { await context.close(); }
});
