import {test,expect,type Page} from '@playwright/test';
import type {Requirement} from '../../src/client/types';
async function fixture(page:Page){
 const login=await page.request.post('/api/login',{data:{username:'admin',password:'41_xc7q0qOjo4Inw!'}});expect(login.ok()).toBe(true);
 const session=await(await page.request.get('/api/session')).json(),project=await(await page.request.post('/api/projects',{data:{name:'承诺验证'+Date.now()}})).json();
 const owner=await(await page.request.post('/api/people',{data:{projectId:project.id,name:'核对人员'+Date.now()}})).json();
 const create=async(title:string)=>await(await page.request.post('/api/requirements',{data:{projectId:project.id,title,ownerId:owner.id,executionMode:'direct'}})).json() as Requirement;
 const a=await create('接口交付'),b=await create('订单交付');
 await page.addInitScript(({id,account})=>localStorage.setItem('project-manage:selected-project:'+account,id),{id:project.id,account:session.accountId});
 const detail=async(id:string)=>await(await page.request.get('/api/requirements/'+id)).json() as Requirement;
 return {a,b,project,detail};
}
const ready=(page:Page)=>expect(page.locator('[data-layout-ready="true"]')).toBeVisible({timeout:20000});
test('工作项核对放在更多菜单，不挤占甘特行；窄屏保存后保留完成度和计划',async({page})=>{
 const {a,project,detail}=await fixture(page);
 const created=await page.request.post('/api/requirements',{data:{projectId:project.id,title:'分解核对',ownerId:a.ownerId,executionMode:'work_items'}});expect(created.ok()).toBe(true);let r=await created.json() as Requirement;
 for(const title of ['设计','开发']){expect((await page.request.post('/api/requirements/'+r.id+'/work-items',{data:{expectedVersion:r.version,title,ownerId:a.ownerId}})).ok()).toBe(true);r=await detail(r.id);}
 await page.goto('/requirements/'+r.id);
 await expect(page.getByRole('button',{name:'预测依据与阻塞协调',exact:true})).toHaveCount(0);
 const more=page.getByRole('button',{name:'更多工作项操作',exact:true});await expect(more).toHaveCount(2);
 const rects=await more.evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom}}));expect(rects[0].bottom).toBeLessThanOrEqual(rects[1].top);
 await page.setViewportSize({width:390,height:844});await more.first().click();await page.getByRole('button',{name:'预测依据与阻塞协调',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'核对预测',exact:true});await expect(dialog).toContainText('设计');
 await dialog.getByLabel('剩余工作日',{exact:true}).fill('2');await dialog.getByRole('button',{name:'保存',exact:true}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await expect(dialog).toHaveCount(0);
 const saved=(await detail(r.id)).workItems[0];expect(saved.forecastReview?.remainingDays).toBe(2);expect(saved.progress).toBe(0);expect(saved.plannedEnd).toBe(r.workItems[0].plannedEnd);
});
test('名称草稿允许其他需求执行，返回后保留名称和撤销历史；设置在原窗口保存全部草稿',async({page},info)=>{
 const {a,b,detail}=await fixture(page);await page.goto('/paths?pathScope=all');await ready(page);await page.getByLabel('编辑画布',{exact:true}).click();
 await page.locator('.react-flow__node[data-id="'+a.id+'"] .dependency-card').click();await page.getByLabel('元素名称').fill('接口交付草稿');await page.getByLabel('元素名称').blur();await expect(page.locator('[data-draft-stored="true"]')).toBeVisible();
 await page.goto('/requirements/'+b.id);await page.getByRole('button',{name:'开始需求',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'开始需求',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect((await detail(b.id)).status).toBe('in_progress');expect((await detail(a.id)).title).toBe(a.title);
 await page.goto('/paths?pathScope=all');await ready(page);await expect(page.locator('.react-flow__node[data-id="'+a.id+'"]')).toContainText('接口交付草稿');await page.getByLabel('撤销',{exact:true}).click();await expect(page.locator('.react-flow__node[data-id="'+a.id+'"]')).not.toContainText('草稿');await page.getByLabel('重做',{exact:true}).click();await expect(page.locator('.react-flow__node[data-id="'+a.id+'"]')).toContainText('接口交付草稿');await expect(page.locator('[data-draft-stored="true"]')).toBeVisible();
 await page.goto('/requirements/'+b.id);await page.getByRole('button',{name:'交付设置',exact:true}).click();
 await page.getByRole('button',{name:'保存',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog).toContainText('接口交付草稿');expect((await detail(a.id)).title).toBe(a.title);
 await page.setViewportSize({width:390,height:844});await expect(dialog.getByRole('button',{name:'保存全部修改'})).toBeEnabled();await page.screenshot({path:info.outputPath('batch-review-390.png'),animations:'disabled'});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await page.getByRole('button',{name:'保存全部修改',exact:true}).click();await expect(dialog).toHaveCount(0);expect((await detail(a.id)).title).toBe('接口交付草稿');expect((await detail(b.id)).status).toBe('in_progress');
});
test('核对剩余工期和确认项目承诺不改变进度或计划，响应丢失使用原回执',async({page},info)=>{
 const {a,project,detail}=await fixture(page);await page.goto('/requirements/'+a.id);await page.getByRole('button',{name:'预测依据与阻塞协调',exact:true}).click();
 await page.getByLabel('剩余工作日',{exact:true}).fill('4');expect((await detail(a.id)).forecastReview).toBeNull();await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 expect((await detail(a.id)).forecastReview?.remainingDays).toBe(4);expect((await detail(a.id)).progress).toBe(0);expect((await detail(a.id)).plannedEnd).toBeNull();
 const confirmedReview=(await detail(a.id)).forecastReview;await page.getByRole('button',{name:'交付设置',exact:true}).click();await page.getByLabel('验收人',{exact:true}).selectOption(a.ownerId!);await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect((await detail(a.id)).forecastReview).toEqual(confirmedReview);
 await page.goto('/paths');await ready(page);await page.getByRole('button',{name:'交付承诺',exact:true}).click();await page.getByRole('button',{name:'预览交付承诺及全部草稿'}).click();await expect(page.getByRole('dialog')).toContainText('确认项目整体交付承诺');
 expect(await(await page.request.get('/api/projects/'+project.id+'/delivery-commitments')).json()).toEqual([]);await page.screenshot({path:info.outputPath('commitment-preview.png')});
 await page.route('**/dependency-changes/apply',async route=>{const response=await route.fetch();expect(response.ok()).toBe(true);await route.abort('failed');});
 await page.getByRole('button',{name:'保存全部修改'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(await(await page.request.get('/api/projects/'+project.id+'/delivery-commitments')).json()).toHaveLength(1);await page.reload();await ready(page);await page.getByRole('button',{name:'交付承诺',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('首次确认');await expect(page.getByRole('dialog')).toContainText('不可计算');
});

test('行动直接打开核对；只影响本需求时一次保存，失败保留输入',async({page},info)=>{
 const {a,detail}=await fixture(page);let applies=0;page.on('request',r=>{if(r.url().endsWith('/dependency-changes/apply'))applies++;});
 await page.goto('/requirements/'+a.id+'?action=forecast');const dialog=page.getByRole('dialog',{name:'核对预测'});await expect(dialog).toBeVisible();await expect(dialog.getByRole('checkbox')).toHaveCount(0);
 await dialog.getByLabel('剩余工作日',{exact:true}).fill('3');expect((await detail(a.id)).forecastReview).toBeNull();await dialog.getByRole('button',{name:'保存',exact:true}).click();await expect(dialog).toHaveCount(0);expect(applies).toBe(1);expect(page.url()).not.toContain('action=');
 await page.goto('/requirements/'+a.id+'?action=forecast');await dialog.getByLabel('剩余工作日',{exact:true}).fill('5');await page.route('**/dependency-changes/preview',r=>r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'测试校验失败'})}));await dialog.getByRole('button',{name:'保存',exact:true}).click();await expect(dialog.getByRole('alert')).toBeVisible();await expect(dialog.getByLabel('剩余工作日',{exact:true})).toHaveValue('5');expect(applies).toBe(1);await page.screenshot({path:info.outputPath('forecast-error-retains-input.png')});
});
test('预测影响后续需求时先展示整批影响，不提前写入',async({page})=>{
 const {a,b,project,detail}=await fixture(page);
 for(const r of [a,b])expect((await page.request.patch('/api/requirements/'+r.id,{data:{expectedVersion:r.version,durationDays:2}})).ok()).toBe(true);
 const graph=await(await page.request.get('/api/projects/'+project.id+'/path-analysis')).json();expect((await page.request.post('/api/projects/'+project.id+'/dependencies',{data:{expectedRevision:graph.revision,sourceRequirementId:a.id,targetRequirementId:b.id}})).ok()).toBe(true);
 let applies=0;page.on('request',r=>{if(r.url().endsWith('/dependency-changes/apply'))applies++;});
 await page.goto('/requirements/'+a.id+'?action=forecast');const dialog=page.getByRole('dialog');await dialog.getByLabel('剩余工作日',{exact:true}).fill('8');await dialog.getByRole('button',{name:'保存',exact:true}).click();await expect(dialog).toContainText(b.title);await expect(dialog.getByRole('button',{name:'保存全部修改'})).toBeEnabled();expect(applies).toBe(0);expect((await detail(a.id)).forecastReview).toBeNull();await dialog.getByRole('button',{name:'保存全部修改'}).click();await expect(dialog).toHaveCount(0);expect(applies).toBe(1);
});
test('后台检测更新概览，正在输入的估算和焦点保持不变',async({page})=>{
 const {a,detail}=await fixture(page);await page.clock.install();await page.goto('/requirements/'+a.id+'?action=forecast');const dialog=page.getByRole('dialog');const field=dialog.getByLabel('剩余工作日',{exact:true});await field.fill('7');
 const current=await detail(a.id);expect((await page.request.patch('/api/requirements/'+a.id,{data:{expectedVersion:current.version,title:'后台更新后的需求'}})).ok()).toBe(true);
 await page.clock.runFor(61000);await expect(page.locator('.topbar')).toContainText('后台更新后的需求');await expect(field).toHaveValue('7');await expect(field).toBeFocused();expect((await detail(a.id)).forecastReview).toBeNull();
});

test('后台改动同一估算时，旧表单不借用新版本覆盖，输入保留',async({page})=>{
 const {a,detail}=await fixture(page);await page.clock.install();await page.goto('/requirements/'+a.id+'?action=forecast');const dialog=page.getByRole('dialog');await dialog.getByLabel('剩余工作日',{exact:true}).fill('7');
 const current=await detail(a.id);expect((await page.request.patch('/api/requirements/'+a.id,{data:{expectedVersion:current.version,durationDays:4}})).ok()).toBe(true);await page.clock.runFor(61000);await dialog.getByRole('button',{name:'保存',exact:true}).click();await expect(dialog.getByRole('alert')).toBeVisible();await expect(dialog.getByLabel('剩余工作日',{exact:true})).toHaveValue('7');expect((await detail(a.id)).forecastReview).toBeNull();expect((await detail(a.id)).durationDays).toBe(4);await dialog.getByRole('button',{name:'已核对，保留输入'}).click();await dialog.getByRole('button',{name:'保存',exact:true}).click();await expect(dialog).toHaveCount(0);expect((await detail(a.id)).forecastReview?.remainingDays).toBe(7);
});

test('协调人从行动直接跟进，仅有说明和日期，不出现执行或估算入口',async({page})=>{
 const {a,project,detail}=await fixture(page);const person=await(await page.request.post('/api/people',{data:{projectId:project.id,name:'协调人员'+Date.now()}})).json();
 await page.request.post('/api/requirements/'+a.id+'/start',{data:{expectedVersion:a.version}});let r=await detail(a.id);expect((await page.request.post('/api/requirements/'+a.id+'/block',{data:{expectedVersion:r.version,reason:'等待环境',blockedCoordinatorId:person.id}})).ok()).toBe(true);
 expect((await page.request.post('/api/login',{data:{username:person.name,password:'888888'}})).ok()).toBe(true);expect((await page.request.post('/api/account/change-password',{data:{currentPassword:'888888',newPassword:'Followup-browser!2026'}})).ok()).toBe(true);
 const actions=await(await page.request.get('/api/action-items?projectId='+project.id)).json(),target=actions.items.find((i:{sourceId:string})=>i.sourceId===a.id).targetPath;expect(target).toContain('action=follow-up');await page.goto(target);const dialog=page.getByRole('dialog',{name:'跟进阻塞'});await expect(dialog).toBeVisible();await expect(dialog.getByLabel('剩余工作日',{exact:true})).toHaveCount(0);await expect(dialog.getByRole('button',{name:'解除阻塞'})).toHaveCount(0);
 await dialog.getByLabel('跟进说明').fill('环境负责人将在周五反馈');await dialog.getByLabel('下次核对日期').fill('2026-09-18');await dialog.getByRole('button',{name:'保存',exact:true}).click();await expect(dialog).toHaveCount(0);r=await detail(a.id);expect(r.status).toBe('blocked');expect(r.progressUpdates?.some(p=>p.content.includes('环境负责人将在周五反馈'))).toBe(true);
});
