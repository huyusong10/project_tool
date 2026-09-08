
import {test,expect,chromium,type Page} from '@playwright/test';
import {type PathAnalysis} from '../../src/shared/paths';
import type {Requirement,WorkItemTemplate} from '../../src/client/types';
import {addBusinessDays,todayIso} from '../../src/shared/domain';


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
const viewportValue=(page:Page)=>page.locator('.react-flow__viewport').evaluate(e=>(e as HTMLElement).style.transform);
const positionsValue=(page:Page)=>page.locator('.react-flow__node').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[(n as HTMLElement).dataset.id,(n as HTMLElement).style.transform])));
const blank=(page:Page)=>page.locator('.react-flow__pane').click({position:{x:12,y:300}});

test('新增里程碑与连线不移动已有视口，提示紧凑，循环说明包含真实部分交付',async({page},info)=>{
 const {a,b,analysis}=await fixture(page);await page.goto('/paths?pathScope=all');await ready(page);
 const beforeViewport=await viewportValue(page),beforePositions=await positionsValue(page),revision=(await analysis()).revision;
 await page.getByLabel('编辑画布',{exact:true}).click();await page.getByLabel('添加元素',{exact:true}).click();await page.locator('.graph-elements').getByRole('button',{name:'里程碑',exact:true}).click();
 const canvas=(await page.locator('.dependency-canvas').boundingBox())!;await page.mouse.click(canvas.x+canvas.width*.5,canvas.y+canvas.height*.7);await expect(page.locator('.react-flow__node')).toHaveCount(3);await ready(page);
 expect(await viewportValue(page)).toBe(beforeViewport);const after=await positionsValue(page);for(const [id,value] of Object.entries(beforePositions))expect(after[id]).toBe(value);
 await blank(page);const source=page.locator('.react-flow__node[data-id="'+b.id+'"]'),target=page.locator('.react-flow__node[data-id="'+a.id+'"]');
 await source.locator('.business-handle[data-side="top"]').click();const notice=page.locator('.graph-connection-hint');await expect(notice).toBeVisible();expect((await notice.boundingBox())!.height).toBeLessThan(90);expect((await notice.boundingBox())!.width).toBeLessThanOrEqual(251);
 await target.locator('.dependency-card').click({position:{x:80,y:45}});await expect(page.locator('.graph-error-notice')).toContainText('循环');expect((await page.locator('.graph-error-notice').boundingBox())!.height).toBeLessThan(120);
 await page.getByRole('button',{name:'查看循环路径',exact:true}).click();await expect(page.locator('.graph-cycle-path')).toContainText(a.title);await expect(page.locator('.graph-cycle-path')).toContainText(b.title);await expect(page.locator('.graph-edge-presentation.is-invalid')).not.toHaveCount(0);
 expect(await viewportValue(page)).toBe(beforeViewport);expect((await analysis()).revision).toBe(revision);await expect(page.getByText('正在计算布局…',{exact:true})).toHaveCount(0);await page.waitForTimeout(220);await page.screenshot({path:info.outputPath('cycle-diagnostic.png')});
 await page.locator('.graph-auxiliary').getByRole('button',{name:'关闭',exact:true}).click();await expect(page.locator('.graph-error-notice')).toHaveCount(0);await ready(page);expect(await viewportValue(page)).toBe(beforeViewport);
});

