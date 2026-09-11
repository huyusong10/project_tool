import {expect,test} from '@playwright/test';
import {mockGanttData,requirement,workItem} from './gantt-fixture';

for(const mode of ['direct','split'] as const){
 test(`${mode}需求趋势使用公共计划进度`,async({page})=>{
  await mockGanttData(page);
  const date=mode==='direct'?'2026-09-09':'2026-09-03';
  await page.route('**/api/requirements/r1',route=>route.fulfill({json:{
   ...requirement,executionMode:mode==='direct'?'direct':'work_items',progress:60,asOfDate:date,
   splitBaseProgress:mode==='split'?30:0,splitAt:mode==='split'?'2026-09-01T01:00:00Z':null,
   workItems:mode==='direct'?[]:[{...workItem,plannedEnd:'2026-09-04'}],
   progressUpdates:[{id:'record',percent:60,eventType:'progress',content:'执行记录',createdAt:date+'T01:00:00Z',updatedAt:date+'T01:00:00Z'}],
  }}));
  await page.goto('/requirements/r1');
  const chart=page.getByRole('img',{name:'需求计划与实际进度趋势',exact:true});await chart.scrollIntoViewIfNeeded();await expect(chart.locator('canvas')).toBeVisible();
  const box=(await chart.boundingBox())!;await chart.hover({position:{x:box.width/2,y:130}});
  await expect(chart).toContainText(new RegExp('计划进度\\s*'+(mode==='direct'?'88':'83')));
 });
}

test('开始冲突后重新读取需求并使用新版本重试',async({page})=>{
 await mockGanttData(page);const writes:Array<Record<string,unknown>>=[];
 let current={...requirement,executionMode:'direct',status:'not_started',progress:0,version:1,workItems:[]};
 await page.route('**/api/requirements/r1',route=>route.fulfill({json:current}));
 await page.route('**/api/requirements/r1/start',route=>{
  const body=route.request().postDataJSON();writes.push(body);
  if(writes.length===1){current={...current,version:2};return route.fulfill({status:409,json:{error:'需求已经变化，请重新核对',code:'STALE_WRITE'}});}
  current={...current,status:'in_progress',version:3};return route.fulfill({json:current});
 });
 await page.goto('/requirements/r1');await page.getByRole('button',{name:'开始需求',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'开始需求',exact:true});await dialog.getByRole('button',{name:'开始需求',exact:true}).click();await dialog.getByRole('button',{name:'读取最新状态',exact:true}).click();
 await dialog.getByRole('button',{name:'开始需求',exact:true}).click();await expect(dialog).toHaveCount(0);expect(writes.map(w=>w.expectedVersion)).toEqual([1,2]);
});
test('开始窗口不再读取或确认前置条件',async({page})=>{
 await mockGanttData(page);let conditionReads=0;
 await page.route('**/api/requirements/r1',route=>route.fulfill({json:{...requirement,executionMode:'direct',status:'not_started',version:1,workItems:[]}}));
 await page.route('**/api/requirements/r1/start-conditions',route=>{conditionReads++;return route.fulfill({json:{dependencyRevision:1,unmetPredecessors:[]}});});
 await page.goto('/requirements/r1');await page.getByRole('button',{name:'开始需求',exact:true}).click();const dialog=page.getByRole('dialog',{name:'开始需求'});
 await expect(dialog).toBeVisible();await expect(dialog.getByText(/前置/)).toHaveCount(0);expect(conditionReads).toBe(0);
});
test('存在同对象执行敏感草稿时实际日期更正不请求接口，处理草稿后可继续原输入',async({page})=>{
 await mockGanttData(page);let current={...workItem};const writes:Array<Record<string,unknown>>=[];
 await page.route('**/api/requirements/r1',route=>route.fulfill({json:{...requirement,version:1,workItems:[current]}}));
 await page.route('**/api/work-items/w1/correct',route=>{const body=route.request().postDataJSON();writes.push(body);current={...current,...body,version:current.version+1};return route.fulfill({json:current});});
 await page.goto('/requirements/r1');await expect(page.locator('.requirement-overview')).toBeVisible();
 await page.evaluate(()=>sessionStorage.setItem('pm-graph-draft:admin:p1',JSON.stringify({formatVersion:2,version:'1',index:0,active:true,layouts:{},fields:{},values:[{add:[],remove:[],estimates:[],entities:[{entity:'requirement',id:'r1',op:'update',expectedVersion:1,data:{durationDays:3}}]}]})));
 await page.getByRole('button',{name:'更多工作项操作',exact:true}).first().click();await page.getByRole('button',{name:'受控修正实际日期',exact:true}).click();
 await page.getByLabel('实际开始',{exact:true}).fill('2026-08-31');await page.getByLabel('纠错原因',{exact:true}).fill('核对执行日期');await page.getByRole('button',{name:'保存纠错',exact:true}).click();
 await expect(page.getByText(/本次操作涉及未保存业务草稿/)).toBeVisible();expect(writes).toHaveLength(0);await expect(page.getByLabel('实际开始',{exact:true})).toHaveValue('2026-08-31');
 await page.evaluate(()=>sessionStorage.removeItem('pm-graph-draft:admin:p1'));await page.getByRole('button',{name:'保存纠错',exact:true}).click();
 await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toMatchObject({actualStart:'2026-08-31',reason:'核对执行日期',expectedVersion:1});
});

