import {test,expect,type Page} from '@playwright/test';
import {addBusinessDays,todayIso} from '../../src/shared/domain';
import type {PathAnalysis} from '../../src/shared/paths';
import {graphFixture as fixture} from './graph-fixture';
import {openGraph,closeGraphProperties,graphProperties} from './graph-interactions';
import {headerAction} from './topbar-helpers';

const ready=(page:Page)=>expect(page.locator('.dependency-canvas')).toHaveAttribute('data-layout-ready','true');
async function selectList(page:Page,title:string){
 await closeGraphProperties(page);
 await graphProperties(page,page.locator('.react-flow__node').filter({has:page.locator('.graph-title',{hasText:title})}).first());
}
async function revisit(page:Page){
 await closeGraphProperties(page);await page.getByRole('link',{name:'问题跟踪',exact:true}).click();await expect(page).toHaveURL(/\/issues/);await page.goBack();await ready(page);
}
test('里程碑确认同步锁定，响应异常后回读已生效状态',async({page})=>{
 const {project}=await fixture(page);
 const template=await(await page.request.post('/api/templates',{data:{projectId:project.id,name:'人工里程碑流程',dependencyMode:'dependencies',items:[{clientKey:'m',title:'手动确认交付',kind:'milestone',confirmationMode:'manual',durationDays:0,startOffsetDays:0,sortOrder:0,predecessorKeys:[]}]}})).json();
 const requirement=await(await page.request.post('/api/requirements',{data:{projectId:project.id,templateId:template.id,title:'里程碑确认需求',plannedStart:todayIso()}})).json();
 const analysis=await(await page.request.get('/api/requirements/'+requirement.id+'/path-analysis')).json() as PathAnalysis,milestone=(analysis.milestones||[]).find(item=>item.title==='手动确认交付')!;
 await openGraph(page,'/requirements/'+requirement.id+'?view=path');await ready(page);await selectList(page,milestone.title);
 const button=page.getByRole('button',{name:'确认里程碑达成',exact:true});await expect(button).toBeVisible();
 let writes=0,release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/milestones/'+milestone.id+'/achieve',async route=>{const index=++writes;await pending;if(index===1){await route.fetch();await route.fulfill({status:200,contentType:'text/html',body:'invalid response'});}else await route.fulfill({status:409,json:{error:'重复确认'}});});
 try{await button.evaluate(element=>{(element as HTMLButtonElement).click();(element as HTMLButtonElement).click();});await expect.poll(()=>writes).toBeGreaterThan(0);await page.waitForTimeout(100);expect(writes).toBe(1);}finally{release();}
 const reopen=page.getByRole('button',{name:'重新打开里程碑',exact:true});await expect(reopen).toBeVisible();expect(writes).toBe(1);
 let reopenWrites=0;await page.route('**/api/milestones/'+milestone.id+'/reopen',async route=>{reopenWrites++;await route.fetch();await route.fulfill({status:200,contentType:'text/html',body:'invalid response'});});
 let failReads=true;await page.route('**/api/projects/'+project.id+'/path-graph*',route=>failReads?route.fulfill({status:503,json:{error:'核对读取失败'}}):route.fallback());
 await reopen.click();await expect(page.getByRole('alert')).toContainText('里程碑操作结果待核对');await expect(reopen).toBeDisabled();await reopen.evaluate(element=>(element as HTMLButtonElement).click());expect(reopenWrites).toBe(1);
 expect(((await(await page.request.get('/api/requirements/'+requirement.id+'/path-analysis')).json() as PathAnalysis).milestones||[]).find(item=>item.id===milestone.id)?.achievedAt).toBeNull();
 failReads=false;await revisit(page);await selectList(page,milestone.title);
 const recheck=page.getByRole('button',{name:'重新读取里程碑结果',exact:true});await expect(page.getByRole('button',{name:'草稿状态',exact:true})).toContainText('里程碑待核对');
 const achieveAgain=page.getByRole('button',{name:'确认里程碑达成',exact:true});await expect(achieveAgain).toBeDisabled();await achieveAgain.evaluate(element=>(element as HTMLButtonElement).click());expect(writes).toBe(1);
 await closeGraphProperties(page);await headerAction(page,'重新读取里程碑结果');await selectList(page,milestone.title);await expect(recheck).toHaveCount(0);await expect(achieveAgain).toBeEnabled();expect(reopenWrites).toBe(1);
});

