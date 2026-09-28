import {expect,test,type Locator} from '@playwright/test';
import {phaseFixture} from './phase-fixture';
import {chooseOption} from './select-helper';

async function slots(row:Locator){
  return row.locator('.work-execution-progress-slot,.work-item-action-row,.work-action-slot').evaluateAll(nodes=>nodes.map(node=>{const box=node.getBoundingClientRect();return {x:box.x,y:box.y,width:box.width,height:box.height};}));
}

test('新增在清单末尾，重复点击聚焦同一行，关闭刷新保留，保存只写入一次',async({page},info)=>{
  const f=await phaseFixture(page),url='/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'progress',scopeType:'project',detailId:f.testing.id,detailTab:'work'});
  await page.goto(url);
  const root=page.locator('.modal-card-workspace[role=dialog]'),draft=root.getByRole('form',{name:'新增工作项'}),name=draft.getByRole('textbox',{name:'新工作项名称',exact:true});
  let writes=0;await page.route('**/api/requirements/'+f.testing.id+'/work-items',route=>{writes++;return route.continue();});
  await root.getByRole('button',{name:'添加工作项',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(1);await expect(name).toBeFocused();
  await expect(root.locator('.work-arrangement-list > :last-child')).toHaveClass(/work-create-row/);
  await name.fill('行内验证');await chooseOption(draft.getByLabel('工作阶段',{exact:true}),'testing');
  const assigned = await (await page.request.post('/api/people',{data:{projectId:f.projectId,name:'草稿执行人 '+Date.now()}})).json();
  await page.reload();
  await draft.getByRole('button',{name:/新工作项主负责人：/}).click();
  await page.getByRole('option',{name:assigned.name,exact:true}).click();
  expect(await draft.locator('[aria-label="已保存"]').count()).toBe(0);
  await draft.getByRole('button',{name:/新工作项协作人员：/}).click();
  const collaborators=page.locator('.inline-multi-popover');
  await collaborators.getByRole('checkbox').check();
  await collaborators.getByRole('button',{name:'完成',exact:true}).click();
  expect(await draft.locator('[aria-label="已保存"]').count()).toBe(0);
  await expect(draft).toContainText('未保存');expect(writes).toBe(0);
  await root.getByRole('button',{name:'添加工作项',exact:true}).click();await expect(draft).toHaveCount(1);await expect(name).toBeFocused();await expect(name).toHaveValue('行内验证');
  await root.locator(':scope > header').getByRole('button',{name:'关闭',exact:true}).click();await page.goto(url);await expect(name).toHaveValue('行内验证');await page.reload();await expect(name).toHaveValue('行内验证');expect(writes).toBe(0);
  await draft.getByLabel('计划开始',{exact:true}).fill('2026-09-17');await draft.getByLabel('计划完成',{exact:true}).fill('2026-09-18');
  await draft.getByLabel('变更说明（可选）',{exact:true}).fill('补充本次范围');
  await page.screenshot({path:info.outputPath('inline-create.png'),animations:'disabled'});
  await name.focus();
  await draft.getByRole('button',{name:'保存工作项',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click();});
  await expect(draft).toHaveCount(0);await expect(root.locator('.work-arrangement-row')).toHaveCount(3);expect(writes).toBe(1);
  const latest=await(await page.request.get('/api/requirements/'+f.testing.id)).json();expect(latest.workItems.at(-1)).toMatchObject({title:'行内验证',workStage:'testing',plannedStart:'2026-09-17',plannedEnd:'2026-09-18'});
  expect(latest.workItems.at(-1).ownerId).toBe(assigned.id);
  expect(latest.workItems.at(-1).collaborators).toHaveLength(1);
  await root.getByRole('tab',{name:'记录',exact:true}).click();
  await expect(root.getByText('新增工作项：行内验证（2人协作）；补充本次范围',{exact:true})).toBeVisible();
  await page.reload();
  await expect(root.getByText('新增工作项：行内验证（2人协作）；补充本次范围',{exact:true})).toBeVisible();
  await root.getByRole('tab',{name:/^工作项 /}).click();
  await root.getByRole('button',{name:'添加工作项',exact:true}).click();await name.fill('放弃这一行');await draft.getByRole('button',{name:'取消',exact:true}).click();await expect(draft).toHaveCount(0);expect(writes).toBe(1);
});

test('工作项操作固定位置，完成与重开不挤动修正按钮，窄屏不溢出',{tag:'@responsive'}, async({page},info)=>{
  const f=await phaseFixture(page);
  await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'list',scopeType:'project',detailId:f.testing.id,detailTab:'work'}));
  const root=page.locator('.modal-card-workspace[role=dialog]'),row=root.locator('[data-work-id="'+f.testing.workItems[1].id+'"]');
  await expect(row).toBeVisible();const before=await slots(row);
  await row.getByRole('button',{name:'完成',exact:true}).click();await page.getByRole('dialog',{name:'完成工作项',exact:true}).getByRole('button',{name:'确认完成',exact:true}).click();await expect(row.getByRole('button',{name:'重开/返工',exact:true})).toBeVisible();expect(await slots(row)).toEqual(before);
  await row.getByRole('button',{name:'重开/返工',exact:true}).click();await expect(row.getByRole('button',{name:'完成',exact:true})).toBeVisible();expect(await slots(row)).toEqual(before);
  for(const width of [1280,700,390]){
    await page.setViewportSize({width,height:800});await row.scrollIntoViewIfNeeded();
    const bounds=(await row.boundingBox())!;
    const progress=(await row.locator('.work-progress-link').boundingBox())!,primary=(await row.getByRole('button',{name:'完成',exact:true}).boundingBox())!;
    expect(primary.x-progress.x-progress.width).toBeGreaterThanOrEqual(6);
    for(const button of await row.locator('.work-arrangement-execution button').all()){
      const box=(await button.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(bounds.x);expect(box.x+box.width).toBeLessThanOrEqual(bounds.x+bounds.width);
    }
    await page.screenshot({path:info.outputPath('work-actions-'+width+'.png'),animations:'disabled'});
  }
});

