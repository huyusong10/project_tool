import {expect,test,type Page} from '@playwright/test';
import type {Requirement} from '../../src/client/types';
import {randomUUID} from 'node:crypto';
import type {PathAnalysis} from '../../src/shared/paths';
import type {DependencyChanges} from '../../src/shared/path-contracts';
import {addBusinessDays,todayIso} from '../../src/shared/domain';

async function post(page:Page,url:string,data:Record<string,unknown>){
 const response=await page.request.post(url,{data});expect(response.ok(),await response.text()).toBe(true);return response.json();
}
async function fixture(page:Page){
 const session=await post(page,'/api/login',{username:'admin',password:'41_xc7q0qOjo4Inw!'});
 const project=await post(page,'/api/projects',{name:'行动旅程 '+Date.now()});
 const owner=await post(page,'/api/people',{projectId:project.id,name:'行动负责人 '+Date.now()});
 await page.addInitScript(({accountId,projectId})=>localStorage.setItem('project-manage:selected-project:'+accountId,projectId),{accountId:session.accountId,projectId:project.id});
 return {project,owner,create:async(data:Record<string,unknown>)=>await post(page,'/api/requirements',{projectId:project.id,ownerId:owner.id,...data}) as Requirement};
}

test('未排期需求从行动进入详情，补齐计划后返回原筛选并消失',async({page})=>{
 const {owner,create}=await fixture(page),requirement=await create({title:'需要补排期的需求',durationDays:2});
 await page.goto('/actions?reason=incomplete_schedule&ownerId='+owner.id);
 const action=page.locator('.action-item').filter({hasText:requirement.title});await expect(action).toContainText('排期不完整');await action.click();
 await expect(page).toHaveURL(new RegExp('/requirements/'+requirement.id));await page.getByRole('button',{name:'调整计划',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'调整需求计划'});await dialog.getByLabel('计划开始',{exact:true}).fill('2026-09-14');await dialog.getByRole('button',{name:'保存排期',exact:true}).click();await expect(dialog).toHaveCount(0);
 await page.goBack();await expect(page).toHaveURL(/\/actions\?reason=incomplete_schedule&ownerId=/);
 await expect(page.getByLabel('行动原因',{exact:true})).toHaveValue('incomplete_schedule');await expect(page.getByLabel('负责人',{exact:true})).toHaveValue(owner.id);await expect(page.locator('.action-item').filter({hasText:requirement.title})).toHaveCount(0);
});

test('未分派工作项从行动定位到原工作，分派后行动消失',async({page})=>{
 const {owner,create}=await fixture(page),requirement=await create({title:'工作项分派旅程',plannedStart:'2026-09-14',plannedEnd:'2026-09-15'});
 const created=await post(page,`/api/requirements/${requirement.id}/work-items`,{expectedVersion:requirement.version,title:'待分派验证',plannedStart:'2026-09-14',plannedEnd:'2026-09-15'});
 await page.goto('/actions?reason=unassigned');const action=page.locator('.action-item').filter({hasText:'待分派验证'});await expect(action).toContainText('未分派');await action.click();
 await expect(page).toHaveURL(new RegExp('detailId='+created.id));await expect(page.getByRole('tab',{name:'资料',exact:true})).toHaveAttribute('aria-selected','true');
 const row=page.locator('.work-arrangement-row[data-work-id="'+created.id+'"]');await row.getByRole('button',{name:/^主负责人：/}).click();await page.getByRole('option',{name:new RegExp(owner.name)}).click();await expect(row.getByRole('button',{name:/^主负责人：/})).toContainText(owner.name);
 await page.goBack();await expect(page).toHaveURL(/\/actions\?reason=unassigned/);await expect(page.locator('.action-item').filter({hasText:'待分派验证'})).toHaveCount(0);
});

test('逾期问题从行动打开并解决，处理后行动消失', async({page})=>{
 const {project,owner}=await fixture(page);const issue=await post(page,'/api/issues',{projectId:project.id,ownerId:owner.id,title:'需要处理的逾期问题',discoveredAt:'2026-09-01',dueDate:'2026-09-02'});
 await page.goto('/actions?reason=overdue&ownerId='+owner.id);const action=page.locator('.action-item').filter({hasText:issue.title});await expect(action).toContainText('问题逾期');await action.click();
 const dialog=page.getByRole('dialog',{name:'问题详情'});await expect(dialog).toContainText(issue.title);
 await dialog.locator('.issue-status-trigger').click();await page.getByRole('button',{name:/确认解决/}).click();await expect(dialog.locator('.issue-status-trigger')).toContainText('已解决');
 await dialog.getByRole('button',{name:'关闭',exact:true}).click();await expect(dialog).toHaveCount(0);
 await page.goto('/actions?reason=overdue&ownerId='+owner.id);await expect(page.locator('.action-item').filter({hasText:issue.title})).toHaveCount(0);
});

