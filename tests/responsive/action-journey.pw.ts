import { test, expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import type { Requirement } from '../../src/client/types';
import type { PathAnalysis } from '../../src/shared/paths';
import { addBusinessDays, todayIso } from '../../src/shared/domain';

async function post(request: APIRequestContext, url: string, data: Record<string, unknown>) {
  const response = await request.post(url, { data });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function fixture(page: Page, browser: Browser, baseURL: string) {
  const admin = await post(page.request, '/api/login', { username: 'admin', password: '41_xc7q0qOjo4Inw!' });
  const project = await post(page.request, '/api/projects', { name: '行动交接旅程' + Date.now() });
  const owner = await post(page.request, '/api/people', { projectId: project.id, name: '需求主责' + Date.now() });
  const executor = await post(page.request, '/api/people', { projectId: project.id, name: '接口执行人' + Date.now() });
  const coordinator = await post(page.request, '/api/people', { projectId: project.id, name: '环境协调人' + Date.now() });
  const r = await post(page.request, '/api/requirements', { projectId: project.id, ownerId: owner.id, title: '交接中的需求', executionMode: 'work_items' });
  await post(page.request, `/api/requirements/${r.id}/work-items`, { expectedVersion: r.version, title: '接口执行与验证', ownerId: executor.id, plannedStart: todayIso(), plannedEnd: addBusinessDays(todayIso(), 1) });
  const detail = async () => (await (await page.request.get('/api/requirements/' + r.id)).json()) as Requirement;
  const work = (await detail()).workItems[0];
  const context = await browser.newContext({ baseURL, viewport: { width: 1366, height: 768 } });
  try {
    const session = await post(context.request, '/api/login', { username: executor.name, password: '888888' });
    await post(context.request, '/api/account/change-password', { currentPassword: '888888', newPassword: 'Action-journey-member!2026' });
    const selectProject = ({ accountId, projectId }: { accountId: string; projectId: string }) => localStorage.setItem('project-manage:selected-project:' + accountId, projectId);
    await page.addInitScript(selectProject, { accountId: admin.accountId, projectId: project.id });
    await context.addInitScript(selectProject, { accountId: session.accountId, projectId: project.id });
    const actor = await context.newPage();
    const command = async (action: string, data: Record<string, unknown> = {}) => post(actor.request, `/api/work-items/${work.id}/${action}`, { expectedVersion: (await detail()).workItems[0].version, ...data });
    return { actor, context, project, executor, coordinator, work, detail, command };
  } catch (error) { await context.close(); throw error; }
}

test('撤出范围后仍能从行动跟进正在阻塞的工作，保存并返回原筛选', async ({ page, browser, baseURL }) => {
  const f = await fixture(page, browser, baseURL!);
  try {
    await f.command('start');
    await f.command('block', { reason: '等待环境核对' });
    const current = await f.detail();
    const response = await page.request.patch('/api/requirements/' + current.id, { data: { expectedVersion: current.version, deliveryScope: 'candidate', reason: '本期撤出，已开始工作继续处理' } });
    expect(response.ok(), await response.text()).toBe(true);
    await f.actor.goto(`/actions?reason=blocked&ownerId=${f.executor.id}`);
    const row = f.actor.locator('.action-item').filter({ hasText: f.work.title });
    await expect(row).toBeVisible();
    await row.click();
    const dialog = f.actor.getByRole('dialog', { name: '跟进阻塞', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('跟进说明', { exact: true }).fill('本期范围已调整，接口核对仍继续');
    await dialog.getByLabel('下次核对日期', { exact: true }).fill(addBusinessDays(todayIso(), 2));
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const after = await f.detail();
    expect(after.workItems[0].status).toBe('blocked');
    expect(after.progressUpdates?.some(update => update.content.includes('接口核对仍继续'))).toBe(true);
    await f.actor.getByRole('button', { name: '返回', exact: true }).click();
    await expect(f.actor).toHaveURL(new RegExp('/actions\\?reason=blocked&ownerId=' + f.executor.id));
    await expect(f.actor.getByLabel('行动原因', { exact: true })).toHaveValue('blocked');
    await expect(f.actor.getByLabel('负责人', { exact: true })).toHaveValue(f.executor.id);
    await expect(row).toBeVisible();
  } finally { await f.context.close(); }
});

test('问题解决后行动交给执行人，直接进入工作项解阻；返回后行动消失且筛选保留', async ({ page, browser, baseURL }) => {
  const f = await fixture(page, browser, baseURL!);
  try {
    const analysis = async () => (await (await page.request.get(`/api/projects/${f.project.id}/path-analysis`)).json()) as PathAnalysis;
    const r = await f.detail();
    await post(page.request, `/api/requirements/${r.id}/dependency-review`, { expectedRevision: (await analysis()).revision, reviewed: true, forecastAcceptance: addBusinessDays(todayIso(), 1) });
    const estimate = await page.request.patch(`/api/work-items/${f.work.id}/path-estimate`, { data: { expectedRevision: (await analysis()).revision, durationDays: 2, unblockEstimate: todayIso() } });
    expect(estimate.ok(), await estimate.text()).toBe(true);
    const issue = await post(page.request, '/api/issues', { projectId: f.project.id, ownerId: f.coordinator.id, title: '环境恢复交接', discoveredAt: todayIso(), nextReviewAt: addBusinessDays(todayIso(), 5) });
    await f.command('start');
    await f.command('block', { reason: '等待环境恢复', blockedIssueId: issue.id });
    expect((await analysis()).blockers.find(b => b.workItemId === f.work.id)?.critical).toBe(true);
    await f.actor.goto(`/actions?reason=blocked&ownerId=${f.coordinator.id}`);
    await f.actor.locator('.action-item').filter({ hasText: issue.title }).click();
    await expect(f.actor.getByRole('dialog', { name: '问题详情', exact: true })).toContainText(issue.title);
    await f.actor.goBack();
    await expect(f.actor).toHaveURL(/\/actions\?/);
    await page.goto('/issues?issueId=' + issue.id);
    await page.getByRole('dialog', { name: '问题详情', exact: true }).locator('.issue-status-trigger').click();
    await page.getByRole('button', { name: /确认解决/ }).click();
    await page.getByLabel('填写闭环说明', { exact: true }).fill('环境恢复，执行人可以确认继续工作');
    await page.getByRole('button', { name: '确认变更', exact: true }).click();
    await expect.poll(async () => (await (await page.request.get('/api/issues/' + issue.id)).json()).status).toBe('resolved');
    expect((await f.detail()).workItems[0].status).toBe('blocked');
    await f.actor.reload();
    await expect(f.actor.locator('.action-item')).toHaveCount(0);
    await f.actor.getByLabel('负责人', { exact: true }).selectOption(f.executor.id);
    await f.actor.getByLabel('行动原因', { exact: true }).selectOption('blocker_resolved');
    const row = f.actor.locator('.action-item').filter({ hasText: f.work.title });
    await expect(row).toContainText('关联问题已解决，请确认解阻');
    await expect(row).not.toContainText('下次核对');
    await row.click();
    await expect(f.actor).toHaveURL(new RegExp('/requirements/' + r.id + '\\?workItemId=' + f.work.id));
    await expect(f.actor.locator('.graph-workspace')).toHaveCount(0);
    await f.actor.getByRole('button', { name: '解除阻塞', exact: true }).click();
    await expect.poll(async () => (await f.detail()).workItems[0].status).toBe('in_progress');
    await f.actor.getByRole('button', { name: '返回', exact: true }).click();
    await expect(f.actor).toHaveURL(/\/actions\?/);
    await expect(f.actor.getByLabel('负责人', { exact: true })).toHaveValue(f.executor.id);
    await expect(f.actor.getByLabel('行动原因', { exact: true })).toHaveValue('blocker_resolved');
    await expect(f.actor.locator('.action-item')).toHaveCount(0);
    await expect(f.actor.getByText('没有匹配的待处理事项', { exact: true })).toBeVisible();
  } finally { await f.context.close(); }
});

test('指定验收成员从行动完成验收，390px 下保持入口、责任与返回筛选一致', async ({ page, browser, baseURL }, info) => {
  const f = await fixture(page, browser, baseURL!);
  const reviewContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  try {
    const session = await post(reviewContext.request, '/api/login', { username: f.coordinator.name, password: '888888' });
    await post(reviewContext.request, '/api/account/change-password', { currentPassword: '888888', newPassword: 'Acceptance-journey!2026' });
    await reviewContext.addInitScript(({ accountId, projectId }) => localStorage.setItem('project-manage:selected-project:' + accountId, projectId), { accountId: session.accountId, projectId: f.project.id });
    const r = await f.detail();
    const assign = await page.request.patch('/api/requirements/' + r.id, { data: { expectedVersion: r.version, acceptanceOwnerId: f.coordinator.id, acceptanceCriteria: '接口契约与验证记录一致' } });
    expect(assign.ok(), await assign.text()).toBe(true);
    await f.command('start');
    await f.command('complete', { content: '接口实现与验证已完成，交给验收人核对' });
    expect((await f.detail()).acceptedAt).toBeNull();
    const reviewer = await reviewContext.newPage();
    await reviewer.goto(`/actions?reason=pending_acceptance&ownerId=${f.coordinator.id}`);
    const row = reviewer.locator('.action-item').filter({ hasText: r.title });
    await expect(row).toContainText(f.coordinator.name);
    await row.click();
    const dialog = reviewer.getByRole('dialog', { name: '确认验收', exact: true });
    await expect(dialog).toContainText('接口契约与验证记录一致');
    await dialog.getByLabel('验收说明', { exact: true }).fill('已经核对接口契约与验证记录');
    await dialog.getByRole('button', { name: '确认验收', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const accepted = await f.detail();
    expect(accepted.status).toBe('completed');
    expect(accepted.acceptedByAccountId).toBe(session.accountId);
    await expect(reviewer.locator('.sidebar')).toHaveClass(/sidebar-collapsed/);
    expect((await reviewer.locator('.topbar').boundingBox())?.height).toBe(88);
    await reviewer.screenshot({ path: info.outputPath('acceptance-return-390.png') });
    await reviewer.getByRole('button', { name: '返回', exact: true }).click();
    await expect(reviewer).toHaveURL(/\/actions\?/);
    await expect(reviewer.getByLabel('行动原因', { exact: true })).toHaveValue('pending_acceptance');
    await expect(reviewer.getByLabel('负责人', { exact: true })).toHaveValue(f.coordinator.id);
    await expect(reviewer.locator('.action-item')).toHaveCount(0);
    await expect(reviewer.getByText('没有匹配的待处理事项', { exact: true })).toBeVisible();
    expect(await reviewer.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  } finally { await reviewContext.close(); await f.context.close(); }
});
