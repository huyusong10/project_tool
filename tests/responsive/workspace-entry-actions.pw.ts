import {expect,test,type Page} from '@playwright/test';
import {phaseFixture} from './phase-fixture';
import {chooseOption} from './select-helper';
import {headerAction} from './topbar-helpers';

const toolbar=(page:Page)=>page.getByRole('region',{name:'页面工具栏'});
const view=async(page:Page,name:string)=>toolbar(page).getByRole('button',{name,exact:true}).click();
const create=async(page:Page,name:string)=>{await toolbar(page).getByRole('button',{name:'新建对象',exact:true}).click();await page.getByRole('menu',{name:'新建对象'}).getByRole('button',{name,exact:true}).click();};
const url=(projectId:string,scopeType:string,scopeId:string,workspaceView='progress')=>'/?'+new URLSearchParams({projectId,workspaceView,scopeType,scopeId});

test('空对象在进展表可见，特性内筛选继承当前位置，视图切换保留创建入口',async({page},info)=>{
  const f=await phaseFixture(page);
  const empty=(await(await page.request.post(f.base+'/features',{data:{name:'设备接入（SBI）'}})).json()).features.find((x:{name:string})=>x.name==='设备接入（SBI）');
  await page.goto(url(f.projectId,'project',f.projectId));
  await expect(page.locator('[data-row-id="feature:'+empty.id+'"]')).toContainText('暂无需求');
  await page.goto(url(f.projectId,'feature',f.feature.id)+'&progressFeatureId='+empty.id+'&progressPhaseId=foreign');
  await expect(page.locator('[data-row-id="phase:'+f.phases[2].id+'"]')).toContainText('待细化');
  await expect(page.getByRole('combobox',{name:'进展特性',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'更多筛选',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'进展 Phase',exact:true})).toBeEnabled();
  await chooseOption(page.getByRole('combobox',{name:'进展 Phase',exact:true}),f.phases[2].id);
  await page.getByRole('region',{name:'更多进展筛选'}).getByRole('button',{name:'关闭',exact:true}).click();
  await expect(page.locator('[data-row-id="phase:'+f.phases[2].id+'"]')).toBeVisible();
  await page.getByRole('button',{name:'重置',exact:true}).click();
  for(const name of ['清单','关系图','进展表']){
    await view(page,name);await create(page,'新建 Phase');
    await expect(page.getByRole('dialog',{name:'新建 Phase'})).toBeVisible();
    await page.getByRole('dialog',{name:'新建 Phase'}).getByRole('button',{name:'取消',exact:true}).click();
  }
  await page.goto(url(f.projectId,'phase',f.phases[2].id));
  await expect(page.locator('.workspace-empty:visible')).toContainText('本 Phase 暂无需求');
  await expect(page.locator('.workspace-empty:visible').getByRole('button',{name:'移入需求',exact:true})).toBeVisible();
  await expect(page.locator('.workspace-empty:visible').getByRole('button',{name:'新建需求',exact:true})).toBeInViewport();
  await page.screenshot({path:info.outputPath('empty-phase.png'),animations:'disabled'});
  await page.setViewportSize({width:390,height:844});await view(page,'关系图');
  await expect(toolbar(page).getByRole('button',{name:'新建对象',exact:true})).toBeVisible();
  await expect(page.locator('.workspace-graph-empty').getByRole('button',{name:'新建需求',exact:true})).toBeInViewport();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('mobile-actions.png'),animations:'disabled'});
});

test('需求录入就地创建 Phase，取消保留输入，成功后只在保存需求时写入归属',async({page})=>{
  const f=await phaseFixture(page);
  const latest=await(await page.request.get(f.base+'/feature-phases')).json();
  for(const p of latest.filter((p:{deliveredAt:string|null})=>!p.deliveredAt)){const response=await page.request.post(f.base+'/features/'+f.feature.id+'/phases',{data:{id:p.id,expectedVersion:p.version,name:p.name+' 交付说明',reason:'补充名称'}});expect(response.ok(),await response.text()).toBe(true);}
  await page.goto(url(f.projectId,'feature',f.feature.id,'list'));await create(page,'新建需求');
  const form=page.getByRole('dialog',{name:'新建需求',exact:true});await form.getByLabel('需求标题',{exact:true}).fill('输入应保留');
  await form.getByRole('button',{name:'新建 Phase…',exact:true}).click();
  let phase=page.getByRole('dialog',{name:'新建 Phase',exact:true});await expect(phase.getByLabel('Phase 名称')).toHaveValue('Phase 4');
  await phase.getByRole('button',{name:'取消',exact:true}).click();await expect(form.getByLabel('需求标题',{exact:true})).toHaveValue('输入应保留');
  await chooseOption(form.getByRole('combobox',{name:'需求 Phase',exact:true}),'__create_phase__');
  phase=page.getByRole('dialog',{name:'新建 Phase',exact:true});await phase.getByRole('button',{name:'新建 Phase',exact:true}).click();
  await expect(phase).toHaveCount(0);await expect(form.getByRole('combobox',{name:'需求 Phase',exact:true})).toContainText('Phase 4');
  const before=await(await page.request.get('/api/requirements?projectId='+f.projectId)).json();expect(before.some((r:{title:string})=>r.title==='输入应保留')).toBe(false);
  await form.getByRole('button',{name:'创建需求',exact:true}).click();await expect(form).toHaveCount(0);
  const saved=await(await page.request.get('/api/requirements?projectId='+f.projectId)).json();expect(saved.find((r:{title:string})=>r.title==='输入应保留').phaseName).toBe('Phase 4');
});

