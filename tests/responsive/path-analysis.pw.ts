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
const selectList=async(page:Page,title:string)=>{await page.getByRole('button',{name:/^节点 \d/}).click();await page.locator('.graph-auxiliary .graph-list-row>button:first-child').filter({hasText:title}).first().click();};
test('全局→需求→外部交付→返回，选择不移动视口且刷新恢复',async({page})=>{
 const {a,b,analysis}=await fixture(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/paths?pathScope=all');await ready(page);const before=await viewport(page);
 await selectList(page,b.title);expect(await viewport(page)).toBe(before);
 const globalUrl=page.url();const risk=(await analysis()).risks[b.id];
 await page.getByRole('button',{name:'进入需求路径',exact:true}).click();await ready(page);await expect(page.getByLabel('分析目标',{exact:true})).toHaveValue('project');
 await page.reload();await ready(page);await expect(page.getByLabel('分析目标',{exact:true})).toHaveValue('project');
 const local=await(await page.request.get('/api/requirements/'+b.id+'/path-analysis')).json() as PathAnalysis;expect(local.risks[b.id]).toEqual(risk);
 await page.getByRole('button',{name:/^节点 \d/}).click();
 await page.locator('.graph-auxiliary .graph-list-row>button:first-child').filter({hasText:'方案交付'}).last().click();
 await page.getByRole('button',{name:'进入需求路径',exact:true}).click();await ready(page);await expect(page).toHaveURL(new RegExp(a.id));
 await page.getByRole('link',{name:'全局分析',exact:true}).click();await ready(page);expect(page.url()).toBe(globalUrl);
 await expect.poll(()=>viewport(page)).toBe(before);expect(errors).toEqual([]);
});
test('未激活不接管滚轮；中键、触控板、键盘及浮层隔离；定位才移动画布',async({page})=>{
 const {b}=await fixture(page);await page.goto('/requirements/'+b.id+'?view=path');await ready(page);
 const canvas=page.locator('.dependency-canvas'),bounds=(await canvas.boundingBox())!;
 const center={x:bounds.x+bounds.width*.5,y:bounds.y+bounds.height*.58};
 await page.mouse.move(center.x,center.y);const initial=await viewport(page);await page.mouse.wheel(0,120);
 expect(await viewport(page)).toBe(initial);await expect(canvas).toHaveAttribute('data-canvas-active','false');
 const outer=await page.evaluate(()=>({y:window.scrollY,main:document.querySelector('main')!.scrollTop}));
 await page.mouse.down({button:'middle'});await page.mouse.move(center.x-50,center.y-35,{steps:8});await page.mouse.up({button:'middle'});
 await expect(canvas).toHaveAttribute('data-canvas-active','true');await expect.poll(()=>viewport(page)).not.toBe(initial);
 expect(await page.evaluate(()=>({y:window.scrollY,main:document.querySelector('main')!.scrollTop}))).toEqual(outer);
 let current=await viewport(page);await page.mouse.wheel(70,110);await expect.poll(()=>viewport(page)).not.toBe(current);
 await page.keyboard.press('Escape');await expect(canvas).toHaveAttribute('data-canvas-active','false');
 await page.getByRole('button',{name:'操作画布',exact:true}).click();await expect(canvas).toHaveAttribute('data-canvas-active','true');
 current=await viewport(page);await page.mouse.move(center.x,center.y);await page.keyboard.down('Control');await page.mouse.wheel(0,-120);await page.keyboard.up('Control');await expect.poll(()=>viewport(page)).not.toBe(current);
 await page.keyboard.down('Space');await page.mouse.move(center.x,center.y);current=await viewport(page);await page.mouse.down();await page.mouse.move(center.x+55,center.y+35,{steps:6});await page.mouse.up();await page.keyboard.up('Space');await expect.poll(()=>viewport(page)).not.toBe(current);
 await page.getByRole('button',{name:/^节点 \d/}).click();current=await viewport(page);
 const list=page.locator('.graph-auxiliary');await list.hover();await page.mouse.wheel(0,900);expect(await viewport(page)).toBe(current);
 await page.locator('.graph-auxiliary .graph-list-row>button:first-child').first().click();expect(await viewport(page)).toBe(current);
 await page.locator('.graph-detail').getByRole('button',{name:'定位',exact:true}).click();await expect.poll(()=>viewport(page)).not.toBe(current);
 const selected=page.locator('.react-flow__node.selected'),box=(await selected.boundingBox())!,inspector=(await page.locator('.graph-detail').boundingBox())!;
 expect(box.x+box.width).toBeLessThanOrEqual(inspector.x+2);
});
test('草稿勾选、取消、撤销重做、恢复、批量保存与响应丢失回执',async({page})=>{
 const {a,b,analysis,project}=await fixture(page);await page.goto('/paths?pathScope=all');await ready(page);const before=await analysis();
 await selectList(page,b.title);await page.getByRole('button',{name:'编辑关系',exact:true}).click();
 const check=page.getByRole('checkbox',{name:a.title,exact:true});await check.check();await expect(check).toBeChecked();
 await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeEnabled();expect((await analysis()).revision).toBe(before.revision);
 await page.getByRole('button',{name:'撤销',exact:true}).click();await expect(check).not.toBeChecked();await page.getByRole('button',{name:'重做',exact:true}).click();await expect(check).toBeChecked();
 await page.reload();await ready(page);await expect(check).toBeChecked();await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeEnabled();
 let writes=0;await page.route('**/api/projects/'+project.id+'/dependency-changes/apply',async route=>{writes++;await route.fetch();await route.abort('failed');});
 await page.getByRole('button',{name:'保存修改',exact:true}).click();await expect(page.getByRole('button',{name:'编辑关系',exact:true})).toBeVisible();
 expect(writes).toBe(1);expect((await analysis()).dependencies).toHaveLength(before.dependencies.length+1);
 await page.unroute('**/api/projects/'+project.id+'/dependency-changes/apply');
 await page.getByRole('button',{name:'编辑关系',exact:true}).click();await check.uncheck();await expect(check).not.toBeChecked();
 await page.getByRole('button',{name:'取消编辑',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'放弃草稿',exact:true}).click();
 expect((await analysis()).dependencies).toHaveLength(before.dependencies.length+1);
});
test('拖线与点击连接点创建；循环指出端点；流程属性与并行创建',async({page})=>{
 const {project}=await fixture(page);await page.goto('/templates?edit=new');await ready(page);
 await page.getByLabel('流程名称',{exact:true}).fill('画布流程');await page.getByLabel('流程名称',{exact:true}).blur();
 await page.getByRole('button',{name:/^节点 \d/}).click();await page.locator('.graph-auxiliary .graph-list-row>button:first-child').filter({hasText:'开发'}).click();
 const checkbox=page.getByRole('checkbox',{name:'设计',exact:true});await checkbox.uncheck();await expect(checkbox).not.toBeChecked();await checkbox.check();await expect(checkbox).toBeChecked();
 await page.getByRole('button',{name:'添加并行工作',exact:true}).click();await page.getByLabel('新工作项标题').fill('并行审核');await page.getByRole('button',{name:'加入流程',exact:true}).click();await ready(page);
 await expect(page.getByRole('checkbox',{name:'设计',exact:true})).toBeChecked();await expect(page.getByRole('checkbox',{name:'开发',exact:true})).not.toBeChecked();
 // Explicitly clear before adding through business handles. These handles are separate from ELK's route ports.
 await page.getByRole('button',{name:'清空',exact:true}).click();await ready(page);
 await page.locator('.graph-detail').getByRole('button',{name:'关闭',exact:true}).click();
 if(await page.locator('.graph-auxiliary').count())await page.locator('.graph-auxiliary').getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('button',{name:'总览',exact:true}).click();
 const source=page.locator('.react-flow__node').filter({hasText:'设计'}).locator('.business-handle.source');
 const dest=page.locator('.react-flow__node').filter({hasText:'并行审核'}).locator('.business-handle.target');
 await source.click();await dest.click();await ready(page);
 await page.getByRole('button',{name:/^节点 \d/}).click();await page.locator('.graph-auxiliary .graph-list-row>button:first-child').filter({hasText:'并行审核'}).click();
 await expect(page.getByRole('checkbox',{name:'设计',exact:true})).toBeChecked();
 await page.getByRole('button',{name:'保存流程',exact:true}).click();await expect(page.locator('.template-flow-workspace')).toHaveCount(0);
 const templates=await(await page.request.get('/api/templates?projectId='+project.id)).json() as WorkItemTemplate[];
 const saved=templates.find(t=>t.name==='画布流程')!;expect(saved.items).toHaveLength(5);expect(saved.items.find(i=>i.title==='并行审核')?.predecessorIds).toEqual([saved.items.find(i=>i.title==='设计')!.id]);
});
test('所有主题和窄屏保持完整画布，颜色与面板变化不移动节点',async({page},testInfo)=>{
 const {b}=await fixture(page);await page.goto('/requirements/'+b.id+'?view=path');await ready(page);
 const positions=()=>page.locator('.react-flow__node').evaluateAll(nodes=>nodes.map(n=>({id:n.getAttribute('data-id'),transform:(n as HTMLElement).style.transform})).sort((a,b)=>a.id!.localeCompare(b.id!)));
 const baseline=await positions();for(const theme of themes){await page.getByRole('button',{name:/切换风格/}).click();await page.getByRole('menuitemradio',{name:new RegExp('^'+theme.label)}).click();await expect(page.locator('html')).toHaveAttribute('data-theme',theme.id);await ready(page);expect(await positions()).toEqual(baseline);}
 await page.getByRole('button',{name:/切换风格/}).click();await page.getByRole('menuitemradio',{name:/跟随系统/}).click();await page.emulateMedia({colorScheme:'dark'});await expect(page.locator('html')).toHaveAttribute('data-theme','dcim');await page.emulateMedia({colorScheme:'light'});await expect(page.locator('html')).toHaveAttribute('data-theme','classic');
 await page.setViewportSize({width:390,height:844});await ready(page);const box=await page.locator('.dependency-canvas').boundingBox();expect(box!.width).toBeGreaterThan(240);expect(box!.height).toBeGreaterThan(500);
 await page.getByRole('button',{name:/^节点 \d/}).click();await page.locator('.graph-auxiliary .graph-list-row>button:first-child').first().click();
 await expect(page.locator('.graph-auxiliary')).toHaveCount(0);await expect(page.locator('.graph-detail')).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('paths-narrow.png'),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});


test('并发修改保留草稿，核对新版本后重新预览；执行入口先处理草稿',async({page})=>{
 const {a,b,analysis}=await fixture(page);await page.goto('/paths?pathScope=all');await ready(page);
 await selectList(page,b.title);await page.getByRole('button',{name:'编辑关系',exact:true}).click();
 await page.getByRole('checkbox',{name:a.title,exact:true}).check();await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeEnabled();
 await page.request.patch('/api/work-items/'+b.workItems[0].id+'/path-estimate',{data:{expectedRevision:(await analysis()).revision,durationDays:6}});
 await page.getByRole('button',{name:'保存修改',exact:true}).click();await expect(page.locator('.warning-banner')).toContainText('草稿基于');
 await page.getByRole('button',{name:'核对冲突',exact:true}).click();await page.getByRole('button',{name:'已核对，按最新版本重新预览',exact:true}).click();
 await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'进入需求路径',exact:true}).click();await expect(page.getByLabel('分析目标',{exact:true})).toBeVisible();await ready(page);
 await expect(page.getByText('1 项未保存',{exact:true})).toBeVisible();
 await selectList(page,'方案交付');await page.getByRole('button',{name:'定位并处理工作项',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'处理未保存修改'})).toBeVisible();await page.getByRole('button',{name:'继续编辑',exact:true}).click();
 await page.getByRole('button',{name:'保存修改',exact:true}).click();await expect(page.getByRole('button',{name:'编辑关系',exact:true})).toBeVisible();
 expect((await analysis()).nodes.find(n=>n.id===b.workItems[0].id)?.estimate.durationDays).toBe(6);
});
test('真实拖线建立合法跨需求往返；搜索不裁图，退出聚焦恢复视口',async({page})=>{
 const {a,b,analysis}=await fixture(page);await page.goto('/requirements/'+b.id+'?view=path');await ready(page);
 await page.getByRole('button',{name:'编辑关系',exact:true}).click();await page.getByRole('button',{name:'引入外部交付',exact:true}).click();
 await page.getByLabel('搜索外部工作项',{exact:true}).fill('集成验证');await page.locator('.graph-auxiliary .graph-list-row>button:first-child').click();await ready(page);
 await page.locator('.graph-detail').getByRole('button',{name:'关闭',exact:true}).click();
 if(await page.locator('.graph-auxiliary').count())await page.locator('.graph-auxiliary').getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('button',{name:'总览',exact:true}).click();
 const from=page.locator('.react-flow__node[data-id="'+b.workItems[1].id+'"] .business-handle.source');
 const to=page.locator('.react-flow__node[data-id="'+a.workItems[1].id+'"] .business-handle.target');
 const s=(await from.boundingBox())!,t=(await to.boundingBox())!;
 await page.mouse.move(s.x+s.width/2,s.y+s.height/2);await page.mouse.down();await page.mouse.move(t.x+t.width/2,t.y+t.height/2,{steps:15});await page.mouse.up();
 await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeEnabled();await page.getByRole('button',{name:'保存修改',exact:true}).click();
 await expect.poll(async()=>(await analysis()).dependencies.some(d=>d.sourceWorkItemId===b.workItems[1].id&&d.targetWorkItemId===a.workItems[1].id)).toBe(true);
 const count=await page.locator('.react-flow__node').count();await page.getByRole('button',{name:/^节点 \d/}).click();
 await page.getByLabel('筛选图中节点').fill('方案');expect(await page.locator('.react-flow__node').count()).toBe(count);
 await page.locator('.graph-auxiliary .graph-list-row>button:first-child').first().click();
 const original=await viewport(page);await page.getByRole('button',{name:'聚焦分支',exact:true}).click();await ready(page);
 await page.locator('.graph-detail').getByRole('button',{name:'定位',exact:true}).click();
 await page.getByRole('button',{name:'退出分支聚焦',exact:true}).click();await ready(page);await expect.poll(()=>viewport(page)).toBe(original);
});

