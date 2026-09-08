import fs from 'node:fs';
import {test,expect,type Page} from '@playwright/test';
import {analysePaths,type PathInput,type PathAnalysis} from '../../src/shared/paths';
import type {Requirement,WorkItemTemplate} from '../../src/client/types';
import {addBusinessDays,todayIso} from '../../src/shared/domain';
import {req,work} from '../fixtures/path-network';
import {themes} from '../../src/client/theme';
async function fixture(page:Page){
 const login=await page.request.post('/api/login',{data:{username:'admin',password:'41_xc7q0qOjo4Inw!'}});expect(login.ok()).toBe(true);
 const session=await(await page.request.get('/api/session')).json();const name=`图验证${Date.now()}`;
 const project=await(await page.request.post('/api/projects',{data:{name,plannedEnd:addBusinessDays(todayIso(),3)}})).json();
 const owner=await(await page.request.post('/api/people',{data:{projectId:project.id,name:`负责人${Date.now()}`}})).json();
 const template=await(await page.request.post('/api/templates',{data:{projectId:project.id,name:'依赖流程',dependencyMode:'dependencies',items:[{clientKey:'a',title:'方案交付',durationDays:2,startOffsetDays:0,sortOrder:0,predecessorKeys:[]},{clientKey:'b',title:'集成验证',durationDays:3,startOffsetDays:2,sortOrder:1,predecessorKeys:['a']}]}})).json() as WorkItemTemplate;
 const create=async(title:string)=>await(await page.request.post('/api/requirements',{data:{projectId:project.id,templateId:template.id,ownerId:owner.id,title,plannedStart:addBusinessDays(todayIso(),0)}})).json() as Requirement;
 const a=await create('接口基础交付'),b=await create('订单交付');
 const analysis=async()=>await(await page.request.get(`/api/projects/${project.id}/path-analysis`)).json() as PathAnalysis;
 await page.request.post(`/api/projects/${project.id}/dependencies`,{data:{sourceRequirementId:a.id,sourceWorkItemId:a.workItems[0].id,targetRequirementId:b.id,targetWorkItemId:b.workItems[1].id,expectedRevision:(await analysis()).revision}});
 await page.addInitScript(({account,id})=>localStorage.setItem(`project-manage:selected-project:${account}`,id),{account:session.accountId,id:project.id});
 return {project,a,b,analysis};
}
const ready=(page:Page)=>expect(page.locator('[data-layout-ready="true"]')).toBeVisible({timeout:20000});
const viewport=(page:Page)=>page.locator('.react-flow__viewport').evaluate(n=>(n as HTMLElement).style.transform);
const openMore=async(page:Page)=>{const details=page.locator('.graph-detail .graph-more-relations');if(await details.count()&&(await details.first().getAttribute('open'))===null)await details.first().locator('summary').click();};
const selectList=async(page:Page,title:string)=>{if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();await page.getByRole('button',{name:/^节点 \d/}).click();await page.locator('.graph-auxiliary .graph-list-row>button:first-child').filter({hasText:title}).first().click();};
test('全局→需求→外部交付→返回，选择不移动视口且刷新恢复',async({page})=>{
 const {a,b,analysis}=await fixture(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/paths?pathScope=all');await ready(page);const before=await viewport(page);
 await selectList(page,b.title);expect(await viewport(page)).toBe(before);
 const globalUrl=page.url();const risk=(await analysis()).risks[b.id];
 await page.getByRole('button',{name:'进入需求路径',exact:true}).click();await ready(page);await expect(page.getByLabel('分析目标',{exact:true})).toHaveValue('project');
 await page.reload();await ready(page);await expect(page.getByLabel('分析目标',{exact:true})).toHaveValue('project');
 const local=await(await page.request.get('/api/requirements/'+b.id+'/path-analysis')).json() as PathAnalysis;expect(local.risks[b.id]).toEqual(risk);
 if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();await page.getByRole('button',{name:/^节点 \d/}).click();
 await page.locator('.graph-auxiliary .graph-list-row>button:first-child').filter({hasText:'方案交付'}).last().click();
 await page.getByRole('button',{name:'进入需求路径',exact:true}).click();await ready(page);await expect(page).toHaveURL(new RegExp(a.id));
 await page.getByRole('button',{name:'返回'+b.title+'路径',exact:true}).click();await ready(page);await page.getByRole('button',{name:'返回项目全局',exact:true}).click();await ready(page);expect(page.url()).toBe(globalUrl);
 await expect.poll(()=>viewport(page)).toBe(before);expect(errors).toEqual([]);
});
test('左键及中键平移、滚轮缩放；浮层隔离且定位才移动画布',async({page})=>{
 const {b}=await fixture(page);await page.goto('/requirements/'+b.id+'?view=path');await ready(page);
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
 await page.locator('.graph-detail').getByRole('button',{name:'定位',exact:true}).click();await expect.poll(()=>viewport(page)).not.toBe(current);await page.waitForTimeout(300);
 const selected=page.locator('.react-flow__node.selected'),box=(await selected.boundingBox())!,inspector=(await page.locator('.graph-detail').boundingBox())!;
 expect(box.x+box.width).toBeLessThanOrEqual(inspector.x+2);
});

test('草稿勾选、取消、撤销重做、恢复、批量保存与响应丢失回执',async({page})=>{
 const {a,b,analysis,project}=await fixture(page);await page.goto('/paths?pathScope=all');await ready(page);const before=await analysis();
 await selectList(page,b.title);await page.getByRole('button',{name:'编辑画布',exact:true}).click();await openMore(page);
 const check=page.getByRole('checkbox',{name:a.title,exact:true});await check.check();await expect(check).toBeChecked();
 await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeEnabled();expect((await analysis()).revision).toBe(before.revision);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(check).not.toBeChecked();await page.getByRole('button',{name:'重做',exact:true}).click();await expect(check).toBeChecked();
 await page.reload();await ready(page);await openMore(page);await expect(check).toBeChecked();await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeEnabled();
 let writes=0;await page.route('**/api/projects/'+project.id+'/dependency-changes/apply',async route=>{writes++;await route.fetch();await route.abort('failed');});
 await page.getByRole('button',{name:'保存修改',exact:true}).click();await expect(page.getByRole('button',{name:'编辑画布',exact:true})).toBeVisible();
 expect(writes).toBe(1);expect((await analysis()).dependencies).toHaveLength(before.dependencies.length+1);
 await page.unroute('**/api/projects/'+project.id+'/dependency-changes/apply');
 await page.getByRole('button',{name:'编辑画布',exact:true}).click();await openMore(page);await check.uncheck();await expect(check).not.toBeChecked();
 await page.getByRole('button',{name:'放弃修改',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'放弃草稿',exact:true}).click();
 expect((await analysis()).dependencies).toHaveLength(before.dependencies.length+1);
});
test('拖线与点击连接点创建；循环指出端点；流程属性与并行创建',async({page})=>{
 const {project}=await fixture(page);const seed=await(await page.request.post('/api/templates',{data:{projectId:project.id,name:'画布流程',dependencyMode:'dependencies',items:['设计','开发','联调','验收'].map((title,i)=>({clientKey:'k'+i,title,durationDays:1,startOffsetDays:i,sortOrder:i,predecessorKeys:i?['k'+(i-1)]:[]}))}})).json();await page.goto('/templates?edit='+seed.id);await ready(page);
 await page.getByRole('button',{name:'流程属性',exact:true}).click();await page.getByLabel('流程名称',{exact:true}).fill('画布流程');await page.getByLabel('流程名称',{exact:true}).blur();
 if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();await page.getByRole('button',{name:/^节点 \d/}).click();await page.locator('.graph-auxiliary .graph-list-row>button:first-child').filter({hasText:'开发'}).click();
 await openMore(page);const checkbox=page.getByRole('checkbox',{name:'设计',exact:true});await checkbox.uncheck();await expect(checkbox).not.toBeChecked();await checkbox.check();await expect(checkbox).toBeChecked();
 await page.getByRole('button',{name:'新增并行',exact:true}).click();await page.getByLabel('元素名称').fill('并行审核');await page.getByLabel('元素名称').blur();await ready(page);
 await openMore(page);await expect(page.getByRole('checkbox',{name:'设计',exact:true})).toBeChecked();await expect(page.getByRole('checkbox',{name:'开发',exact:true})).not.toBeChecked();
 // Explicitly clear before adding through business handles. These handles are separate from ELK's route ports.
 await page.getByRole('button',{name:'清空',exact:true}).last().click();await ready(page);
 await page.locator('.graph-detail').getByRole('button',{name:'关闭',exact:true}).click();
 if(await page.locator('.graph-auxiliary[aria-hidden="false"]').count())await page.locator('.graph-auxiliary[aria-hidden="false"]').getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('button',{name:'适配视图',exact:true}).click();await page.waitForTimeout(300);
 const source=page.locator('.react-flow__node').filter({hasText:'设计'}).locator('.business-handle[data-side="left"]');
 const dest=page.locator('.react-flow__node').filter({hasText:'并行审核'}).locator('.dependency-card');
 await source.click();await dest.click();await ready(page);
 if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();await page.getByRole('button',{name:/^节点 \d/}).click();await page.locator('.graph-auxiliary .graph-list-row>button:first-child').filter({hasText:'并行审核'}).click();await openMore(page);
 await expect(page.getByRole('checkbox',{name:'设计',exact:true})).toBeChecked();
 await page.getByRole('button',{name:'保存修改',exact:true}).click();await expect(page.getByRole('button',{name:'撤销',exact:true})).toBeDisabled();
 const templates=await(await page.request.get('/api/templates?projectId='+project.id)).json() as WorkItemTemplate[];
 const saved=templates.find(t=>t.name==='画布流程')!;expect(saved.items).toHaveLength(5);expect(saved.items.find(i=>i.title==='并行审核')?.predecessorIds).toEqual([saved.items.find(i=>i.title==='设计')!.id]);
});
test('所有主题和窄屏保持完整画布，颜色与面板变化不移动节点',async({page},testInfo)=>{
 const {b}=await fixture(page);await page.goto('/requirements/'+b.id+'?view=path');await ready(page);
 const positions=()=>page.locator('.react-flow__node').evaluateAll(nodes=>nodes.map(n=>({id:n.getAttribute('data-id'),transform:(n as HTMLElement).style.transform})).sort((a,b)=>a.id!.localeCompare(b.id!)));
 const baseline=await positions();for(const theme of themes){await page.evaluate(id=>{localStorage.setItem('project-manage:theme',id);window.dispatchEvent(new StorageEvent('storage',{key:'project-manage:theme',newValue:id}));},theme.id);await expect(page.locator('html')).toHaveAttribute('data-theme',theme.id);await ready(page);expect(await positions()).toEqual(baseline);}
 await page.evaluate(()=>{localStorage.setItem('project-manage:theme','system');window.dispatchEvent(new StorageEvent('storage',{key:'project-manage:theme',newValue:'system'}));});await page.emulateMedia({colorScheme:'dark'});await expect(page.locator('html')).toHaveAttribute('data-theme','dcim');await page.emulateMedia({colorScheme:'light'});await expect(page.locator('html')).toHaveAttribute('data-theme','classic');
 await page.setViewportSize({width:390,height:844});await ready(page);const box=await page.locator('.dependency-canvas').boundingBox();expect(box!.width).toBeGreaterThan(240);expect(box!.height).toBeGreaterThan(500);
 if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();await page.getByRole('button',{name:/^节点 \d/}).click();await page.locator('.graph-auxiliary .graph-list-row>button:first-child').first().click();
 await expect(page.locator('.graph-auxiliary')).toHaveCount(0);await expect(page.locator('.graph-detail')).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('paths-narrow.png'),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});


test('并发修改保留草稿，核对新版本后重新预览；执行入口先处理草稿',async({page})=>{
 const {a,b,analysis}=await fixture(page);await page.goto('/paths?pathScope=all');await ready(page);
 await selectList(page,b.title);await page.getByRole('button',{name:'编辑画布',exact:true}).click();await openMore(page);
 await page.getByRole('checkbox',{name:a.title,exact:true}).check();await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeEnabled();
 await page.request.patch('/api/work-items/'+b.workItems[0].id+'/path-estimate',{data:{expectedRevision:(await analysis()).revision,durationDays:6}});
 await page.getByRole('button',{name:'保存修改',exact:true}).click();await expect(page.locator('.graph-status-slot')).toContainText('版本冲突');
 await page.getByRole('button',{name:'版本冲突 · 查看修改',exact:true}).click();await expect(page.locator('.graph-auxiliary')).toContainText('草稿基于');await page.getByRole('button',{name:'已核对，按最新版本重新预览',exact:true}).click();
 await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'进入需求路径',exact:true}).click();await expect(page.getByLabel('分析目标',{exact:true})).toBeVisible();await ready(page);
 await expect(page.locator('.graph-status-slot').filter({hasText:'1 项未保存'})).toBeVisible();
 await selectList(page,'方案交付');await page.getByRole('button',{name:'定位并处理工作项',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'处理未保存修改'})).toBeVisible();await page.getByRole('button',{name:'继续编辑',exact:true}).click();
 await page.getByRole('button',{name:'保存修改',exact:true}).click();await expect(page.getByRole('button',{name:'编辑画布',exact:true})).toBeVisible();
 expect((await analysis()).nodes.find(n=>n.id===b.workItems[0].id)?.estimate.durationDays).toBe(6);
});
test('真实拖线建立合法跨需求往返；搜索不裁图，退出聚焦恢复视口',async({page})=>{
 const {a,b,analysis}=await fixture(page);await page.goto('/requirements/'+b.id+'?view=path');await ready(page);
 await page.getByRole('button',{name:'编辑画布',exact:true}).click();await openMore(page);await page.getByLabel('添加元素',{exact:true}).click();await page.locator('.graph-elements').getByRole('button',{name:'已有对象',exact:true}).click();
 await page.getByLabel('搜索已有对象',{exact:true}).fill('集成验证');await page.locator('.graph-auxiliary .graph-list-row>button:first-child').filter({hasText:'集成验证'}).filter({hasText:a.title}).click();await ready(page);
 await page.locator('.graph-detail').getByRole('button',{name:'关闭',exact:true}).click();
 if(await page.locator('.graph-auxiliary[aria-hidden="false"]').count())await page.locator('.graph-auxiliary[aria-hidden="false"]').getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('button',{name:'适配视图',exact:true}).click();await page.waitForTimeout(300);
 const from=page.locator('.react-flow__node[data-id="'+b.workItems[1].id+'"] .business-handle[data-side="left"]');
 const to=page.locator('.react-flow__node[data-id="'+a.workItems[1].id+'"] .dependency-card');
 const s=(await from.boundingBox())!,t=(await to.boundingBox())!;
 await page.mouse.move(s.x+s.width/2,s.y+s.height/2);await page.mouse.down();await page.mouse.move(t.x+t.width/2,t.y+t.height/2,{steps:15});await page.mouse.up();
 await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeEnabled();await page.getByRole('button',{name:'保存修改',exact:true}).click();
 await expect.poll(async()=>(await analysis()).dependencies.some(d=>d.sourceWorkItemId===b.workItems[1].id&&d.targetWorkItemId===a.workItems[1].id)).toBe(true);
 const count=await page.locator('.react-flow__node').count();if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();await page.getByRole('button',{name:/^节点 \d/}).click();
 if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();await page.getByLabel('筛选图中节点').fill('方案');expect(await page.locator('.react-flow__node').count()).toBe(count);
 await page.locator('.graph-auxiliary .graph-list-row>button:first-child').first().click();
 const original=await viewport(page);await page.getByRole('button',{name:'聚焦分支',exact:true}).click();await ready(page);
 await page.locator('.graph-detail').getByRole('button',{name:'定位',exact:true}).click();
 await page.locator('.graph-status-slot').getByRole('button',{name:'退出聚焦',exact:true}).click();await ready(page);await expect.poll(()=>viewport(page)).toBe(original);
});

