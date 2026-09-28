import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { addBusinessDays, todayIso } from '../../src/shared/domain';
import type { Requirement } from '../../src/client/types';

async function post(request: APIRequestContext, url: string, data: object) {
  const response = await request.post(url, { data });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function setup(page: Page, browser: Browser, baseURL?: string) {
  await post(page.request, '/api/login', { username: 'admin', password: '41_xc7q0qOjo4Inw!' });
  const project = await post(page.request, '/api/projects', { name: '预测旅程 ' + Date.now() });
  const owner = await post(page.request, '/api/people', { projectId: project.id, name: '需求负责 ' + Date.now() });
  const worker = await post(page.request, '/api/people', { projectId: project.id, name: '预测执行 ' + Date.now() });
  const requirement = await post(page.request, '/api/requirements', { projectId: project.id, ownerId: owner.id, title: '预测交付核对' });
  const detail = async () => await (await page.request.get('/api/requirements/' + requirement.id)).json() as Requirement;
  await post(page.request, '/api/requirements/' + requirement.id + '/work-items', { expectedVersion: requirement.version, title: '补充异常验证', ownerId: worker.id, plannedStart: addBusinessDays(todayIso(), 0), plannedEnd: addBusinessDays(todayIso(), 1) });
  const work = (await detail()).workItems[0];
  await post(page.request, '/api/work-items/' + work.id + '/start', { expectedVersion: work.version });
  const context = await browser.newContext({ baseURL, viewport: page.viewportSize() });
  await post(context.request, '/api/login', { username: worker.name, password: '888888' });
  await post(context.request, '/api/account/change-password', { currentPassword: '888888', newPassword: 'forecast-journey-password' });
  const actor = await context.newPage();
  await actor.goto('/my-work');
  await actor.locator(`[data-work-item-id="${work.id}"]`).getByRole('button', { name: work.title, exact: true }).click();
  await actor.getByRole('tab', { name: '概况', exact: true }).click();
  return { project, requirement, work, detail, actor, context };
}

test('执行人员从我的工作更新及清空预测，经理读到相同结果且计划和历史不变', async ({ page, browser, baseURL }, info) => {
  const { requirement, work, detail, actor, context } = await setup(page, browser, baseURL);
  try {
    const before = await detail(), forecast = addBusinessDays(todayIso(), 3);
    await actor.getByRole('button', { name: '更新预测', exact: true }).click();
    const form = actor.getByRole('dialog', { name: '更新交付预测', exact: true });
    await expect(form).toContainText('已完成 0%');
    await expect(form.getByLabel('人工预测完成')).toHaveValue('');
    await actor.setViewportSize({ width: 390, height: 844 });
    await form.getByLabel('人工预测完成').fill(forecast);
    await form.getByRole('button', { name: '保存预测', exact: true }).scrollIntoViewIfNeeded();
    await expect(form.getByRole('button', { name: '保存预测', exact: true })).toBeInViewport();
    expect(await form.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await actor.screenshot({ path: info.outputPath('forecast-390.png') });
    await form.getByRole('button', { name: '保存预测', exact: true }).click();
    await expect(form).toHaveCount(0);
    await actor.reload();
    const facts = actor.getByRole('region', { name: '执行资料', exact: true });
    await expect(facts).toContainText(forecast);
    const after = await detail();
    expect(after.workItems[0]).toMatchObject({ forecastEnd: forecast, plannedStart: work.plannedStart, plannedEnd: work.plannedEnd, progress: 0, status: 'in_progress', actualStart: before.workItems[0].actualStart });
    expect(after.progressUpdates).toEqual(before.progressUpdates);
    await page.goto('/requirements/' + requirement.id);
    await expect(page.getByRole('region', { name: '执行进展', exact: true })).toContainText(forecast);
    await actor.getByRole('button', { name: '更新预测', exact: true }).click();
    await expect(form.getByLabel('人工预测完成')).toHaveValue(forecast);
    await form.getByLabel('人工预测完成').fill('');
    await form.getByRole('button', { name: '保存预测', exact: true }).click();
    await expect(form).toHaveCount(0);
    const cleared = await detail();
    expect(cleared.workItems[0].forecastEnd).toBeNull();
    expect(cleared.progressUpdates).toEqual(before.progressUpdates);
    await actor.reload();
    await expect(facts).toContainText(cleared.workItems[0].deliveryForecast!.end!);
    await page.reload();
    await expect(page.getByRole('region', { name: '执行进展', exact: true })).toContainText(cleared.deliveryForecast!.end!);
  } finally { await context.close(); }
});

test('预测冲突保留输入，保存响应丢失后读取结果且不重复提交', async ({ page, browser, baseURL }) => {
  const { project, work, detail, actor, context } = await setup(page, browser, baseURL);
  try {
    const desired = addBusinessDays(todayIso(), 3), competing = addBusinessDays(todayIso(), 4);
    await actor.getByRole('button', { name: '更新预测', exact: true }).click();
    const form = actor.getByRole('dialog', { name: '更新交付预测', exact: true });
    const input = form.getByLabel('人工预测完成'), save = form.getByRole('button', { name: '保存预测', exact: true });
    await input.fill(desired);
    const analysis = await (await page.request.get('/api/projects/' + project.id + '/path-analysis?target=project')).json();
    const changed = await page.request.patch('/api/work-items/' + work.id + '/path-estimate', { data: { expectedRevision: analysis.revision, forecastEnd: competing } });
    expect(changed.ok(), await changed.text()).toBe(true);
    await save.click();
    await expect(form.getByRole('button', { name: '重新读取并核对' })).toBeVisible();
    await expect(save).toBeDisabled();
    await expect(input).toHaveValue(desired);
    await form.getByRole('button', { name: '重新读取并核对' }).click();
    await expect(form).toContainText('当前人工预测：' + competing);
    await expect(input).toHaveValue(desired);
    await expect(save).toBeEnabled();
    let writes = 0;
    await actor.route('**/api/work-items/' + work.id + '/path-estimate', async route => {
      writes++;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort('failed');
    });
    const before = await detail();
    await save.click();
    await expect(form.getByRole('button', { name: '重新读取并核对' })).toBeVisible();
    await expect(save).toBeDisabled();
    await form.getByRole('button', { name: '重新读取并核对' }).click();
    await expect(form).toContainText('当前人工预测：' + desired);
    await expect(input).toHaveValue(desired);
    await expect(save).toBeDisabled();
    const after = await detail();
    expect(after.workItems[0].version).toBe(before.workItems[0].version + 1);
    expect(after.workItems[0].forecastEnd).toBe(desired);
    expect(after.progressUpdates).toEqual(before.progressUpdates);
    expect(writes).toBe(1);
    await form.getByRole('button', { name: '返回', exact: true }).click();
    await expect(form).toHaveCount(0);
    await expect(actor.getByRole('region', { name: '执行资料', exact: true })).toContainText(desired);
  } finally { await context.close(); }
});
