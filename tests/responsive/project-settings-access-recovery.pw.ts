import { expect, test, type APIRequestContext } from '@playwright/test';

for (const source of ['members', 'archives'] as const) test(`项目设置${source === 'members' ? '成员' : '归档'}明确拒绝后清除旧内容，临时失败和重新授权可恢复`, async ({ page, browser, baseURL }, info) => {
  const admin = await browser.newContext({ baseURL });
  const post = async (request: APIRequestContext, url: string, data: object) => {
    const response = await request.post(url, { data }); expect(response.ok(), await response.text()).toBe(true); return response.json();
  };
  const read = async (url: string) => {
    const response = await admin.request.get(url); expect(response.ok(), await response.text()).toBe(true); return response.json();
  };
  let resourceFailure = false, otherReadsFail = false;
  const writes: string[] = [], errors: string[] = [];
  try {
    await post(admin.request, '/api/login', { username: 'admin', password: '41_xc7q0qOjo4Inw!' });
    const project = await post(admin.request, '/api/projects', { name: '项目设置读取 ' + source + Date.now() });
    const manager = await post(admin.request, '/api/people', { projectId: project.id, name: '原项目经理 ' + source + Date.now() });
    const keeper = await post(admin.request, '/api/people', { projectId: project.id, name: '留任项目经理 ' + source + Date.now() });
    const initialMembers = await read('/api/projects/' + project.id + '/members');
    for (const person of [manager, keeper]) {
      const response = await admin.request.put(`/api/projects/${project.id}/members/${person.id}`, { data: { role: 'manager', expectedMembershipUpdatedAt: initialMembers.find((m: { id: string }) => m.id === person.id).membershipUpdatedAt } });
      expect(response.ok(), await response.text()).toBe(true);
    }
    let requirement = await post(admin.request, '/api/requirements', { projectId: project.id, title: '已归档的现场核对资料 ' + source, ownerId: keeper.id });
    requirement = await post(admin.request, '/api/requirements/' + requirement.id + '/cancel', { expectedVersion: requirement.version, reason: '本轮现场安排取消，保留归档资料' });
    const archived = await admin.request.delete('/api/requirements/' + requirement.id, { data: { expectedVersion: requirement.version } });
    expect(archived.ok(), await archived.text()).toBe(true);
    await post(page.request, '/api/login', { username: manager.name, password: '888888' });
    await post(page.request, '/api/account/change-password', { currentPassword: '888888', newPassword: 'project-settings-read-recovery-password' });
    const beforePeople = await read('/api/people'), beforeProjects = await read('/api/projects');
    const archivesUrl = '/api/archives?projectId=' + project.id;
    const beforeArchives = await read(archivesUrl);
    const resourcePath = source === 'members' ? '/api/projects/' + project.id + '/members' : '/api/archives';
    await page.route('**/api/**', route => {
      const target = new URL(route.request().url()).pathname === resourcePath;
      if (target ? resourceFailure : otherReadsFail) return route.fulfill({ status: 503, json: { error: '本次项目设置读取暂时不可用' } });
      return route.continue();
    });
    page.on('request', request => { if (request.url().includes('/api/') && !['GET', 'HEAD'].includes(request.method())) writes.push(request.method() + ' ' + new URL(request.url()).pathname); });
    page.on('pageerror', error => errors.push(error.message));
    const panelName = source === 'members' ? '项目成员' : '项目归档';
    const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: panelName, exact: true }) });
    const rows = panel.locator(source === 'members' ? '.project-member-row' : '.compact-list > div:not(.empty-state)');
    const shown = source === 'members' ? keeper.name : requirement.title;
    await page.goto('/project-settings?projectId=' + project.id);
    await expect(panel).toContainText(shown);
    resourceFailure = true; otherReadsFail = true;
    await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
    const warning = panel.locator('.warning-banner').filter({ hasText: '刷新失败' });
    await expect(warning).toBeVisible(); await expect(panel).toContainText(shown);
    const removed = await admin.request.delete(`/api/projects/${project.id}/members/${manager.id}`);
    expect(removed.ok(), await removed.text()).toBe(true);
    resourceFailure = false;
    const denied = page.waitForResponse(response => new URL(response.url()).pathname === resourcePath && response.status() === 403);
    await warning.getByRole('button', { name: '重新加载', exact: true }).click(); await denied;
    await expect(rows).toHaveCount(0);
    await expect(panel).not.toContainText(shown);
    const failure = panel.locator('.empty-state').filter({ hasText: panelName + '加载失败' });
    await expect(failure).toBeVisible();
    if (source === 'members') await expect(page.getByRole('button', { name: '添加成员', exact: true })).toBeDisabled();
    await page.setViewportSize({ width: 390, height: 844 });
    await failure.scrollIntoViewIfNeeded(); await expect(failure).toBeInViewport();
    await page.screenshot({ path: info.outputPath('settings-denied-' + source + '-390.png'), animations: 'disabled' });
    resourceFailure = true;
    await failure.getByRole('button', { name: '重新加载', exact: true }).click();
    await expect(failure).toContainText('本次项目设置读取暂时不可用');
    await expect(panel).not.toContainText(shown); await expect(rows).toHaveCount(0);
    const grant = await admin.request.put(`/api/projects/${project.id}/members/${manager.id}`, { data: { role: 'manager', expectedMembershipUpdatedAt: null } });
    expect(grant.ok(), await grant.text()).toBe(true);
    resourceFailure = false; otherReadsFail = false;
    await failure.getByRole('button', { name: '重新加载', exact: true }).click();
    await expect(panel).toContainText(shown);
    await page.reload(); await expect(panel).toContainText(shown);
    expect(await read('/api/people')).toEqual(beforePeople);
    expect(await read('/api/projects')).toEqual(beforeProjects);
    expect(await read(archivesUrl)).toEqual(beforeArchives);
    expect(writes).toEqual([]); expect(errors).toEqual([]);
  } finally {
    await info.attach('settings-access-recovery', { body: JSON.stringify({ source, writes, errors }), contentType: 'application/json' });
    await admin.close();
  }
});
