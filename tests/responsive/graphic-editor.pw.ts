import {phaseFixture} from './phase-fixture';
import type {PathAnalysis} from '../../src/shared/paths';
import {graphFixture as fixture} from './graph-fixture';
import {chooseOption,selectedValue} from './select-helper';
import {openGraph,openGraphDrafts,reopenGraphProperties,graphProperties,graphToolbar,closeGraphProperties,focusGraph} from './graph-interactions';
import { headerAction } from './topbar-helpers';

import {test,expect,chromium,type Page} from '@playwright/test';
import type {Requirement,WorkItemTemplate} from '../../src/client/types';


const ready=(page:Page)=>expect(page.locator('[data-layout-ready="true"]')).toBeVisible({timeout:20000});
const viewportValue=(page:Page)=>page.locator('.react-flow__viewport').evaluate(e=>(e as HTMLElement).style.transform);
const positionsValue=(page:Page)=>page.locator('.react-flow__node').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[(n as HTMLElement).dataset.id,(n as HTMLElement).style.transform])));
const blank=async(page:Page)=>{await closeGraphProperties(page);await page.locator('.react-flow__pane').click({position:{x:12,y:300}});};

for(const scope of ['全局路径','需求路径','流程设计'] as const){
 test(`画布文字选择：${scope}拖动和全选不选中文字，编辑仍可选字`,async({page})=>{
  const {a}=await fixture(page);
  await openGraph(page,scope==='全局路径'?'/paths?pathScope=all':scope==='需求路径'?`/requirements/${a.id}?view=path`:`/templates?edit=${a.templateId}`);
  await ready(page);
  const canvas=page.locator('.dependency-canvas'),label=page.locator(scope==='流程设计'?'.dependency-card-top span':'.dependency-edge-label text').first();
  await expect(label).toBeVisible();
  await label.click({clickCount:3});
  expect(await page.evaluate(()=>{const selection=window.getSelection();return selection?.anchorNode?.parentElement?.closest('.dependency-canvas')?selection.toString():'';})).toBe('');
  await closeGraphProperties(page);
  const bounds=(await label.boundingBox())!;
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
  await page.mouse.down();await page.mouse.move(bounds.x+bounds.width+50,bounds.y+35,{steps:8});await page.mouse.up();
  expect(await page.evaluate(()=>{const selection=window.getSelection();return selection?.anchorNode?.parentElement?.closest('.dependency-canvas')?selection.toString():'';})).toBe('');
  await closeGraphProperties(page);await canvas.focus();await page.keyboard.press('Control+a');
  const count=await page.locator('.react-flow__node:not(.graph-node-hidden)').count();
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(count);
  expect(await page.evaluate(()=>{const selection=window.getSelection();return selection?.anchorNode?.parentElement?.closest('.dependency-canvas')?selection.toString():'';})).toBe('');
  await blank(page);
  if(scope!=='流程设计')await graphToolbar(page,'编辑画布');
  const title=scope==='全局路径'?page.locator(`.react-flow__node[data-id="${a.id}"] .graph-title`):scope==='需求路径'?page.locator(`.react-flow__node[data-id="${a.workItems[0].id}"] .graph-title`):page.locator('.dependency-card strong').first();
  const original=(await title.textContent())!;
  await title.click();const field=page.getByLabel('元素名称',{exact:true});
  await field.focus();await page.keyboard.press('Control+a');
  expect(await field.evaluate((node:HTMLInputElement)=>node.value.slice(node.selectionStart??0,node.selectionEnd??0))).toBe(original);
  await page.keyboard.insertText('属性临时名称');await expect(field).toHaveValue('属性临时名称');
  await page.keyboard.press('Escape');await expect(field).toHaveValue(original);
 });
}

test('模板实例：首次保存前改名复制删除、慢预览、刷新及撤销保持节点和草稿',async({page})=>{
 const {a,project,analysis}=await fixture(page,false),initial=await analysis();
 await openGraph(page,'/paths?pathScope=all');await ready(page);await graphToolbar(page,'编辑画布');await graphToolbar(page,'添加元素');
 await page.locator('.graph-elements').getByRole('button',{name:'需求',exact:true}).click();const box=(await page.locator('.dependency-canvas').boundingBox())!;await page.mouse.click(box.x+box.width*.55,box.y+box.height*.7);
 const dialog=page.getByRole('dialog');await dialog.getByLabel('需求标题').fill('模板草稿需求');await chooseOption(dialog.getByRole('combobox',{name:'流程模板',exact:true}), a.templateId!);
 await dialog.getByRole('button',{name:'加入草稿',exact:true}).click();await closeGraphProperties(page);await page.getByRole('button',{name:'进入模板草稿需求',exact:true}).click();
 const generated=page.locator('.react-flow__node').filter({hasText:'集成验证'});await expect(generated).toHaveCount(1);await ready(page);
 const workId=(await generated.getAttribute('data-id'))!,work=page.locator('.react-flow__node[data-id="'+workId+'"]'),draftId=new URL(page.url()).searchParams.get('scopeId')!;
 await page.route('**/dependency-changes/preview',async route=>{await new Promise(resolve=>setTimeout(resolve,500));await route.continue();});
 const refreshed=page.waitForResponse(r=>r.url().endsWith('/dependency-changes/preview')&&r.status()===200&&r.request().postData()?.includes('调整后的环节')===true);
 await page.evaluate(id=>{const state={active:true,missing:0};Object.assign(window,{templateNodeCheck:state});const frame=()=>{if(!state.active)return;if(!document.querySelector('.react-flow__node[data-id="'+id+'"]'))state.missing++;requestAnimationFrame(frame);};requestAnimationFrame(frame);},workId);
 await graphProperties(page,work.locator('.dependency-card'));await page.getByLabel('元素名称',{exact:true}).fill('调整后的环节');await page.getByLabel('元素名称',{exact:true}).blur();
 await expect(work).toContainText('调整后的环节');await graphToolbar(page,'撤销');await expect(work).toContainText('集成验证');await graphToolbar(page,'重做');await expect(work).toContainText('调整后的环节');
 await expect(page.locator('[data-draft-stored="true"]')).toBeVisible();
 await refreshed;expect(await page.evaluate(()=>{const s=(window as unknown as {templateNodeCheck:{active:boolean;missing:number}}).templateNodeCheck;s.active=false;return s.missing;})).toBe(0);
 await page.getByLabel('复制元素',{exact:true}).click();await expect(page.locator('.react-flow__node').filter({hasText:'调整后的环节 副本'})).toHaveCount(1);
 await graphProperties(page,page.locator('.react-flow__node[data-id="'+workId+'"] .dependency-card'));await page.getByLabel('删除元素',{exact:true}).click();
 await expect(page.locator('.react-flow__node[data-id="'+workId+'"]')).toHaveCount(0);await expect(page.locator('[data-draft-stored="true"]')).toBeVisible();await page.reload();
 await expect(page.locator('.react-flow__node').filter({hasText:'调整后的环节 副本'})).toHaveCount(1);await ready(page);
 await graphToolbar(page,'撤销');await expect(page.locator('.react-flow__node[data-id="'+workId+'"]')).toHaveCount(1);await graphToolbar(page,'重做');await expect(page.locator('.react-flow__node[data-id="'+workId+'"]')).toHaveCount(0);
 expect((await analysis()).requirements).toHaveLength(initial.requirements.length);
 const applied=page.waitForResponse(r=>r.url().endsWith('/dependency-changes/apply')&&r.request().method()==='POST');await graphToolbar(page,'保存修改');const response=await applied;expect(response.ok(),await response.text()).toBe(true);
 const receipt=await response.json(),saved=await(await page.request.get('/api/requirements/'+receipt.addedIds[draftId])).json() as Requirement;
 expect(saved.workItems.map(w=>w.title).sort()).toEqual(['方案交付','调整后的环节 副本'].sort());expect(saved.workItems.every(w=>w.status==='not_started')).toBe(true);
 expect((await analysis()).requirements.filter(r=>r.projectId===project.id)).toHaveLength(initial.requirements.length+1);await expect(page).not.toHaveURL(/draftProject=/);
});

test('批量交付：拖线到新里程碑并后置安排，继续改名后保存和刷新保持一致',async({page})=>{
 const {a,analysis}=await fixture(page,false),before=await analysis();
 await openGraph(page,'/requirements/'+a.id+'?view=path');await ready(page);
 await graphToolbar(page,'编辑画布');await graphToolbar(page,'添加元素');
 await page.locator('.graph-elements').getByRole('button',{name:'里程碑',exact:true}).click();
 const canvas=(await page.locator('.dependency-canvas').boundingBox())!;
 await page.mouse.click(canvas.x+canvas.width*.58,canvas.y+canvas.height*.72);
 await graphProperties(page,page.locator('.react-flow__node[data-selected=true],.react-flow__node.selected').first());await page.getByLabel('元素名称',{exact:true}).fill('批次交付点');await page.getByLabel('元素名称',{exact:true}).blur();await ready(page);await blank(page);
 const milestone=page.locator('.react-flow__node').filter({hasText:'批次交付点'}),mileId=(await milestone.getAttribute('data-id'))!;
 const work=page.locator('.react-flow__node[data-id="'+a.workItems[1].id+'"]');
 const handle=(await work.locator('.business-handle[data-side="bottom"]').boundingBox())!,target=(await milestone.locator('.dependency-card').boundingBox())!;
 await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();
 await page.mouse.move(target.x+target.width/2,target.y+target.height/2,{steps:12});await page.mouse.up();
 await graphProperties(page,work.locator('.dependency-card'));await chooseOption(page.getByLabel('安排方式',{exact:true}), 'late');await chooseOption(page.getByRole('combobox',{name:'交付点',exact:true}), mileId);
 await graphProperties(page,page.locator('.react-flow__node[data-id="'+a.workItems[0].id+'"] .dependency-card'));
 await page.getByLabel('元素名称',{exact:true}).fill('一起保存的方案');await page.getByLabel('元素名称',{exact:true}).blur();
 await expect(page.locator('[data-draft-stored="true"]')).toBeVisible();
 const untouched=await analysis();expect(untouched.revision).toBe(before.revision);expect(untouched.milestones?.some(m=>m.id===mileId)).toBe(false);
 const applied=page.waitForResponse(r=>r.url().endsWith('/dependency-changes/apply')&&r.request().method()==='POST');
 await graphToolbar(page,'保存修改');const response=await applied;expect(response.ok(),await response.text()).toBe(true);
 await expect(page.getByLabel('编辑画布',{exact:true})).toBeVisible();
 const formal=await analysis(),saved=formal.nodes.find(n=>n.id===a.workItems[1].id)!;
 expect(saved.arrangementAnchor).toBe(mileId);expect(saved.arrangement).toBe('late');expect(saved.forecastEnd).toBeTruthy();
 expect(formal.dependencies.some(d=>d.sourceWorkItemId===saved.id&&d.targetMilestoneId===mileId)).toBe(true);
 await page.reload();await ready(page);await graphToolbar(page,'编辑画布');await graphProperties(page,work.locator('.dependency-card'));
 await expect(page.getByRole('combobox',{name:'交付点',exact:true}).locator('..').locator('select')).toHaveValue(mileId);
 await expect(page.locator('.react-flow__node[data-id="'+a.workItems[0].id+'"]')).toContainText('一起保存的方案');
});

for(const scope of ['global','work'] as const)test(`责任一致性：${scope} 更换负责人预览立即对应新人，撤销和保存一致`,async({page})=>{
 const {project,a,analysis}=await fixture(page,false),person=await(await page.request.post('/api/people',{data:{projectId:project.id,name:'接手人'+Date.now()}})).json();
 const id=scope==='global'?a.id:a.workItems[0].id,readOwner=async()=>{const data=await analysis();return scope==='global'?data.requirements.find(r=>r.id===id)!.ownerId:data.nodes.find(n=>n.id===id)!.ownerId;};
 const original=await readOwner();await openGraph(page,scope==='global'?'/paths?pathScope=all':'/requirements/'+a.id+'?view=path');await ready(page);await graphToolbar(page,'编辑画布');
 const card=page.locator('.react-flow__node[data-id="'+id+'"] .dependency-card');await graphProperties(page,card);await chooseOption(page.getByLabel('元素负责人',{exact:true}), person.id);
 await expect(card).toContainText(person.name);expect(await readOwner()).toBe(original);
 await graphToolbar(page,'撤销');await expect(card).not.toContainText(person.name);
 await graphToolbar(page,'重做');await expect(card).toContainText(person.name);
 const applied=page.waitForResponse(r=>r.url().endsWith('/dependency-changes/apply')&&r.request().method()==='POST');await graphToolbar(page,'保存修改');expect((await applied).ok()).toBe(true);
 expect(await readOwner()).toBe(person.id);await expect(page.getByLabel('编辑画布',{exact:true})).toBeVisible();await expect(card).toContainText(person.name);
 await page.reload();await ready(page);await expect(card).toContainText(person.name);
});

test('工期一致性：未知工期保持空值，清空、刷新、撤销重做与保存一致',async({page})=>{
 const {a,analysis}=await fixture(page,false);
 const created=await page.request.post('/api/requirements/'+a.id+'/work-items',{data:{expectedVersion:a.version,title:'工期待确认',ownerId:a.ownerId}});
 expect(created.ok(),await created.text()).toBe(true);const work=await created.json();
 const formal=async()=> (await analysis()).nodes.find(n=>n.id===work.id)!.estimate.durationDays;
 expect(await formal()).toBeNull();
 await openGraph(page,'/requirements/'+a.id+'?view=path');await ready(page);await graphToolbar(page,'编辑画布');
 const card=page.locator('.react-flow__node[data-id="'+work.id+'"] .dependency-card'),field=page.getByLabel('预计工期',{exact:true});
 await graphProperties(page,card);await expect(field).toHaveValue('');
 await field.fill('4');await field.blur();await expect(page.getByLabel('撤销',{exact:true})).toBeEnabled();
 await field.fill('');await field.blur();await expect(field).toHaveAttribute('aria-invalid','false');await expect(page.locator('[data-draft-stored="true"]')).toBeVisible();
 expect(await formal()).toBeNull();
 await page.reload();await ready(page);await graphProperties(page,card);await expect(field).toHaveValue('');
 await graphToolbar(page,'撤销');await expect(field).toHaveValue('4');
 await graphToolbar(page,'重做');await expect(field).toHaveValue('');
 const save=page.waitForResponse(r=>r.url().endsWith('/dependency-changes/apply')&&r.request().method()==='POST');
 await graphToolbar(page,'保存修改');expect((await save).ok()).toBe(true);await expect(page.getByLabel('编辑画布',{exact:true})).toBeVisible();
 expect(await formal()).toBeNull();await page.reload();await ready(page);await graphToolbar(page,'编辑画布');await graphProperties(page,card);await expect(field).toHaveValue('');
});

