import {test,expect,type Page} from '@playwright/test';
import {graphFixture as fixture} from './graph-fixture';
import {openGraph,graphProperties,graphToolbar,closeGraphProperties} from './graph-interactions';
import {headerAction} from './topbar-helpers';
import {mockGanttData,mockGanttReport,requirement} from './gantt-fixture';

const ready=(page:Page)=>expect(page.locator('[data-layout-ready="true"]')).toBeVisible({timeout:20000});
async function bounds(page:Page){
  await expect(page.locator('.topbar')).toHaveCount(1);
  await expect.poll(async()=>(await page.locator('.topbar').boundingBox())?.height).toBe(52);
  expect(await page.locator('.topbar').evaluate(root=>{
    const elements=Array.from(root.querySelectorAll<HTMLElement>('.project-switcher,#topbar-title-slot,.topbar-personal')).filter(e=>e.offsetWidth&&e.offsetHeight);
    return elements.flatMap((a,i)=>elements.slice(i+1).filter(b=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return x.left<y.right-1&&x.right>y.left+1&&x.top<y.bottom-1&&x.bottom>y.top+1;}).map(b=>[a.className,b.className]));
  })).toEqual([]);
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
}

for(const entry of ['click','reload'])test('需求详情 '+entry+'：读取期间顶栏不闪现通用标题，基线保持稳定',{tag:'@responsive'},async({page},info)=>{
  await mockGanttData(page);const title='EPDS-DCIM-35【菜单权限方案管理】';
  await mockGanttReport(page,()=>[{...requirement,title}]);
  let release=()=>{},waiting=Promise.resolve();
  await page.route('**/api/requirements/r1',async route=>{await waiting;await route.fulfill({json:{...requirement,title}});});
  for(const width of [page.viewportSize()!.width,390]){
    await page.setViewportSize({width,height:844});await page.goto('/?projectId=p1&workspaceView=list&scopeType=project');
    await expect(page.locator('.integrated-page-title h1')).toHaveText('项目空间');await page.getByLabel('筛选清单',{exact:true}).fill(title);
    const heading=page.locator('.integrated-page-title h1'),before=(await heading.boundingBox())!;
    waiting=new Promise<void>(resolve=>{release=resolve;});
    try{
      await page.locator('.outline-table').getByRole('button',{name:title,exact:true}).click();
      const detail=page.locator('.modal-card-workspace[role=dialog]');
      await expect(detail).toContainText('正在读取需求');await expect(heading).toHaveText('项目空间');expect(await heading.boundingBox()).toEqual(before);
      release();await expect(detail.locator('.requirement-overview')).toBeVisible();
      if(entry==='reload'){
        waiting=new Promise<void>(resolve=>{release=resolve;});await page.reload();
        await expect(detail).toContainText('正在读取需求');release();await expect(detail.locator('.requirement-overview')).toBeVisible();
      }
      await expect(heading).toHaveText('项目空间');expect(await heading.boundingBox()).toEqual(before);await expect(detail.getByRole('heading',{name:title,exact:true})).toBeVisible();
      await bounds(page);await page.screenshot({path:info.outputPath('detail-title-'+width+'.png')});
    }finally{release();}
  }
});

test('统一顶栏：矩阵与390px、长标题、全部主题和个人范围',{tag:'@responsive'},async({page},info)=>{
  await mockGanttData(page);const title='设备监控需求 '+'完整需求名称'.repeat(20);
  await mockGanttReport(page,()=>[{...requirement,title}]);await page.route('**/api/requirements/r1',route=>route.fulfill({json:{...requirement,title}}));
  for(const width of [page.viewportSize()!.width,390]){
    await page.setViewportSize({width,height:900});await page.goto('/requirements/r1');await expect(page.locator('.requirement-overview')).toBeVisible();await bounds(page);
    const detail=page.locator('.modal-card-workspace[role=dialog]');await expect(detail.getByRole('heading',{name:title,exact:true})).toBeVisible();expect(await detail.evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);
    await detail.getByRole('button',{name:'编辑信息',exact:true}).click();await expect(page.getByRole('dialog').getByLabel('需求标题',{exact:true})).toBeVisible();
    await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();await closeGraphProperties(page);
    for(const theme of ['经典蓝白','瑞士排版','暖纸森林','午夜控制台','柔彩悬浮','工业黄黑','杰瑞橙','跟随系统']){
      const picker=page.getByRole('button',{name:/^切换风格/});if(!await picker.isVisible())await page.getByRole('button',{name:/^账号菜单/}).click();
      await picker.click();await page.getByRole('menuitemradio',{name:new RegExp('^'+theme)}).click();await page.keyboard.press('Escape');
      for(const colorScheme of ['light','dark'] as const){await page.emulateMedia({colorScheme,reducedMotion:'reduce'});await bounds(page);}
    }
    await page.screenshot({path:info.outputPath('topbar-'+width+'.png')});
    for(const [path,label] of [['/my-work','跨项目'],['/projects','平台范围']]){await page.goto(path);await expect(page.locator('.project-scope-indicator')).toHaveText(label);await bounds(page);await expect(page.locator('.topbar-page-icon')).toBeVisible();}
  }
});