test('权限拒绝时清除当前项目草稿，正式数据保持原状',async({page})=>{
 const {b,project,analysis}=await fixture(page),before=await analysis();
 await page.goto('/requirements/'+b.id+'?view=path');await ready(page);await selectList(page,'方案交付');
 await page.getByRole('button',{name:'编辑关系',exact:true}).click();
 await page.route('**/api/projects/'+project.id+'/dependency-changes/preview',route=>route.fulfill({status:403,json:{error:'需求负责人已经变化',code:'FORBIDDEN'}}));
 await page.getByLabel('预计工期',{exact:true}).fill('4');await page.getByLabel('预计工期',{exact:true}).blur();
 await expect(page.getByRole('button',{name:'编辑关系',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('pm-graph-draft:')))).toEqual([]);
 expect((await analysis()).revision).toBe(before.revision);
});

test('新增项目保留当前草稿，退出登录清理会话草稿',async({page})=>{
 const {a,b}=await fixture(page);await page.goto('/paths?pathScope=all');await ready(page);await selectList(page,b.title);
 await page.getByRole('button',{name:'编辑关系',exact:true}).click();await page.getByRole('checkbox',{name:a.title,exact:true}).check();
 await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeEnabled();
 await page.request.post('/api/projects',{data:{name:'新增项目不影响草稿'+Date.now()}});
 await page.evaluate(()=>{window.dispatchEvent(new Event('offline'));window.dispatchEvent(new Event('online'));});
 await expect(page.getByText('1 项未保存',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('pm-graph-draft:')).length)).toBeGreaterThan(0);
 await page.getByRole('button',{name:'退出',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('pm-graph-draft:')).length)).toBe(0);
});
test('20/80/200 个可见节点真实 Worker 布局，200 节点 600 边 p95 不超过 2 秒',async({page},testInfo)=>{
 test.skip(testInfo.project.name!=='office-1280','性能采样固定同一视口');test.setTimeout(240000);
 const {project}=await fixture(page);const samples:number[]=[];
 for(const count of [20,80,200])for(let sample=0;sample<(count===200?20:1);sample++){
  const requirements=Array.from({length:count},(_,i)=>({...req(`r${i}`),projectId:project.id,title:`交付需求 ${i+1}`}));
  const workItems=requirements.map((r,i)=>work(`w${i}`,r.id,1));const dependencies:PathInput['dependencies']=[];
  for(let i=1;i<count;i++)for(const delta of [1,3,7])if(i>=delta)dependencies.push({id:`e${i}-${delta}`,projectId:project.id,sourceRequirementId:`r${i-delta}`,sourceWorkItemId:`w${i-delta}`,targetRequirementId:`r${i}`,targetWorkItemId:`w${i}`,origin:'manual'});
  for(let i=12;dependencies.length<count*3;i++)dependencies.push({id:`extra${i}`,projectId:project.id,sourceRequirementId:`r${(i-11)%(count-11)}`,sourceWorkItemId:`w${(i-11)%(count-11)}`,targetRequirementId:`r${(i-11)%(count-11)+11}`,targetWorkItemId:`w${(i-11)%(count-11)+11}`,origin:'manual'});
  const input:PathInput={projectId:project.id,projectName:project.name,revision:sample,projectEnd:null,asOfDate:'2026-09-07',requirements,workItems,dependencies};const result=analysePaths(input);
  await page.route(`**/api/projects/${project.id}/path-analysis`,route=>route.fulfill({json:result}));await page.goto('/paths?pathScope=all');await ready(page);await expect(page.locator('.react-flow__node')).toHaveCount(count);
  const elapsed=await page.evaluate(()=>performance.getEntriesByName('pm-path-layout').at(-1)!.duration);if(count===200)samples.push(elapsed);
  if(sample===0){await page.locator('.dependency-canvas').screenshot({path:testInfo.outputPath(`graph-${count}.png`)});const overlaps=await page.locator('.dependency-canvas').evaluate(root=>{
   const nodes=Array.from(root.querySelectorAll('.react-flow__node')).map(n=>n.getBoundingClientRect());const labels=Array.from(root.querySelectorAll('.dependency-edge-label rect')).map(n=>n.getBoundingClientRect());
   return labels.filter(a=>nodes.some(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)).length;
  });expect(overlaps).toBe(0);}
  await page.unroute(`**/api/projects/${project.id}/path-analysis`);
 }
 const sorted=[...samples].sort((a,b)=>a-b);const result={samples:samples.length,p50Ms:sorted[10],p95Ms:sorted[18],maxMs:sorted[19],browser:testInfo.project.use.channel,nodes:200,edges:600};fs.mkdirSync('.preview/qa',{recursive:true});fs.writeFileSync('.preview/qa/browser-layout.json',JSON.stringify(result,null,2));expect(result.p95Ms).toBeLessThanOrEqual(2000);
});
