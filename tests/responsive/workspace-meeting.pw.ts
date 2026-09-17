import {expect,test} from '@playwright/test';
import {phaseFixture} from './phase-fixture';
import {chooseOption} from './select-helper';

test('会议行内更新与快速完成，双槽独立，业务顺序和按钮位置不变',async({page},info)=>{
  const f=await phaseFixture(page),work=f.testing.workItems[1];
  await page.goto('/execution?attention=1&progressAttention=1');
  const grid=page.getByRole('treegrid');await expect(grid).toContainText(f.testing.title);
  await expect(page).not.toHaveURL(/Attention=|attention=/);await expect(page.getByText('需要关注',{exact:true})).toHaveCount(0);
  await expect(page.getByText('正式计划',{exact:true})).toHaveCount(0);await expect(page.locator('.workspace-progress-summary')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'编辑画布',exact:true})).toHaveCount(0);
  await chooseOption(page.getByLabel('展开层级',{exact:true}),'work');
  const row=grid.locator('[data-row-id="'+work.id+'"]'),order=await grid.locator('.kind-work').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-row-id')));
  expect(order).toEqual(f.testing.workItems.map(w=>w.id));
  for(const [kind,max] of [['feature',46],['phase',56],['requirement',56],['work',50]] as const){const heights=await grid.locator('.kind-'+kind).evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height));expect(heights.every(h=>h<=max+1),kind+': '+heights.join(', ')).toBe(true);}
  const tracks=await row.locator('.gantt-date-plan,.gantt-date-actual').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect(),parent=n.parentElement!.getBoundingClientRect();return {top:r.top,bottom:r.bottom,parentTop:parent.top,parentBottom:parent.bottom};}));
  expect(tracks).toHaveLength(2);expect(tracks[0].bottom).toBeLessThan(tracks[1].top);expect(tracks.every(r=>r.top>=r.parentTop&&r.bottom<=r.parentBottom)).toBe(true);
  const progress=row.getByRole('button',{name:'更新 '+work.title+' 进度',exact:true}),position=await progress.boundingBox();
  expect(position!.x).toBeGreaterThan(0);expect(position!.x+position!.width).toBeLessThan(info.project.use.viewport!.width);
  await progress.click();const dialog=page.getByRole('dialog',{name:'更新工作项进度',exact:true});
  await dialog.getByRole('spinbutton').fill('75');await dialog.getByRole('textbox',{name:/^说明/}).fill('例会逐项更新');await dialog.getByRole('button',{name:'记录进展',exact:true}).click();
  await expect(dialog).toHaveCount(0);await expect(progress).toHaveText('75%');await expect(page.locator('.modal-card-workspace[role=dialog]')).toHaveCount(0);
  expect(await progress.boundingBox()).toEqual(position);expect(await grid.locator('.kind-work').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-row-id')))).toEqual(order);
  await page.screenshot({path:info.outputPath('meeting-progress.png'),animations:'disabled'});
  await row.getByRole('button',{name:'完成',exact:true}).click();await page.getByRole('button',{name:'确认完成',exact:true}).click();await expect(row.locator('.workspace-row-progress > span').first()).toHaveText('已完成');
  await expect(page.locator('.modal-card-workspace[role=dialog]')).toHaveCount(0);await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await grid.locator('.kind-work').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-row-id')))).toEqual(order);
  const saved=await(await page.request.get('/api/requirements/'+f.testing.id)).json();expect(saved.workItems.find((w:{id:string})=>w.id===work.id).status).toBe('completed');
});

test('直接执行需求行内更新与完成，特性范围不重复祖先行',async({page})=>{
  const f=await phaseFixture(page);await page.goto('/execution?featureId='+f.feature.id);
  const grid=page.getByRole('treegrid');await expect(grid).toContainText(f.direct.title);await expect(grid.locator('.kind-feature')).toHaveCount(0);
  await expect(page.getByRole('navigation',{name:'项目层级'})).toContainText('资产管理');
  const row=grid.locator('[data-row-id="'+f.direct.id+'"]');await row.getByRole('button',{name:'更新 '+f.direct.title+' 进度',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'更新进度',exact:true});await dialog.getByLabel('需求完成度').fill('45');await dialog.getByRole('button',{name:'更新进度',exact:true}).click();
  await expect(row.getByRole('button',{name:'更新 '+f.direct.title+' 进度',exact:true})).toHaveText('45%');await row.getByRole('button',{name:'完成需求',exact:true}).click();
  await expect(row.locator('.workspace-row-progress > span').first()).toHaveText('已完成');await expect(page.locator('.modal-card-workspace[role=dialog]')).toHaveCount(0);
});