test('权限拒绝时清除当前项目草稿，正式数据保持原状',async({page})=>{
 const {b,project,analysis}=await fixture(page),before=await analysis();
 await page.goto('/requirements/'+b.id+'?view=path');await ready(page);await selectList(page,'方案交付');
 await page.getByRole('button',{name:'编辑画布',exact:true}).click();await openMore(page);
 await page.route('**/api/projects/'+project.id+'/dependency-changes/preview',route=>route.fulfill({status:403,json:{error:'需求负责人已经变化',code:'FORBIDDEN'}}));
 await page.getByLabel('预计工期',{exact:true}).fill('4');await page.getByLabel('预计工期',{exact:true}).blur();
 await expect(page.getByRole('button',{name:'编辑画布',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('pm-graph-draft:')))).toEqual([]);
 expect((await analysis()).revision).toBe(before.revision);
});

test('新增项目保留当前草稿，退出登录清理会话草稿',async({page})=>{
 const {a,b}=await fixture(page);await page.goto('/paths?pathScope=all');await ready(page);await selectList(page,b.title);
 await page.getByRole('button',{name:'编辑画布',exact:true}).click();await openMore(page);await page.getByRole('checkbox',{name:a.title,exact:true}).check();
 await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeEnabled();
 await page.request.post('/api/projects',{data:{name:'新增项目不影响草稿'+Date.now()}});
 await page.evaluate(()=>{window.dispatchEvent(new Event('offline'));window.dispatchEvent(new Event('online'));});
 await expect(page.locator('.graph-status-slot').filter({hasText:'1 项未保存'})).toBeVisible();
 expect(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('pm-graph-draft:')).length)).toBeGreaterThan(0);
 await page.getByRole('link',{name:'项目进展',exact:true}).click();await page.getByRole('button',{name:'退出',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('pm-graph-draft:')).length)).toBe(0);
});
test('独立分支聚焦保留完整坐标和线路，刷新及范围外定位正确恢复',async({page})=>{
 const {project,a,b}=await fixture(page);
 const created=await page.request.post('/api/requirements',{data:{projectId:project.id,title:'独立分支',ownerId:a.ownerId,plannedStart:todayIso()}});expect(created.ok()).toBe(true);
 await page.goto('/paths?pathScope=all');await ready(page);
 const snapshot=()=>page.evaluate(()=>({nodes:[...document.querySelectorAll<HTMLElement>('.react-flow__node')].map(n=>({id:n.dataset.id,position:n.style.transform})).sort((a,b)=>a.id!.localeCompare(b.id!)),edges:[...document.querySelectorAll('.react-flow__edge-path')].map(n=>n.getAttribute('d')).sort()}));
 const before=await snapshot();await selectList(page,'独立分支');const original=await viewport(page);
 await page.getByRole('button',{name:'聚焦分支',exact:true}).click();await expect(page.locator('.react-flow__node:not(.graph-node-hidden)')).toHaveCount(3);await expect(page.locator('.graph-node-dim')).toHaveCount(2);
 await expect(page.locator('.graph-status-slot').getByRole('button',{name:'退出聚焦',exact:true})).toBeVisible();
 expect((await snapshot()).nodes).toEqual(before.nodes);
 await page.getByRole('button',{name:'适配视图',exact:true}).click();await page.waitForTimeout(300);await expect(page.locator('.react-flow__node:not(.graph-node-hidden)')).toHaveCount(3);await expect(page.locator('.graph-node-dim')).toHaveCount(2);
 await page.locator('.graph-status-slot').getByRole('button',{name:'退出聚焦',exact:true}).click();await expect.poll(()=>snapshot()).toEqual(before);await expect.poll(()=>viewport(page)).toBe(original);
 await page.getByRole('button',{name:'聚焦分支',exact:true}).click();await page.reload();await ready(page);
 await expect(page.locator('.react-flow__node:not(.graph-node-hidden)')).toHaveCount(3);await expect(page.locator('.graph-node-dim')).toHaveCount(2);
 await page.locator('.graph-status-slot').getByRole('button',{name:'退出聚焦',exact:true}).click();await expect.poll(()=>snapshot()).toEqual(before);await expect.poll(()=>viewport(page)).toBe(original);
 await page.getByRole('button',{name:'聚焦分支',exact:true}).click();if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();await page.getByRole('button',{name:/^节点 \d/}).click();
 if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();await page.getByLabel('筛选图中节点').fill(b.title);await expect(page.locator('.graph-list-row')).toContainText('分支外');
 await page.locator('.graph-list-row').getByRole('button',{name:'定位',exact:true}).click();await expect(page.locator('.graph-status-slot').getByRole('button',{name:'退出聚焦',exact:true})).toHaveCount(0);
 await expect(page.locator('.react-flow__node:not(.graph-node-hidden)')).toHaveCount(3);expect((await snapshot()).nodes).toEqual(before.nodes);
 // A focused draft changes the complete network, and returning never restores stale business data.
 if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();await page.getByLabel('筛选图中节点').fill('独立分支');await page.locator('.graph-list-row>button:first-child').click();
 await page.getByRole('button',{name:'聚焦分支',exact:true}).click();await page.getByRole('button',{name:'编辑画布',exact:true}).click();await openMore(page);
 await page.getByRole('checkbox',{name:b.title,exact:true}).check();await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeEnabled();await ready(page);
 await page.locator('.graph-status-slot').getByRole('button',{name:'退出聚焦',exact:true}).click();await expect(page.locator('.react-flow__node:not(.graph-node-hidden)')).toHaveCount(3);
 await expect(page.locator('.graph-status-slot').filter({hasText:'1 项未保存'})).toBeVisible();expect(await page.locator('.react-flow__edge').count()).toBeGreaterThan(before.edges.length);
});