test('工期一致性：模板仍需完整工作日，无效工期不提交并可取消',async({page})=>{
 const {a}=await fixture(page,false);await openGraph(page,'/templates?edit='+a.templateId);await ready(page);
 await graphProperties(page,page.locator('.react-flow__node .dependency-card').first());const field=page.getByLabel('预计工期',{exact:true});await expect(field).toHaveValue('2');
 let writes=0;page.on('request',r=>{if(r.method()==='PATCH'&&r.url().endsWith('/api/templates/'+a.templateId))writes++;});
 await field.fill('1.5');await field.blur();await expect(field).toHaveAttribute('aria-invalid','true');
 await closeGraphProperties(page);await expect(field).toHaveCount(0);
 await graphToolbar(page,'保存修改');await expect(field).toBeFocused();expect(writes).toBe(0);
 await field.fill('');await field.blur();await expect(field).toHaveAttribute('aria-invalid','true');
 await field.focus();await field.press('Escape');await expect(field).toHaveValue('2');await expect(field).toHaveAttribute('aria-invalid','false');expect(writes).toBe(0);
});

for(const destination of ['全局','其他需求'] as const)for(const narrow of [false,true])test('跨页面字段：'+destination+(narrow?'窄屏':'')+'保存能返回错误所属工作项并聚焦输入',{tag:'@responsive'}, async({page})=>{
 if(narrow)await page.setViewportSize({width:390,height:844});
 const {a,b,analysis}=await fixture(page,false);await openGraph(page,'/requirements/'+a.id+'?view=path');await ready(page);await graphToolbar(page,'编辑画布');
 await graphProperties(page,page.locator('.react-flow__node[data-id="'+a.workItems[0].id+'"] .dependency-card'));const title=page.getByLabel('元素名称');await title.fill('');await title.blur();await expect(title).toHaveAttribute('aria-invalid','true');
 await closeGraphProperties(page);await page.getByRole('button',{name:'上一级',exact:true}).click();await ready(page);if(destination==='其他需求')await page.getByRole('button',{name:'进入'+b.title,exact:true}).click();await ready(page);const beforeUrl=page.url();const id=destination==='全局'?b.id:b.workItems[0].id;await graphProperties(page,page.locator('.react-flow__node[data-id="'+id+'"] .dependency-card'));await title.fill('其他页面的有效修改');await title.blur();let writes=0;page.on('request',r=>{if(r.url().endsWith('/dependency-changes/apply'))writes++;});
 await graphToolbar(page,'保存修改');await expect(page).toHaveURL(new RegExp('requirementId='+a.id));await ready(page);await expect(title).toHaveValue('');await expect(title).toHaveAttribute('aria-invalid','true');await expect(title).toBeFocused();expect(writes).toBe(0);
 await page.goBack();await expect.poll(()=>new URL(page.url()).searchParams.get('requirementId')).toBe(new URL(beforeUrl).searchParams.get('requirementId'));await ready(page);await graphProperties(page,page.locator('.react-flow__node[data-id="'+id+'"] .dependency-card'));await expect(title).toHaveValue('其他页面的有效修改');await graphToolbar(page,'保存修改');await expect(page).toHaveURL(new RegExp('requirementId='+a.id));await ready(page);await expect(title).toBeFocused();
 await title.fill('定位后修正');const saved=page.waitForResponse(r=>r.url().endsWith('/dependency-changes/apply'));await page.keyboard.press('Control+s');expect((await saved).status()).toBe(200);expect((await analysis()).nodes.find(n=>n.id===a.workItems[0].id)?.title).toBe('定位后修正');
 await page.goBack();await expect.poll(()=>new URL(page.url()).searchParams.get('requirementId')).toBe(new URL(beforeUrl).searchParams.get('requirementId'));await ready(page);
});

test('项目里程碑草稿在跨范围校验和摘要定位后可继续保存',async({page},info)=>{
  const f=await phaseFixture(page),id=crypto.randomUUID();
  const read=async()=>await(await page.request.get(f.base+'/path-analysis')).json() as PathAnalysis;
  const initial=await read();
  const input={expectedRevision:initial.revision,target:'project',changes:{add:[{clientId:crypto.randomUUID(),sourceRequirementId:f.testing.id,sourceWorkItemId:null,targetRequirementId:'',targetMilestoneId:id,targetWorkItemId:null}],remove:[],estimates:[],entities:[{entity:'milestone',op:'create',id,requirementId:null,data:{title:'项目集成评审',confirmationMode:'manual'}}]}};
  const previewResponse=await page.request.post(f.base+'/dependency-changes/preview',{data:input});expect(previewResponse.ok(),await previewResponse.text()).toBe(true);
  const preview=await previewResponse.json(),applied=await page.request.post(f.base+'/dependency-changes/apply',{data:{...input,batchId:crypto.randomUUID(),previewToken:preview.previewToken}});expect(applied.ok(),await applied.text()).toBe(true);
  const before=await read();let writes=0;page.on('request',request=>{if(request.url().endsWith('/dependency-changes/apply'))writes++;});
  await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'graph',scopeType:'feature',scopeId:f.feature.id}));
  const ready=()=>expect(page.locator('.dependency-canvas')).toHaveAttribute('data-layout-ready','true');await ready();
  await graphToolbar(page,'编辑画布');await graphProperties(page,page.locator('.react-flow__node[data-id="'+id+'"] .dependency-card'));
  const title=page.getByLabel('元素名称',{exact:true});await title.fill('');await title.blur();await expect(title).toHaveAttribute('aria-invalid','true');
  await closeGraphProperties(page);await page.getByRole('button',{name:'上一级',exact:true}).click();await ready();
  await graphToolbar(page,'保存修改');
  await expect(title).toBeVisible();await expect(title).toHaveValue('');await expect(title).toHaveAttribute('aria-invalid','true');await expect(title).toBeFocused();expect(writes).toBe(0);
  expect((await read()).milestones).toEqual(before.milestones);
  await page.screenshot({path:info.outputPath('milestone-invalid-name.png'),animations:'disabled'});
  await title.fill('已核对的项目集成评审');await title.blur();await closeGraphProperties(page);await openGraphDrafts(page);
  await page.locator('.canvas-change-row').filter({hasText:'已核对的项目集成评审'}).getByRole('button',{name:'定位',exact:true}).click();await expect(title).toHaveValue('已核对的项目集成评审');expect(writes).toBe(0);
  const saved=page.waitForResponse(response=>response.url().endsWith('/dependency-changes/apply'));await page.keyboard.press('Control+s');expect((await saved).status()).toBe(200);
  const after=await read();expect(after.milestones).toEqual(before.milestones!.map(item=>item.id===id?{...item,title:'已核对的项目集成评审',version:item.version+1}:item));expect(writes).toBe(1);expect(after.dependencies).toEqual(before.dependencies);
});

for(const scope of ['项目','模板'] as const)for(const unfinished of [false,true])test('草稿重新接管：'+scope+(unfinished?'保留对方未完成输入':'采用对方已确认字段')+'，旧字段不回写',async({page,context})=>{
 const {a,analysis}=await fixture(page,false);const template=scope==='模板';await openGraph(page,template?'/templates?edit='+a.templateId:'/requirements/'+a.id+'?view=path');await ready(page);if(!template)await graphToolbar(page,'编辑画布');await graphProperties(page,page.locator('.react-flow__node .dependency-card').filter({hasText:'方案交付'}));const title=page.getByLabel('元素名称');await title.fill('');await title.blur();await expect(title).toHaveAttribute('aria-invalid','true');
 const tab=await context.newPage();await tab.goto(page.url());await ready(tab);await expect(tab.locator('.page-toolbar-status')).toContainText('其他页面编辑中');await openGraphDrafts(tab);await tab.getByRole('button',{name:'接管此草稿',exact:true}).click();await reopenGraphProperties(tab);await expect(tab.getByLabel('元素名称')).toBeEnabled();await tab.getByLabel('元素名称').fill('另一页确认的新名称');await tab.getByLabel('元素名称').blur();
 if(unfinished){const duration=tab.getByLabel('预计工期');await duration.fill('0');await duration.blur();await expect(duration).toHaveAttribute('aria-invalid','true');}
 await expect(template?tab.getByText('草稿已保留',{exact:true}):tab.locator('[data-draft-stored="true"]')).toBeVisible();await expect(page.locator('.page-toolbar-status')).toContainText('其他页面编辑中');await openGraphDrafts(page);await page.getByRole('button',{name:'接管此草稿',exact:true}).click();await reopenGraphProperties(page);await expect(title).toHaveValue('另一页确认的新名称');await expect(title).toHaveAttribute('aria-invalid','false');
 if(unfinished){const duration=page.getByLabel('预计工期');await expect(duration).toHaveValue('0');await expect(duration).toHaveAttribute('aria-invalid','true');await duration.fill('4');await duration.blur();}
 else{await graphToolbar(page,'撤销');await expect(title).toHaveValue('方案交付');await graphToolbar(page,'重做');await expect(title).toHaveValue('另一页确认的新名称');}
 expect((await analysis()).nodes.find(n=>n.id===a.workItems[0].id)?.title).toBe('方案交付');const saved=page.waitForResponse(r=>template?r.url().endsWith('/api/templates/'+a.templateId)&&r.request().method()==='PATCH':r.url().endsWith('/dependency-changes/apply'));await graphToolbar(page,'保存修改');expect((await saved).status()).toBe(200);await tab.close();
});

test('跨页面字段：需求属性错误返回全局修正，正常返回不强制跳回错误页',async({page})=>{
 const {a,b,analysis}=await fixture(page,false);await openGraph(page,'/paths?pathScope=all');await ready(page);await graphToolbar(page,'编辑画布');await graphProperties(page,page.locator('.react-flow__node[data-id="'+a.id+'"] .dependency-card'));const title=page.getByLabel('元素名称');await title.fill('');await title.blur();await expect(title).toHaveAttribute('aria-invalid','true');
 await closeGraphProperties(page);await page.getByRole('button',{name:'进入'+b.title,exact:true}).click();await ready(page);await expect(page).toHaveURL(new RegExp('requirementId='+b.id));await graphProperties(page,page.locator('.react-flow__node[data-id="'+b.workItems[0].id+'"] .dependency-card'));await title.fill('保存后一起生效');await title.blur();await graphToolbar(page,'保存修改');await expect(page).toHaveURL(/scopeType=feature/);await ready(page);await expect(title).toHaveValue('');await expect(title).toBeFocused();expect((await analysis()).requirements.find(r=>r.id===a.id)?.title).toBe(a.title);
 await title.fill('需求名称已修正');const saved=page.waitForResponse(r=>r.url().endsWith('/dependency-changes/apply'));await page.keyboard.press('Control+s');expect((await saved).status()).toBe(200);expect((await analysis()).requirements.find(r=>r.id===a.id)?.title).toBe('需求名称已修正');await page.goBack();await ready(page);await expect(page).toHaveURL(new RegExp('requirementId='+b.id));
});

test('草稿重新接管：读取失败保留当前编辑人和输入，重试后才能编辑',async({page,context})=>{
 const {a,analysis}=await fixture(page,false);await openGraph(page,'/requirements/'+a.id+'?view=path');await ready(page);await graphToolbar(page,'编辑画布');await graphProperties(page,page.locator('.react-flow__node[data-id="'+a.workItems[0].id+'"] .dependency-card'));await page.getByLabel('元素名称').fill('仍由原页面保留');await page.getByLabel('元素名称').blur();await expect(page.locator('[data-draft-stored="true"]')).toBeVisible();
 const tab=await context.newPage(),errors:string[]=[];tab.on('pageerror',error=>errors.push(error.message));await tab.goto(page.url());await ready(tab);await openGraphDrafts(tab);
 await tab.evaluate(()=>{const original=IDBObjectStore.prototype.get;IDBObjectStore.prototype.get=function(query){if(typeof query==='string'&&query.startsWith('pm-graph-draft:')){IDBObjectStore.prototype.get=original;throw new DOMException('模拟本机读取失败','UnknownError');}return original.call(this,query);};});
 await tab.getByRole('button',{name:'接管此草稿',exact:true}).click();await expect(tab.locator('.graph-auxiliary')).toContainText('无法接管草稿：模拟本机读取失败');await expect(tab.locator('input[aria-label="元素名称"]:enabled')).toHaveCount(0);await expect(page.getByLabel('元素名称')).toBeEnabled();expect(errors).toEqual([]);expect((await analysis()).nodes.find(n=>n.id===a.workItems[0].id)?.title).toBe('方案交付');
 await tab.getByRole('button',{name:'接管此草稿',exact:true}).click();await reopenGraphProperties(tab);await expect(tab.getByLabel('元素名称')).toBeEnabled();await expect(tab.getByLabel('元素名称')).toHaveValue('仍由原页面保留');await expect(page.locator('input[aria-label="元素名称"]:enabled')).toHaveCount(0);await tab.close();
});

test('字段生命周期：删除模板元素停用错误输入，撤销恢复，刷新后仍可保存',async({page})=>{
 const {a}=await fixture(page,false);await openGraph(page,'/templates?edit='+a.templateId);await ready(page);
 const first=page.locator('.react-flow__node').filter({hasText:'方案交付'});const id=await first.getAttribute('data-id');await graphProperties(page,first.locator('.dependency-card'));
 const input=page.getByLabel('元素名称');await input.fill('');await input.blur();await expect(input).toHaveAttribute('aria-invalid','true');
 await page.getByLabel('删除元素',{exact:true}).click();await expect(first).toHaveCount(0);
 await graphToolbar(page,'撤销');await ready(page);await graphProperties(page,page.locator('.react-flow__node[data-id="'+id+'"] .dependency-card'));await expect(input).toHaveValue('');await expect(input).toHaveAttribute('aria-invalid','true');
 await graphToolbar(page,'重做');await expect(first).toHaveCount(0);await expect(page.getByText('草稿已保留',{exact:true})).toBeVisible();await page.reload();await ready(page);
 const saved=page.waitForResponse(r=>r.url().endsWith('/api/templates/'+a.templateId)&&r.request().method()==='PATCH',{timeout:6000});await graphToolbar(page,'保存修改');expect((await saved).status()).toBe(200);
 const templates=await(await page.request.get('/api/templates?projectId='+a.projectId)).json() as WorkItemTemplate[];expect(templates.find(t=>t.id===a.templateId)?.items.map(i=>i.title)).toEqual(['集成验证']);
});

