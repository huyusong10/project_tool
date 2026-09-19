import { expect, test, type APIRequestContext } from '@playwright/test';

for (const source of ['dashboard', 'preview'] as const) test(`统计${source === 'dashboard' ? '看板' : '预览'}失权后清除旧结果，临时失败不恢复旧图表`, async ({ page, browser, baseURL }, info) => {
  const admin = await browser.newContext({ baseURL });
  const writes: string[] = [], errors: string[] = [];
  const post = async (request: APIRequestContext, url: string, data: object) => {
    const response = await request.post(url, { data }); expect(response.ok(), await response.text()).toBe(true); return response.json();
  };
  const read = async (request: APIRequestContext, url: string) => {
    const response = await request.get(url); expect(response.ok(), await response.text()).toBe(true); return response.json();
  };
  let resourceFailure = false, otherReadsFail = false;
  const isTarget = (request: { url(): string; postDataJSON(): { panels: unknown[] } }) => new URL(request.url()).pathname === '/api/analytics/query' && (request.postDataJSON().panels.length === 1) === (source === 'preview');
  const reconnect = () => page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  try {
    await post(admin.request, '/api/login', { username: 'admin', password: '41_xc7q0qOjo4Inw!' });
    const project = await post(admin.request, '/api/projects', { name: '统计权限核对 ' + source + Date.now() });
    const reader = await post(admin.request, '/api/people', { projectId: project.id, name: '统计成员 ' + source + Date.now() });
    const owner = await post(admin.request, '/api/people', { projectId: project.id, name: '统计负责人 ' + source + Date.now() });
    const requirement = await post(admin.request, '/api/requirements', { projectId: project.id, title: '统计实际样本', ownerId: owner.id });
    await post(page.request, '/api/login', { username: reader.name, password: '888888' });
    await post(page.request, '/api/account/change-password', { currentPassword: '888888', newPassword: 'analytics-access-recovery-password' });
    const beforeRequirement = await read(admin.request, '/api/requirements/' + requirement.id);
    const beforePeople = await read(admin.request, '/api/people'), beforeProjects = await read(admin.request, '/api/projects');
    const beforeLayout = await read(page.request, '/api/analytics/layout');
    await page.route('**/api/**', route => {
      const target = isTarget(route.request());
      if (target ? resourceFailure : otherReadsFail) return route.fulfill({ status: 503, json: { error: '本次统计读取暂时不可用' } });
      return route.continue();
    });
    page.on('request', request => { if (request.url().includes('/api/') && !['GET', 'HEAD'].includes(request.method()) && new URL(request.url()).pathname !== '/api/analytics/query') writes.push(request.method() + ' ' + new URL(request.url()).pathname); });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/analytics?' + new URLSearchParams({ projectId: project.id, range: 'custom', from: '2026-09-01', to: '2026-09-30' }));
    const panel = page.locator('.analytics-grid article').filter({ has: page.getByRole('heading', { name: '活跃需求', exact: true }) });
    await expect(panel.locator('.analytics-kpi strong')).toHaveText('1');
    const editor = page.getByRole('dialog', { name: '配置分析图表', exact: true });
    if (source === 'preview') {
      await page.getByRole('button', { name: '编辑看板', exact: true }).click();
      await page.getByRole('button', { name: '编辑活跃需求', exact: true }).click();
      const renamed = page.waitForResponse(response => isTarget(response.request()) && response.status() === 200 && response.request().postDataJSON().panels[0].title === '保留这份未保存配置');
      await editor.getByLabel('图表标题', { exact: true }).fill('保留这份未保存配置'); await renamed;
    }
    const rendered = source === 'dashboard' ? panel.locator('.analytics-kpi strong') : editor.locator('.analytics-config-preview .analytics-kpi strong');
    await expect(rendered).toHaveText('1');
    resourceFailure = true; otherReadsFail = true;
    const temporary = page.waitForResponse(response => isTarget(response.request()) && response.status() === 503);
    await reconnect(); await temporary;
    const warning = source === 'dashboard' ? page.locator('.warning-banner').filter({ hasText: '分析数据刷新失败' }) : editor.locator('.form-error').filter({ hasText: '本次统计读取暂时不可用' });
    await expect(warning).toBeVisible(); await expect(rendered).toHaveText('1');
    const removal = await admin.request.delete(`/api/projects/${project.id}/members/${reader.id}`);
    expect(removal.ok(), await removal.text()).toBe(true);
    resourceFailure = false;
    const denied = page.waitForResponse(response => isTarget(response.request()) && response.status() === 403);
    await reconnect(); await denied;
    await expect(rendered).toHaveCount(0);
    const failure = source === 'dashboard' ? page.locator('.empty-state').filter({ hasText: '分析数据加载失败' }) : editor.locator('.analytics-config-preview .empty-state').filter({ hasText: '图表加载失败' });
    await expect(failure).toBeVisible();
    if (source === 'dashboard') await expect(page.locator('.analytics-grid')).toHaveCount(0);
    else await expect(editor.getByLabel('图表标题', { exact: true })).toHaveValue('保留这份未保存配置');
    await page.setViewportSize({ width: 390, height: 844 });
    if (source === 'preview') { await failure.scrollIntoViewIfNeeded(); await expect(failure).toBeInViewport(); }
    await page.screenshot({ path: info.outputPath('analytics-denied-' + source + '-390.png'), animations: 'disabled' });
    resourceFailure = true;
    const unavailable = page.waitForResponse(response => isTarget(response.request()) && response.status() === 503);
    await reconnect(); await unavailable;
    await expect(source === 'dashboard' ? failure : editor.locator('.form-error').filter({ hasText: '本次统计读取暂时不可用' })).toContainText('本次统计读取暂时不可用');
    await expect(rendered).toHaveCount(0);
    const grant = await admin.request.put(`/api/projects/${project.id}/members/${reader.id}`, { data: { role: 'member', expectedMembershipUpdatedAt: null } });
    expect(grant.ok(), await grant.text()).toBe(true);
    resourceFailure = false; otherReadsFail = false;
    await reconnect(); await expect(rendered).toHaveText('1');
    if (source === 'preview') { await expect(editor.getByLabel('图表标题', { exact: true })).toHaveValue('保留这份未保存配置'); await editor.getByRole('button', { name: '取消', exact: true }).click(); }
    await page.reload(); await expect(panel.locator('.analytics-kpi strong')).toHaveText('1');
    expect(new URL(page.url()).searchParams.get('from')).toBe('2026-09-01');
    expect(new URL(page.url()).searchParams.get('to')).toBe('2026-09-30');
    expect(await read(page.request, '/api/analytics/layout')).toEqual(beforeLayout);
    expect(await read(admin.request, '/api/requirements/' + requirement.id)).toEqual(beforeRequirement);
    expect(await read(admin.request, '/api/people')).toEqual(beforePeople); expect(await read(admin.request, '/api/projects')).toEqual(beforeProjects);
    expect(writes).toEqual([]); expect(errors).toEqual([]);
  } finally {
    await info.attach('analytics-access-recovery', { body: JSON.stringify({ source, writes, errors }), contentType: 'application/json' });
    await admin.close();
  }
});
