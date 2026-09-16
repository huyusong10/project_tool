import {expect,test,type Page} from '@playwright/test';
import {phaseFixture} from './phase-fixture';
import {chooseOption} from './select-helper';
import type {Requirement} from '../../src/client/types';
const modal=(page:Page)=>page.locator('.modal-card-workspace[role=dialog]');
const detail=async(page:Page,id:string)=>(await(await page.request.get('/api/requirements/'+id)).json()) as Requirement;

test('Phase 新建未知结果保留原提交，交付保护和历史仍可用',async({page})=>{
  const f=await phaseFixture(page),url='/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'list',scopeType:'project',detailId:'feature:'+f.feature.id,detailTab:'children'});
  await page.goto(url);await modal(page).getByRole('button',{name:'新建 Phase',exact:true}).click();
  const form=modal(page).getByRole('region',{name:'新增 Phase',exact:true});
  await form.getByLabel('Phase 名称').fill('Phase 新阶段');await form.getByLabel('交付范围').fill('保留完整交付范围');
  const endpoint='**'+f.base+'/features/'+f.feature.id+'/phases';let writes=0;
  await page.route(endpoint,async route=>{if(route.request().method()!=='POST')return route.continue();writes++;await route.fetch();await route.abort('failed');});
  await form.getByRole('button',{name:'新增 Phase',exact:true}).click();await expect(form.getByRole('button',{name:'读取最新 Phase 并核对'})).toBeVisible();
  await page.reload();await expect(form.getByLabel('Phase 名称')).toHaveValue('Phase 新阶段');await form.getByRole('button',{name:'读取最新 Phase 并核对'}).click();await expect(form).toHaveCount(0);expect(writes).toBe(1);await page.unroute(endpoint);
  await expect(modal(page).getByRole('button',{name:'Phase 新阶段',exact:true})).toBeVisible();
  await modal(page).getByRole('button',{name:'Phase 1',exact:true}).click();
  await modal(page).getByRole('tab',{name:'需求清单',exact:true}).click();await expect(modal(page).getByRole('button',{name:'新建需求',exact:true})).toHaveCount(0);
  await modal(page).getByRole('tab',{name:'记录',exact:true}).click();await expect(modal(page).locator('.object-history-entry')).toContainText('DCIM-001 基础台账');
  await modal(page).getByRole('tab',{name:'概况',exact:true}).click();await modal(page).getByRole('button',{name:'Phase 更多操作',exact:true}).click();await modal(page).getByRole('button',{name:'重新打开',exact:true}).click();
  const reopen=modal(page).getByRole('region',{name:'重新打开 Phase',exact:true});await reopen.getByLabel('变更原因').fill('补充客户反馈');await reopen.getByRole('button',{name:'重新打开 Phase',exact:true}).click();await expect(reopen).toHaveCount(0);await expect(modal(page).getByRole('button',{name:'确认交付',exact:true})).toBeVisible();
});

test('旧需求链接接入弹窗，直接进展和拆分基线保留，工作项可开始完成并重开',async({page})=>{
  const f=await phaseFixture(page);await page.goto('/requirements/'+f.direct.id);
  const root=modal(page);await root.getByRole('button',{name:'更新进度',exact:true}).click();const form=root.getByRole('region',{name:'更新进度',exact:true});await form.getByLabel('需求完成度').fill('30');await form.getByLabel('执行说明').fill('前期完成');await form.getByRole('button',{name:'更新进度',exact:true}).click();await expect(form).toHaveCount(0);expect((await detail(page,f.direct.id)).progress).toBe(30);
  await root.getByRole('tab',{name:/^工作项 /}).click();await root.getByRole('button',{name:'添加工作项',exact:true}).click();const create=root.getByRole('region',{name:'添加工作项',exact:true});await create.getByLabel('新工作项名称',{exact:true}).fill('剩余开发');await create.getByRole('button',{name:'保存工作项',exact:true}).click();await expect(create).toHaveCount(0);
  let current=await detail(page,f.direct.id);expect(current.splitBaseProgress).toBe(30);expect(current.progress).toBe(30);
  const item=current.workItems[0],row=root.locator('[data-work-id="'+item.id+'"]');await row.getByRole('button',{name:'开始',exact:true}).click();
  const assignment=root.getByRole('region',{name:'选择负责人并开始',exact:true});await chooseOption(assignment.getByLabel('工作项负责人',{exact:true}),f.testing.ownerId!);await assignment.getByRole('button',{name:'返回',exact:true}).click();await row.getByRole('button',{name:'开始',exact:true}).click();await expect(assignment.getByLabel('工作项负责人',{exact:true})).toContainText(f.testing.ownerName!);await assignment.getByRole('button',{name:'开始',exact:true}).click();await expect(assignment).toHaveCount(0);
  await expect(row.getByRole('button',{name:'完成',exact:true})).toBeVisible();await row.getByRole('button',{name:'完成',exact:true}).click();await expect(row.getByRole('img',{name:'已完成',exact:true}).first()).toBeVisible();
  current=await detail(page,f.direct.id);expect(current.status).toBe('completed');expect(current.progress).toBe(100);
  await row.getByRole('button',{name:'更多工作项操作',exact:true}).click();await root.getByRole('button',{name:'重开/返工',exact:true}).click();await expect(row.getByRole('button',{name:'完成',exact:true})).toBeVisible();expect((await detail(page,f.direct.id)).status).toBe('in_progress');
});

