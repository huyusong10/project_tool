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
 const dialog=page.getByRole('dialog',{name:'预测依据与阻塞协调',exact:true});await expect(dialog).toContainText('设计');
 await dialog.getByRole('checkbox',{name:'核对剩余工作，不修改完成度或已确认计划'}).check();await dialog.getByLabel('剩余工作日',{exact:true}).fill('2');await dialog.getByRole('button',{name:'加入草稿并预览全部修改'}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await page.getByRole('checkbox',{name:'已核对本次及已有草稿，整批保存'}).check();await page.getByRole('button',{name:'确认保存全部修改'}).click();await expect(dialog).toHaveCount(0);
 const saved=(await detail(r.id)).workItems[0];expect(saved.forecastReview?.remainingDays).toBe(2);expect(saved.progress).toBe(0);expect(saved.plannedEnd).toBe(r.workItems[0].plannedEnd);
});
test('名称草稿允许其他需求执行，返回后保留名称和撤销历史；设置在原窗口保存全部草稿',async({page},info)=>{
 const {a,b,detail}=await fixture(page);await page.goto('/paths?pathScope=all');await ready(page);await page.getByLabel('编辑画布',{exact:true}).click();
 await page.locator('.react-flow__node[data-id="'+a.id+'"] .dependency-card').click();await page.getByLabel('元素名称').fill('接口交付草稿');await page.getByLabel('元素名称').blur();await expect(page.locator('[data-draft-stored="true"]')).toBeVisible();
 await page.goto('/requirements/'+b.id);await page.getByRole('button',{name:'开始需求',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'开始需求',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect((await detail(b.id)).status).toBe('in_progress');expect((await detail(a.id)).title).toBe(a.title);
 await page.goto('/paths?pathScope=all');await ready(page);await expect(page.locator('.react-flow__node[data-id="'+a.id+'"]')).toContainText('接口交付草稿');await page.getByLabel('撤销',{exact:true}).click();await expect(page.locator('.react-flow__node[data-id="'+a.id+'"]')).not.toContainText('草稿');await page.getByLabel('重做',{exact:true}).click();await expect(page.locator('.react-flow__node[data-id="'+a.id+'"]')).toContainText('接口交付草稿');await expect(page.locator('[data-draft-stored="true"]')).toBeVisible();
 await page.goto('/requirements/'+b.id);await page.getByRole('button',{name:'交付设置',exact:true}).click();
 await page.getByRole('button',{name:'加入草稿并预览',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog).toContainText('接口交付草稿');expect((await detail(a.id)).title).toBe(a.title);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:info.outputPath('batch-review-390.png')});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await page.getByRole('checkbox',{name:'已核对本次及已有草稿，整批保存'}).check();await page.getByRole('button',{name:'确认保存全部修改',exact:true}).click();await expect(dialog).toHaveCount(0);expect((await detail(a.id)).title).toBe('接口交付草稿');expect((await detail(b.id)).status).toBe('in_progress');
});
test('核对剩余工期和确认项目承诺不改变进度或计划，响应丢失使用原回执',async({page},info)=>{
 const {a,project,detail}=await fixture(page);await page.goto('/requirements/'+a.id);await page.getByRole('button',{name:'预测依据与阻塞协调',exact:true}).click();
 await page.getByRole('checkbox',{name:'核对剩余工作，不修改完成度或已确认计划'}).check();await page.getByLabel('剩余工作日',{exact:true}).fill('4');await page.getByRole('button',{name:'加入草稿并预览全部修改'}).click();await expect(page.getByRole('dialog')).toContainText('剩余工作日 4');
 expect((await detail(a.id)).forecastReview).toBeNull();await page.getByRole('checkbox',{name:'已核对本次及已有草稿，整批保存'}).check();await page.getByRole('button',{name:'确认保存全部修改'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 expect((await detail(a.id)).forecastReview?.remainingDays).toBe(4);expect((await detail(a.id)).progress).toBe(0);expect((await detail(a.id)).plannedEnd).toBeNull();
 const confirmedReview=(await detail(a.id)).forecastReview;await page.getByRole('button',{name:'交付设置',exact:true}).click();await page.getByLabel('验收人',{exact:true}).selectOption(a.ownerId!);await page.getByRole('button',{name:'加入草稿并预览',exact:true}).click();await page.getByRole('checkbox',{name:'已核对本次及已有草稿，整批保存'}).check();await page.getByRole('button',{name:'确认保存全部修改'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect((await detail(a.id)).forecastReview).toEqual(confirmedReview);
 await page.goto('/paths');await ready(page);await page.getByRole('button',{name:'交付承诺',exact:true}).click();await page.getByRole('button',{name:'预览交付承诺及全部草稿'}).click();await expect(page.getByRole('dialog')).toContainText('确认项目整体交付承诺');
 expect(await(await page.request.get('/api/projects/'+project.id+'/delivery-commitments')).json()).toEqual([]);await page.screenshot({path:info.outputPath('commitment-preview.png')});
 await page.route('**/dependency-changes/apply',async route=>{const response=await route.fetch();expect(response.ok()).toBe(true);await route.abort('failed');});
 await page.getByRole('checkbox',{name:'已核对本次及已有草稿，整批保存'}).check();await page.getByRole('button',{name:'确认保存全部修改'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(await(await page.request.get('/api/projects/'+project.id+'/delivery-commitments')).json()).toHaveLength(1);await page.reload();await ready(page);await page.getByRole('button',{name:'交付承诺',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('首次确认');await expect(page.getByRole('dialog')).toContainText('不可计算');
});