test('字段生命周期：删除工作项的错误输入不阻塞共享项目草稿保存',async({page})=>{
 const {a,analysis}=await fixture(page,false);await openGraph(page,'/requirements/'+a.id+'?view=path');await ready(page);await graphToolbar(page,'编辑画布');
 const node=page.locator('.react-flow__node[data-id="'+a.workItems[0].id+'"]');await graphProperties(page,node.locator('.dependency-card'));const input=page.getByLabel('元素名称');await input.fill('');await input.blur();await expect(input).toHaveAttribute('aria-invalid','true');
 await page.getByLabel('删除元素',{exact:true}).click();await expect(node).toHaveCount(0);
 await graphToolbar(page,'撤销');await ready(page);await graphProperties(page,node.locator('.dependency-card'));await expect(input).toHaveValue('');await expect(input).toHaveAttribute('aria-invalid','true');await graphToolbar(page,'重做');await expect(node).toHaveCount(0);
 expect((await analysis()).nodes.some(n=>n.id===a.workItems[0].id)).toBe(true);
 const saved=page.waitForResponse(r=>r.url().endsWith('/dependency-changes/apply')&&r.request().method()==='POST',{timeout:6000});await graphToolbar(page,'保存修改');expect((await saved).status()).toBe(200);
 expect((await analysis()).nodes.some(n=>n.id===a.workItems[0].id)).toBe(false);
});

test('字段生命周期：撤销新增、改写历史和放弃修改不遗留错误字段',async({page})=>{
 const {a}=await fixture(page,false);await openGraph(page,'/templates?edit='+a.templateId);await ready(page);
 await graphToolbar(page,'添加元素');await page.locator('.graph-elements').getByRole('button',{name:'工作项',exact:true}).click();await blank(page);await expect(page.locator('.react-flow__node')).toHaveCount(3);
 const duration=page.getByLabel('预计工期');await duration.fill('');await duration.blur();await expect(duration).toHaveAttribute('aria-invalid','true');await graphToolbar(page,'撤销');await expect(page.locator('.react-flow__node')).toHaveCount(2);
 await graphProperties(page,page.locator('.react-flow__node').filter({hasText:'方案交付'}).locator('.dependency-card'));const title=page.getByLabel('元素名称');await title.fill('新的历史分支');await title.blur();await expect(page.getByLabel('重做',{exact:true})).toBeDisabled();
 let saved=page.waitForResponse(r=>r.url().endsWith('/api/templates/'+a.templateId)&&r.request().method()==='PATCH',{timeout:6000});await graphToolbar(page,'保存修改');expect((await saved).status()).toBe(200);await expect(page.getByLabel('撤销',{exact:true})).toBeDisabled();
 await graphProperties(page,page.locator('.react-flow__node').filter({hasText:'新的历史分支'}));await title.fill('');await title.blur();await expect(title).toHaveAttribute('aria-invalid','true');await closeGraphProperties(page);await headerAction(page,'放弃修改');await page.getByRole('dialog').getByRole('button',{name:'放弃修改',exact:true}).click();await graphProperties(page,page.locator('.react-flow__node').filter({hasText:'新的历史分支'}));await expect(title).toHaveValue('新的历史分支');await expect(title).toHaveAttribute('aria-invalid','false');
 await closeGraphProperties(page);await expect(page.getByRole('dialog')).toHaveCount(0);await page.reload();await ready(page);
 saved=page.waitForResponse(r=>r.url().endsWith('/api/templates/'+a.templateId)&&r.request().method()==='PATCH',{timeout:6000});await graphToolbar(page,'保存修改');expect((await saved).status()).toBe(200);
});

test('字段生命周期：项目撤销新增后继续编辑和放弃原文，不出现隐藏拦截',async({page})=>{
 const {a,analysis}=await fixture(page,false);await openGraph(page,'/requirements/'+a.id+'?view=path');await ready(page);await graphToolbar(page,'编辑画布');const count=await page.locator('.react-flow__node').count();
 await graphToolbar(page,'添加元素');await page.locator('.graph-elements').getByRole('button',{name:'工作项',exact:true}).click();await blank(page);await expect(page.locator('.react-flow__node')).toHaveCount(count+1);await graphProperties(page,page.locator('.react-flow__node.selected .dependency-card'));
 const title=page.getByLabel('元素名称');await title.fill('');await title.blur();await expect(title).toHaveAttribute('aria-invalid','true');await graphToolbar(page,'撤销');await expect(page.locator('.react-flow__node')).toHaveCount(count);
 const node=page.locator('.react-flow__node[data-id="'+a.workItems[0].id+'"]');await graphProperties(page,node.locator('.dependency-card'));await title.fill('现有工作继续编辑');await title.blur();await expect(page.getByLabel('重做',{exact:true})).toBeDisabled();
 const saved=page.waitForResponse(r=>r.url().endsWith('/dependency-changes/apply')&&r.request().method()==='POST',{timeout:6000});await graphToolbar(page,'保存修改');expect((await saved).status()).toBe(200);await ready(page);
 if(await page.getByLabel('编辑画布',{exact:true}).isVisible())await graphToolbar(page,'编辑画布');await graphProperties(page,node.locator('.dependency-card'));await title.fill('');await title.blur();await expect(title).toHaveAttribute('aria-invalid','true');await closeGraphProperties(page);await headerAction(page,'放弃修改');await graphToolbar(page,'编辑画布');await graphProperties(page,node.locator('.dependency-card'));await expect(title).toHaveValue('现有工作继续编辑');await expect(title).toHaveAttribute('aria-invalid','false');
 await closeGraphProperties(page);await expect(page.getByRole('dialog')).toHaveCount(0);await page.reload();await ready(page);expect((await analysis()).nodes.find(n=>n.id===a.workItems[0].id)?.title).toBe('现有工作继续编辑');await expect(page.locator('.page-toolbar-status')).toContainText('编辑中');
});

test('字段生命周期：旧项目草稿补齐对象范围，修正错误后立即保存使用当前输入',async({page})=>{
 const {project,a,analysis}=await fixture(page,false);const formal=await analysis();
 await page.addInitScript(({projectId,revision})=>{
  const account=Object.keys(localStorage).find(key=>key.startsWith('project-manage:selected-project:'))?.slice('project-manage:selected-project:'.length);if(!account)return;
  const key='pm-graph-draft:'+account+':'+projectId;if(sessionStorage.getItem(key))return;
  const empty={add:[],remove:[],estimates:[]};sessionStorage.setItem(key,JSON.stringify({formatVersion: 2,version:String(revision),values:[empty,{...empty,entities:[{id:'undone-work',requirementId:'unused',entity:'work',op:'create',data:{title:'已撤销工作'}}]}],index:0,active:true,fields:{'title:undone-work':{original:'已撤销工作',value:'',error:'请填写名称'}},layouts:{}}));
 },{projectId:project.id,revision:formal.revision});
 await openGraph(page,'/requirements/'+a.id+'?view=path');await ready(page);const node=page.locator('.react-flow__node[data-id="'+a.workItems[0].id+'"]');await graphProperties(page,node.locator('.dependency-card'));const title=page.getByLabel('元素名称');await title.fill('');await title.blur();await expect(title).toHaveAttribute('aria-invalid','true');await title.fill('修正后立即保存');
 const saved=page.waitForResponse(r=>r.url().endsWith('/dependency-changes/apply')&&r.request().method()==='POST',{timeout:6000});await page.keyboard.press('Control+s');expect((await saved).status()).toBe(200);expect((await analysis()).nodes.find(n=>n.id===a.workItems[0].id)?.title).toBe('修正后立即保存');expect((await analysis()).nodes.some(n=>n.id==='undone-work')).toBe(false);
});

test('新增里程碑与连线不移动已有视口，提示紧凑，循环说明包含真实部分交付',{tag:'@responsive'}, async({page},info)=>{
 const {a,analysis}=await fixture(page);await openGraph(page,'/requirements/'+a.id+'?view=path');await ready(page);
 const beforeViewport=await viewportValue(page),beforePositions=await positionsValue(page),revision=(await analysis()).revision;
 await graphToolbar(page,'编辑画布');await graphToolbar(page,'添加元素');await page.locator('.graph-elements').getByRole('button',{name:'里程碑',exact:true}).click();
 const canvas=(await page.locator('.dependency-canvas').boundingBox())!;await page.mouse.click(canvas.x+canvas.width*.5,canvas.y+canvas.height*.7);await expect(page.locator('.react-flow__node')).toHaveCount(Object.keys(beforePositions).length+1);await ready(page);
 expect(await viewportValue(page)).toBe(beforeViewport);const after=await positionsValue(page);for(const [id,value] of Object.entries(beforePositions))expect(after[id]).toBe(value);
 await blank(page);const source=page.locator('.react-flow__node[data-id="'+a.workItems[1].id+'"]'),target=page.locator('.react-flow__node[data-id="'+a.workItems[0].id+'"]');
 await source.locator('.business-handle[data-side="top"]').click();const notice=page.locator('.graph-connection-hint');await expect(notice).toBeVisible();expect((await notice.boundingBox())!.height).toBeLessThan(90);expect((await notice.boundingBox())!.width).toBeLessThanOrEqual(251);
 await target.locator('.dependency-card').click({position:{x:80,y:45}});await expect(page.locator('.graph-error-notice')).toContainText('循环');expect((await page.locator('.graph-error-notice').boundingBox())!.height).toBeLessThan(120);
 await page.getByRole('button',{name:'查看循环路径',exact:true}).click();await expect(page.locator('.graph-cycle-path')).toContainText(a.workItems[0].title);await expect(page.locator('.graph-cycle-path')).toContainText(a.workItems[1].title);await expect(page.locator('.graph-edge-presentation.is-invalid')).not.toHaveCount(0);
 expect(await viewportValue(page)).toBe(beforeViewport);expect((await analysis()).revision).toBe(revision);await expect(page.getByText('正在计算布局…',{exact:true})).toHaveCount(0);await page.waitForTimeout(220);await page.screenshot({path:info.outputPath('cycle-diagnostic.png')});
 await page.locator('.graph-auxiliary').getByRole('button',{name:'关闭',exact:true}).click();await expect(page.locator('.graph-error-notice')).toHaveCount(0);await ready(page);expect(await viewportValue(page)).toBe(beforeViewport);
});

test('添加菜单、分析抽屉和属性按外部点击或Esc关闭，输入草稿保留',async({page})=>{
 const {a}=await fixture(page);await openGraph(page,'/paths?pathScope=all');await ready(page);await graphToolbar(page,'编辑画布');
 await graphToolbar(page,'添加元素');await expect(page.locator('.graph-element-menu')).toHaveAttribute('open','');await blank(page);await expect(page.locator('.graph-element-menu')).not.toHaveAttribute('open','');
 await graphToolbar(page,'添加元素');await page.keyboard.press('Escape');await expect(page.locator('.graph-element-menu')).not.toHaveAttribute('open','');
 await graphProperties(page,page.locator('.react-flow__node[data-id="'+a.id+'"] .dependency-card'));await page.getByLabel('元素名称').fill('属性关闭前保存的草稿');await page.getByLabel('元素负责人').focus();await expect(page.getByRole('dialog')).toBeVisible();await blank(page);await expect(page.getByRole('dialog')).toHaveCount(0);
 await graphProperties(page,page.locator('.react-flow__node[data-id="'+a.id+'"] .dependency-card'));await expect(page.getByLabel('元素名称')).toHaveValue('属性关闭前保存的草稿');
 await page.getByLabel('元素名称').fill('点击画布时保留未失焦输入');await blank(page);await expect(page.getByRole('dialog')).toHaveCount(0);await graphProperties(page,page.locator('.react-flow__node[data-id="'+a.id+'"] .dependency-card'));await expect(page.getByLabel('元素名称')).toHaveValue('点击画布时保留未失焦输入');
 await closeGraphProperties(page);await page.getByRole('button',{name:'余量',exact:true}).click();await expect(page.locator('.path-float-distribution')).toBeVisible();expect((await page.locator('.graph-auxiliary').boundingBox())!.height).toBeLessThan(230);const entries=await page.locator('.path-float-distribution button').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().y));expect(new Set(entries).size).toBe(1);
 const before=await viewportValue(page);await page.locator('.path-float-distribution button').last().click();await expect(page.locator('.path-float-results')).toBeVisible();expect(await viewportValue(page)).toBe(before);await page.keyboard.press('Escape');await expect(page.locator('.graph-auxiliary[aria-hidden="false"]')).toHaveCount(0);
 await closeGraphProperties(page);await page.getByRole('button',{name:'余量',exact:true}).click();await blank(page);await expect(page.locator('.graph-auxiliary[aria-hidden="false"]')).toHaveCount(0);
});

test('重复连线可定位已有草稿关系，快速撤销重做后线路完整且正式数据不变',async({page})=>{
 const {a,b,analysis}=await fixture(page);await page.addInitScript(()=>{
  const Base=window.Worker;window.Worker=class extends Base{set onmessage(handler:((this:Worker,event:MessageEvent)=>unknown)|null){let count=0;super.onmessage=handler?event=>{setTimeout(()=>handler.call(this,event),++count%2?120:10);}:null;}};
 });await openGraph(page,'/paths?pathScope=all');await ready(page);const revision=(await analysis()).revision,before=await viewportValue(page);await graphToolbar(page,'编辑画布');
 const source=page.locator('.react-flow__node[data-id="'+a.id+'"]'),target=page.locator('.react-flow__node[data-id="'+b.id+'"]');
 const connect=async()=>{await source.locator('.business-handle[data-side="bottom"]').click();await target.locator('.dependency-card').click({position:{x:80,y:45}});};
 await connect();await ready(page);await connect();await expect(page.getByRole('button',{name:'查看已有关系',exact:true})).toBeVisible();await page.getByRole('button',{name:'查看已有关系',exact:true}).click();await expect(page.locator('.graph-relation-list')).toContainText('验收后开始');
 await page.locator('.graph-auxiliary').getByRole('button',{name:'关闭',exact:true}).click();for(let i=0;i<3;i++){await graphToolbar(page,'撤销');await graphToolbar(page,'重做');}await ready(page);
 expect(await viewportValue(page)).toBe(before);await expect.poll(()=>page.locator('.graph-routed-edge').evaluateAll(es=>es.map(e=>Number(e.getAttribute('opacity'))))).toEqual([1]);await expect(page.locator('.react-flow__edge-path')).toHaveCount(1);expect((await analysis()).revision).toBe(revision);
});