test('窄屏只有一套行内控件；详情字段对齐且不重排甘特',async({page},info)=>{
  const f=await phaseFixture(page),work=f.testing.workItems[1];await page.setViewportSize({width:390,height:844});await page.goto('/execution');
  await chooseOption(page.getByLabel('展开层级',{exact:true}),'work');const grid=page.getByRole('treegrid'),row=grid.locator('[data-row-id="'+work.id+'"]');
  await row.scrollIntoViewIfNeeded();await row.locator('.workspace-row-actions').scrollIntoViewIfNeeded();const progress=row.getByRole('button',{name:'更新 '+work.title+' 进度',exact:true}),complete=row.getByRole('button',{name:'完成',exact:true});
  await expect(progress).toHaveCount(1);await expect(complete).toHaveCount(1);
  const p=await progress.boundingBox(),c=await complete.boundingBox();expect(p!.x+p!.width<=c!.x||p!.y+p!.height<=c!.y).toBe(true);expect(c!.x+c!.width).toBeLessThanOrEqual(390);expect(p!.height).toBeGreaterThanOrEqual(22);expect(c!.height).toBe(30);
  await progress.click();await expect(page.getByRole('dialog',{name:'更新工作项进度',exact:true})).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
  await page.screenshot({path:info.outputPath('narrow-meeting.png'),animations:'disabled'});
  const bounds=await grid.boundingBox();await row.locator('.workspace-row-title').click();const detail=page.locator('.modal-card-workspace[role=dialog]');await expect(detail.getByRole('button',{name:'更新',exact:true})).toBeVisible();
  expect(await grid.boundingBox()).toEqual(bounds);const facts=detail.locator('.object-facts dd:visible');expect(await facts.evaluateAll(nodes=>new Set(nodes.map(n=>Math.round(n.getBoundingClientRect().left))).size)).toBe(1);
  await expect(detail.locator('.requirement-overview:visible')).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('aligned-work-detail.png'),animations:'disabled'});
});

test('进度提交结果未知先核对，保留说明且不重复提交',async({page})=>{
  const f=await phaseFixture(page),work=f.testing.workItems[1];await page.goto('/execution');await chooseOption(page.getByLabel('展开层级',{exact:true}),'work');
  const row=page.getByRole('treegrid').locator('[data-row-id="'+work.id+'"]');await row.getByRole('button',{name:'更新 '+work.title+' 进度',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'更新工作项进度',exact:true});await dialog.getByRole('spinbutton').fill('78');await dialog.getByRole('textbox',{name:/^说明/}).fill('保留这次会议说明');
  let writes=0;await page.route('**/api/requirements/'+f.testing.id+'/progress',async route=>{writes++;await route.fetch();await route.abort('failed');});
  await dialog.getByRole('button',{name:'记录进展',exact:true}).click();await expect(dialog).toContainText('无法确认刚才的提交是否生效');await expect(dialog.getByRole('textbox',{name:/^说明/})).toHaveValue('保留这次会议说明');await expect(dialog.getByRole('button',{name:'记录进展',exact:true})).toBeDisabled();
  expect(writes).toBe(1);const saved=await(await page.request.get('/api/requirements/'+f.testing.id)).json();expect(saved.workItems.find((w:{id:string})=>w.id===work.id).progress).toBe(78);
});

test('并发修改后重读工作项，保留输入并用最新版本提交',async({page})=>{
  const f=await phaseFixture(page),work=f.testing.workItems[1];await page.goto('/execution');await chooseOption(page.getByLabel('展开层级',{exact:true}),'work');
  const row=page.getByRole('treegrid').locator('[data-row-id="'+work.id+'"]');await row.getByRole('button',{name:'更新 '+work.title+' 进度',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'更新工作项进度',exact:true});await dialog.getByRole('spinbutton').fill('85');await dialog.getByRole('textbox',{name:/^说明/}).fill('并发后保留的说明');
  const other=await page.request.post('/api/requirements/'+f.testing.id+'/progress',{data:{expectedVersion:work.version,workItemId:work.id,workItemPercent:80,content:'另一位成员更新'}});expect(other.ok()).toBe(true);
  // Keep the displayed report stale: only the explicit recheck provides the new work version.
  await page.route('**/api/dashboard?**',route=>route.fulfill({status:503,json:{error:'报表暂时无法刷新'}}));
  await dialog.getByRole('button',{name:'记录进展',exact:true}).click();await expect(dialog).toContainText('当前完成度 80%');await expect(dialog.getByRole('textbox',{name:/^说明/})).toHaveValue('并发后保留的说明');
  await expect(dialog.getByRole('button',{name:'记录进展',exact:true})).toBeEnabled();await dialog.getByRole('button',{name:'记录进展',exact:true}).click();await expect(dialog).toHaveCount(0);
  const latest=await(await page.request.get('/api/requirements/'+f.testing.id)).json();expect(latest.workItems.find((w:{id:string})=>w.id===work.id).progress).toBe(85);
});
