import { headerAction as toolbarAction } from './topbar-helpers';
import {test,expect,type Page} from '@playwright/test';
import type {PathAnalysis} from '../../src/shared/paths';
import {mockGraphAnalysis} from './graph-analysis-fixture';
import type {Requirement,WorkItemTemplate} from '../../src/client/types';
import {addBusinessDays,todayIso} from '../../src/shared/domain';
import {themes} from '../../src/client/theme';
import {graphFixture as fixture} from './graph-fixture';
import {openGraph,closeGraphProperties,graphProperties,graphToolbar} from './graph-interactions';
const headerAction=async(page:Page,name:string)=>{await closeGraphProperties(page);await toolbarAction(page,name);};
async function expectClean(page:Page){
 const undo=page.getByRole('button',{name:'撤销',exact:true});
 if(await undo.isVisible())await expect(undo).toBeDisabled();
 else{await page.getByRole('button',{name:'更多操作',exact:true}).click();await expect(page.getByRole('button',{name:'撤销修改',exact:true})).toBeDisabled();await page.keyboard.press('Escape');}
}
const ready=(page:Page)=>expect(page.locator('[data-layout-ready="true"]')).toBeVisible({timeout:20000});
const viewport=(page:Page)=>page.locator('.react-flow__viewport').evaluate(n=>(n as HTMLElement).style.transform);

test('重进路径分析时恢复离屏视口会自动显示节点，正常视口保持不变',{tag:'@responsive'}, async({page})=>{
 const {project,a,analysis}=await fixture(page),before=await analysis();
 const session=await(await page.request.get('/api/session')).json();
 const key=`pm-graph-view:${session.accountId}:${project.id}:feature:${a.featureId}:right:current`;
 await openGraph(page,'/paths?pathScope=all');await ready(page);
 const normal=await viewport(page);
 await page.reload();await ready(page);expect(await viewport(page)).toBe(normal);
 await page.goto('/requirements');
 await page.evaluate(({key})=>{const value=JSON.stringify({x:-100000,y:-100000,zoom:1});localStorage.setItem(key,value);for(const saved of Object.keys(sessionStorage))if(saved.startsWith(key))sessionStorage.setItem(saved,value);},{key});
 await openGraph(page,'/paths?pathScope=all');await ready(page);
 const inView=async()=>page.locator('.react-flow__node:not(.graph-node-hidden)').evaluateAll(nodes=>{
   const canvas=document.querySelector('.dependency-canvas')!.getBoundingClientRect();
   return nodes.filter(node=>{const box=node.getBoundingClientRect();return box.right>canvas.left&&box.left<canvas.right&&box.bottom>canvas.top&&box.top<canvas.bottom;}).length;
 });
 await expect.poll(inView).toBeGreaterThan(0);
 const cached=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),key);
 expect(cached.x).not.toBe(-100000);expect(cached.y).not.toBe(-100000);
 const restored=await viewport(page);await page.reload();await ready(page);expect(await viewport(page)).toBe(restored);
 expect(await analysis()).toEqual(before);
});
const openMore=async(page:Page)=>{
 if(!await page.locator('.modal-card-workspace').isVisible())await graphProperties(page,page.locator('.react-flow__node.selected').first());
 const details=page.locator('.modal-card-workspace .graph-more-relations');
 if(await details.count()&&(await details.first().getAttribute('open'))===null)await details.first().locator('summary').click();
};


