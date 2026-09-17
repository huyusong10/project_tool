import { test, expect, type Page } from '@playwright/test';
import type { Requirement } from '../../src/client/types';

async function fixture(page: Page) {
  expect((await page.request.post('/api/login', { data: { username: 'admin', password: '41_xc7q0qOjo4Inw!' } })).ok()).toBe(true);
  const account = await (await page.request.get('/api/session')).json();
  const project = await (await page.request.post('/api/projects', { data: { name: '交接界面' + Date.now() } })).json();
  const person = async (name: string) => await (await page.request.post('/api/people', { data: { projectId: project.id, name: name + Date.now() } })).json() as { id: string; name: string };
  const owner = await person('需求负责人'), previous = await person('原执行人'), next = await person('接手人');
  const template = await (await page.request.post('/api/templates', { data: { projectId: project.id, name: '交接流程', items: [{ title: '交接工作', startOffsetDays: 0, durationDays: 1, sortOrder: 0 }] } })).json();
  const response = await page.request.post('/api/requirements', { data: { projectId: project.id, ownerId: owner.id, templateId: template.id, title: '需要交接的需求' } });
  expect(response.ok()).toBe(true);
  const r = await response.json() as Requirement;
  const assigned = await page.request.patch('/api/work-items/' + r.workItems[0].id, { data: { expectedVersion: r.workItems[0].version, ownerId: previous.id } });
  expect(assigned.ok()).toBe(true);
  await page.addInitScript(({ projectId, accountId }) => localStorage.setItem('project-manage:selected-project:' + accountId, projectId), { projectId: project.id, accountId: account.accountId });
  const detail = async () => await (await page.request.get('/api/requirements/' + r.id)).json() as Requirement;
  const disable = async (personId: string) => {
    const accounts = await (await page.request.get('/api/accounts')).json() as Array<{ id: string; personId: string; updatedAt: string }>;
    const found = accounts.find(a => a.personId === personId)!;
    expect((await page.request.patch('/api/accounts/' + found.id, { data: { status: 'disabled', expectedUpdatedAt: found.updatedAt } })).ok()).toBe(true);
  };
  return { r, project, owner, previous, next, disable, detail };
}

test('行动提示失效执行人，从原工作项更换负责人后可开始执行', async ({ page }) => {
  const { r, previous, next, disable, detail } = await fixture(page);
  await disable(previous.id);
  await page.goto('/actions?reason=owner_unavailable');
  const action = page.locator('.action-item').filter({ hasText: '交接工作' });
  await expect(action).toContainText('负责人不可用');
  await expect(action).toContainText('项目经理');
  await action.click();
  await expect(page).toHaveURL(new RegExp('/requirements/' + r.id));
  await page.getByRole('tab', { name: '资料', exact: true }).click();
  const row = page.locator('.work-arrangement-row[data-work-id="'+r.workItems[0].id+'"]');
  await row.getByRole('button', { name: /^主负责人：/ }).click();
  await expect(page.getByRole('option', { name: new RegExp(previous.name) })).toBeDisabled();
  await page.getByRole('option', { name: new RegExp(next.name) }).click();
  await expect(row.getByRole('button', { name: /^主负责人：/ })).toContainText(next.name);
  await page.getByRole('tab', { name: '概况', exact: true }).click();
  const work = page.getByRole('dialog');
  await work.getByRole('button', { name: '开始', exact: true }).click();
  await expect(work.getByRole('button', { name: '完成', exact: true })).toBeVisible();
  expect((await detail()).workItems[0]).toMatchObject({ ownerId: next.id, status: 'in_progress' });
  await page.goto('/actions?reason=owner_unavailable');
  await expect(page.locator('.action-item')).toHaveCount(0);
});

