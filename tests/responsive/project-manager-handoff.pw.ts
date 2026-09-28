import { expect, test, type APIRequestContext } from '@playwright/test';

test('经理交接后回到当前项目并确认结果，接任者可管理且原工作保持', async ({ page, browser, baseURL }) => {
  const post = async (request: APIRequestContext, path: string, data: object) => {
    const response = await request.post(path, { data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  await post(page.request, '/api/login', { username: 'admin', password: '41_xc7q0qOjo4Inw!' });
  const project = await post(page.request, '/api/projects', { name: '经理交接 ' + Date.now() });
  const outgoing = await post(page.request, '/api/people', { projectId: project.id, name: '原经理 ' + Date.now() });
  const incoming = await post(page.request, '/api/people', { projectId: project.id, name: '接任经理 ' + Date.now() });
  const membersPath = '/api/projects/' + project.id + '/members';
  const members = async () => (await (await page.request.get(membersPath)).json()) as { id: string; projectRole: string; membershipUpdatedAt: string }[];
  const grant = await page.request.put(membersPath + '/' + outgoing.id, { data: { role: 'manager', expectedMembershipUpdatedAt: (await members()).find(p => p.id === outgoing.id)!.membershipUpdatedAt } });
  expect(grant.ok(), await grant.text()).toBe(true);
  const requirement = await post(page.request, '/api/requirements', { projectId: project.id, title: '交接期间继续核对资料', ownerId: incoming.id, background: '管理职责变化不改变交付安排。' });
  const contexts = await Promise.all([browser.newContext({ baseURL }), browser.newContext({ baseURL })]);
  try {
    for (const [index, person] of [outgoing, incoming].entries()) {
      await post(contexts[index].request, '/api/login', { username: person.name, password: '888888' });
      await post(contexts[index].request, '/api/account/change-password', { currentPassword: '888888', newPassword: 'manager-handoff-test-password' });
    }
    const actor = await contexts[0].newPage();
    await actor.goto('/project-settings?projectId=' + project.id);
    const ownRole = actor.getByLabel(outgoing.name + '的项目角色', { exact: true });
    await ownRole.selectOption('member');
    await expect(actor.getByText('项目至少需要保留一名项目经理，请先指定接任者', { exact: true })).toBeVisible();
    await expect(ownRole).toHaveValue('manager');
    await actor.getByLabel(incoming.name + '的项目角色', { exact: true }).selectOption('manager');
    await expect.poll(async () => (await members()).find(p => p.id === incoming.id)?.projectRole).toBe('manager');
    await actor.reload();
    await expect(actor.getByLabel(incoming.name + '的项目角色', { exact: true })).toHaveValue('manager');
    await ownRole.selectOption('member');
    await expect(actor).toHaveURL(url => url.pathname === '/' && url.searchParams.get('projectId') === project.id);
    await expect(actor.getByRole('status').filter({ hasText: '你在此项目的角色已更新为项目成员' })).toBeVisible();
    await expect(actor.getByRole('heading', { name: '无权访问此页面', exact: true })).toHaveCount(0);
    await expect(actor.getByRole('link', { name: '项目设置', exact: true })).toHaveCount(0);
    await actor.reload();
    await expect(actor.getByRole('heading', { name: '项目空间', exact: true })).toBeVisible();
    await expect.poll(async () => (await members()).find(p => p.id === outgoing.id)?.projectRole).toBe('member');
    const denied = await contexts[0].request.patch('/api/projects/' + project.id, { data: { name: project.name } });
    expect(denied.status()).toBe(403);
    const successor = await contexts[1].newPage();
    await successor.goto('/project-settings?projectId=' + project.id);
    await expect(successor.getByLabel(incoming.name + '的项目角色', { exact: true })).toHaveValue('manager');
    await expect(successor.getByLabel(outgoing.name + '的项目角色', { exact: true })).toHaveValue('member');
    await successor.getByRole('button', { name: '编辑项目', exact: true }).click();
    await expect(successor.getByRole('dialog')).toBeVisible();
    await successor.getByRole('button', { name: '取消', exact: true }).click();
    expect(await (await contexts[1].request.get('/api/requirements/' + requirement.id)).json()).toEqual(requirement);
    const mine = await (await contexts[1].request.get('/api/my-work')).json();
    expect(mine.requirements.some((r: { id: string }) => r.id === requirement.id)).toBe(true);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
