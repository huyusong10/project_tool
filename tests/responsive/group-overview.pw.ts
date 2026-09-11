import { expect, test, type Page } from '@playwright/test';
import type { GroupOverviewReport } from '../../src/shared/group-overview';
import type { RequirementGroup } from '../../src/shared/intake';

const panel=(page:Page)=>page.getByRole('region',{name:'总体进展',exact:true});
async function fixture(page:Page){
  const login=await page.request.post('/api/login',{data:{username:'admin',password:'41_xc7q0qOjo4Inw!'}});expect(login.ok()).toBe(true);const session=await login.json();
  const project=await(await page.request.post('/api/projects',{data:{name:'总体进展验证 '+Date.now()}})).json();
  const group=(await(await page.request.post('/api/projects/'+project.id+'/requirement-groups',{data:{name:'权限管理',sortOrder:0}})).json()).groups[0] as RequirementGroup;
  await page.request.post('/api/projects/'+project.id+'/requirement-groups',{data:{name:'远期探索',sortOrder:1}});
  const requirement=await page.request.post('/api/requirements',{data:{projectId:project.id,title:'角色授权',groupId:group.id}});expect(requirement.ok(),await requirement.text()).toBe(true);
  await page.request.post('/api/requirements',{data:{projectId:project.id,title:'尚未整理的需求'}});
  await page.addInitScript(({accountId,projectId})=>localStorage.setItem('project-manage:selected-project:'+accountId,projectId),{accountId:session.accountId,projectId:project.id});
  await page.goto('/');await expect(panel(page).getByRole('article',{name:'权限管理',exact:true})).toBeVisible();return {projectId:project.id,group,session};
}
async function edit(page:Page){await panel(page).getByRole('button',{name:'编辑总体进展 权限管理',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();}
async function fill(page:Page){
  await page.getByLabel('大致预期',{exact:true}).fill('本季度具备试用条件');
  await page.getByLabel('进展简述',{exact:true}).fill('基础授权完成，正在补充审计功能');
  await page.getByLabel('判断',{exact:true}).selectOption('on_track');
  await page.getByLabel('原因或变化说明',{exact:true}).fill('复杂场景稍慢，暂不影响首批试用');
}

test('总体预期保存、展开需求、筛选跳转及各视口布局',async({page},testInfo)=>{
  const state=await fixture(page);await edit(page);await fill(page);await page.getByRole('button',{name:'保存总体进展',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  const row=panel(page).getByRole('article',{name:'权限管理',exact:true});await expect(row).toContainText('基本符合');await expect(row).toContainText('本季度具备试用条件');await expect(row).toContainText('完成 0/1 个需求');
  await expect(panel(page).getByRole('article',{name:'远期探索',exact:true})).toContainText('尚未关联需求');await expect(panel(page)).toContainText('未分组需求 1 个');
  await row.getByRole('button',{name:'展开 权限管理',exact:true}).click();await expect(row.getByRole('link',{name:'角色授权',exact:true})).toBeVisible();await expect(row).toContainText('复杂场景稍慢');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const box=await panel(page).boundingBox(),gantt=await page.locator('.project-gantt').first().count() ? await page.locator('.project-gantt').first().boundingBox() : null;
  if(box&&gantt)expect(box.y+box.height).toBeLessThanOrEqual(gantt.y+1);
  await page.screenshot({path:testInfo.outputPath('overall.png'),fullPage:true});
  await row.getByRole('link',{name:'查看分组需求',exact:true}).click();await expect(page).toHaveURL(new RegExp('group='+state.group.id));await expect(page.getByRole('link',{name:'角色授权',exact:true})).toBeVisible();
});

test('旧版本保存被拒绝，保留输入并核对服务器新资料',async({page})=>{
  const state=await fixture(page);await edit(page);await fill(page);
  let intercept=true;
  await page.route('**/api/projects/'+state.projectId+'/requirement-groups',async route=>{
    if(route.request().method()==='POST'&&intercept){intercept=false;const body=route.request().postDataJSON();
      const response=await page.request.post(route.request().url(),{data:{...body,overview:{...body.overview,expectation:'另一位经理修改了预期',assessment:'off_track'}}});expect(response.ok()).toBe(true);
    }await route.continue();
  });
  await page.getByRole('button',{name:'保存总体进展',exact:true}).click();await expect(page.getByRole('heading',{name:'服务器上的最新资料',exact:true})).toBeVisible();
  await expect(page.getByLabel('大致预期',{exact:true})).toHaveValue('本季度具备试用条件');await expect(page.getByRole('button',{name:'保存总体进展',exact:true})).toBeDisabled();
  await expect(page.getByRole('dialog')).toContainText('另一位经理修改了预期');await page.getByRole('button',{name:'保留输入，按最新资料继续',exact:true}).click();
  await page.getByRole('button',{name:'保存总体进展',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(panel(page)).toContainText('本季度具备试用条件');
});

test('保存生效但响应丢失，刷新页面后核对且不重复提交',async({page})=>{
  const state=await fixture(page);await edit(page);await fill(page);let writes=0;
  const endpoint='**/api/projects/'+state.projectId+'/requirement-groups';
  await page.route(endpoint,async route=>{if(route.request().method()==='POST'){writes++;await route.fetch();await route.abort('connectionfailed');}else await route.continue();});
  await page.getByRole('button',{name:'保存总体进展',exact:true}).click();await expect(page.getByRole('button',{name:'读取最新资料',exact:true})).toBeVisible();
  await page.reload();await panel(page).getByRole('button',{name:'核对上次保存',exact:true}).click();await expect(page.getByLabel('大致预期',{exact:true})).toHaveValue('本季度具备试用条件');
  await page.getByRole('button',{name:'读取最新资料',exact:true}).click();await page.getByRole('button',{name:'已核对，保存已生效',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(panel(page).getByRole('button',{name:'核对上次保存',exact:true})).toHaveCount(0);expect(writes).toBe(1);
});

test('后台刷新故障保留页面和草稿，权限拒绝清理旧资料',async({page})=>{
  const state=await fixture(page);await edit(page);await fill(page);const endpoint='**/api/projects/'+state.projectId+'/group-overview';
  await page.route(endpoint,route=>route.fulfill({status:503,json:{error:'临时不可用'}}));
  await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));});
  // 直接触发后台刷新，弹窗保持打开。
  await panel(page).getByRole('button',{name:'刷新',exact:true}).evaluate((button:HTMLButtonElement)=>button.click());
  await expect(panel(page).getByRole('alert')).toContainText('上次读取');await expect(page.getByLabel('大致预期',{exact:true})).toHaveValue('本季度具备试用条件');
  await page.unroute(endpoint);await page.route(endpoint,route=>route.fulfill({status:403,json:{error:'没有项目权限'}}));
  await panel(page).getByRole('button',{name:'刷新',exact:true}).evaluate((button:HTMLButtonElement)=>button.click());
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(panel(page).getByRole('article')).toHaveCount(0);
});

test('切换项目清理评估草稿与旧分组，空项目提供创建入口',async({page})=>{
  await fixture(page);const other=await(await page.request.post('/api/projects',{data:{name:'另一个项目 '+Date.now()}})).json();
  await page.reload();await edit(page);await fill(page);
  // 项目切换通过应用现有顶部选择器触发。
  await page.locator('.project-switcher-button').evaluate((button:HTMLButtonElement)=>button.click());
  await page.getByRole('option',{name:other.name,exact:true}).evaluate((button:HTMLButtonElement)=>button.click());
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(panel(page)).toContainText('暂无分组');await expect(panel(page).getByRole('article')).toHaveCount(0);
  await panel(page).getByRole('button',{name:'创建分组',exact:true}).click();await page.getByLabel('新分组名称',{exact:true}).fill('新方向');await page.getByRole('button',{name:'新建分组',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();await expect(panel(page)).toContainText('新方向');
});

test('普通项目成员读取事实但没有评估编辑入口',async({page})=>{
  const state=await fixture(page);const username='只读成员 '+Date.now();await page.request.post('/api/people',{data:{projectId:state.projectId,name:username}});
  await page.request.post('/api/login',{data:{username,password:'888888'}});await page.request.post('/api/account/change-password',{data:{currentPassword:'888888',newPassword:'overview-browser-member'}});
  await page.reload();await expect(panel(page).getByRole('article',{name:'权限管理',exact:true})).toBeVisible();await expect(panel(page).getByRole('button',{name:/编辑总体进展/})).toHaveCount(0);await expect(panel(page).getByRole('button',{name:'管理分组',exact:true})).toHaveCount(0);
});

test('需求变化刷新系统事实后仍保留原评估时间',async({page})=>{
  const state=await fixture(page);await edit(page);await fill(page);await page.getByRole('button',{name:'保存总体进展',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  const read=async()=>(await(await page.request.get('/api/projects/'+state.projectId+'/group-overview')).json()) as GroupOverviewReport;
  const before=(await read()).groups[0];
  await page.request.post('/api/requirements',{data:{projectId:state.projectId,groupId:state.group.id,title:'新增复杂场景'}});
  await panel(page).getByRole('button',{name:'刷新',exact:true}).click();await expect(panel(page)).toContainText('完成 0/2 个需求');
  const after=(await read()).groups[0];expect(after.assessedAt).toBe(before.assessedAt);expect(after.overview).toEqual(before.overview);
});
