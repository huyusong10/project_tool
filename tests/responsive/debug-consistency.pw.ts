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

test('阻塞直接需求只显示说明入口，不能编辑百分比',async({page})=>{
 await mockGanttData(page);
 await page.route('**/api/requirements/r1',route=>route.fulfill({json:{...requirement,executionMode:'direct',status:'blocked',workItems:[],progress:60}}));
 await page.goto('/requirements/r1');
 await expect(page.getByRole('button',{name:'更新进度',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'补充说明',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'补充说明',exact:true});await expect(dialog.getByLabel('需求完成度')).toHaveCount(0);
 await expect(dialog).toContainText('解除阻塞后才能继续提高完成度');
});

test('开始冲突后重新核对需求和前置',async({page})=>{
 await mockGanttData(page);let reads=0;const writes:Array<Record<string,unknown>>=[];
 let current={...requirement,executionMode:'direct',status:'not_started',progress:0,version:1,workItems:[]};
 await page.route('**/api/requirements/r1',route=>route.fulfill({json:current}));
 await page.route('**/api/requirements/r1/start-conditions',route=>{reads++;return route.fulfill({json:{dependencyRevision:reads,unmetPredecessors:[{id:'dep'+reads,title:'前置交付'+reads}]}});});
 await page.route('**/api/requirements/r1/start',route=>{
  const body=route.request().postDataJSON();writes.push(body);
  if(writes.length===1)return route.fulfill({status:409,json:{error:'前置条件已经变化，请重新核对',code:'STALE_WRITE'}});
  current={...current,status:'in_progress',version:2};return route.fulfill({json:current});
 });
 await page.goto('/requirements/r1');await page.getByRole('button',{name:'开始需求',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'开始需求',exact:true});await expect(dialog).toContainText('前置交付1');
 await dialog.getByRole('button',{name:'确认可以开始',exact:true}).click();await dialog.getByRole('button',{name:'读取最新状态',exact:true}).click();
 await expect(dialog).toContainText('前置交付2');await dialog.getByRole('button',{name:'确认可以开始',exact:true}).click();
 await expect(dialog).toHaveCount(0);expect(writes.map(w=>w.expectedDependencyRevision)).toEqual([1,2]);
});

test('关闭开始窗口后，迟到的前置读取不覆盖重新打开的窗口',async({page})=>{
 await mockGanttData(page);let reads=0;let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/requirements/r1',route=>route.fulfill({json:{...requirement,executionMode:'direct',status:'not_started',version:1,workItems:[]}}));
 await page.route('**/api/requirements/r1/start-conditions',async route=>{
  const revision=++reads;if(revision===1)await pending;
  return route.fulfill({json:{dependencyRevision:revision,unmetPredecessors:[{id:'d'+revision,title:'前置交付'+revision}]}});
 });
 try{
  await page.goto('/requirements/r1');await page.getByRole('button',{name:'开始需求',exact:true}).click();await expect.poll(()=>reads).toBe(1);
  await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'开始需求',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog).toContainText('前置交付2');
  const late=page.waitForResponse(response=>response.url().endsWith('/start-conditions')&&response.status()===200);release();await late;
  await expect(dialog).toContainText('前置交付2');await expect(dialog).not.toContainText('前置交付1');
 }finally{release();}
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

for(const entry of ['overview','menu'] as const){
 test(`${entry}验收入口展示同一核对材料和说明字段`,async({page})=>{
  await mockGanttData(page);
  await page.route('**/api/requirements/r1',route=>route.fulfill({json:{...requirement,version:1,status:'pending_acceptance',progress:100,acceptanceCriteria:'确认接口与文档交付',issueSummary:{active:2,overdue:0},milestones:[{id:'m1',title:'发布核对',achievedAt:null,cancelled:false}]}}));
  await page.goto('/requirements/r1');
  if(entry==='menu')await page.getByRole('button',{name:'需求操作',exact:true}).click();
  await (entry==='menu'?page.locator('.action-menu'):page.locator('.requirement-overview')).getByRole('button',{name:'确认验收',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'确认验收',exact:true});await expect(dialog).toContainText('确认接口与文档交付');await expect(dialog).toContainText('发布核对');await expect(dialog).toContainText('未关闭问题：2');
  await expect(dialog.getByLabel('验收说明',{exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'确认验收',exact:true})).toBeDisabled();
 });
}

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
 await page.route('**/api/requirements/r1/progress',route=>{writes++;current={...current,status:'blocked',version:2};return route.fulfill({status:409,json:{error:'需求已更新',code:'STALE_WRITE'}});});
 await page.goto('/requirements/r1');await page.getByRole('button',{name:'更新进度',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'更新进度',exact:true}),submit=dialog.getByRole('button',{name:'更新进度',exact:true});
 await dialog.getByLabel('执行说明').fill('等待核对');await submit.click();await dialog.getByRole('button',{name:'读取最新状态',exact:true}).click();
 await expect(dialog).toContainText('当前状态不支持此操作');await expect(submit).toBeDisabled();await expect(dialog.getByLabel('执行说明')).toHaveValue('等待核对');expect(writes).toBe(1);
});

test('说明响应丢失后版本未变也不推断失败或重复写入',async({page})=>{
 await mockGanttData(page);let writes=0;
 await page.route('**/api/requirements/r1',route=>route.fulfill({json:{...requirement,executionMode:'direct',status:'blocked',version:1,progress:30,workItems:[]}}));
 await page.route('**/api/requirements/r1/progress',route=>{writes++;return route.abort('failed');});
 await page.goto('/requirements/r1');await page.getByRole('button',{name:'补充说明',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'补充说明',exact:true});await dialog.getByLabel('执行说明').fill('正在等待第三方');
 await dialog.getByRole('button',{name:'补充说明',exact:true}).click();await dialog.getByRole('button',{name:'读取最新状态',exact:true}).click();
 await expect(dialog).toContainText('请先核对进展记录');await expect(dialog.getByRole('button',{name:'补充说明',exact:true})).toBeDisabled();expect(writes).toBe(1);
});
