import type {DependencyChanges} from '../../src/shared/path-contracts';
import {randomUUID} from 'node:crypto';
import {expect,test} from '@playwright/test';
import {addBusinessDays,todayIso} from '../../src/shared/domain';
import {phaseFixture} from './phase-fixture';
import {chooseOption} from './select-helper';

test('特性说明对齐，多选和状态浮层不移动表格或工具栏',async({page},info)=>{
  const f=await phaseFixture(page);
  const created=await page.request.post(f.base+'/features',{data:{name:'没有目标的空特性'}});expect(created.ok()).toBe(true);
  await page.goto('/?view=features&mode=table');
  const table=page.locator('.delivery-table');await expect(table).toContainText('没有目标的空特性');
  const offsets=await table.locator('.delivery-feature-name').evaluateAll(nodes=>nodes.map(el=>Math.abs(el.querySelector('.feature-name-button')!.getBoundingClientRect().left-el.nextElementSibling!.getBoundingClientRect().left)));
  expect(offsets.every(n=>n<1)).toBe(true);
  await expect(page.getByLabel('展开 没有目标的空特性',{exact:true})).toHaveCount(0);
  await page.goto('/?'+new URLSearchParams({view:'feature',mode:'table',featureId:f.feature.id}));
  await expect(table).toContainText(f.testing.title);
  const before=await table.boundingBox(),toolbar=page.getByRole('region',{name:'页面工具栏'}),toolsBefore=await toolbar.boundingBox();
  await page.getByRole('checkbox',{name:'选择 '+f.testing.title,exact:true}).check();
  await expect(page.getByRole('button',{name:'批量安排 Phase',exact:true})).toBeVisible();
  expect((await table.boundingBox())!.y).toBe(before!.y);
  await page.getByRole('checkbox',{name:'选择 '+f.direct.title,exact:true}).check();
  expect((await table.boundingBox())!.y).toBe(before!.y);
  await toolbar.getByLabel('草稿状态',{exact:true}).click();
  await expect(page.getByRole('dialog',{name:'状态说明'})).toBeVisible();
  expect(await toolbar.boundingBox()).toEqual(toolsBefore);expect((await table.boundingBox())!.y).toBe(before!.y);
  expect(await toolbar.locator('.page-toolbar-actions').evaluate(el=>getComputedStyle(el).borderLeftStyle)).toBe('solid');
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:'状态说明'})).toBeHidden();
  await page.screenshot({path:info.outputPath('stable-selection.png'),animations:'disabled'});
  await page.setViewportSize({width:390,height:844});await expect(table).toBeVisible();
  const narrowBefore=await table.boundingBox();await page.getByRole('checkbox',{name:'选择 '+f.testing.title,exact:true}).uncheck();
  expect(Math.abs((await table.boundingBox())!.y-narrowBefore!.y)).toBeLessThan(1);await page.screenshot({path:info.outputPath('narrow-selection.png'),animations:'disabled'});
});

test('里程碑恢复，完成文字不遮挡预计虚线，日周月视图均可查看',async({page},info)=>{
  const f=await phaseFixture(page),work=f.testing.workItems[1],today=todayIso(),start=addBusinessDays(today,-5),end=addBusinessDays(today,5);
  const graph=await(await page.request.get(f.base+'/path-analysis')).json(),ids=[randomUUID(),randomUUID(),randomUUID()];
  const input:{expectedRevision:number;target:string;changes:DependencyChanges}={expectedRevision:graph.revision,target:'project',changes:{add:[],remove:[],estimates:[],entities:ids.map((id,i)=>({id,entity:'milestone',op:'create',requirementId:f.testing.id,data:{title:['接口确认','验收确认','待定评审'][i],confirmationMode:'manual',targetDate:i===2?null:addBusinessDays(today,i+1)}}))}};
  input.changes.entities!.push({id:randomUUID(),entity:'milestone',op:'create',requirementId:null,data:{title:'项目联审',confirmationMode:'manual',targetDate:today}});
  const response=await page.request.post(f.base+'/dependency-changes/preview',{data:input});expect(response.ok(),await response.text()).toBe(true);
  const preview=await response.json(),applied=await page.request.post(f.base+'/dependency-changes/apply',{data:{...input,batchId:randomUUID(),previewToken:preview.previewToken}});expect(applied.ok(),await applied.text()).toBe(true);
  const achieved=await page.request.post('/api/milestones/'+ids[0]+'/achieve',{data:{expectedVersion:1}});expect(achieved.ok(),await achieved.text()).toBe(true);
  // A known late work item makes short and long forecast tails reproducible at every zoom.
  await page.route('**/api/dashboard?*',async route=>{const response=await route.fetch(),data=await response.json();const w=data.requirements.find((r:{id:string})=>r.id===f.testing.id).workItems.find((w:{id:string})=>w.id===work.id);Object.assign(w,{actualStart:start,deliveryForecast:{revision:1,asOfDate:today,start:today,end,remainingDays:5,source:'剩余工期',reasons:[]}});await route.fulfill({response,json:data});});
  await page.route('**/path-graph?*',async route=>{const response=await route.fetch(),data=await response.json();Object.assign(data.analysis.nodes.find((n:{id:string})=>n.id===work.id),{plannedStart:start,plannedEnd:addBusinessDays(today,-1)});await route.fulfill({response,json:data});});
  await page.goto('/execution');await chooseOption(page.getByLabel('展开层级',{exact:true}),'work');
  await expect(page.locator('.workspace-gantt-heading .gantt-milestone-label')).toContainText('项目联审');
  const row=page.locator('[data-row-id="'+work.id+'"]'),requirement=page.locator('[data-row-id="'+f.testing.id+'"]');
  await expect(requirement.getByRole('button',{name:'待定日期 1 项'})).toBeVisible();
  for(const zoom of ['日','周','月']){
    await page.getByRole('button',{name:zoom,exact:true}).click();
    await expect(row.locator('.gantt-forecast-tail')).toHaveCount(1);
    const boxes=await row.locator('.gantt-date-progress,.gantt-forecast-tail').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};}));
    expect(boxes[0].top).toBeGreaterThanOrEqual(boxes[1].bottom);
    await expect(requirement.locator('.gantt-milestone-pin')).toHaveCount(2);
    await expect(requirement.locator('[data-milestone-actual]')).toHaveCount(1);
    await page.screenshot({path:info.outputPath('gantt-'+zoom+'.png'),animations:'disabled'});
  }
  await requirement.getByRole('button',{name:'待定日期 1 项'}).click();
  await expect(page.getByRole('dialog',{name:'里程碑详情'})).toContainText('待定评审');
  await page.keyboard.press('Escape');
  await requirement.locator('.gantt-milestone-label').first().click();await expect(page.getByRole('dialog',{name:'里程碑详情'})).toContainText('接口确认');
  await page.keyboard.press('Escape');await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:info.outputPath('narrow-gantt-milestones.png'),animations:'disabled'});
});

