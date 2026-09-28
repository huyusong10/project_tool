import { expect, test, type APIRequestContext } from '@playwright/test';
import type { Requirement } from '../../src/client/types';
import { chooseOption } from './select-helper';

async function post(request: APIRequestContext, url: string, data: Record<string, unknown>) {
  const response = await request.post(url, { data });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

for (const mode of ['start', 'deadline'] as const) test(`切换流程${mode}：表单与确认页预览新工作，保存后日期一致`, async ({ page }) => {
  await post(page.request, '/api/login', { username: 'admin', password: '41_xc7q0qOjo4Inw!' });
  const project = await post(page.request, '/api/projects', { name: '切换流程预览 ' + Date.now() });
  const owner = await post(page.request, '/api/people', { projectId: project.id, name: '流程接收人 ' + Date.now() });
  const original = await post(page.request, '/api/templates', { projectId: project.id, name: '原执行方式', items: [
    { title: '原核对工作', startOffsetDays: 0, durationDays: 1, sortOrder: 0 },
  ] });
  const replacement = await post(page.request, '/api/templates', { projectId: project.id, name: '新交付流程', items: [
    { title: '确认接口清单', startOffsetDays: 0, durationDays: 1, sortOrder: 0 },
    { title: '实现并联调接口', startOffsetDays: 1, durationDays: 2, sortOrder: 1 },
    { title: '核对交付结果', startOffsetDays: 3, durationDays: 2, sortOrder: 2 },
  ] });
  const created = await post(page.request, '/api/requirements', { projectId: project.id, title: '既有需求采用新流程', ownerId: owner.id, background: '保留业务背景', acceptanceCriteria: '保留原完成标准', templateId: original.id, plannedStart: '2026-09-22' });
  const read = async () => (await (await page.request.get('/api/requirements/' + created.id)).json()) as Requirement;
  const before = await read();
  await page.goto('/requirements/' + created.id);
  await page.getByRole('button', { name: '调整计划', exact: true }).click();
  const form = page.getByRole('dialog', { name: '调整需求计划', exact: true });
  await chooseOption(form.getByLabel('绑定流程'), replacement.id);
  await form.getByRole('radio', { name: mode === 'start' ? /按开始日期正排/ : /按截止日期倒排/ }).click();
  await form.getByLabel(mode === 'start' ? '计划开始' : '计划完成', { exact: true }).fill(mode === 'start' ? '2026-09-28' : '2026-09-30');
  const expected = mode === 'start'
    ? [['确认接口清单', '2026-09-28', '2026-09-28'], ['实现并联调接口', '2026-09-29', '2026-09-30'], ['核对交付结果', '2026-10-08', '2026-10-09']]
    : [['确认接口清单', '2026-09-23', '2026-09-23'], ['实现并联调接口', '2026-09-24', '2026-09-28'], ['核对交付结果', '2026-09-29', '2026-09-30']];
  const preview = form.getByRole('region', { name: '排期预览', exact: true });
  await expect(preview).toContainText('替换 1 个原工作项');
  for (const [title, start, end] of expected) await expect(preview.getByRole('row').filter({ hasText: title })).toContainText(start + ' ～ ' + end);
  await form.getByRole('button', { name: '保存排期', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '切换需求流程', exact: true });
  for (const [title, start, end] of expected) await expect(confirm.getByRole('row').filter({ hasText: title })).toContainText(start + ' ～ ' + end);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await confirm.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await confirm.getByRole('button', { name: '取消', exact: true }).click();
  expect(await read()).toEqual(before);
  await form.getByRole('button', { name: '保存排期', exact: true }).click();
  await confirm.getByRole('button', { name: '确认切换', exact: true }).click();
  await expect(form).toHaveCount(0);
  const after = await read();
  expect(after).toMatchObject({ templateId: replacement.id, ownerId: before.ownerId, background: before.background, acceptanceCriteria: before.acceptanceCriteria, status: 'not_started', progress: 0, plannedStart: expected[0][1], plannedEnd: expected[2][2] });
  expect(after.progressUpdates).toEqual(before.progressUpdates);
  expect(after.workItems).toHaveLength(3);
  for (const [title, start, end] of expected) expect(after.workItems.find(w => w.title === title)).toMatchObject({ plannedStart: start, plannedEnd: end, status: 'not_started', progress: 0, ownerId: null });
  await page.reload();
  await page.getByRole('tab', { name: '工作项 3', exact: true }).click();
  for (const [title] of expected) await expect(page.getByRole('tabpanel', { name: '工作项 3', exact: true }).getByRole('button', { name: title, exact: true })).toBeVisible();
  if (mode === 'start') {
    const work = after.workItems[0];
    const assigned = await page.request.patch('/api/work-items/' + work.id, { data: { expectedVersion: work.version, ownerId: owner.id } });
    expect(assigned.ok()).toBe(true);
    await post(page.request, '/api/work-items/' + work.id + '/start', { expectedVersion: (await assigned.json()).version });
    await page.reload();
    await page.getByRole('button', { name: '调整计划', exact: true }).click();
    const executed = await read();
    await chooseOption(form.getByLabel('绑定流程'), original.id);
    await expect(form).toContainText('需求已有执行记录，不能切换流程。选择原流程后仍可调整日期。');
    await expect(form.getByRole('button', { name: '保存排期', exact: true })).toBeDisabled();
    await expect(form.getByRole('region', { name: '排期预览', exact: true })).toHaveCount(0);
    await chooseOption(form.getByLabel('绑定流程'), replacement.id);
    await expect(form.getByRole('button', { name: '保存排期', exact: true })).toBeEnabled();
    await form.getByRole('button', { name: '取消', exact: true }).click();
    expect(await read()).toEqual(executed);
  }
});

test('已有计划预览与保存结果一致，完成与取消工作保留执行事实', async ({ page }) => {
  await post(page.request, '/api/login', { username: 'admin', password: '41_xc7q0qOjo4Inw!' });
  const project = await post(page.request, '/api/projects', { name: '重新排期预览 ' + Date.now() });
  const owner = await post(page.request, '/api/people', { projectId: project.id, name: '排期执行人' + Date.now() });
  const template = await post(page.request, '/api/templates', { projectId: project.id, name: '排期核验流程', items: [
    { title: '确认接口清单', startOffsetDays: 0, durationDays: 1, sortOrder: 0 },
    { title: '实现并联调接口', startOffsetDays: 1, durationDays: 2, sortOrder: 1 },
    { title: '核对交付结果', startOffsetDays: 3, durationDays: 2, sortOrder: 2 },
    { title: '已取消的后续工作', startOffsetDays: 5, durationDays: 1, sortOrder: 3 },
  ] });
  const created = await post(page.request, '/api/requirements', { projectId: project.id, title: '接口交付重新排期', templateId: template.id, ownerId: owner.id, plannedStart: '2026-09-22' });
  const detail = async () => (await (await page.request.get('/api/requirements/' + created.id)).json()) as Requirement;
  for (const work of created.workItems) {
    const response = await page.request.patch('/api/work-items/' + work.id, { data: { expectedVersion: work.version, ownerId: owner.id } });
    expect(response.ok()).toBe(true);
  }
  const assigned = await detail();
  const first = await post(page.request, `/api/work-items/${assigned.workItems[0].id}/start`, { expectedVersion: assigned.workItems[0].version });
  await post(page.request, `/api/work-items/${first.id}/complete`, { expectedVersion: first.version, content: '接口清单已确认。' });
  const second = await post(page.request, `/api/work-items/${assigned.workItems[1].id}/start`, { expectedVersion: assigned.workItems[1].version });
  await post(page.request, `/api/requirements/${created.id}/progress`, { expectedVersion: second.version, workItemId: second.id, workItemPercent: 40, content: '联调完成40%。' });
  await post(page.request, `/api/work-items/${assigned.workItems[3].id}/cancel`, { expectedVersion: assigned.workItems[3].version, reason: '该项退出本次交付' });
  const before = await detail();
  await page.goto(`/?projectId=${project.id}&workspaceView=progress`);
  await page.getByRole('button', { name: '展开全部', exact: true }).click();
  await page.getByRole('button', { name: created.title, exact: true }).click();
  await page.getByRole('button', { name: '调整计划', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '调整需求计划', exact: true });
  await dialog.getByRole('radio', { name: /按截止日期倒排/ }).click();
  const date = dialog.getByLabel('计划完成', { exact: true });
  await date.fill('2026-09-30');
  const preview = dialog.getByRole('region', { name: '计划调整预览', exact: true });
  await expect(preview).toContainText('2026-09-23 ～ 2026-09-30');
  await expect(preview).toContainText('已完成工作的计划也会调整，实际日期和完成度保持不变。');
  await expect(preview).toContainText('1 项已取消工作保持原计划');
  const expected = [['确认接口清单', '2026-09-23', '2026-09-23'], ['实现并联调接口', '2026-09-24', '2026-09-28'], ['核对交付结果', '2026-09-29', '2026-09-30']];
  for (const [title, start, end] of expected) {
    const row = preview.getByRole('row').filter({ hasText: title });
    await expect(row.getByRole('cell').last()).toHaveText(start + ' ～ ' + end);
  }
  await date.fill('2026-09-27');
  await expect(dialog.getByRole('alert')).toContainText('计划完成需为工作日');
  await expect(preview.getByRole('table')).toHaveCount(0);
  await date.fill('2026-09-30');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(preview).toContainText('2026-09-23 ～ 2026-09-30');
  expect(await preview.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await dialog.getByRole('textbox', { name: '补充说明（可选）', exact: true }).fill('客户调整交付日期。');
  await dialog.getByRole('button', { name: '保存排期', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const after = await detail();
  expect(after).toMatchObject({ plannedStart: '2026-09-23', plannedEnd: '2026-09-30', progress: before.progress });
  for (const [title, start, end] of expected) expect(after.workItems.find(work => work.title === title)).toMatchObject({ plannedStart: start, plannedEnd: end });
  expect(after.workItems[3]).toMatchObject({ version: before.workItems[3].version, plannedStart: before.workItems[3].plannedStart, plannedEnd: before.workItems[3].plannedEnd, cancelledAt: before.workItems[3].cancelledAt });
  for (const previous of before.workItems) expect(after.workItems.find(work => work.id === previous.id)).toMatchObject({ status: previous.status, progress: previous.progress, actualStart: previous.actualStart, actualEnd: previous.actualEnd, ownerId: previous.ownerId, collaborators: previous.collaborators });
  const beforeUpdates = before.progressUpdates || [], afterUpdates = after.progressUpdates || [];
  expect(afterUpdates).toEqual(expect.arrayContaining(beforeUpdates));
  expect(afterUpdates).toHaveLength(beforeUpdates.length + 1);
  expect(afterUpdates.find(entry => !beforeUpdates.some(previous => previous.id === entry.id))).toMatchObject({ eventType: 'note', workItemId: null, content: expect.stringContaining('客户调整交付日期。') });
  await page.reload();
  await page.getByRole('tab', { name: '工作项 4', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: '工作项 4', exact: true })).toContainText('2026-09-30');
  await page.getByRole('tab', { name: '记录', exact: true }).click();
  await expect(page.getByRole('region', { name: '进展记录', exact: true })).toContainText('客户调整交付日期。');
  await expect(page.getByRole('region', { name: '进展记录', exact: true }).getByRole('article').filter({ hasText: '客户调整交付日期。' })).toContainText('说明');
});