test('添加菜单、分析抽屉和属性按外部点击或Esc关闭，输入草稿保留',async({page},info)=>{
 const {a}=await fixture(page);await page.goto('/paths?pathScope=all');await ready(page);await page.getByLabel('编辑画布',{exact:true}).click();
 await page.getByLabel('添加元素',{exact:true}).click();await expect(page.locator('.graph-element-menu')).toHaveAttribute('open','');await blank(page);await expect(page.locator('.graph-element-menu')).not.toHaveAttribute('open','');
 await page.getByLabel('添加元素',{exact:true}).click();await page.keyboard.press('Escape');await expect(page.locator('.graph-element-menu')).not.toHaveAttribute('open','');
 await page.locator('.react-flow__node[data-id="'+a.id+'"] .dependency-card').click();await page.getByLabel('元素名称').fill('属性关闭前保存的草稿');await page.getByLabel('元素负责人').focus();await expect(page.locator('.graph-detail[aria-hidden="false"]')).toBeVisible();await blank(page);await expect(page.locator('.graph-detail[aria-hidden="false"]')).toHaveCount(0);
 await page.locator('.react-flow__node[data-id="'+a.id+'"] .dependency-card').click();await expect(page.getByLabel('元素名称')).toHaveValue('属性关闭前保存的草稿');
 await page.getByLabel('元素名称').fill('点击画布时保留未失焦输入');await blank(page);await expect(page.locator('.graph-detail[aria-hidden="false"]')).toHaveCount(0);await page.locator('.react-flow__node[data-id="'+a.id+'"] .dependency-card').click();await expect(page.getByLabel('元素名称')).toHaveValue('点击画布时保留未失焦输入');
 await page.getByRole('button',{name:'余量',exact:true}).click();await expect(page.locator('.path-float-distribution')).toBeVisible();expect((await page.locator('.graph-auxiliary').boundingBox())!.height).toBeLessThan(230);const entries=await page.locator('.path-float-distribution button').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().y));expect(new Set(entries).size).toBe(1);
 const before=await viewportValue(page);await page.locator('.path-float-distribution button').last().click();await expect(page.locator('.path-float-results')).toBeVisible();expect(await viewportValue(page)).toBe(before);await page.keyboard.press('Escape');await expect(page.locator('.graph-auxiliary[aria-hidden="false"]')).toHaveCount(0);
 await page.getByRole('button',{name:'余量',exact:true}).click();await blank(page);await expect(page.locator('.graph-auxiliary[aria-hidden="false"]')).toHaveCount(0);
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'余量',exact:true}).click();await expect(page.locator('.path-float-distribution')).toBeVisible();const drawer=(await page.locator('.graph-auxiliary').boundingBox())!,footer=(await page.locator('.graph-footer').boundingBox())!,controls=(await page.locator('.graph-view-controls').boundingBox())!;expect(drawer.y+drawer.height).toBeLessThanOrEqual(Math.min(footer.y,controls.y)-10);await page.waitForTimeout(220);await page.screenshot({path:info.outputPath('drawers-narrow.png')});
});

test('重复连线可定位已有草稿关系，快速撤销重做后线路完整且正式数据不变',async({page})=>{
 const {a,b,analysis}=await fixture(page);await page.addInitScript(()=>{
  const Base=window.Worker;window.Worker=class extends Base{set onmessage(handler:((this:Worker,event:MessageEvent)=>unknown)|null){let count=0;super.onmessage=handler?event=>{setTimeout(()=>handler.call(this,event),++count%2?120:10);}:null;}};
 });await page.goto('/paths?pathScope=all');await ready(page);const revision=(await analysis()).revision,before=await viewportValue(page);await page.getByLabel('编辑画布',{exact:true}).click();
 const source=page.locator('.react-flow__node[data-id="'+a.id+'"]'),target=page.locator('.react-flow__node[data-id="'+b.id+'"]');
 const connect=async()=>{await source.locator('.business-handle[data-side="bottom"]').click();await target.locator('.dependency-card').click({position:{x:80,y:45}});};
 await connect();await ready(page);await connect();await expect(page.getByRole('button',{name:'查看已有关系',exact:true})).toBeVisible();await page.getByRole('button',{name:'查看已有关系',exact:true}).click();await expect(page.locator('.graph-relation-list')).toContainText('验收后开始');
 await page.locator('.graph-auxiliary').getByRole('button',{name:'关闭',exact:true}).click();for(let i=0;i<3;i++){await page.getByLabel('撤销',{exact:true}).click();await page.getByLabel('重做',{exact:true}).click();}await ready(page);
 expect(await viewportValue(page)).toBe(before);await expect.poll(()=>page.locator('.graph-routed-edge').evaluateAll(es=>es.map(e=>Number(e.getAttribute('opacity'))))).toEqual([1]);await expect(page.locator('.react-flow__edge-path')).toHaveCount(1);expect((await analysis()).revision).toBe(revision);
});

