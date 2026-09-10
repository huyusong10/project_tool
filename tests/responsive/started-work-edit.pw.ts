import { expect, test, type Page } from '@playwright/test';
import type { Requirement } from '../../src/client/types';

async function fixture(page: Page, started = true) {
  const post = async (url: string, data: Record<string, unknown>) => {
    const response = await page.request.post(url, { data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  await post('/api/login', { username: 'admin', password: '41_xc7q0qOjo4Inw!' });
  const session = await (await page.request.get('/api/session')).json();
  const project = await post('/api/projects', { name: `开工后调整-${Date.now()}` });
  const owner = await post('/api/people', { projectId: project.id, name: `执行人-${Date.now()}` });
  const colleague = await post('/api/people', { projectId: project.id, name: `协作人-${Date.now()}` });
  const template = await post('/api/templates', {
    projectId: project.id, name: '执行与收尾',
    items: [{ title: '接口开发', startOffsetDays: 0, durationDays: 2, sortOrder: 0 }, { title: '交付收尾', startOffsetDays: 2, durationDays: 2, sortOrder: 1 }],
  });
  const created = await post('/api/requirements', {
    projectId: project.id, title: '接口交付', ownerId: owner.id, templateId: template.id,
    executionMode: 'work_items', plannedStart: '2026-09-01',
  }) as Requirement;
  for (const work of created.workItems) {
    const response = await page.request.patch(`/api/work-items/${work.id}`, { data: { ownerId: owner.id, expectedVersion: work.version } });
    expect(response.ok(), await response.text()).toBe(true);
  }
  const detail = async () => (await (await page.request.get(`/api/requirements/${created.id}`)).json()) as Requirement;
  if (started) {
    const first = (await detail()).workItems[0];
    await post(`/api/work-items/${first.id}/start`, { expectedVersion: first.version });
  }
  await page.addInitScript(({ projectId, accountId }) => localStorage.setItem(`project-manage:selected-project:${accountId}`, projectId), { projectId: project.id, accountId: session.accountId });
  await page.goto(`/requirements/${created.id}`);
  await page.getByRole('button', { name: '工作项设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '工作项设置', exact: true });
  const secondRow = dialog.locator('tbody tr').nth(1);
  return { created, owner, colleague, detail, dialog, secondRow };
}

test('同需求已有开工时，未开始工作项可在原位说明改名、协作和排期原因', async ({ page }, testInfo) => {
  const { detail, colleague, secondRow } = await fixture(page);
  const before = await detail();
  await secondRow.getByRole('button', { name: /^工作项名称：/ }).click();
  let popover = page.locator('.inline-text-popover');
  await popover.getByRole('textbox', { name: '工作项名称', exact: true }).fill('联调交付收尾');
  await expect(popover.getByRole('textbox', { name: '调整原因', exact: true })).toBeVisible();
  await popover.getByRole('button', { name: '保存', exact: true }).click();
  await expect(popover.getByRole('alert')).toContainText('调整原因不能为空');
  await expect(popover.getByRole('button', { name: '重新读取工作项', exact: true })).toHaveCount(0);
  expect((await detail()).workItems[1].title).toBe('交付收尾');
  await popover.getByRole('textbox', { name: '调整原因', exact: true }).fill('明确联调交付范围');
  await expect(popover.getByRole('alert')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  const rect = await popover.boundingBox();
  expect(rect).not.toBeNull();
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('started-name-390.png') });
  await page.setViewportSize({ width: 1366, height: 768 });
  await popover.getByRole('button', { name: '保存', exact: true }).click();
  await expect(popover).toHaveCount(0);

  await secondRow.getByRole('button', { name: /^协作人员：/ }).click();
  popover = page.locator('.inline-multi-popover');
  await popover.getByRole('checkbox', { name: new RegExp(colleague.name) }).check();
  await popover.getByRole('textbox', { name: '调整原因', exact: true }).fill('补充联调协作人员');
  await popover.getByRole('button', { name: '完成', exact: true }).click();
  await expect(popover).toHaveCount(0);

  for (const [field, date, reason] of [['计划开始', '2026-09-02', '提前准备联调'], ['计划完成', '2026-09-07', '增加联调验证时间']]) {
    await secondRow.getByRole('button', { name: new RegExp(`^${field}：`) }).click();
    popover = page.locator('.inline-date-popover');
    await popover.getByRole('gridcell', { name: date, exact: true }).click();
    await popover.getByRole('textbox', { name: '调整原因', exact: true }).fill(reason);
    await popover.getByRole('button', { name: '保存', exact: true }).click();
    await expect(popover).toHaveCount(0);
  }
  const after = await detail();
  expect(after.workItems[1]).toMatchObject({ title: '联调交付收尾', status: 'not_started', progress: 0, actualStart: null, actualEnd: null, plannedStart: '2026-09-02', plannedEnd: '2026-09-07' });
  expect(after.workItems[1].assigneeIds).toContain(colleague.id);
  expect(after.workItems[0]).toMatchObject({ status: 'in_progress', actualStart: before.workItems[0].actualStart, progress: before.workItems[0].progress });
  for (const reason of ['明确联调交付范围', '补充联调协作人员', '提前准备联调', '增加联调验证时间']) {
    expect((after.progressUpdates || []).filter(entry => entry.content === reason && entry.workItemId === after.workItems[1].id)).toHaveLength(1);
  }
});

test('开工后改名发生版本冲突，重读保留名称和原因后只保存一次', async ({ page }) => {
  const { detail, secondRow } = await fixture(page);
  await secondRow.getByRole('button', { name: /^工作项名称：/ }).click();
  const popover = page.locator('.inline-text-popover');
  const name = popover.getByRole('textbox', { name: '工作项名称', exact: true });
  await name.fill('保留的交付名称');
  await popover.getByRole('textbox', { name: '调整原因', exact: true }).fill('保留的名称调整原因');
  const work = (await detail()).workItems[1];
  const response = await page.request.patch(`/api/work-items/${work.id}`, { data: { title: '后台修改名称', reason: '其他人补充名称', expectedVersion: work.version } });
  expect(response.ok(), await response.text()).toBe(true);
  await popover.getByRole('button', { name: '保存', exact: true }).click();
  await expect(popover.getByRole('alert')).toBeVisible();
  expect((await detail()).workItems[1].title).toBe('后台修改名称');
  await popover.getByRole('button', { name: '重新读取工作项', exact: true }).click();
  await expect(name).toHaveValue('保留的交付名称');
  await expect(popover.getByRole('textbox', { name: '调整原因', exact: true })).toHaveValue('保留的名称调整原因');
  await popover.getByRole('button', { name: '保存', exact: true }).click();
  await expect(popover).toHaveCount(0);
  const after = await detail();
  expect(after.workItems[1].title).toBe('保留的交付名称');
  expect((after.progressUpdates || []).filter(entry => entry.content === '保留的名称调整原因')).toHaveLength(1);
});

test('未开工改名保持直接保存，中文组合键不提交或关闭编辑器', async ({ page }) => {
  const { detail, secondRow, dialog } = await fixture(page, false);
  await secondRow.getByRole('button', { name: /^工作项名称：/ }).click();
  const name = page.getByRole('textbox', { name: '工作项名称', exact: true });
  await name.fill('中文名称输入中');
  await name.dispatchEvent('compositionstart');
  await name.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 });
  await expect(name).toBeVisible();
  expect((await detail()).workItems[1].title).toBe('交付收尾');
  await name.dispatchEvent('keydown', { key: 'Escape', code: 'Escape', isComposing: true, keyCode: 229 });
  await expect(name).toBeVisible();
  await expect(dialog).toBeVisible();
  await name.dispatchEvent('compositionend');
  await expect(page.getByRole('textbox', { name: '调整原因', exact: true })).toHaveCount(0);
  await name.press('Enter');
  await expect(name).toHaveCount(0);
  expect((await detail()).workItems[1].title).toBe('中文名称输入中');
});

test('排期校验失败后保留原因，可以修正日期重试或取消而不改执行事实', async ({ page }) => {
  const { detail, secondRow } = await fixture(page);
  const before = (await detail()).workItems[1];
  await secondRow.getByRole('button', { name: /^计划完成：/ }).click();
  const popover = page.locator('.inline-date-popover');
  await popover.getByRole('gridcell', { name: '2026-09-01', exact: true }).click();
  await popover.getByRole('textbox', { name: '调整原因', exact: true }).fill('更换联调窗口');
  await popover.getByRole('button', { name: '保存', exact: true }).click();
  await expect(popover.getByRole('alert')).toContainText('不能早于');
  await expect(popover.getByRole('button', { name: '重新读取工作项', exact: true })).toHaveCount(0);
  expect((await detail()).workItems[1].plannedEnd).toBe(before.plannedEnd);
  await popover.getByRole('gridcell', { name: '2026-09-07', exact: true }).click();
  await expect(popover.getByRole('alert')).toHaveCount(0);
  await expect(popover.getByRole('textbox', { name: '调整原因', exact: true })).toHaveValue('更换联调窗口');
  await popover.getByRole('button', { name: '保存', exact: true }).click();
  await expect(popover).toHaveCount(0);
  await secondRow.getByRole('button', { name: /^工作项名称：/ }).click();
  await page.getByRole('textbox', { name: '工作项名称', exact: true }).fill('取消的名称');
  await page.getByRole('textbox', { name: '调整原因', exact: true }).fill('取消的原因');
  await page.keyboard.press('Escape');
  const after = await detail();
  expect(after.workItems[1]).toMatchObject({ title: before.title, plannedEnd: '2026-09-07', status: before.status, actualStart: before.actualStart });
  expect((after.progressUpdates || []).some(entry => entry.content === '取消的原因')).toBe(false);
});

test('编辑期间其他工作项开工，保留名称并补充原因后继续保存', async ({ page }) => {
  const { detail, secondRow } = await fixture(page, false);
  await secondRow.getByRole('button', { name: /^工作项名称：/ }).click();
  const name = page.getByRole('textbox', { name: '工作项名称', exact: true });
  await name.fill('开工期间保留的名称');
  const first = (await detail()).workItems[0];
  const started = await page.request.post(`/api/work-items/${first.id}/start`, { data: { expectedVersion: first.version } });
  expect(started.ok(), await started.text()).toBe(true);
  await name.press('Enter');
  const popover = page.locator('.inline-text-popover');
  await expect(name).toHaveValue('开工期间保留的名称');
  await expect(popover.getByRole('textbox', { name: '调整原因', exact: true })).toBeVisible();
  expect((await detail()).workItems[1].title).toBe('交付收尾');
  await popover.getByRole('textbox', { name: '调整原因', exact: true }).fill('根据已开始的工作补充交付内容');
  await popover.getByRole('button', { name: '保存', exact: true }).click();
  await expect(popover).toHaveCount(0);
  expect((await detail()).workItems[1]).toMatchObject({ title: '开工期间保留的名称', status: 'not_started', actualStart: null });
});

test('带原因改名提交中关闭浮层，失败重开保留输入并只重试一次', async ({ page }) => {
  const { detail, secondRow, dialog } = await fixture(page);
  const work = (await detail()).workItems[1];
  let release!: () => void;
  let writes = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/work-items/${work.id}`, async route => {
    if (route.request().method() !== 'PATCH') return route.continue();
    writes++;
    if (writes !== 1) return route.continue();
    await held;
    return route.fulfill({ status: 500, json: { error: '本次保存失败，未写入' } });
  });
  try {
    const trigger = secondRow.getByRole('button', { name: /^工作项名称：/ });
    await trigger.click();
    const popover = page.locator('.inline-text-popover');
    await popover.getByRole('textbox', { name: '工作项名称', exact: true }).fill('请求期间保留的名称');
    await popover.getByRole('textbox', { name: '调整原因', exact: true }).fill('请求期间保留的原因');
    await popover.getByRole('button', { name: '保存', exact: true }).click();
    await expect.poll(() => writes).toBe(1);
    await expect(popover.getByRole('textbox', { name: '工作项名称', exact: true })).toHaveJSProperty('readOnly', true);
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(trigger).toBeDisabled();
    release();
    await expect(trigger).toBeEnabled();
    await trigger.click();
    await expect(popover.getByRole('textbox', { name: '工作项名称', exact: true })).toHaveValue('请求期间保留的名称');
    await expect(popover.getByRole('textbox', { name: '调整原因', exact: true })).toHaveValue('请求期间保留的原因');
    expect((await detail()).workItems[1].title).toBe(work.title);
    await popover.getByRole('button', { name: '保存', exact: true }).click();
    await expect(popover).toHaveCount(0);
    expect((await detail()).workItems[1].title).toBe('请求期间保留的名称');
    expect(writes).toBe(2);
  } finally { release(); }
});
