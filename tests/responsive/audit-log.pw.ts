import { expect, test } from '@playwright/test';
import { chooseOption } from './select-helper';
import { mockGanttData } from './gantt-fixture';

test('取消工作日志可读并进入保留历史，无历史的删除不提供失效链接',async({page})=>{
  const post=async(url:string,data:object)=>{const response=await page.request.post(url,{data});expect(response.ok(),await response.text()).toBe(true);return response.json();};
  await post('/api/login',{username:'admin',password:'41_xc7q0qOjo4Inw!'});
  const project=await post('/api/projects',{name:'移除追溯 '+Date.now()}),base='/api/projects/'+project.id;
  let requirement=await post('/api/requirements',{projectId:project.id,title:'保留核心接口交付'});
  const read=async()=>(await(await page.request.get('/api/requirements/'+requirement.id)).json());
  const works=[];
  for(const title of ['接口设计','旧渠道核验','发布准备','空工作']){
    works.push(await post('/api/requirements/'+requirement.id+'/work-items',{expectedVersion:requirement.version,title}));requirement=await read();
  }
  for(const [source,target] of [[works[0],works[1]],[works[1],works[2]]]){
    const analysis=await(await page.request.get(base+'/path-analysis')).json();
    await post(base+'/dependencies',{expectedRevision:analysis.revision,sourceRequirementId:requirement.id,sourceWorkItemId:source.id,targetRequirementId:requirement.id,targetWorkItemId:target.id});
  }
  const work=await(await page.request.get('/api/work-items/'+works[1].id)).json();
  await post('/api/work-items/'+work.id+'/cancel',{expectedVersion:work.version,expectedDependencyRevision:work.cancellationImpact.revision,reason:'审计取消复查：旧渠道停止交付'});
  const empty=await(await page.request.get('/api/work-items/'+works[3].id)).json();
  const deleted=await page.request.delete('/api/work-items/'+empty.id,{data:{expectedVersion:empty.version}});expect(deleted.ok(),await deleted.text()).toBe(true);
  const before=await read(),query='/api/audit/search?'+new URLSearchParams({projectId:project.id,q:'审计取消复查'});
  const audit=await(await page.request.get(query)).json(),original=audit.items[0].summary;
  expect(audit.items[0]).toMatchObject({workItemDeleted:true,workItemRequirementId:requirement.id});
  for(const path of ['/logs','/project-logs?projectId='+project.id]){
    await page.goto(path);await page.getByRole('searchbox').fill('审计取消复查');
    const row=page.locator('.audit-row').filter({hasText:'审计取消复查'}),summary=row.locator('.audit-content > summary');
    await expect(summary).toHaveText('旧渠道核验：工作项已移除；取消原因：审计取消复查：旧渠道停止交付；已解除 2 条依赖');
    await summary.click();await row.getByText('原始记录',{exact:true}).click();await expect(row.locator('pre')).toHaveText(original);
    const source=page.url();await row.getByRole('link',{name:'查看需求历史',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:requirement.title,exact:true});await expect(dialog.getByRole('tab',{name:'记录',exact:true})).toHaveAttribute('aria-selected','true');
    await expect(dialog).toContainText('取消工作项：旧渠道核验');await expect(dialog).toContainText('审计取消复查：旧渠道停止交付');
    await page.reload();await expect(dialog).toContainText('取消工作项：旧渠道核验');
    await dialog.getByRole('tab',{name:'工作项 2',exact:true}).click();await expect(dialog).toContainText('接口设计');await expect(dialog).toContainText('发布准备');
    await page.goBack();await expect(page.getByRole('searchbox')).toHaveValue('审计取消复查');expect(new URL(page.url()).searchParams.get('snapshot')).toBe(new URL(source).searchParams.get('snapshot'));
    await page.reload();await expect(summary).toContainText('已解除 2 条依赖');
    await page.getByRole('searchbox').fill('空工作');
    const removedRow=page.locator('.audit-row').filter({hasText:'空工作：工作项已移除'});await removedRow.locator('.audit-content > summary').click();
    await expect(removedRow).toContainText('未找到保留的执行历史');await expect(removedRow.getByRole('link')).toHaveCount(0);
  }
  expect(await read()).toEqual(before);expect((await(await page.request.get(query)).json()).items).toEqual(audit.items);
});