test('依赖排期应用同帧只提交一次且弹窗保持锁定',async({page})=>{
 const {b}=await fixture(page);await openGraph(page,'/requirements/'+b.id+'?view=path');await ready(page);
 await page.getByRole('button',{name:'排期预览',exact:true}).click();await page.getByRole('button',{name:'预览并应用计划日期',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'按依赖预览排期',exact:true});await dialog.getByLabel('需求开始锚点', {exact:true}).fill(addBusinessDays(todayIso(),5));await dialog.getByRole('button',{name:'生成差异预览',exact:true}).click();
 const apply=dialog.getByRole('button',{name:'应用以上计划',exact:true});await expect(apply).toBeEnabled();
 let writes=0,release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/requirements/'+b.id+'/dependency-plan/apply',async route=>{const index=++writes;await pending;if(index===1)await route.continue();else await route.fulfill({status:409,json:{error:'重复应用'}});});
 try{await dialog.locator('form').evaluate(form=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));});await expect(dialog).toBeVisible();await expect.poll(()=>writes).toBeGreaterThan(0);await page.waitForTimeout(100);expect(writes).toBe(1);}finally{release();}
 await expect(dialog).toHaveCount(0);expect(writes).toBe(1);
});

test('依赖排期响应未知且回读失败时跨导航保持核对锁',async({page})=>{
 const {b,project}=await fixture(page);let failReads=false,writes=0;
 await page.route('**/api/projects/'+project.id+'/path-graph*',route=>failReads?route.fulfill({status:503,json:{error:'核对读取失败'}}):route.fallback());
 await page.route('**/api/requirements/'+b.id+'/dependency-plan/apply',async route=>{
   writes++;await route.fetch();failReads=true;await route.fulfill({status:200,contentType:'text/html',body:'invalid response'});
 });
 await openGraph(page,'/requirements/'+b.id+'?view=path');await ready(page);
 await page.getByRole('button',{name:'排期预览',exact:true}).click();await page.getByRole('button',{name:'预览并应用计划日期',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'按依赖预览排期',exact:true}),baseStart=addBusinessDays(todayIso(),5);
 await dialog.getByLabel('需求开始锚点',{exact:true}).fill(baseStart);await dialog.getByRole('button',{name:'生成差异预览',exact:true}).click();
 await dialog.getByRole('button',{name:'应用以上计划',exact:true}).click();await expect(dialog.getByText(/操作结果暂时无法确认/)).toBeVisible();
 await dialog.getByRole('button',{name:'取消',exact:true}).click();await revisit(page);
 const recheck=page.getByRole('button',{name:'重新读取排期结果',exact:true});await expect(page.getByRole('button',{name:'草稿状态',exact:true})).toContainText('排期待核对');
 const applyEntry=page.getByRole('button',{name:'预览并应用计划日期',exact:true});if(!await applyEntry.isVisible())await page.getByRole('button',{name:'排期预览',exact:true}).click();await expect(applyEntry).toBeDisabled();
 await applyEntry.evaluate(button=>(button as HTMLButtonElement).click());expect(writes).toBe(1);
 failReads=false;await headerAction(page,'重新读取排期结果');await expect(recheck).toHaveCount(0);await expect(applyEntry).toBeEnabled();expect(writes).toBe(1);
});

test('依赖排期未生效时重新读取并恢复开始日期但废弃旧预览',async({page})=>{
 const {b,project}=await fixture(page);let failReads=false,writes=0;
 await page.route('**/api/projects/'+project.id+'/path-graph*',route=>failReads?route.fulfill({status:503,json:{error:'核对读取失败'}}):route.fallback());
 await page.route('**/api/requirements/'+b.id+'/dependency-plan/apply',route=>{writes++;failReads=true;return route.fulfill({status:200,contentType:'text/html',body:'invalid response'});});
 await openGraph(page,'/requirements/'+b.id+'?view=path');await ready(page);
 await page.getByRole('button',{name:'排期预览',exact:true}).click();await page.getByRole('button',{name:'预览并应用计划日期',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'按依赖预览排期',exact:true}),baseStart=addBusinessDays(todayIso(),7);
 await dialog.getByLabel('需求开始锚点',{exact:true}).fill(baseStart);await dialog.getByRole('button',{name:'生成差异预览',exact:true}).click();await dialog.getByRole('button',{name:'应用以上计划',exact:true}).click();
 await expect(dialog.getByText(/操作结果暂时无法确认/)).toBeVisible();await dialog.getByRole('button',{name:'取消',exact:true}).click();
 await revisit(page);
 failReads=false;await headerAction(page,'重新读取排期结果');
 const restored=page.getByRole('dialog',{name:'按依赖预览排期',exact:true});await expect(restored).toBeVisible();await expect(restored.getByLabel('需求开始锚点',{exact:true})).toHaveValue(baseStart);
 await expect(restored.getByRole('button',{name:'生成差异预览',exact:true})).toBeEnabled();await expect(restored.getByRole('button',{name:'应用以上计划',exact:true})).toBeDisabled();expect(writes).toBe(1);
});