test('浮层矩形无相交，底部对齐，390px 两行工具栏与减少动态效果',async({page})=>{
 const {b}=await fixture(page);await page.setViewportSize({width:1690,height:896});await page.goto('/requirements/'+b.id+'?view=path');await ready(page);await selectList(page,'集成验证');
 const check=async(stacked:boolean)=>{
  const rects=await page.evaluate(()=>Object.fromEntries(['.graph-toolbar','.graph-detail','.graph-auxiliary','.graph-footer','.graph-view-controls'].map(selector=>{const n=document.querySelector(selector);if(!n)return [selector,null];const r=n.getBoundingClientRect();return [selector,{left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height}];})));
  const boxes=Object.entries(rects).filter(([,r])=>r);for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i][1]!,b=boxes[j][1]!;expect(Math.min(a.right,b.right)-Math.max(a.left,b.left)>0&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>0,boxes[i][0]+' intersects '+boxes[j][0]).toBe(false);}
  const a=rects['.graph-footer']!,b=rects['.graph-view-controls']!;if(!stacked){expect(Math.abs(a.bottom-b.bottom)).toBeLessThan(1);expect(Math.abs(a.height-b.height)).toBeLessThan(1);}else expect(a.top-b.bottom).toBeGreaterThanOrEqual(11);
 };
 await check(false);await page.setViewportSize({width:390,height:844});await ready(page);if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();await page.getByRole('button',{name:/^节点 \d/}).click();await page.locator('.graph-list-row>button:first-child').first().click();await check(true);
 const previousMotions=await page.evaluate(()=>performance.getEntriesByName('pm-path-transition').length);
 await page.emulateMedia({reducedMotion:'reduce'});await page.getByLabel('编辑画布',{exact:true}).click();await page.getByRole('button',{name:'自动整理',exact:true}).click();await expect(page.locator('.dependency-canvas')).toHaveAttribute('data-layout-phase','waiting');await ready(page);
 expect(await page.evaluate(()=>performance.getEntriesByName('pm-path-transition').length)).toBe(previousMotions);
});