test('路由失败保留上一份节点和线路，重试后应用草稿位置且视口不动',async({page})=>{
 const {a,analysis}=await fixture(page);
 await page.route('**/fixed-routing.worker*.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+';{const handle=self.onmessage;let calls=0;self.onmessage=e=>{if(++calls===2)self.postMessage({id:e.data.id,error:"模拟路由失败"});else handle(e);};}'});});
 await page.goto('/paths?pathScope=all');await ready(page);const previous=await positionsValue(page),view=await viewportValue(page),revision=(await analysis()).revision;await page.getByLabel('编辑画布',{exact:true}).click();
 const node=page.locator('.react-flow__node[data-id="'+a.id+'"]'),box=(await node.boundingBox())!;await page.mouse.move(box.x+80,box.y+40);await page.mouse.down();await page.mouse.move(box.x+112,box.y+88,{steps:8});await page.mouse.up();
 await expect(page.locator('.graph-error-notice')).toContainText('保留上次有效画面');expect(await positionsValue(page)).toEqual(previous);expect(await viewportValue(page)).toBe(view);expect(await page.locator('.graph-routed-edge').getAttribute('opacity')).toBe('1');
 await page.getByRole('button',{name:'重试连线',exact:true}).click();await ready(page);await expect(page.locator('.graph-error-notice')).toHaveCount(0);expect((await positionsValue(page))[a.id]).not.toBe(previous[a.id]);expect(await viewportValue(page)).toBe(view);expect((await analysis()).revision).toBe(revision);
});

test('紧凑工作区：移动、Alt复制、独立里程碑、草稿恢复与原子保存',async({page},testInfo)=>{
 const {project,analysis}=await fixture(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/templates?edit=new');await ready(page);
 await expect(page.getByRole('button',{name:'返回流程列表',exact:true})).toBeVisible();expect((await page.locator('.graph-toolbar').boundingBox())!.height).toBeLessThanOrEqual(49);
 await page.getByRole('button',{name:'流程属性',exact:true}).click();await page.getByLabel('流程名称',{exact:true}).fill('图形编辑验收');await page.getByLabel('流程名称',{exact:true}).blur();await page.locator('.graph-auxiliary').getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('button',{name:'适配视图',exact:true}).click();await page.waitForTimeout(300);
 const node=page.locator('.react-flow__node').first(),before=(await node.boundingBox())!;
 await page.mouse.move(before.x+80,before.y+40);await page.mouse.down();await page.mouse.move(before.x+180,before.y+120,{steps:12});await page.mouse.up();await ready(page);const moved=(await node.boundingBox())!;expect(moved.x).not.toBe(before.x);
 await page.locator('.graph-detail').getByRole('button',{name:'关闭',exact:true}).click();
 const source=(await node.boundingBox())!;await page.keyboard.down('Alt');await page.mouse.move(source.x+80,source.y+40);await page.mouse.down();await page.mouse.move(source.x+80,source.y+245,{steps:12});await page.mouse.up();await page.keyboard.up('Alt');await expect(page.locator('.react-flow__node')).toHaveCount(2);await ready(page);
 await page.locator('.graph-detail').getByRole('button',{name:'关闭',exact:true}).click();await page.getByLabel('添加元素',{exact:true}).click();await page.locator('.graph-elements').getByRole('button',{name:'里程碑',exact:true}).click();const canvas=(await page.locator('.dependency-canvas').boundingBox())!;await page.mouse.click(canvas.x+canvas.width*.60,canvas.y+canvas.height*.62);await expect(page.locator('.react-flow__node')).toHaveCount(3);await page.getByLabel('元素名称').fill('交付节点');await page.getByLabel('元素名称').blur();await ready(page);
 await page.reload();await ready(page);await expect(page.locator('.react-flow__node')).toHaveCount(3);await page.getByRole('button',{name:'返回流程列表',exact:true}).click();await expect(page).not.toHaveURL(/edit=new/);
 await page.goto('/templates?edit=new');await ready(page);await expect(page.locator('.react-flow__node')).toHaveCount(3);
 await page.getByRole('button',{name:'保存修改',exact:true}).click();await expect.poll(async()=>{const items=await(await page.request.get('/api/templates?projectId='+project.id)).json();return items.some((t:WorkItemTemplate)=>t.name==='图形编辑验收');}).toBe(true);await ready(page);
 await page.waitForTimeout(300);await page.screenshot({path:testInfo.outputPath('editor-desktop.png')});expect(errors).toEqual([]);expect((await analysis()).requirements).toHaveLength(2);
});
test('全局新增需求只加入草稿，进入其内部继续创建，保存后可原路返回',async({page},testInfo)=>{
 const {analysis}=await fixture(page);await page.goto('/paths?pathScope=all');await ready(page);const initial=await analysis();
 await page.getByRole('button',{name:'编辑画布',exact:true}).click();await page.getByLabel('添加元素',{exact:true}).click();await page.locator('.graph-elements').getByRole('button',{name:'需求',exact:true}).click();const b=(await page.locator('.dependency-canvas').boundingBox())!;await page.mouse.click(b.x+b.width*.6,b.y+b.height*.68);
 await page.getByRole('dialog').getByLabel('需求标题').fill('草稿新需求');await page.getByRole('button',{name:'加入草稿',exact:true}).click();await ready(page);expect((await analysis()).requirements).toHaveLength(initial.requirements.length);
 await page.getByRole('button',{name:'进入需求路径',exact:true}).click();await ready(page);await expect(page).toHaveURL(/draftProject=/);await expect(page.locator('.graph-editor-title>strong')).toHaveText('草稿新需求');
 await page.getByLabel('添加元素',{exact:true}).click();await page.locator('.graph-elements').getByRole('button',{name:'工作项',exact:true}).click();const box=(await page.locator('.dependency-canvas').boundingBox())!;await page.mouse.click(box.x+box.width*.45,box.y+box.height*.6);await ready(page);
 await page.getByRole('button',{name:'保存修改',exact:true}).click();await expect(page).not.toHaveURL(/draftProject=/);await ready(page);expect((await analysis()).requirements).toHaveLength(initial.requirements.length+1);
 await page.getByRole('button',{name:'返回项目全局',exact:true}).click();await ready(page);await expect(page).toHaveURL(/paths/);await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);expect((await page.locator('.graph-toolbar').boundingBox())!.height).toBeLessThanOrEqual(88);await page.screenshot({path:testInfo.outputPath('editor-narrow.png')});
});

test('多标签页显式接管草稿，撤销不影响正式数据',async({page,context})=>{
 const {a,analysis}=await fixture(page);await page.goto('/requirements/'+a.id+'?view=path');await ready(page);await page.getByLabel('编辑画布',{exact:true}).click();await page.locator('.react-flow__node[data-id="'+a.workItems[0].id+'"] .dependency-card').click();await page.getByLabel('元素名称').fill('本机标题');await page.getByLabel('元素名称').blur();
 const tab=await context.newPage();await tab.goto(page.url());await ready(tab);await expect(tab.locator('.graph-status-slot')).toContainText('其他页面编辑中');
 await tab.getByRole('button',{name:/项修改|草稿状态/}).click();await tab.getByRole('button',{name:'接管此草稿'}).click();await expect(tab.getByLabel('元素名称')).toHaveValue('本机标题');await expect(page.locator('.graph-status-slot')).toContainText('其他页面编辑中');
 await tab.getByLabel('元素名称').fill('接管后标题');await tab.getByLabel('元素名称').blur();await tab.getByLabel('撤销',{exact:true}).click();await expect(tab.getByLabel('元素名称')).toHaveValue('本机标题');expect((await analysis()).nodes.find(n=>n.id===a.workItems[0].id)?.title).toBe('方案交付');await tab.close();
});
test('本机存储失败给出提示，保存失败保留当前编辑并且不写正式数据',async({page})=>{
 const {analysis}=await fixture(page);await page.addInitScript(()=>{Object.defineProperty(window,'indexedDB',{value:{open(){throw new DOMException('quota','QuotaExceededError');}}});});await page.goto('/paths');await ready(page);const before=await analysis();await page.getByLabel('编辑画布',{exact:true}).click();await page.locator('.react-flow__node .dependency-card').first().click();await page.getByLabel('元素名称').fill('内存中的修改');await page.getByLabel('元素名称').blur();await expect(page.locator('.graph-status-slot')).toContainText('本机保存失败');await expect(page.getByLabel('保存修改')).toBeEnabled();await page.getByLabel('保存修改').click();await expect(page.getByLabel('元素名称')).toHaveValue('内存中的修改');expect((await analysis()).requirements).toEqual(before.requirements);
});
test('关闭浏览器后从同一本机草稿恢复内容、撤销和视口',async({},info)=>{
 test.setTimeout(90000);const baseURL=String(info.project.use.baseURL||'http://127.0.0.1:3211'),profile=info.outputPath('browser-profile');
 let context=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true,baseURL,viewport:{width:1280,height:800}});let page=context.pages()[0];
 try{await fixture(page);await page.goto('/templates?edit=new');await ready(page);await page.locator('.react-flow__node .dependency-card').first().click();await page.getByLabel('元素名称').fill('关闭后恢复');await page.getByLabel('元素名称').blur();const url=page.url(),positions=await page.locator('.react-flow__node').evaluateAll(ns=>ns.map(n=>(n as HTMLElement).style.transform));await page.waitForTimeout(150);await context.close();
 context=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true,baseURL,viewport:{width:1280,height:800}});page=context.pages()[0];await page.request.post('/api/login',{data:{username:'admin',password:'41_xc7q0qOjo4Inw!'}});await page.goto(url);await ready(page);await expect(page.locator('.react-flow__node strong')).toHaveText('关闭后恢复');expect(await page.locator('.react-flow__node').evaluateAll(ns=>ns.map(n=>(n as HTMLElement).style.transform))).toEqual(positions);await page.getByLabel('撤销',{exact:true}).click();await expect(page.locator('.react-flow__node strong')).toHaveText('新工作项');
 }finally{await context.close();}
});