test('两个视图的工作项详情信息一致，展开加宽且不重排主区域',async({page},info)=>{
  const f=await phaseFixture(page),work=f.testing.workItems[1];
  await page.goto('/execution');await chooseOption(page.getByLabel('展开层级',{exact:true}),'work');
  const row=page.locator('[data-row-id="'+work.id+'"]'),before=await row.boundingBox();
  await row.locator('.workspace-row-title').click();
  const inspector=page.getByRole('complementary',{name:'对象详情'});await expect(inspector.getByText('协作人',{exact:true})).toBeVisible();
  await expect(inspector.getByText('预计完成',{exact:true})).toBeVisible();
  await expect(inspector.getByRole('button',{name:'工作项设置',exact:true})).toBeVisible();
  const font=await inspector.locator('.object-facts dd').first().evaluate(el=>getComputedStyle(el).fontSize);
  await inspector.getByRole('button',{name:'展开',exact:true}).click();
  const panel=await inspector.boundingBox();expect(panel!.width).toBeGreaterThan(Math.min(900,info.project.use.viewport!.width-300));
  expect(await row.boundingBox()).toEqual(before);await page.screenshot({path:info.outputPath('expanded-work-details.png'),animations:'disabled'});
  await page.goto('/?'+new URLSearchParams({view:'requirement',mode:'graph',featureId:f.feature.id,requirementId:f.testing.id,pathNode:work.id,pathInspector:'open'}));
  const detail=page.locator('.graph-detail').filter({visible:true});await expect(detail.getByText('协作人',{exact:true})).toBeVisible();
  expect(await detail.locator('.object-facts dd').first().evaluate(el=>getComputedStyle(el).fontSize)).toBe(font);
  await detail.getByRole('button',{name:'展开',exact:true}).click();await page.screenshot({path:info.outputPath('expanded-graph-details.png'),animations:'disabled'});
  await page.setViewportSize({width:390,height:844});await expect(detail).toBeVisible();
  const narrow=await detail.boundingBox();expect(narrow!.x).toBe(0);expect(narrow!.width).toBe(390);
  await page.screenshot({path:info.outputPath('narrow-work-details.png'),animations:'disabled'});
});

test('特性资料、评估和 Phase 交付历史在详情中完整可用',async({page},info)=>{
  const f=await phaseFixture(page);
  await page.goto('/?'+new URLSearchParams({view:'features',mode:'table',pathNode:'feature:'+f.feature.id,pathInspector:'open'}));
  const detail=page.locator('.graph-detail').filter({visible:true});
  await detail.getByRole('button',{name:'目标与范围',exact:true}).click();
  await expect(detail.getByRole('link',{name:'MDS',exact:true})).toHaveAttribute('href','https://example.com/asset-mds');
  await expect(detail.getByRole('button',{name:'编辑资料',exact:true})).toBeVisible();
  await detail.getByRole('button',{name:'进展评估',exact:true}).click();
  await expect(detail.getByRole('button',{name:'更新评估',exact:true})).toBeVisible();
  await detail.getByRole('button',{name:'展开',exact:true}).click();
  await page.screenshot({path:info.outputPath('feature-assessment.png'),animations:'disabled'});
  await page.goto('/?'+new URLSearchParams({view:'features',mode:'table',pathNode:'feature:'+f.feature.id,phaseId:f.phases[0].id,pathInspector:'open'}));
  await expect(detail.getByRole('button',{name:'重新打开',exact:true})).toBeVisible();
  await detail.locator('summary').filter({hasText:'交付历史'}).click();
  await expect(detail.locator('.object-history-entry')).toContainText('DCIM-001 基础台账');
  await detail.getByRole('button',{name:'展开',exact:true}).click();
  await page.screenshot({path:info.outputPath('phase-delivery-history.png'),animations:'disabled'});
});
