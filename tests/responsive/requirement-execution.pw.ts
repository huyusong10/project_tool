import {expect,test,type Page} from '@playwright/test';
import {phaseFixture} from './phase-fixture';
import type {Requirement} from '../../src/client/types';

async function post(page:Page,url:string,data:unknown){const response=await page.request.post(url,{data});expect(response.ok(),await response.text()).toBe(true);return response.json();}
const row=(page:Page,id:string)=>page.locator('[data-row-id="'+id+'"]');
const panel=(page:Page)=>page.locator('.modal-card-workspace[role=dialog]');
const item=(page:Page,id:string)=>panel(page).locator('[data-work-id="'+id+'"]');
async function frame(page:Page,id:string){return row(page,id).locator('.workspace-row-label,.workspace-row-actions').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().toJSON()));}

test('折叠需求直接更新、完成和返工，图形草稿租约不屏蔽执行入口',async({page},info)=>{
 const f=await phaseFixture(page),session=await(await page.request.get('/api/session')).json();
 await page.addInitScript(({account,id})=>localStorage.setItem('pm-editor-lease:pm-graph-draft:'+account+':'+id,JSON.stringify({owner:'another-editor-tab',expires:Date.now()+120000})),{account:session.accountId,id:f.projectId});
 await page.goto('/execution');const requirement=row(page,f.testing.id),workId=f.testing.workItems[1].id;
 await expect(requirement.getByRole('button',{name:'展开 '+f.testing.title,exact:true})).toHaveAttribute('aria-expanded','false');await expect(row(page,workId)).toHaveCount(0);
 await expect(page.getByText('其他页面编辑中',{exact:true})).toBeVisible();
 const original=await frame(page,f.testing.id),grid=await page.getByRole('treegrid').boundingBox();
 await requirement.getByRole('button',{name:'更新进展',exact:true}).click();await expect(item(page,workId)).toBeVisible();expect(await frame(page,f.testing.id)).toEqual(original);expect(await page.getByRole('treegrid').boundingBox()).toEqual(grid);
 await item(page,workId).getByRole('button',{name:'更新 测试 进度',exact:true}).click();const progress=page.getByRole('region',{name:'更新工作项进度',exact:true});await progress.getByRole('spinbutton').fill('75');await progress.getByRole('textbox',{name:/^说明/}).fill('折叠需求更新');await progress.getByRole('button',{name:'记录进展',exact:true}).click();await expect(progress).toHaveCount(0);await expect(item(page,workId)).toContainText('75%');
 await panel(page).getByRole('button',{name:'关闭',exact:true}).click();await expect(requirement.locator('.workspace-row-progress')).toContainText('75%');expect(await frame(page,f.testing.id)).toEqual(original);await expect(row(page,workId)).toHaveCount(0);
 await requirement.getByRole('button',{name:'更新 '+f.testing.title+' 进展',exact:true}).click();await item(page,workId).getByRole('button',{name:'完成',exact:true}).click();await page.getByRole('button',{name:'确认完成',exact:true}).click();await expect(item(page,workId).getByRole('img',{name:'已完成',exact:true}).first()).toBeVisible();await panel(page).getByRole('button',{name:'关闭',exact:true}).click();await expect(requirement.getByRole('button',{name:'返工',exact:true})).toBeVisible();expect(await frame(page,f.testing.id)).toEqual(original);
 await requirement.getByRole('button',{name:'返工',exact:true}).click();const rework=page.getByRole('dialog',{name:'返工',exact:true});await rework.getByRole('checkbox',{name:'测试',exact:true}).check();await rework.getByRole('textbox',{name:'执行说明',exact:true}).fill('补测边界条件');await rework.getByRole('button',{name:'返工',exact:true}).click();await expect(rework).toHaveCount(0);await expect(requirement.getByRole('button',{name:'更新进展',exact:true})).toBeVisible();expect(await frame(page,f.testing.id)).toEqual(original);
 await page.screenshot({path:info.outputPath('collapsed-requirement-actions.png'),animations:'disabled'});
 await page.setViewportSize({width:390,height:844});await requirement.getByRole('button',{name:'更新进展',exact:true}).click();await expect(item(page,workId)).toBeVisible();expect(await panel(page).evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await item(page,workId).getByRole('button',{name:'更新 测试 进度',exact:true}).click();await expect(progress).toBeVisible();await page.keyboard.press('Escape');await expect(panel(page)).toBeVisible();await page.screenshot({path:info.outputPath('narrow-requirement-execution.png'),animations:'disabled'});await page.keyboard.press('Escape');await expect(panel(page)).toHaveCount(0);await expect(requirement.getByRole('button',{name:'更新进展',exact:true})).toBeFocused();
});

test('需求负责人操作本需求，执行人只操作分派工作，无关成员没有入口',async({page})=>{
 const f=await phaseFixture(page),other=await post(page,'/api/people',{projectId:f.projectId,name:'其他负责人 '+Date.now()}),reader=await post(page,'/api/people',{projectId:f.projectId,name:'无关成员 '+Date.now()});
 let mixed:Requirement=await post(page,'/api/requirements',{projectId:f.projectId,featureId:f.feature.id,ownerId:other.id,title:'仅参与开发的需求',templateId:f.testing.templateId,plannedStart:new Date().toISOString().slice(0,10)});
 const assigned=await page.request.patch('/api/work-items/'+mixed.workItems[0].id,{data:{expectedVersion:mixed.workItems[0].version,ownerId:f.testing.ownerId}});expect(assigned.ok(),await assigned.text()).toBe(true);mixed=await(await page.request.get('/api/requirements/'+mixed.id)).json();
 const unrelated:Requirement=await post(page,'/api/requirements',{projectId:f.projectId,featureId:f.feature.id,ownerId:other.id,title:'未参与需求',templateId:f.testing.templateId});
 const login=async(name:string)=>{await post(page,'/api/login',{username:name,password:'888888'});await post(page,'/api/account/change-password',{currentPassword:'888888',newPassword:'requirement-execution-test-password'});await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'progress',scopeType:'project'}));};
 await login(f.testing.ownerName!);
 await row(page,f.testing.id).getByRole('button',{name:'更新进展',exact:true}).click();await expect(panel(page).locator('[data-work-id]')).toHaveCount(2);await panel(page).getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('button',{name:'展开 未分派阶段',exact:true}).click();await row(page,mixed.id).getByRole('button',{name:'更新进展',exact:true}).click();await expect(panel(page).locator('[data-work-id]')).toHaveCount(2);await expect(item(page,mixed.workItems[1].id).getByRole('button',{name:'开始',exact:true})).toHaveCount(0);await expect(item(page,mixed.workItems[0].id)).toBeVisible();await item(page,mixed.workItems[0].id).getByRole('button',{name:'开始',exact:true}).click();await expect(item(page,mixed.workItems[0].id).getByRole('button',{name:'完成',exact:true})).toBeVisible();await panel(page).getByRole('button',{name:'关闭',exact:true}).click();
 await expect(row(page,unrelated.id).locator('.workspace-row-actions button')).toHaveCount(0);await expect(row(page,unrelated.id).locator('.workspace-requirement-progress')).toHaveCount(0);
 const denied=await page.request.post('/api/work-items/'+mixed.workItems[1].id+'/start',{data:{expectedVersion:mixed.workItems[1].version}});expect(denied.status()).toBe(403);
 await login(reader.name);await expect(row(page,f.testing.id)).toBeVisible();await expect(page.locator('.workspace-row-actions button')).toHaveCount(0);await expect(page.locator('.workspace-requirement-progress')).toHaveCount(0);
});

