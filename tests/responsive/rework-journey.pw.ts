import { test, expect, type Page } from '@playwright/test';
import type { Requirement } from '../../src/client/types';

async function fixture(page: Page) {
  expect((await page.request.post('/api/login', { data: { username: 'admin', password: '41_xc7q0qOjo4Inw!' } })).ok()).toBe(true);
  const session = await (await page.request.get('/api/session')).json();
  const project = await (await page.request.post('/api/projects', { data: { name: '返工操作验证' + Date.now() } })).json();
  const owner = await (await page.request.post('/api/people', { data: { projectId: project.id, name: '返工执行人' + Date.now() } })).json();
  const template = await (await page.request.post('/api/templates', { data: { projectId: project.id, name: '返工流程', items: [
    { title: '实现接口', startOffsetDays: 0, durationDays: 1, sortOrder: 0 },
    { title: '回归验证', startOffsetDays: 1, durationDays: 1, sortOrder: 1 },
  ] } })).json();
  const response = await page.request.post('/api/requirements', { data: { projectId: project.id, ownerId: owner.id, templateId: template.id, title: '需要重新核对的交付', plannedStart: '2020-01-02' } });
  expect(response.ok()).toBe(true);
  const r = await response.json() as Requirement;
  for (const w of r.workItems) {
    const assigned = await page.request.patch('/api/work-items/' + w.id, { data: { expectedVersion: w.version, ownerId: owner.id, reason: '补录已有交付' } });
    expect(assigned.ok()).toBe(true);
    expect((await page.request.post(`/api/work-items/${w.id}/complete-as-planned`, { data: { expectedVersion: (await assigned.json()).version } })).ok()).toBe(true);
  }
  await page.addInitScript(({ account, projectId }) => localStorage.setItem('project-manage:selected-project:' + account, projectId), { account: session.accountId, projectId: project.id });
  const detail = async () => await (await page.request.get('/api/requirements/' + r.id)).json() as Requirement;
  await page.goto('/requirements/' + r.id);
  return { r, detail };
}

test('工作完成后从工作项重开并再次完成，历史说明同步', async ({ page }) => {
  const { r, detail } = await fixture(page);
  expect(await detail()).toMatchObject({ status: 'completed', progress: 100, acceptedAt: null });
  const row = page.locator('.requirement-gantt-row').filter({ hasText: '实现接口' });
  await row.getByRole('button', { name: '更多工作项操作' }).click();
  await page.getByRole('button', { name: '重开/返工', exact: true }).click();
  await page.getByLabel('返工原因').fill('接口缺少边界验证');
  await page.getByRole('button', { name: '确认重开', exact: true }).click();
  await expect(row.getByRole('button', { name: '完成', exact: true })).toBeVisible();
  await expect(page.locator('.progress-feed')).toContainText('重开工作项：实现接口');
  expect(await detail()).toMatchObject({ acceptedAt: null, status: 'in_progress' });
  await row.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByLabel('完成说明').fill('补充边界验证完成');
  await page.getByRole('button', { name: '确认完成', exact: true }).click();
  await expect.poll(async () => (await detail()).status).toBe('completed');
  const after = await detail();
  expect(after).toMatchObject({ status: 'completed', progress: 100, acceptedAt: null });
  expect(after.progressUpdates).toEqual(expect.arrayContaining([expect.objectContaining({ eventType: 'rework', content: expect.stringContaining('接口缺少边界验证') })]));
  await page.reload();
  await expect(page.locator('.progress-feed')).toContainText('接口缺少边界验证');
  await expect(page.locator('.progress-feed')).not.toContainText(r.workItems[0].id);
});

test('多个已完成工作项逐项返工，刷新后每项保留返工说明和待执行入口', async ({ page }) => {
  const { detail } = await fixture(page);
  for (const title of ['实现接口', '回归验证']) {
    const row = page.locator('.requirement-gantt-row').filter({ hasText: title });
    await row.getByRole('button', { name: '更多工作项操作' }).click();
    await page.getByRole('button', { name: '重开/返工', exact: true }).click();
    await page.getByLabel('返工原因').fill('两项都需要补充交付证据');
    await page.getByRole('button', { name: '确认重开', exact: true }).click();
  }
  await expect(page.locator('.requirement-gantt-row').getByRole('button', { name: '完成', exact: true })).toHaveCount(2);
  await page.reload();
  for (const title of ['实现接口', '回归验证']) {
    const record = page.locator('.progress-feed > article').filter({ hasText: '两项都需要补充交付证据' }).filter({ has: page.locator('strong', { hasText: title }) });
    await expect(record).toHaveCount(1);
  }
  const current = await detail();
  expect(current.workItems.every(w => w.status === 'in_progress' && w.actualEnd === null)).toBe(true);
  expect(current.progressUpdates?.filter(e => e.eventType === 'reopen')).toHaveLength(2);
  expect(current.progressUpdates?.filter(e => e.eventType === 'rework')).toHaveLength(1);
});
