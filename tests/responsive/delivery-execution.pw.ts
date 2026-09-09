import {test,expect,type Page} from '@playwright/test';
import type {Requirement} from '../../src/client/types';

async function fixture(page:Page){
 const response=await page.request.post('/api/login',{data:{username:'admin',password:'41_xc7q0qOjo4Inw!'}});expect(response.ok()).toBe(true);
 const session=await(await page.request.get('/api/session')).json();
 const p=await(await page.request.post('/api/projects',{data:{name:'交付回归'+Date.now()}})).json();
 const owner=await(await page.request.post('/api/people',{data:{projectId:p.id,name:'执行回归'+Date.now()}})).json();
 const create=async(title:string)=>{const r=await page.request.post('/api/requirements',{data:{projectId:p.id,title,executionMode:'direct',ownerId:owner.id}});expect(r.ok()).toBe(true);return await r.json() as Requirement;};
 await page.addInitScript(({id,account})=>localStorage.setItem('project-manage:selected-project:'+account,id),{id:p.id,account:session.accountId});
 return {projectId:p.id,owner,create,detail:async(id:string)=>await(await page.request.get('/api/requirements/'+id)).json() as Requirement};
}
test('直接执行无需工作项，详情执行到验收；列表和路径的优先级一致',async({page},info)=>{
 const {create,detail,projectId}=await fixture(page),r=await create('直接交付检查');
 await page.goto('/requirements/'+r.id);await expect(page.getByRole('button',{name:'增加进展',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'开始需求',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'开始需求',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);await page.getByRole('button',{name:'更新进度',exact:true}).click();
 await page.getByLabel('需求完成度').fill('30');await page.getByLabel('执行说明').fill('接口已完成三成');await page.getByRole('dialog').getByRole('button',{name:'更新进度',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 expect((await detail(r.id)).progress).toBe(30);expect((await detail(r.id)).workItems).toHaveLength(0);await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);await page.setViewportSize({width:1920,height:1080});
 await page.getByRole('button',{name:'提交验收',exact:true}).click();await page.getByLabel('执行说明').fill('交付材料已核对');await page.getByRole('dialog').getByRole('button',{name:'提交验收',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 const pending=await detail(r.id);expect(pending.status).toBe('pending_acceptance');expect(pending.acceptedAt).toBeNull();
 await page.goto('/requirements');await expect(page.locator('tbody tr').filter({hasText:r.title})).toContainText(pending.processingPriority!);
 const path=await(await page.request.get('/api/projects/'+projectId+'/path-analysis')).json();expect(path.risks[r.id].processingPriority).toBe(pending.processingPriority);
 await page.goto('/requirements/'+r.id);await page.getByRole('button',{name:'确认验收',exact:true}).click();await page.getByLabel('执行说明').fill('验收测试通过');await page.getByRole('dialog').getByRole('button',{name:'确认验收',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect((await detail(r.id)).acceptedAt).toBeTruthy();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:info.outputPath('direct-acceptance-390.png')});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
test('拆分进入共享草稿；离开、刷新、恢复、保存后保留30%基线',async({page},info)=>{
 const {create,detail}=await fixture(page),r=await create('剩余工作拆分');
 await page.request.post('/api/requirements/'+r.id+'/start',{data:{expectedVersion:r.version}});let current=await detail(r.id);
 await page.request.post('/api/requirements/'+r.id+'/progress',{data:{expectedVersion:current.version,requirementPercent:30,content:'前期完成'}});
 await page.goto('/requirements/'+r.id);await page.getByRole('button',{name:'拆分剩余工作',exact:true}).click();await page.getByLabel('剩余工作项').fill('剩余开发\n剩余验证');await page.getByRole('button',{name:'加入草稿并预览',exact:true}).click();
 await expect(page.locator('[data-layout-ready="true"]')).toBeVisible();expect((await detail(r.id)).workItems).toHaveLength(0);
 await page.goto('/requirements/'+r.id);await page.getByRole('button',{name:'更新进度',exact:true}).click();await page.getByLabel('执行说明').fill('不应与草稿混写');await page.getByRole('dialog').getByRole('button',{name:'更新进度',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('未保存业务草稿');
 await page.goto('/requirements/'+r.id+'?view=path');await expect(page.locator('[data-layout-ready="true"]')).toBeVisible();await page.reload();await expect(page.locator('[data-layout-ready="true"]')).toBeVisible();await expect(page.locator('.graph-toolbar')).toContainText('未保存');
 await page.getByRole('button',{name:'保存修改',exact:true}).click();await expect.poll(async()=> (await detail(r.id)).executionMode).toBe('work_items');current=await detail(r.id);expect(current.workItems).toHaveLength(2);expect(current.progress).toBe(30);
 await page.screenshot({path:info.outputPath('split-path.png')});
});
test('范围批量修改只进入草稿，筛选保持条件，保存后正式范围更新',async({page})=>{
 const {create,detail}=await fixture(page),a=await create('范围一'),b=await create('范围二');await page.goto('/requirements');
 for(const title of [a.title,b.title])await page.locator('tbody tr').filter({hasText:title}).getByRole('checkbox').check();
 await page.getByRole('button',{name:'调整所选交付范围'}).click();await page.getByRole('dialog').getByLabel('交付范围',{exact:true}).selectOption('candidate');await page.getByRole('button',{name:'加入草稿并预览',exact:true}).click();
 await expect(page.locator('[data-layout-ready="true"]')).toBeVisible();expect((await detail(a.id)).deliveryScope).toBe('committed');
 await page.getByRole('button',{name:'保存修改',exact:true}).click();await expect.poll(async()=> (await detail(a.id)).deliveryScope).toBe('candidate');
 await page.goto('/requirements?deliveryScope=candidate');await expect(page.locator('tbody tr')).toHaveCount(2);await page.reload();await expect(page.getByLabel('交付范围筛选')).toHaveValue('candidate');
});
test('普通新增未选流程直接执行，选择流程则实例化未排期工作',async({page})=>{
 const {projectId}=await fixture(page);await page.goto('/requirements');await page.getByRole('button',{name:'新建需求',exact:true}).click();
 await page.getByRole('dialog').getByLabel('需求标题').fill('表单直接需求');await page.getByRole('button',{name:/流程与排期/}).click();await page.getByRole('combobox',{name:'流程设计',exact:true}).selectOption('');await page.getByRole('button',{name:'创建需求',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 const rs=await(await page.request.get('/api/requirements?projectId='+projectId)).json() as Requirement[];expect(rs.find(r=>r.title==='表单直接需求')?.executionMode).toBe('direct');
 expect(rs.find(r=>r.title==='表单直接需求')?.workItems).toHaveLength(0);
});

test('详情移除通用进展；工作项入口实际更新所选工作项并汇总需求',async({page})=>{
 const {projectId,owner,detail}=await fixture(page);
 const created=await page.request.post('/api/requirements',{data:{projectId,title:'工作项进度归属检查',executionMode:'work_items',ownerId:owner.id}});
 expect(created.ok()).toBe(true);let r=await created.json() as Requirement;
 for(const title of ['当前工作','其他工作']){
  const response=await page.request.post('/api/requirements/'+r.id+'/work-items',{data:{expectedVersion:r.version,title,ownerId:owner.id,plannedStart:'2026-09-01',plannedEnd:'2026-09-10'}});
  expect(response.ok(),await response.text()).toBe(true);r=await detail(r.id);
 }
 const first=r.workItems[0];expect((await page.request.post('/api/work-items/'+first.id+'/start',{data:{expectedVersion:first.version}})).ok()).toBe(true);
 await page.goto('/requirements/'+r.id);
 await expect(page.locator('.requirement-overview')).toHaveCount(1);
 await expect(page.getByRole('button',{name:'增加进展',exact:true})).toHaveCount(0);
 await page.locator('.requirement-gantt-grid button.gantt-progress-marker').click();
 const dialog=page.getByRole('dialog',{name:'更新工作项进度',exact:true});
 await expect(dialog.getByRole('combobox')).toHaveCount(0);
 await expect(dialog.locator('.progress-item-context')).toContainText(first.title);
 await dialog.getByRole('spinbutton').fill('60');await dialog.getByLabel('具体进展',{exact:true}).fill('完成当前工作六成');
 await dialog.getByRole('button',{name:'记录进展',exact:true}).click();await expect(dialog).toHaveCount(0);
 r=await detail(r.id);expect(r.workItems.find(w=>w.id===first.id)?.progress).toBe(60);expect(r.workItems.find(w=>w.id!==first.id)?.progress).toBe(0);expect(r.progress).toBe(30);
 expect(r.progressUpdates?.some(e=>e.workItemId===first.id&&e.workItemPercent===60&&e.eventType==='progress')).toBe(true);
 await expect(page.locator('.requirement-overview .detail-kpis').first()).toContainText('30%');
 await page.reload();await expect(page.locator('.requirement-overview')).toHaveCount(1);await expect(page.locator('.requirement-overview .detail-kpis').first()).toContainText('30%');
});