test('路由失败保留当前修改和临时线，重试不回退节点或视口',{tag:'@responsive'}, async({page})=>{
 const {a,analysis}=await fixture(page);
 await page.route('**/fixed-routing.worker*.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+';{const handle=self.onmessage;let calls=0;self.onmessage=e=>{if(++calls===2)self.postMessage({id:e.data.id,error:"模拟路由失败"});else handle(e);};}'});});
 await openGraph(page,'/paths?pathScope=all');await ready(page);const previous=await positionsValue(page),view=await viewportValue(page),revision=(await analysis()).revision;await graphToolbar(page,'编辑画布');
 const node=page.locator('.react-flow__node[data-id="'+a.id+'"]'),box=(await node.boundingBox())!;await page.mouse.move(box.x+80,box.y+40);await page.mouse.down();await page.mouse.move(box.x+112,box.y+88,{steps:8});await page.mouse.up();
 await expect(page.locator('.graph-error-notice')).toContainText('当前修改和临时连线已保留');const requested=await positionsValue(page);expect(requested[a.id]).not.toBe(previous[a.id]);expect(await viewportValue(page)).toBe(view);await expect(page.locator('.graph-pending-route').first()).toBeVisible();
 await page.getByRole('button',{name:'重试连线',exact:true}).click();await ready(page);await expect(page.locator('.graph-error-notice')).toHaveCount(0);expect(await positionsValue(page)).toEqual(requested);expect(await viewportValue(page)).toBe(view);expect((await analysis()).revision).toBe(revision);
});

test('紧凑工作区：移动、Alt复制、独立里程碑、草稿恢复与原子保存',async({page},testInfo)=>{
 const {project,analysis}=await fixture(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await openGraph(page,'/templates?edit=new');await ready(page);
 await expect(page.getByRole('button',{name:'返回流程列表',exact:true})).toBeVisible();expect((await page.locator('.topbar').boundingBox())!.height).toBeLessThanOrEqual(52);
 await headerAction(page,'流程属性');await page.getByLabel('流程名称',{exact:true}).fill('图形编辑验收');await page.getByLabel('流程名称',{exact:true}).blur();await page.locator('.graph-auxiliary').getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('button',{name:'适配视图',exact:true}).click();await page.waitForTimeout(300);
 const node=page.locator('.react-flow__node').first(),before=(await node.boundingBox())!;
 await page.mouse.move(before.x+70,before.y+12);await page.mouse.down();await page.mouse.move(before.x+170,before.y+92,{steps:12});await page.mouse.up();await ready(page);const moved=(await node.boundingBox())!;expect(moved.x).not.toBe(before.x);
 await closeGraphProperties(page);
 const source=(await node.boundingBox())!;await page.keyboard.down('Alt');await page.mouse.move(source.x+80,source.y+40);await page.mouse.down();await page.mouse.move(source.x+80,source.y+245,{steps:12});await page.mouse.up();await page.keyboard.up('Alt');await expect(page.locator('.react-flow__node')).toHaveCount(2);await ready(page);
 await closeGraphProperties(page);await graphToolbar(page,'添加元素');await page.locator('.graph-elements').getByRole('button',{name:'里程碑',exact:true}).click();const canvas=(await page.locator('.dependency-canvas').boundingBox())!;await page.mouse.click(canvas.x+canvas.width*.60,canvas.y+canvas.height*.62);await expect(page.locator('.react-flow__node')).toHaveCount(3);await page.getByLabel('元素名称').fill('交付节点');await page.getByLabel('元素名称').blur();await ready(page);
 await page.reload();await ready(page);await expect(page.locator('.react-flow__node')).toHaveCount(3);await closeGraphProperties(page);await page.getByRole('button',{name:'返回流程列表',exact:true}).click();await expect(page).not.toHaveURL(/edit=new/);
 await openGraph(page,'/templates?edit=new');await ready(page);await expect(page.locator('.react-flow__node')).toHaveCount(3);
 await page.getByRole('button',{name:'保存修改',exact:true}).click();await expect.poll(async()=>{const items=await(await page.request.get('/api/templates?projectId='+project.id)).json();return items.some((t:WorkItemTemplate)=>t.name==='图形编辑验收');}).toBe(true);await ready(page);
 await page.waitForTimeout(300);await page.screenshot({path:testInfo.outputPath('editor-desktop.png')});expect(errors).toEqual([]);expect((await analysis()).requirements).toHaveLength(2);
});
test('全局新增需求只加入草稿，进入其内部继续创建，保存后可原路返回',async({page})=>{
 const {analysis}=await fixture(page);await openGraph(page,'/paths?pathScope=all');await ready(page);const initial=await analysis();
 await page.getByRole('button',{name:'编辑画布',exact:true}).click();await graphToolbar(page,'添加元素');await page.locator('.graph-elements').getByRole('button',{name:'需求',exact:true}).click();const b=(await page.locator('.dependency-canvas').boundingBox())!;await page.mouse.click(b.x+b.width*.6,b.y+b.height*.68);
 await page.getByRole('dialog').getByLabel('需求标题').fill('草稿新需求');await page.getByRole('button',{name:'加入草稿',exact:true}).click();await ready(page);expect((await analysis()).requirements).toHaveLength(initial.requirements.length);
 await closeGraphProperties(page);await expect(page.getByRole('button',{name:'进入草稿新需求',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'进入草稿新需求',exact:true}).click();await ready(page);await expect(page).toHaveURL(/draftProject=/);await expect(page.locator('.page-breadcrumb')).toContainText('草稿新需求');
 await graphToolbar(page,'添加元素');await page.locator('.graph-elements').getByRole('button',{name:'工作项',exact:true}).click();const box=(await page.locator('.dependency-canvas').boundingBox())!;await page.mouse.click(box.x+box.width*.45,box.y+box.height*.6);await ready(page);await graphProperties(page,page.locator('.react-flow__node').filter({hasText:'新工作项'}));await expect(page.getByLabel('元素名称')).toHaveValue('新工作项');
 await graphToolbar(page,'保存修改');await expect(page).not.toHaveURL(/draftProject=/);await ready(page);expect((await analysis()).requirements).toHaveLength(initial.requirements.length+1);
 await page.goBack();await ready(page);await expect(page).toHaveURL(/scopeType=feature/);
});

test('多标签页显式接管草稿，撤销不影响正式数据',async({page,context})=>{
 const {a,analysis}=await fixture(page);await openGraph(page,'/requirements/'+a.id+'?view=path');await ready(page);await graphToolbar(page,'编辑画布');await graphProperties(page,page.locator('.react-flow__node[data-id="'+a.workItems[0].id+'"] .dependency-card'));await page.getByLabel('元素名称').fill('本机标题');await page.getByLabel('元素名称').blur();
 const tab=await context.newPage();await tab.goto(page.url());await ready(tab);await expect(tab.locator('.page-toolbar-status')).toContainText('其他页面编辑中');
 await openGraphDrafts(tab);await tab.getByRole('button',{name:'接管此草稿'}).click();await reopenGraphProperties(tab);await expect(tab.getByLabel('元素名称')).toHaveValue('本机标题');await expect(page.locator('.page-toolbar-status')).toContainText('其他页面编辑中');
 await tab.getByLabel('元素名称').fill('接管后标题');await tab.getByLabel('元素名称').blur();await graphToolbar(tab,'撤销');await expect(tab.getByLabel('元素名称')).toHaveValue('本机标题');expect((await analysis()).nodes.find(n=>n.id===a.workItems[0].id)?.title).toBe('方案交付');await tab.close();
});
test('多标签页接管待核对提交时沿用原批次，不生成第二个业务命令',async({page,context})=>{
 const {a}=await fixture(page);await openGraph(page,'/requirements/'+a.id+'?view=path');await ready(page);await graphToolbar(page,'编辑画布');
 await graphProperties(page,page.locator('.react-flow__node[data-id="'+a.workItems[0].id+'"] .dependency-card'));await page.getByLabel('元素名称').fill('跨页待核对标题');await page.getByLabel('元素名称').blur();await expect(page.locator('[data-draft-stored="true"]')).toBeVisible();
 const tab=await context.newPage();await tab.goto(page.url());await ready(tab);await expect(tab.locator('.page-toolbar-status')).toContainText('其他页面编辑中');
 let originalBatch='';await page.route('**/dependency-changes/apply',async route=>{originalBatch=route.request().postDataJSON().batchId;await route.abort('connectionfailed');});
 await graphToolbar(page,'保存修改');await expect.poll(()=>originalBatch).not.toBe('');await expect(page.locator('.page-toolbar-status')).toContainText('提交结果待核对');
 await openGraphDrafts(tab);await tab.getByRole('button',{name:'接管此草稿',exact:true}).click();await expect(tab.getByLabel('保存修改',{exact:true})).toBeEnabled();
 let takeoverBatch='';await tab.route('**/dependency-changes/apply',async route=>{takeoverBatch=route.request().postDataJSON().batchId;await route.abort('connectionfailed');});
 await graphToolbar(tab,'保存修改');await expect.poll(()=>takeoverBatch).not.toBe('');expect(takeoverBatch).toBe(originalBatch);await tab.close();
});
test('待核对提交的原页面关闭后，已打开标签自动沿用原批次',async({page,context})=>{
 const {a}=await fixture(page);await openGraph(page,'/requirements/'+a.id+'?view=path');await ready(page);await graphToolbar(page,'编辑画布');
 await graphProperties(page,page.locator('.react-flow__node[data-id="'+a.workItems[0].id+'"] .dependency-card'));await page.getByLabel('元素名称').fill('关闭原页的待核对标题');await page.getByLabel('元素名称').blur();await expect(page.locator('[data-draft-stored="true"]')).toBeVisible();
 const tab=await context.newPage();await tab.goto(page.url());await ready(tab);await expect(tab.locator('.page-toolbar-status')).toContainText('其他页面编辑中');
 let originalBatch='';await page.route('**/dependency-changes/apply',async route=>{originalBatch=route.request().postDataJSON().batchId;await route.abort('connectionfailed');});
 await graphToolbar(page,'保存修改');await expect.poll(()=>originalBatch).not.toBe('');await expect(page.locator('.page-toolbar-status')).toContainText('提交结果待核对');await page.close();
 await expect(tab.getByLabel('保存修改',{exact:true})).toBeEnabled();let resumedBatch='';await tab.route('**/dependency-changes/apply',async route=>{resumedBatch=route.request().postDataJSON().batchId;await route.abort('connectionfailed');});
 await graphToolbar(tab,'保存修改');await expect.poll(()=>resumedBatch).not.toBe('');expect(resumedBatch).toBe(originalBatch);await tab.close();
});
test('待核对通知丢失时，自动接手页面保存前仍读取原批次',async({page,context})=>{
 const {a}=await fixture(page);await openGraph(page,'/requirements/'+a.id+'?view=path');await ready(page);await graphToolbar(page,'编辑画布');
 await graphProperties(page,page.locator('.react-flow__node[data-id="'+a.workItems[0].id+'"] .dependency-card'));await page.getByLabel('元素名称').fill('通知丢失的待核对标题');await page.getByLabel('元素名称').blur();await expect(page.locator('[data-draft-stored="true"]')).toBeVisible();
 const tab=await context.newPage();await tab.addInitScript(()=>{const target=window as unknown as {addEventListener:(...args:unknown[])=>void},add=target.addEventListener.bind(window);target.addEventListener=(...args:unknown[])=>{if(args[0]==='storage'){const listener=args[1] as (event:StorageEvent)=>void;args[1]=(event:StorageEvent)=>{if(!event.key?.endsWith(':submission:changed'))listener(event);};}add(...args);};});await tab.goto(page.url());await ready(tab);await expect(tab.locator('.page-toolbar-status')).toContainText('其他页面编辑中');
 let originalBatch='';await page.route('**/dependency-changes/apply',async route=>{originalBatch=route.request().postDataJSON().batchId;await route.abort('connectionfailed');});
 await graphToolbar(page,'保存修改');await expect.poll(()=>originalBatch).not.toBe('');await expect(page.locator('.page-toolbar-status')).toContainText('提交结果待核对');await page.close();
 await expect(tab.getByLabel('保存修改',{exact:true})).toBeEnabled();let resumedBatch='';await tab.route('**/dependency-changes/apply',async route=>{resumedBatch=route.request().postDataJSON().batchId;await route.abort('connectionfailed');});
 await graphToolbar(tab,'保存修改');await expect.poll(()=>resumedBatch).not.toBe('');expect(resumedBatch).toBe(originalBatch);await tab.close();
});
test('本机存储失败给出提示，保存失败保留当前编辑并且不写正式数据',async({page})=>{
 const {analysis}=await fixture(page);await page.addInitScript(()=>{Object.defineProperty(window,'indexedDB',{value:{open(){throw new DOMException('quota','QuotaExceededError');}}});});await openGraph(page,'/paths?view=project');await ready(page);const before=await analysis();await graphToolbar(page,'编辑画布');await graphProperties(page,page.locator('.react-flow__node .dependency-card').first());await page.getByLabel('元素名称').fill('内存中的修改');await page.getByLabel('元素名称').blur();await expect(page.locator('.page-toolbar-status')).toContainText('本机保存失败');await expect(page.getByLabel('保存修改')).toBeEnabled();await graphToolbar(page,'保存修改');await reopenGraphProperties(page);await expect(page.getByLabel('元素名称')).toHaveValue('内存中的修改');expect((await analysis()).requirements).toEqual(before.requirements);
 await closeGraphProperties(page);await page.getByRole('link',{name:'个人设置',exact:true}).click();await expect(page.getByRole('heading',{name:'个人设置',exact:true})).toBeVisible();
 await page.goBack();await ready(page);await reopenGraphProperties(page);await expect(page.getByLabel('元素名称')).toHaveValue('内存中的修改');expect((await analysis()).requirements).toEqual(before.requirements);
});
test('关闭浏览器后从同一本机草稿恢复内容、撤销和视口', async({},info)=>{
 test.setTimeout(90000);const baseURL=String(info.project.use.baseURL||'http://127.0.0.1:3211'),profile=info.outputPath('browser-profile');
 let context=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true,baseURL,viewport:{width:1280,height:800}});let page=context.pages()[0];
 try{await fixture(page);await openGraph(page,'/templates?edit=new');await ready(page);await graphProperties(page,page.locator('.react-flow__node .dependency-card').first());await page.getByLabel('元素名称').fill('关闭后恢复');await page.getByLabel('元素名称').blur();const url=page.url(),positions=await page.locator('.react-flow__node').evaluateAll(ns=>ns.map(n=>(n as HTMLElement).style.transform));await page.waitForTimeout(150);await context.close();
 context=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true,baseURL,viewport:{width:1280,height:800}});page=context.pages()[0];await page.request.post('/api/login',{data:{username:'admin',password:'41_xc7q0qOjo4Inw!'}});await openGraph(page,url);await ready(page);await expect(page.locator('.react-flow__node strong')).toHaveText('关闭后恢复');expect(await page.locator('.react-flow__node').evaluateAll(ns=>ns.map(n=>(n as HTMLElement).style.transform))).toEqual(positions);await graphToolbar(page,'撤销');await expect(page.locator('.react-flow__node strong')).toHaveText('新工作项');
 }finally{await context.close();}
});