test('短操作保留详情背景和滚动，关闭恢复焦点，菜单先响应 Escape',async({page},info)=>{
  const f=await phaseFixture(page);
  await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'progress',scopeType:'project',detailId:f.testing.id,detailTab:'work'}));
  const root=page.locator('.modal-card-workspace[role=dialog]'),row=root.locator('[data-work-id="'+f.testing.workItems[1].id+'"]'),trigger=row.getByRole('button',{name:'完成',exact:true});
  await expect(row).toBeVisible();
  await trigger.click();const form=page.getByRole('dialog',{name:'完成工作项',exact:true});
  await expect(form).toBeVisible();
  const textarea=form.getByRole('textbox');
  await textarea.fill('保留说明');await page.screenshot({path:info.outputPath('compact-completion.png'),animations:'disabled'});
  await page.keyboard.press('Escape');await expect(form).toHaveCount(0);await expect(root).toBeVisible();await expect(trigger).toBeFocused();
  await trigger.click();await expect(textarea).toHaveValue('保留说明');await form.getByRole('button',{name:'取消',exact:true}).click();
  await row.getByRole('button',{name:'修正日期与说明',exact:true}).click();const dates=page.getByRole('dialog',{name:'修正日期与说明',exact:true});await expect(dates).toBeVisible();
  const select=dates.getByLabel('工作项纠错关联历史记录',{exact:true});await select.click();await expect(page.getByRole('listbox')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('listbox')).toHaveCount(0);await expect(dates).toBeVisible();await page.keyboard.press('Escape');await expect(dates).toHaveCount(0);await expect(root).toBeVisible();
  await trigger.click();await form.getByRole('button',{name:'确认完成',exact:true}).focus();await page.keyboard.press('Tab');await expect(form.getByRole('button',{name:'关闭',exact:true})).toBeFocused();await page.keyboard.press('Escape');
});

test('清单入口使用同一行内新增，再次打开与查看工作项均可用',async({page})=>{
  const f=await phaseFixture(page);
  await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'list',scopeType:'requirement',scopeId:f.direct.id}));
  const root=page.locator('.modal-card-workspace[role=dialog]'),draft=root.getByRole('form',{name:'新增工作项'});
  await page.getByRole('button',{name:'新建对象',exact:true}).click();await page.getByRole('menu',{name:'新建对象'}).getByRole('button',{name:'新建工作项',exact:true}).click();await expect(draft).toBeVisible();
  await draft.getByLabel('新工作项名称',{exact:true}).fill('从清单新增');await draft.getByLabel('变更说明（可选）').fill('补充范围');await draft.getByRole('button',{name:'保存工作项',exact:true}).click();await expect(draft).toHaveCount(0);await expect(root.locator('.work-arrangement-row')).toHaveCount(1);
  await root.getByRole('button',{name:'关闭',exact:true}).click();await page.getByRole('button',{name:'新建对象',exact:true}).click();await page.getByRole('menu',{name:'新建对象'}).getByRole('button',{name:'新建工作项',exact:true}).click();await expect(draft).toBeVisible();await expect(draft.getByLabel('新工作项名称',{exact:true})).toHaveValue('');
  await draft.getByRole('button',{name:'取消',exact:true}).click();await root.getByRole('button',{name:'从清单新增',exact:true}).click();await expect(root.getByRole('tablist',{name:'工作项详情内容'})).toBeVisible();
});
