import {expect,test,type Page,type Locator} from '@playwright/test';
import {phaseFixture} from './phase-fixture';
import {chooseOption} from './select-helper';
import type {Requirement,WorkItem} from '../../src/client/types';

async function post(page:Page,url:string,data:unknown){const r=await page.request.post(url,{data});expect(r.ok(),await r.text()).toBe(true);return r.json();}
async function progressIsReadable(row:Locator){
 return row.locator('.workspace-row-progress').evaluate(el=>{const b=el.getBoundingClientRect(),r=el.closest('[data-row-id]')!;return b.width>=44&&b.left>=r.querySelector('.workspace-row-label')!.getBoundingClientRect().right&&b.right<=r.querySelector('.workspace-row-actions')!.getBoundingClientRect().left;});
}

test('并行阶段与短时间条进度显示在时间轴，右栏仅有操作，数字可直接更新',async({page},info)=>{
 const f=await phaseFixture(page);
 const template=await post(page,'/api/templates',{projectId:f.projectId,name:'并行进展',dependencyMode:'dependencies',items:[{clientKey:'design',title:'需求设计',workStage:'analysis',durationDays:1,startOffsetDays:0,sortOrder:0,predecessorKeys:[]},{clientKey:'dev',title:'后端开发',workStage:'development',durationDays:1,startOffsetDays:0,sortOrder:1,predecessorKeys:[]}]});
 let r:Requirement=await post(page,'/api/requirements',{projectId:f.projectId,featureId:f.feature.id,phaseId:f.phases[2].id,ownerId:f.testing.ownerId,title:'并行交付进展',templateId:template.id,plannedStart:new Date().toISOString().slice(0,10)});
 for(const [i,percent] of [15,25].entries()){
  const w:WorkItem=await post(page,'/api/work-items/'+r.workItems[i].id+'/start',{expectedVersion:r.workItems[i].version,expectedRequirementVersion:r.version,ownerId:f.testing.ownerId});
  await post(page,'/api/requirements/'+r.id+'/progress',{expectedVersion:w.version,workItemId:w.id,workItemPercent:percent,content:'并行阶段进展'});
  r=await(await page.request.get('/api/requirements/'+r.id)).json();
 }
 await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'progress',scopeType:'phase',scopeId:f.phases[2].id}));await chooseOption(page.getByLabel('展开层级',{exact:true}),'work');
 const row=page.locator('[data-row-id="'+r.id+'"]'),work=page.locator('[data-row-id="'+r.workItems[0].id+'"]'),grid=page.getByRole('treegrid');
 await expect(row.locator('.workspace-row-track .workspace-row-progress')).toContainText('分析设计 15%');await expect(row.locator('.workspace-row-track .workspace-row-progress')).toContainText('开发 25%');
 await expect(row.locator('.workspace-row-actions')).toHaveText('更新进展');await expect(page.locator('.workspace-row-actions .workspace-row-progress')).toHaveCount(0);
 await page.getByRole('button',{name:'月',exact:true}).click();
 await expect.poll(()=>progressIsReadable(row)).toBe(true);await expect.poll(()=>progressIsReadable(work)).toBe(true);
 expect(await row.locator('.workspace-row-progress .workspace-stage-summary').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
 expect((await work.locator('.gantt-date-actual').boundingBox())!.width).toBeLessThan(36);
 const bounds=await grid.boundingBox(),columns=await row.locator('.workspace-row-label,.workspace-row-actions').evaluateAll(els=>els.map(e=>e.getBoundingClientRect().toJSON()));
 await work.getByRole('button',{name:'更新 需求设计 进度',exact:true}).click();const dialog=page.getByRole('dialog').last();await dialog.getByRole('spinbutton').fill('35');await dialog.getByRole('textbox',{name:/^说明/}).fill('时间轴上更新');await dialog.getByRole('button',{name:'记录进展',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(row.locator('.workspace-row-progress')).toContainText('分析设计 35%');expect(await grid.boundingBox()).toEqual(bounds);expect(await row.locator('.workspace-row-label,.workspace-row-actions').evaluateAll(els=>els.map(e=>e.getBoundingClientRect().toJSON()))).toEqual(columns);
 for(const end of [true,false]){await grid.evaluate((el,end)=>{el.scrollLeft=end?el.scrollWidth-el.clientWidth:0;},end);await expect.poll(()=>progressIsReadable(row)).toBe(true);await expect.poll(()=>progressIsReadable(work)).toBe(true);}
 await page.screenshot({path:info.outputPath('parallel-progress.png'),animations:'disabled'});
 await page.setViewportSize({width:390,height:844});await work.scrollIntoViewIfNeeded();await expect.poll(()=>progressIsReadable(work)).toBe(true);
 const actions=(await work.locator('.workspace-row-actions').boundingBox())!;for(const button of await work.locator('.workspace-row-actions button').all()){const box=(await button.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(actions.x);expect(box.x+box.width).toBeLessThanOrEqual(actions.x+actions.width);}
 expect(await work.locator('.workspace-row-progress').evaluate(el=>{const b=el.getBoundingClientRect();return el.contains(document.elementFromPoint(b.right-2,b.y+b.height/2));})).toBe(true);
 await work.getByRole('button',{name:'更新 需求设计 进度',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('narrow-progress.png'),animations:'disabled'});
});

test('工作项状态使用统一图标，未分派与执行状态分别表达',async({page},info)=>{
 const f=await phaseFixture(page),template=await post(page,'/api/templates',{projectId:f.projectId,name:'待安排任务',dependencyMode:'dependencies',items:[{clientKey:'a',title:'待安排',durationDays:1,startOffsetDays:0,sortOrder:0,predecessorKeys:[]},{clientKey:'b',title:'已取消任务',durationDays:1,startOffsetDays:0,sortOrder:1,predecessorKeys:[]}]});
 const r:Requirement=await post(page,'/api/requirements',{projectId:f.projectId,featureId:f.feature.id,title:'未安排需求',templateId:template.id});await post(page,'/api/work-items/'+r.workItems[1].id+'/cancel',{expectedVersion:r.workItems[1].version,reason:'补充任务不再需要'});
 await page.goto('/execution');await chooseOption(page.getByLabel('展开层级',{exact:true}),'work');
 await page.getByRole('button',{name:'筛选执行状态',exact:true}).click();await page.getByRole('checkbox',{name:'已取消',exact:true}).check();await page.keyboard.press('Escape');
 const cases=[[f.testing.workItems[0].id,'completed','已完成'],[f.testing.workItems[1].id,'in_progress','进行中'],[r.workItems[0].id,'not_started','未开始'],[r.workItems[1].id,'cancelled','已取消']];
 const marks=[];for(const [id,status,label] of cases){const row=page.locator('[data-row-id="'+id+'"]'),mark=row.getByRole('img',{name:label,exact:true});await expect(mark).toHaveAttribute('data-work-status',status);marks.push(await mark.evaluate(e=>({color:getComputedStyle(e).color,size:e.getBoundingClientRect().width+'x'+e.getBoundingClientRect().height,icon:e.querySelector('svg')!.innerHTML})));}
 expect(new Set(marks.map(m=>m.size)).size).toBe(1);expect(new Set(marks.map(m=>m.icon)).size).toBe(4);expect(new Set(marks.map(m=>m.color)).size).toBe(3);
 const unassigned=page.locator('[data-row-id="'+r.workItems[0].id+'"]');await expect(unassigned.locator('.workspace-row-owner')).toHaveText('未分派');await expect(unassigned.locator('.workspace-row-track')).toContainText('未开始');await expect(unassigned.locator('.workspace-row-track')).toContainText('待排期');await expect.poll(()=>progressIsReadable(unassigned)).toBe(true);
 await unassigned.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('work-status-icons.png'),animations:'disabled'});
});

