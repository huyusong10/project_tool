import {closeGraphProperties,graphProperties,graphToolbar} from './graph-interactions';
import {chooseOption,selectedValue} from './select-helper';
import {expect,test,type Page} from '@playwright/test';
import {phaseFixture} from './phase-fixture';
import {headerAction} from './topbar-helpers';
const view=(page:Page,name:string)=>page.getByRole('region',{name:'页面工具栏'}).getByRole('button',{name,exact:true});
const row=(page:Page,id:string)=>page.locator('[data-object-id="'+id+'"]');
const create=async(page:Page,name:string)=>{await page.getByRole('button',{name:'新建对象',exact:true}).click();await page.getByRole('menu',{name:'新建对象'}).getByRole('button',{name,exact:true}).click();};
const moveRow=async(page:Page,id:string)=>{await row(page,id).locator('.outline-row-actions button').click();await page.getByRole('menu').getByRole('button',{name:'调整归属…',exact:true}).click();};

test('项目层新建需求响应丢失，默认归类仍能核对且不重复创建',async({page})=>{
  const f=await phaseFixture(page);await page.goto('/');let writes=0;await page.route('**/api/requirements',async route=>{if(route.request().method()==='POST'){writes++;await route.fetch();await route.abort('failed');}else await route.continue();});
  await create(page,'新建需求');await page.getByLabel('需求标题',{exact:true}).fill('待核对的临时需求');await page.getByRole('dialog').getByRole('button',{name:'创建需求',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('创建结果待核对');await page.reload();await expect(page.getByLabel('需求标题',{exact:true})).toHaveValue('待核对的临时需求');await page.getByRole('button',{name:'读取最新需求并继续',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect(writes).toBe(1);const requirements=await(await page.request.get('/api/requirements?projectId='+f.projectId)).json();expect(requirements.filter((r:{title:string})=>r.title==='待核对的临时需求')).toHaveLength(1);
});

test('直接创建工作项、旧需求链接和旧进展筛选均使用公共工作区',async({page})=>{
  const f=await phaseFixture(page);const result=await page.request.post('/api/requirements',{data:{projectId:f.projectId,title:'待拆分需求',featureId:f.feature.id}});expect(result.ok()).toBe(true);const requirement=await result.json();
  await page.goto('/requirements/'+requirement.id);await expect(page.getByRole('navigation',{name:'项目层级'})).toContainText('待拆分需求');await expect(page.getByRole('navigation',{name:'项目层级'}).getByRole('button')).toHaveCount(2);
  await page.locator('.modal-card-workspace[role=dialog]').getByRole('button',{name:'关闭',exact:true}).click();await view(page,'清单').click();await create(page,'新建工作项');await expect(page.getByRole('dialog')).toHaveCount(1);const dialog=page.getByRole('dialog');
  await dialog.getByLabel('新工作项名称',{exact:true}).fill('验证资料');await dialog.getByRole('button',{name:'保存工作项',exact:true}).click();await expect(dialog.getByRole('form',{name:'新增工作项'})).toHaveCount(0);await closeGraphProperties(page);await expect.poll(async()=>(await(await page.request.get('/api/requirements/'+requirement.id)).json()).workItems.length).toBe(1);await expect(page.locator('.outline-table')).toContainText('验证资料');
  await page.getByRole('button',{name:'上一级',exact:true}).click();await page.goBack();await expect(page.getByRole('navigation',{name:'项目层级'})).toContainText('待拆分需求');await page.goForward();expect(new URL(page.url()).searchParams.get('scopeId')).toBe(f.feature.id);
  await row(page,'unphased:'+f.feature.id).getByRole('button',{name:'展开未分派阶段',exact:true}).click();await moveRow(page,requirement.id);const moveDialog=page.getByRole('dialog');await chooseOption(moveDialog.getByLabel('需求特性',{exact:true}), '');await moveDialog.getByRole('button',{name:'确认移动',exact:true}).click();await expect(moveDialog).toHaveCount(0);await expect.poll(async()=>(await(await page.request.get('/api/requirements/'+requirement.id)).json()).featureName).toBe('其他需求');
  await page.goto('/execution?feature='+f.feature.id+'&status=in_progress');await expect(view(page,'进展表')).toBeVisible();await expect.poll(()=>new URL(page.url()).searchParams.get('progressStatus')).toBe('in_progress');expect(new URL(page.url()).searchParams.get('scopeId')).toBe(f.feature.id);
});

test('外部前置可查看资料，进入来源才改变范围',async({page})=>{
  const f=await phaseFixture(page);const target=await(await page.request.post('/api/requirements',{data:{projectId:f.projectId,title:'后续集成',featureId:f.feature.id,phaseId:f.phases[2].id}})).json();const analysis=await(await page.request.get(f.base+'/path-analysis')).json();const dependency=await page.request.post(f.base+'/dependencies',{data:{expectedRevision:analysis.revision,sourceRequirementId:f.testing.id,targetRequirementId:target.id}});expect(dependency.ok(),await dependency.text()).toBe(true);
  await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'graph',scopeType:'phase',scopeId:f.phases[2].id}));await expect(page.locator('[data-layout-ready=true]')).toBeVisible();const external=page.locator('.react-flow__node[data-id="'+f.testing.id+'"]');await expect(external).not.toHaveClass(/graph-node-hidden/);await external.getByRole('button',{name:f.testing.title,exact:true}).click();const detail=page.locator('.modal-card-workspace[role=dialog]');await expect(detail).toBeVisible();expect(new URL(page.url()).searchParams.get('scopeId')).toBe(f.phases[2].id);await detail.getByRole('button',{name:'进入需求',exact:true}).click();await expect.poll(()=>new URL(page.url()).searchParams.get('scopeId')).toBe(f.testing.id);await expect(page.getByRole('navigation',{name:'项目层级'})).toContainText('Phase 2');
});
test('统一范围、面包屑和资料表单；概览不受筛选影响',async({page},info)=>{
  test.setTimeout(90000);const f=await phaseFixture(page),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.locator('.workspace-outline')).toBeVisible();await expect(view(page,'清单')).toBeVisible();
  await row(page,'feature:'+f.feature.id).getByRole('button',{name:'展开资产管理',exact:true}).click();await expect(row(page,'phase:'+f.phases[1].id)).toBeVisible();expect(new URL(page.url()).searchParams.get('scopeType')).toBe('project');
  await page.getByRole('button',{name:'展开概览',exact:true}).click();await page.screenshot({path:info.outputPath('workspace-list-overview.png'),animations:'disabled'});await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
  await row(page,'feature:'+f.feature.id).locator('.outline-title').click();const detail=page.locator('.modal-card-workspace[role=dialog]');await detail.getByRole('button',{name:'编辑特性',exact:true}).click();const editor=page.getByRole('dialog',{name:'编辑特性',exact:true});await editor.getByLabel('长期目标与范围').fill('尚未提交的目标');await editor.getByRole('button',{name:'关闭',exact:true}).first().click();await closeGraphProperties(page);
  for(const name of ['关系图','进展表','清单']){await view(page,name).click();
    if(name==='关系图'){await expect(page.locator('[data-layout-ready=true]')).toBeVisible();await graphProperties(page,page.locator('.react-flow__node[data-id="feature:'+f.feature.id+'"]'));}
    else if(name==='进展表')await page.locator('[data-row-id="feature:'+f.feature.id+'"] .workspace-row-title').click();else await row(page,'feature:'+f.feature.id).locator('.outline-title').click();
    await detail.getByRole('button',{name:'编辑特性',exact:true}).click();await expect(editor.getByLabel('长期目标与范围')).toHaveValue('尚未提交的目标');expect(new URL(page.url()).searchParams.get('scopeType')).toBe('project');
    await editor.getByRole('button',{name:'关闭',exact:true}).first().click();await closeGraphProperties(page);
  }

  await row(page,'phase:'+f.phases[1].id).getByRole('button',{name:'进入Phase 2',exact:true}).click();await expect(page.getByRole('navigation',{name:'项目层级'})).toContainText('Phase 2');await expect(row(page,f.testing.id)).toBeVisible();
  for(const name of ['关系图','进展表','清单']){await view(page,name).click();await expect(page.getByRole('navigation',{name:'项目层级'})).toContainText('Phase 2');expect(new URL(page.url()).searchParams.get('scopeId')).toBe(f.phases[1].id);}
  const summary=await page.getByRole('region',{name:'当前范围概览'}).innerText();await page.getByRole('searchbox',{name:'筛选清单'}).fill('无匹配内容');await expect(page.getByRole('region',{name:'当前范围概览'})).toHaveText(summary,{useInnerText:true});await page.getByRole('searchbox',{name:'筛选清单'}).fill('');
  await row(page,f.testing.id).getByRole('button',{name:'进入'+f.testing.title,exact:true}).click();await view(page,'进展表').click();await expect(page.getByRole('navigation',{name:'项目层级'})).toContainText(f.testing.title);await expect(page.locator('.workspace-gantt')).not.toContainText(f.direct.title);
  await page.screenshot({path:info.outputPath('workspace-progress.png'),animations:'disabled'});
  await page.getByRole('button',{name:'上一级',exact:true}).click();expect(new URL(page.url()).searchParams.get('scopeId')).toBe(f.phases[1].id);expect(new URL(page.url()).searchParams.get('workspaceView')).toBe('progress');
  await view(page,'清单').click();await row(page,f.testing.id).locator('.outline-title').click();await expect(detail).toBeVisible();expect(errors).toEqual([]);
});
test('清单直接创建 Phase，移动与撤销，键盘排序和筛选保护',async({page})=>{
  test.setTimeout(90000);const f=await phaseFixture(page);await page.goto('/features?featureId='+f.feature.id+'&view=feature');
  await create(page,'新建 Phase');const dialog=page.getByRole('dialog').last();await dialog.getByLabel('Phase 名称').fill('第四批交付');await dialog.getByRole('button',{name:'新建 Phase',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.outline-table')).toContainText('第四批交付');
  await row(page,'phase:'+f.phases[1].id).getByRole('button',{name:'展开Phase 2',exact:true}).click();await row(page,f.direct.id).getByRole('checkbox').check();await page.getByRole('region',{name:'批量操作'}).getByRole('button',{name:'调整归属…'}).click();await chooseOption(dialog.getByLabel('需求特性',{exact:true}), f.feature.id);await chooseOption(dialog.getByLabel('需求 Phase',{exact:true}), f.phases[2].id);await dialog.getByLabel('变更原因',{exact:true}).fill('后续批次交付');await dialog.getByRole('button',{name:'确认移动'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await(await page.request.get('/api/requirements/'+f.direct.id)).json()).phaseId).toBe(f.phases[2].id);await page.getByRole('button',{name:'撤销本次操作',exact:true}).click();await dialog.locator('textarea').fill('恢复本次安排');await dialog.getByRole('button',{name:'确认撤销'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect((await(await page.request.get('/api/requirements/'+f.direct.id)).json()).phaseId).toBe(f.phases[1].id);
  await row(page,'phase:'+f.phases[2].id).getByRole('button',{name:'拖动Phase 3',exact:true}).focus();await page.keyboard.press('Alt+ArrowUp');await expect(page.getByRole('status').filter({hasText:'调整顺序已保存'})).toBeVisible();await page.getByRole('searchbox',{name:'筛选清单'}).fill('Phase');await expect(page.locator('.outline-help')).toContainText('行间排序拖拽已停用');
});

test('排序响应丢失后先核对正式结果，刷新不会重复提交',async({page})=>{
  const f=await phaseFixture(page);await page.goto('/features?featureId='+f.feature.id+'&view=feature');let writes=0;
  await page.route('**'+f.base+'/outline-order',async route=>{writes++;await route.fetch();await route.abort('failed');});
  await row(page,'phase:'+f.phases[2].id).getByRole('button',{name:'拖动Phase 3',exact:true}).focus();await page.keyboard.press('Alt+ArrowUp');await expect(page.locator('.outline-notice')).toContainText('提交结果待核对');
  await page.reload();await expect(page.locator('.outline-notice')).toContainText('提交结果待核对');await page.getByRole('button',{name:'读取正式结果并核对',exact:true}).click();const dialog=page.getByRole('dialog').last();await expect(dialog).toContainText('Phase 3');await dialog.getByRole('button',{name:'确认已生效，结束核对'}).click();expect(writes).toBe(1);await expect(page.locator('.outline-notice')).not.toContainText('待核对');
});

test('版本冲突保留目标和原因，读取最新资料后明确再次提交',async({page})=>{
  const f=await phaseFixture(page);await page.goto('/features?featureId='+f.feature.id+'&view=feature');await row(page,'phase:'+f.phases[1].id).getByRole('button',{name:'展开Phase 2',exact:true}).click();
  await moveRow(page,f.direct.id);const dialog=page.getByRole('dialog').last();await chooseOption(dialog.getByLabel('需求特性',{exact:true}), f.feature.id);await chooseOption(dialog.getByLabel('需求 Phase',{exact:true}), f.phases[2].id);await dialog.getByLabel('变更原因',{exact:true}).fill('保留这个变更原因');
  let first=true;await page.route('**'+f.base+'/requirement-placement',async route=>{if(first){first=false;await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'其他页面修改了版本',code:'STALE_WRITE'})});}else await route.continue();});
  await dialog.getByRole('button',{name:'确认移动'}).click();await dialog.getByRole('button',{name:'读取正式结果并核对'}).click();await page.getByRole('dialog').last().getByRole('button',{name:'保留输入，按最新资料继续'}).click();await expect(dialog.getByLabel('变更原因',{exact:true})).toHaveValue('保留这个变更原因');await expect(selectedValue(dialog.getByLabel('需求 Phase',{exact:true}))).toHaveValue(f.phases[2].id);await dialog.getByRole('button',{name:'确认移动'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('拖拽多选需求保持原顺序，其他需求置底，非法目标不写入',async({page})=>{
  const f=await phaseFixture(page),supplement=await page.request.post('/api/requirements',{data:{projectId:f.projectId,title:'临时补充需求'}});expect(supplement.ok()).toBe(true);
  await page.goto('/features?featureId='+f.feature.id+'&view=feature');await row(page,'phase:'+f.phases[1].id).getByRole('button',{name:'展开Phase 2',exact:true}).click();await row(page,f.direct.id).getByRole('checkbox').check();await row(page,f.testing.id).getByRole('checkbox').check();
  await row(page,f.testing.id).getByRole('button',{name:'拖动'+f.testing.title,exact:true}).dragTo(row(page,'phase:'+f.phases[2].id));const dialog=page.getByRole('dialog').last();await expect(selectedValue(dialog.getByLabel('需求 Phase',{exact:true}))).toHaveValue(f.phases[2].id);await dialog.getByLabel('变更原因',{exact:true}).fill('一起移入下一批');await dialog.getByRole('button',{name:'确认移动'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  const result=await(await page.request.get('/api/requirements/query?projectId='+f.projectId+'&phaseId='+f.phases[2].id+'&sort=manual')).json();expect(result.items.map((r:{id:string})=>r.id)).toEqual([f.testing.id,f.direct.id]);
  await page.getByRole('button',{name:'上一级',exact:true}).click();await chooseOption(page.getByLabel('清单排序'), 'name');await expect(page.locator('.outline-table tbody tr').last()).toContainText('其他需求');await chooseOption(page.getByLabel('清单排序'), 'date');await expect(page.locator('.outline-table tbody tr').last()).toContainText('其他需求');let illegalWrites=0;page.on('request',r=>{if(r.method()==='POST'&&/outline-order|requirement-placement/.test(r.url()))illegalWrites++;});await row(page,'feature:'+f.feature.id).getByRole('button',{name:'拖动资产管理',exact:true}).dragTo(page.locator('.outline-table tbody tr').last());expect(illegalWrites).toBe(0);
});

test('图形业务草稿跨视角保存，进展更新沿用正式记录，旧导入入口可用',async({page})=>{
  test.setTimeout(90000);const f=await phaseFixture(page);await page.goto('/paths?view=requirement&requirementId='+f.testing.id+'&pathNode='+f.testing.workItems[1].id+'&pathInspector=open');await expect(page.locator('[data-layout-ready="true"]')).toBeVisible({timeout:20000});
  await graphToolbar(page,'编辑画布');await graphProperties(page,page.locator('.react-flow__node[data-id="'+f.testing.workItems[1].id+'"]'));await page.getByLabel('元素名称',{exact:true}).fill('测试场景草稿');await page.getByLabel('元素名称',{exact:true}).blur();await closeGraphProperties(page);await view(page,'清单').click();await expect(row(page,f.testing.workItems[1].id)).toContainText('测试');await headerAction(page,'保存项目草稿');await expect.poll(async()=>(await(await page.request.get('/api/requirements/'+f.testing.id)).json()).workItems[1].title).toBe('测试场景草稿');
  await view(page,'进展表').click();const work=page.locator('[data-row-id="'+f.testing.workItems[1].id+'"]');await expect(work).toBeVisible();const detail=page.locator('.modal-card-workspace[role=dialog]');await work.locator('.workspace-row-title').click();await detail.getByRole('button',{name:'更新',exact:true}).click();const dialog=page.getByRole('dialog').last();await dialog.getByRole('spinbutton').fill('75');await dialog.getByRole('textbox',{name:/^说明/}).fill('例会对齐验证进展');await dialog.getByRole('button',{name:'记录进展',exact:true}).click();await expect(page.getByRole('button',{name:'记录进展',exact:true})).toHaveCount(0);await expect(detail.getByRole('button',{name:'更新',exact:true})).toContainText('75%');expect((await(await page.request.get('/api/requirements/'+f.testing.id)).json()).workItems[1].progress).toBe(75);
  await page.goto('/requirements?intakeView=import');await page.getByLabel('原始需求',{exact:true}).fill('预览导入需求\n保留补充说明');await page.getByRole('button',{name:'整理需求',exact:true}).click();await page.getByRole('button',{name:'预览导入',exact:true}).click();await page.getByRole('button',{name:'保存需求',exact:true}).click();await expect(page.getByText('已保存 1 个需求',{exact:true})).toBeVisible();
});
