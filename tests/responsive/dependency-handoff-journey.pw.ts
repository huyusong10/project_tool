import { expect, test, type APIRequestContext } from '@playwright/test';
import type { Requirement } from '../../src/client/types';
import { addBusinessDays, todayIso } from '../../src/shared/domain';

test('我的工作提示未完成前置，允许记录真实开始，交接完成后提示消失', async ({ page, browser, baseURL }, info) => {
  const post = async (request: APIRequestContext, url: string, data: object) => {
    const response = await request.post(url, { data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  await post(page.request, '/api/login', { username: 'admin', password: '41_xc7q0qOjo4Inw!' });
  const project = await post(page.request, '/api/projects', { name: '交接提示 ' + Date.now() });
  const owner = await post(page.request, '/api/people', { projectId: project.id, name: '交接执行人 ' + Date.now() });
  const detail = async (id: string) => await (await page.request.get('/api/requirements/' + id)).json() as Requirement;
  const requirements: Requirement[] = [];
  for (const title of ['上游交付', '下游接入']) {
    let requirement = await post(page.request, '/api/requirements', { projectId: project.id, ownerId: owner.id, title }) as Requirement;
    await post(page.request, '/api/requirements/' + requirement.id + '/work-items', { expectedVersion: requirement.version, title, ownerId: owner.id, plannedStart: addBusinessDays(todayIso(), 0), plannedEnd: addBusinessDays(todayIso(), 1) });
    requirement = await detail(requirement.id);
    requirements.push(requirement);
  }
  const [source, target] = requirements;
  const analysis = await (await page.request.get('/api/projects/' + project.id + '/path-graph?view=features')).json();
  await post(page.request, '/api/projects/' + project.id + '/dependencies', { sourceRequirementId: source.id, sourceWorkItemId: source.workItems[0].id, targetRequirementId: target.id, targetWorkItemId: target.workItems[0].id, expectedRevision: analysis.analysis.revision });
  const context = await browser.newContext({ baseURL, viewport: page.viewportSize() });
  try {
    await post(context.request, '/api/login', { username: owner.name, password: '888888' });
    await post(context.request, '/api/account/change-password', { currentPassword: '888888', newPassword: 'handoff-journey-password' });
    const actor = await context.newPage();
    await actor.goto('/my-work');
    const row = actor.locator(`[data-work-item-id="${target.workItems[0].id}"]`);
    const notice = row.getByRole('button', { name: '查看下游接入的执行提示', exact: true });
    await expect(notice).toHaveText('前置未完成');
    await expect(notice).toHaveAttribute('title', /上游交付/);
    await notice.click();
    const panel = actor.getByRole('tabpanel', { name: '概况', exact: true });
    await expect(panel).toContainText('等待前置');
    await expect(panel).toContainText('上游交付');
    await actor.getByRole('button', { name: '关闭', exact: true }).click();
    await actor.getByRole('link', { name: '我的工作', exact: true }).click();
    await row.getByRole('button', { name: '开始', exact: true }).click();
    await expect(row.getByRole('button', { name: '完成', exact: true })).toBeVisible();
    await expect(notice).toHaveText('执行提示');
    await expect(notice).toHaveAttribute('title', /已开始但前置条件尚未满足/);
    await actor.reload();
    await expect(notice).toBeVisible();
    await actor.setViewportSize({ width: 390, height: 844 });
    await expect(actor.locator('.requirement-gantt-grid')).toHaveClass(/has-inline-actions/);
    await expect(notice).toBeVisible();
    await notice.scrollIntoViewIfNeeded();
    await expect(notice).toBeInViewport();
    const bounds = (await notice.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    await actor.screenshot({ path: info.outputPath('handoff-notice-390.png'), animations: 'disabled' });
    await notice.click();
    await expect(panel.getByRole('alert')).toContainText('已开始但前置条件尚未满足');
    const before = await detail(target.id);
    const upstream = (await detail(source.id)).workItems[0];
    await post(page.request, '/api/work-items/' + upstream.id + '/start', { expectedVersion: upstream.version });
    await post(page.request, '/api/work-items/' + upstream.id + '/complete', { expectedVersion: (await detail(source.id)).workItems[0].version, content: '上游已交付' });
    await actor.getByRole('button', { name: '关闭', exact: true }).click();
    await actor.getByRole('link', { name: '我的工作', exact: true }).click();
    await expect(notice).toHaveCount(0);
    await expect(row.getByRole('button', { name: '完成', exact: true })).toBeVisible();
    const after = await detail(target.id);
    expect(after.workItems[0]).toMatchObject({ status: 'in_progress', progress: 0, actualStart: before.workItems[0].actualStart });
    expect(after.progressUpdates).toEqual(before.progressUpdates);
  } finally { await context.close(); }
});
