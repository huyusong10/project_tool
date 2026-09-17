import {closeGraphProperties,graphToolbar} from './graph-interactions';
import {chooseOption} from './select-helper';
import {expect,test,type Page} from '@playwright/test';
import {headerAction} from './topbar-helpers';
import type {Feature} from '../../src/shared/intake';
async function fixture(page:Page){
  const login=await page.request.post('/api/login',{data:{username:'admin',password:'41_xc7q0qOjo4Inw!'}});expect(login.ok()).toBe(true);const session=await login.json();
  const project=await(await page.request.post('/api/projects',{data:{name:'特性规划验证 '+Date.now()}})).json();
  const group=(await(await page.request.post('/api/projects/'+project.id+'/features',{data:{name:'权限管理',description:'持续完善组织协作中的授权与审计',sortOrder:0}})).json()).features[0] as Feature;
  const future=(await(await page.request.post('/api/projects/'+project.id+'/features',{data:{name:'远期探索',sortOrder:1}})).json()).features[1] as Feature;
  const req=await(await page.request.post('/api/requirements',{data:{projectId:project.id,title:'角色授权',featureId:group.id}})).json();
  await page.request.post('/api/requirements',{data:{projectId:project.id,title:'尚未整理的需求'}});
  await page.addInitScript(({accountId,projectId})=>localStorage.setItem('project-manage:selected-project:'+accountId,projectId),{accountId:session.accountId,projectId:project.id});
  await page.goto('/features');await expect(page.locator('.outline-title',{hasText:'权限管理'})).toBeVisible();return {projectId:project.id,group,future,session,req};
}
const featureRow=(page:Page,name:string)=>page.locator('.outline-table > tbody > tr').filter({has:page.locator('.outline-title',{hasText:name})});
const dialog=(page:Page)=>page.locator('.graph-detail, [role=dialog]').filter({visible:true}).last();
async function edit(page:Page){await featureRow(page,'权限管理').locator('.outline-title').click();await dialog(page).getByRole('button',{name:'更新评估',exact:true}).click();}
async function fill(page:Page){await page.getByLabel('大致预期',{exact:true}).fill('本季度具备试用条件');await page.getByLabel('进展简述',{exact:true}).fill('基础授权完成，继续补充审计');await chooseOption(page.getByLabel('判断',{exact:true}),'on_track');await page.getByLabel('原因或变化说明',{exact:true}).fill('复杂场景稍慢，暂不影响试用');}
const ready=(page:Page)=>expect(page.locator('[data-layout-ready="true"]')).toBeVisible({timeout:20000});