test('项目里程碑拖线与前置勾选共享同一关系，修改仅在保存后生效',async({page})=>{
 const {project,a,b,analysis}=await fixture(page),id=crypto.randomUUID(),initial=await analysis();
 const body={expectedRevision:initial.revision,target:'project',changes:{add:[{clientId:crypto.randomUUID(),sourceRequirementId:b.id,sourceWorkItemId:null,targetRequirementId:'',targetMilestoneId:id,targetWorkItemId:null}],remove:[],estimates:[],entities:[{entity:'milestone',op:'create',id,data:{title:'项目交付点',confirmationMode:'auto'}}]}};
 const preview=await(await page.request.post('/api/projects/'+project.id+'/dependency-changes/preview',{data:body})).json();const saved=await page.request.post('/api/projects/'+project.id+'/dependency-changes/apply',{data:{...body,batchId:crypto.randomUUID(),previewToken:preview.previewToken}});expect(saved.ok()).toBe(true);
 await openGraph(page,'/paths?pathScope=all');await ready(page);await graphToolbar(page,'编辑画布');
 await page.locator('.react-flow__node[data-id="'+a.id+'"] .business-handle[data-side="top"]').click();await page.locator('.react-flow__node[data-id="'+id+'"] .dependency-card').click({position:{x:80,y:12}});await ready(page);
 await graphProperties(page,page.locator('.react-flow__node[data-id="'+id+'"] .dependency-card'));await page.getByRole('dialog').locator('.graph-more-relations summary').click();const check=page.getByRole('checkbox',{name:a.title,exact:true});await expect(check).toBeChecked();
 await check.uncheck();await expect(check).not.toBeChecked();await graphToolbar(page,'撤销');await page.getByRole('dialog').locator('.graph-more-relations summary').click();await expect(check).toBeChecked();expect((await analysis()).dependencies.some(d=>d.targetMilestoneId===id&&d.sourceRequirementId===a.id)).toBe(false);
 await expect(page.getByLabel('保存修改')).toBeEnabled();await graphToolbar(page,'保存修改');await expect(page.getByLabel('编辑画布',{exact:true})).toBeVisible();expect((await analysis()).dependencies.filter(d=>d.targetMilestoneId===id&&d.sourceRequirementId===a.id)).toHaveLength(1);
});

test('分析浮层限宽，关闭逐帧保持原矩形，快速切换不闪回旧内容',{tag:'@responsive'}, async({page},info)=>{
 const {project,a,analysis}=await fixture(page),data=await analysis();
 for(const n of data.nodes){n.plannedStart=null;n.plannedEnd=null;n.forecastStart=null;n.forecastEnd=null;}
 for(const m of data.milestones||[]){m.targetDate=null;m.forecastEnd=null;m.achievedAt=null;}
 await page.route('**/api/projects/'+project.id+'/path-graph**',r=>r.fulfill({json:{analysis:data}}));
 await openGraph(page,'/paths?pathScope=all');await ready(page);await graphProperties(page,page.locator('.react-flow__node[data-id="'+a.id+'"] .dependency-card'));await page.waitForTimeout(220);
 const detail=await page.getByRole('dialog').boundingBox();expect(detail!.x).toBeGreaterThanOrEqual(0);expect(detail!.x+detail!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
 await closeGraphProperties(page);await page.getByRole('button',{name:'排期预览',exact:true}).click();await page.waitForTimeout(230);
 const panel=page.locator('.graph-auxiliary[aria-hidden="false"]');expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(480);await expect(panel.locator('.path-draft-gantt-track')).toHaveCount(0);expect(await panel.evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);
 await page.screenshot({path:info.outputPath('compact-undated-panel.png')});
 const sample=await page.evaluate(async()=>{const read=()=>{const e=document.querySelector<HTMLElement>('.graph-auxiliary');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,opacity:Number(getComputedStyle(e).opacity)};};const before=read()!,frames:ReturnType<typeof read>[]=[];[...document.querySelectorAll<HTMLButtonElement>('.graph-auxiliary button')].find(b=>b.textContent==='关闭')!.click();await new Promise<void>(resolve=>{const start=performance.now();const tick=()=>{frames.push(read());if(performance.now()-start<250)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick);});return {before,frames};});
 expect(sample.frames.filter(Boolean).length).toBeGreaterThan(2);for(const frame of sample.frames){if(!frame)continue;expect(Math.abs(frame.width-sample.before.width)).toBeLessThan(1);expect(Math.abs(frame.height-sample.before.height)).toBeLessThan(1);expect(Math.abs(frame.x-sample.before.x)).toBeLessThan(1);expect(frame.y).toBeGreaterThanOrEqual(sample.before.y-.5);expect(frame.y).toBeLessThanOrEqual(sample.before.y+8.5);}expect(sample.frames.at(-1)).toBeNull();
 await info.attach('close-frames',{body:JSON.stringify(sample),contentType:'application/json'});
 await closeGraphProperties(page);await page.getByRole('button',{name:'排期预览',exact:true}).click();await page.waitForTimeout(35);await page.locator('.graph-auxiliary[aria-hidden="false"]').getByRole('button',{name:'关闭',exact:true}).click();await closeGraphProperties(page);await page.getByRole('button',{name:'余量',exact:true}).click();await page.waitForTimeout(260);await expect(page.locator('.graph-auxiliary h3')).toHaveText('余量分布');await expect(page.locator('.graph-auxiliary')).toHaveCount(1);
 await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.graph-auxiliary').getByRole('button',{name:'关闭',exact:true}).click();await expect(page.locator('.graph-auxiliary')).toHaveCount(0);
});

test('有效排期图默认限宽，可主动展开，窄屏独立滚动且画布不跳动',{tag:'@responsive'}, async({page},info)=>{
 const {project,analysis}=await fixture(page),data=await analysis();for(const n of data.nodes.filter(n=>n.kind==='acceptance')){n.plannedStart='2026-09-07';n.plannedEnd='2026-09-10';n.forecastStart='2026-09-08';n.forecastEnd='2026-09-11';}
 await page.route('**/api/projects/'+project.id+'/path-graph**',r=>r.fulfill({json:{analysis:data}}));await openGraph(page,'/paths?pathScope=all');await ready(page);const view=await viewportValue(page),positions=await positionsValue(page);
 await closeGraphProperties(page);await page.getByRole('button',{name:'排期预览',exact:true}).click();await page.waitForTimeout(220);const panel=page.locator('.graph-auxiliary'),width=(await panel.boundingBox())!.width;expect(width).toBeLessThanOrEqual(800);await page.getByLabel('展开排期图',{exact:true}).click();await expect(panel).toHaveAttribute('data-size','expanded');expect((await panel.boundingBox())!.width).toBeGreaterThan(width);expect(await viewportValue(page)).toBe(view);expect(await positionsValue(page)).toEqual(positions);
 await page.getByLabel('收起排期图',{exact:true}).click();await expect(panel).toHaveAttribute('data-size','timeline');expect((await panel.boundingBox())!.width).toBe(width);
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(230);const box=(await panel.boundingBox())!,controls=(await page.locator('.graph-view-controls').boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);expect(box.y+box.height).toBeLessThan(controls.y-10);await page.screenshot({path:info.outputPath('dated-panel-narrow.png')});
});

test('流程概览隐藏迁移排序值，里程碑不重复也不显示零工期',async({page})=>{
 const {project}=await fixture(page);
 const templates=await(await page.request.get('/api/templates?projectId='+project.id)).json() as WorkItemTemplate[];
 const t=templates.find(t=>t.name==='依赖流程')!,work=t.items[1];work.milestoneLabel='可验收';
 t.items.push({...work,id:'milestone:'+work.id,title:'可验收',kind:'milestone',sortOrder:10001,startOffsetDays:5,durationDays:0,milestoneLabel:null,predecessorIds:[work.id]});
 await page.route('**/api/templates?*',r=>r.fulfill({json:templates}));await openGraph(page,'/templates');const card=page.locator('.template-card').filter({hasText:'依赖流程'});
 await expect(card.locator('.template-thumb-node:not(.is-milestone)')).toHaveCount(2);await expect(card.locator('.template-thumb-node.is-milestone')).toHaveCount(1);await expect(card.locator('.template-card-summary')).toContainText('1 个里程碑');await card.getByRole('button',{name:'查看流程 依赖流程',exact:true}).click();const preview=page.getByRole('dialog');await expect(preview.locator('.template-structure-node:not(.is-milestone)')).toHaveCount(2);await expect(preview.locator('.template-structure-node').filter({hasText:'可验收'})).toHaveCount(1);await expect(preview).not.toContainText('持续0');await preview.getByRole('button',{name:'关闭',exact:true}).click();await expect(card).not.toContainText('10002');await expect(card).not.toContainText('持续0');
 await card.getByRole('button',{name:'编辑流程 依赖流程',exact:true}).click();await ready(page);await closeGraphProperties(page);await page.getByRole('button',{name:'返回流程列表',exact:true}).click();await expect(card).toBeVisible();await expect(card.locator('.template-thumb-node')).toHaveCount(3);
});