test('项目里程碑拖线与前置勾选共享同一关系，修改仅在保存后生效',async({page})=>{
 const {project,a,analysis}=await fixture(page),id=crypto.randomUUID(),initial=await analysis();
 const body={expectedRevision:initial.revision,target:'project',changes:{add:[],remove:[],estimates:[],entities:[{entity:'milestone',op:'create',id,data:{title:'项目交付点',confirmationMode:'auto'}}]}};
 const preview=await(await page.request.post('/api/projects/'+project.id+'/dependency-changes/preview',{data:body})).json();const saved=await page.request.post('/api/projects/'+project.id+'/dependency-changes/apply',{data:{...body,batchId:crypto.randomUUID(),previewToken:preview.previewToken}});expect(saved.ok()).toBe(true);
 await page.goto('/paths?pathScope=all');await ready(page);await page.getByLabel('编辑画布',{exact:true}).click();
 await page.locator('.react-flow__node[data-id="'+a.id+'"] .business-handle[data-side="top"]').click();await page.locator('.react-flow__node[data-id="'+id+'"] .dependency-card').click();await ready(page);
 await page.locator('.react-flow__node[data-id="'+id+'"] .dependency-card').click();await page.locator('.graph-detail .graph-more-relations summary').click();const check=page.getByRole('checkbox',{name:a.title,exact:true});await expect(check).toBeChecked();
 await check.uncheck();await expect(check).not.toBeChecked();await page.getByLabel('撤销',{exact:true}).click();await expect(check).toBeChecked();expect((await analysis()).dependencies.some(d=>d.targetMilestoneId===id)).toBe(false);
 await expect(page.getByLabel('保存修改')).toBeEnabled();await page.getByLabel('保存修改').click();await expect(page.getByLabel('编辑画布',{exact:true})).toBeVisible();expect((await analysis()).dependencies.filter(d=>d.targetMilestoneId===id&&d.sourceRequirementId===a.id)).toHaveLength(1);
});

