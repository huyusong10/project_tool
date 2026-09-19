import { expect, test, type APIRequestContext } from '@playwright/test';
import { addBusinessDays, todayIso } from '../../src/shared/domain';
test.use({ actionTimeout: 10_000 });

for (const [view, source] of [['matrix', 'people'], ['analysis', 'people'], ['analysis', 'report']] as const) test(source === 'report' ? '人力报表独立失权后清除旧内容，重新授权后恢复分页' : `人员${view === 'matrix' ? '矩阵' : '分析'}在名单失权后清除旧内容，临时失败不恢复旧名单`, async ({ page, browser, baseURL }, info) => {
  test.setTimeout(90_000);
  const admin = await browser.newContext({ baseURL });
  const writes: string[] = [], errors: string[] = [];
  const post = async (request: APIRequestContext, url: string, data: object) => {
    const response = await request.post(url, { data }); expect(response.ok(), await response.text()).toBe(true); return response.json();
  };
  const read = async (url: string) => {
    const response = await admin.request.get(url); expect(response.ok(), await response.text()).toBe(true); return response.json();
  };
  const resourcePath = source === 'people' ? '/api/people' : '/api/analytics/people-concurrency';
  const resourceLabel = source === 'people' ? '人员列表' : '人力分析';
  let resourceFailure = false, otherReadsFail = false;
  try {
    await post(admin.request, '/api/login', { username: 'admin', password: '41_xc7q0qOjo4Inw!' });
    const project = await post(admin.request, '/api/projects', { name: '人员访问核对 ' + view + Date.now() });
    const reader = await post(admin.request, '/api/people', { projectId: project.id, name: '访问成员 ' + view + Date.now() });
    const target = await post(admin.request, '/api/people', { projectId: project.id, name: '项目专属人员 ' + view + Date.now(), jobTitle: '研发' });
    const requirement = source === 'report' ? await post(admin.request, '/api/requirements', { projectId: project.id, title: '报表访问核对', ownerId: target.id, plannedStart: addBusinessDays(todayIso(), 0), plannedEnd: addBusinessDays(todayIso(), 4) }) : undefined;
    const beforeRequirement = requirement ? await read('/api/requirements/' + requirement.id) : undefined;
    await post(page.request, '/api/login', { username: reader.name, password: '888888' });
    await post(page.request, '/api/account/change-password', { currentPassword: '888888', newPassword: 'people-access-recovery-password' });
    const beforePeople = await read('/api/people'), beforeProjects = await read('/api/projects');
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      if ((resourceFailure && path === resourcePath) || (otherReadsFail && path !== resourcePath && ['/api/projects', '/api/session', '/api/people', '/api/analytics/people-concurrency'].includes(path))) {
        return route.fulfill({ status: 503, json: { error: '本次读取暂时不可用' } });
      }
      return route.continue();
    });
    page.on('request', request => { if (request.url().includes('/api/') && !['GET', 'HEAD'].includes(request.method())) writes.push(request.method() + ' ' + new URL(request.url()).pathname); });
    page.on('pageerror', error => errors.push(error.message));
    const url = '/people?' + new URLSearchParams({ projectId: project.id, view, q: target.name, jobTitle: '研发', analysisPersonId: target.id, analysisJobTitle: '研发' });
    await page.goto(url);
    const selected = view === 'matrix' ? page.locator('.person-card strong') : page.getByLabel('分析人员', { exact: true }).locator('option:checked');
    await expect(selected).toHaveText(target.name);
    const reportRows = page.getByRole('table', { name: '人员工作日并发度矩阵' }).locator('tbody tr');
    if (source === 'report') await expect(reportRows).toContainText(target.name);
    resourceFailure = true; otherReadsFail = true;
    await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
    const warning = page.locator('.warning-banner').filter({ hasText: resourceLabel + '刷新失败' });
    await expect(warning).toBeVisible(); await expect(selected).toHaveText(target.name);
    if (source === 'report') await expect(reportRows).toContainText(target.name);
    const removal = await admin.request.delete(`/api/projects/${project.id}/members/${reader.id}`);
    expect(removal.ok(), await removal.text()).toBe(true);
    resourceFailure = false;
    const denied = page.waitForResponse(response => new URL(response.url()).pathname === resourcePath && response.status() === (source === 'people' ? 404 : 403), { timeout: 10_000 });
    await warning.getByRole('button', { name: '重新加载', exact: true }).click(); await denied;
    await expect(page.locator('.people-matrix, .human-matrix-frame')).toHaveCount(0);
    await expect(page.getByText(resourceLabel + '加载失败', { exact: true })).toBeVisible();
    await expect(page.getByText(source === 'people' ? '项目不存在或未开放游客浏览' : '没有访问当前项目的权限', { exact: true })).toBeVisible();
    if (source === 'people') await expect(page.getByText(target.name, { exact: true })).toHaveCount(0);
    else await expect(page.locator('.human-leaders')).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: info.outputPath('people-denied-' + view + '-390.png'), animations: 'disabled' });
    resourceFailure = true;
    const failure = page.locator('.empty-state').filter({ hasText: resourceLabel + '加载失败' });
    await failure.getByRole('button', { name: '重新加载', exact: true }).click();
    await expect(failure).toContainText('本次读取暂时不可用');
    await expect(page.locator('.people-matrix, .human-matrix-frame')).toHaveCount(0);
    const grant = await admin.request.put(`/api/projects/${project.id}/members/${reader.id}`, { data: { role: 'member', expectedMembershipUpdatedAt: null } });
    expect(grant.ok(), await grant.text()).toBe(true);
    resourceFailure = false; otherReadsFail = false;
    await failure.getByRole('button', { name: '重新加载', exact: true }).click();
    await expect(selected).toHaveText(target.name);
    if (view === 'matrix') { await expect(page.getByPlaceholder('搜索姓名、岗位或拼音')).toHaveValue(target.name); await expect(page.getByLabel('岗位筛选', { exact: true })).toHaveValue('研发'); }
    else { await expect(page.getByLabel('分析人员', { exact: true })).toHaveValue(target.id); await expect(page.getByLabel('分析岗位', { exact: true })).toHaveValue('研发'); }
    if (source === 'report') {
      await expect(reportRows).toContainText(target.name);
      const nextWindow = page.waitForResponse(response => new URL(response.url()).pathname === resourcePath && new URL(response.url()).searchParams.has('from'));
      await page.getByRole('button', { name: '加载后续7天', exact: true }).click(); expect((await nextWindow).status()).toBe(200);
    }
    await page.reload(); await expect(selected).toHaveText(target.name);
    if (source === 'report') await expect(reportRows).toContainText(target.name);
    expect(await read('/api/people')).toEqual(beforePeople); expect(await read('/api/projects')).toEqual(beforeProjects);
    if (requirement) expect(await read('/api/requirements/' + requirement.id)).toEqual(beforeRequirement);
    expect(writes).toEqual([]); expect(errors).toEqual([]);
  } finally {
    await info.attach('people-access-recovery', { body: JSON.stringify({ view, source, writes, errors }), contentType: 'application/json' });
    await admin.close();
  }
});