test('统一顶栏：三处画布、字段立即保存、菜单焦点和项目草稿隔离',async({page})=>{
  const {project,a,b}=await fixture(page),other=await(await page.request.post('/api/projects',{data:{name:'另一个顶栏项目'+Date.now()}})).json();
  await openGraph(page,'/templates?edit='+a.templateId);await ready(page);
  await graphProperties(page,page.locator('.dependency-card').filter({hasText:'方案交付'}));await page.getByLabel('元素名称',{exact:true}).fill('顶栏保存当前字段');
  let writes=0;page.on('request',r=>{if(r.method()==='PATCH'&&r.url().includes('/api/templates/'))writes++;});
  await graphToolbar(page,'保存修改');await expect.poll(()=>writes).toBe(1);await expect(page.locator('.page-toolbar-status')).toContainText('编辑中');
  await page.getByRole('button',{name:'更多操作',exact:true}).click();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'更多操作',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'返回流程列表',exact:true}).click();await expect(page.locator('.integrated-page-title h1')).toHaveText('流程设计');
  await openGraph(page,'/requirements/'+a.id+'?view=path');await ready(page);const before=await page.locator('.react-flow__viewport').getAttribute('style');
  await headerAction(page,'分析说明');await expect(page.locator('.graph-auxiliary')).toBeVisible();expect(await page.locator('.react-flow__viewport').getAttribute('style')).toBe(before);
  await page.locator('.graph-auxiliary').getByRole('button',{name:'关闭',exact:true}).click();await graphToolbar(page,'编辑画布');
  await graphProperties(page,page.locator('.react-flow__node[data-id="'+a.workItems[0].id+'"] .dependency-card'));await page.getByLabel('元素名称',{exact:true}).fill('项目草稿名称');await page.getByLabel('元素名称',{exact:true}).blur();await closeGraphProperties(page);
  await page.locator('.project-switcher-button').click();await page.getByRole('option',{name:other.name,exact:true}).click();await expect(page.locator('.unified-workspace')).toHaveAttribute('data-view','list');await expect(page).toHaveURL(new RegExp('projectId='+other.id));
  await page.locator('.project-switcher-button').click();await page.getByRole('option',{name:project.name,exact:true}).click();await ready(page);
  await openGraph(page,'/requirements/'+a.id+'?view=path');await ready(page);await expect(page.locator('.dependency-card').filter({hasText:'项目草稿名称'})).toBeVisible();
  await openGraph(page,'/paths?pathScope=all');await ready(page);await graphProperties(page,page.locator('.react-flow__node[data-id="'+b.id+'"] .dependency-card'));await expect(page.getByLabel('元素名称')).toHaveValue(b.title);
});

test.describe('触屏',()=>{
  test.use({hasTouch:true});
  test('统一顶栏：触屏命中、侧栏切换、菜单开关不重建图形',{tag:'@responsive'},async({page},info)=>{
    const {a}=await fixture(page);await page.setViewportSize({width:390,height:844});await openGraph(page,'/templates?edit='+a.templateId);await ready(page);await bounds(page);
    const snapshot=()=>page.locator('.react-flow__node').evaluateAll(nodes=>nodes.map(n=>({id:n.getAttribute('data-id'),position:(n as HTMLElement).style.transform}))),before=await snapshot();
    for(const name of ['保存修改','更多操作']){const box=(await page.getByRole('button',{name,exact:true}).boundingBox())!;expect(box.width).toBeGreaterThanOrEqual(32);expect(box.height).toBeGreaterThanOrEqual(32);}
    const layouts=await page.evaluate(()=>performance.getEntriesByName('pm-path-layout').length);
    await page.getByRole('button',{name:'更多操作',exact:true}).tap();await page.keyboard.press('Escape');expect(await snapshot()).toEqual(before);
    await page.setViewportSize(info.project.use.viewport!);await bounds(page);await page.getByRole('button',{name:'收起侧边栏',exact:true}).click();await bounds(page);
    expect(await snapshot()).toEqual(before);expect(await page.evaluate(()=>performance.getEntriesByName('pm-path-layout').length)).toBe(layouts);
    const bar=(await page.locator('.page-toolbar').boundingBox())!,canvas=(await page.locator('.dependency-canvas').boundingBox())!;expect(canvas.y).toBeGreaterThanOrEqual(bar.y+bar.height);
    await page.screenshot({path:info.outputPath('topbar-canvas.png')});
  });
});

