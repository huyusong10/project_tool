import {chooseOption} from './select-helper';
import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import type {Requirement} from '../../src/client/types';

async function fixture(page:Page){
 const login=await page.request.post('/api/login',{data:{username:'admin',password:'41_xc7q0qOjo4Inw!'}});expect(login.ok()).toBe(true);
 const session=await login.json(),project=await(await page.request.post('/api/projects',{data:{name:'日常操作 '+Date.now()}})).json();
 const person=await(await page.request.post('/api/people',{data:{projectId:project.id,name:'负责人 '+Date.now()}})).json();
 await page.addInitScript(({accountId,projectId})=>localStorage.setItem('project-manage:selected-project:'+accountId,projectId),{accountId:session.accountId,projectId:project.id});
 const create=async(title:string,ownerId?:string)=>(await page.request.post('/api/requirements',{data:{projectId:project.id,title,ownerId}})).json() as Promise<Requirement>;
 const detail=async(id:string)=>(await page.request.get('/api/requirements/'+id)).json() as Promise<Requirement>;
 return {project,person,create,detail};
}

test('未分配需求在当前入口选择负责人并开始，失败保留选择',async({page})=>{
 const {person,create,detail}=await fixture(page),r=await create('无需跳转补人员');
 let calls=0;
 await page.route('**/api/requirements/'+r.id+'/start',async route=>{
  calls++;if(calls===1)return route.fulfill({status:400,json:{error:'模拟校验失败',code:'VALIDATION_ERROR'}});return route.continue();
 });
 await page.goto('/requirements/'+r.id);await page.getByRole('button',{name:'开始需求',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'选择负责人并开始'});await chooseOption(dialog.getByLabel('需求负责人',{exact:true}), person.id);
 await dialog.getByRole('button',{name:'开始',exact:true}).click();await expect(dialog).toContainText('模拟校验失败');
 await expect(dialog.getByLabel('需求负责人',{exact:true})).toContainText(person.name);expect((await detail(r.id)).ownerId).toBeNull();
 await dialog.getByRole('button',{name:'开始',exact:true}).click();await expect(dialog).not.toBeVisible();
 await expect.poll(async()=>(await detail(r.id)).status).toBe('in_progress');expect((await detail(r.id)).ownerId).toBe(person.id);expect(calls).toBe(2);
});

test('工作项补选人员后一次开始，完成说明可留空；同帧确认只提交一次',async({page})=>{
 const {person,create,detail}=await fixture(page),r=await create('工作项执行');
 const response=await page.request.post('/api/requirements/'+r.id+'/work-items',{data:{title:'实际工作',expectedVersion:r.version}});expect(response.ok()).toBe(true);
 const item=await response.json();let completeCalls=0;
 await page.route('**/api/work-items/'+item.id+'/complete',async route=>{completeCalls++;return route.continue();});
 await page.goto('/requirements/'+r.id);await page.getByRole('tab',{name:/^工作项/}).click();await page.getByRole('button',{name:'开始',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'选择负责人并开始'});
 await chooseOption(dialog.getByLabel('需求负责人',{exact:true}), person.id);await chooseOption(dialog.getByLabel('工作项负责人',{exact:true}), person.id);
 await dialog.getByRole('button',{name:'开始',exact:true}).click();await expect(dialog).not.toBeVisible();
 await expect.poll(async()=>(await detail(r.id)).workItems[0].status).toBe('in_progress');
 await page.getByRole('button',{name:'完成',exact:true}).click();
 await page.getByRole('button',{name:'确认完成',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click();});
 await expect.poll(async()=>(await detail(r.id)).status).toBe('completed');expect(completeCalls).toBe(1);await expect(page.getByRole('button',{name:'确认完成',exact:true})).toHaveCount(0);await expect(page.locator('.modal-card-workspace[role=dialog]')).toHaveCount(1);
});

test('执行中新增工作项只填名称，编辑名称无需原因',async({page})=>{
 const {person,create,detail}=await fixture(page),r=await create('执行中设置',person.id);
 await page.request.post('/api/requirements/'+r.id+'/start',{data:{expectedVersion:r.version}});
 await page.goto('/requirements/'+r.id);await page.getByRole('tab',{name:/^工作项/}).click();
 const dialog=page.locator('.modal-card-workspace[role=dialog]');
 await dialog.getByRole('button',{name:'添加工作项',exact:true}).click();const form=dialog.getByRole('form',{name:'新增工作项'});
 await form.getByLabel('新工作项名称',{exact:true}).fill('补充验证');await form.getByRole('button',{name:'保存工作项',exact:true}).click();
 await expect(form).toHaveCount(0);await expect.poll(async()=>(await detail(r.id)).workItems.length).toBe(1);
 await dialog.locator('.detail-work-row-title').click();await dialog.getByRole('tab',{name:'资料',exact:true}).click();
 await dialog.getByRole('button',{name:/工作项名称：补充验证/}).click();await page.getByLabel('工作项名称',{exact:true}).fill('接口验证');await page.getByLabel('工作项名称',{exact:true}).press('Enter');
 await expect.poll(async()=>(await detail(r.id)).workItems[0].title).toBe('接口验证');await expect(page.getByLabel('调整原因',{exact:true})).toHaveCount(0);
});

test('问题选择解决立即生效，无说明仍记录事件且防止重复提交',async({page})=>{
 const {project}=await fixture(page);
 const created=await page.request.post('/api/issues',{data:{projectId:project.id,title:'不强制填说明'}});expect(created.ok()).toBe(true);const issue=await created.json();
 let requests=0;await page.route('**/api/issues/'+issue.id+'/resolve',async route=>{requests++;return route.continue();});
 await page.goto('/issues?issueId='+issue.id);await page.locator('.issue-settings-summary .issue-status-trigger').click();
 await page.locator('.issue-status-popover').getByRole('button',{name:/确认解决/}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click();});
 await expect(page.locator('.issue-settings-summary .issue-status-trigger')).toContainText('已解决');
 const saved=await(await page.request.get('/api/issues/'+issue.id)).json();expect(saved.updates[0].content).toBe('问题已解决');expect(requests).toBe(1);await expect(page.getByRole('button',{name:'确认变更',exact:true})).toHaveCount(0);
});

test('问题状态操作浮层在矩阵与窄屏内完整显示',{tag:'@responsive'},async({page})=>{
 const {project}=await fixture(page),response=await page.request.post('/api/issues',{data:{projectId:project.id,title:'状态浮层布局'}});
 expect(response.ok()).toBe(true);const issue=await response.json();
 for(const viewport of [page.viewportSize()!,{width:390,height:844}]){
  await page.setViewportSize(viewport);await page.goto('/issues?issueId='+issue.id);
  await page.locator('.issue-settings-summary .issue-status-trigger').click();
  const popup=page.locator('.issue-status-popover');await expect(popup.getByRole('button',{name:/确认解决/})).toBeVisible();
  const box=(await popup.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x+box.width).toBeLessThanOrEqual(viewport.width);expect(box.y+box.height).toBeLessThanOrEqual(viewport.height);
  await page.keyboard.press('Escape');await expect(popup).toBeHidden();
 }
});