for(const scope of ['global','requirement','template'] as const)test(`${scope}：拖动至路由完成逐帧不显示旧线，临时线有箭头且保留草稿`,async({page},info)=>{
 const {a,project,analysis}=await fixture(page);const revision=(await analysis()).revision;
 await page.route('**/fixed-routing.worker*.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+';{const send=self.postMessage.bind(self);let count=0;self.postMessage=(...args)=>{setTimeout(()=>send(...args),++count>1?550:0);};}'});});
 const templates=await(await page.request.get('/api/templates?projectId='+project.id)).json() as WorkItemTemplate[],template=templates.find(t=>t.id===a.templateId)!;
 const id=scope==='global'?a.id:scope==='requirement'?a.workItems[0].id:template.items[0].id;
 await openGraph(page,scope==='global'?'/paths?pathScope=all':scope==='requirement'?'/requirements/'+a.id+'?view=path':'/templates?edit='+template.id);await ready(page);if(scope!=='template')await graphToolbar(page,'编辑画布');
 const node=page.locator('.react-flow__node[data-id="'+id+'"]'),box=(await node.boundingBox())!,view=await viewportValue(page);
 const sampling=page.evaluate(async id=>{const node=document.querySelector<HTMLElement>('.react-flow__node[data-id="'+id+'"]')!,original=node.style.transform,originalBox=node.getBoundingClientRect(),paths=new Map([...document.querySelectorAll<SVGGElement>('.react-flow__edge')].filter(e=>{const line=e.querySelector<SVGPathElement>('.react-flow__edge-path');if(!line)return false;const m=line.getScreenCTM()!;return [line.getPointAtLength(0),line.getPointAtLength(line.getTotalLength())].map(p=>new DOMPoint(p.x,p.y).matrixTransform(m)).some(p=>p.x>=originalBox.left-12&&p.x<=originalBox.right+12&&p.y>=originalBox.top-12&&p.y<=originalBox.bottom+12);}).map(e=>[e.dataset.id!,e.querySelector('.react-flow__edge-path')?.getAttribute('d')]));if(!paths.size)throw new Error('没有找到所拖节点的关联线');const frames:{phase:string|null;ghosts:number;pending:number}[]=[];let moved=false;await new Promise<void>((resolve,reject)=>{const start=performance.now();const tick=()=>{if(performance.now()-start>10000){reject(new Error('拖动观察超时'));return;}const changed=node.style.transform!==original;moved||=changed;if(changed){let ghosts=0;for(const edge of document.querySelectorAll<SVGGElement>('.react-flow__edge')){const g=edge.querySelector<SVGGElement>('.graph-routed-edge')!,path=edge.querySelector('.react-flow__edge-path');if(paths.has(edge.dataset.id!)&&path?.getAttribute('d')===paths.get(edge.dataset.id!)&&getComputedStyle(g).visibility!=='hidden'&&Number(g.getAttribute('opacity'))>.01)ghosts++;}frames.push({phase:document.querySelector('.dependency-canvas')!.getAttribute('data-layout-phase'),ghosts,pending:document.querySelectorAll('.graph-pending-route[marker-end]').length});}if(moved&&frames.length>20&&document.querySelector('.dependency-canvas')!.getAttribute('data-layout-phase')==='ready')resolve();else requestAnimationFrame(tick);};requestAnimationFrame(tick);});return frames;},id);
 await page.mouse.move(box.x+70,box.y+12);await page.mouse.down();await page.mouse.move(box.x+104,box.y+44,{steps:10});await expect(page.locator('.graph-pending-route').first()).toHaveAttribute('marker-end',/url/);await page.mouse.up();
 const frames=await sampling;expect(frames.some(f=>f.pending>0)).toBe(true);expect(frames.filter(f=>f.ghosts>0)).toEqual([]);await ready(page);await expect(page.locator('.graph-route-stale')).toHaveCount(0);await expect(page.locator('.graph-pending-route')).toHaveCount(0);expect(await viewportValue(page)).toBe(view);expect((await analysis()).revision).toBe(revision);await info.attach('drag-frames',{body:JSON.stringify(frames),contentType:'application/json'});await page.screenshot({path:info.outputPath('settled-'+scope+'.png')});
});

test('四侧预览吸附卡片边缘，改接前置箭头与提示方向一致，键盘连接不平移',async({page},info)=>{
 const {project}=await fixture(page);const template=await(await page.request.post('/api/templates',{data:{projectId:project.id,name:'手势方向',dependencyMode:'dependencies',items:['前置','后续','候选'].map((title,i)=>({clientKey:'k'+i,title,durationDays:1,startOffsetDays:i,sortOrder:i,predecessorKeys:i===1?['k0']:[]}))}})).json() as WorkItemTemplate;
 await openGraph(page,'/templates?edit='+template.id);await ready(page);
 const card=(title:string)=>page.locator('.react-flow__node').filter({has:page.locator('strong',{hasText:new RegExp('^'+title+'$')})}),source=card('前置'),target=card('候选'),targetBox=(await target.boundingBox())!;
 const arrow=()=>page.locator('.graph-live-connection').evaluate(e=>{const p=e as SVGPathElement,point=p.getPointAtLength(p.getTotalLength()),m=p.getScreenCTM()!,v=new DOMPoint(point.x,point.y).matrixTransform(m);return {x:v.x,y:v.y,marker:p.getAttribute('marker-end')};});
 const nearBorder=(tip:{x:number;y:number},box:{x:number;y:number;width:number;height:number})=>Math.min(Math.abs(tip.x-box.x),Math.abs(tip.x-box.x-box.width),Math.abs(tip.y-box.y),Math.abs(tip.y-box.y-box.height));
 for(const side of ['top','bottom','left','right']){const handle=(await source.locator('.business-handle[data-side='+side+']').boundingBox())!;await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(targetBox.x+targetBox.width/2,targetBox.y+targetBox.height/2,{steps:7});await expect(page.locator('.graph-connection-hint')).toHaveText('前置 完成后 候选 开始');const tip=await arrow();expect(tip.marker).toMatch(/url/);expect(nearBorder(tip,targetBox)).toBeLessThan(8);await page.keyboard.press('Escape');await page.mouse.up();await expect(page.locator('.graph-live-connection')).toHaveCount(0);}
 await page.locator('.react-flow__edge').first().dispatchEvent('click');await closeGraphProperties(page);await page.waitForTimeout(220);const handle=(await page.getByLabel('拖动改接前置',{exact:true}).boundingBox())!,successorBox=(await card('后续').boundingBox())!;
 await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(targetBox.x+80,targetBox.y+40,{steps:8});await expect(page.locator('.graph-connection-hint')).toHaveText('候选 完成后 后续 开始');expect(nearBorder(await arrow(),successorBox)).toBeLessThan(8);await page.screenshot({path:info.outputPath('reconnect-direction.png')});await page.mouse.up();await ready(page);await expect(page.locator('.react-flow__edge')).toHaveCount(1);
 const view=await viewportValue(page);await source.locator('.business-handle[data-side=bottom]').focus();await page.keyboard.press('Space');await target.focus();await expect(page.locator('.graph-connection-hint')).toHaveText('前置 完成后 候选 开始');await page.keyboard.press('Enter');await ready(page);await expect(page.locator('.react-flow__edge')).toHaveCount(2);expect(await viewportValue(page)).toBe(view);
});

test('路由等待期间连续微移不同节点不回退，Esc 取消后继续拖动不遗留修改',async({page})=>{
 const {project}=await fixture(page);const template=await(await page.request.post('/api/templates',{data:{projectId:project.id,name:'连续微移',dependencyMode:'dependencies',items:['甲','乙','丙'].map((title,i)=>({clientKey:'k'+i,title,durationDays:1,startOffsetDays:i,sortOrder:i,predecessorKeys:i===1?['k0']:[]}))}})).json() as WorkItemTemplate;
 await page.route('**/fixed-routing.worker*.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+';{const send=self.postMessage.bind(self);let count=0;self.postMessage=(...args)=>{setTimeout(()=>send(...args),++count%2===0?650:250);};}'});});
 await openGraph(page,'/templates?edit='+template.id);await ready(page);const ids=template.items.map(i=>i.id),node=(i:number)=>page.locator('.react-flow__node[data-id="'+ids[i]+'"]');
 const before=await positionsValue(page),startX=await node(0).evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).m41);await graphProperties(page,node(0).locator('.dependency-card'));await closeGraphProperties(page);await node(0).focus();await page.keyboard.press('Shift+ArrowRight');const movedA=(await positionsValue(page))[ids[0]];expect(await node(0).evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).m41)).toBe(startX+10);expect(movedA).not.toBe(before[ids[0]]);await graphProperties(page,node(2).locator('.dependency-card'));await closeGraphProperties(page);await node(2).focus();await page.keyboard.press('Shift+ArrowDown');const movedB=(await positionsValue(page))[ids[2]];expect((await positionsValue(page))[ids[0]]).toBe(movedA);await ready(page);expect((await positionsValue(page))[ids[0]]).toBe(movedA);expect((await positionsValue(page))[ids[2]]).toBe(movedB);
 const settled=await positionsValue(page),box=(await node(0).boundingBox())!;await page.mouse.move(box.x+80,box.y+40);await page.mouse.down();await page.mouse.move(box.x+112,box.y+64,{steps:5});await page.keyboard.press('Escape');await page.mouse.move(box.x+136,box.y+88,{steps:5});await page.mouse.up();await ready(page);expect(await positionsValue(page)).toEqual(settled);await expect(page.locator('.graph-pending-route')).toHaveCount(0);
 await graphToolbar(page,'撤销');await ready(page);expect((await positionsValue(page))[ids[2]]).toBe(before[ids[2]]);expect((await positionsValue(page))[ids[0]]).toBe(movedA);
 // A delayed result arrives while another drag is active; cancellation must not replay that snapshot.
 await closeGraphProperties(page);await node(0).focus();await page.keyboard.press('Shift+ArrowRight');await expect(page.locator('.dependency-canvas')).toHaveAttribute('data-layout-phase','layout');
 const pending=await positionsValue(page),liveBox=(await node(0).boundingBox())!;await page.mouse.move(liveBox.x+80,liveBox.y+12);await page.mouse.down();await page.mouse.move(liveBox.x+112,liveBox.y+36,{steps:4});await page.waitForTimeout(750);await page.keyboard.press('Escape');await page.mouse.up();await ready(page);expect(await positionsValue(page)).toEqual(pending);await expect(page.locator('.graph-pending-route')).toHaveCount(0);
});

test('深度交互：属性改名保留光标与中文输入确认，Esc 不提交名称',async({page})=>{
 const {a}=await fixture(page);await openGraph(page,'/templates?edit='+a.templateId);await ready(page);
 const node=page.locator('.react-flow__node').first();await graphProperties(page,node.locator('.dependency-card'));const title=page.getByLabel('元素名称');await title.focus();const position=await node.getAttribute('style');
 await title.fill('中文名称');await title.dispatchEvent('compositionstart');
 for(const composing of [{isComposing:true},{keyCode:229}])for(const key of ['Enter','Escape']){await title.dispatchEvent('keydown',{key,code:key,...composing});await expect(title).toHaveValue('中文名称');await expect(title).toBeFocused();}
 await title.dispatchEvent('compositionend');
 await page.keyboard.press('End');await page.keyboard.type(' A B');await expect(title).toHaveValue('中文名称 A B');expect(await node.getAttribute('style')).toBe(position);await page.keyboard.press('Escape');await expect(title).toHaveValue('方案交付');await closeGraphProperties(page);await expect(node).toContainText('方案交付');
});

test('深度交互：Ctrl 多选可反选，选中关系后不再移动或复制旧节点',async({page})=>{
 const {a}=await fixture(page);await openGraph(page,'/templates?edit='+a.templateId);await ready(page);const nodes=page.locator('.react-flow__node'),first=nodes.nth(0),second=nodes.nth(1);
 await first.locator('.dependency-card').click();await closeGraphProperties(page);await second.locator('.dependency-card').click({modifiers:['Control']});await closeGraphProperties(page);await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
 await second.locator('.dependency-card').click({modifiers:['Control']});await closeGraphProperties(page);await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);await expect(first).toHaveClass(/selected/);await closeGraphProperties(page);
 await clickFirstEdge(page);await expect(page.locator('.react-flow__node.selected')).toHaveCount(0);const before=await positionsValue(page);await focusGraph(page);await page.keyboard.press('ArrowRight');await page.keyboard.press('Control+c');await page.keyboard.press('Control+v');await ready(page);expect(await positionsValue(page)).toEqual(before);await expect(nodes).toHaveCount(2);
});

test('深度交互：属性输入框内 Ctrl+S 保存当前内容',async({page})=>{
 const {a}=await fixture(page);await openGraph(page,'/templates?edit='+a.templateId);await ready(page);await graphProperties(page,page.locator('.react-flow__node .dependency-card').first());const field=page.getByLabel('元素名称');
 await field.fill('保存输入框内容');const sent=page.waitForRequest(r=>r.url().endsWith('/api/templates/'+a.templateId)&&r.method()==='PATCH',{timeout:4000});await page.keyboard.press('Control+s');const request=await sent;expect(request.postDataJSON().items[0].title).toBe('保存输入框内容');await expect(page.getByLabel('撤销',{exact:true})).toBeDisabled();
});

test('深度交互：Esc 优先取消放置，不误关闭属性后继续新增',async({page})=>{
 const {a}=await fixture(page);await openGraph(page,'/templates?edit='+a.templateId);await ready(page);await graphProperties(page,page.locator('.react-flow__node .dependency-card').first());await graphToolbar(page,'添加元素');await page.locator('.graph-elements').getByRole('button',{name:'工作项',exact:true}).click();await focusGraph(page);await page.keyboard.press('Escape');await blank(page);await ready(page);await expect(page.locator('.react-flow__node')).toHaveCount(2);await expect(page.getByLabel('撤销',{exact:true})).toBeDisabled();
});

test('深度交互：拖动中窗口失焦后恢复原位，后续移动不形成修改',async({page})=>{
 const {a}=await fixture(page);await openGraph(page,'/templates?edit='+a.templateId);await ready(page);const before=await positionsValue(page),box=(await page.locator('.react-flow__node').first().boundingBox())!;
 await page.mouse.move(box.x+70,box.y+12);await page.mouse.down();await page.mouse.move(box.x+120,box.y+44,{steps:6});await expect(page.locator('.graph-pending-route').first()).toBeVisible();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.move(box.x+140,box.y+64,{steps:4});await page.mouse.up();await ready(page);expect(await positionsValue(page)).toEqual(before);await expect(page.locator('.graph-pending-route')).toHaveCount(0);await expect(page.getByLabel('撤销',{exact:true})).toBeDisabled();
 await focusGraph(page);await page.keyboard.press('Control+a');await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);await clickFirstEdge(page);await expect(page.locator('.react-flow__edge.selected')).toHaveCount(1);await expect(page.locator('.react-flow__node.selected')).toHaveCount(0);expect(await positionsValue(page)).toEqual(before);
});

test('深度交互：点击连线后右键取消，不误建关系',async({page})=>{
 const {a}=await fixture(page);await openGraph(page,'/templates?edit='+a.templateId);await ready(page);const first=page.locator('.react-flow__node').first(),second=page.locator('.react-flow__node').nth(1);
 await second.locator('.business-handle[data-side=bottom]').click();await expect(page.locator('.dependency-canvas')).toHaveAttribute('data-connection-active','true');await first.locator('.dependency-card').click({button:'right'});await expect(page.locator('.dependency-canvas')).toHaveAttribute('data-connection-active','false');await expect(page.locator('.graph-error-notice')).toHaveCount(0);await expect(page.getByLabel('撤销',{exact:true})).toBeDisabled();await expect(page.locator('.react-flow__edge')).toHaveCount(1);
});

test('深度交互：搜索中 Esc 关闭当前查找层并恢复键盘焦点',async({page})=>{
 const {a}=await fixture(page);await openGraph(page,'/templates?edit='+a.templateId);await ready(page);await graphProperties(page,page.locator('.react-flow__node .dependency-card').first());await focusGraph(page);await page.keyboard.press('Control+f');const search=page.getByLabel('搜索流程节点');await expect(search).toBeFocused();await search.fill('方案');await page.keyboard.press('Escape');await expect(page.locator('.graph-finder')).toHaveCount(0);await expect(page.getByLabel('查找与筛选',{exact:true})).toBeFocused();
});


test('深度交互：项目原位改名后立即 Ctrl+S 预览并保存新名称，失败保留草稿',async({page})=>{
 const {a,analysis}=await fixture(page);await openGraph(page,'/paths?pathScope=all');await ready(page);await graphToolbar(page,'编辑画布');const node=page.locator('.react-flow__node[data-id="'+a.id+'"]');await graphProperties(page,node.locator('.dependency-card'));const title=page.getByLabel('元素名称');await title.fill('快捷保存的新名称');
 const saved=page.waitForResponse(r=>r.url().includes('/dependency-changes/apply')&&r.request().method()==='POST');await page.keyboard.press('Control+s');expect((await saved).ok()).toBe(true);await expect(page.getByLabel('编辑画布',{exact:true})).toBeVisible();expect((await analysis()).requirements.find(r=>r.id===a.id)?.title).toBe('快捷保存的新名称');
 await graphToolbar(page,'编辑画布');await graphProperties(page,node.locator('.dependency-card'));await title.fill('预览失败的名称');await page.route('**/dependency-changes/preview',r=>r.fulfill({status:400,json:{error:'模拟预览校验失败'}}));await page.keyboard.press('Control+s');await expect(page.locator('.page-toolbar-status')).toContainText('未保存');expect((await analysis()).requirements.find(r=>r.id===a.id)?.title).toBe('快捷保存的新名称');await expect(title).toHaveValue('预览失败的名称');
});


test('深度交互：Ctrl+A 后微移与一次撤销，多选反选后属性对应剩余节点',async({page})=>{
 const {a}=await fixture(page);await openGraph(page,'/templates?edit='+a.templateId);await ready(page);const before=await positionsValue(page),first=page.locator('.react-flow__node').first(),second=page.locator('.react-flow__node').nth(1);
 await first.locator('.dependency-card').click();await closeGraphProperties(page);await second.locator('.dependency-card').click({modifiers:['Control']});await closeGraphProperties(page);await first.locator('.dependency-card').click({modifiers:['Control']});await closeGraphProperties(page);await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);await graphProperties(page,second.locator('.dependency-card'));await expect(page.getByLabel('元素名称')).toHaveValue('集成验证');
 await focusGraph(page);await page.keyboard.press('Control+a');await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);await page.keyboard.press('Shift+ArrowDown');await ready(page);const moved=await positionsValue(page);for(const [id,transform]of Object.entries(before))expect(translateY(String(transform)).y+10).toBe(translateY(moved[id]).y);
 await page.reload();await ready(page);await focusGraph(page);await page.keyboard.press('Control+z');await ready(page);expect(await positionsValue(page)).toEqual(before);
});

function translateY(transform:string){return {y:Number(transform.match(/translate\([^,]+,\s*(-?[\d.]+)px\)/)?.[1])};}

