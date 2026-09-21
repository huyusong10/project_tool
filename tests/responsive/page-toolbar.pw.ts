import {test,expect,type Page} from '@playwright/test';
import {phaseFixture} from './phase-fixture';
import {closeGraphProperties,graphToolbar} from './graph-interactions';
import {headerAction} from './topbar-helpers';
const bar=(page:Page)=>page.getByRole('region',{name:'页面工具栏',exact:true});
async function toolbarAnchors(page:Page){
  return page.locator('.page-toolbar').evaluate(root=>Object.fromEntries([
    '.page-toolbar-back-slot','.page-toolbar-views','.page-toolbar-more-slot',
  ].map(selector=>{const r=root.querySelector(selector)!.getBoundingClientRect();return [selector,[r.x,r.y,r.width,r.height].map(n=>Math.round(n*10)/10)];})));
}
async function geometry(page:Page){
  await expect(bar(page)).toHaveCount(1);
  const measure=()=>page.evaluate(()=>{
    const top=document.querySelector('.topbar')!.getBoundingClientRect(),toolbar=document.querySelector('.page-toolbar')!,box=toolbar.getBoundingClientRect();
    const parts=Array.from(toolbar.children).filter(n=>{const r=n.getBoundingClientRect();return r.width&&r.height;});
    return {height:top.height,gap:box.top-top.bottom,overflow:document.documentElement.scrollWidth>innerWidth,
      outside:parts.filter(n=>{const r=n.getBoundingClientRect();return r.left<box.left-1||r.right>box.right+1||r.bottom>box.bottom+1;}).map(n=>n.className),
      overlap:parts.flatMap((n,i)=>parts.slice(i+1).filter(m=>{const a=n.getBoundingClientRect(),b=m.getBoundingClientRect();return a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1;}).map(m=>n.className+' / '+m.className))};
  });
  await expect.poll(measure).toEqual({height:52,gap:0,overflow:false,outside:[],overlap:[]});
  await expect(page.locator('.topbar').getByRole('button',{name:/返回|保存修改|编辑画布|新建需求|新建流程/})).toHaveCount(0);
}
const ready=(page:Page)=>expect(page.locator('.dependency-canvas')).toHaveAttribute('data-layout-ready','true');
async function enter(page:Page,id:string){await page.locator('[data-object-id="'+id+'"]').getByRole('button',{name:/^进入/}).click();}
test('更多操作打开的弹窗关闭后回到入口，键盘能再次打开',async({page})=>{
 await phaseFixture(page);await page.setViewportSize({width:390,height:844});
 const writes:string[]=[];page.on('request',request=>{if(request.url().includes('/api/')&&request.method()!=='GET')writes.push(request.url());});
 for(const [url,action,title] of [['/project-settings','添加成员','添加项目成员'],['/settings','修改密码','修改密码']]){
  await page.goto(url);const more=bar(page).getByRole('button',{name:'更多操作',exact:true});await expect(more).toBeVisible();
  await more.focus();await page.keyboard.press('ArrowDown');const item=page.getByRole('menu').getByRole('button',{name:action,exact:true});await expect(item).toBeFocused();await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog',{name:title,exact:true});await expect(dialog).toBeVisible();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(more).toBeFocused();
  await page.keyboard.press('ArrowDown');await expect(item).toBeFocused();await page.keyboard.press('Enter');await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'关闭',exact:true}).click();await expect(more).toBeFocused();
 }
 expect(writes).toEqual([]);
});