test('批量导入日志记录新增和更新，归属使用当时名称并保留原文',async({page})=>{
  const post=async(url:string,data:unknown)=>{const response=await page.request.post(url,{data});expect(response.ok(),await response.text()).toBe(true);return response.json();};
  await post('/api/login',{username:'admin',password:'41_xc7q0qOjo4Inw!'});
  const project=await post('/api/projects',{name:'批量追溯 '+Date.now()}),base='/api/projects/'+project.id;
  const requirement=await post('/api/requirements',{projectId:project.id,title:'原有材料核对'});
  const preview=await post(base+'/requirement-import/preview',{package:{formatVersion:3,requirements:[
    {key:'existing',action:'update',existingId:requirement.id,expectedVersion:requirement.version,title:requirement.title,feature:'发布资料',phase:'交付复核',reason:'审计导入复查：统一评审范围'},
    {key:'new',title:'新增交付索引'}, {key:'skip',title:'不在本批范围',action:'skip'},
  ]}});expect(preview.errors).toEqual([]);
  const input={package:preview.package,previewToken:preview.previewToken,expectedRevision:preview.expectedRevision,batchId:crypto.randomUUID()};
  const receipt=await post(base+'/requirement-import/apply',input);expect((await post(base+'/requirement-import/apply',input))).toEqual(receipt);
  const query='/api/audit/search?'+new URLSearchParams({projectId:project.id,q:'导入'}),audit=await(await page.request.get(query)).json();
  expect(audit.items.filter((row:{action:string})=>row.action==='import')).toHaveLength(1);
  expect(audit.items.find((row:{action:string})=>row.action==='import').summary).toBe('导入需求：新增 1 个，更新 1 个，新增工作项 0 个');
  const original=audit.items.find((row:{entityId:string;summary:string})=>row.entityId===requirement.id&&row.summary.startsWith('导入调整归属：')).summary;
  const features=await(await page.request.get(base+'/features')).json(),feature=features.find((f:{name:string})=>f.name==='发布资料');
  await post(base+'/features',{id:feature.id,expectedVersion:feature.version,name:'当前发布资料'});
  const before=await(await page.request.get('/api/requirements/'+requirement.id)).json();
  for(const path of ['/logs','/project-logs?projectId='+project.id]){
    await page.goto(path);await page.getByRole('searchbox').fill('审计导入复查');
    const row=page.locator('.audit-row').filter({hasText:'导入调整归属：原有材料核对'}),summary=row.locator('.audit-content > summary');
    await expect(summary).toHaveText('导入调整归属：原有材料核对；所属特性：其他需求 → 发布资料；所属Phase：未设置 → 交付复核；安排原因：审计导入复查：统一评审范围');
    await summary.click();await row.getByText('原始记录',{exact:true}).click();await expect(row.locator('pre')).toHaveText(original);
    const source=page.url();await row.getByRole('link',{name:'查看当前对象',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:requirement.title,exact:true});await expect(dialog).toContainText('当前发布资料');await expect(dialog).toContainText('交付复核');
    await page.goBack();await expect(page.getByRole('searchbox')).toHaveValue('审计导入复查');expect(new URL(page.url()).searchParams.get('snapshot')).toBe(new URL(source).searchParams.get('snapshot'));
    await page.reload();await expect(summary).toContainText('其他需求 → 发布资料');
    await summary.click();await row.getByText('原始记录',{exact:true}).click();
    for(const width of [777,390]){
      await page.setViewportSize({width,height:844});
      expect(await row.locator('.audit-content').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
      expect(await page.locator('.audit-table').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
      expect((await row.locator('.audit-content').boundingBox())!.width).toBeGreaterThan((await row.boundingBox())!.width-2);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    }
    await page.setViewportSize({width:1280,height:800});
  }
  expect(await(await page.request.get('/api/requirements/'+requirement.id)).json()).toEqual(before);
  expect((await(await page.request.get(query)).json()).items).toEqual(audit.items);
});

test('特性评估日志显示业务变化、保留原文并可回到当前评估',async({page})=>{
  const post=async(url:string,data:unknown)=>{const response=await page.request.post(url,{data});expect(response.ok(),await response.text()).toBe(true);return response.json();};
  await post('/api/login',{username:'admin',password:'41_xc7q0qOjo4Inw!'});
  const project=await post('/api/projects',{name:'评估追溯 '+Date.now()}),base='/api/projects/'+project.id;
  const created=await post(base+'/features',{name:'上线说明',description:'保留原计划与执行分工'}),feature=created.features.find((f:{name:string})=>f.name==='上线说明');
  await post(base+'/features',{id:feature.id,expectedVersion:feature.version,name:feature.name,overview:{expectation:'读者理解版本差异',progressSummary:'已有发布清单',assessment:'off_track',note:'审计评估复查：仍需核对使用限制'}});
  const before=await(await page.request.get(base+'/features')).json();
  const audit=await(await page.request.get('/api/audit/search?'+new URLSearchParams({projectId:project.id,q:'审计评估复查'}))).json();
  expect(audit.total).toBe(1);const original=audit.items[0].summary;
  for(const path of ['/logs','/project-logs?projectId='+project.id]){
    await page.goto(path);await page.getByRole('searchbox').fill('审计评估复查');
    const row=page.locator('.audit-row').filter({hasText:'审计评估复查'}),summary=row.locator('.audit-content > summary');
    await expect(row).toHaveCount(1);await expect(summary).toContainText('修改特性：上线说明；判断：待评估 → 有偏差');
    await expect(summary).not.toContainText('projectId');await summary.click();
    await expect(row.locator('.audit-content > p').last()).toContainText('原因或变化说明：未填写 → 审计评估复查：仍需核对使用限制');
    await row.getByText('原始记录',{exact:true}).click();await expect(row.locator('pre')).toHaveText(original);
    const source=page.url();await row.getByRole('link',{name:'查看当前对象',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'上线说明',exact:true});await expect(dialog).toContainText('有偏差');await expect(dialog).toContainText('仍需核对使用限制');
    await page.goBack();await expect(page.getByRole('searchbox')).toHaveValue('审计评估复查');
    expect(new URL(page.url()).searchParams.get('snapshot')).toBe(new URL(source).searchParams.get('snapshot'));
    await page.reload();await expect(summary).toContainText('判断：待评估 → 有偏差');
    await page.setViewportSize({width:390,height:844});await summary.click();await expect(row.getByRole('link',{name:'查看当前对象',exact:true})).toBeVisible();
    expect(await row.locator('.audit-content').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.setViewportSize({width:1280,height:800});
  }
  expect(await(await page.request.get(base+'/features')).json()).toEqual(before);
  expect((await(await page.request.get('/api/audit/search?'+new URLSearchParams({projectId:project.id,q:'审计评估复查'}))).json()).items).toEqual(audit.items);
});

test('审计交接记录可读并直达当前工作，返回保留筛选和原始记录',async({page})=>{
  const post=async(url:string,data:unknown)=>{const response=await page.request.post(url,{data});expect(response.ok(),await response.text()).toBe(true);return response.json();};
  await post('/api/login',{username:'admin',password:'41_xc7q0qOjo4Inw!'});
  const project=await post('/api/projects',{name:'审计交接 '+Date.now()});
  const previous=await post('/api/people',{projectId:project.id,name:'审计原负责人'+Date.now()}),next=await post('/api/people',{projectId:project.id,name:'审计接手人'+Date.now()});
  const template=await post('/api/templates',{projectId:project.id,name:'审计流程',items:[{title:'核对交接资料',startOffsetDays:0,durationDays:1,sortOrder:0}]});
  const requirement=await post('/api/requirements',{projectId:project.id,title:'审计目标需求',templateId:template.id});
  const work=requirement.workItems[0];
  for(const ownerId of [previous.id,next.id]){
    const current=await(await page.request.get('/api/requirements/'+requirement.id)).json();
    const response=await page.request.patch('/api/work-items/'+work.id,{data:{expectedVersion:current.workItems[0].version,ownerId}});expect(response.ok(),await response.text()).toBe(true);
  }
  const before=await(await page.request.get('/api/requirements/'+requirement.id)).json();
  const logs=await(await page.request.get('/api/audit/search?entityType=work_item&action=update&q='+encodeURIComponent(next.name))).json();
  const original=logs.items.find((item:{entityId:string})=>item.entityId===work.id).summary;
  for(const path of ['/logs','/project-logs?projectId='+project.id]){
    await page.goto(path);
    await page.getByRole('searchbox').fill(next.name);
    const row=page.locator('.audit-row').filter({hasText:'负责人：'+previous.name+' → '+next.name});
    await expect(row).toHaveCount(1);
    await expect(row.locator('.audit-content > summary')).toHaveText('核对交接资料：负责人：'+previous.name+' → '+next.name);
    await row.locator('.audit-content > summary').click();
    await row.getByText('原始记录',{exact:true}).click();
    await expect(row.locator('pre')).toHaveText(original);
    const source=page.url();
    await row.getByRole('link',{name:'查看当前对象',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'核对交接资料',exact:true});await expect(dialog).toBeVisible();
    await dialog.getByRole('tab',{name:'资料',exact:true}).click();await expect(dialog).toContainText(next.name);
    await page.goBack();await expect(page.getByRole('searchbox')).toHaveValue(next.name);
    expect(new URL(page.url()).searchParams.get('snapshot')).toBe(new URL(source).searchParams.get('snapshot'));
    await page.reload();await expect(row).toHaveCount(1);
    await row.locator('.audit-content > summary').click();
    await expect(row.getByRole('link',{name:'查看当前对象',exact:true})).toBeVisible();
  }
  const after=await(await page.request.get('/api/requirements/'+requirement.id)).json();
  expect(after.workItems).toEqual(before.workItems);expect(after.progressUpdates).toEqual(before.progressUpdates);
});

test('项目日志可以筛选已删除 Phase，并展开长操作内容', async ({ page }, info) => {
  async function post(url: string, data: unknown) {
    const response = await page.request.post(url, { data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  await post('/api/login', { username: 'admin', password: '41_xc7q0qOjo4Inw!' });
  const project = await post('/api/projects', { name: '操作追溯 ' + Date.now() });
  const base = '/api/projects/' + project.id;
  const features = await post(base + '/features', { name: '资产管理' });
  const scope = '必须保留的交付说明。'.repeat(60) + 'https://example.com/' + 'a'.repeat(400) + '尾部验收材料';
  const phase = await post(base + '/features/' + features.features[0].id + '/phases', { name: '日志追溯 Phase', scope });
  const query='/api/audit/search?'+new URLSearchParams({projectId:project.id,entityType:'feature_phase'});
  const currentAudit=await(await page.request.get(query)).json();expect(currentAudit.items[0]).toMatchObject({entityId:phase.id,objectDeleted:false});
  const removed = await page.request.delete(base + '/feature-phases/' + phase.id, { data: { expectedVersion: phase.version, reason: '删除未安排的空阶段' } });
  expect(removed.ok(), await removed.text()).toBe(true);
  const removedAudit=await(await page.request.get(query)).json();expect(removedAudit.items).toHaveLength(2);
  expect(removedAudit.items.every((item:{objectDeleted:boolean})=>item.objectDeleted)).toBe(true);
  expect(removedAudit.items.find((item:{action:string})=>item.action==='create').summary).toBe(currentAudit.items[0].summary);
  await page.goto('/project-logs?projectId=' + project.id);
  for (const name of ['日志来源', '日志动作', '日志对象']) await expect(page.getByRole('combobox', { name, exact: true })).toBeVisible();
  await chooseOption(page.getByRole('combobox', { name: '日志对象', exact: true }), 'feature_phase');
  const rows = page.locator('.audit-table > div:not(.audit-head):not(.empty-state)');
  await expect(rows).toHaveCount(2);
  const created = rows.filter({ hasText: '尾部验收材料' });
  await expect(created).toHaveCount(1);
  await expect(created.locator('span').nth(2)).toHaveText('Phase');
  const details = created.locator('details');
  const compactHeight = (await created.boundingBox())!.height;
  await details.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(details).toHaveAttribute('open', '');
  await expect(details.locator('p').first()).toContainText('尾部验收材料');
  expect((await created.boundingBox())!.height).toBeGreaterThan(compactHeight);
  expect(await details.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('expanded-log.png'), animations: 'disabled' });
  await details.locator('summary').click();
  await expect(details).not.toHaveAttribute('open', '');
  await expect.poll(async () => (await created.boundingBox())!.height).toBe(compactHeight);
  await page.setViewportSize({ width: 390, height: 844 });
  await details.locator('summary').click();
  await expect(details.locator('p').first()).toContainText(scope);
  expect(await details.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('narrow-expanded-log.png'), animations: 'disabled' });
  await expect(details.getByRole('link',{name:'查看当前对象',exact:true})).toHaveCount(0);
  await expect(details).toContainText('Phase 已删除，操作记录仍保留。');
  await page.reload();await expect(page.getByRole('combobox',{name:'日志对象',exact:true})).toContainText('Phase');
  await expect(created).toHaveCount(1);
  await created.locator('summary').click();await expect(created).toContainText('Phase 已删除，操作记录仍保留。');
  await page.goto('/logs');await page.getByRole('searchbox').fill(phase.id);
  const platformRows=page.locator('.audit-row');await expect(platformRows).toHaveCount(2);
  for(const row of await platformRows.all()){
    await row.locator('.audit-content > summary').click();
    await expect(row.getByRole('link',{name:'查看当前对象',exact:true})).toHaveCount(0);
    await expect(row).toContainText('Phase 已删除，操作记录仍保留。');
  }
  await page.screenshot({path:info.outputPath('removed-phase-audit.png'),animations:'disabled'});
  expect((await(await page.request.get(query)).json()).items).toEqual(removedAudit.items);
});

test.describe('日志筛选与显示的业务时区', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  test('浏览器在其他时区时，选定日期内的记录仍显示北京时间', async ({ page }) => {
    await mockGanttData(page);
    await page.route('**/api/audit/search?*', route => route.fulfill({ json: {
      items: [{ id: 'local-day', createdAt: '2026-09-16T16:15:00.000Z', actorType: 'user', actorName: '管理员', action: 'update', entityType: 'requirement', summary: '北京时间9月17日凌晨的修改' }],
      total: 1, page: 1, pageSize: 50, pages: 1, snapshot: 1,
    } }));
    await page.goto('/logs?from=2026-09-17&to=2026-09-17');
    for (const name of ['日志来源', '日志动作', '日志对象']) await expect(page.getByRole('combobox', { name, exact: true })).toBeVisible();
    const row = page.locator('.audit-table > div').filter({ hasText: '北京时间9月17日凌晨的修改' });
    await expect(row.locator('span').first()).toHaveText('2026/9/17 00:15:00');
    await expect(page.locator('.audit-head')).toContainText('北京时间');
  });
});