async function clickFirstEdge(page:Page){
 await closeGraphProperties(page);
 const point=await page.locator('.react-flow__edge-path').first().evaluate(element=>{
  const edge=element as SVGPathElement,point=edge.getPointAtLength(edge.getTotalLength()/2),matrix=edge.getScreenCTM()!;
  return {x:point.x*matrix.a+point.y*matrix.c+matrix.e,y:point.x*matrix.b+point.y*matrix.d+matrix.f};
 });
 await page.mouse.click(point.x,point.y);
}

test('深度交互：输入框保留文字撤销，全局快捷键不删除内置验收',async({page})=>{
 const {a}=await fixture(page);await openGraph(page,'/requirements/'+a.id+'?view=path');await ready(page);await graphToolbar(page,'编辑画布');const acceptance=page.locator('.react-flow__node').filter({hasText:'验收'}).last();await acceptance.dispatchEvent('click');await focusGraph(page);await page.keyboard.press('Delete');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByLabel('撤销',{exact:true})).toBeDisabled();
 await graphProperties(page,page.locator('.react-flow__node[data-id="'+a.workItems[0].id+'"] .dependency-card'));const input=page.getByLabel('元素名称');await input.focus();await page.keyboard.press('End');await page.keyboard.insertText('补充');await page.keyboard.press('Control+z');await expect(input).toHaveValue('方案交付');await page.keyboard.press('Control+a');await page.keyboard.insertText('文字选择');await expect(input).toHaveValue('文字选择');
});


test('深度交互：关闭浮层后键盘继续作用于画布，切换输入框不抢焦点',async({page})=>{
 const {a}=await fixture(page);await openGraph(page,'/templates?edit='+a.templateId);await ready(page);await graphProperties(page,page.locator('.react-flow__node .dependency-card').first());await closeGraphProperties(page);await expect(page.locator('.dependency-canvas')).toBeFocused();await page.keyboard.press('Control+f');await expect(page.getByLabel('搜索流程节点')).toBeFocused();
 await headerAction(page,'流程属性');const field=page.getByLabel('流程名称');await field.focus();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'更多操作',exact:true})).toBeFocused();await expect(page.locator('.graph-auxiliary[aria-hidden="false"]')).toHaveCount(0);
});


test('重构：无效字段返回及刷新后恢复，Esc 回退字段并可继续编辑',async({page})=>{
 const {a}=await fixture(page);await openGraph(page,'/templates?edit='+a.templateId);await ready(page);await graphProperties(page,page.locator('.react-flow__node .dependency-card').first());const input=page.getByLabel('元素名称');await input.fill('');await input.blur();await expect(input).toHaveAttribute('aria-invalid','true');await closeGraphProperties(page);await page.getByRole('button',{name:'返回流程列表',exact:true}).click();await openGraph(page,'/templates?edit='+a.templateId);await ready(page);await graphProperties(page,page.locator('.react-flow__node .dependency-card').first());await expect(input).toHaveValue('');await expect(input).toHaveAttribute('aria-invalid','true');await page.reload();await ready(page);await graphProperties(page,page.locator('.react-flow__node .dependency-card').first());await input.focus();await page.keyboard.press('Escape');await expect(input).toHaveValue('方案交付');await input.fill('恢复后的名称');await input.blur();await expect(page.locator('.react-flow__node strong').first()).toHaveText('恢复后的名称');
});

test('重构：输入法组合中的保存延后一次，结束后提交当前文本',async({page})=>{
 const {a}=await fixture(page);await openGraph(page,'/templates?edit='+a.templateId);await ready(page);await graphProperties(page,page.locator('.react-flow__node .dependency-card').first());const input=page.getByLabel('元素名称');await input.focus();await input.dispatchEvent('compositionstart');await input.fill('中文组合保存');let writes=0;page.on('request',r=>{if(r.method()==='PATCH'&&r.url().endsWith('/api/templates/'+a.templateId))writes++;});await page.keyboard.press('Control+s');await page.keyboard.press('Control+s');expect(writes).toBe(0);const request=page.waitForRequest(r=>r.method()==='PATCH'&&r.url().endsWith('/api/templates/'+a.templateId));await input.dispatchEvent('compositionend');expect((await request).postDataJSON().items[0].title).toBe('中文组合保存');await expect(page.getByLabel('撤销',{exact:true})).toBeDisabled();expect(writes).toBe(1);
});

test('重构：未放置元素在失焦时取消，随后点击不创建对象',async({page})=>{
 const {a}=await fixture(page);await openGraph(page,'/templates?edit='+a.templateId);await ready(page);await graphToolbar(page,'添加元素');await page.locator('.graph-elements').getByRole('button',{name:'工作项',exact:true}).click();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await blank(page);await expect(page.locator('.react-flow__node')).toHaveCount(2);await expect(page.getByLabel('撤销',{exact:true})).toBeDisabled();
});

test('重构：旧 session 草稿迁入 IndexedDB，内容与撤销历史不丢失',async({page})=>{
 const {a,project}=await fixture(page);const account=(await(await page.request.get('/api/session')).json()).accountId,key='pm-graph-draft:'+account+':'+project.id;
 const analysis=await(await page.request.get('/api/projects/'+project.id+'/path-analysis')).json();await page.addInitScript(({key,analysis,a})=>{if(localStorage.getItem('migration-seeded'))return;localStorage.setItem('migration-seeded','1');const empty={add:[],remove:[],estimates:[]};sessionStorage.setItem(key,JSON.stringify({version:String(analysis.revision),values:[empty,{...empty,entities:[{entity:'requirement',op:'update',id:a.id,expectedVersion:a.version,data:{title:'旧会话修改'}}]}],index:1,active:true,server:analysis}));},{key,analysis,a});
 await openGraph(page,'/paths?pathScope=all');await ready(page);await expect(page.locator('.react-flow__node[data-id="'+a.id+'"] .graph-title')).toHaveText('旧会话修改');expect(await page.evaluate(key=>sessionStorage.getItem(key),key)).toBeNull();await page.reload();await ready(page);await focusGraph(page);await page.keyboard.press('Control+z');await expect(page.locator('.react-flow__node[data-id="'+a.id+'"] .graph-title')).toHaveText(a.title);
});

test('重构：保存布局后及后台刷新后不回跳，正式布局和显示位置一致',{tag:'@responsive'}, async({page})=>{
 const {a}=await fixture(page);await openGraph(page,'/paths?pathScope=all');await ready(page);await graphToolbar(page,'编辑画布');await graphProperties(page,page.locator('.react-flow__node[data-id="'+a.id+'"] .dependency-card'));await focusGraph(page);await page.keyboard.press('Shift+ArrowRight');await ready(page);const position=await positionsValue(page);await graphToolbar(page,'保存修改');await expect(page.getByLabel('编辑画布',{exact:true})).toBeVisible();await ready(page);expect(await positionsValue(page)).toEqual(position);await page.reload();await ready(page);expect(await positionsValue(page)).toEqual(position);
});


test('重构：保存中跨画布禁止编辑，完成后保持当前导航位置',async({page})=>{
 const {a}=await fixture(page);await openGraph(page,'/paths?pathScope=all');await ready(page);await graphToolbar(page,'编辑画布');const node=page.locator('.react-flow__node[data-id="'+a.id+'"]');await graphProperties(page,node.locator('.dependency-card'));await page.getByLabel('元素名称').fill('跨画布保存');await page.getByLabel('元素名称').blur();
 let release!:()=>void;const barrier=new Promise<void>(resolve=>release=resolve);await page.route('**/dependency-changes/apply',async route=>{await barrier;await route.continue();});const pending=page.waitForRequest(r=>r.url().endsWith('/dependency-changes/apply'));await graphToolbar(page,'保存修改');await pending;
 await closeGraphProperties(page);await node.getByRole('button',{name:'进入跨画布保存',exact:true}).click();await ready(page);await expect(page).toHaveURL(new RegExp('requirementId='+a.id));await expect(page.getByLabel('保存修改',{exact:true})).toBeDisabled();await expect(page.locator('.business-handle')).toHaveCount(0);const response=page.waitForResponse(r=>r.url().endsWith('/dependency-changes/apply'));release();expect((await response).ok()).toBe(true);await expect(page.getByLabel('编辑画布',{exact:true})).toBeVisible();await expect(page).toHaveURL(new RegExp('requirementId='+a.id));
});


test('重构：关闭属性后保存会返回无效字段，原文保留且不提交',async({page})=>{
 const {a}=await fixture(page);await openGraph(page,'/templates?edit='+a.templateId);await ready(page);await graphProperties(page,page.locator('.react-flow__node .dependency-card').first());const field=page.getByLabel('元素名称');await field.fill('');await field.blur();await closeGraphProperties(page);await expect(page.getByRole('dialog')).toHaveCount(0);let writes=0;page.on('request',r=>{if(r.method()==='PATCH'&&r.url().endsWith('/api/templates/'+a.templateId))writes++;});await graphToolbar(page,'保存修改');await expect(field).toHaveValue('');await expect(field).toHaveAttribute('aria-invalid','true');await expect(field).toBeFocused();expect(writes).toBe(0);
});


test('重构：取消属性改名后继续操作和刷新仍保留原名',async({page})=>{
 const {a}=await fixture(page);await openGraph(page,'/templates?edit='+a.templateId);await ready(page);const title=page.locator('.react-flow__node strong').first();await graphProperties(page,page.locator('.react-flow__node .dependency-card').first());await page.getByLabel('元素名称').fill('取消的属性名称');await page.keyboard.press('Escape');await graphProperties(page,page.locator('.react-flow__node .dependency-card').nth(1));await expect(title).toHaveText('方案交付');await expect(page.getByLabel('撤销',{exact:true})).toBeDisabled();await page.reload();await ready(page);await expect(title).toHaveText('方案交付');await expect(page.getByLabel('撤销',{exact:true})).toBeDisabled();
});

test('全局交付条件：直接拉线、细化、撤销、返回和保存只替换当前关系',async({page},info)=>{
 const {a,b,analysis}=await fixture(page,false);await openGraph(page,'/paths?pathScope=all');await ready(page);
 const formal=await analysis(),view=await viewportValue(page),positions=await positionsValue(page);
 await graphToolbar(page,'编辑画布');
 await page.locator('.react-flow__node[data-id="'+a.id+'"] .business-handle[data-side="right"]').click();
 await page.locator('.react-flow__node[data-id="'+b.id+'"] .dependency-card').click({position:{x:80,y:45}});await ready(page);
 const edge=page.locator('.react-flow__edge[data-id="'+a.id+'>'+b.id+'"]');
 await expect(edge.locator('.dependency-edge-label')).toHaveText('验收后开始');await edge.locator('.dependency-edge-label').click();
 await expect(selectedValue(page.getByLabel('等待什么完成',{exact:true}))).toHaveValue('acceptance:'+a.id);
 await expect(page.locator('.delivery-target')).not.toHaveAttribute('open','');
 await chooseOption(page.getByLabel('等待什么完成',{exact:true}), a.workItems[0].id);await ready(page);
 await expect(edge.locator('.dependency-edge-label')).toHaveText('方案交付后开始');
 expect((await analysis()).dependencies).toEqual(formal.dependencies);expect(await viewportValue(page)).toBe(view);expect(await positionsValue(page)).toEqual(positions);
 await graphToolbar(page,'撤销');await expect(selectedValue(page.getByLabel('等待什么完成',{exact:true}))).toHaveValue('acceptance:'+a.id);
 await graphToolbar(page,'重做');await expect(selectedValue(page.getByLabel('等待什么完成',{exact:true}))).toHaveValue(a.workItems[0].id);
 await page.locator('.delivery-target summary').click();await chooseOption(page.getByLabel('完成后允许什么开始',{exact:true}), b.workItems[1].id);await ready(page);
 await expect(edge.locator('.dependency-edge-label')).toHaveText('方案交付 → 集成验证');
 const back=page.url();await page.getByRole('button',{name:'查看前置交付',exact:true}).click();await ready(page);await expect(page).toHaveURL(new RegExp('requirementId='+a.id));await expect(page).toHaveURL(new RegExp('pathNode='+a.workItems[0].id));
 await page.goBack();await ready(page);expect(page.url()).toBe(back);expect(await viewportValue(page)).toBe(view);
 await expect(selectedValue(page.getByLabel('等待什么完成',{exact:true}))).toHaveValue(a.workItems[0].id);await page.reload();await ready(page);await expect(selectedValue(page.getByLabel('完成后允许什么开始',{exact:true}))).toHaveValue(b.workItems[1].id);
 await graphToolbar(page,'保存修改');await expect(page.getByLabel('编辑画布',{exact:true})).toBeVisible();await ready(page);
 const result=await analysis(),cross=result.dependencies.filter(d=>d.sourceRequirementId===a.id&&d.targetRequirementId===b.id);
 expect(cross).toHaveLength(1);expect(cross[0]).toMatchObject({sourceWorkItemId:a.workItems[0].id,targetWorkItemId:b.workItems[1].id});expect(await positionsValue(page)).toEqual(positions);
 await edge.locator('.dependency-edge-label').click();await expect(page.locator('.delivery-condition')).toBeVisible();await page.screenshot({path:info.outputPath('delivery-condition-saved.png')});
});

