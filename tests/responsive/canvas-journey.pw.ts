import {graphProperties,graphToolbar,closeGraphProperties,focusGraph,openGraphDrafts} from './graph-interactions';
import {chooseOption} from './select-helper';
import {randomUUID} from 'node:crypto';
import {expect,test,type Page} from '@playwright/test';
import {headerAction} from './topbar-helpers';
async function setup(page:Page){
  const login=await page.request.post('/api/login',{data:{username:'admin',password:'41_xc7q0qOjo4Inw!'}});expect(login.ok()).toBe(true);const session=await login.json();
  const project=await(await page.request.post('/api/projects',{data:{name:'连续画布 '+Date.now()}})).json();
  const create=async(name:string)=>(await(await page.request.post('/api/projects/'+project.id+'/features',{data:{name,sortOrder:999}})).json()).features.find((g:{name:string})=>g.name===name);
  const a=await create('基础授权'),b=await create('团队协作');
  let req=await(await page.request.post('/api/requirements',{data:{projectId:project.id,title:'角色权限',featureId:a.id}})).json();
  const second=await(await page.request.post('/api/requirements',{data:{projectId:project.id,title:'审计查询',featureId:a.id}})).json();
  const work=await page.request.post('/api/requirements/'+req.id+'/work-items',{data:{expectedVersion:req.version,title:'权限验证'}});expect(work.ok(),await work.text()).toBe(true);
  req=await(await page.request.get('/api/requirements/'+req.id)).json();
  await page.addInitScript(({accountId,projectId})=>localStorage.setItem('project-manage:selected-project:'+accountId,projectId),{accountId:session.accountId,projectId:project.id});
  return {project,session,a,b,req,second};
}
async function ready(page:Page){await expect(page.locator('.dependency-canvas')).toHaveAttribute('data-layout-ready','true');}
const node=(page:Page,id:string)=>page.locator('.react-flow__node[data-id="'+id+'"]');
async function planning(page:Page,a:string,b:string){await headerAction(page,'建立规划关系');const dialog=page.getByRole('dialog');await chooseOption(dialog.getByLabel('前置特性'),a);await chooseOption(dialog.getByLabel('后续特性'),b);await dialog.getByLabel('关系说明').fill('先验证基础授权');await dialog.getByRole('button',{name:'加入草稿'}).click();await closeGraphProperties(page);}
test('规划关系、执行依赖和工作项布局连续下钻后一次保存', async({page})=>{
  const {project,a,b,req,second}=await setup(page),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  // Place the target on the right: its second click lands over the opening inspector.
  const base='/api/projects/'+project.id,initial=await(await page.request.get(base+'/path-analysis')).json();
  const placement={expectedRevision:initial.revision,target:'project',changes:{add:[],remove:[],estimates:[],layouts:[{scope:'feature-phase:'+a.id+':unassigned',direction:'right',expectedVersion:0,positions:{[req.id]:{x:300,y:0},[second.id]:{x:0,y:0}}}]}};
  const checked=await page.request.post(base+'/dependency-changes/preview',{data:placement});expect(checked.ok(),await checked.text()).toBe(true);
  const placed=await page.request.post(base+'/dependency-changes/apply',{data:{...placement,previewToken:(await checked.json()).previewToken,batchId:randomUUID()}});expect(placed.ok(),await placed.text()).toBe(true);
  await page.goto('/paths?view=features');await ready(page);await graphToolbar(page,'编辑画布');await planning(page,a.id,b.id);
  expect((await(await page.request.get('/api/projects/'+project.id+'/feature-relations')).json())).toHaveLength(0);
  await node(page,'feature:'+a.id).getByRole('button',{name:/^进入/}).click();await expect(page).toHaveURL(/view=feature&/);await ready(page);
  await expect(page.getByRole('navigation',{name:'项目层级'})).toContainText('基础授权');
  await node(page,req.id).getByRole('button',{name:/从.*连接后续/}).first().click();await node(page,second.id).locator('.dependency-card').click();await closeGraphProperties(page);
  await node(page,req.id).getByRole('button',{name:/^进入/}).click();await expect(page).toHaveURL(/view=requirement&/);await ready(page);
  await expect(page.getByRole('navigation',{name:'项目层级'})).toContainText('角色权限');
  await graphProperties(page,node(page,req.workItems[0].id).locator('.dependency-card'));await page.getByLabel('元素名称').fill('权限验证与回归');await page.getByLabel('元素名称').blur();
  await focusGraph(page);await page.keyboard.press('Shift+ArrowRight');
  await page.getByRole('navigation',{name:'项目层级'}).getByRole('button').first().click();await ready(page);
  await expect(page.getByLabel('保存修改',{exact:true})).toBeEnabled();let writes=0;page.on('request',r=>{if(r.url().endsWith('/dependency-changes/apply'))writes++;});
  await graphToolbar(page,'保存修改');await expect(page.getByLabel('编辑画布',{exact:true})).toBeVisible();
  const relations=await(await page.request.get('/api/projects/'+project.id+'/feature-relations')).json();expect(relations).toHaveLength(1);
  const analysis=await(await page.request.get('/api/projects/'+project.id+'/path-analysis')).json();expect(analysis.dependencies).toHaveLength(1);expect(analysis.nodes.find((n:{id:string})=>n.id===req.workItems[0].id).title).toBe('权限验证与回归');expect(analysis.layouts.some((l:{scope:string})=>l.scope==='requirement:'+req.id)).toBe(true);expect(writes).toBe(1);expect(errors).toEqual([]);
});
test('特性为唯一根入口、旧链接兼容，返回恢复选择与缩放',async({page})=>{
  const {project,a,req}=await setup(page);await page.goto('/paths?view=features');await ready(page);
  await node(page,'feature:'+a.id).locator('.dependency-card').click();await page.getByLabel('缩小画布',{exact:true}).click();
  let previous='',stable=0;await expect.poll(async()=>{const current=await page.locator('.react-flow__viewport').getAttribute('style')||'';stable=current===previous?stable+1:0;previous=current;return stable;},{intervals:[150]}).toBeGreaterThanOrEqual(4);
  const transform=await page.locator('.react-flow__viewport').getAttribute('style');
  await page.getByRole('button',{name:'进入'+a.name,exact:true}).click();await ready(page);await node(page,req.id).getByRole('button',{name:/^进入/}).click();await ready(page);
  await page.getByRole('navigation',{name:'项目层级'}).getByRole('button').first().click();await ready(page);
  await expect(node(page,'feature:'+a.id)).toHaveClass(/selected/);await expect(page.locator('.react-flow__viewport')).toHaveAttribute('style',transform!);
  await expect(page.getByRole('group',{name:'交付范围',exact:true})).toHaveCount(0);await page.goto('/paths?view=project');await ready(page);await expect(page.locator('.page-breadcrumb')).toContainText(project.name);
  await page.goto('/requirements/'+req.id+'?view=path');await expect(page).toHaveURL(/\/\?.*view=requirement/);await ready(page);await expect(page.getByRole('navigation',{name:'项目层级'})).toContainText(project.name);await expect(page.getByRole('navigation',{name:'项目层级'})).toContainText('基础授权');
});
test('工作区内维护特性目标与评估',async({page})=>{
 const {project,a}=await setup(page);await page.goto('/paths');await ready(page);await node(page,'feature:'+a.id).locator('.graph-title').click();const panel=page.getByRole('dialog',{name:a.name,exact:true});
 await panel.getByRole('button',{name:'编辑特性',exact:true}).click();const edit=page.getByRole('dialog',{name:'编辑特性',exact:true});await edit.getByLabel('长期目标与范围').fill('持续覆盖组织授权与审计。'.repeat(60));await edit.getByRole('button',{name:'编辑特性',exact:true}).click();await expect(edit).toHaveCount(0);
 await panel.getByRole('button',{name:'更新评估',exact:true}).click();const assessment=page.getByRole('dialog',{name:'评估特性',exact:true});await assessment.getByLabel('大致预期',{exact:true}).fill('本季度形成试用条件。'.repeat(30));await assessment.getByLabel('进展简述',{exact:true}).fill('基础授权已完成验证。'.repeat(30));await assessment.getByRole('button',{name:'保存评估',exact:true}).click();await expect(assessment).toHaveCount(0);
 const latest=(await(await page.request.get('/api/projects/'+project.id+'/feature-overview')).json()).features.find((f:{id:string})=>f.id===a.id);expect(latest.description).toBe('持续覆盖组织授权与审计。'.repeat(60));expect(latest.overview.progressSummary).toBe('基础授权已完成验证。'.repeat(30));await expect(panel).toContainText(latest.overview.expectation);
});
test('特性长目标与评估详情适配当前视口和窄屏',{tag:'@responsive'},async({page},info)=>{
 const {project,a}=await setup(page);const response=await page.request.post('/api/projects/'+project.id+'/features',{data:{id:a.id,expectedVersion:a.version,name:a.name,description:'持续覆盖组织授权与审计。'.repeat(60),overview:{...a.overview,expectation:'本季度形成试用条件。'.repeat(30),progressSummary:'基础授权已完成验证。'.repeat(30)}}});expect(response.ok(),await response.text()).toBe(true);
 for(const viewport of [info.project.use.viewport!,{width:390,height:844}]){await page.setViewportSize(viewport);await page.goto('/?'+new URLSearchParams({projectId:project.id,workspaceView:'graph',scopeType:'project',scopeId:project.id,detailId:'feature:'+a.id}));const panel=page.getByRole('dialog',{name:a.name,exact:true});await expect(panel).toBeVisible();expect(await panel.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('feature-detail-'+viewport.width+'.png'),animations:'disabled'});}
});
test('旧特性布局合入项目草稿，键盘下钻保持编辑状态', async({page})=>{
 const {project,session,a}=await setup(page),analysis=await(await page.request.get('/api/projects/'+project.id+'/path-analysis')).json();
 await page.addInitScript(({key,analysis,a})=>{const empty={add:[],remove:[],estimates:[]};sessionStorage.setItem(key,JSON.stringify({version:String(analysis.revision),values:[empty,{...empty,layouts:[{scope:'features',direction:'right',expectedVersion:0,positions:{['feature:'+a]:{x:100,y:140}}}]}],index:1,active:true,server:analysis}));},{key:'pm-graph-draft:'+session.accountId+':'+project.id+':feature-layouts',analysis,a:a.id});
 await page.goto('/paths');await ready(page);await expect(page.getByLabel('保存修改',{exact:true})).toBeEnabled();await node(page,'feature:'+a.id).locator('.dependency-card').click();await focusGraph(page);await page.keyboard.press('Enter');await expect(page).toHaveURL(/view=feature&/);await ready(page);await expect(page.getByLabel('保存修改',{exact:true})).toBeEnabled();await graphToolbar(page,'保存修改');await expect(page.getByLabel('编辑画布',{exact:true})).toBeVisible();
 const graph=await(await page.request.get('/api/projects/'+project.id+'/path-graph?view=features')).json();expect(graph.savedLayout.positions['feature:'+a.id]).toEqual({x:100,y:140});
});
test('未知批次在刷新后先核对回执，已生效时不重提',async({page})=>{
 const {project,a,b}=await setup(page);await page.goto('/paths');await ready(page);await graphToolbar(page,'编辑画布');await planning(page,a.id,b.id);let writes=0,hold=true;
 await page.route('**/dependency-changes/*',async route=>{if(route.request().method()==='GET'&&hold)await route.abort('connectionfailed');else if(route.request().url().endsWith('/apply')){writes++;await route.fetch();await route.abort('connectionfailed');}else await route.continue();});
 await graphToolbar(page,'保存修改');await expect(page.locator('.page-toolbar-status')).toContainText('待核对');await page.reload();await ready(page);await openGraphDrafts(page);hold=false;await page.getByRole('button',{name:'核对提交结果',exact:true}).click();await expect(page.getByLabel('编辑画布',{exact:true})).toBeVisible();expect(writes).toBe(1);expect((await(await page.request.get('/api/projects/'+project.id+'/feature-relations')).json())).toHaveLength(1);
});
test('其他层无效字段可定位修正，单次保存保留输入',async({page})=>{
 const {req}=await setup(page);await page.goto('/requirements/'+req.id+'?view=path');await ready(page);await graphToolbar(page,'编辑画布');await graphProperties(page,node(page,req.workItems[0].id).locator('.dependency-card'));await page.getByLabel('元素名称').fill('');await page.getByLabel('元素名称').blur();await expect(page.getByLabel('元素名称')).toHaveAttribute('aria-invalid','true');
 await page.goto('/paths?view=features');await ready(page);await graphToolbar(page,'保存修改');await expect(page).toHaveURL(new RegExp('requirementId='+req.id));await ready(page);await expect(page.getByLabel('元素名称')).toHaveValue('');await expect(page.getByLabel('元素名称')).toBeFocused();await page.getByLabel('元素名称').fill('已修正的工作项');await page.keyboard.press('Control+s');await expect(page.getByLabel('编辑画布',{exact:true})).toBeVisible();
});