test('读取失败不使用旧资料操作，版本冲突保留更新输入',async({page})=>{
 const f=await phaseFixture(page);await page.goto('/execution');await row(page,f.testing.id).getByRole('button',{name:'更新进展',exact:true}).click();await expect(item(page,f.testing.workItems[1].id)).toBeVisible();await panel(page).getByRole('button',{name:'关闭',exact:true}).click();
 const endpoint='**/api/requirements/'+f.testing.id;
 await page.route(endpoint,route=>route.fulfill({status:503,json:{error:'暂时无法读取工作项'}}));await row(page,f.testing.id).getByRole('button',{name:'更新进展',exact:true}).click();await expect(panel(page)).toContainText('暂时无法读取工作项');await expect(panel(page).locator('[data-work-id]')).toHaveCount(0);await page.unroute(endpoint);await panel(page).getByRole('button',{name:'重新读取',exact:true}).click();await item(page,f.testing.workItems[1].id).getByRole('button',{name:'更新 测试 进度',exact:true}).click();
 const progress=page.getByRole('region',{name:'更新工作项进度',exact:true});await progress.getByRole('spinbutton').fill('80');await progress.getByRole('textbox',{name:/^说明/}).fill('保留我的更新说明');
 await post(page,'/api/requirements/'+f.testing.id+'/progress',{expectedVersion:f.testing.workItems[1].version,workItemId:f.testing.workItems[1].id,workItemPercent:75,content:'其他人先更新'});await progress.getByRole('button',{name:'记录进展',exact:true}).click();await expect(progress).toContainText('当前完成度 75%');await expect(progress.getByRole('textbox',{name:/^说明/})).toHaveValue('保留我的更新说明');await expect(progress.getByRole('spinbutton')).toHaveValue('80');
 expect((await(await page.request.get('/api/requirements/'+f.testing.id)).json()).workItems[1].progress).toBe(75);await progress.getByRole('button',{name:'记录进展',exact:true}).click();await expect(progress).toHaveCount(0);await expect(item(page,f.testing.workItems[1].id)).toContainText('80%');
});
