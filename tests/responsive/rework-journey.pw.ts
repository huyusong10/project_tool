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
  const summary = async () => await (await page.request.get(`/api/projects/${project.id}/delivery-commitments/summary`)).json();
  await page.goto('/requirements/' + r.id);
  return { r, detail, summary };
}

async function accept(page: Page, content: string) {
  await page.getByRole('button', { name: '确认验收', exact: true }).click();
  await page.getByLabel('验收说明').fill(content);
  await page.getByRole('dialog').getByRole('button', { name: '确认验收', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('验收后从工作项重开，再次完成和验收；历史说明与统计同步', async ({ page }) => {
  const { r, detail, summary } = await fixture(page);
  await accept(page, '首次交付通过');
  const acceptedAt = (await detail()).acceptedAt;
  expect(acceptedAt).toBeTruthy();
  const row = page.locator('.requirement-gantt-row').filter({ hasText: '实现接口' });
  await row.getByRole('button', { name: '更多工作项操作' }).click();
  await page.getByRole('button', { name: '重开/返工', exact: true }).click();
  await page.getByLabel('返工原因').fill('接口缺少边界验证');
  await page.getByRole('button', { name: '确认重开', exact: true }).click();
  await expect(row.getByRole('button', { name: '完成', exact: true })).toBeVisible();
  await expect(page.locator('.progress-feed')).toContainText('重开工作项：实现接口');
  expect(await summary()).toMatchObject({ acceptedCount: 1, reworkCount: 1, reacceptedCount: 0 });
  expect(await detail()).toMatchObject({ acceptedAt: null, status: 'in_progress' });
  await row.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByLabel('完成说明').fill('补充边界验证完成');
  await page.getByRole('button', { name: '确认完成', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认验收', exact: true })).toBeVisible();
  await accept(page, '补充验证通过，再次验收');
  expect(await summary()).toMatchObject({ acceptedCount: 1, reworkCount: 1, reacceptedCount: 1 });
  const after = await detail();
  expect(after.status).toBe('completed');
  expect(after.progressUpdates).toEqual(expect.arrayContaining([expect.objectContaining({ eventType: 'accept', createdAt: acceptedAt })]));
  await page.reload();
  await expect(page.locator('.progress-feed')).toContainText('接口缺少边界验证');
  await expect(page.locator('.progress-feed')).not.toContainText(r.workItems[0].id);
});

test('需求退回明确选择工作项，刷新后每项都有返工说明和待执行入口', async ({ page }) => {
  const { detail, summary } = await fixture(page);
  await page.getByRole('button', { name: '退回返工', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: '实现接口', exact: true }).check();
  await dialog.getByRole('checkbox', { name: '回归验证', exact: true }).check();
  await page.getByLabel('执行说明').fill('两项都需要补充验收证据');
  await dialog.getByRole('button', { name: '退回返工', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.requirement-gantt-row').getByRole('button', { name: '完成', exact: true })).toHaveCount(2);
  expect(await summary()).toMatchObject({ acceptedCount: 0, reworkCount: 1 });
  await page.reload();
  for (const title of ['实现接口', '回归验证']) {
    const record = page.locator('.progress-feed > article').filter({ hasText: '两项都需要补充验收证据' }).filter({ has: page.locator('strong', { hasText: title }) });
    await expect(record).toHaveCount(1);
  }
  const current = await detail();
  expect(current.workItems.every(w => w.status === 'in_progress' && w.actualEnd === null)).toBe(true);
  expect(current.progressUpdates?.filter(e => e.eventType === 'rework')).toHaveLength(3);
});