test('Phase 内独立需求的跨 Phase 依赖能实际绘制，空画布不算加载成功',async({page},info)=>{
 const f=await phaseFixture(page),ids:string[]=[],target=await post(page,'/api/requirements',{projectId:f.projectId,featureId:f.feature.id,phaseId:f.phases[1].id,title:'后续集成',reason:'补充联调'});
 for(let i=0;i<4;i++)ids.push((await post(page,'/api/requirements',{projectId:f.projectId,featureId:f.feature.id,phaseId:f.phases[2].id,title:'独立模块 '+i})).id);
 for(const source of ids){const analysis=await(await page.request.get(f.base+'/path-analysis')).json();await post(page,f.base+'/dependencies',{expectedRevision:analysis.revision,sourceRequirementId:source,targetRequirementId:target.id});}
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 for(const [scopeType,scopeId] of [['feature',f.feature.id],['phase',f.phases[1].id],['phase',f.phases[2].id]]){
  await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'graph',scopeType,scopeId}));await expect(page.locator('[data-layout-ready=true]')).toBeVisible();
  for(const id of [...ids,target.id]){const card=page.locator('.react-flow__node[data-id="'+id+'"]');await expect(card).toBeVisible();await expect(card).not.toHaveClass(/graph-node-hidden/);}
  await expect(page.locator('.react-flow__edge-path')).toHaveCount(4);await expect(page.getByRole('alert')).toHaveCount(0);await page.screenshot({path:info.outputPath('cross-phase-'+scopeId+'.png'),animations:'disabled'});
 }
 expect(errors).toEqual([]);
});
