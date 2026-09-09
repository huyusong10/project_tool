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