test('执行中调整协作者自动记录变更；两人失效后可逐步移除并交接', async ({ page }) => {
  const { r, owner, previous, next, detail, disable } = await fixture(page);
  const w = (await detail()).workItems[0];
  expect((await page.request.post(`/api/work-items/${w.id}/start`, { data: { expectedVersion: w.version } })).ok()).toBe(true);
  await page.goto('/requirements/' + r.id);
  await page.getByRole('tab', { name: /^工作项 / }).click();
  const row = page.locator('.work-arrangement-row[data-work-id="'+w.id+'"]');
  await row.getByRole('button', { name: /^协作人员：/ }).click();
  const picker = page.locator('.inline-multi-popover');
  await picker.getByRole('checkbox', { name: new RegExp(next.name) }).check();
  await picker.getByRole('button', { name: '完成', exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(row).toContainText(next.name);
  await disable(previous.id); await disable(next.id);
  await page.reload();
  await page.getByRole('tab', { name: /^工作项 / }).click();
  await row.getByRole('button', { name: /^协作人员：/ }).click();
  await expect(picker).toContainText('已不可用');
  const unavailable = picker.getByRole('checkbox', { name: new RegExp(next.name) });
  await expect(unavailable).toBeChecked();
  await unavailable.click();
  await expect(unavailable).toHaveCount(0);
  await picker.getByRole('button', { name: '完成', exact: true }).click();
  await expect(picker).toHaveCount(0);
  await row.getByRole('button', { name: /^主负责人：/ }).click();
  await page.getByRole('option', { name: new RegExp(owner.name) }).click();
  const ownerPicker = page.locator('.inline-select-popover');
  await expect(ownerPicker).toHaveCount(0);
  const current = await detail();
  expect(current.workItems[0]).toMatchObject({ ownerId: owner.id, status: 'in_progress', collaborators: [] });
  const changes=(current.progressUpdates||[]).filter(event=>event.eventType==='correction');
  expect(changes).toHaveLength(3);for(const event of changes){expect(event.workItemId).toBe(w.id);expect(event.content.trim()).not.toBe('');}
});

test('执行中协作者交接面板在标准视口和窄屏内完整显示',{tag:'@responsive'},async({page},info)=>{
  const {r,next,detail}=await fixture(page),w=(await detail()).workItems[0];
  expect((await page.request.post(`/api/work-items/${w.id}/start`,{data:{expectedVersion:w.version}})).ok()).toBe(true);
  await page.goto('/requirements/'+r.id);await page.getByRole('tab',{name:/^工作项 /}).click();
  const row=page.locator('.work-arrangement-row[data-work-id="'+w.id+'"]');
  for(const viewport of [page.viewportSize()!,{width:390,height:844}]){
    await page.setViewportSize(viewport);await row.getByRole('button',{name:/^协作人员：/}).click();
    const picker=page.locator('.inline-multi-popover');await picker.getByRole('checkbox',{name:new RegExp(next.name)}).check();
    const bounds=(await picker.boundingBox())!;expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(viewport.width);expect(bounds.y+bounds.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({path:info.outputPath('handoff-collaborators-'+viewport.width+'.png'),animations:'disabled'});await page.keyboard.press('Escape');
  }
});

test('新建和编辑需求不会重新选择停用账号，历史负责人保持明确显示', async ({ page }) => {
  const { project, previous, disable } = await fixture(page);
  const response = await page.request.post('/api/requirements', { data: { projectId: project.id, ownerId: previous.id, title: '保留原责任人的需求' } });
  expect(response.ok()).toBe(true);
  const r = await response.json() as Requirement;
  await disable(previous.id);
  await page.goto('/requirements');
  await page.getByRole('button', { name: '新建对象', exact: true }).click();
  await page.getByRole('button', { name: '新建需求', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('select[name="ownerId"] option[value="' + previous.id + '"]')).toHaveCount(0);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.goto('/requirements/' + r.id);
  await page.getByRole('button', { name: '编辑信息', exact: true }).click();
  await expect(dialog.locator('option[value="' + previous.id + '"]')).toHaveJSProperty('disabled', true);
  await expect(dialog.locator('option[value="' + previous.id + '"]')).toContainText(previous.name);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.goto('/?'+new URLSearchParams({projectId:project.id,workspaceView:'graph',scopeType:'feature',scopeId:r.featureId!}));
  await expect(page.locator('[data-layout-ready="true"]')).toBeVisible({ timeout: 20000 });
  await page.getByLabel('编辑画布', { exact: true }).click();
  await page.locator('.react-flow__node[data-id="' + r.id + '"] .graph-title').click();
  await expect(page.getByRole('combobox',{name:'元素负责人',exact:true}).locator('..').locator('select')).toHaveValue(previous.id);
  await expect(page.getByRole('combobox',{name:'元素负责人',exact:true})).toContainText('已不可用');
  await page.getByRole('combobox',{name:'元素负责人',exact:true}).click();
  await expect(page.getByRole('option',{name:/原负责人.*已不可用/})).toBeDisabled();
});