test('排期预览可独立拖动跨月并恢复，画布视口和正式数据不变化',{tag:'@responsive'}, async({page},info)=>{
 const {analysis}=await fixture(page);const before=await analysis();await page.emulateMedia({reducedMotion:'reduce'});
 await openGraph(page,'/paths');await ready(page);
 await page.getByRole('button',{name:'排期预览',exact:true}).click();
 const surface=page.locator('.path-gantt-scroll');await expect(surface).toHaveAttribute('data-gantt-ready','true');
 const view=await viewport(page),initial=await surface.evaluate(e=>e.scrollLeft),box=(await surface.boundingBox())!;
 await page.mouse.move(box.x+box.width-25,box.y+20);await page.mouse.down();await page.mouse.move(box.x+180,box.y+20,{steps:14});await page.mouse.up();
 await expect.poll(()=>surface.evaluate(e=>e.scrollLeft)).toBeGreaterThan(initial);expect(await viewport(page)).toBe(view);
 await page.getByLabel('跳转到日期',{exact:true}).fill('2027-01-12');await page.getByLabel('跳转到日期',{exact:true}).press('Enter');await expect(page.locator('.path-draft-gantt .gantt-visible-range')).toContainText('2027/01');
 const range=await page.locator('.path-draft-gantt .gantt-visible-range').textContent();await page.locator('.graph-auxiliary[aria-hidden="false"]').getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('button',{name:'排期预览',exact:true}).click();await expect(surface).toHaveAttribute('data-gantt-ready','true');expect(await page.locator('.path-draft-gantt .gantt-visible-range').textContent()).toBe(range);
 expect((await analysis()).revision).toBe(before.revision);expect(await viewport(page)).toBe(view);
 await page.screenshot({path:info.outputPath('path-gantt-navigation.png')});
});
const selectList=async(page:Page,title:string)=>{
 await closeGraphProperties(page);
 if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();
 await page.getByRole('button',{name:/^节点 \d/}).click();
 await page.locator('.graph-auxiliary .graph-list-row>button:first-child').filter({hasText:title}).first().click();
 if(await page.locator('.graph-auxiliary[aria-hidden="false"]').isVisible())await page.locator('.graph-auxiliary[aria-hidden="false"]').getByRole('button',{name:'关闭',exact:true}).click();
 if(await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();
 await graphProperties(page,page.locator('.react-flow__node.selected').first());
};
test('特性图进入需求与外部工作，详情风险一致且返回保留视口',{tag:'@responsive'},async({page})=>{
 const {a,b,analysis}=await fixture(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await openGraph(page,'/paths?pathScope=all');await ready(page);const before=await viewport(page);
 await page.evaluate(()=>Object.assign(window,{originalCanvas:document.querySelector('.dependency-canvas'),originalLayouts:performance.getEntriesByName('pm-path-layout').length}));
 await selectList(page,b.title);await ready(page);expect(await viewport(page)).toBe(before);
 expect(await page.evaluate(()=>{const w=window as typeof window&{originalCanvas:Element;originalLayouts:number};return w.originalCanvas===document.querySelector('.dependency-canvas')&&w.originalLayouts===performance.getEntriesByName('pm-path-layout').length;})).toBe(true);
 await expect(page.getByRole('dialog').getByRole('heading',{name:b.title,exact:true})).toBeVisible();
 await expect(page.locator('.requirement-overview')).toBeVisible();
 const risk=(await analysis()).risks[b.id];
 await page.getByRole('dialog').getByRole('button',{name:'进入需求',exact:true}).click();await ready(page);await expect(page).toHaveURL(new RegExp('scopeId='+b.id));
 await page.reload();await ready(page);await expect(page).toHaveURL(new RegExp('scopeId='+b.id));
 const local=await(await page.request.get('/api/requirements/'+b.id+'/path-analysis?target=project')).json() as PathAnalysis;expect(local.risks[b.id]).toEqual(risk);
 await graphProperties(page,page.locator('.react-flow__node[data-id="'+a.workItems[0].id+'"]'));
 await page.getByRole('dialog').getByRole('button',{name:'进入需求',exact:true}).click();await ready(page);await expect(page).toHaveURL(new RegExp('scopeId='+a.id));
 await page.getByRole('navigation',{name:'项目层级'}).getByRole('button',{name:'其他需求',exact:true}).click();await ready(page);
 await expect.poll(()=>viewport(page)).toBe(before);expect(errors).toEqual([]);
});
test('左键及中键平移、滚轮缩放；列表隔离且定位才移动画布',async({page})=>{
 const {b}=await fixture(page);await openGraph(page,'/requirements/'+b.id+'?view=path');await ready(page);
 const canvas=page.locator('.dependency-canvas'),bounds=(await canvas.boundingBox())!;
 const center={x:bounds.x+bounds.width*.5,y:bounds.y+bounds.height*.8};
 await expect(page.getByRole('button',{name:'操作画布',exact:true})).toHaveCount(0);
 await page.mouse.move(center.x,center.y);const initial=await viewport(page);await page.mouse.wheel(0,120);
 await expect.poll(()=>viewport(page)).not.toBe(initial);
 const zoomed=await viewport(page),outer=await page.evaluate(()=>({y:window.scrollY,main:document.querySelector('main')!.scrollTop}));
 await page.mouse.down();await page.mouse.move(center.x-45,center.y-25,{steps:8});await page.mouse.up();
 await expect.poll(()=>viewport(page)).not.toBe(zoomed);
 let current=await viewport(page);
 await page.mouse.down({button:'middle'});await page.mouse.move(center.x+40,center.y+15,{steps:8});await page.mouse.up({button:'middle'});
 await expect.poll(()=>viewport(page)).not.toBe(current);
 expect(await page.evaluate(()=>({y:window.scrollY,main:document.querySelector('main')!.scrollTop}))).toEqual(outer);
 await page.keyboard.down('Space');current=await viewport(page);await page.mouse.down();await page.mouse.move(center.x+75,center.y+35,{steps:6});await page.mouse.up();await page.keyboard.up('Space');
 await expect.poll(()=>viewport(page)).not.toBe(current);
 if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();await page.getByRole('button',{name:/^节点 \d/}).click();current=await viewport(page);
 const list=page.locator('.graph-auxiliary');await list.hover();await page.mouse.wheel(0,900);expect(await viewport(page)).toBe(current);
 await page.locator('.graph-auxiliary .graph-list-row>button:first-child').first().click();expect(await viewport(page)).toBe(current);
 await page.getByRole('button',{name:'定位所选节点',exact:true}).click();await expect.poll(()=>viewport(page)).not.toBe(current);await page.waitForTimeout(300);
 const selected=page.locator('.react-flow__node.selected'),box=(await selected.boundingBox())!;
 expect(box.x).toBeGreaterThanOrEqual(bounds.x);expect(box.x+box.width).toBeLessThanOrEqual(bounds.x+bounds.width);
});

test('草稿勾选、取消、撤销重做、恢复、批量保存与响应丢失回执',async({page})=>{
 const {a,b,analysis,project}=await fixture(page);await openGraph(page,'/paths?pathScope=all');await ready(page);const before=await analysis();
 await selectList(page,b.title);await graphToolbar(page,'编辑画布');await openMore(page);
 const check=page.getByRole('checkbox',{name:a.title,exact:true});await check.check();await expect(check).toBeChecked();
 await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeEnabled();expect((await analysis()).revision).toBe(before.revision);
 await graphToolbar(page,'撤销');await openMore(page);await expect(check).not.toBeChecked();await graphToolbar(page,'重做');await openMore(page);await expect(check).toBeChecked();
 await page.reload();await ready(page);await openMore(page);await expect(check).toBeChecked();await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeEnabled();
 let writes=0;await page.route('**/api/projects/'+project.id+'/dependency-changes/apply',async route=>{writes++;await route.fetch();await route.abort('failed');});
 await graphToolbar(page,'保存修改');await expect(page.getByRole('button',{name:'编辑画布',exact:true})).toBeVisible();
 expect(writes).toBe(1);expect((await analysis()).dependencies).toHaveLength(before.dependencies.length+1);
 await page.unroute('**/api/projects/'+project.id+'/dependency-changes/apply');
 await graphToolbar(page,'编辑画布');await openMore(page);await check.uncheck();await expect(check).not.toBeChecked();
 await headerAction(page,'放弃修改');await page.getByRole('dialog').getByRole('button',{name:'放弃草稿',exact:true}).click();
 expect((await analysis()).dependencies).toHaveLength(before.dependencies.length+1);
});
test('拖线与点击连接点创建；循环指出端点；流程属性与并行创建',async({page})=>{
 const {project}=await fixture(page);const seed=await(await page.request.post('/api/templates',{data:{projectId:project.id,name:'画布流程',dependencyMode:'dependencies',items:['设计','开发','联调','验收'].map((title,i)=>({clientKey:'k'+i,title,durationDays:1,startOffsetDays:i,sortOrder:i,predecessorKeys:i?['k'+(i-1)]:[]}))}})).json();await page.goto('/templates?edit='+seed.id);await ready(page);
 await headerAction(page,'流程属性');await page.getByLabel('流程名称',{exact:true}).fill('画布流程');await page.getByLabel('流程名称',{exact:true}).blur();
 if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();await page.getByRole('button',{name:/^节点 \d/}).click();await page.locator('.graph-auxiliary .graph-list-row>button:first-child').filter({hasText:'开发'}).click();
 await openMore(page);const checkbox=page.getByRole('checkbox',{name:'设计',exact:true});await checkbox.uncheck();await expect(checkbox).not.toBeChecked();await checkbox.check();await expect(checkbox).toBeChecked();
 await page.getByRole('button',{name:'新增并行',exact:true}).click();await page.getByLabel('元素名称').fill('并行审核');await page.getByLabel('元素名称').blur();await ready(page);
 await openMore(page);await expect(page.getByRole('checkbox',{name:'设计',exact:true})).toBeChecked();await expect(page.getByRole('checkbox',{name:'开发',exact:true})).not.toBeChecked();
 // Explicitly clear before adding through business handles. These handles are separate from ELK's route ports.
 await page.getByRole('button',{name:'清空',exact:true}).last().click();await ready(page);
 await closeGraphProperties(page);
 if(await page.locator('.graph-auxiliary[aria-hidden="false"]').count())await page.locator('.graph-auxiliary[aria-hidden="false"]').getByRole('button',{name:'关闭',exact:true}).click();
 await graphToolbar(page,'适配视图');await page.waitForTimeout(300);
 const source=page.locator('.react-flow__node').filter({hasText:'设计'}).locator('.business-handle[data-side="left"]');
 const dest=page.locator('.react-flow__node').filter({hasText:'并行审核'}).locator('.dependency-card');
 await source.click();await dest.click();await ready(page);
 if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();await page.getByRole('button',{name:/^节点 \d/}).click();await page.locator('.graph-auxiliary .graph-list-row>button:first-child').filter({hasText:'并行审核'}).click();await openMore(page);
 await expect(page.getByRole('checkbox',{name:'设计',exact:true})).toBeChecked();
 await graphToolbar(page,'保存修改');await expectClean(page);
 const templates=await(await page.request.get('/api/templates?projectId='+project.id)).json() as WorkItemTemplate[];
 const saved=templates.find(t=>t.name==='画布流程')!;expect(saved.items).toHaveLength(5);expect(saved.items.find(i=>i.title==='并行审核')?.predecessorIds).toEqual([saved.items.find(i=>i.title==='设计')!.id]);
});
test('所有主题和窄屏保持完整画布，颜色与面板变化不移动节点',{tag:'@responsive'}, async({page},testInfo)=>{
 const {b}=await fixture(page);await openGraph(page,'/requirements/'+b.id+'?view=path');await ready(page);
 const positions=()=>page.locator('.react-flow__node').evaluateAll(nodes=>nodes.map(n=>({id:n.getAttribute('data-id'),transform:(n as HTMLElement).style.transform})).sort((a,b)=>a.id!.localeCompare(b.id!)));
 const baseline=await positions();for(const theme of themes){await page.evaluate(id=>{localStorage.setItem('project-manage:theme',id);window.dispatchEvent(new StorageEvent('storage',{key:'project-manage:theme',newValue:id}));},theme.id);await expect(page.locator('html')).toHaveAttribute('data-theme',theme.id);await ready(page);expect(await positions()).toEqual(baseline);}
 await page.evaluate(()=>{localStorage.setItem('project-manage:theme','system');window.dispatchEvent(new StorageEvent('storage',{key:'project-manage:theme',newValue:'system'}));});await page.emulateMedia({colorScheme:'dark'});await expect(page.locator('html')).toHaveAttribute('data-theme','dcim');await page.emulateMedia({colorScheme:'light'});await expect(page.locator('html')).toHaveAttribute('data-theme','classic');
 await page.setViewportSize({width:390,height:844});await ready(page);const box=await page.locator('.dependency-canvas').boundingBox();expect(box!.width).toBeGreaterThan(240);expect(box!.height).toBeGreaterThan(500);
 if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();await page.getByRole('button',{name:/^节点 \d/}).click();await page.locator('.graph-auxiliary .graph-list-row>button:first-child').first().click();
 if(await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();
 await graphProperties(page,page.locator('.react-flow__node.selected').first());await expect(page.locator('.modal-card-workspace')).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('paths-narrow.png'),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});


test('不相交并发修改自动合并并保留草稿；执行入口仍检查相关依赖',async({page})=>{
 const {a,b,analysis}=await fixture(page);
 const assigned=await page.request.patch('/api/work-items/'+b.workItems[0].id,{data:{ownerId:b.ownerId,expectedVersion:b.workItems[0].version}});expect(assigned.ok()).toBe(true);
 await openGraph(page,'/paths?pathScope=all');await ready(page);
 await selectList(page,b.title);await graphToolbar(page,'编辑画布');await openMore(page);
 await page.getByRole('checkbox',{name:a.title,exact:true}).check();await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeEnabled();
 await page.request.patch('/api/work-items/'+b.workItems[0].id+'/path-estimate',{data:{expectedRevision:(await analysis()).revision,durationDays:6}});
 await graphToolbar(page,'保存修改');await expect(page.locator('.page-toolbar-status')).toContainText('1 项未保存');await expect(page.getByRole('button',{name:'版本冲突 · 查看修改',exact:true})).toHaveCount(0);expect((await analysis()).dependencies.some(d=>d.sourceRequirementId===a.id&&d.targetRequirementId===b.id&&!d.sourceWorkItemId&&!d.targetWorkItemId)).toBe(false);
 await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeEnabled();
 await openMore(page);await page.getByRole('button',{name:'进入工作项',exact:true}).click();await ready(page);await expect(page).toHaveURL(new RegExp('scopeId='+b.id));
 await expect(page.locator('.page-toolbar-status').filter({hasText:'1 项未保存'})).toBeVisible();
 await closeGraphProperties(page);await page.getByRole('button',{name:'清单',exact:true}).click();
 await page.locator('[data-object-id="'+b.workItems[0].id+'"] .outline-title').click();
 let executions=0;page.on('request',r=>{if(r.url().endsWith('/start')&&r.method()==='POST')executions++;});
 await page.getByRole('dialog').getByRole('button',{name:'开始',exact:true}).click();await expect(page.getByText(/本次操作涉及未保存业务草稿/)).toBeVisible();expect(executions).toBe(0);
 await closeGraphProperties(page);await page.getByRole('button',{name:'关系图',exact:true}).click();await ready(page);
 await graphToolbar(page,'保存修改');await expect(page.getByRole('button',{name:'编辑画布',exact:true})).toBeVisible();
 expect((await analysis()).nodes.find(n=>n.id===b.workItems[0].id)?.estimate.durationDays).toBe(6);expect((await analysis()).dependencies.some(d=>d.sourceRequirementId===a.id&&d.targetRequirementId===b.id&&!d.sourceWorkItemId&&!d.targetWorkItemId)).toBe(true);
});
test('真实拖线建立合法跨需求往返；搜索不裁图，退出聚焦恢复视口',{tag:'@responsive'}, async({page})=>{
 const {a,b,analysis}=await fixture(page);await openGraph(page,'/requirements/'+b.id+'?view=path');await ready(page);
 await graphToolbar(page,'编辑画布');await page.getByLabel('添加元素',{exact:true}).click();await page.locator('.graph-elements').getByRole('button',{name:'已有对象',exact:true}).click();
 await page.getByLabel('搜索已有对象',{exact:true}).fill('集成验证');await page.locator('.graph-auxiliary .graph-list-row>button:first-child').filter({hasText:'集成验证'}).filter({hasText:a.title}).click();await ready(page);
 await closeGraphProperties(page);
 if(await page.locator('.graph-auxiliary[aria-hidden="false"]').count())await page.locator('.graph-auxiliary[aria-hidden="false"]').getByRole('button',{name:'关闭',exact:true}).click();
 await graphToolbar(page,'适配视图');await page.waitForTimeout(300);
 const from=page.locator('.react-flow__node[data-id="'+b.workItems[1].id+'"] .business-handle[data-side="left"]');
 const to=page.locator('.react-flow__node[data-id="'+a.workItems[1].id+'"] .dependency-card');
 const s=(await from.boundingBox())!,t=(await to.boundingBox())!;
 await page.mouse.move(s.x+s.width/2,s.y+s.height/2);await page.mouse.down();await page.mouse.move(t.x+t.width/2,t.y+t.height/2,{steps:15});await page.mouse.up();
 await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeEnabled();await graphToolbar(page,'保存修改');
 await expect.poll(async()=>(await analysis()).dependencies.some(d=>d.sourceWorkItemId===b.workItems[1].id&&d.targetWorkItemId===a.workItems[1].id)).toBe(true);
 const count=await page.locator('.react-flow__node').count();if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();await page.getByRole('button',{name:/^节点 \d/}).click();
 if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();await page.getByLabel('筛选图中节点').fill('方案');expect(await page.locator('.react-flow__node').count()).toBe(count);
 await page.locator('.graph-auxiliary .graph-list-row>button:first-child').first().click();
 await page.locator('.graph-auxiliary[aria-hidden="false"]').getByRole('button',{name:'关闭',exact:true}).click();await graphToolbar(page,'编辑画布');await graphProperties(page,page.locator('.react-flow__node.selected').first());
 const original=await viewport(page);await page.getByRole('dialog').getByRole('button',{name:'聚焦分支',exact:true}).click();await ready(page);
 await page.locator('.modal-card-workspace').getByRole('button',{name:'定位',exact:true}).click();
 await headerAction(page,'退出聚焦');await ready(page);await expect.poll(()=>viewport(page)).toBe(original);
});

test('权限拒绝时清除当前项目草稿，正式数据保持原状',async({page})=>{
 const {b,project,analysis}=await fixture(page),before=await analysis();
 await openGraph(page,'/requirements/'+b.id+'?view=path');await ready(page);await selectList(page,'方案交付');
 await graphToolbar(page,'编辑画布');await openMore(page);
 await page.route('**/api/projects/'+project.id+'/dependency-changes/preview',route=>route.fulfill({status:403,json:{error:'需求负责人已经变化',code:'FORBIDDEN'}}));
 await page.getByLabel('预计工期',{exact:true}).fill('4');await page.getByLabel('预计工期',{exact:true}).blur();
 await expect(page.getByRole('button',{name:'编辑画布',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('pm-graph-draft:')))).toEqual([]);
 expect((await analysis()).revision).toBe(before.revision);
});

test('新增项目保留当前草稿，退出登录清理会话草稿',async({page})=>{
 const {a,b}=await fixture(page);await openGraph(page,'/paths?pathScope=all');await ready(page);await selectList(page,b.title);
 await graphToolbar(page,'编辑画布');await openMore(page);await page.getByRole('checkbox',{name:a.title,exact:true}).check();
 await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeEnabled();
 await page.request.post('/api/projects',{data:{name:'新增项目不影响草稿'+Date.now()}});
 await page.evaluate(()=>{window.dispatchEvent(new Event('offline'));window.dispatchEvent(new Event('online'));});
 await expect(page.locator('.page-toolbar-status').filter({hasText:'1 项未保存'})).toBeVisible();
 expect(await activeStoredDrafts(page)).toBeGreaterThan(0);
 await closeGraphProperties(page);await page.getByRole('link',{name:'问题跟踪',exact:true}).click();await page.getByRole('button',{name:/^账号菜单/}).click();await page.getByRole('menuitem',{name:'退出登录',exact:true}).click();
 await expect.poll(()=>activeStoredDrafts(page)).toBe(0);
});
test('独立分支聚焦保留完整坐标和线路，刷新及范围外定位正确恢复',{tag:'@responsive'},async({page})=>{
 const {project,a,b}=await fixture(page);
 const created=await page.request.post('/api/requirements',{data:{projectId:project.id,title:'独立分支',ownerId:a.ownerId,plannedStart:addBusinessDays(todayIso(),0)}});expect(created.ok(),await created.text()).toBe(true);const independent=await created.json();
 await openGraph(page,'/paths?pathScope=all');await ready(page);await graphToolbar(page,'编辑画布');
 const snapshot=()=>page.evaluate(()=>({nodes:[...document.querySelectorAll<HTMLElement>('.react-flow__node')].map(n=>({id:n.dataset.id,position:n.style.transform})).sort((a,b)=>a.id!.localeCompare(b.id!)),edges:[...document.querySelectorAll('.react-flow__edge-path')].map(n=>n.getAttribute('d')).sort()}));
 const before=await snapshot();await selectList(page,'独立分支');const original=await viewport(page);
 const focus=async()=>{if(await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();if(!await page.locator('.modal-card-workspace').isVisible())await graphProperties(page,page.locator('.react-flow__node[data-id="'+independent.id+'"]'));await page.getByRole('dialog').getByRole('button',{name:'聚焦分支',exact:true}).click();await closeGraphProperties(page);};
 await focus();await expect(page.locator('.react-flow__node:not(.graph-node-hidden)')).toHaveCount(3);await expect(page.locator('.graph-node-dim')).toHaveCount(2);expect((await snapshot()).nodes).toEqual(before.nodes);
 await graphToolbar(page,'适配视图');await page.waitForTimeout(300);await expect(page.locator('.graph-node-dim')).toHaveCount(2);
 await headerAction(page,'退出聚焦');await expect.poll(snapshot).toEqual(before);await expect.poll(()=>viewport(page)).toBe(original);
 await focus();await page.reload();await ready(page);await expect(page.locator('.graph-node-dim')).toHaveCount(2);
 await headerAction(page,'退出聚焦');await expect.poll(snapshot).toEqual(before);await expect.poll(()=>viewport(page)).toBe(original);
 await focus();if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();
 await page.getByLabel('筛选图中节点').fill(b.title);await expect(page.locator('.graph-list-row')).toContainText('分支外');
 await page.locator('.graph-list-row').getByRole('button',{name:'定位',exact:true}).click();await expect(page).not.toHaveURL(/pathBranch=/);
 await expect(page.locator('.react-flow__node:not(.graph-node-hidden)')).toHaveCount(3);expect((await snapshot()).nodes).toEqual(before.nodes);
 await page.getByLabel('筛选图中节点').fill('');if(await page.locator('.graph-auxiliary[aria-hidden="false"]').isVisible())await page.locator('.graph-auxiliary[aria-hidden="false"]').getByRole('button',{name:'关闭',exact:true}).click();await focus();await openMore(page);
 await page.getByRole('checkbox',{name:b.title,exact:true}).check();await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeEnabled();await ready(page);
 await headerAction(page,'退出聚焦');await expect(page.locator('.react-flow__node:not(.graph-node-hidden)')).toHaveCount(3);
 await expect(page.locator('.page-toolbar-status')).toContainText('1 项未保存');expect(await page.locator('.react-flow__edge').count()).toBeGreaterThan(before.edges.length);
});
test('居中详情与画布工具有界，窄屏底部两行且减少动态效果',{tag:'@responsive'},async({page})=>{
 const {b}=await fixture(page);await openGraph(page,'/requirements/'+b.id+'?view=path');await ready(page);
 for(const view of [page.viewportSize()!,{width:390,height:844}]){
  await page.setViewportSize(view);await selectList(page,'集成验证');
  const box=(await page.getByRole('dialog').boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(view.width+1);expect(box.y+box.height).toBeLessThanOrEqual(view.height+1);
  await closeGraphProperties(page);
  if(await page.locator('.graph-auxiliary[aria-hidden="false"]').isVisible())await page.locator('.graph-auxiliary[aria-hidden="false"]').getByRole('button',{name:'关闭',exact:true}).click();
  const footer=(await page.locator('.graph-footer').boundingBox())!,controls=(await page.locator('.graph-view-controls').boundingBox())!;
  expect(Math.min(footer.x+footer.width,controls.x+controls.width)-Math.max(footer.x,controls.x)>0&&Math.min(footer.y+footer.height,controls.y+controls.height)-Math.max(footer.y,controls.y)>0).toBe(false);
  if(view.width===390)expect(footer.y-controls.y-controls.height).toBeGreaterThanOrEqual(11);
  else expect(Math.abs(footer.y+footer.height-controls.y-controls.height)).toBeLessThan(1);
 }
 const previousMotions=await page.evaluate(()=>performance.getEntriesByName('pm-path-transition').length);
 await page.emulateMedia({reducedMotion:'reduce'});await graphToolbar(page,'编辑画布');await graphToolbar(page,'自动整理');await ready(page);
 expect(await page.evaluate(()=>performance.getEntriesByName('pm-path-transition').length)).toBe(previousMotions);
});
test('四侧连接到整张卡片，方向一致且每个手势只写一次，只路由线路且保留节点位置',async({page})=>{
 const {project}=await fixture(page);const titles=['起点','左侧目标','右侧目标','上侧目标','下侧目标'];
 const response=await page.request.post('/api/templates',{data:{projectId:project.id,name:'四侧连线',dependencyMode:'dependencies',items:titles.map((title,i)=>({clientKey:'k'+i,title,durationDays:1,startOffsetDays:0,sortOrder:i,predecessorKeys:[]}))}});expect(response.ok()).toBe(true);
 const template=await response.json() as WorkItemTemplate;await page.goto('/templates?edit='+template.id);await ready(page);
 for(const side of ['.modal-card-workspace','.graph-auxiliary'])if(await page.locator(side).count())await page.locator(side).getByRole('button',{name:'关闭',exact:true}).click();
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 for(const [i,side] of ['left','right','top','bottom'].entries()){
  await graphToolbar(page,'适配视图');await page.waitForTimeout(300);
  const from=page.locator('.react-flow__node').filter({has:page.locator('strong',{hasText:/^起点$/})}).locator('.business-handle[data-side='+side+']');
  const to=page.locator('.react-flow__node').filter({has:page.locator('strong',{hasText:titles[i+1]})}).locator('.dependency-card');
  const a=(await from.boundingBox())!,b=(await to.boundingBox())!;
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:10});
  await expect(page.locator('.graph-connection-hint')).toContainText('起点 完成后 '+titles[i+1]+' 开始');
  const before=await page.locator('.react-flow__node').evaluateAll(nodes=>nodes.map(n=>(n as HTMLElement).style.transform));
  await page.mouse.up();await expect(page.locator('.dependency-canvas')).toHaveAttribute('data-layout-phase','waiting');
  expect(await page.locator('.react-flow__node').evaluateAll(nodes=>nodes.map(n=>(n as HTMLElement).style.transform))).toEqual(before);
  const observed=await page.evaluate(async()=>{const seen=new Set<string>(),phases=new Set<string>();let started=false;await new Promise<void>(resolve=>{const tick=()=>{const p=document.querySelector('.dependency-canvas')!.getAttribute('data-layout-phase')!;phases.add(p);if(p!=='ready')started=true;seen.add([...document.querySelectorAll<HTMLElement>('.react-flow__node')].map(n=>n.style.transform).join('|'));if(started&&p==='ready')resolve();else requestAnimationFrame(tick);};tick();});return {frames:seen.size,phases:[...phases]};});
  expect(observed.frames).toBe(1);expect(await page.locator('.react-flow__node').evaluateAll(nodes=>nodes.map(n=>(n as HTMLElement).style.transform))).toEqual(before);
  await expect(page.locator('.react-flow__edge')).toHaveCount(i+1);
 }
 const submitted=page.waitForResponse(r=>r.url().endsWith('/api/templates/'+template.id)&&r.request().method()==='PATCH');await graphToolbar(page,'保存修改');expect((await submitted).ok()).toBe(true);await expectClean(page);
 const saved=(await(await page.request.get('/api/templates?projectId='+project.id)).json() as WorkItemTemplate[]).find(t=>t.id===template.id)!;
 for(const item of saved.items.slice(1))expect(item.predecessorIds).toEqual([saved.items[0].id]);expect(errors).toEqual([]);
});

test('连线取消不误建节点，循环与重复拒绝，空白创建和键盘连接共用方向规则',async({page})=>{
 const {project}=await fixture(page);
 const template=await(await page.request.post('/api/templates',{data:{projectId:project.id,name:'取消边界',dependencyMode:'dependencies',items:['前置','后续'].map((title,i)=>({clientKey:'k'+i,title,durationDays:1,startOffsetDays:0,sortOrder:i,predecessorKeys:[]}))}})).json() as WorkItemTemplate;
 await page.goto('/templates?edit='+template.id);await ready(page);
 for(const side of ['.modal-card-workspace','.graph-auxiliary'])if(await page.locator(side).count())await page.locator(side).getByRole('button',{name:'关闭',exact:true}).click();
 await graphToolbar(page,'适配视图');await page.waitForTimeout(300);
 const source=page.locator('.react-flow__node').filter({has:page.locator('strong',{hasText:/^前置$/})});
 const begin=async()=>{const box=(await source.locator('.business-handle[data-side=top]').boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();};
 const canvas=(await page.locator('.dependency-canvas').boundingBox())!,toolbar=(await page.locator('.topbar').boundingBox())!;
 for(const point of [{x:toolbar.x+20,y:toolbar.y+20},{x:-10,y:-10}]){await begin();await page.mouse.move(point.x,point.y,{steps:8});await page.mouse.up();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.react-flow__node')).toHaveCount(2);}
 const blank={x:canvas.x+25,y:canvas.y+canvas.height*.7};await begin();await page.mouse.move(blank.x,blank.y,{steps:8});await page.keyboard.press('Escape');await page.mouse.up();await expect(page.getByRole('dialog')).toHaveCount(0);
 await begin();await page.mouse.move(blank.x,blank.y,{steps:8});await page.mouse.up();await expect(page.getByRole('dialog')).toBeVisible();await page.getByLabel('新工作项标题').fill('新增后续');await page.getByRole('button',{name:'加入流程',exact:true}).click();await ready(page);
 for(const side of ['.modal-card-workspace','.graph-auxiliary'])if(await page.locator(side).count())await page.locator(side).getByRole('button',{name:'关闭',exact:true}).click();
 await graphToolbar(page,'适配视图');await page.waitForTimeout(300);
 const added=page.locator('.react-flow__node').filter({has:page.locator('strong',{hasText:/^新增后续$/})});
 await source.locator('.business-handle[data-side=bottom]').click();await added.locator('.dependency-card').click();await expect(page.getByRole('alert').last()).toContainText('已经存在');await expect(page.locator('.react-flow__edge')).toHaveCount(1);
 await added.locator('.business-handle[data-side=left]').click();await source.locator('.dependency-card').click();await expect(page.getByRole('alert').last()).toContainText('循环');await expect(page.locator('.react-flow__edge')).toHaveCount(1);
 await source.locator('.business-handle[data-side=right]').focus();await page.keyboard.press('Enter');
 const target=page.locator('.react-flow__node').filter({has:page.locator('strong',{hasText:/^后续$/})});await target.focus();await page.keyboard.press('Enter');await ready(page);await expect(page.locator('.react-flow__edge')).toHaveCount(2);
});

test('延迟布局与连续撤销重做只发布最新结构，拖线期间节点保持静止',{tag:'@responsive'}, async({page})=>{
 const {project}=await fixture(page);const template=await(await page.request.post('/api/templates',{data:{projectId:project.id,name:'布局竞争',dependencyMode:'dependencies',items:['前置','后续','并行'].map((title,i)=>({clientKey:'k'+i,title,durationDays:1,startOffsetDays:0,sortOrder:i,predecessorKeys:[]}))}})).json() as WorkItemTemplate;
 await page.route('**/fixed-routing.worker*.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+';{const send=self.postMessage.bind(self);let count=0;self.postMessage=(...args)=>{const n=++count;setTimeout(()=>send(...args),n%2===0?1000:600);};}'});});
 await page.goto('/templates?edit='+template.id);await ready(page);for(const side of ['.modal-card-workspace','.graph-auxiliary'])if(await page.locator(side).count())await page.locator(side).getByRole('button',{name:'关闭',exact:true}).click();await graphToolbar(page,'适配视图');await page.waitForTimeout(300);
 const node=(title:string)=>page.locator('.react-flow__node').filter({has:page.locator('strong',{hasText:new RegExp('^'+title+'$')})});
 await node('前置').locator('.business-handle[data-side=right]').click();await node('后续').locator('.dependency-card').click();
 await expect(page.locator('.dependency-canvas')).toHaveAttribute('data-layout-phase','layout');
 await graphToolbar(page,'撤销');await graphToolbar(page,'重做');
 await node('前置').locator('.business-handle[data-side=bottom]').click();
 const before=await page.locator('.react-flow__node').evaluateAll(nodes=>nodes.map(n=>(n as HTMLElement).style.transform));
 // Wait past the delayed Worker response while a click connection is armed.
 await page.waitForTimeout(850);expect(await page.locator('.react-flow__node').evaluateAll(nodes=>nodes.map(n=>(n as HTMLElement).style.transform))).toEqual(before);
 await node('并行').locator('.dependency-card').click();await ready(page);await expect(page.locator('.react-flow__edge')).toHaveCount(2);
 const submitted=page.waitForResponse(r=>r.url().endsWith('/api/templates/'+template.id)&&r.request().method()==='PATCH');await graphToolbar(page,'保存修改');expect((await submitted).ok()).toBe(true);await expectClean(page);
 const saved=(await(await page.request.get('/api/templates?projectId='+project.id)).json() as WorkItemTemplate[]).find(t=>t.id===template.id)!;
 expect(saved.items.slice(1).map(i=>i.predecessorIds)).toEqual([[saved.items[0].id],[saved.items[0].id]]);
});




test('工作区当前与全部筛选补上下文、完整拼音搜索不改变布局',{tag:'@responsive'}, async({page})=>{
 const {project,a,b,analysis}=await fixture(page);
 const created=await page.request.post('/api/requirements',{data:{projectId:project.id,title:'独立历史交付',ownerId:a.ownerId,plannedStart:addBusinessDays(todayIso(),0)}});expect(created.ok(),await created.text()).toBe(true);const c=await created.json() as Requirement;
 const data=await analysis();data.requirements.find(r=>r.id===c.id)!.status='completed';
 expect(data.requirements.find(r=>r.id===a.id)?.ownerId).toBe(a.ownerId);expect(data.nodes.find(n=>n.id===a.workItems[0].id)?.assigneeIds).toBeDefined();
 await mockGraphAnalysis(page,project.id,data);
 await openGraph(page,'/paths?pathStatuses=unfinished');await ready(page);await expect(page.locator('.react-flow__node:not(.graph-node-hidden)')).toHaveCount(2);
 const positions=()=>page.locator('.react-flow__node').evaluateAll(nodes=>nodes.map(n=>(n as HTMLElement).style.transform));const before=await positions();
 if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();await page.getByRole('button',{name:/^筛选 ·/}).click();
 const owner=page.locator('.path-filter-options fieldset').filter({has:page.locator('legend',{hasText:'需求负责人'})}).getByRole('checkbox').first();await owner.check();await owner.uncheck();
 if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();await page.getByLabel('筛选图中节点').fill('dulilishi');await expect(page.locator('.graph-list-row')).toHaveCount(1);await expect(page.locator('.graph-list-row')).toContainText('范围外');
 await page.getByRole('button',{name:'查看全部并定位',exact:true}).click();await page.waitForTimeout(300);await expect(page.locator('.react-flow__node:not(.graph-node-hidden)')).toHaveCount(3);expect(await positions()).toEqual(before);
 if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();await page.getByLabel('筛选图中节点').fill('找不到的需求abcdef');await expect(page.locator('.graph-auxiliary')).toContainText('没有匹配项');
 if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();await page.getByLabel('筛选图中节点').fill(b.title);await expect(page.locator('.graph-list-row')).toHaveCount(1);
 await graphToolbar(page,'编辑画布');expect(await positions()).toEqual(before);
});

test('内部搜索项目外部工作，选择不扩图，明确定位后加入并支持刷新',async({page})=>{
 const {a,b,analysis,project}=await fixture(page),data=await analysis(),outside=a.workItems[1].id;
 data.nodes.find(n=>n.id===outside)!.title='范围外资源核查';
 await mockGraphAnalysis(page,project.id,data);
 await openGraph(page,'/requirements/'+b.id+'?view=path&target=project');await ready(page);
 const ids=()=>page.locator('.react-flow__node').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-id')));const before=await ids();expect(before).not.toContain(outside);
 if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();await page.getByLabel('筛选图中节点').fill('ziyuanhecha');await expect(page.locator('.graph-list-row')).toHaveCount(1);
 await page.locator('.graph-list-row>button:first-child').click();await expect(page.locator('.graph-list-row')).toContainText('范围外资源核查');await expect(page).toHaveURL(new RegExp('pathNode='+outside));expect(await ids()).toEqual(before);
 await page.getByRole('button',{name:'查看全部并定位',exact:true}).click();await ready(page);await expect(page.locator('.react-flow__node[data-id="'+outside+'"]')).toBeVisible();
 await page.reload();await ready(page);await expect(page.locator('.react-flow__node[data-id="'+outside+'"]')).toBeVisible();
});

test('返回来源失去权限时隐藏旧画布，重新读取后恢复项目入口',async({page})=>{
 const {project,a,b}=await fixture(page);await openGraph(page,'/requirements/'+b.id+'?view=path');await ready(page);
 await graphProperties(page,page.locator('.react-flow__node[data-id="'+a.workItems[0].id+'"]'));
 await page.getByRole('dialog').getByRole('button',{name:'进入需求',exact:true}).click();await ready(page);await expect(page).toHaveURL(new RegExp('scopeId='+a.id));
 let denied=true;await page.route('**/api/projects/'+project.id+'/path-graph**',route=>denied?route.fulfill({status:403,json:{error:'无权读取该项目',code:'FORBIDDEN'}}):route.fallback());
 await page.goBack();await expect(page.getByText('无权读取该项目',{exact:true})).toBeVisible();await expect(page.locator('.dependency-canvas')).toHaveCount(0);
 await closeGraphProperties(page);denied=false;await page.getByRole('button',{name:/^重新(读取|加载)$/,exact:true}).click();await ready(page);
 await page.getByRole('navigation',{name:'项目层级'}).getByRole('button').first().click();await ready(page);await expect(page).toHaveURL(/scopeType=project/);
});

test('工作区聚焦只变淡、原按钮退出、顶部固定且动画无重排',{tag:'@responsive'},async({page})=>{
 const {project,a}=await fixture(page);const created=await page.request.post('/api/requirements',{data:{projectId:project.id,title:'独立观察项',ownerId:a.ownerId,plannedStart:addBusinessDays(todayIso(),0)}});expect(created.ok(),await created.text()).toBe(true);
 await openGraph(page,'/paths?pathScope=all');await ready(page);await graphToolbar(page,'编辑画布');await selectList(page,a.title);
 const snapshot=()=>page.evaluate(()=>({top:document.querySelector('.topbar')!.getBoundingClientRect().height,canvas:document.querySelector('.dependency-canvas')!.getBoundingClientRect().height,positions:[...document.querySelectorAll<HTMLElement>('.react-flow__node')].map(n=>n.style.transform),routes:[...document.querySelectorAll('.react-flow__edge-path')].map(e=>e.getAttribute('d')),layouts:performance.getEntriesByName('pm-path-layout').length}));
 const before=await snapshot();await page.locator('.modal-card-workspace').getByRole('button',{name:'聚焦分支',exact:true}).click();
 await expect(page.locator('.graph-node-dim')).toHaveCount(1);await expect(page.locator('.react-flow__node:not(.graph-node-hidden)')).toHaveCount(3);
 const samples=await page.locator('.graph-node-dim .dependency-card').evaluate(async e=>{const values:number[]=[];await new Promise<void>(resolve=>{const start=performance.now();const tick=()=>{values.push(Number(getComputedStyle(e).opacity));if(performance.now()-start>210)resolve();else requestAnimationFrame(tick);};tick();});return values;});
 expect(samples.some(v=>v>.35&&v<1)).toBe(true);expect(samples.at(-1)).toBeCloseTo(.35,2);expect(await snapshot()).toEqual(before);
 await page.locator('.modal-card-workspace').getByRole('button',{name:'退出聚焦',exact:true}).click();await expect(page.locator('.graph-node-dim')).toHaveCount(0);expect(await snapshot()).toEqual(before);
 await page.locator('.modal-card-workspace').getByRole('button',{name:'聚焦分支',exact:true}).click();await page.reload();await ready(page);await expect(page.locator('.graph-node-dim')).toHaveCount(1);
 await page.locator('.modal-card-workspace').getByRole('button',{name:'退出聚焦',exact:true}).click();await expect(page.locator('.graph-node-dim')).toHaveCount(0);
});

test('工作区图上改接一次提交并可撤销，历史模板转换先预览',async({page})=>{
 const {project}=await fixture(page);
 const template=await(await page.request.post('/api/templates',{data:{projectId:project.id,name:'改接测试',dependencyMode:'dependencies',items:['原前置','后续','新前置'].map((title,i)=>({clientKey:'k'+i,title,durationDays:1,startOffsetDays:i,sortOrder:i,predecessorKeys:i===1?['k0']:[]}))}})).json() as WorkItemTemplate;
 await page.goto('/templates?edit='+template.id);await ready(page);await expect(page.locator('.modal-card-workspace')).toHaveCount(0);await expect(page.locator('.graph-auxiliary')).toHaveCount(0);
 await page.locator('.react-flow__edge').first().dispatchEvent('click');await expect(page.getByRole('button',{name:'拖动改接前置'})).toBeVisible();
 await page.locator('.modal-card-workspace').getByRole('button',{name:'关闭',exact:true}).click();await page.waitForTimeout(210);
 const source=page.getByRole('button',{name:'拖动改接前置'}),target=page.locator('.react-flow__node').filter({has:page.locator('strong',{hasText:/^新前置$/})});
 await source.dragTo(target.locator('.dependency-card'));await ready(page);await expect(page.locator('.page-toolbar-status')).toContainText('草稿已保留');await expect(page.locator('.react-flow__edge')).toHaveCount(1);
 await graphToolbar(page,'撤销');await ready(page);await graphToolbar(page,'重做');await ready(page);
 const submitted=page.waitForResponse(r=>r.url().endsWith('/api/templates/'+template.id)&&r.request().method()==='PATCH');await graphToolbar(page,'保存修改');expect((await submitted).ok()).toBe(true);await expectClean(page);
 const saved=(await(await page.request.get('/api/templates?projectId='+project.id)).json() as WorkItemTemplate[]).find(t=>t.id===template.id)!;expect(saved.items[1].predecessorIds).toEqual([saved.items[2].id]);
 const legacy=await(await page.request.post('/api/templates',{data:{projectId:project.id,name:'历史偏移检查',items:[{title:'阶段一',durationDays:2,startOffsetDays:0,sortOrder:0},{title:'阶段二',durationDays:1,startOffsetDays:5,sortOrder:1}]}})).json() as WorkItemTemplate;
 await page.goto('/templates?edit='+legacy.id);await ready(page);await expect(page.locator('.business-handle')).toHaveCount(0);await headerAction(page,'流程属性');await page.getByRole('button',{name:'转换为依赖流程'}).click();await expect(page.getByRole('dialog')).toContainText('原偏移');await page.getByRole('button',{name:'确认转换，加入草稿'}).click();await ready(page);await expect(page.locator('.business-handle')).toHaveCount(8);
 expect((await(await page.request.get('/api/templates?projectId='+project.id)).json() as WorkItemTemplate[]).find(t=>t.id===legacy.id)?.dependencyMode).toBe('legacy');
});




async function activeStoredDrafts(page:import('@playwright/test').Page){return page.evaluate(()=>new Promise<number>((resolve,reject)=>{const request=indexedDB.open('pm-editor-drafts-v1',1);request.onsuccess=()=>{const db=request.result;if(!db.objectStoreNames.contains('drafts')){db.close();resolve(0);return;}const query=db.transaction('drafts').objectStore('drafts').getAll();query.onsuccess=()=>{resolve(query.result.filter(v=>v?.active).length);db.close();};query.onerror=()=>reject(query.error);};request.onerror=()=>reject(request.error);}));}