test('工作完成后不显示验收入口，完成标准仍作为资料保留',async({page})=>{
 await mockGanttData(page);
 await page.route('**/api/requirements/r1',route=>route.fulfill({json:{...requirement,executionMode:'direct',version:1,status:'completed',progress:100,acceptedAt:null,acceptanceCriteria:'确认接口与文档交付',workItems:[]}}));
 await page.goto('/requirements/r1');await expect(page.getByRole('button',{name:'确认验收',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'需求资料与计算说明',exact:true}).click();await expect(page.locator('.requirement-overview-details')).toContainText('确认接口与文档交付');
});

for(const persisted of [true,false]){
 test(`直接进度响应丢失且${persisted?'版本变化时禁止直接重复提交':'版本未变时可安全重试'}`,async({page})=>{
  await mockGanttData(page);let writes=0;
  let current={...requirement,executionMode:'direct',status:'in_progress',version:1,progress:30,workItems:[]};
  await page.route('**/api/requirements/r1',route=>route.fulfill({json:current}));
  await page.route('**/api/requirements/r1/progress',route=>{
   writes++;
   if(writes===1){if(persisted)current={...current,progress:60,version:2};return route.abort('failed');}
   current={...current,progress:60,version:2};return route.fulfill({json:current});
  });
  await page.goto('/requirements/r1');await page.getByRole('button',{name:'更新进度',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'更新进度',exact:true}),submit=dialog.getByRole('button',{name:'更新进度',exact:true});
  await dialog.getByLabel('需求完成度').fill('60');await dialog.getByLabel('执行说明').fill('接口已联通');await submit.click();
  await dialog.getByRole('button',{name:'读取最新状态',exact:true}).click();
  if(persisted){
   await expect(dialog).toContainText('请先核对进展记录');await expect(submit).toBeDisabled();
   await expect(dialog.getByLabel('执行说明')).toHaveValue('接口已联通');expect(writes).toBe(1);
  }else{await expect(submit).toBeEnabled();await submit.click();await expect(dialog).toHaveCount(0);expect(writes).toBe(2);}
 });
}

test('直接进度响应未知且回读失败时跨导航保留核对锁和原输入',async({page})=>{
 await mockGanttData(page);let writes=0,failReads=false;
 let current={...requirement,executionMode:'direct',status:'in_progress',version:1,progress:30,workItems:[]};
 await page.route('**/api/requirements/r1',route=>failReads
  ?route.fulfill({status:503,json:{error:'需求读取失败'}})
  :route.fulfill({json:current}));
 await page.route('**/api/requirements/r1/progress',route=>{
  writes++;current={...current,progress:60,version:2};failReads=true;return route.abort('failed');
 });
 await page.goto('/requirements/r1');await page.getByRole('button',{name:'更新进度',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'更新进度',exact:true});
 await dialog.getByLabel('需求完成度').fill('60');await dialog.getByLabel('执行说明').fill('接口已联通');
 await dialog.getByRole('button',{name:'更新进度',exact:true}).click();
 await expect(dialog).toContainText('本次操作需要核对最新状态');
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
 await expect(page.getByRole('button',{name:'核对操作结果',exact:true})).toBeVisible();

 await page.getByRole('link',{name:'项目中心',exact:true}).click();await expect(page).toHaveURL(/\/projects$/);
 await page.goBack();await expect(page).toHaveURL(/\/requirements\/r1/);
 await page.getByRole('button',{name:'核对操作结果',exact:true}).click();
 await expect(dialog.getByLabel('需求完成度')).toHaveValue('60');
 await expect(dialog.getByLabel('执行说明')).toHaveValue('接口已联通');
 await dialog.locator('form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 await page.waitForTimeout(100);expect(writes).toBe(1);

 failReads=false;await dialog.getByRole('button',{name:'读取最新状态',exact:true}).click();
 await expect(dialog).toContainText('请先核对进展记录');
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
 await page.getByRole('button',{name:'核对操作结果',exact:true}).click();
 await expect(dialog).toContainText('请先核对进展记录');
 await expect(dialog.getByLabel('执行说明')).toHaveValue('接口已联通');
 await dialog.getByRole('button',{name:'已核对并关闭',exact:true}).click();
 await expect(dialog).toHaveCount(0);expect(writes).toBe(1);
});

test('直接执行在同一帧收到两次提交只写一次',async({page})=>{
 await mockGanttData(page);let writes=0;
 await page.route('**/api/requirements/r1',route=>route.fulfill({json:{...requirement,executionMode:'direct',status:'in_progress',version:1,progress:30,workItems:[]}}));
 await page.route('**/api/requirements/r1/progress',route=>{writes++;return route.fulfill({json:{ok:true}});});
 await page.goto('/requirements/r1');await page.getByRole('button',{name:'更新进度',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'更新进度',exact:true});await dialog.getByLabel('执行说明').fill('只记录一次');
 await dialog.locator('form').evaluate(form=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
 await expect(dialog).toHaveCount(0);expect(writes).toBe(1);
});

test('重新读取后直接执行状态不再允许原操作时保留说明并禁用提交',async({page})=>{
 await mockGanttData(page);let writes=0;
 let current={...requirement,executionMode:'direct',status:'in_progress',version:1,progress:30,workItems:[]};
 await page.route('**/api/requirements/r1',route=>route.fulfill({json:current}));
 await page.route('**/api/requirements/r1/progress',route=>{writes++;current={...current,status:'completed',progress:100,version:2};return route.fulfill({status:409,json:{error:'需求已更新',code:'STALE_WRITE'}});});
 await page.goto('/requirements/r1');await page.getByRole('button',{name:'更新进度',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'更新进度',exact:true}),submit=dialog.getByRole('button',{name:'更新进度',exact:true});
 await dialog.getByLabel('执行说明').fill('等待核对');await submit.click();await dialog.getByRole('button',{name:'读取最新状态',exact:true}).click();
 await expect(dialog).toContainText('当前状态不支持此操作');await expect(submit).toBeDisabled();await expect(dialog.getByLabel('执行说明')).toHaveValue('等待核对');expect(writes).toBe(1);
});
