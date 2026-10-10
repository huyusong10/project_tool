import {closeGraphProperties,graphProperties,graphToolbar} from './graph-interactions';
import {chooseOption,selectedValue} from './select-helper';
import {expect,test,type Page} from '@playwright/test';
import {phaseFixture} from './phase-fixture';
import {headerAction} from './topbar-helpers';
import type {Feature} from '../../src/shared/intake';
import type {Requirement} from '../../src/client/types';
const view=(page:Page,name:string)=>page.getByRole('region',{name:'页面工具栏'}).getByRole('button',{name,exact:true});
const row=(page:Page,id:string)=>page.locator('[data-object-id="'+id+'"]');
const create=async(page:Page,name:string)=>{await page.getByRole('button',{name:'新建对象',exact:true}).click();await page.getByRole('menu',{name:'新建对象'}).getByRole('button',{name,exact:true}).click();};
const moveRow=async(page:Page,id:string)=>{await row(page,id).locator('.outline-row-actions button').click();await page.getByRole('menu').getByRole('button',{name:'调整归属…',exact:true}).click();};

test('关系图名称键盘打开资料，下一级按钮保持范围导航',async({page})=>{
  const f=await phaseFixture(page);
  await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'graph',scopeType:'phase',scopeId:f.phases[1].id}));
  await expect(page.locator('[data-layout-ready=true]')).toBeVisible();
  const node=page.locator('.react-flow__node[data-id="'+f.testing.id+'"]'),detail=page.locator('.modal-card-workspace[role=dialog]');
  await node.getByRole('button',{name:f.testing.title,exact:true}).press('Enter');await expect(detail).toBeVisible();
  expect(new URL(page.url()).searchParams.get('scopeId')).toBe(f.phases[1].id);
  await closeGraphProperties(page);await node.getByRole('button',{name:f.testing.title,exact:true}).press('Space');await expect(detail).toBeVisible();
  await closeGraphProperties(page);await node.getByRole('button',{name:'进入'+f.testing.title,exact:true}).press('Enter');
  await expect.poll(()=>new URL(page.url()).searchParams.get('scopeId')).toBe(f.testing.id);await expect(detail).toHaveCount(0);
  await expect(page.locator('[data-layout-ready=true]')).toBeVisible();
  await page.getByRole('button',{name:'测试',exact:true}).press('Enter');await expect(detail).toContainText('工作项');
});

test('已选需求被他人移出当前 Phase 后，取消和再次移动均不覆盖他人归属',async({page})=>{
  const f=await phaseFixture(page),selection=page.getByRole('region',{name:'批量操作'});
  await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'list',scopeType:'phase',scopeId:f.phases[1].id}));
  await row(page,f.testing.id).getByRole('checkbox').check();await row(page,f.direct.id).getByRole('checkbox').check();await expect(selection).toContainText('已选 2 个需求');
  const moved=await page.request.post(f.base+'/requirement-placement',{data:{requirements:[{id:f.direct.id,expectedVersion:f.direct.version}],featureId:f.feature.id,phaseId:f.phases[2].id,reason:'另一页面调整交付批次'}});expect(moved.ok(),await moved.text()).toBe(true);
  const readDirect=async():Promise<Requirement>=> (await(await page.request.get('/api/requirements/'+f.direct.id)).json()),external=await readDirect();
  await page.evaluate(()=>{window.dispatchEvent(new Event('offline'));window.dispatchEvent(new Event('online'));});
  await expect(row(page,f.direct.id)).toHaveCount(0);await expect.soft(selection).toContainText('已选 1 个需求');await expect(row(page,f.testing.id).getByRole('checkbox')).toBeChecked();
  const writes:Array<{requirements:Array<{id:string}>}>=[];await page.route('**'+f.base+'/requirement-placement',route=>{writes.push(route.request().postDataJSON());return route.continue();});
  await selection.getByRole('button',{name:'调整归属…'}).click();let dialog=page.getByRole('dialog');await expect.soft(dialog).toContainText('调整 1 条需求归属');await dialog.getByRole('button',{name:'取消',exact:true}).click();
  expect(writes).toHaveLength(0);expect(await readDirect()).toEqual(external);
  await selection.getByRole('button',{name:'调整归属…'}).click();dialog=page.getByRole('dialog');await chooseOption(dialog.getByLabel('需求特性',{exact:true}),f.feature.id);await chooseOption(dialog.getByLabel('需求 Phase',{exact:true}),f.phases[0].id);await dialog.getByLabel('变更原因',{exact:true}).fill('仅调整当前批次中选中的需求');await dialog.getByRole('button',{name:'确认移动',exact:true}).click();
  await expect(dialog).toHaveCount(0);await expect(page.locator('.outline-notice')).toContainText('移动需求已保存');expect(writes).toHaveLength(1);expect.soft(writes[0].requirements.map(item=>item.id)).toEqual([f.testing.id]);
  // 项目预测修订号随其他需求移动更新；需求自身的版本、归属和其余资料保持。
  const after=await readDirect();expect(after).toEqual({...external,deliveryForecast:{...external.deliveryForecast,revision:after.deliveryForecast?.revision}});
  await page.reload();await expect(row(page,f.testing.id)).toHaveCount(0);expect.soft((await readDirect()).phaseId).toBe(f.phases[2].id);expect((await(await page.request.get('/api/requirements/'+f.testing.id)).json()).phaseId).toBe(f.phases[0].id);
});