test('特性总览维护、独立评估、需求入口与首页空间',async({page},info)=>{
 const state=await fixture(page);await edit(page);await fill(page);await dialog(page).getByRole('button',{name:'保存评估',exact:true}).click();await expect(page.locator('.modal-card:not(.modal-card-workspace)[role=dialog]')).toHaveCount(0);await expect(dialog(page)).toContainText('基本符合');
 await dialog(page).getByRole('tab',{name:'交付范围',exact:true}).click();await expect(dialog(page).getByRole('button',{name:'角色授权',exact:true})).toBeVisible();await dialog(page).getByRole('button',{name:'关闭',exact:true}).first().click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('features.png'),fullPage:true,animations:'disabled'});await featureRow(page,'权限管理').locator('.outline-title').click();await dialog(page).getByRole('tab',{name:'交付范围',exact:true}).click();await dialog(page).getByRole('button',{name:'进入特性',exact:true}).click();await page.getByRole('button',{name:'展开全部',exact:true}).click();await expect(page).toHaveURL(new RegExp('featureId='+state.group.id));await expect(page.locator('.outline-table')).toContainText('角色授权');
 await page.goto('/');await expect(page.locator('.outline-table')).toBeVisible();
});
test('冲突保留评估输入并读取最新内容',async({page})=>{
 const state=await fixture(page);await edit(page);await fill(page);let intercept=true;
 await page.route('**/api/projects/'+state.projectId+'/features',async route=>{if(route.request().method()==='POST'&&intercept){intercept=false;const body=route.request().postDataJSON();expect((await page.request.post(route.request().url(),{data:{...body,name:'权限管理的新名称',overview:{...body.overview,expectation:'其他经理的新预期'}}})).ok()).toBe(true);}await route.continue();});
 await dialog(page).getByRole('button',{name:'保存评估',exact:true}).click();await expect(page.getByRole('heading',{name:'服务器上的最新资料'})).toBeVisible();await expect(page.getByLabel('大致预期',{exact:true})).toHaveValue('本季度具备试用条件');await expect(dialog(page)).toContainText('其他经理的新预期');await expect(dialog(page)).toContainText('权限管理的新名称');await expect(dialog(page).getByRole('button',{name:'保存评估',exact:true})).toBeDisabled();await dialog(page).getByRole('button',{name:'保留输入，按最新资料继续'}).click();await dialog(page).getByRole('button',{name:'保存评估',exact:true}).click();await expect(page.locator('.modal-card:not(.modal-card-workspace)[role=dialog]')).toHaveCount(0);await expect(page.locator('.outline-title',{hasText:'权限管理的新名称'})).toBeVisible();
});
test('响应丢失后刷新页面恢复输入，核对已生效且不重复保存',async({page})=>{
 const state=await fixture(page);await edit(page);await fill(page);let writes=0;
 await page.route('**/api/projects/'+state.projectId+'/features',async route=>{if(route.request().method()==='POST'){writes++;await route.fetch();await route.abort('connectionfailed');}else await route.continue();});
 await dialog(page).getByRole('button',{name:'保存评估',exact:true}).click();await expect(page.getByRole('button',{name:'读取最新资料',exact:true})).toBeVisible();await page.reload();await expect(page.getByLabel('大致预期',{exact:true})).toHaveValue('本季度具备试用条件');await expect(page.getByLabel('大致预期',{exact:true})).toHaveValue('本季度具备试用条件');await page.getByRole('button',{name:'读取最新资料',exact:true}).click();await page.getByRole('button',{name:'已核对，操作已生效',exact:true}).click();await expect(page.getByLabel('大致预期',{exact:true})).toHaveCount(0);expect(writes).toBe(1);
});
test('顶层特性图建立规划草稿、下钻并返回原选择',async({page},info)=>{
 const state=await fixture(page);await page.goto('/paths');await ready(page);await page.getByLabel('编辑画布',{exact:true}).click();await headerAction(page,'建立规划关系');await chooseOption(dialog(page).getByLabel('前置特性'),state.group.id);await chooseOption(dialog(page).getByLabel('后续特性'),state.future.id);await dialog(page).getByRole('button',{name:'加入草稿'}).click();await graphToolbar(page,'保存修改');await expect(page.getByLabel('编辑画布',{exact:true})).toBeVisible();
 const card=page.locator('.react-flow__node[data-id="feature:'+state.group.id+'"]');await card.locator('.dependency-card').click();await page.screenshot({path:info.outputPath('feature-canvas.png'),fullPage:true,animations:'disabled'});await card.getByRole('button',{name:/^进入/}).click();await ready(page);await expect(page.locator('.react-flow__node[data-id="'+state.req.id+'"]')).toBeVisible();await page.getByRole('navigation',{name:'项目层级'}).getByRole('button').first().click();await ready(page);await expect(card).toHaveClass(/selected/);
});
test('空特性归档与恢复，进行中的特性不能归档',async({page})=>{
 await fixture(page);await featureRow(page,'权限管理').locator('.outline-title').click();await dialog(page).getByLabel('特性更多操作').click();await page.getByRole('button',{name:'归档特性',exact:true}).click();await dialog(page).getByRole('button',{name:'归档特性',exact:true}).click();await expect(dialog(page)).toContainText('请先完成、取消或移出未完成需求');await dialog(page).getByRole('button',{name:'关闭',exact:true}).first().click();await dialog(page).getByRole('button',{name:'关闭',exact:true}).first().click();await featureRow(page,'远期探索').locator('.outline-title').click();await dialog(page).getByLabel('特性更多操作').click();await page.getByRole('button',{name:'归档特性',exact:true}).click();await dialog(page).getByRole('button',{name:'归档特性',exact:true}).click();await expect(page.locator('.modal-card:not(.modal-card-workspace)[role=dialog]')).toHaveCount(0);await dialog(page).getByLabel('特性更多操作').click();await page.getByRole('button',{name:'恢复特性',exact:true}).click();await dialog(page).getByRole('button',{name:'恢复特性',exact:true}).click();await expect(page.locator('.modal-card:not(.modal-card-workspace)[role=dialog]')).toHaveCount(0);await closeGraphProperties(page);await expect(page.locator('.outline-title',{hasText:'远期探索'})).toBeVisible();
});
test('切换项目清理旧输入，空项目可以新建特性',async({page})=>{
 await fixture(page);const other=await(await page.request.post('/api/projects',{data:{name:'空项目 '+Date.now()}})).json();await page.reload();await edit(page);await fill(page);await page.locator('.project-switcher-button').evaluate((b:HTMLButtonElement)=>b.click());await page.getByRole('option',{name:other.name,exact:true}).evaluate((b:HTMLButtonElement)=>b.click());await expect(page.locator('.modal-card:not(.modal-card-workspace)[role=dialog]')).toHaveCount(0);await expect(page.locator('.workspace-outline')).toBeVisible();await expect(page.getByLabel('大致预期',{exact:true})).toHaveCount(0);await expect(page.locator('.outline-title',{hasText:'权限管理'})).toHaveCount(0);await page.getByRole('button',{name:'新建特性',exact:true}).click();await page.getByLabel('特性名称').fill('远期新方向');await dialog(page).getByRole('button',{name:'新建特性',exact:true}).click();await expect(page.locator('.modal-card:not(.modal-card-workspace)[role=dialog]')).toHaveCount(0);await expect(page.locator('.outline-title',{hasText:'远期新方向'})).toBeVisible();
});