test('公共工具栏覆盖清单、详情和三个工作区视角',{tag:'@responsive'},async({page},info)=>{
 const f=await phaseFixture(page);await page.goto('/requirements');await expect(page.locator('.outline-table')).toContainText('资产管理');await geometry(page);
 await enter(page,'feature:'+f.feature.id);await expect(page).toHaveURL(/scopeType=feature/);
 await page.getByRole('button',{name:'展开全部',exact:true}).click();await enter(page,f.testing.id);await geometry(page);
 await page.getByRole('button',{name:'关系图',exact:true}).click();await ready(page);await geometry(page);
 await page.getByRole('button',{name:'进展表',exact:true}).click();await expect(page.getByRole('treegrid')).toBeVisible();await geometry(page);
 await page.goto('/requirements?q=资产导入');await expect(page.locator('[data-object-id="'+f.testing.id+'"] .outline-title')).toBeVisible();const source=page.url();await page.locator('[data-object-id="'+f.testing.id+'"] .outline-title').click();await expect(page.locator('.requirement-overview')).toBeVisible();await geometry(page);
 await page.setViewportSize({width:390,height:844});await geometry(page);await page.screenshot({path:info.outputPath('toolbar-detail-narrow.png')});
 await closeGraphProperties(page);await expect.poll(()=>{const url=new URL(page.url());url.searchParams.delete('pathInspector');return url.href;}).toBe(source);await page.goto('/people');await geometry(page);
 await page.screenshot({path:info.outputPath('toolbar-people-narrow.png')});
});
test('长名称详情与加载失败保留有界工具栏和返回入口',{tag:'@responsive'},async({page},info)=>{
 const f=await phaseFixture(page),name='跨站点资产生命周期协同管理'.repeat(10);
 await page.route('**/api/projects/'+f.projectId+'/path-graph*',async route=>{const response=await route.fetch(),json=await response.json();json.analysis.requirements.find((r:{id:string})=>r.id===f.testing.id).title=name;await route.fulfill({json});});
 await page.goto('/requirements/'+f.testing.id);
 await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
 for(const viewport of [page.viewportSize()!,{width:390,height:844}]){await page.setViewportSize(viewport);await geometry(page);const dialog=(await page.getByRole('dialog').boundingBox())!;expect(dialog.x+dialog.width).toBeLessThanOrEqual(viewport.width+1);await page.screenshot({path:info.outputPath('toolbar-long-'+viewport.width+'.png')});}
 await closeGraphProperties(page);await page.route('**/api/requirements/missing',route=>route.fulfill({status:404,json:{error:'需求不存在'}}));
 await page.goto('/requirements/missing');await expect(page.getByText('需求不存在',{exact:true})).toBeVisible();await expect(bar(page)).toHaveCount(0);await expect(page.getByRole('button',{name:'项目空间',exact:true})).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('流程编辑在窄屏仍直接提供保存和返回',{tag:'@responsive'},async({page},info)=>{
 await phaseFixture(page);await page.goto('/templates');await headerAction(page,'新建流程');await ready(page);await geometry(page);
 await page.setViewportSize({width:390,height:844});await geometry(page);await expect(bar(page).getByLabel('保存修改',{exact:true})).toBeVisible();await expect(bar(page).getByLabel('返回流程列表',{exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('toolbar-template-narrow.png')});
});
test('页面主操作使用公共栏，无操作时保留层级且隐藏操作分隔线',{tag:'@responsive'},async({page},info)=>{
 await phaseFixture(page);
 for(const [url,action] of [['/requirements','新建对象'],['/issues','新建问题'],['/templates','新建流程'],['/projects','新建项目'],['/resources','新增人员'],['/project-settings','编辑项目'],['/analytics','编辑看板']]){
  await page.goto(url);await geometry(page);
  const button=bar(page).getByRole('button',{name:action,exact:true});
  const more=bar(page).getByRole('button',{name:'更多操作',exact:true});await expect(button.or(more).first()).toBeVisible();
  if(!await button.isVisible())await more.click();
  await expect(page.getByRole('button',{name:action,exact:true})).toBeVisible();await page.keyboard.press('Escape');
 }
 await headerAction(page,'编辑看板');await expect(bar(page).getByRole('button',{name:'保存布局',exact:true})).toBeVisible();await geometry(page);
 await page.setViewportSize({width:390,height:844});await geometry(page);await page.screenshot({path:info.outputPath('toolbar-analytics-narrow.png')});
 await page.goto('/my-work');await expect(page.locator('h1')).toHaveText('我的工作');await geometry(page);await expect(bar(page).getByRole('navigation',{name:'页面层级'})).toHaveText('我的工作');await expect(bar(page).locator('.page-toolbar-actions button')).toHaveCount(0);await expect(bar(page).locator('.page-toolbar-actions')).toHaveCSS('border-left-color','rgba(0, 0, 0, 0)');
});
test('特性下钻、视图与编辑状态变化时，返回位和常用按钮坐标不变',{tag:'@responsive'},async({page},info)=>{
 const f=await phaseFixture(page);
 for(const viewport of [page.viewportSize()!,{width:390,height:844}]){
  await page.setViewportSize(viewport);await page.goto('/requirements');await expect(page.locator('.outline-table')).toBeVisible();await geometry(page);const baseline=await toolbarAnchors(page);
  await enter(page,'feature:'+f.feature.id);await geometry(page);await expect.poll(()=>toolbarAnchors(page)).toEqual(baseline);
  if(await page.getByRole('button',{name:'展开全部',exact:true}).isEnabled())await page.getByRole('button',{name:'展开全部',exact:true}).click();await enter(page,f.testing.id);await geometry(page);await expect.poll(()=>toolbarAnchors(page)).toEqual(baseline);
  await page.getByRole('button',{name:'关系图',exact:true}).click();await ready(page);if(await page.getByLabel('编辑画布',{exact:true}).isVisible())await graphToolbar(page,'编辑画布');await expect(page.getByLabel('保存修改',{exact:true})).toBeVisible();await geometry(page);await expect.poll(()=>toolbarAnchors(page)).toEqual(baseline);
  await page.screenshot({path:info.outputPath('stable-edit-'+viewport.width+'.png')});
  await page.getByRole('button',{name:'上一级',exact:true}).click();await ready(page);await geometry(page);
 }
});
test('窄屏图形编辑和加载期间工具栏不挤压或遮挡画布',{tag:'@responsive'},async({page},info)=>{
 const f=await phaseFixture(page);await page.setViewportSize({width:390,height:844});
 for(const scope of [{scopeType:'project',scopeId:f.projectId},{scopeType:'requirement',scopeId:f.testing.id}]){
  await page.goto('/?'+new URLSearchParams({...scope,projectId:f.projectId,workspaceView:'graph'}));await ready(page);if(await page.getByLabel('编辑画布',{exact:true}).isVisible())await graphToolbar(page,'编辑画布');await expect(page.getByLabel('保存修改',{exact:true})).toBeVisible();await geometry(page);
  const canvas=(await page.locator('.dependency-canvas').boundingBox())!,toolbar=(await bar(page).boundingBox())!;expect(canvas.y).toBeGreaterThanOrEqual(toolbar.y+toolbar.height);
  await page.screenshot({path:info.outputPath('toolbar-edit-'+scope.scopeType+'.png')});
 }
 let release!:()=>void;const hold=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/projects/'+f.projectId+'/path-graph*',async route=>{await hold;await route.continue();});
 try{await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'graph',scopeType:'requirement',scopeId:f.testing.id}));await expect(bar(page)).toBeVisible();await geometry(page);const before=await bar(page).boundingBox();release();await ready(page);await geometry(page);expect(await bar(page).boundingBox()).toEqual(before);}finally{release();}
});
test.describe('触屏工具栏',()=>{
 test.use({hasTouch:true});
 test('关系图保存、返回和历史菜单触控入口可用',{tag:'@responsive'},async({page},info)=>{
  const f=await phaseFixture(page);await page.setViewportSize({width:390,height:844});await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'graph',scopeType:'requirement',scopeId:f.testing.id}));await ready(page);await graphToolbar(page,'编辑画布');await geometry(page);
  for(const name of ['保存修改','更多操作','上一级']){const box=(await bar(page).getByLabel(name,{exact:true}).boundingBox())!;expect(box.width).toBeGreaterThanOrEqual(32);expect(box.height).toBeGreaterThanOrEqual(32);}
  await bar(page).getByLabel('更多操作',{exact:true}).tap();await expect(page.getByRole('menu').getByRole('button',{name:'撤销修改',exact:true})).toBeVisible();await expect(page.getByRole('menu').getByRole('button',{name:'重做修改',exact:true})).toBeVisible();await page.keyboard.press('Escape');await page.screenshot({path:info.outputPath('toolbar-touch.png')});
 });
});
