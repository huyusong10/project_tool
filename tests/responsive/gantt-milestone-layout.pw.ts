import {test,expect} from '@playwright/test';
import {mockGanttData,mockGanttReport,ganttRequirements} from './gantt-fixture';
import type {PathMilestone} from '../../src/shared/paths';

const milestone:PathMilestone={id:'m1',title:'接口基线',projectId:'p1',requirementId:'r1',targetDate:'2026-09-04',achievedAt:'2026-09-03',confirmationMode:'auto',version:1};

test('最新达成标记位于计划条上方，有无标记及刷新前后的行高不变',{tag:'@responsive'},async({page},info)=>{
 await mockGanttData(page);await page.emulateMedia({reducedMotion:'reduce'});let reached=true;
 await mockGanttReport(page,()=>ganttRequirements,()=> '2026-09-18',()=>[{...milestone,achievedAt:reached?milestone.achievedAt:null}]);
 await page.goto('/execution');await page.getByRole('button',{name:'展开全部',exact:true}).click();
 const surface=page.locator('.workspace-gantt-scroll');await expect(surface).toHaveAttribute('data-gantt-ready','true');
 const geometry=()=>surface.locator('.workspace-gantt-row.kind-requirement').evaluateAll(rows=>Object.fromEntries(rows.map(row=>{
  const track=row.querySelector('.workspace-row-track')!,box=track.getBoundingClientRect(),rect=(selector:string)=>track.querySelector(selector)?.getBoundingClientRect();
  const plan=rect('.gantt-date-plan')!,actual=rect('.gantt-date-actual')!,pin=rect('.workspace-latest-milestone');
  return [(row as HTMLElement).dataset.rowId,{height:box.height,planTop:plan.top-box.top,actualTop:actual.top-box.top,actualBottom:actual.bottom-box.top,pinTop:pin&&pin.top-box.top,pinBottom:pin&&pin.bottom-box.top}];
 })));
 const verify=async()=>{const {r1,r2}=await geometry();expect(r1.height).toBe(r2.height);expect(r1.height).toBe(55);expect(r1.planTop).toBe(r2.planTop);expect(r1.actualTop).toBe(r2.actualTop);expect(r1.actualBottom).toBe(r2.actualBottom);expect(r1.pinTop).toBeGreaterThanOrEqual(0);expect(r1.pinBottom!).toBeLessThan(r1.actualTop);return r1;};
 const original=await verify();
 for(const viewport of [page.viewportSize()!,{width:390,height:844}]){
  await page.setViewportSize(viewport);await page.getByRole('button',{name:'适配全部',exact:true}).click();await verify();
  expect(await surface.evaluate(e=>e.clientWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('milestone-fixed-'+viewport.width+'.png')});
 }
 reached=false;await page.reload();await expect(surface).toHaveAttribute('data-gantt-ready','true');await expect(surface.locator('.workspace-gantt-row.kind-requirement')).toHaveCount(2);await expect(surface.locator('.workspace-latest-milestone')).toHaveCount(0);
 const refreshed=(await geometry()).r1;expect(refreshed.height).toBe(original.height);expect(refreshed.planTop).toBe(original.planTop);expect(refreshed.actualTop).toBe(original.actualTop);
});

test('密集达成记录只显示最新日期，详情保留全部日期与取消状态',{tag:'@responsive'},async({page},info)=>{
 await mockGanttData(page);await page.emulateMedia({reducedMotion:'reduce'});
 const reached:PathMilestone[]=[{...milestone,title:'很长的接口设计评审交付基线名称',targetDate:'2030-12-20'}, {...milestone,id:'m2',title:'MDS基线'}, {...milestone,id:'m3',title:'文档基线',achievedAt:'2026-09-04'}, {...milestone,id:'cancelled',title:'已取消发布',achievedAt:'2026-09-05',cancelled:true}];
 await mockGanttReport(page,()=>ganttRequirements,()=> '2026-09-18',()=>reached);
 await page.goto('/execution');await page.getByRole('button',{name:'展开全部',exact:true}).click();const surface=page.locator('.workspace-gantt-scroll');
 for(const viewport of [page.viewportSize()!,{width:390,height:844}]){
  await page.setViewportSize(viewport);
  for(const zoom of ['日','周','月']){
   await page.locator('[aria-label="时间粒度"]').getByRole('button',{name:zoom,exact:true}).click();
   const pin=surface.locator('.workspace-latest-milestone');await expect(pin).toHaveCount(1);await expect(pin).toHaveAttribute('data-milestone-id','m3');await expect(pin).toHaveAttribute('data-milestone-date','2026-09-04');
   await pin.click();const details=page.getByRole('dialog',{name:'里程碑详情'});await expect(details.locator('.gantt-milestone-summary')).toHaveCount(4);
   await expect(details).toContainText('很长的接口设计评审交付基线名称');await expect(details).toContainText('实际达成2026-09-03');await expect(details).toContainText('实际达成2026-09-04');
   await expect(details.locator('.gantt-milestone-summary').filter({hasText:'已取消发布'})).toContainText('已取消');
   const box=(await details.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(viewport.width+1);expect(await details.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);await page.keyboard.press('Escape');
  }
 }
 await page.screenshot({path:info.outputPath('milestone-history.png')});
});
