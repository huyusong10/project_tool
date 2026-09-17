import {expect,test,type Page} from '@playwright/test';
import {phaseFixture} from './phase-fixture';
import {chooseOption} from './select-helper';
import {headerAction} from './topbar-helpers';
import type {Requirement,Issue} from '../../src/client/types';

async function post(page:Page,url:string,data:unknown){const r=await page.request.post(url,{data});expect(r.ok(),await r.text()).toBe(true);return r.json();}
const location=(projectId:string,scopeType:string,scopeId:string,detailId?:string)=>'/?'+new URLSearchParams({projectId,scopeType,scopeId,workspaceView:'list',...detailId?{detailId,detailTab:'basic'}:{}});

test('Phase 自动完成，页面筛选不改变汇总，完成后仍可编辑和补充需求',async({page},info)=>{
  const f=await phaseFixture(page),p=f.phases[0];
  await page.goto(location(f.projectId,'phase',p.id));
  await expect(page.locator('.workspace-overview-strip')).toContainText('Phase 完成1 / 1');
  await expect(page.getByRole('button',{name:'新建对象',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'确认交付',exact:true})).toHaveCount(0);
  await headerAction(page,'编辑 Phase');
  const form=page.getByRole('dialog',{name:'编辑 Phase',exact:true});
  await form.getByLabel('关注说明').fill('完成后补充说明');await form.getByRole('button',{name:'编辑 Phase',exact:true}).click();
  await expect(form).toHaveCount(0);
  await post(page,'/api/requirements',{projectId:f.projectId,featureId:f.feature.id,phaseId:p.id,title:'补充验证',reason:'新增范围'});
  await page.reload();await expect(page.locator('.workspace-overview-strip')).toContainText('Phase 完成0 / 1');
  await page.screenshot({path:info.outputPath('derived-phase.png'),animations:'disabled'});
});

test('管理员直接维护已完成工作及已解决问题的负责人，桌面和窄屏均可操作',{tag:'@responsive'}, async({page},info)=>{
  const f=await phaseFixture(page),person=await post(page,'/api/people',{projectId:f.projectId,name:'维护负责人 '+Date.now()});
  await post(page,'/api/work-items/'+f.testing.workItems[1].id+'/complete',{expectedVersion:f.testing.workItems[1].version});
  const work=f.testing.workItems[0];
  await page.goto(location(f.projectId,'requirement',f.testing.id,work.id));
  const detail=page.locator('[aria-label="工作项详情"]');
  await detail.getByRole('button',{name:/^主负责人：/}).click();
  await page.getByRole('option',{name:new RegExp(person.name)}).click();
  await expect.poll(async()=>{const r:Requirement=await(await page.request.get('/api/requirements/'+f.testing.id)).json();return r.workItems.find(w=>w.id===work.id)?.ownerId;}).toBe(person.id);
  await expect(detail.getByRole('button',{name:/^实际完成：/})).toBeEnabled();
  const after:Requirement=await(await page.request.get('/api/requirements/'+f.testing.id)).json();expect(after.status).toBe('completed');expect(after.workItems[0].actualEnd).toBe(work.actualEnd);
  await page.screenshot({path:info.outputPath('completed-work-edit.png'),animations:'disabled'});
  const issue=await post(page,'/api/issues',{projectId:f.projectId,title:'维护已解决问题',ownerId:person.id});
  await post(page,'/api/issues/'+issue.id+'/resolve',{expectedVersion:issue.version,content:'原解决说明'});
  await page.setViewportSize({width:390,height:844});
  await page.goto('/issues?'+new URLSearchParams({projectId:f.projectId,detailId:issue.id,detailTab:'basic'}));
  const form=page.getByRole('dialog',{name:'问题详情'});
  await form.getByRole('button',{name:/^负责人：/}).click();await page.getByRole('option',{name:'未分配',exact:true}).click();
  await form.getByRole('textbox',{name:'修改说明',exact:true}).fill('更正历史归属');
  await form.getByRole('button',{name:'保存修改',exact:true}).click();await expect(form).toHaveCount(0);
  const saved:Issue=await(await page.request.get('/api/issues/'+issue.id)).json();expect(saved).toMatchObject({status:'resolved',progress:100,ownerId:null});expect(saved.updates?.some(u=>u.content==='原解决说明')).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('resolved-issue-mobile.png'),animations:'disabled'});
});

test('页面切换流程重排成功，带依赖工作项直接删除并清理关联',async({page})=>{
  const f=await phaseFixture(page);
  const template=await post(page,'/api/templates',{projectId:f.projectId,name:'依赖流程',dependencyMode:'dependencies',items:[{clientKey:'a',title:'第一步',durationDays:1,startOffsetDays:0,sortOrder:0,predecessorKeys:[]},{clientKey:'b',title:'第二步',durationDays:1,startOffsetDays:1,sortOrder:1,predecessorKeys:['a']}]});
  const r:Requirement=await post(page,'/api/requirements',{projectId:f.projectId,title:'重排维护',templateId:f.testing.templateId,plannedStart:'2020-01-06'});
  await page.goto(location(f.projectId,'requirement',r.id));await headerAction(page,'安排计划');
  const form=page.getByRole('dialog',{name:'调整需求计划'});
  await chooseOption(form.getByLabel('绑定流程'),template.id);
  await form.getByRole('button',{name:'保存排期',exact:true}).click();await page.getByRole('button',{name:'确认切换',exact:true}).click();
  await expect(form).toHaveCount(0);
  const changed:Requirement=await(await page.request.get('/api/requirements/'+r.id)).json();expect(changed.templateId).toBe(template.id);
  const work=changed.workItems[0];await page.goto(location(f.projectId,'requirement',r.id,work.id));
  await page.locator('[aria-label="工作项详情"]').getByRole('button',{name:'删除',exact:true}).click();
  await page.getByRole('dialog',{name:'删除工作项',exact:true}).getByRole('button',{name:'确认删除',exact:true}).click();
  await expect.poll(async()=>{const saved:Requirement=await(await page.request.get('/api/requirements/'+r.id)).json();return saved.workItems.some(w=>w.id===work.id);}).toBe(false);
  const graph=await(await page.request.get(f.base+'/path-analysis')).json();expect(graph.dependencies.some((e:{sourceWorkItemId?:string;targetWorkItemId?:string})=>e.sourceWorkItemId===work.id||e.targetWorkItemId===work.id)).toBe(false);
});
