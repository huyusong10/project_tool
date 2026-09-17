import {chooseOption} from './select-helper';
import {test,expect,type Page} from '@playwright/test';
import type {Requirement} from '../../src/client/types';

test('直接执行进行中与完成详情在办公和窄屏不溢出',{tag:'@responsive'},async({page},info)=>{
 const {create,detail}=await fixture(page),r=await create('直接交付布局');
 for(const state of ['in_progress','completed']){
  const current=await detail(r.id);const response=await page.request.post('/api/requirements/'+r.id+(state==='in_progress'?'/start':'/complete'),{data:{expectedVersion:current.version}});expect(response.ok(),await response.text()).toBe(true);
  for(const viewport of [info.project.use.viewport!,{width:390,height:844}]){
   await page.setViewportSize(viewport);await page.goto('/requirements/'+r.id);const root=page.locator('.modal-card-workspace[role=dialog]');await expect(root).toBeVisible();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(await root.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);await page.screenshot({path:info.outputPath(state+'-'+viewport.width+'.png'),animations:'disabled'});
  }
 }
});

async function fixture(page:Page){
 const response=await page.request.post('/api/login',{data:{username:'admin',password:'41_xc7q0qOjo4Inw!'}});expect(response.ok()).toBe(true);
 const session=await(await page.request.get('/api/session')).json();
 const p=await(await page.request.post('/api/projects',{data:{name:'交付回归'+Date.now()}})).json();
 const owner=await(await page.request.post('/api/people',{data:{projectId:p.id,name:'执行回归'+Date.now()}})).json();
 const create=async(title:string)=>{const r=await page.request.post('/api/requirements',{data:{projectId:p.id,title,ownerId:owner.id}});expect(r.ok(),await r.text()).toBe(true);return await r.json() as Requirement;};
 await page.addInitScript(({id,account})=>localStorage.setItem('project-manage:selected-project:'+account,id),{id:p.id,account:session.accountId});
 return {projectId:p.id,owner,create,detail:async(id:string)=>await(await page.request.get('/api/requirements/'+id)).json() as Requirement};
}
test('无工作项需求可直接更新并完成，不再经过验收',async({page})=>{
 const {create,detail}=await fixture(page),r=await create('直接交付检查');
 await page.goto('/requirements/'+r.id);await expect(page.getByRole('button',{name:'增加进展',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'开始需求',exact:true}).click();
 await expect(page.locator('.modal-card:not(.modal-card-workspace)[role=dialog]')).toHaveCount(0);await page.getByRole('button',{name:'更新进度',exact:true}).click();
 await page.getByLabel('需求完成度').fill('30');await page.getByLabel('执行说明').fill('接口已完成三成');await page.getByRole('dialog',{name:'更新进度',exact:true}).getByRole('button',{name:'更新进度',exact:true}).click();await expect(page.locator('.modal-card:not(.modal-card-workspace)[role=dialog]')).toHaveCount(0);
 expect((await detail(r.id)).progress).toBe(30);expect((await detail(r.id)).workItems).toHaveLength(0);
 await page.getByRole('button',{name:'完成需求',exact:true}).click();await expect(page.locator('.modal-card:not(.modal-card-workspace)[role=dialog]')).toHaveCount(0);
 const completed=await detail(r.id);expect(completed).toMatchObject({status:'completed',progress:100,acceptedAt:null});
 await page.goto('/?'+new URLSearchParams({projectId:r.projectId,scopeType:'unphased',scopeId:r.featureId!,workspaceView:'list'}));await expect(page.locator('[data-object-id="'+r.id+'"]')).toContainText('已完成');
 await page.goto('/requirements/'+r.id);await expect(page.getByRole('button',{name:'确认验收',exact:true})).toHaveCount(0);

});
test('进行中的直接需求添加工作项后保留30%基线',async({page})=>{
 const {create,detail}=await fixture(page),r=await create('剩余工作拆分');
 await page.request.post('/api/requirements/'+r.id+'/start',{data:{expectedVersion:r.version}});let current=await detail(r.id);
 await page.request.post('/api/requirements/'+r.id+'/progress',{data:{expectedVersion:current.version,requirementPercent:30,content:'前期完成'}});
 await page.goto('/requirements/'+r.id);await page.getByRole('tab',{name:/^工作项/}).click();const root=page.locator('.modal-card-workspace[role=dialog]');
 for(const title of ['剩余开发','剩余验证']){await root.getByRole('button',{name:'添加工作项',exact:true}).click();const form=root.getByRole('form',{name:'新增工作项'});await form.getByLabel('新工作项名称',{exact:true}).fill(title);await form.getByLabel('变更说明（可选）').fill('拆分剩余工作');await form.getByRole('button',{name:'保存工作项',exact:true}).click();await expect(form).toHaveCount(0);await expect.poll(async()=>(await detail(r.id)).workItems.length).toBe(title==='剩余开发'?1:2);}
 current=await detail(r.id);expect(current.workItems).toHaveLength(2);expect(current.progress).toBe(30);expect(current.splitBaseProgress).toBe(30);
 await page.reload();await expect(page.locator('.work-arrangement-row')).toHaveCount(2);
});
test('需求清单批量选择提供归属整理，不恢复旧交付范围',async({page})=>{
 const {create}=await fixture(page),a=await create('整理一'),b=await create('整理二');await page.goto('/?'+new URLSearchParams({projectId:a.projectId,scopeType:'unphased',scopeId:a.featureId!,workspaceView:'list'}));
 for(const item of [a,b])await page.getByLabel('选择'+item.title,{exact:true}).check();
 await expect(page.getByRole('button',{name:'调整归属…',exact:true})).toBeVisible();await expect(page.getByText('交付范围',{exact:true})).toHaveCount(0);
});
test('普通新增未选流程直接执行，不自动创建工作项',async({page})=>{
 const {projectId}=await fixture(page);await page.goto('/requirements');await page.getByRole('button',{name:'新建需求',exact:true}).click();
 await page.getByRole('dialog').getByLabel('需求标题').fill('表单直接需求');await page.getByRole('button',{name:/流程与排期/}).click();await chooseOption(page.getByRole('combobox',{name:'流程设计',exact:true}), '');await page.getByRole('button',{name:'创建需求',exact:true}).click();await expect(page.locator('.modal-card:not(.modal-card-workspace)[role=dialog]')).toHaveCount(0);
 const rs=await(await page.request.get('/api/requirements?projectId='+projectId)).json() as Requirement[];expect(rs.find(r=>r.title==='表单直接需求')?.workItems).toHaveLength(0);
});

test('详情移除通用进展；工作项入口实际更新所选工作项并汇总需求',async({page})=>{
 const {projectId,owner,detail}=await fixture(page);
 const created=await page.request.post('/api/requirements',{data:{projectId,title:'工作项进度归属检查',ownerId:owner.id}});
 expect(created.ok()).toBe(true);let r=await created.json() as Requirement;
 for(const title of ['当前工作','其他工作']){
  const response=await page.request.post('/api/requirements/'+r.id+'/work-items',{data:{expectedVersion:r.version,title,ownerId:owner.id,plannedStart:'2026-09-01',plannedEnd:'2026-09-10'}});
  expect(response.ok(),await response.text()).toBe(true);r=await detail(r.id);
 }
 const first=r.workItems[0];expect((await page.request.post('/api/work-items/'+first.id+'/start',{data:{expectedVersion:first.version}})).ok()).toBe(true);
 await page.goto('/requirements/'+r.id);
 await expect(page.locator('.requirement-overview')).toHaveCount(1);
 await expect(page.getByRole('button',{name:'增加进展',exact:true})).toHaveCount(0);
 await page.getByRole('tab',{name:/^工作项/}).click();await page.locator('[data-work-id="'+first.id+'"]').getByRole('button',{name:'更新 '+first.title+' 进度',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'更新工作项进度',exact:true});
 await expect(dialog.getByRole('combobox')).toHaveCount(0);
 await expect(dialog.locator('.progress-item-context')).toContainText(first.title);
 await dialog.getByRole('spinbutton').fill('60');await dialog.getByRole('textbox',{name:/^说明/}).fill('完成当前工作六成');
 await dialog.getByRole('button',{name:'记录进展',exact:true}).click();await expect(dialog).toHaveCount(0);
 r=await detail(r.id);expect(r.workItems.find(w=>w.id===first.id)?.progress).toBe(60);expect(r.workItems.find(w=>w.id!==first.id)?.progress).toBe(0);expect(r.progress).toBe(30);
 expect(r.progressUpdates?.some(e=>e.workItemId===first.id&&e.workItemPercent===60&&e.eventType==='progress')).toBe(true);
 await expect(page.locator('[data-work-id="'+first.id+'"]')).toContainText('60%');
 await page.getByRole('tab',{name:'记录',exact:true}).click();await expect(page.locator('.progress-record-meta').filter({hasText:'需求总进度30%'})).toBeVisible();
 await page.reload();await expect(page.locator('.progress-record-meta').filter({hasText:'需求总进度30%'})).toBeVisible();
});
