import {test,expect,type Page} from '@playwright/test';
import type {PathAnalysis} from '../../src/shared/paths';
import type {Requirement,WorkItemTemplate} from '../../src/client/types';
import {addBusinessDays,todayIso} from '../../src/shared/domain';
import {mockGanttData,requirement} from './gantt-fixture';
async function fixture(page:Page,crossDependency=true){
 const login=await page.request.post('/api/login',{data:{username:'admin',password:'41_xc7q0qOjo4Inw!'}});expect(login.ok()).toBe(true);
 const session=await(await page.request.get('/api/session')).json();const name=`图验证${Date.now()}`;
 const project=await(await page.request.post('/api/projects',{data:{name,plannedEnd:addBusinessDays(todayIso(),3)}})).json();
 const owner=await(await page.request.post('/api/people',{data:{projectId:project.id,name:`负责人${Date.now()}`}})).json();
 const template=await(await page.request.post('/api/templates',{data:{projectId:project.id,name:'依赖流程',dependencyMode:'dependencies',items:[{clientKey:'a',title:'方案交付',durationDays:2,startOffsetDays:0,sortOrder:0,predecessorKeys:[]},{clientKey:'b',title:'集成验证',durationDays:3,startOffsetDays:2,sortOrder:1,predecessorKeys:['a']}]}})).json() as WorkItemTemplate;
 const create=async(title:string)=>await(await page.request.post('/api/requirements',{data:{projectId:project.id,templateId:template.id,ownerId:owner.id,title,plannedStart:addBusinessDays(todayIso(),0)}})).json() as Requirement;
 const a=await create('接口基础交付'),b=await create('订单交付');
 const analysis=async()=>await(await page.request.get(`/api/projects/${project.id}/path-analysis`)).json() as PathAnalysis;
 if(crossDependency)await page.request.post(`/api/projects/${project.id}/dependencies`,{data:{sourceRequirementId:a.id,sourceWorkItemId:a.workItems[0].id,targetRequirementId:b.id,targetWorkItemId:b.workItems[1].id,expectedRevision:(await analysis()).revision}});
 await page.addInitScript(({account,id})=>localStorage.setItem(`project-manage:selected-project:${account}`,id),{account:session.accountId,id:project.id});
 return {project,a,b,analysis};
}
const ready=(page:Page)=>expect(page.locator('[data-layout-ready="true"]')).toBeVisible({timeout:20000});

async function bounds(page:Page,height:number){
 await expect(page.locator('.topbar')).toHaveCount(1);
 await expect.poll(async()=>(await page.locator('.topbar').boundingBox())?.height).toBe(height);
 const overlaps=await page.locator('.topbar').evaluate(root=>{
  const elements=Array.from(root.querySelectorAll<HTMLElement>('.project-switcher,#topbar-title-slot,.topbar-personal,#topbar-action-slot,#topbar-context-slot,#topbar-status-slot')).filter(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height);
  return elements.flatMap((a,i)=>elements.slice(i+1).flatMap(b=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return x.left<y.right-1&&x.right>y.left+1&&x.top<y.bottom-1&&x.bottom>y.top+1?[a.id||a.className,b.id||b.className]:[];}));
 });
 expect(overlaps).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
}