test('已选特性被他人归档后清除选择，恢复不会再次加入批量操作',async({page})=>{
  const post=async(url:string,data:unknown)=>{const response=await page.request.post(url,{data});expect(response.ok(),await response.text()).toBe(true);return response.json();};
  const session=await post('/api/login',{username:'admin',password:'41_xc7q0qOjo4Inw!'}),project=await post('/api/projects',{name:'后台归档与选择'+Date.now()}),base='/api/projects/'+project.id+'/features';
  for(const name of ['选中特性甲','选中特性乙'])await post(base,{name});
  const read=async(state='active')=>(await(await page.request.get(base+'?state='+state)).json()) as Feature[];
  const features=await read(),a=features.find(feature=>feature.name==='选中特性甲')!,b=features.find(feature=>feature.name==='选中特性乙')!;
  await page.addInitScript(({accountId,projectId})=>localStorage.setItem('project-manage:selected-project:'+accountId,projectId),{accountId:session.accountId,projectId:project.id});
  await page.goto('/?'+new URLSearchParams({projectId:project.id,workspaceView:'list',scopeType:'project',scopeId:project.id}));
  const aCheckbox=row(page,'feature:'+a.id).getByRole('checkbox'),bCheckbox=row(page,'feature:'+b.id).getByRole('checkbox'),selection=page.getByRole('region',{name:'批量操作'});
  await aCheckbox.check();await bCheckbox.check();await expect(selection).toContainText('已选 2 个特性');
  await post(base+'/'+a.id+'/archive',{expectedVersion:a.version});
  const refresh=()=>page.evaluate(()=>{window.dispatchEvent(new Event('offline'));window.dispatchEvent(new Event('online'));});await refresh();
  await expect(aCheckbox).toBeDisabled();await expect.soft(aCheckbox).not.toBeChecked();await expect(selection).toContainText('已选 1 个特性');await expect(bCheckbox).toBeChecked();
  const archived=(await read('archived')).find(feature=>feature.id===a.id)!;await post(base+'/'+a.id+'/restore',{expectedVersion:archived.version});await refresh();
  await expect(aCheckbox).toBeEnabled();await expect.soft(aCheckbox).not.toBeChecked();await expect.soft(selection).toContainText('已选 1 个特性');
  const restored=(await read()).find(feature=>feature.id===a.id),writes:Array<{items:Array<{id:string}>}>=[];
  await page.route('**'+base+'/archive-batch',route=>{writes.push(route.request().postDataJSON());return route.continue();});
  await page.getByRole('button',{name:'更多批量操作',exact:true}).click();await page.getByRole('menu',{name:'更多批量操作'}).getByRole('button',{name:'批量归档',exact:true}).click();
  await expect(page.locator('.outline-notice')).toContainText('归档特性已保存');expect(writes).toHaveLength(1);expect.soft(writes[0].items.map(item=>item.id)).toEqual([b.id]);
  expect.soft((await read()).find(feature=>feature.id===a.id)).toEqual(restored);expect.soft((await read('archived')).map(feature=>feature.id)).toEqual([b.id]);
  await page.reload();await expect(bCheckbox).toBeDisabled();await expect(aCheckbox).toBeEnabled();await expect(aCheckbox).not.toBeChecked();
});

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