test('已有需求可就地创建 Phase，保存前不移动；请求结果未知时核对而不重复创建',async({page})=>{
  const f=await phaseFixture(page),r=await(await page.request.post('/api/requirements',{data:{projectId:f.projectId,title:'归属编辑验证',featureId:f.feature.id}})).json();
  await page.goto(url(f.projectId,'requirement',r.id,'list'));await headerAction(page,'编辑需求');
  const form=page.getByRole('dialog',{name:'编辑需求信息'});await expect(form).toBeVisible();
  await form.getByLabel('需求标题',{exact:true}).fill('归属编辑保留输入');
  let writes=0;await page.route('**'+f.base+'/features/'+f.feature.id+'/phases',async route=>{if(route.request().method()==='POST'){writes++;await route.fetch();await route.abort('failed');}else await route.continue();});
  await form.getByRole('button',{name:'新建 Phase…',exact:true}).click();const phase=page.getByRole('dialog',{name:'新建 Phase',exact:true});await phase.getByRole('button',{name:'新建 Phase',exact:true}).click();
  await phase.getByRole('button',{name:'读取最新 Phase 并核对'}).click();await expect(phase).toHaveCount(0);expect(writes).toBe(1);
  await expect(form.getByRole('combobox',{name:'需求 Phase',exact:true})).toContainText('Phase 4');
  expect((await(await page.request.get('/api/requirements/'+r.id)).json()).phaseId).toBeNull();
  await expect(form.getByLabel('需求标题',{exact:true})).toHaveValue('归属编辑保留输入');await form.getByRole('button',{name:'保存信息',exact:true}).click();await expect(form).toHaveCount(0);
  expect((await(await page.request.get('/api/requirements/'+r.id)).json()).phaseName).toBe('Phase 4');
});

test('关系图入口直达交付范围和导入，导入预选当前特性，详情操作不随页签消失',async({page},info)=>{
  const f=await phaseFixture(page);await page.goto(url(f.projectId,'feature',f.feature.id,'graph'));await headerAction(page,'交付范围');
  const detail=page.getByRole('dialog',{name:f.feature.name,exact:true});await expect(detail.getByRole('tab',{name:'交付范围'})).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('dialog',{name:'交付资料'})).toHaveCount(0);
  for(const tab of ['概况','资料','记录']){await detail.getByRole('tab',{name:tab,exact:true}).click();await expect(detail.getByRole('button',{name:'新建 Phase',exact:true})).toBeVisible();}
  await page.screenshot({path:info.outputPath('feature-actions.png'),animations:'disabled'});
  await detail.getByRole('button',{name:'关闭',exact:true}).click();await headerAction(page,'导入需求');
  await expect(page.getByRole('heading',{name:'导入需求',exact:true})).toBeVisible();await page.getByRole('textbox',{name:'原始需求'}).fill('导入入口测试\n确认归属预选');await page.getByRole('button',{name:'整理需求',exact:true}).click();
  await expect(page.getByLabel('特性',{exact:true})).toHaveValue(f.feature.name);
  await toolbar(page).getByRole('button',{name:'返回工作区'}).click();await expect(toolbar(page).getByRole('button',{name:'关系图',exact:true})).toHaveAttribute('aria-pressed','true');
});