test('图形草稿属性在同一外壳编辑，关闭刷新不写入正式资料',async({page})=>{
  const f=await phaseFixture(page);await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'graph',scopeType:'requirement',scopeId:f.testing.id}));await expect(page.locator('[data-layout-ready=true]')).toBeVisible();await page.getByRole('button',{name:'编辑画布',exact:true}).click();
  const node=page.locator('.react-flow__node[data-id="'+f.testing.workItems[1].id+'"]');await node.locator('.graph-title').click();const root=modal(page);await expect(root.getByRole('tab',{name:'草稿属性',exact:true})).toBeVisible();await expect(root).toContainText('修改应用到图形草稿');await root.getByLabel('元素名称',{exact:true}).fill('草稿测试名称');await root.getByLabel('元素名称',{exact:true}).blur();
  await root.getByRole('button',{name:'关闭',exact:true}).click();await expect(node.locator('.graph-title')).toContainText('草稿测试名称');expect((await detail(page,f.testing.id)).workItems[1].title).toBe('测试');await page.reload();await expect(node.locator('.graph-title')).toContainText('草稿测试名称');await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('问题详情输入关闭刷新可恢复，网址记录栏目并支持返回',async({page})=>{
  const f=await phaseFixture(page),response=await page.request.post('/api/issues',{data:{projectId:f.projectId,title:'问题输入恢复',priority:'P1',ownerId:f.testing.ownerId}});expect(response.ok()).toBe(true);const issue=await response.json();
  const url='/issues?'+new URLSearchParams({projectId:f.projectId,detailId:issue.id,detailTab:'updates'});await page.goto(url);const root=modal(page),text=root.locator('.issue-update-form textarea').first();await text.fill('暂未提交的处理进展');await root.getByRole('button',{name:'关闭',exact:true}).click();await expect(root).toHaveCount(0);await page.goBack();await expect(text).toHaveValue('暂未提交的处理进展');await page.reload();await expect(text).toHaveValue('暂未提交的处理进展');await root.getByRole('tab',{name:'基本信息',exact:true}).click();expect(new URL(page.url()).searchParams.get('detailTab')).toBe('basic');await page.reload();await expect(root.getByRole('tab',{name:'基本信息',exact:true})).toHaveAttribute('aria-selected','true');
});


test('工作项未知提交保存原文，刷新后先核对，不重复完成',async({page})=>{
  const f=await phaseFixture(page),item=f.testing.workItems[1];await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'list',scopeType:'project',detailId:f.testing.id,detailTab:'work'}));
  const row=modal(page).locator('[data-work-id="'+item.id+'"]');let writes=0;
  await page.route('**/api/work-items/'+item.id+'/complete',async route=>{writes++;await route.fetch();await route.abort('failed');});
  await row.getByRole('button',{name:'完成',exact:true}).click();await expect(row.getByRole('button',{name:'重新读取工作项',exact:true})).toBeVisible();
  const saved=await page.evaluate(id=>Object.entries(sessionStorage).find(([key])=>key.endsWith(id+':action-receipt'))?.[1],item.id);expect(JSON.parse(saved!)).toEqual({action:'complete',expectedVersion:item.version,body:{}});
  await page.reload();await row.getByRole('button',{name:'重新读取工作项',exact:true}).click();await expect(row.getByRole('button',{name:'已核对，结束本次操作',exact:true})).toBeVisible();expect(writes).toBe(1);expect((await detail(page,f.testing.id)).workItems.find(w=>w.id===item.id)?.status).toBe('completed');
  await row.getByRole('button',{name:'已核对，结束本次操作',exact:true}).click();await expect(row.getByRole('button',{name:'更多工作项操作',exact:true})).toBeVisible();expect(await page.evaluate(id=>Object.keys(sessionStorage).some(key=>key.endsWith(id+':action-receipt')),item.id)).toBe(false);expect(writes).toBe(1);
});