test('特性内新建需求在顶层保存后，返回与布局替换临时编号',{tag:'@responsive'}, async({page})=>{
 const {project,a}=await setup(page);await page.goto('/paths?view=feature&featureId='+a.id);await ready(page);await graphToolbar(page,'编辑画布');await page.getByLabel('添加元素',{exact:true}).click();await page.locator('.graph-elements').getByRole('button',{name:'需求',exact:true}).click();
 const box=(await page.locator('.dependency-canvas').boundingBox())!;await page.mouse.click(box.x+box.width*.5,box.y+box.height*.7);const dialog=page.getByRole('dialog');await dialog.getByLabel('需求标题').fill('特性内的新需求');await dialog.getByRole('button',{name:'加入草稿',exact:true}).click();await closeGraphProperties(page);await page.getByRole('button',{name:'进入特性内的新需求',exact:true}).click();await ready(page);
 const draftId=new URL(page.url()).searchParams.get('requirementId')!;await node(page,'acceptance:'+draftId).locator('.dependency-card').click();await focusGraph(page);await page.keyboard.press('Shift+ArrowRight');await page.getByRole('navigation',{name:'项目层级'}).getByRole('button').first().click();await ready(page);
 const applied=page.waitForResponse(r=>r.url().endsWith('/dependency-changes/apply'));await graphToolbar(page,'保存修改');const response=await applied;expect(response.ok(),await response.text()).toBe(true);const receipt=await response.json(),savedId=receipt.addedIds[draftId];await expect(page.getByLabel('编辑画布',{exact:true})).toBeVisible();
 const requirement=await(await page.request.get('/api/requirements/'+savedId)).json();expect(requirement.featureId).toBe(a.id);const graph=await(await page.request.get('/api/projects/'+project.id+'/path-analysis')).json();expect(graph.layouts.some((l:{scope:string})=>l.scope==='requirement:'+savedId)).toBe(true);
 await page.goBack();await expect(page).toHaveURL(new RegExp('requirementId='+savedId));await expect(page).not.toHaveURL(/draftProject=/);await ready(page);await expect(page.getByRole('navigation',{name:'项目层级'})).toContainText('特性内的新需求');await page.reload();await ready(page);
});

