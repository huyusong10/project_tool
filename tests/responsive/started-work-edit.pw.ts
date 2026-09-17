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
    plannedStart: '2026-09-01',
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
  await page.goto('/?'+new URLSearchParams({projectId:project.id,workspaceView:'list',scopeType:'requirement',scopeId:created.id,detailId:created.workItems[1].id,detailTab:'basic'}));
  const dialog = page.locator('.modal-card-workspace[role=dialog]');
  const secondRow = dialog.locator('.work-arrangement-row');
  await expect(secondRow).toBeVisible();
  return { created, owner, colleague, detail, dialog, secondRow };
}

test('同需求已有开工时，未开始工作项可编辑名称、协作和排期并记录变更', async ({ page }) => {
  const { detail, colleague, secondRow } = await fixture(page);
  const before = await detail();
  await secondRow.getByRole('button', { name: /^工作项名称：/ }).click();
  let popover = page.locator('.inline-text-popover');
  await popover.getByRole('textbox', { name: '工作项名称', exact: true }).fill('联调交付收尾');
  await expect(popover.getByRole('textbox', { name: '调整原因', exact: true })).toHaveCount(0);
  await popover.getByRole('textbox', { name: '工作项名称', exact: true }).press('Enter');
  await expect(popover).toHaveCount(0);

  await secondRow.getByRole('button', { name: /^协作人员：/ }).click();
  popover = page.locator('.inline-multi-popover');
  await popover.getByRole('checkbox', { name: new RegExp(colleague.name) }).check();
  await popover.getByRole('button', { name: '完成', exact: true }).click();
  await expect(popover).toHaveCount(0);

  for (const [field, date] of [['计划开始', '2026-09-02'], ['计划完成', '2026-09-07']]) {
    await secondRow.getByRole('button', { name: new RegExp(`^${field}：`) }).click();
    popover = page.locator('.inline-date-popover');
    await popover.getByRole('gridcell', { name: date, exact: true }).click();
    await popover.getByRole('button', { name: '保存', exact: true }).click();
    await expect(popover).toHaveCount(0);
  }
  const after = await detail();
  expect(after.workItems[1]).toMatchObject({ title: '联调交付收尾', status: 'not_started', progress: 0, actualStart: null, actualEnd: null, plannedStart: '2026-09-02', plannedEnd: '2026-09-07' });
  expect(after.workItems[1].assigneeIds).toContain(colleague.id);
  expect(after.workItems[0]).toMatchObject({ status: 'in_progress', actualStart: before.workItems[0].actualStart, progress: before.workItems[0].progress });
  const events=(after.progressUpdates||[]).filter(entry=>entry.eventType==='correction'&&entry.workItemId===after.workItems[1].id);
  expect(events).toHaveLength(4);expect(events.map(e=>e.content).join(' ')).toContain('联调交付收尾');
});