test('分析浮层限宽，关闭逐帧保持原矩形，快速切换不闪回旧内容',async({page},info)=>{
 const {project,a,analysis}=await fixture(page),data=await analysis();
 for(const n of data.nodes){n.plannedStart=null;n.plannedEnd=null;n.forecastStart=null;n.forecastEnd=null;}
 await page.route('**/api/projects/'+project.id+'/path-analysis**',r=>r.fulfill({json:data}));
 await page.goto('/paths?pathScope=all');await ready(page);await page.locator('.react-flow__node[data-id="'+a.id+'"] .dependency-card').click();await page.waitForTimeout(220);
 const spacing=await page.locator('.graph-detail').evaluate(e=>{const icons=e.querySelector('.editor-selection-tools')!.getBoundingClientRect(),actions=e.querySelector('.button-row')!.getBoundingClientRect();return actions.top-icons.bottom;});expect(spacing).toBeGreaterThanOrEqual(11);
 await page.getByRole('button',{name:'排期预览',exact:true}).click();await page.waitForTimeout(230);
 const panel=page.locator('.graph-auxiliary[aria-hidden="false"]');expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(480);await expect(panel.locator('.path-draft-gantt-track')).toHaveCount(0);expect(await panel.evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);
 await page.screenshot({path:info.outputPath('compact-undated-panel.png')});
 const sample=await page.evaluate(async()=>{const read=()=>{const e=document.querySelector<HTMLElement>('.graph-auxiliary');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,opacity:Number(getComputedStyle(e).opacity)};};const before=read()!,frames:ReturnType<typeof read>[]=[];[...document.querySelectorAll<HTMLButtonElement>('.graph-auxiliary button')].find(b=>b.textContent==='关闭')!.click();await new Promise<void>(resolve=>{const start=performance.now();const tick=()=>{frames.push(read());if(performance.now()-start<250)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick);});return {before,frames};});
 expect(sample.frames.filter(Boolean).length).toBeGreaterThan(2);for(const frame of sample.frames){if(!frame)continue;expect(Math.abs(frame.width-sample.before.width)).toBeLessThan(1);expect(Math.abs(frame.height-sample.before.height)).toBeLessThan(1);expect(Math.abs(frame.x-sample.before.x)).toBeLessThan(1);expect(frame.y).toBeGreaterThanOrEqual(sample.before.y-.5);expect(frame.y).toBeLessThanOrEqual(sample.before.y+8.5);}expect(sample.frames.at(-1)).toBeNull();
 await info.attach('close-frames',{body:JSON.stringify(sample),contentType:'application/json'});
 await page.getByRole('button',{name:'排期预览',exact:true}).click();await page.waitForTimeout(35);await page.locator('.graph-auxiliary[aria-hidden="false"]').getByRole('button',{name:'关闭',exact:true}).click();await page.getByRole('button',{name:'余量',exact:true}).click();await page.waitForTimeout(260);await expect(page.locator('.graph-auxiliary h3')).toHaveText('余量分布');await expect(page.locator('.graph-auxiliary')).toHaveCount(1);
 await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.graph-auxiliary').getByRole('button',{name:'关闭',exact:true}).click();await expect(page.locator('.graph-auxiliary')).toHaveCount(0);
});