test('项目入口回到项目层级；系统归类和归档保持限制，已完成 Phase 可以补充需求',async({page})=>{
  const f=await phaseFixture(page);await page.goto(url(f.projectId,'feature',f.feature.id));
  await page.goto('/');await expect.poll(()=>new URL(page.url()).searchParams.get('scopeType')).toBe('project');
  await page.request.post('/api/requirements',{data:{projectId:f.projectId,title:'未归类需求'}});
  const report=await(await page.request.get('/api/dashboard?projectId='+f.projectId)).json();const other=report.featureOverview.features.find((x:{kind:string})=>x.kind==='other');
  await page.goto(url(f.projectId,'feature',other.id));await toolbar(page).getByRole('button',{name:'新建对象',exact:true}).click();await expect(page.getByRole('menu',{name:'新建对象'}).getByRole('button',{name:'新建 Phase',exact:true})).toHaveCount(0);
  const archived=(await(await page.request.post(f.base+'/features',{data:{name:'已归档特性'}})).json()).features.find((x:{name:string})=>x.name==='已归档特性');
  const archivedResult=await page.request.post(f.base+'/features/'+archived.id+'/archive',{data:{expectedVersion:archived.version}});expect(archivedResult.ok(),await archivedResult.text()).toBe(true);
  await page.goto(url(f.projectId,'feature',archived.id));await expect(page.locator('.workspace-gantt')).toBeVisible();await expect(toolbar(page).getByRole('button',{name:'新建对象',exact:true})).toHaveCount(0);
  await page.goto(url(f.projectId,'phase',f.phases[0].id));await expect(page.locator('.workspace-gantt')).toBeVisible();await expect(toolbar(page).getByRole('button',{name:'新建对象',exact:true})).toBeVisible();
});


test('只读角色不显示新建或移入入口',async({page})=>{
  const f=await phaseFixture(page);
  await page.route('**/api/session',async route=>{const response=await route.fetch();const session=await response.json();await route.fulfill({json:{...session,role:'user',globalRole:'user',managedProjectIds:[]}});});
  await page.goto(url(f.projectId,'feature',f.feature.id));
  await expect(page.locator('.workspace-gantt')).toBeVisible();await expect(toolbar(page).getByRole('button',{name:'新建对象',exact:true})).toHaveCount(0);
  await toolbar(page).getByRole('button',{name:'更多操作',exact:true}).click();await expect(page.getByRole('menu',{name:'更多操作'}).getByRole('button',{name:'移入需求',exact:true})).toHaveCount(0);
});

test('Phase 移入支持其他特性的需求，需求调整归属和清单移动复用 Phase 选择',async({page})=>{
  const f=await phaseFixture(page),other=(await(await page.request.post(f.base+'/features',{data:{name:'权限管理'}})).json()).features.find((x:{name:string})=>x.name==='权限管理');
  const r=await(await page.request.post('/api/requirements',{data:{projectId:f.projectId,title:'跨特性归属',featureId:other.id}})).json();
  await page.goto(url(f.projectId,'phase',f.phases[2].id));await headerAction(page,'移入需求');
  let form=page.getByRole('dialog',{name:'移入需求',exact:true});await form.getByRole('checkbox',{name:/跨特性归属/}).check();await form.getByRole('button',{name:'保存安排',exact:true}).click();await expect(form).toHaveCount(0);
  expect((await(await page.request.get('/api/requirements/'+r.id)).json()).phaseId).toBe(f.phases[2].id);
  await page.goto(url(f.projectId,'requirement',r.id,'list'));await headerAction(page,'调整归属');form=page.getByRole('dialog',{name:'调整需求归属',exact:true});
  await expect(form.getByRole('checkbox',{name:/跨特性归属/})).toBeChecked();await chooseOption(form.getByRole('combobox',{name:'目标特性',exact:true}),other.id);await form.getByRole('button',{name:'保存安排',exact:true}).click();await expect(form).toHaveCount(0);
  await page.goto(url(f.projectId,'feature',other.id,'list'));const group=page.locator('[data-object-id="unphased:'+other.id+'"]');await group.getByRole('button',{name:'展开未分派阶段',exact:true}).click();
  await page.locator('[data-object-id="'+r.id+'"]').getByRole('button',{name:r.title+'操作',exact:true}).click();await page.getByRole('menu').getByRole('button',{name:'调整归属…',exact:true}).click();
  form=page.getByRole('dialog',{name:'调整 1 条需求归属',exact:true});await chooseOption(form.getByRole('combobox',{name:'需求特性',exact:true}),f.feature.id);await chooseOption(form.getByRole('combobox',{name:'需求 Phase',exact:true}),f.phases[2].id);await form.getByRole('button',{name:'确认移动',exact:true}).click();await expect(form).toHaveCount(0);
  expect((await(await page.request.get('/api/requirements/'+r.id)).json()).phaseId).toBe(f.phases[2].id);
  await page.getByRole('button',{name:'撤销本次操作',exact:true}).click();await page.getByRole('dialog',{name:'撤销本次操作'}).getByRole('button',{name:'确认撤销',exact:true}).click();
  await expect.poll(async()=>(await(await page.request.get('/api/requirements/'+r.id)).json()).featureId).toBe(other.id);
});