test('统一顶栏：桌面与390px、长标题、全部主题和个人范围',async({page},info)=>{
 await mockGanttData(page);
 await page.route('**/api/requirements/r1',route=>route.fulfill({json:{...requirement,title:'设备监控需求 '+ '完整需求名称'.repeat(20)}}));
 await page.goto('/');await bounds(page,52);
 await page.goto('/requirements/r1');await bounds(page,52);
 await expect(page.getByRole('button',{name:'编辑信息',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('topbar-desktop.png')});
 await page.setViewportSize({width:390,height:844});await bounds(page,88);
 await expect(page.getByRole('button',{name:'编辑信息',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'需求操作',exact:true}).click();await page.getByRole('button',{name:'编辑信息',exact:true}).click();
 await expect(page.getByRole('dialog').getByLabel('需求标题',{exact:true})).toBeVisible();
 await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
 for(const theme of ['经典蓝白','瑞士排版','暖纸森林','午夜控制台','柔彩悬浮','工业黄黑','杰瑞橙','跟随系统']){
  await page.getByRole('button',{name:/^账号菜单/}).click();
  await page.getByRole('button',{name:/^切换风格/}).click();
  await page.getByRole('menuitemradio',{name:new RegExp('^'+theme)}).click();
  await page.keyboard.press('Escape');
  for(const colorScheme of ['light','dark'] as const){await page.emulateMedia({colorScheme,reducedMotion:'reduce'});await bounds(page,88);}
 }
 await page.screenshot({path:info.outputPath('topbar-narrow.png')});
 await page.goto('/');await bounds(page,52);
 await page.goto('/my-work');await bounds(page,52);await expect(page.locator('.project-scope-indicator')).toHaveText('跨项目');
 await expect(page.getByRole('button',{name:'更多操作',exact:true})).toHaveCount(0);
 await page.goto('/projects');await bounds(page,88);await expect(page.locator('.project-scope-indicator')).toHaveText('平台范围');
});

test('统一顶栏：三处画布、字段立即保存、菜单焦点和项目草稿隔离',async({page},info)=>{
 const {project,a,b}=await fixture(page);
 const other=await(await page.request.post('/api/projects',{data:{name:'另一个顶栏项目'+Date.now()}})).json();
 await page.goto(`/templates?edit=${a.templateId}`);await ready(page);await bounds(page,52);
 await expect(page.locator('.graph-toolbar')).toHaveCount(0);
 const card=page.locator('.dependency-card').filter({hasText:'方案交付'});
 await card.click();await page.getByLabel('元素名称',{exact:true}).fill('顶栏保存当前字段');
 let writes=0;page.on('request',r=>{if(r.method()==='PATCH'&&r.url().includes('/api/templates/'))writes++;});
 await page.getByRole('button',{name:'保存修改',exact:true}).click();await expect.poll(()=>writes).toBe(1);
 await expect(page.locator('.topbar-page-status')).toContainText('编辑中');
 await page.getByRole('button',{name:'更多操作',exact:true}).click();await page.keyboard.press('Escape');
 await expect(page.getByRole('button',{name:'更多操作',exact:true})).toBeFocused();
 await page.getByRole('button',{name:'返回流程列表',exact:true}).click();await expect(page.locator('.integrated-page-title h1')).toHaveText('流程设计');
 await page.goto(`/requirements/${a.id}?view=path`);await ready(page);await bounds(page,52);
 const before=await page.locator('.react-flow__viewport').getAttribute('style');
 await page.getByRole('button',{name:'更多操作',exact:true}).click();await page.getByLabel('分析说明',{exact:true}).click();
 await expect(page.locator('.graph-auxiliary')).toBeVisible();expect(await page.locator('.react-flow__viewport').getAttribute('style')).toBe(before);
 await page.locator('.graph-auxiliary').getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('button',{name:'编辑画布',exact:true}).click();
 await page.locator(`.react-flow__node[data-id="${a.workItems[0].id}"] .dependency-card`).click();await page.getByLabel('元素名称',{exact:true}).fill('项目草稿名称');
 await page.locator('.project-switcher-button').click();await page.getByRole('option',{name:other.name,exact:true}).click();
 await expect(page).toHaveURL(/\/paths$/);await ready(page);await expect(page.locator('.integrated-page-title h1')).toContainText(other.name);
 await page.locator('.project-switcher-button').click();await page.getByRole('option',{name:project.name,exact:true}).click();await ready(page);
 await page.goto(`/requirements/${a.id}?view=path`);await ready(page);await expect(page.locator('.dependency-card').filter({hasText:'项目草稿名称'})).toBeVisible();
 await page.goto('/paths?pathScope=all');await ready(page);await page.locator(`.react-flow__node[data-id="${b.id}"] .dependency-card`).click();
 await page.setViewportSize({width:390,height:844});await bounds(page,88);
 await page.screenshot({path:info.outputPath('topbar-canvas-narrow.png')});
 await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeVisible();
 const bar=(await page.locator('.topbar').boundingBox())!,canvas=(await page.locator('.dependency-canvas').boundingBox())!;
 expect(canvas.y).toBeGreaterThanOrEqual(bar.y+bar.height);
});

test.describe('触屏',()=>{
 test.use({hasTouch:true,viewport:{width:390,height:844}});
 test('统一顶栏：触屏命中、侧栏切换、菜单开关不重建图形',async({page},info)=>{
  const {a}=await fixture(page);await page.goto(`/templates?edit=${a.templateId}`);await ready(page);await bounds(page,88);
  const snapshot=()=>page.locator('.react-flow__node').evaluateAll(nodes=>nodes.map(n=>({id:n.getAttribute('data-id'),position:(n as HTMLElement).style.transform})));
  const before=await snapshot(),layouts=await page.evaluate(()=>performance.getEntriesByName('pm-path-layout').length);
  for(const name of ['撤销','重做','保存修改','更多操作']){const box=(await page.getByRole('button',{name,exact:true}).boundingBox())!;expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);}
  await page.getByRole('button',{name:'更多操作',exact:true}).click();await page.keyboard.press('Escape');expect(await snapshot()).toEqual(before);
  await page.setViewportSize({width:1280,height:800});await bounds(page,52);
  await page.getByRole('button',{name:'收起侧边栏',exact:true}).click();await bounds(page,52);
  expect(await snapshot()).toEqual(before);expect(await page.evaluate(()=>performance.getEntriesByName('pm-path-layout').length)).toBe(layouts);
  await page.screenshot({path:info.outputPath('topbar-canvas-desktop.png')});
 });
});

test('统一顶栏：账号菜单保留退出请求锁和未知结果核对',async({page})=>{
 await mockGanttData(page);let loggedOut=false,writes=0;
 await page.route('**/api/logout',async route=>{writes++;await new Promise(r=>setTimeout(r,150));loggedOut=true;await route.abort('failed');});
 await page.route('**/api/session',async route=>{if(loggedOut)await route.fulfill({json:{authenticated:false,accountId:null,personId:null,username:'',role:'guest',globalRole:null,managedProjectIds:[]}});else await route.fallback();});
 await page.goto('/');await page.getByRole('button',{name:/^账号菜单/}).click();
 await page.getByRole('menuitem',{name:'退出登录',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click();});
 await expect(page.getByRole('button',{name:'账号菜单',exact:true})).toBeVisible();expect(writes).toBe(1);
 await page.getByRole('button',{name:'账号菜单',exact:true}).click();await expect(page.getByRole('menuitem',{name:'用户登录',exact:true})).toBeVisible();
});

test('统一顶栏：无流程权限的编辑链接只显示列表，加载失败清除旧操作',async({page})=>{
 await mockGanttData(page);
 await page.route('**/api/session',route=>route.fulfill({json:{authenticated:true,accountId:'viewer',personId:'u1',username:'只读成员',globalRole:'user',role:'member',managedProjectIds:[]}}));
 await page.goto('/templates?edit=new');await expect(page.locator('.integrated-page-title h1')).toHaveText('流程设计');
 await expect(page.locator('.graph-workspace')).toHaveCount(0);await expect(page.getByRole('button',{name:'保存修改',exact:true})).toHaveCount(0);
 await page.route('**/api/requirements/missing',route=>route.fulfill({status:404,json:{error:'需求已删除'}}));
 await page.goto('/requirements/missing?view=path');await expect(page.getByText('需求无法打开',{exact:true})).toBeVisible();
 await expect(page.locator('.integrated-page-title h1')).toHaveCount(1);await expect(page.getByRole('button',{name:'保存修改',exact:true})).toHaveCount(0);
});
