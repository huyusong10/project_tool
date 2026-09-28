import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { todayIso } from '../../src/shared/domain';

async function post(request: APIRequestContext, url: string, data: Record<string, unknown>) {
  const response = await request.post(url, { data });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

test('经理和成员从协调问题进入需求，返回和刷新保留问题记录与筛选', async ({ page, browser, baseURL }) => {
  await post(page.request, '/api/login', { username: 'admin', password: '41_xc7q0qOjo4Inw!' });
  const project = await post(page.request, '/api/projects', { name: '问题协作返回 ' + Date.now() });
  const member = await post(page.request, '/api/people', { projectId: project.id, name: '协调执行人' + Date.now() });
  const requirement = await post(page.request, '/api/requirements', { projectId: project.id, title: '恢复环境后继续联调', ownerId: member.id, background: '恢复测试环境后继续原工作。', acceptanceCriteria: '保留原计划和执行记录。' });
  const work = await post(page.request, `/api/requirements/${requirement.id}/work-items`, { expectedVersion: requirement.version, title: '联调测试环境', ownerId: member.id });
  const issue = await post(page.request, '/api/issues', { projectId: project.id, requirementId: requirement.id, title: '联调环境需要恢复', ownerId: member.id, discoveredAt: todayIso() });
  await post(page.request, `/api/issues/${issue.id}/resolve`, { expectedVersion: issue.version, content: '环境已恢复，可以继续联调。' });
  const detail = async () => (await (await page.request.get('/api/requirements/' + requirement.id)).json());
  const before = await detail();
  const inspect = async (actor: Page) => {
    await actor.goto(`/issues?projectId=${project.id}&status=resolved&q=${encodeURIComponent('联调环境')}`);
    await actor.getByRole('button', { name: issue.title + ' 暂无影响说明', exact: true }).click();
    const dialog = actor.getByRole('dialog', { name: '问题详情', exact: true });
    await dialog.getByRole('tab', { name: '记录 1', exact: true }).click();
    await expect(dialog).toContainText('环境已恢复，可以继续联调。');
    await dialog.getByRole('link', { name: '查看关联需求：' + requirement.title, exact: true }).click();
    const requirementDialog = actor.getByRole('dialog', { name: requirement.title, exact: true });
    await expect(requirementDialog).toBeVisible();
    await expect(requirementDialog).toContainText('恢复测试环境后继续原工作。');
    expect(new URL(actor.url()).searchParams.get('projectId')).toBe(project.id);
    expect(new URL(actor.url()).searchParams.get('scopeId')).toBe(requirement.id);
    await expect(actor.getByRole('treegrid', { name: '范围树表', exact: true })).toContainText(work.title);
    await actor.goBack();
    await expect(dialog.getByRole('tab', { name: '记录 1', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(actor.getByRole('searchbox')).toHaveValue('联调环境');
    await expect(actor.getByRole('combobox', { name: '问题状态筛选' })).toHaveValue('resolved');
    await actor.reload();
    await expect(dialog).toContainText('环境已恢复，可以继续联调。');
    await expect(dialog.getByRole('link', { name: '查看关联需求：' + requirement.title, exact: true })).toBeVisible();
  };
  await inspect(page);
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  try {
    await post(context.request, '/api/login', { username: member.name, password: '888888' });
    await post(context.request, '/api/account/change-password', { currentPassword: '888888', newPassword: 'journey-member-password' });
    const actor = await context.newPage();
    await inspect(actor);
    expect(await actor.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  } finally { await context.close(); }
  const after = await detail();
  expect(after.workItems).toEqual(before.workItems);
  expect(after.progressUpdates).toEqual(before.progressUpdates);
});

test('公共问题和仅范围标识的问题保留文字，不生成不存在的需求入口', async ({ page }) => {
  await post(page.request, '/api/login', { username: 'admin', password: '41_xc7q0qOjo4Inw!' });
  const project = await post(page.request, '/api/projects', { name: '公共协调问题 ' + Date.now() });
  for (const sourceRef of [null, '外部环境']) {
    const issue = await post(page.request, '/api/issues', { projectId: project.id, title: '公共协调 ' + (sourceRef || '全项目'), sourceRef, discoveredAt: todayIso() });
    await page.goto(`/issues?projectId=${project.id}&detailId=issue:${issue.id}`);
    const dialog = page.getByRole('dialog', { name: '问题详情', exact: true });
    await expect(dialog).toContainText(sourceRef || '公共问题');
    await expect(dialog.getByRole('link', { name: /^查看关联需求/ })).toHaveCount(0);
  }
});