test('统一顶栏：账号菜单保留退出请求锁和未知结果核对',async({page})=>{
  await mockGanttData(page);let loggedOut=false,writes=0;
  await page.route('**/api/logout',async route=>{writes++;await new Promise(r=>setTimeout(r,150));loggedOut=true;await route.abort('failed');});
  await page.route('**/api/session',async route=>{if(loggedOut)await route.fulfill({json:{authenticated:false,accountId:null,personId:null,username:'',role:'guest',globalRole:null,managedProjectIds:[]}});else await route.fallback();});
  await page.goto('/');await page.getByRole('button',{name:/^账号菜单/}).click();await page.getByRole('menuitem',{name:'退出登录',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click();});
  await expect(page.getByRole('button',{name:'游客登录',exact:true})).toBeVisible();expect(writes).toBe(1);
  await page.getByRole('button',{name:'游客登录',exact:true}).click();await expect(page.getByRole('dialog',{name:'用户登录'})).toBeVisible();
});

test('普通需求详情：关闭保留工作区，标题与摘要不增加返回按钮',{tag:'@responsive'},async({page},info)=>{
  await mockGanttData(page);
  for(const width of [page.viewportSize()!.width,390]){
    await page.setViewportSize({width,height:844});await page.goto('/requirements/r1');const root=page.locator('.modal-card-workspace[role=dialog]');await expect(root.locator('.requirement-overview')).toBeVisible();await bounds(page);
    const header=(await page.locator('.integrated-page-title h1').boundingBox())!;await expect(root.locator('.requirement-overview').getByRole('button',{name:'返回',exact:true})).toHaveCount(0);
    const row=root.locator('.requirement-overview-meta');expect((await row.boundingBox())!.height).toBeLessThanOrEqual(44);
    await page.screenshot({path:info.outputPath('detail-close-'+width+'.png')});await root.getByRole('button',{name:'关闭',exact:true}).focus();await page.keyboard.press('Enter');await expect(root).toHaveCount(0);
    expect(await page.locator('.integrated-page-title h1').boundingBox()).toEqual(header);await expect(page).not.toHaveURL(/detailId=/);
  }
});

test('统一顶栏：无流程权限的编辑链接明确拒绝，缺失对象不保留旧操作',async({page})=>{
  await mockGanttData(page);await page.route('**/api/session',route=>route.fulfill({json:{authenticated:true,accountId:'viewer',personId:'u1',username:'只读成员',globalRole:'user',role:'member',managedProjectIds:[]}}));
  await page.goto('/templates?edit=new');await expect(page.locator('.integrated-page-title h1')).toHaveText('流程设计');await expect(page.getByRole('heading',{name:'无权编辑流程',exact:true})).toBeVisible();await expect(page.locator('.graph-workspace')).toHaveCount(0);await expect(page.getByRole('button',{name:'保存修改',exact:true})).toHaveCount(0);
  await page.route('**/api/requirements/missing',route=>route.fulfill({status:404,json:{error:'需求已删除'}}));
  await page.goto('/requirements/missing?view=path');await expect(page.getByText('需求无法打开',{exact:true})).toBeVisible();await expect(page.locator('.integrated-page-title h1')).toHaveCount(1);await expect(page.getByRole('button',{name:'保存修改',exact:true})).toHaveCount(0);
  await page.goto('/requirements/missing-draft?view=path&draftProject=p1');await expect(page.locator('strong').filter({hasText:'本机需求草稿不存在'})).toBeVisible();await expect(page.getByRole('button',{name:'返回项目特性',exact:true})).toBeVisible();
});

test('统一返回：内部路径与流程固定返回位，长来源不推挤顶栏',{tag:'@responsive'},async({page},info)=>{
  const {a}=await fixture(page);
  for(const width of [page.viewportSize()!.width,390]){
    await page.setViewportSize({width,height:844});const boxes=[];
    for(const url of ['/requirements/'+a.id+'?view=path','/templates?edit='+a.templateId]){
      await openGraph(page,url);await ready(page);await bounds(page);const back=page.locator('.page-toolbar-back-slot button');await expect(back).toBeVisible();boxes.push(await back.boundingBox());
    }
    expect(boxes[0]).toEqual(boxes[1]);await openGraph(page,'/requirements/'+a.id+'?view=path');await ready(page);
    const heading=(await page.locator('.integrated-page-title h1').boundingBox())!;
    await page.evaluate(({projectId})=>history.replaceState({...history.state,idx:2,usr:{pathSource:{projectId,index:1,label:'很长的来源需求名称'.repeat(12)+' · 需求路径'}}},''),{projectId:a.projectId});await page.reload();await ready(page);await bounds(page);
    expect(await page.locator('.integrated-page-title h1').boundingBox()).toEqual(heading);expect(await page.locator('.page-toolbar-back-slot button').boundingBox()).toEqual(boxes[0]);
    await page.getByRole('button',{name:'上一级',exact:true}).click();await ready(page);await expect(page).not.toHaveURL(new RegExp('scopeId='+a.id));
    await page.screenshot({path:info.outputPath('unified-return-'+width+'.png')});
  }
});