test('键盘连续排序保留焦点，保存与刷新期间不重复提交',async({page})=>{
  const f=await phaseFixture(page);await page.goto('/features?featureId='+f.feature.id+'&view=feature');
  const handle=row(page,'phase:'+f.phases[2].id).getByRole('button',{name:'拖动Phase 3',exact:true});
  let releaseSave!:()=>void,releaseRead!:()=>void,writes=0,refreshing=false;
  const saveGate=new Promise<void>(resolve=>{releaseSave=resolve;}),readGate=new Promise<void>(resolve=>{releaseRead=resolve;});
  await page.route('**'+f.base+'/outline-order',async route=>{writes++;if(writes===1){const response=await route.fetch();await saveGate;refreshing=true;await route.fulfill({response});}else await route.continue();});
  await page.route('**/api/dashboard*',async route=>{if(refreshing)await readGate;await route.continue();});
  await handle.focus();await page.keyboard.press('Alt+ArrowUp');await expect.poll(()=>writes).toBe(1);
  await expect(handle).toBeFocused();await expect(handle).toHaveAttribute('aria-disabled','true');
  await page.keyboard.press('Alt+ArrowDown');expect(writes).toBe(1);
  releaseSave();await expect(page.locator('.outline-notice')).toContainText('调整顺序已保存');
  await expect(handle).toBeFocused();await expect(handle).toHaveAttribute('aria-disabled','true');
  await page.keyboard.press('Alt+ArrowDown');expect(writes).toBe(1);releaseRead();
  const phases=page.locator('.outline-table tr[data-object-kind=phase]');
  await expect.poll(()=>phases.evaluateAll(rows=>rows.map(r=>r.getAttribute('data-object-id')))).toEqual([f.phases[0],f.phases[2],f.phases[1]].map(p=>'phase:'+p.id));
  await expect(handle).toHaveAttribute('aria-disabled','false');await expect(handle).toBeFocused();
  await page.keyboard.press('Alt+ArrowDown');await expect.poll(()=>writes).toBe(2);
  await expect.poll(()=>phases.evaluateAll(rows=>rows.map(r=>r.getAttribute('data-object-id')))).toEqual(f.phases.map(p=>'phase:'+p.id));
  await expect(handle).toBeFocused();await page.reload();
  await expect.poll(()=>phases.evaluateAll(rows=>rows.map(r=>r.getAttribute('data-object-id')))).toEqual(f.phases.map(p=>'phase:'+p.id));
});

test('排序响应丢失后先核对正式结果，刷新不会重复提交',async({page})=>{
  const f=await phaseFixture(page);await page.goto('/features?featureId='+f.feature.id+'&view=feature');let writes=0;
  await page.route('**'+f.base+'/outline-order',async route=>{writes++;await route.fetch();await route.abort('failed');});
  await row(page,'phase:'+f.phases[2].id).getByRole('button',{name:'拖动Phase 3',exact:true}).focus();await page.keyboard.press('Alt+ArrowUp');await expect(page.locator('.outline-notice')).toContainText('提交结果待核对');
  await expect(row(page,'phase:'+f.phases[2].id).getByRole('button',{name:'拖动Phase 3',exact:true})).toBeFocused();await page.keyboard.press('Alt+ArrowDown');expect(writes).toBe(1);
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