test('开工后改名发生版本冲突，重读保留名称后只保存一次', async ({ page }) => {
  const { detail, secondRow } = await fixture(page);
  await secondRow.getByRole('button', { name: /^工作项名称：/ }).click();
  const popover = page.locator('.inline-text-popover');
  const name = popover.getByRole('textbox', { name: '工作项名称', exact: true });
  await name.fill('保留的交付名称');
  const work = (await detail()).workItems[1];
  const response = await page.request.patch(`/api/work-items/${work.id}`, { data: { title: '后台修改名称', reason: '其他人补充名称', expectedVersion: work.version } });
  expect(response.ok(), await response.text()).toBe(true);
  await name.press('Enter');
  await expect(popover.getByRole('alert')).toBeVisible();
  expect((await detail()).workItems[1].title).toBe('后台修改名称');
  await popover.getByRole('button', { name: '重新读取工作项', exact: true }).click();
  await expect(name).toHaveValue('保留的交付名称');
  await name.press('Enter');
  await expect(popover).toHaveCount(0);
  const after = await detail();
  expect(after.workItems[1].title).toBe('保留的交付名称');
  expect((after.progressUpdates || []).filter(entry => entry.content.includes('保留的交付名称'))).toHaveLength(1);
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

test('排期校验失败后保留日期，可以修正重试或取消而不改执行事实', async ({ page }) => {
  const { detail, secondRow } = await fixture(page);
  const before = (await detail()).workItems[1];
  await secondRow.getByRole('button', { name: /^计划完成：/ }).click();
  const popover = page.locator('.inline-date-popover');
  await popover.getByRole('gridcell', { name: '2026-09-01', exact: true }).click();
  await popover.getByRole('button', { name: '保存', exact: true }).click();
  await expect(popover.getByRole('alert')).toContainText('不能早于');
  await expect(popover.getByRole('button', { name: '重新读取工作项', exact: true })).toHaveCount(0);
  expect((await detail()).workItems[1].plannedEnd).toBe(before.plannedEnd);
  await popover.getByRole('gridcell', { name: '2026-09-07', exact: true }).click();
  await expect(popover.getByRole('alert')).toHaveCount(0);
  await popover.getByRole('button', { name: '保存', exact: true }).click();
  await expect(popover).toHaveCount(0);
  await secondRow.getByRole('button', { name: /^工作项名称：/ }).click();
  await page.getByRole('textbox', { name: '工作项名称', exact: true }).fill('取消的名称');
  await page.keyboard.press('Escape');
  const after = await detail();
  expect(after.workItems[1]).toMatchObject({ title: before.title, plannedEnd: '2026-09-07', status: before.status, actualStart: before.actualStart });
  expect((after.progressUpdates || []).some(entry => entry.content.includes('取消的名称'))).toBe(false);
});

test('编辑期间其他工作项开工，当前名称仍按原版本保存并记录变更', async ({ page }) => {
  const { detail, secondRow } = await fixture(page, false);
  await secondRow.getByRole('button', { name: /^工作项名称：/ }).click();
  const name = page.getByRole('textbox', { name: '工作项名称', exact: true });
  await name.fill('开工期间保留的名称');
  const first = (await detail()).workItems[0];
  const started = await page.request.post(`/api/work-items/${first.id}/start`, { data: { expectedVersion: first.version } });
  expect(started.ok(), await started.text()).toBe(true);
  await name.press('Enter');
  await expect(name).toHaveCount(0);
  const after=await detail();expect(after.workItems[1]).toMatchObject({title:'开工期间保留的名称',status:'not_started',actualStart:null});
  expect((after.progressUpdates||[]).filter(e=>e.content.includes('开工期间保留的名称'))).toHaveLength(1);
});

test('改名提交时收起浮层，失败恢复输入并只重试一次', async ({ page }) => {
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
    await popover.getByRole('textbox', { name: '工作项名称', exact: true }).press('Enter');
    await expect.poll(() => writes).toBe(1);
    await expect(popover).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(trigger).toBeDisabled();
    release();
    await expect(trigger).toBeEnabled();
    await trigger.click();
    await expect(popover.getByRole('textbox', { name: '工作项名称', exact: true })).toHaveValue('请求期间保留的名称');
    expect((await detail()).workItems[1].title).toBe(work.title);
    await popover.getByRole('textbox', { name: '工作项名称', exact: true }).press('Enter');
    await expect(popover).toHaveCount(0);
    expect((await detail()).workItems[1].title).toBe('请求期间保留的名称');
    expect(writes).toBe(2);
  } finally { release(); }
});

test('工作项名称编辑在窄屏和标准视口内完整显示',{tag:'@responsive'},async({page},info)=>{
 const {secondRow}=await fixture(page);
 for(const viewport of [page.viewportSize()!,{width:390,height:844}]){
  await page.setViewportSize(viewport);await secondRow.getByRole('button',{name:/^工作项名称：/}).click();
  const popover=page.locator('.inline-text-popover');const box=(await popover.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(viewport.width);
  await page.screenshot({path:info.outputPath('started-name-'+viewport.width+'.png')});await page.keyboard.press('Escape');
 }
});

test('已保存但响应异常的工作项修改跨导航保持锁定，核对后不重复提交',async({page})=>{
 const {created,secondRow,dialog,detail}=await fixture(page,false),work=(await detail()).workItems[1];
 let writes=0,failRead=false;
 await page.route('**/api/requirements/'+created.id,route=>failRead?route.fulfill({status:503,json:{error:'核对暂不可用'}}):route.continue());
 await page.route('**/api/work-items/'+work.id,async route=>{
  if(route.request().method()!=='PATCH')return route.continue();
  writes++;const response=await route.fetch();expect(response.ok()).toBe(true);failRead=true;
  await route.fulfill({status:200,contentType:'text/html',body:'saved'});
 });
 await secondRow.getByRole('button',{name:/^工作项名称：/}).click();
 const input=page.getByRole('textbox',{name:'工作项名称',exact:true});await input.fill('结果待核对的名称');await input.press('Enter');
 await expect(dialog.getByRole('alert').filter({hasText:'刚才的提交结果待核对'})).toBeVisible();
 await page.keyboard.press('Escape');await dialog.locator(':scope > header').getByRole('button',{name:'关闭',exact:true}).click();
 failRead=false;
 const url='/requirements/'+created.id+'?workItemId='+work.id;
 await page.goto(url);await dialog.getByRole('tab',{name:'资料',exact:true}).click();
 await expect(dialog.getByRole('button',{name:/^工作项名称：结果待核对的名称/})).toBeDisabled();
 await expect(dialog.getByRole('button',{name:'编辑',exact:true})).toHaveCount(0);expect(writes).toBe(1);
 await dialog.getByRole('button',{name:'核对需求修改',exact:true}).click();
 await expect(dialog.getByRole('alert').filter({hasText:'工作项设置结果待核对'})).toBeVisible();
 await dialog.getByRole('button',{name:'重新读取需求',exact:true}).click();
 await expect(dialog.getByRole('alert').filter({hasText:'工作项设置结果待核对'})).toHaveCount(0);
 await page.goto(url);await dialog.getByRole('tab',{name:'资料',exact:true}).click();
 await expect(dialog.getByRole('button',{name:/^工作项名称：结果待核对的名称/})).toBeEnabled();
 expect(writes).toBe(1);expect((await detail()).workItems[1].title).toBe('结果待核对的名称');
});
