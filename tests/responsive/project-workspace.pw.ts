import {expect,test} from '@playwright/test';
import {phaseFixture} from './phase-fixture';
import {chooseOption} from './select-helper';

test('长标题与 60 个工作项按展开范围渲染，跨特性依赖保留',async({page},info)=>{
  const f=await phaseFixture(page),post=async(url:string,data:unknown)=>{const r=await page.request.post(url,{data});expect(r.ok(),await r.text()).toBe(true);return r.json();};
  const name='多站点数据采集、存储、指标建模与资产关联验证'.repeat(3);
  const feature=(await post(f.base+'/features',{name,description:'范围与依赖布局压力场景'})).features.find((v:{name:string})=>v.name===name);
  const phase=await post(f.base+'/features/'+feature.id+'/phases',{name:'迭代探索',scope:'分批对齐 60 个现场站点'});
  const template=await post('/api/templates',{projectId:f.projectId,name:'大量工作项',dependencyMode:'legacy',items:Array.from({length:60},(_,i)=>({title:'工作项 '+i,durationDays:1,startOffsetDays:i,sortOrder:i}))});
  const r=await post('/api/requirements',{projectId:f.projectId,title:'长标题需求：'+name,featureId:feature.id,phaseId:phase.id,templateId:template.id,plannedStart:'2026-09-14'});
  const graph=await(await page.request.get(f.base+'/path-analysis')).json();await post(f.base+'/dependencies',{expectedRevision:graph.revision,sourceRequirementId:f.testing.id,targetRequirementId:r.id});
  let details=0;page.on('request',request=>{if(/\/api\/requirements\/[^/?]+$/.test(request.url()))details++;});
  await page.goto('/execution');const grid=page.getByRole('treegrid');await expect(grid).toContainText('迭代探索');expect(await grid.locator('[data-row-id]').count()).toBeLessThan(15);expect(details).toBe(0);
  await grid.getByRole('button',{name:'展开 '+r.title,exact:true}).click();await expect(grid.locator('.kind-work')).toHaveCount(60);expect(details).toBe(0);
  await page.getByPlaceholder('搜索名称或编号').fill('工作项 59');await expect(grid.locator('.kind-work')).toHaveCount(1);await expect(grid).toContainText('迭代探索');
  await page.screenshot({path:info.outputPath('large-gantt.png'),animations:'disabled'});
  await page.goto('/?'+new URLSearchParams({view:'feature',featureId:feature.id,phaseId:phase.id,mode:'graph',pathInspector:'closed'}));await expect(page.locator('[data-layout-ready=true]')).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="'+f.testing.id+'"]')).not.toHaveClass(/graph-node-hidden/);
  await page.screenshot({path:info.outputPath('large-phase-graph.png'),animations:'disabled'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('无效输入与项目草稿跨任务保留，执行更新检查冲突草稿',async({page})=>{
  const f=await phaseFixture(page),work=f.testing.workItems[1],tasks=page.getByRole('group',{name:'项目任务'});
  await page.goto('/?'+new URLSearchParams({view:'requirement',requirementId:f.testing.id,featureId:f.feature.id,mode:'graph',pathNode:work.id,pathInspector:'open'}));
  await expect(page.locator('[data-layout-ready=true]')).toBeVisible();await page.getByLabel('编辑画布',{exact:true}).click();
  await page.getByLabel('元素名称',{exact:true}).fill('');await tasks.getByRole('button',{name:'进展表',exact:true}).click();
  await expect(page.getByRole('treegrid')).toBeVisible();await tasks.getByRole('button',{name:'关系图',exact:true}).click();
  await expect(page.getByLabel('元素名称',{exact:true})).toHaveValue('');
  await page.getByLabel('元素名称',{exact:true}).fill('未保存的测试分解');await chooseOption(page.getByLabel('工作阶段',{exact:true}),'development');await tasks.getByRole('button',{name:'进展表',exact:true}).click();
  await expect(page.getByRole('treegrid').locator('[data-row-id="'+work.id+'"]')).toContainText('未保存的测试分解');
  await page.locator('.modal-card-workspace[role=dialog]').getByRole('button',{name:'更新进度',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'更新工作项进度',exact:true});await dialog.getByRole('spinbutton').fill('75');await dialog.getByRole('textbox',{name:/^说明/}).fill('检查独立执行冲突');await dialog.getByRole('button',{name:'记录进展',exact:true}).click();
  await expect(dialog).toContainText('草稿');const current=await(await page.request.get('/api/requirements/'+f.testing.id)).json();expect(current.workItems.find((w:{id:string})=>w.id===work.id).progress).toBe(70);
});

test('范围图与分层甘特共用定位和详情，工具栏及主画布位置稳定',async({page},info)=>{
  test.setTimeout(90000);const f=await phaseFixture(page),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.locator('[data-layout-ready=true]')).toBeVisible({timeout:20000});
  await expect(page.getByRole('link',{name:'项目工作区',exact:true})).toHaveCount(1);
  await expect(page.getByRole('link',{name:'需求管理',exact:true})).toHaveCount(0);
  await page.screenshot({path:info.outputPath('scope.png'),animations:'disabled'});
  const tasks=page.getByRole('group',{name:'项目任务'});await tasks.getByRole('button',{name:'进展表',exact:true}).click();
  const gantt=page.getByRole('treegrid',{name:'项目进展表'});await expect(gantt).toContainText('Phase 3');
  await expect(gantt.locator('[data-row-id="'+f.testing.id+'"]')).toBeVisible();
  const requirement=gantt.locator('[data-row-id="'+f.testing.id+'"]');await expect(requirement).toContainText('测试中 · 70%');
  expect(await requirement.locator('.gantt-date-plan,.gantt-date-actual').evaluateAll(nodes=>nodes.length>0&&nodes.every(node=>{const box=node.getBoundingClientRect(),row=node.closest('.workspace-row-track')!.getBoundingClientRect();return box.height>=6&&box.top>=row.top&&box.bottom<=row.bottom;}))).toBe(true);
  const bounds=await gantt.boundingBox();await requirement.locator('.workspace-row-title').click();
  await expect(page.locator('.modal-card-workspace[role=dialog]')).toContainText('安排与执行');
  expect(await gantt.boundingBox()).toEqual(bounds);
  await page.screenshot({path:info.outputPath('progress-detail.png'),animations:'disabled'});
  await page.locator('.modal-card-workspace[role=dialog]').getByRole('button',{name:'关闭',exact:true}).click();
  await requirement.getByRole('button',{name:'展开 '+f.testing.title,exact:true}).click();
  const work=gantt.locator('[data-row-id="'+f.testing.workItems[1].id+'"]');await work.locator('.workspace-row-title').click();
  await expect(page.locator('.modal-card-workspace[role=dialog]').getByRole('button',{name:'更新进度',exact:true})).toBeVisible();
  await tasks.getByRole('button',{name:'关系图',exact:true}).click();
  await expect(page).toHaveURL(new RegExp('requirementId='+f.testing.id));await expect(page).toHaveURL(new RegExp('featureId='+f.feature.id));await expect(page).toHaveURL(new RegExp('phaseId='+f.phases[1].id));await expect(page.locator('.graph-detail').filter({visible:true})).toContainText('更新进度');
  await tasks.getByRole('button',{name:'进展表',exact:true}).click();await expect(gantt.locator('[data-row-id="'+f.testing.workItems[1].id+'"]')).toHaveAttribute('aria-selected','true');
  await page.locator('.modal-card-workspace[role=dialog]').getByRole('button',{name:'关闭',exact:true}).click();
  await gantt.locator('[data-row-id="phase:'+f.phases[1].id+'"] .workspace-row-title').click();
  await tasks.getByRole('button',{name:'关系图',exact:true}).click();await expect(page.locator('.graph-detail').filter({visible:true})).toContainText('Phase 2');
  await expect(page.locator('select:visible')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
});

test('空范围、结构维护、全项目分析返回和窄屏详情',async({page},info)=>{
  test.setTimeout(90000);const f=await phaseFixture(page);
  await page.request.post(f.base+'/features',{data:{name:'空特性',description:'尚未分解'}});
  await page.goto('/features');await expect(page.locator('.delivery-table')).toContainText('空特性');
  await expect(page.getByRole('button',{name:'展开 空特性',exact:true})).toHaveCount(0);
  await page.goto('/requirements?feature='+f.feature.id);await expect(page).toHaveURL(/intake=1/);await expect(page.locator('.requirements-table')).toContainText('完成标准');
  await page.goto('/execution?featureId='+f.feature.id+'&phaseId='+f.phases[1].id);
  await expect(page.getByRole('treegrid')).toContainText('Phase 2');
  await page.getByRole('button',{name:'更多操作',exact:true}).click();await page.getByRole('button',{name:'统计分析 · 全项目',exact:true}).click();
  await expect(page.getByRole('navigation',{name:'页面层级'})).toContainText('全项目');await page.getByRole('button',{name:'返回',exact:true}).click();
  await expect(page).toHaveURL(new RegExp('phaseId='+f.phases[1].id));
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:/^更多筛选/}).click();await chooseOption(page.getByLabel('进展 Phase',{exact:true}),'');await page.getByRole('dialog').filter({has:page.getByLabel('更多进展筛选')}).getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('treegrid').locator('[data-row-id="phase:'+f.phases[1].id+'"] .workspace-row-title').click();
  const detail=page.locator('.modal-card-workspace[role=dialog]');await expect(detail).toBeVisible();
  const rect=await detail.boundingBox();expect(rect?.width).toBe(390);expect(rect?.x).toBe(0);
  await page.screenshot({path:info.outputPath('narrow-phase-detail.png'),animations:'disabled'});
  await detail.getByRole('button',{name:'关闭',exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('narrow-progress.png'),animations:'disabled'});
});
