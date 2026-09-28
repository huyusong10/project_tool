import {test,expect,type Page} from '@playwright/test';
import {graphFixture as setup} from './graph-fixture';
import {openGraph,closeGraphProperties,graphProperties} from './graph-interactions';
import {chooseOption} from './select-helper';
import {addBusinessDays,todayIso} from '../../src/shared/domain';

const ready=(page:Page)=>expect(page.locator('.dependency-canvas')).toHaveAttribute('data-layout-ready','true');
const node=(page:Page,id:string)=>page.locator('.react-flow__node[data-id="'+id+'"]');
const viewport=(page:Page)=>page.locator('.react-flow__viewport').getAttribute('style');
const back=async(page:Page)=>{await closeGraphProperties(page);await page.goBack();await ready(page);};
const featureRoot=async(page:Page)=>{await closeGraphProperties(page);await page.getByRole('navigation',{name:'项目层级'}).getByRole('button',{name:'其他需求',exact:true}).click();await ready(page);};
async function enter(page:Page,id:string){await closeGraphProperties(page);await node(page,id).locator('.dependency-card').click();await expect(node(page,id)).toHaveClass(/selected/);await node(page,id).getByRole('button',{name:/^进入/}).click();await ready(page);}
async function stableViewport(page:Page){let prior='',stable=0;await expect.poll(async()=>{const value=await viewport(page)||'';stable=value===prior?stable+1:0;prior=value;return stable;},{intervals:[100]}).toBeGreaterThanOrEqual(3);return viewport(page);}