test('刷新失败保留输入，权限拒绝后清理特性和编辑状态',async({page})=>{
 const state=await fixture(page);await edit(page);await fill(page);const endpoint='**/api/projects/'+state.projectId+'/path-graph*';let reads=0;const refresh=()=>page.evaluate(()=>{window.dispatchEvent(new Event('offline'));window.dispatchEvent(new Event('online'));});
 await page.route(endpoint,route=>{reads++;return route.fulfill({status:503,json:{error:'临时不可用'}});});await refresh();await expect.poll(()=>reads).toBeGreaterThan(0);await expect(page.getByLabel('大致预期',{exact:true})).toHaveValue('本季度具备试用条件');
 await page.unroute(endpoint);await page.route(endpoint,route=>route.fulfill({status:403,json:{error:'项目权限已移除'}}));await refresh();await expect(page.locator('.modal-card:not(.modal-card-workspace)[role=dialog]')).toHaveCount(0);await expect(page.locator('.outline-title')).toHaveCount(0);
});
test('账号切换不恢复前一账号的编辑内容，成员只能查看',async({page})=>{
 const state=await fixture(page),name='只读同事 '+Date.now();await page.request.post('/api/people',{data:{projectId:state.projectId,name}});await edit(page);await fill(page);
 expect((await page.request.post('/api/login',{data:{username:name,password:'888888'}})).ok()).toBe(true);expect((await page.request.post('/api/account/change-password',{data:{currentPassword:'888888',newPassword:'feature-reader-password'}})).ok()).toBe(true);await page.reload();await expect(page.locator('.outline-title',{hasText:'权限管理'})).toBeVisible();await expect(page.getByLabel('大致预期',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'新建特性',exact:true})).toHaveCount(0);await closeGraphProperties(page);await page.locator('.outline-title',{hasText:'权限管理'}).click();await expect(dialog(page)).toContainText('尚未安排 Phase');await dialog(page).getByRole('tab',{name:'资料',exact:true}).click();await expect(dialog(page)).toContainText('持续完善组织协作中的授权与审计');await expect(dialog(page).getByRole('button',{name:'更新评估',exact:true})).toHaveCount(0);
});
test('规划关系提交响应丢失后通过批次回执核对，不重复建立连线',async({page})=>{
 const state=await fixture(page);await page.goto('/paths');await ready(page);await page.getByLabel('编辑画布',{exact:true}).click();await headerAction(page,'建立规划关系');await chooseOption(dialog(page).getByLabel('前置特性'),state.group.id);await chooseOption(dialog(page).getByLabel('后续特性'),state.future.id);await dialog(page).getByLabel('关系说明').fill('粗略先后安排');await dialog(page).getByRole('button',{name:'加入草稿'}).click();let writes=0;
 await page.route('**/api/projects/'+state.projectId+'/dependency-changes/apply',async route=>{writes++;await route.fetch();await route.abort('connectionfailed');});await graphToolbar(page,'保存修改');await expect(page.getByLabel('编辑画布',{exact:true})).toBeVisible();expect(writes).toBe(1);expect((await(await page.request.get('/api/projects/'+state.projectId+'/feature-relations')).json())).toHaveLength(1);
});