test('有效排期图默认限宽，可主动展开，窄屏独立滚动且画布不跳动',async({page},info)=>{
 const {project,analysis}=await fixture(page),data=await analysis();for(const n of data.nodes.filter(n=>n.kind==='acceptance')){n.plannedStart='2026-09-07';n.plannedEnd='2026-09-10';n.forecastStart='2026-09-08';n.forecastEnd='2026-09-11';}
 await page.route('**/api/projects/'+project.id+'/path-analysis**',r=>r.fulfill({json:data}));await page.goto('/paths?pathScope=all');await ready(page);const view=await viewportValue(page),positions=await positionsValue(page);
 await page.getByRole('button',{name:'排期预览',exact:true}).click();await page.waitForTimeout(220);const panel=page.locator('.graph-auxiliary'),width=(await panel.boundingBox())!.width;expect(width).toBeLessThanOrEqual(800);await page.getByLabel('展开排期图',{exact:true}).click();await expect(panel).toHaveAttribute('data-size','expanded');expect((await panel.boundingBox())!.width).toBeGreaterThan(width);expect(await viewportValue(page)).toBe(view);expect(await positionsValue(page)).toEqual(positions);
 await page.getByLabel('收起排期图',{exact:true}).click();await expect(panel).toHaveAttribute('data-size','timeline');expect((await panel.boundingBox())!.width).toBe(width);
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'排期预览',exact:true}).click();await page.waitForTimeout(230);const box=(await panel.boundingBox())!,controls=(await page.locator('.graph-view-controls').boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);expect(box.y+box.height).toBeLessThan(controls.y-10);await page.screenshot({path:info.outputPath('dated-panel-narrow.png')});
});

test('流程列表隐藏迁移排序值，工作项连续编号，里程碑不重复也不显示零工期',async({page})=>{
 const {project}=await fixture(page);
 const templates=await(await page.request.get('/api/templates?projectId='+project.id)).json() as WorkItemTemplate[];
 const t=templates.find(t=>t.name==='依赖流程')!,work=t.items[1];work.milestoneLabel='可验收';
 t.items.push({...work,id:'milestone:'+work.id,title:'可验收',kind:'milestone',sortOrder:10001,startOffsetDays:5,durationDays:0,milestoneLabel:null,predecessorIds:[work.id]});
 await page.route('**/api/templates?*',r=>r.fulfill({json:templates}));await page.goto('/templates');const card=page.locator('.template-card').filter({hasText:'依赖流程'});
 await expect(card.locator('ol>li>span').filter({hasNot:page.locator('svg')})).toHaveText(['1','2']);await expect(card.locator('ol>li').filter({hasText:'可验收'})).toHaveCount(1);await expect(card.getByLabel('里程碑',{exact:true})).toBeVisible();await expect(card).not.toContainText('10002');await expect(card).not.toContainText('持续0');
 await card.getByRole('button',{name:'编辑流程 依赖流程',exact:true}).click();await ready(page);await page.getByRole('button',{name:'返回流程列表',exact:true}).click();await expect(card).toBeVisible();await expect(card.locator('ol>li')).toHaveCount(3);
});