test('全局交付条件：聚合明细不误改整组，重复拒绝，刷新保留草稿',async({page})=>{
 const {project,a,b,analysis}=await fixture(page);
 const response=await page.request.post('/api/projects/'+project.id+'/dependencies',{data:{sourceRequirementId:a.id,sourceWorkItemId:a.workItems[0].id,targetRequirementId:b.id,targetWorkItemId:b.workItems[0].id,expectedRevision:(await analysis()).revision}});expect(response.ok()).toBe(true);
 await openGraph(page,'/paths?pathScope=all');await ready(page);const formal=await analysis();
 await graphToolbar(page,'编辑画布');const edge=page.locator('.react-flow__edge[data-id="'+a.id+'>'+b.id+'"]');await expect(edge.locator('.dependency-edge-label')).toHaveText('2 条交付关系');await edge.locator('.dependency-edge-label').click();
 await expect(page.getByLabel('等待什么完成',{exact:true})).toHaveCount(0);await expect(page.getByRole('dialog')).toContainText('请选择一条');
 await page.locator('.modal-card-workspace .graph-relation-list>div>button:first-child').filter({hasText:'订单交付 · 方案交付'}).click();
 await chooseOption(page.getByLabel('完成后允许什么开始',{exact:true}), b.workItems[1].id);await expect(page.locator('.delivery-condition [role="alert"]')).toContainText('已存在相同交付条件');expect((await analysis()).dependencies).toEqual(formal.dependencies);
 await expect(selectedValue(page.getByLabel('完成后允许什么开始',{exact:true}))).toHaveValue(b.workItems[0].id);
 await page.getByRole('button',{name:'返回全部 2 条关系',exact:true}).click();await expect(page.getByLabel('等待什么完成',{exact:true})).toHaveCount(0);
 await page.locator('.modal-card-workspace .graph-relation-list>div>button:first-child').filter({hasText:'订单交付 · 集成验证'}).click();
 await chooseOption(page.getByLabel('等待什么完成',{exact:true}), a.workItems[1].id);await ready(page);expect((await analysis()).dependencies).toEqual(formal.dependencies);
 await closeGraphProperties(page);await headerAction(page,'关系明细');
 await page.locator('.graph-auxiliary .graph-relation-list>div>button:first-child').filter({hasText:'订单交付 · 集成验证'}).click();await page.reload();await ready(page);await expect(selectedValue(page.getByLabel('等待什么完成',{exact:true}))).toHaveValue(a.workItems[1].id);
 await expect(edge).toHaveClass(/selected/);
 await graphToolbar(page,'保存修改');await expect(page.getByLabel('编辑画布',{exact:true})).toBeVisible();
 const cross=(await analysis()).dependencies.filter(d=>d.sourceRequirementId===a.id&&d.targetRequirementId===b.id);expect(cross).toHaveLength(2);
 expect(cross.find(d=>d.targetWorkItemId===b.workItems[0].id)?.sourceWorkItemId).toBe(a.workItems[0].id);expect(cross.find(d=>d.targetWorkItemId===b.workItems[1].id)?.sourceWorkItemId).toBe(a.workItems[1].id);
});

test('全局交付条件：按拼音查找需求里程碑，选择后保持草稿不写正式关系',async({page})=>{
 const {project,a,b,analysis}=await fixture(page,false),milestone=crypto.randomUUID();
 const body={expectedRevision:(await analysis()).revision,target:'project',changes:{add:[{clientId:crypto.randomUUID(),sourceRequirementId:a.id,sourceWorkItemId:null,targetRequirementId:b.id,targetWorkItemId:null}],remove:[],estimates:[],entities:[{id:milestone,entity:'milestone',op:'create',requirementId:a.id,data:{title:'设计确认',confirmationMode:'manual'}},...Array.from({length:4},(_,i)=>({id:crypto.randomUUID(),entity:'work',op:'create',requirementId:a.id,data:{title:'补充任务'+i,durationDays:1}}))]}};
 const previewResponse=await page.request.post('/api/projects/'+project.id+'/dependency-changes/preview',{data:body});expect(previewResponse.ok()).toBe(true);const preview=await previewResponse.json();
 const applied=await page.request.post('/api/projects/'+project.id+'/dependency-changes/apply',{data:{...body,batchId:crypto.randomUUID(),previewToken:preview.previewToken}});expect(applied.ok()).toBe(true);const receipt=await applied.json(),milestoneId=receipt.addedIds[milestone];
 await openGraph(page,'/paths?pathScope=all');await ready(page);const formal=await analysis();await graphToolbar(page,'编辑画布');
 const edge=page.locator('.react-flow__edge[data-id="'+a.id+'>'+b.id+'"]');await edge.locator('.dependency-edge-label').click();
 await page.getByLabel('搜索等待什么完成',{exact:true}).fill('sjqr');await chooseOption(page.getByLabel('等待什么完成',{exact:true}), milestoneId);await ready(page);await expect(edge.locator('.dependency-edge-label')).toHaveText('设计确认后开始');
 expect((await analysis()).dependencies).toEqual(formal.dependencies);await graphToolbar(page,'撤销');await expect(selectedValue(page.getByLabel('等待什么完成',{exact:true}))).toHaveValue('acceptance:'+a.id);
});

test('关系图余量抽屉、顶栏和交付条件在矩阵与窄屏内显示',{tag:'@responsive'},async({page},info)=>{
 const {a,b}=await fixture(page);await openGraph(page,'/paths?pathScope=all');await ready(page);
 const widths=[page.viewportSize()!.width,390];
 for(const width of widths){
  await page.setViewportSize({width,height:844});await closeGraphProperties(page);
  expect((await page.locator('.topbar').boundingBox())!.height).toBeLessThanOrEqual(88);
  await page.getByRole('button',{name:'余量',exact:true}).click();await expect(page.locator('.path-float-distribution')).toBeVisible();
  const drawer=(await page.locator('.graph-auxiliary').boundingBox())!,footer=(await page.locator('.graph-footer').boundingBox())!,controls=(await page.locator('.graph-view-controls').boundingBox())!;
  expect(drawer.y+drawer.height).toBeLessThanOrEqual(Math.min(footer.y,controls.y)-10);
  await page.keyboard.press('Escape');
  await page.locator('.react-flow__edge[data-id="'+a.id+'>'+b.id+'"] .dependency-edge-label').click();
  const panel=page.getByRole('dialog');await expect(panel.locator('.delivery-condition')).toBeVisible();
  const box=(await panel.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);expect(await panel.evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({path:info.outputPath('graph-panels-'+width+'.png')});await closeGraphProperties(page);
 }
});

for(const origin of ['当前画布','项目总图','项目清单'])test(`新增关系从${origin}定位后仍可编辑并保存`,async({page},info)=>{
  const {project,a,b,analysis}=await fixture(page,false),before=await analysis();let writes=0;const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/dependency-changes/apply'))writes++;});
  await openGraph(page,'/paths?pathScope=all');await expect(page.locator('[data-layout-ready="true"]')).toBeVisible();await graphToolbar(page,'编辑画布');
  await page.locator('.react-flow__node[data-id="'+a.id+'"] .business-handle[data-side="bottom"]').click();await page.locator('.react-flow__node[data-id="'+b.id+'"] .dependency-card').click({position:{x:80,y:45}});
  await expect(page.locator('[data-draft-stored="true"]')).toBeVisible();await expect(page.locator('[data-layout-ready="true"]')).toBeVisible();
  if(origin!=='当前画布'){await closeGraphProperties(page);await page.getByRole('button',{name:'上一级',exact:true}).click();if(origin==='项目清单')await page.getByRole('button',{name:'清单',exact:true}).click();}
  await openGraphDrafts(page);await page.locator('.canvas-change-row').filter({hasText:'新增：接口基础交付 → 订单交付'}).getByRole('button',{name:'定位',exact:true}).click();
  await expect(page.locator('.canvas-draft-details')).toHaveCount(0);await expect(page.locator('.delivery-condition')).toBeVisible();await expect(page.locator('.graph-relation-list')).toContainText('未保存');
  expect(new URL(page.url()).searchParams.get('projectId')).toBe(project.id);expect(new URL(page.url()).searchParams.get('scopeId')).toBe(b.featureId);
  const source=page.getByRole('combobox',{name:'等待什么完成',exact:true});await expect(source).toBeEnabled();await chooseOption(source,a.workItems[0].id);await expect(selectedValue(source)).toHaveValue(a.workItems[0].id);
  expect(writes).toBe(0);expect(await analysis()).toEqual(before);
  if(origin==='项目清单'){await page.setViewportSize({width:390,height:844});await expect(page.locator('.delivery-condition')).toBeVisible();await page.screenshot({path:info.outputPath('draft-relation-location-390.png'),animations:'disabled'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}
  const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/dependency-changes/apply'));await graphToolbar(page,'保存修改');expect((await response).status()).toBe(200);expect(writes).toBe(1);
  const after=await analysis(),added=after.dependencies.filter(d=>!before.dependencies.some(old=>old.id===d.id));expect(added).toHaveLength(1);expect(added[0]).toMatchObject({sourceRequirementId:a.id,sourceWorkItemId:a.workItems[0].id,targetRequirementId:b.id,targetWorkItemId:null});
  expect(after.dependencies.filter(d=>before.dependencies.some(old=>old.id===d.id))).toEqual(before.dependencies);expect(errors).toEqual([]);
});

test('新增项目里程碑立即可编辑，摘要定位和跨范围校验后只保存一次',async({page},info)=>{
  const f=await phaseFixture(page),read=async()=>await(await page.request.get(f.base+'/path-analysis')).json() as PathAnalysis,before=await read();let writes=0;
  page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/dependency-changes/apply'))writes++;});
  await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'graph',scopeType:'feature',scopeId:f.feature.id}));await expect(page.locator('[data-layout-ready="true"]')).toBeVisible();
  await graphToolbar(page,'编辑画布');await graphToolbar(page,'添加元素');await page.locator('.graph-elements').getByRole('button',{name:'里程碑',exact:true}).click();
  const box=(await page.locator('.dependency-canvas').boundingBox())!;await page.mouse.click(box.x+box.width*.55,box.y+box.height*.7);await expect(page.locator('[data-draft-stored="true"]')).toBeVisible();
  await expect(page.locator('.dependency-card').filter({hasText:'新里程碑'})).toBeVisible();
  const title=page.getByLabel('元素名称',{exact:true});await expect(title).toHaveValue('新里程碑');expect(new URL(page.url()).searchParams.get('scopeType')).toBe('project');
  await title.fill('项目创建交付点');await title.blur();await expect(page.locator('.dependency-card').filter({hasText:'项目创建交付点'})).toBeVisible();
  await openGraphDrafts(page);await page.locator('.canvas-change-row').filter({hasText:'新增：项目创建交付点'}).getByRole('button',{name:'定位',exact:true}).click();
  await expect(title).toHaveValue('项目创建交付点');const id=new URL(page.url()).searchParams.get('pathNode');expect(id).toBeTruthy();expect(writes).toBe(0);expect((await read()).milestones).toEqual(before.milestones);
  await title.fill('');await title.blur();await expect(title).toHaveAttribute('aria-invalid','true');await closeGraphProperties(page);await graphToolbar(page,'保存修改');await expect(title).toHaveValue('');await expect(title).toHaveAttribute('aria-invalid','true');await expect(title).toBeFocused();expect(writes).toBe(0);
  await title.fill('新项目交付点');await title.blur();await page.setViewportSize({width:390,height:844});await page.screenshot({path:info.outputPath('new-project-milestone-390.png'),animations:'disabled'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/dependency-changes/apply'));await graphToolbar(page,'保存修改');expect((await response).status()).toBe(200);expect(writes).toBe(1);
  const after=await read();expect(after.milestones).toHaveLength((before.milestones?.length||0)+1);expect(after.milestones?.find(m=>m.id===id)).toMatchObject({title:'新项目交付点',requirementId:null});expect(after.dependencies).toEqual(before.dependencies);
  await page.reload();await expect(page.locator('.react-flow__node[data-id="'+id+'"]')).toContainText('新项目交付点');expect((await read()).milestones).toEqual(after.milestones);
});

for(const other of [false,true])test('项目里程碑依赖从项目清单摘要定位 '+(other?'存在其他需求':'仅命名特性'),async({page},info)=>{
  const f=await phaseFixture(page),id=crypto.randomUUID(),read=async()=>(await(await page.request.get(f.base+'/path-graph?view=features')).json()).analysis as PathAnalysis;
  if(other){const response=await page.request.post('/api/requirements',{data:{projectId:f.projectId,title:'不归命名特性的需求',ownerId:f.testing.ownerId}});expect(response.ok(),await response.text()).toBe(true);}
  const initial=await read(),input={expectedRevision:initial.revision,target:'project',changes:{add:[{clientId:crypto.randomUUID(),sourceRequirementId:f.direct.id,sourceWorkItemId:null,targetRequirementId:'',targetMilestoneId:id,targetWorkItemId:null}],remove:[],estimates:[],entities:[{entity:'milestone',op:'create',id,requirementId:null,data:{title:'项目集成评审',confirmationMode:'manual'}}]}};
  const previewResponse=await page.request.post(f.base+'/dependency-changes/preview',{data:input});expect(previewResponse.ok(),await previewResponse.text()).toBe(true);const preview=await previewResponse.json();
  const apply=await page.request.post(f.base+'/dependency-changes/apply',{data:{...input,batchId:crypto.randomUUID(),previewToken:preview.previewToken}});expect(apply.ok(),await apply.text()).toBe(true);
  const before=await read();expect(before.featureContext?.overview.features.some(feature=>feature.kind==='other')).toBe(other);let writes=0;const errors:string[]=[];
  page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/dependency-changes/apply'))writes++;});page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'graph',scopeType:'feature',scopeId:f.feature.id}));await expect(page.locator('[data-layout-ready="true"]')).toBeVisible();await graphToolbar(page,'编辑画布');
  await page.locator('.react-flow__node[data-id="'+f.testing.id+'"] .business-handle[data-side="bottom"]').click();await page.locator('.react-flow__node[data-id="'+id+'"] .dependency-card').click({position:{x:80,y:45}});
  await expect(page.locator('[data-draft-stored="true"]')).toBeVisible();await closeGraphProperties(page);await page.getByRole('button',{name:'上一级',exact:true}).click();await page.getByRole('button',{name:'清单',exact:true}).click();await openGraphDrafts(page);
  await page.locator('.canvas-change-row').filter({hasText:'新增：'+f.testing.title+' → 项目集成评审'}).getByRole('button',{name:'定位',exact:true}).click();
  await expect(page.locator('.canvas-draft-details')).toHaveCount(0);await expect(page.locator('.delivery-condition')).toBeVisible();expect(new URL(page.url()).searchParams.get('scopeType')).toBe('project');
  const source=page.getByRole('combobox',{name:'等待什么完成',exact:true});await expect(source).toBeEnabled();await chooseOption(source,f.testing.workItems[0].id);await expect(selectedValue(source)).toHaveValue(f.testing.workItems[0].id);expect(writes).toBe(0);expect((await read()).dependencies).toEqual(before.dependencies);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:info.outputPath('project-milestone-relation-390.png'),animations:'disabled'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/dependency-changes/apply'));await graphToolbar(page,'保存修改');expect((await response).status()).toBe(200);expect(writes).toBe(1);
  const after=await read(),added=after.dependencies.filter(d=>!before.dependencies.some(old=>old.id===d.id));expect(added).toHaveLength(1);expect(added[0]).toMatchObject({sourceRequirementId:f.testing.id,sourceWorkItemId:f.testing.workItems[0].id,targetMilestoneId:id});expect(after.dependencies.filter(d=>before.dependencies.some(old=>old.id===d.id))).toEqual(before.dependencies);expect(after.milestones).toEqual(before.milestones);expect(after.requirements).toEqual(before.requirements);expect(errors).toEqual([]);
});

