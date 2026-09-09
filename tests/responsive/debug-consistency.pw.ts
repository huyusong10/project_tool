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

test('存在项目草稿时实际日期更正不请求接口，处理草稿后可继续原输入',async({page})=>{
 await mockGanttData(page);let current={...workItem};const writes:Array<Record<string,unknown>>=[];
 await page.route('**/api/requirements/r1',route=>route.fulfill({json:{...requirement,version:1,workItems:[current]}}));
 await page.route('**/api/work-items/w1/correct',route=>{const body=route.request().postDataJSON();writes.push(body);current={...current,...body,version:current.version+1};return route.fulfill({json:current});});
 await page.goto('/requirements/r1');await expect(page.locator('.requirement-overview')).toBeVisible();
 await page.evaluate(()=>sessionStorage.setItem('pm-graph-draft:admin:p1',JSON.stringify({formatVersion:2,version:'1',index:0,active:true,layouts:{},fields:{},values:[{add:[],remove:[],estimates:[],entities:[{entity:'requirement',id:'r1',op:'update',expectedVersion:1,data:{title:'尚未保存的名称'}}]}]})));
 await page.getByRole('button',{name:'更多工作项操作',exact:true}).first().click();await page.getByRole('button',{name:'受控修正实际日期',exact:true}).click();
 await page.getByLabel('实际开始',{exact:true}).fill('2026-08-31');await page.getByLabel('纠错原因',{exact:true}).fill('核对执行日期');await page.getByRole('button',{name:'保存纠错',exact:true}).click();
 await expect(page.getByText(/项目有未保存业务草稿/)).toBeVisible();expect(writes).toHaveLength(0);await expect(page.getByLabel('实际开始',{exact:true})).toHaveValue('2026-08-31');
 await page.evaluate(()=>sessionStorage.removeItem('pm-graph-draft:admin:p1'));await page.getByRole('button',{name:'保存纠错',exact:true}).click();
 await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toMatchObject({actualStart:'2026-08-31',reason:'核对执行日期',expectedVersion:1});
});