for(const scope of ['requirement','project'] as const)test(`${scope==='requirement'?'需求':'项目'}里程碑从待处理直接打开，确认达成后返回原筛选`,async({page},info)=>{
 const {project,create}=await fixture(page),base='/api/projects/'+project.id;
 const template=await post(page,'/api/templates',{projectId:project.id,name:'待核对里程碑流程',dependencyMode:'dependencies',items:[
  {clientKey:'m',title:'接口基线核对',kind:'milestone',confirmationMode:'manual',durationDays:0,startOffsetDays:0,sortOrder:0,predecessorKeys:[]},
  {clientKey:'w',title:'后续接口工作',durationDays:1,startOffsetDays:0,sortOrder:1,predecessorKeys:['m']},
 ]});
 const namedFeature=scope==='project'?(await post(page,base+'/features',{name:'已有需求范围'})).features.find((feature:{name:string})=>feature.name==='已有需求范围'):undefined;
 const requirement=await create({title:'待处理里程碑旅程',templateId:template.id,plannedStart:addBusinessDays(todayIso(),0),...(namedFeature?{featureId:namedFeature.id}:{})});
 const analysis=await(await page.request.get(base+'/path-analysis')).json() as PathAnalysis;
 const own=analysis.milestones!.find(item=>item.requirementId===requirement.id)!,id=scope==='requirement'?own.id:randomUUID();
 const changes:DependencyChanges={add:[],remove:[],estimates:[],entities:[scope==='requirement'
  ?{entity:'milestone',op:'update',id,requirementId:requirement.id,expectedVersion:own.version,data:{targetDate:null}}
  :{entity:'milestone',op:'create',id,requirementId:null,data:{title:'项目基线核对',confirmationMode:'manual'}}]};
 const input={expectedRevision:analysis.revision,target:'project',changes},preview=await post(page,base+'/dependency-changes/preview',input);
 await post(page,base+'/dependency-changes/apply',{...input,batchId:randomUUID(),previewToken:preview.previewToken});
 const title=scope==='requirement'?own.title:'项目基线核对';
 const before=await(await page.request.get('/api/requirements/'+requirement.id)).json() as Requirement;
 let writes=0;page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/milestones/'+id+'/achieve'))writes++;});
 await page.goto('/actions?projectId='+project.id+'&reason=path_blocked');await page.locator('.action-item').filter({hasText:title}).click();
 await expect.poll(()=>new URL(page.url()).searchParams.get('pathNode')).toBe(id);
 const detail=page.locator('.modal-card-workspace[role=dialog]');await expect(detail).toContainText(title);await expect(page.locator('.workspace-graph-empty')).toHaveCount(0);
 expect(new URL(page.url()).searchParams.get('projectId')).toBe(project.id);expect(new URL(page.url()).searchParams.get('scopeType')).toBe(scope);
 if(scope==='project'){await page.setViewportSize({width:390,height:844});await expect(detail.getByRole('button',{name:'确认里程碑达成',exact:true})).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('action-project-milestone-390.png'),animations:'disabled'});}
 await expect(detail.getByRole('button',{name:'确认里程碑达成',exact:true})).toBeVisible();await detail.getByRole('button',{name:'确认里程碑达成',exact:true}).click();await expect(detail.getByRole('button',{name:'重新打开里程碑',exact:true})).toBeVisible();
 await page.goBack();await expect(page).toHaveURL(/\/actions\?/);await expect(page.getByLabel('行动原因',{exact:true})).toHaveValue('path_blocked');
 await expect(page.locator('.action-item').filter({hasText:title})).toHaveCount(0);expect(writes).toBe(1);
 const after=await(await page.request.get('/api/requirements/'+requirement.id)).json() as Requirement;
 expect(after.status).toBe(before.status);expect(after.progressUpdates).toEqual(before.progressUpdates);
 expect(after.workItems.map(item=>({id:item.id,status:item.status,progress:item.progress,actualStart:item.actualStart,actualEnd:item.actualEnd}))).toEqual(before.workItems.map(item=>({id:item.id,status:item.status,progress:item.progress,actualStart:item.actualStart,actualEnd:item.actualEnd})));
});

test('行动与问题详情在标准视口和窄屏内完整显示',{tag:'@responsive'},async({page},info)=>{
 const {project,owner}=await fixture(page),issue=await post(page,'/api/issues',{projectId:project.id,ownerId:owner.id,title:'需要处理的逾期问题',discoveredAt:'2026-09-01',dueDate:'2026-09-02'});
 await page.goto('/actions?reason=overdue&ownerId='+owner.id);
 await page.locator('.action-item').filter({hasText:issue.title}).click();
 const dialog=page.getByRole('dialog',{name:'问题详情'});
 for(const viewport of [page.viewportSize()!,{width:390,height:844}]){
  await page.setViewportSize(viewport);await expect(dialog).toContainText(issue.title);
  const box=(await dialog.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(viewport.width);expect(box.y+box.height).toBeLessThanOrEqual(viewport.height);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  await page.screenshot({path:info.outputPath('overdue-issue-'+viewport.width+'.png')});
 }
});