test('外部需求使用自己的特性层级，实际依赖定位到全部需求',async({page})=>{
 const {project,a,b,req}=await setup(page);const external=await(await page.request.post('/api/requirements',{data:{projectId:project.id,title:'外部协作需求',featureId:b.id}})).json();const analysis=await(await page.request.get('/api/projects/'+project.id+'/path-analysis')).json();const created=await page.request.post('/api/projects/'+project.id+'/dependencies',{data:{sourceRequirementId:req.id,targetRequirementId:external.id,expectedRevision:analysis.revision}});expect(created.ok(),await created.text()).toBe(true);
 await page.goto('/paths?view=feature&featureId='+a.id);await ready(page);await node(page,external.id).locator('.dependency-card').click();await focusGraph(page);await page.keyboard.press('Enter');await ready(page);await expect(page).toHaveURL(new RegExp('featureId='+b.id));await expect(page.getByRole('navigation',{name:'项目层级'})).toContainText('团队协作');await expect(page.getByRole('navigation',{name:'项目层级'})).not.toContainText('基础授权');await page.goBack();await ready(page);await expect(page).toHaveURL(new RegExp('featureId='+a.id));await expect(node(page,external.id)).toHaveClass(/selected/);
 await page.goto('/paths?'+new URLSearchParams({view:'features',pathEdge:'feature:'+a.id+'>feature:'+b.id,graphInspector:'open'}));await ready(page);await page.getByRole('button',{name:'角色权限 → 外部协作需求',exact:true}).click();await ready(page);await expect(page).toHaveURL(/scopeType=feature/);await expect(page).toHaveURL(/pathRelation=/);await expect(page.locator('.page-breadcrumb')).toContainText(b.name);await expect(page.getByRole('dialog')).toContainText('角色权限');await page.goBack();await ready(page);await expect(page.getByRole('dialog')).toContainText('实际依赖');
});

test('归档响应丢失后刷新仍能核对已移出当前列表的特性',async({page})=>{
 const {project,b}=await setup(page);await page.goto('/features?feature='+b.id);let writes=0;await page.route('**/features/'+b.id+'/archive',async route=>{writes++;await route.fetch();await route.abort('connectionfailed');});const detail=page.getByRole('dialog',{name:b.name,exact:true});await detail.getByLabel('特性更多操作',{exact:true}).click();await page.getByRole('button',{name:'归档特性',exact:true}).click();const form=page.getByRole('dialog',{name:'归档特性',exact:true});await form.getByRole('button',{name:'归档特性',exact:true}).click();await expect(form).toContainText('提交结果待核对');await page.reload();await expect(form).toContainText('提交结果待核对');await form.getByRole('button',{name:'读取最新资料',exact:true}).click();await form.getByRole('button',{name:'已核对，操作已生效',exact:true}).click();await expect(form).toHaveCount(0);expect(writes).toBe(1);const all=await(await page.request.get('/api/projects/'+project.id+'/features?state=archived')).json();expect(all.some((g:{id:string})=>g.id===b.id)).toBe(true);
});
