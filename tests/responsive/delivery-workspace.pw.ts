import {chooseOption} from './select-helper';
import {expect,test,type Page} from '@playwright/test';
import {phaseFixture} from './phase-fixture';
import {closeGraphProperties,focusGraph,graphProperties,graphToolbar} from './graph-interactions';
const detail=(p:Page)=>p.locator('.modal-card-workspace[role=dialog]');
const ready=(p:Page)=>expect(p.locator('.dependency-canvas')).toHaveAttribute('data-layout-ready','true',{timeout:20000});
const node=(p:Page,id:string)=>p.locator('.react-flow__node[data-id="'+id+'"]');
type Fixture=Awaited<ReturnType<typeof phaseFixture>>;
const url=(f:Fixture,view='list',kind='feature',id=f.feature.id,selected='')=>'/?'+new URLSearchParams({projectId:f.projectId,workspaceView:view,scopeType:kind,scopeId:id,...selected?{detailId:selected}:{}});

test('清单与关系图共享 Phase、选择和阶段，办公及窄屏详情可用',{tag:'@responsive'},async({page},info)=>{
 const f=await phaseFixture(page),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 for(const viewport of [info.project.use.viewport!,{width:390,height:844}]){
  await page.setViewportSize(viewport);
  for(const view of ['list','graph']){
   await page.goto(url(f,view,'phase',f.phases[1].id,f.testing.id));if(view==='graph')await ready(page);
   await expect(detail(page).locator('.requirement-overview')).toContainText('测试中');await expect(detail(page).locator('.requirement-overview')).toContainText('70%');await expect(detail(page).locator('.requirement-overview')).not.toContainText('99%');
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(await detail(page).evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
   const box=(await detail(page).boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(viewport.width+1);expect(box.height).toBeLessThanOrEqual(viewport.height);
   await page.screenshot({path:info.outputPath(view+'-'+viewport.width+'.png'),animations:'disabled'});
   await closeGraphProperties(page);
   if(view==='list')await expect(page.locator('[data-object-id="'+f.testing.id+'"]')).toContainText('测试中');else await expect(node(page,f.testing.id)).toContainText('70%');
  }
 }
 expect(errors).toEqual([]);
});

test('特性表单与无效工作项草稿切换视图后保留，草稿投影一致',async({page})=>{
 const f=await phaseFixture(page);await page.goto(url(f,'list','project',f.projectId,'feature:'+f.feature.id));
 await detail(page).getByRole('button',{name:'编辑特性',exact:true}).click();const edit=page.getByRole('dialog',{name:'编辑特性',exact:true});await edit.getByLabel('长期目标与范围').fill('尚未提交的长期目标');await edit.getByRole('button',{name:'关闭',exact:true}).first().click();await closeGraphProperties(page);
 for(const view of ['graph','list']){
  await page.goto(url(f,view,'project',f.projectId,'feature:'+f.feature.id));if(view==='graph')await ready(page);await detail(page).getByRole('button',{name:'编辑特性',exact:true}).click();await expect(edit.getByLabel('长期目标与范围')).toHaveValue('尚未提交的长期目标');await edit.getByRole('button',{name:'关闭',exact:true}).first().click();await closeGraphProperties(page);
 }
 await page.goto(url(f,'graph','requirement',f.testing.id));await ready(page);await graphToolbar(page,'编辑画布');await graphProperties(page,node(page,f.testing.workItems[1].id).locator('.dependency-card'));await page.getByLabel('元素名称',{exact:true}).fill('');await closeGraphProperties(page);
 await page.getByRole('button',{name:'清单',exact:true}).click();await expect(page.locator('.workspace-outline')).toBeVisible();await page.getByRole('button',{name:'关系图',exact:true}).click();await ready(page);await graphProperties(page,node(page,f.testing.workItems[1].id).locator('.dependency-card'));await expect(page.getByLabel('元素名称',{exact:true})).toHaveValue('');await page.getByLabel('元素名称',{exact:true}).fill('测试场景草稿');await page.getByLabel('元素名称',{exact:true}).blur();await closeGraphProperties(page);
 await page.getByRole('button',{name:'清单',exact:true}).click();await expect(page.locator('[data-object-id="'+f.testing.workItems[1].id+'"]')).toContainText('测试场景草稿');const formal=await(await page.request.get('/api/requirements/'+f.testing.id)).json();expect(formal.workItems[1].title).toBe('测试');
});

test('工作区内安排 Phase、记录提测和未知结果核对，不跳独立页面',async({page})=>{
 const f=await phaseFixture(page);await page.goto(url(f,'list','phase',f.phases[1].id));await page.getByLabel('选择'+f.direct.title,{exact:true}).check();await page.getByRole('button',{name:'调整归属…',exact:true}).click();const move=page.getByRole('dialog',{name:'调整 1 条需求归属'});await chooseOption(move.getByLabel('需求特性',{exact:true}),f.feature.id);await chooseOption(move.getByLabel('需求 Phase',{exact:true}),f.phases[2].id);await move.getByLabel('变更原因',{exact:true}).fill('后续批次继续交付');await move.getByRole('button',{name:'确认移动',exact:true}).click();await expect(move).toHaveCount(0);expect((await(await page.request.get('/api/requirements/'+f.direct.id)).json()).phaseId).toBe(f.phases[2].id);
 await page.goto(url(f,'list','phase',f.phases[2].id,f.direct.id));await detail(page).getByRole('button',{name:'记录提测',exact:true}).click();const testing=page.getByRole('dialog',{name:'记录提测',exact:true});await testing.getByRole('button',{name:'保存提测记录'}).click();await expect(testing).toHaveCount(0);await expect(detail(page).locator('.requirement-overview')).toContainText('已提测');expect(new URL(page.url()).pathname).toBe('/');
 await page.goto(url(f,'list','project',f.projectId,'feature:'+f.feature.id));await detail(page).getByRole('button',{name:'新建 Phase',exact:true}).click();const create=page.getByRole('dialog',{name:'新建 Phase',exact:true});await create.getByLabel('Phase 名称').fill('Phase 4');let writes=0;await page.route('**'+f.base+'/features/'+f.feature.id+'/phases',async route=>{if(route.request().method()!=='POST')return route.continue();writes++;await route.fetch();await route.abort('failed');});await create.getByRole('button',{name:'新建 Phase',exact:true}).click();await expect(create.getByRole('button',{name:'读取最新 Phase 并核对'})).toBeVisible();await page.reload();await expect(create.getByLabel('Phase 名称')).toHaveValue('Phase 4');await create.getByRole('button',{name:'读取最新 Phase 并核对'}).click();await expect(create).toHaveCount(0);expect(writes).toBe(1);
});

test('区域布局保存独立坐标，旧链接可恢复，Phase 筛选保留直接跨区依赖',async({page})=>{
 const f=await phaseFixture(page);const targetResponse=await page.request.post('/api/requirements',{data:{projectId:f.projectId,title:'跨 Phase 后续验证',featureId:f.feature.id,phaseId:f.phases[2].id}});expect(targetResponse.ok()).toBe(true);const target=await targetResponse.json();const analysis=await(await page.request.get(f.base+'/path-analysis')).json();const dependency=await page.request.post(f.base+'/dependencies',{data:{expectedRevision:analysis.revision,sourceRequirementId:f.testing.id,targetRequirementId:target.id}});expect(dependency.ok(),await dependency.text()).toBe(true);
 await page.goto('/paths?'+new URLSearchParams({view:'feature',featureId:f.feature.id,phaseId:f.phases[1].id,pathNode:f.testing.id,pathInspector:'closed'}));await ready(page);expect(new URL(page.url()).pathname).toBe('/');await expect(node(page,target.id)).not.toHaveClass(/graph-node-hidden/);const before=await(await page.request.get(f.base+'/path-analysis')).json();await graphToolbar(page,'编辑画布');await node(page,f.testing.id).locator('.dependency-card').click();await focusGraph(page);await page.keyboard.press('Shift+ArrowRight');await graphToolbar(page,'保存修改');await expect(page.getByLabel('编辑画布',{exact:true})).toBeVisible();const layouts=await(await page.request.get(f.base+'/diagram-layouts')).json();expect(layouts.some((l:{scope:string})=>l.scope==='feature-phase:'+f.feature.id+':'+f.phases[1].id)).toBe(true);const after=await(await page.request.get(f.base+'/path-analysis')).json();expect(after.dependencies).toEqual(before.dependencies);expect(after.forecastEnd).toEqual(before.forecastEnd);expect((await(await page.request.get('/api/requirements/'+f.testing.id)).json()).phaseId).toBe(f.phases[1].id);
 await page.goto('/features?feature='+f.feature.id);await expect(page).toHaveURL(/workspaceView=list/);await expect(detail(page)).toContainText('资产管理');await closeGraphProperties(page);await page.getByRole('button',{name:'展开全部',exact:true}).click();await expect(page.locator('.workspace-outline')).toContainText('Phase 2');
});

test('关系图详情更新工作进度，需求返工及再次完成自动汇总 Phase',async({page})=>{
 const f=await phaseFixture(page);const phases=await(await page.request.get(f.base+'/feature-phases')).json();const done=phases.find((p:{id:string})=>p.id===f.phases[0].id).requirements[0];const originalHistory=phases.find((p:{id:string})=>p.id===f.phases[0].id).deliveries;
 await page.goto(url(f,'graph','phase',f.phases[0].id,done.id));await ready(page);await detail(page).getByRole('button',{name:'返工',exact:true}).click();const rework=page.getByRole('dialog',{name:'返工',exact:true});await rework.getByLabel('需求完成度').fill('90');await rework.getByLabel('执行说明').fill('回访确认后再次交付');await rework.getByRole('button',{name:'返工',exact:true}).click();await expect(rework).toHaveCount(0);
 const phase=async()=>(await(await page.request.get(f.base+'/feature-phases')).json()).find((p:{id:string})=>p.id===f.phases[0].id);await expect.poll(async()=>(await phase()).status).toBe('in_progress');await detail(page).getByRole('button',{name:'完成需求',exact:true}).click();await expect.poll(async()=>(await phase()).status).toBe('completed');expect((await phase()).deliveries).toEqual(originalHistory);
 await page.goto(url(f,'graph','requirement',f.testing.id,f.testing.workItems[1].id));await ready(page);await detail(page).getByRole('button',{name:'更新',exact:true}).click();const progress=page.getByRole('dialog',{name:'更新工作项进度',exact:true});await progress.getByRole('spinbutton').fill('75');await progress.getByRole('textbox',{name:/^说明/}).fill('工作区内记录验证进展');await progress.getByRole('button',{name:'记录进展',exact:true}).click();await expect(progress).toHaveCount(0);await expect(detail(page)).toContainText('75%');await closeGraphProperties(page);await page.getByRole('button',{name:'清单',exact:true}).click();await expect(page.locator('[data-object-id="'+f.testing.workItems[1].id+'"]')).toContainText('75%');expect(new URL(page.url()).pathname).toBe('/');
});