test('四侧连接到整张卡片，方向一致且每个手势只写一次，只路由线路且保留节点位置',async({page})=>{
 const {project}=await fixture(page);const titles=['起点','左侧目标','右侧目标','上侧目标','下侧目标'];
 const response=await page.request.post('/api/templates',{data:{projectId:project.id,name:'四侧连线',dependencyMode:'dependencies',items:titles.map((title,i)=>({clientKey:'k'+i,title,durationDays:1,startOffsetDays:0,sortOrder:i,predecessorKeys:[]}))}});expect(response.ok()).toBe(true);
 const template=await response.json() as WorkItemTemplate;await page.goto('/templates?edit='+template.id);await ready(page);
 for(const side of ['.graph-detail','.graph-auxiliary'])if(await page.locator(side).count())await page.locator(side).getByRole('button',{name:'关闭',exact:true}).click();
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 for(const [i,side] of ['left','right','top','bottom'].entries()){
  await page.getByRole('button',{name:'适配视图',exact:true}).click();await page.waitForTimeout(300);
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
 const submitted=page.waitForResponse(r=>r.url().endsWith('/api/templates/'+template.id)&&r.request().method()==='PATCH');await page.getByRole('button',{name:'保存修改',exact:true}).click();expect((await submitted).ok()).toBe(true);await expect(page.getByRole('button',{name:'撤销',exact:true})).toBeDisabled();
 const saved=(await(await page.request.get('/api/templates?projectId='+project.id)).json() as WorkItemTemplate[]).find(t=>t.id===template.id)!;
 for(const item of saved.items.slice(1))expect(item.predecessorIds).toEqual([saved.items[0].id]);expect(errors).toEqual([]);
});

test('连线取消不误建节点，循环与重复拒绝，空白创建和键盘连接共用方向规则',async({page})=>{
 const {project}=await fixture(page);
 const template=await(await page.request.post('/api/templates',{data:{projectId:project.id,name:'取消边界',dependencyMode:'dependencies',items:['前置','后续'].map((title,i)=>({clientKey:'k'+i,title,durationDays:1,startOffsetDays:0,sortOrder:i,predecessorKeys:[]}))}})).json() as WorkItemTemplate;
 await page.goto('/templates?edit='+template.id);await ready(page);
 for(const side of ['.graph-detail','.graph-auxiliary'])if(await page.locator(side).count())await page.locator(side).getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('button',{name:'适配视图',exact:true}).click();await page.waitForTimeout(300);
 const source=page.locator('.react-flow__node').filter({has:page.locator('strong',{hasText:/^前置$/})});
 const begin=async()=>{const box=(await source.locator('.business-handle[data-side=top]').boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();};
 const canvas=(await page.locator('.dependency-canvas').boundingBox())!,toolbar=(await page.locator('.graph-toolbar').boundingBox())!;
 for(const point of [{x:toolbar.x+20,y:toolbar.y+20},{x:-10,y:-10}]){await begin();await page.mouse.move(point.x,point.y,{steps:8});await page.mouse.up();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.react-flow__node')).toHaveCount(2);}
 const blank={x:canvas.x+25,y:canvas.y+canvas.height*.7};await begin();await page.mouse.move(blank.x,blank.y,{steps:8});await page.keyboard.press('Escape');await page.mouse.up();await expect(page.getByRole('dialog')).toHaveCount(0);
 await begin();await page.mouse.move(blank.x,blank.y,{steps:8});await page.mouse.up();await expect(page.getByRole('dialog')).toBeVisible();await page.getByLabel('新工作项标题').fill('新增后续');await page.getByRole('button',{name:'加入流程',exact:true}).click();await ready(page);
 for(const side of ['.graph-detail','.graph-auxiliary'])if(await page.locator(side).count())await page.locator(side).getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('button',{name:'适配视图',exact:true}).click();await page.waitForTimeout(300);
 const added=page.locator('.react-flow__node').filter({has:page.locator('strong',{hasText:/^新增后续$/})});
 await source.locator('.business-handle[data-side=bottom]').click();await added.locator('.dependency-card').click();await expect(page.getByRole('alert').last()).toContainText('已经存在');await expect(page.locator('.react-flow__edge')).toHaveCount(1);
 await added.locator('.business-handle[data-side=left]').click();await source.locator('.dependency-card').click();await expect(page.getByRole('alert').last()).toContainText('循环');await expect(page.locator('.react-flow__edge')).toHaveCount(1);
 await source.locator('.business-handle[data-side=right]').focus();await page.keyboard.press('Enter');
 const target=page.locator('.react-flow__node').filter({has:page.locator('strong',{hasText:/^后续$/})});await target.focus();await page.keyboard.press('Enter');await ready(page);await expect(page.locator('.react-flow__edge')).toHaveCount(2);
});

test('延迟布局与连续撤销重做只发布最新结构，拖线期间节点保持静止',async({page})=>{
 const {project}=await fixture(page);const template=await(await page.request.post('/api/templates',{data:{projectId:project.id,name:'布局竞争',dependencyMode:'dependencies',items:['前置','后续','并行'].map((title,i)=>({clientKey:'k'+i,title,durationDays:1,startOffsetDays:0,sortOrder:i,predecessorKeys:[]}))}})).json() as WorkItemTemplate;
 await page.route('**/fixed-routing.worker*.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+';{const send=self.postMessage.bind(self);let count=0;self.postMessage=(...args)=>{const n=++count;setTimeout(()=>send(...args),n%2===0?1000:600);};}'});});
 await page.goto('/templates?edit='+template.id);await ready(page);for(const side of ['.graph-detail','.graph-auxiliary'])if(await page.locator(side).count())await page.locator(side).getByRole('button',{name:'关闭',exact:true}).click();await page.getByRole('button',{name:'适配视图',exact:true}).click();await page.waitForTimeout(300);
 const node=(title:string)=>page.locator('.react-flow__node').filter({has:page.locator('strong',{hasText:new RegExp('^'+title+'$')})});
 await node('前置').locator('.business-handle[data-side=right]').click();await node('后续').locator('.dependency-card').click();
 await expect(page.locator('.dependency-canvas')).toHaveAttribute('data-layout-phase','layout');
 await page.getByRole('button',{name:'撤销',exact:true}).click();await page.getByRole('button',{name:'重做',exact:true}).click();
 await node('前置').locator('.business-handle[data-side=bottom]').click();
 const before=await page.locator('.react-flow__node').evaluateAll(nodes=>nodes.map(n=>(n as HTMLElement).style.transform));
 // Wait past the delayed Worker response while a click connection is armed.
 await page.waitForTimeout(850);expect(await page.locator('.react-flow__node').evaluateAll(nodes=>nodes.map(n=>(n as HTMLElement).style.transform))).toEqual(before);
 await node('并行').locator('.dependency-card').click();await ready(page);await expect(page.locator('.react-flow__edge')).toHaveCount(2);
 const submitted=page.waitForResponse(r=>r.url().endsWith('/api/templates/'+template.id)&&r.request().method()==='PATCH');await page.getByRole('button',{name:'保存修改',exact:true}).click();expect((await submitted).ok()).toBe(true);await expect(page.getByRole('button',{name:'撤销',exact:true})).toBeDisabled();
 const saved=(await(await page.request.get('/api/templates?projectId='+project.id)).json() as WorkItemTemplate[]).find(t=>t.id===template.id)!;
 expect(saved.items.slice(1).map(i=>i.predecessorIds)).toEqual([[saved.items[0].id],[saved.items[0].id]]);
});

test('20/80/200 个可见节点真实 Worker 布局，200 节点 600 边 p95 不超过 2 秒',async({page},testInfo)=>{
 test.skip(testInfo.project.name!=='office-1280','性能采样固定同一视口');test.setTimeout(240000);
 const {project}=await fixture(page);const samples:number[]=[],motionSamples:unknown[]=[];
 for(const count of [20,80,200])for(let sample=0;sample<(count===200?20:1);sample++){
  const requirements=Array.from({length:count},(_,i)=>({...req(`r${i}`),projectId:project.id,title:`交付需求 ${i+1}`}));
  const workItems=requirements.map((r,i)=>work(`w${i}`,r.id,1));const dependencies:PathInput['dependencies']=[];
  for(let i=1;i<count;i++)for(const delta of [1,3,7])if(i>=delta)dependencies.push({id:`e${i}-${delta}`,projectId:project.id,sourceRequirementId:`r${i-delta}`,sourceWorkItemId:`w${i-delta}`,targetRequirementId:`r${i}`,targetWorkItemId:`w${i}`,origin:'manual'});
  for(let i=12;dependencies.length<count*3;i++)dependencies.push({id:`extra${i}`,projectId:project.id,sourceRequirementId:`r${(i-11)%(count-11)}`,sourceWorkItemId:`w${(i-11)%(count-11)}`,targetRequirementId:`r${(i-11)%(count-11)+11}`,targetWorkItemId:`w${(i-11)%(count-11)+11}`,origin:'manual'});
  const input:PathInput={projectId:project.id,projectName:project.name,revision:sample,projectEnd:null,asOfDate:'2026-09-07',requirements,workItems,dependencies};const result=analysePaths(input);
  await page.route(`**/api/projects/${project.id}/path-analysis**`,route=>route.fulfill({json:result}));await page.goto('/paths?pathScope=all');await ready(page);await expect(page.locator('.react-flow__node')).toHaveCount(count);await page.getByLabel('适配视图',{exact:true}).click();await page.waitForTimeout(280);
  const elapsed=await page.evaluate(()=>performance.getEntriesByName('pm-path-layout').at(-1)!.duration);if(count===200)samples.push(elapsed);
  if(sample===0){await page.locator('.dependency-canvas').screenshot({path:testInfo.outputPath(`graph-${count}.png`)});const overlaps=await page.locator('.dependency-canvas').evaluate(root=>{
   const nodes=Array.from(root.querySelectorAll('.react-flow__node')).map(n=>n.getBoundingClientRect());const labels=Array.from(root.querySelectorAll('.dependency-edge-label rect')).map(n=>n.getBoundingClientRect());
   return labels.filter(a=>nodes.some(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)).length;
  });expect(overlaps).toBe(0);
   const changed=analysePaths({...input,revision:sample+1,dependencies:Array.from({length:count-1},(_,i)=>({id:'fan'+i,projectId:project.id,sourceRequirementId:'r0',sourceWorkItemId:'w0',targetRequirementId:'r'+(i+1),targetWorkItemId:'w'+(i+1),origin:'manual'}))});
   await page.unroute(`**/api/projects/${project.id}/path-analysis**`);await page.route(`**/api/projects/${project.id}/path-analysis**`,route=>route.fulfill({json:changed}));
   await page.getByRole('button',{name:'分析说明',exact:true}).click();
   const observation=page.evaluate(async()=>{const positions=new Set<string>(),intervals:number[]=[];let active=false,last=performance.now();await new Promise<void>((resolve,reject)=>{setTimeout(()=>reject(new Error('未检测到自动整理完成')),8000);const tick=(now:number)=>{const phase=document.querySelector('.dependency-canvas')!.getAttribute('data-layout-phase');if(phase==='moving')active=true;if(phase==='moving'){positions.add([...document.querySelectorAll<HTMLElement>('.react-flow__node')].map(n=>n.style.transform).join('|'));intervals.push(now-last);}last=now;if(active&&phase==='ready')resolve();else requestAnimationFrame(tick);};requestAnimationFrame(tick);});intervals.sort((a,b)=>a-b);return {frames:positions.size,p95FrameMs:intervals[Math.max(0,Math.ceil(intervals.length*.95)-1)]||0,maxFrameMs:Math.max(0,...intervals),waitMs:performance.getEntriesByName('pm-path-layout-wait').at(-1)!.duration,layoutMs:performance.getEntriesByName('pm-path-layout').at(-1)!.duration,transitionMs:performance.getEntriesByName('pm-path-transition').at(-1)!.duration};});
   await page.getByRole('button',{name:'刷新分析',exact:true}).click();await ready(page);await page.getByLabel('编辑画布',{exact:true}).click();await page.getByLabel('自动整理',{exact:true}).click();const motion=await observation;expect(motion.frames).toBeGreaterThan(3);
   await page.locator('.graph-auxiliary').getByRole('button',{name:'关闭',exact:true}).click();await page.waitForTimeout(210);
   await page.locator('.react-flow__node[data-id="r1"]').dispatchEvent('click');
   await expect(page.locator('.graph-detail').getByRole('button',{name:'聚焦分支',exact:true})).toBeVisible();
   const feedback=await page.evaluate(async()=>{const values:number[]=[];for(let i=0;i<20;i++){
    const card=document.querySelector<HTMLElement>('.react-flow__node[data-id="r2"] .dependency-card')!,before=Number(getComputedStyle(card).opacity);
    const button=[...document.querySelectorAll<HTMLButtonElement>('.graph-detail button')].find(b=>['聚焦分支','退出聚焦'].includes(b.getAttribute('aria-label')||b.textContent||''))!;
    const start=performance.now();button.click();await new Promise<void>(resolve=>{const tick=()=>{if(Math.abs(Number(getComputedStyle(card).opacity)-before)>.001||performance.now()-start>1500)resolve();else requestAnimationFrame(tick);};requestAnimationFrame(tick);});values.push(performance.now()-start);await new Promise(r=>setTimeout(r,210));
   }values.sort((a,b)=>a-b);return {samples:values.length,p95Ms:values[18],maxMs:values[19]};});
   motionSamples.push({nodes:count,...motion,feedback});fs.mkdirSync('.preview/qa',{recursive:true});fs.writeFileSync('.preview/qa/canvas-motion.json',JSON.stringify(motionSamples,null,2));expect(feedback.p95Ms).toBeLessThanOrEqual(100);expect(motion.p95FrameMs).toBeLessThanOrEqual(33);
   await expect(page.locator('.react-flow__edge')).toHaveCount(count-1);await page.getByLabel('放弃修改',{exact:true}).click();if(await page.getByRole('dialog').count())await page.getByRole('button',{name:'放弃草稿',exact:true}).click();await ready(page);
  }
  await page.unroute(`**/api/projects/${project.id}/path-analysis**`);
 }
 const sorted=[...samples].sort((a,b)=>a-b);const result={samples:samples.length,p50Ms:sorted[10],p95Ms:sorted[18],maxMs:sorted[19],browser:testInfo.project.use.channel,nodes:200,edges:600};fs.mkdirSync('.preview/qa',{recursive:true});fs.writeFileSync('.preview/qa/browser-layout.json',JSON.stringify(result,null,2));fs.writeFileSync('.preview/qa/canvas-motion.json',JSON.stringify(motionSamples,null,2));expect(result.p95Ms).toBeLessThanOrEqual(2000);
});


test('工作区筛选补上下文、完整拼音搜索与默认范围不改变布局',async({page})=>{
 const {project,a,b,analysis}=await fixture(page);
 const c=await(await page.request.post('/api/requirements',{data:{projectId:project.id,title:'独立历史交付',ownerId:a.ownerId,plannedStart:todayIso()}})).json() as Requirement;
 const data=await analysis();data.requirements.find(r=>r.id===c.id)!.status='completed';
 expect(data.requirements.find(r=>r.id===a.id)?.ownerId).toBe(a.ownerId);expect(data.nodes.find(n=>n.id===a.workItems[0].id)?.assigneeIds).toBeDefined();
 await page.route('**/api/projects/'+project.id+'/path-analysis**',route=>route.fulfill({json:data}));
 await page.goto('/paths');await ready(page);await expect(page.locator('.react-flow__node:not(.graph-node-hidden)')).toHaveCount(2);
 const positions=()=>page.locator('.react-flow__node').evaluateAll(nodes=>nodes.map(n=>(n as HTMLElement).style.transform));const before=await positions();
 if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();await page.getByRole('button',{name:/^筛选 ·/}).click();
 await page.locator('.path-filter-options fieldset').filter({has:page.locator('legend',{hasText:'需求负责人'})}).getByRole('checkbox').first().check();
 await page.getByRole('button',{name:'清空',exact:true}).click();
 if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();await page.getByLabel('筛选图中节点').fill('dulilishi');await expect(page.locator('.graph-list-row')).toHaveCount(1);await expect(page.locator('.graph-list-row')).toContainText('范围外');
 await page.getByRole('button',{name:'查看全部并定位',exact:true}).click();await page.waitForTimeout(300);await expect(page.locator('.react-flow__node:not(.graph-node-hidden)')).toHaveCount(3);expect(await positions()).toEqual(before);
 if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();await page.getByLabel('筛选图中节点').fill('找不到的需求abcdef');await expect(page.locator('.graph-auxiliary')).toContainText('没有匹配项');
 if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();await page.getByLabel('筛选图中节点').fill(b.title);await expect(page.locator('.graph-list-row')).toHaveCount(1);
 await page.getByRole('button',{name:'编辑画布',exact:true}).click();expect(await positions()).toEqual(before);
});

test('内部搜索项目外部工作，选择不扩图，明确定位后加入并支持刷新',async({page})=>{
 const {a,b,analysis}=await fixture(page),data=await analysis(),outside=a.workItems[1].id;
 data.nodes.find(n=>n.id===outside)!.title='范围外资源核查';
 await page.route('**/api/requirements/'+b.id+'/path-analysis?*',route=>route.fulfill({json:data}));
 await page.goto('/requirements/'+b.id+'?view=path&target=project');await ready(page);
 const ids=()=>page.locator('.react-flow__node').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-id')));const before=await ids();expect(before).not.toContain(outside);
 if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();await page.getByLabel('筛选图中节点').fill('ziyuanhecha');await expect(page.locator('.graph-list-row')).toHaveCount(1);
 await page.locator('.graph-list-row>button:first-child').click();await expect(page.locator('.graph-detail')).toContainText('范围外资源核查');expect(await ids()).toEqual(before);
 await page.getByRole('button',{name:'查看全部并定位',exact:true}).click();await ready(page);await expect(page.locator('.react-flow__node[data-id="'+outside+'"]')).toBeVisible();
 await page.reload();await ready(page);await expect(page.locator('.react-flow__node[data-id="'+outside+'"]')).toBeVisible();
});

test('返回来源失去权限时回到项目全局，不重复跳转',async({page})=>{
 const {a,b}=await fixture(page);await page.goto('/requirements/'+b.id+'?view=path');await ready(page);
 if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();await page.getByRole('button',{name:/^节点 \d/}).click();await page.locator('.graph-list-row>button:first-child').filter({hasText:'方案交付'}).last().click();
 await page.getByRole('button',{name:'进入需求路径',exact:true}).click();await ready(page);await expect(page).toHaveURL(new RegExp(a.id));
 await page.route('**/api/requirements/'+b.id,route=>route.fulfill({status:403,json:{message:'无权读取该需求',code:'FORBIDDEN'}}));
 await page.getByRole('button',{name:'返回'+b.title+'路径',exact:true}).click();await ready(page);await expect(page).toHaveURL(/\/paths/);await expect(page.locator('.graph-status-slot')).toContainText('来源已删除或不可访问');
});

test('工作区聚焦只变淡、原按钮退出、顶部固定且动画无重排',async({page})=>{
 const {project,a}=await fixture(page);await page.request.post('/api/requirements',{data:{projectId:project.id,title:'独立观察项',ownerId:a.ownerId,plannedStart:todayIso()}});
 await page.goto('/paths?pathScope=all');await ready(page);await selectList(page,a.title);
 const snapshot=()=>page.evaluate(()=>({top:document.querySelector('.graph-toolbar')!.getBoundingClientRect().height,canvas:document.querySelector('.dependency-canvas')!.getBoundingClientRect().height,positions:[...document.querySelectorAll<HTMLElement>('.react-flow__node')].map(n=>n.style.transform),routes:[...document.querySelectorAll('.react-flow__edge-path')].map(e=>e.getAttribute('d')),layouts:performance.getEntriesByName('pm-path-layout').length}));
 const before=await snapshot();await page.locator('.graph-detail').getByRole('button',{name:'聚焦分支',exact:true}).click();
 await expect(page.locator('.graph-node-dim')).toHaveCount(1);await expect(page.locator('.react-flow__node:not(.graph-node-hidden)')).toHaveCount(3);
 const samples=await page.locator('.graph-node-dim .dependency-card').evaluate(async e=>{const values:number[]=[];await new Promise<void>(resolve=>{const start=performance.now();const tick=()=>{values.push(Number(getComputedStyle(e).opacity));if(performance.now()-start>210)resolve();else requestAnimationFrame(tick);};tick();});return values;});
 expect(samples.some(v=>v>.35&&v<1)).toBe(true);expect(samples.at(-1)).toBeCloseTo(.35,2);expect(await snapshot()).toEqual(before);
 await page.locator('.graph-detail').getByRole('button',{name:'退出聚焦',exact:true}).click();await expect(page.locator('.graph-node-dim')).toHaveCount(0);expect(await snapshot()).toEqual(before);
 await page.locator('.graph-detail').getByRole('button',{name:'聚焦分支',exact:true}).click();await page.reload();await ready(page);await expect(page.locator('.graph-node-dim')).toHaveCount(1);
 await page.locator('.graph-detail').getByRole('button',{name:'退出聚焦',exact:true}).click();await expect(page.locator('.graph-node-dim')).toHaveCount(0);
});

test('工作区图上改接一次提交并可撤销，历史模板转换先预览',async({page})=>{
 const {project}=await fixture(page);
 const template=await(await page.request.post('/api/templates',{data:{projectId:project.id,name:'改接测试',dependencyMode:'dependencies',items:['原前置','后续','新前置'].map((title,i)=>({clientKey:'k'+i,title,durationDays:1,startOffsetDays:i,sortOrder:i,predecessorKeys:i===1?['k0']:[]}))}})).json() as WorkItemTemplate;
 await page.goto('/templates?edit='+template.id);await ready(page);await expect(page.locator('.graph-detail')).toHaveCount(0);await expect(page.locator('.graph-auxiliary')).toHaveCount(0);
 await page.locator('.react-flow__edge').first().dispatchEvent('click');await expect(page.getByRole('button',{name:'拖动改接前置'})).toBeVisible();
 await page.locator('.graph-detail').getByRole('button',{name:'关闭',exact:true}).click();await page.waitForTimeout(210);
 const source=page.getByRole('button',{name:'拖动改接前置'}),target=page.locator('.react-flow__node').filter({has:page.locator('strong',{hasText:/^新前置$/})});
 await source.dragTo(target.locator('.dependency-card'));await ready(page);await expect(page.locator('.graph-status-slot')).toContainText('草稿已保留');await expect(page.locator('.react-flow__edge')).toHaveCount(1);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await ready(page);await page.getByRole('button',{name:'重做',exact:true}).click();await ready(page);
 const submitted=page.waitForResponse(r=>r.url().endsWith('/api/templates/'+template.id)&&r.request().method()==='PATCH');await page.getByRole('button',{name:'保存修改',exact:true}).click();expect((await submitted).ok()).toBe(true);await expect(page.getByRole('button',{name:'撤销',exact:true})).toBeDisabled();
 const saved=(await(await page.request.get('/api/templates?projectId='+project.id)).json() as WorkItemTemplate[]).find(t=>t.id===template.id)!;expect(saved.items[1].predecessorIds).toEqual([saved.items[2].id]);
 const legacy=await(await page.request.post('/api/templates',{data:{projectId:project.id,name:'历史偏移检查',items:[{title:'阶段一',durationDays:2,startOffsetDays:0,sortOrder:0},{title:'阶段二',durationDays:1,startOffsetDays:5,sortOrder:1}]}})).json() as WorkItemTemplate;
 await page.goto('/templates?edit='+legacy.id);await ready(page);await expect(page.locator('.business-handle')).toHaveCount(0);await page.getByLabel('流程属性',{exact:true}).click();await page.getByRole('button',{name:'转换为依赖流程'}).click();await expect(page.getByRole('dialog')).toContainText('原偏移');await page.getByRole('button',{name:'确认转换，加入草稿'}).click();await ready(page);await expect(page.locator('.business-handle')).toHaveCount(8);
 expect((await(await page.request.get('/api/templates?projectId='+project.id)).json() as WorkItemTemplate[]).find(t=>t.id===legacy.id)?.dependencyMode).toBe('legacy');
});