test('关闭交付关系后打开需求，仅显示当前需求且刷新不恢复旧关系窗口',async({page})=>{
 const {project,a,b,analysis}=await setup(page),before=await analysis();
 await page.goto('/?'+new URLSearchParams({projectId:project.id,workspaceView:'graph',scopeType:'feature',scopeId:a.featureId!}));await ready(page);
 await page.locator('.react-flow__edge[data-id="'+a.id+'>'+b.id+'"] .dependency-edge-label').click();
 await expect(page.getByRole('dialog',{name:'关系详情',exact:true})).toBeVisible();
 await closeGraphProperties(page);await expect(page.getByRole('dialog')).toHaveCount(0);
 await node(page,b.id).getByRole('button',{name:b.title,exact:true}).click();
 const detail=page.getByRole('dialog',{name:b.title,exact:true});
 await expect(detail).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(1);
 await expect.poll(()=>new URL(page.url()).searchParams.get('graphInspector')).toBe('closed');
 await expect(node(page,b.id)).toHaveClass(/selected/);
 await detail.getByRole('tab',{name:'工作项 2',exact:true}).click();await page.reload();await ready(page);
 await expect(page.getByRole('dialog')).toHaveCount(1);await expect(detail.getByRole('tab',{name:'工作项 2',exact:true})).toHaveAttribute('aria-selected','true');
 await detail.getByRole('button',{name:'关闭',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(await analysis()).toEqual(before);
});

test('概览阻塞直达来源工作，跨需求影响、筛选恢复与刷新保持可追溯',async({page})=>{
 const {project,a,b,analysis}=await setup(page),work=a.workItems[0];
 const response=await page.request.patch('/api/work-items/'+work.id,{data:{expectedVersion:work.version,workStage:'development',plannedStart:addBusinessDays(todayIso(),-3),plannedEnd:addBusinessDays(todayIso(),-2)}});
 expect(response.ok(),await response.text()).toBe(true);
 const before=await analysis(),writes:string[]=[];
 expect(before.blockers.find(item=>item.nodeId===work.id)?.affectedRequirementIds).toContain(b.id);
 page.on('request',request=>{if(request.url().includes('/api/')&&!['GET','HEAD'].includes(request.method()))writes.push(request.method()+' '+new URL(request.url()).pathname);});
 const entry=(scopeType:string,scopeId:string,workspaceView='list')=>'/?'+new URLSearchParams({projectId:project.id,scopeType,scopeId,workspaceView});
 const locate=async(affectedTitle=b.title)=>{
  await page.getByRole('button',{name:'展开概览',exact:true}).click();
  const blocker=page.getByRole('region',{name:'主要阻塞',exact:true}).getByRole('article').filter({has:page.getByRole('button',{name:a.title+' / '+work.title,exact:true})});
  await blocker.locator('summary').click();
  await expect(blocker.getByRole('button',{name:affectedTitle,exact:true})).toBeVisible();
  await blocker.getByRole('button',{name:'定位关系图',exact:true}).click();await ready(page);
  await expect.poll(()=>new URL(page.url()).searchParams.get('scopeId')).toBe(a.id);
  await expect(node(page,work.id)).toHaveClass(/selected/);await expect(node(page,work.id)).toBeInViewport();
 };
 await page.goto(entry('project',project.id));await locate();
 await page.reload();await ready(page);await expect(node(page,work.id)).toHaveClass(/selected/);
 await page.goBack();await expect.poll(()=>new URL(page.url()).searchParams.get('scopeType')).toBe('project');
 // The affected requirement may be elsewhere in the hierarchy; the source still opens in its own graph.
 await page.goto(entry('requirement',b.id));await locate();
 await chooseOption(page.getByRole('combobox',{name:'工作阶段筛选',exact:true}),'testing');
 await expect(node(page,work.id)).toBeHidden();
 await page.getByRole('button',{name:'清单',exact:true}).click();await locate(a.title);
 await expect(page.getByRole('combobox',{name:'工作阶段筛选',exact:true})).toContainText('全部工作阶段');
 await page.setViewportSize({width:390,height:844});await page.reload();await ready(page);
 await expect(node(page,work.id)).toBeInViewport();
 await node(page,work.id).getByRole('button',{name:work.title,exact:true}).click();
 const details=page.getByRole('dialog',{name:work.title,exact:true});await details.getByRole('tab',{name:'依赖',exact:true}).click();
 await expect(details).toContainText(b.title);
 expect(writes).toEqual([]);expect(await analysis()).toEqual(before);
});

test('不同范围的详情进入所属需求关系图，浏览器返回恢复入口',async({page})=>{
 const {project,a,analysis}=await setup(page),before=await analysis(),writes:string[]=[];
 page.on('request',request=>{if(request.url().includes('/api/')&&!['GET','HEAD'].includes(request.method()))writes.push(request.method()+' '+new URL(request.url()).pathname);});
 const detail=(scopeType:string,scopeId:string,view:string,id:string)=>'/?'+new URLSearchParams({projectId:project.id,workspaceView:view,scopeType,scopeId,detailId:id,detailTab:'dependencies'});
 const entries=[['/requirements/'+a.id,a.id],[detail('project',project.id,'progress',a.id),a.id],[detail('project',project.id,'list',a.workItems[0].id)+'&workStage=testing&pathStatuses=completed&pathCritical=1&pathBranch='+a.workItems[1].id,a.workItems[0].id],[detail('feature',a.featureId!,'progress',a.workItems[0].id),a.workItems[0].id],[detail('feature',a.featureId!,'list',a.id),a.id]];
 for(const [url,id] of entries){
  await page.goto(url);const modal=page.locator('.modal-card-workspace[role=dialog]');await modal.getByRole('tab',{name:'依赖',exact:true}).click();const originalUrl=page.url();
  await modal.getByRole('button',{name:/^在关系图中/}).click();await ready(page);await expect(page).toHaveURL(new RegExp('scopeType=requirement&scopeId='+a.id));await expect(node(page,a.workItems[0].id)).toBeVisible();
  if(id!==a.id)await expect(node(page,id)).toHaveClass(/selected/);
  await page.goBack();await expect(page).toHaveURL(originalUrl);await expect(modal.getByRole('tab',{name:'依赖',exact:true})).toHaveAttribute('aria-selected','true');
  await page.goForward();await ready(page);await expect(page).toHaveURL(new RegExp('scopeId='+a.id));await page.goBack();await expect(page).toHaveURL(originalUrl);await expect(modal).toBeVisible();
 }
 expect(writes).toEqual([]);expect(await analysis()).toEqual(before);
});

test('特性规划连线不会随工期入口进入需求图并遮挡工作详情',async({page})=>{
 const {project,a,analysis}=await setup(page),base='/api/projects/'+project.id;
 const createFeature=async(name:string)=>(await(await page.request.post(base+'/features',{data:{name,sortOrder:0}})).json()).features.find((f:{name:string})=>f.name===name);
 const source=await createFeature('业务输入'),target=await createFeature('业务使用');
 expect((await page.request.post(base+'/feature-relations',{data:{sourceFeatureId:source.id,targetFeatureId:target.id,note:'规划评审用'}})).ok()).toBe(true);
 const before=await analysis(),writes:string[]=[];
 page.on('request',r=>{if(r.url().includes('/api/')&&!['GET','HEAD'].includes(r.method()))writes.push(r.method()+' '+new URL(r.url()).pathname);});
 await page.goto('/?'+new URLSearchParams({projectId:project.id,workspaceView:'graph',scopeType:'project',scopeId:project.id}));await ready(page);
 await page.locator('.react-flow__edge .dependency-edge-label').filter({hasText:'规划'}).click();await closeGraphProperties(page);
 await page.getByRole('button',{name:'清单',exact:true}).click();await page.getByRole('button',{name:'展开全部',exact:true}).click();
 await page.getByRole('button',{name:a.title,exact:true}).click();
 const requirement=page.getByRole('dialog',{name:a.title,exact:true});await requirement.getByRole('tab',{name:'工作项 2',exact:true}).click();await requirement.getByRole('button',{name:'前置关系与工期',exact:true}).click();await ready(page);
 for(const work of a.workItems){
  await node(page,work.id).getByRole('button',{name:work.title,exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(1);await expect(page.getByRole('dialog',{name:work.title,exact:true})).toBeVisible();
  await expect.poll(()=>new URL(page.url()).searchParams.get('pathEdge')||'').toBe('');
  await page.reload();await ready(page);await expect(page.getByRole('dialog')).toHaveCount(1);await closeGraphProperties(page);
 }
 expect(writes).toEqual([]);expect(await analysis()).toEqual(before);
});
test('外部工作项进入其所属层级，返回保持原来的选择',async({page})=>{
 const {a,b}=await setup(page);await openGraph(page,'/requirements/'+b.id+'?view=path');await ready(page);
 await node(page,a.workItems[0].id).locator('.dependency-card').click();await expect(node(page,a.workItems[0].id)).toHaveClass(/selected/);await graphProperties(page,node(page,a.workItems[0].id));await page.getByRole('dialog').getByRole('button',{name:'进入需求',exact:true}).click();await ready(page);
 await expect(page).toHaveURL(new RegExp('scopeId='+a.id));await page.reload();await ready(page);await back(page);
 await expect(page).toHaveURL(new RegExp('scopeId='+b.id));await expect(node(page,a.workItems[0].id)).toHaveClass(/selected/);
});
test('根视图切换新增访问，返回恢复每次画布的位置与选择',async({page})=>{
 const {a,b}=await setup(page);await openGraph(page,'/paths?pathScope=all');await ready(page);const first=await stableViewport(page);
 await enter(page,a.id);await featureRoot(page);await page.getByLabel('缩小画布',{exact:true}).click();const second=await stableViewport(page);expect(second).not.toBe(first);
 await enter(page,b.id);await featureRoot(page);await back(page);await expect(page).toHaveURL(new RegExp('scopeId='+b.id));
 await back(page);await expect.poll(()=>viewport(page)).toBe(second);await expect(node(page,b.id)).toHaveClass(/selected/);
 await back(page);await expect(page).toHaveURL(new RegExp('scopeId='+a.id));await back(page);await expect.poll(()=>viewport(page)).toBe(first);await expect(node(page,a.id)).toHaveClass(/selected/);
});
test('旧需求图链接恢复所属层级，矩阵和窄屏的上一级入口可用',{tag:'@responsive'},async({page},info)=>{
 const {project,a}=await setup(page);
 for(const view of [page.viewportSize()!,{width:390,height:844}]){
  await page.setViewportSize(view);await page.goto('/requirements/'+a.id+'?view=path');await ready(page);await expect(page).toHaveURL(new RegExp('scopeId='+a.id));await expect(page).toHaveURL(/root=features/);
  const nav=page.getByRole('navigation',{name:'项目层级'});await expect(nav).toContainText(project.name);await expect(nav).toContainText(a.title);
  await expect(page.getByRole('button',{name:'上一级',exact:true})).toBeEnabled();await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(view.width);
  await page.screenshot({path:info.outputPath('navigation-'+view.width+'.png'),animations:'disabled'});
  await closeGraphProperties(page);await page.getByRole('button',{name:'上一级',exact:true}).click();await ready(page);await expect(page).toHaveURL(/scopeType=feature/);await expect(node(page,a.id)).toBeVisible();
 }
});
test('返回较早画布时不套用后来访问的搜索与抽屉状态',async({page})=>{
 await setup(page);await openGraph(page,'/paths?pathScope=all');await ready(page);
 await page.getByRole('link',{name:'问题跟踪',exact:true}).click();await expect(page).toHaveURL(/\/issues/);await page.getByRole('link',{name:'项目空间',exact:true}).click();await ready(page);
 await page.getByLabel('查找与筛选',{exact:true}).click();await page.getByPlaceholder('查找特性',{exact:true}).fill('其他需求');await expect(page).toHaveURL(/pathSearch=/);
 await page.goBack();await expect(page).toHaveURL(/\/issues/);await page.goBack();await ready(page);await expect(page).not.toHaveURL(/pathSearch=/);await expect(page.locator('.graph-finder')).not.toBeVisible();
});
test('处理工作项保留在工作区，切换视图仍保留工作项选择',async({page})=>{
 const {a}=await setup(page);const id=a.workItems[0].id;await openGraph(page,'/requirements/'+a.id+'?view=path');await ready(page);
 await node(page,id).locator('.dependency-card').click();await expect(page).toHaveURL(new RegExp('pathNode='+id));
 await page.getByRole('button',{name:'清单',exact:true}).click();await expect(page).toHaveURL(/workspaceView=list/);await expect(page).toHaveURL(new RegExp('pathNode='+id));
 await page.locator('[data-object-id="'+id+'"] .outline-title').click();await expect(page.getByRole('dialog')).toContainText(a.workItems[0].title);await closeGraphProperties(page);
 await page.getByRole('button',{name:'关系图',exact:true}).click();await ready(page);await expect(node(page,id)).toHaveClass(/selected/);
});
test('旧草稿历史链接替换为正式地址并转入统一画布',async({page})=>{
 const {project,a}=await setup(page),session=await(await page.request.get('/api/session')).json();
 await page.addInitScript(({key,id,work})=>sessionStorage.setItem(key,JSON.stringify({draft:id,'draft-work':work})),{key:'pm-editor-ids:'+session.accountId+':'+project.id,id:a.id,work:a.workItems[0].id});
 await page.goto('/requirements/draft?view=path&draftProject='+project.id+'&pathNode=draft-work&target=acceptance%3Adraft');await ready(page);
 await expect(page).toHaveURL(new RegExp('scopeId='+a.id));await expect(page).not.toHaveURL(/draft/);await expect(page).toHaveURL(new RegExp('pathNode='+a.workItems[0].id));expect(await page.evaluate(()=>history.state.idx)).toBe(0);
});
test('顶层图标、标题和52px顶栏在下钻、加载与返回中保持稳定',{tag:'@responsive'},async({page},info)=>{
 const {a}=await setup(page);
 for(const view of [page.viewportSize()!,{width:390,height:844}]){
  await page.setViewportSize(view);await openGraph(page,'/paths?pathScope=all');await ready(page);await expect(page.locator('.topbar-page-icon')).toBeVisible();
  const titleX=(await page.locator('.integrated-page-title h1').boundingBox())!.x;
  await page.evaluate(()=>{const frames:Array<{height:number;x:number}>=[];Object.assign(window,{returnFrames:frames});const sample=()=>{const bar=document.querySelector('.topbar'),title=document.querySelector('.integrated-page-title h1');if(bar&&title)frames.push({height:bar.getBoundingClientRect().height,x:title.getBoundingClientRect().x});if(frames.length<240)requestAnimationFrame(sample);};sample();});
  await enter(page,a.id);await expect(page.getByRole('button',{name:'上一级',exact:true})).toBeVisible();
  const graph=await page.locator('.dependency-canvas').boundingBox(),toolbar=(await page.locator('.page-toolbar').boundingBox())!;
  expect(graph!.y).toBeGreaterThanOrEqual(toolbar.y+toolbar.height);if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();await expect(page.locator('.graph-finder')).toBeVisible();expect(await page.locator('.dependency-canvas').boundingBox()).toEqual(graph);
  await page.screenshot({path:info.outputPath('return-'+view.width+'.png')});await back(page);
  const frames=await page.evaluate(()=>(window as typeof window&{returnFrames:Array<{height:number;x:number}>}).returnFrames);
  expect(frames.length).toBeGreaterThan(5);expect([...new Set(frames.map(f=>f.height))]).toEqual([52]);expect([...new Set(frames.map(f=>f.x))]).toEqual([titleX]);
 }
});
test('根图加载失败不制造父级，旧跨项目来源不改变需求根图',async({page})=>{
 const {project,a}=await setup(page),endpoint='**/api/projects/'+project.id+'/path-graph*';await page.route(endpoint,route=>route.fulfill({status:503,json:{error:'模拟读取失败'}}));
 await page.goto('/paths');await expect(page.getByText('模拟读取失败',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'上一级',exact:true})).toHaveCount(0);
 await page.unroute(endpoint);await page.goto('/requirements/'+a.id+'?view=path');await ready(page);
 await page.evaluate(()=>history.replaceState({...history.state,idx:2,usr:{pathSource:{projectId:'other',label:'其他项目需求路径',index:1}}},''));await page.reload();await ready(page);
 await expect(page.getByRole('navigation',{name:'项目层级'})).toContainText(project.name);await expect(page.getByRole('navigation',{name:'项目层级'})).not.toContainText('其他项目需求路径');
 await closeGraphProperties(page);await page.getByRole('navigation',{name:'项目层级'}).getByRole('button').first().click();await ready(page);await expect(page).toHaveURL(/scopeType=project/);await expect(page.getByRole('button',{name:'上一级',exact:true})).toHaveCount(0);
});
