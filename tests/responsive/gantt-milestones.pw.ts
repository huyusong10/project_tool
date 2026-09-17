import {workspaceFixture} from './workspace-fixture';
import { test, expect, type Page } from '@playwright/test';
import { mockGanttData, mockGanttReport, ganttRequirements, requirement } from './gantt-fixture';
import { analysePaths, type PathMilestone } from '../../src/shared/paths';
import { req, work } from '../fixtures/path-network';
import { themes } from '../../src/client/theme';
const milestones = [
  { id: 'm1', title: 'MPS基线', projectId: 'p1', requirementId: 'r1', targetDate: '2026-09-04', achievedAt: '2026-09-03', confirmationMode: 'auto', version: 1 },
  { id: 'm2', title: 'MDS基线', projectId: 'p1', requirementId: 'r1', targetDate: '2026-09-10', achievedAt: null, confirmationMode: 'manual', version: 1 },
  { id: 'm3', title: '待定发布', projectId: 'p1', requirementId: 'r1', targetDate: null, achievedAt: null, confirmationMode: 'manual', version: 1 },
  { id: 'm4', title: '文档基线', projectId: 'p1', requirementId: 'r1', targetDate: '2026-09-10', achievedAt: null, confirmationMode: 'auto', version: 1 },
  { id: 'project-ms', title: '项目交付点', projectId: 'p1', requirementId: null, targetDate: '2026-09-11', achievedAt: null, confirmationMode: 'auto', version: 1 },
];
async function setup(page:Page){
 await mockGanttData(page);await mockGanttReport(page,()=>ganttRequirements,()=> '2026-09-18',()=>milestones as PathMilestone[]);
 await page.emulateMedia({reducedMotion:'reduce'});
}
async function openProgress(page:Page){await page.goto('/execution');await page.getByRole('button',{name:'展开全部',exact:true}).click();await expect(page.locator('.workspace-gantt-scroll')).toHaveAttribute('data-gantt-ready','true');}
test('需求行显示最近达成日期，详情保留目标与历史记录，浏览不写入',async({page})=>{
 await setup(page);const writes:string[]=[];page.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/api/'))writes.push(r.url());});await openProgress(page);
 const surface=page.locator('.workspace-gantt-scroll'),row=surface.locator('[data-row-id="r1"]'),pin=row.locator('[data-milestone-id="m1"]');
 await expect(row.locator('[data-milestone-id]')).toHaveCount(1);await expect(pin).toHaveAttribute('data-milestone-date','2026-09-03');
 const at=await pin.evaluate(e=>parseFloat((e as HTMLElement).style.left));const end=await surface.locator('[data-date="2026-09-03"]').evaluate(e=>parseFloat((e as HTMLElement).style.left)+parseFloat((e as HTMLElement).style.width));expect(at).toBe(end);
 await pin.click();const dialog=page.getByRole('dialog',{name:'里程碑详情'});await expect(dialog).toContainText('实际达成2026-09-03');await expect(dialog).toContainText('目标日期2026-09-04');await expect(dialog.locator('.gantt-milestone-summary')).toHaveCount(4);
 await surface.evaluate(e=>e.dispatchEvent(new Event('scroll')));await expect(dialog).toBeVisible();
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await pin.click();await page.locator('.workspace-time-tools').click({position:{x:3,y:3}});await expect(dialog).toHaveCount(0);
 await pin.click();await expect(dialog).toBeVisible();await surface.evaluate(e=>{e.scrollLeft+=40;});await expect(dialog).toHaveCount(0);expect(writes).toEqual([]);
});
test('实际里程碑随日期轴缩放，窄屏保持固定行高与可见详情',{tag:'@responsive'},async({page},info)=>{
 await setup(page);await openProgress(page);const surface=page.locator('.workspace-gantt-scroll'),row=surface.locator('[data-row-id="r1"]'),pin=row.locator('[data-milestone-id="m1"]');
 const height=(await row.boundingBox())!.height;
 for(const viewport of [page.viewportSize()!,{width:390,height:844}]){
  await page.setViewportSize(viewport);
  for(const zoom of ['日','周','月']){
   await page.locator('[aria-label="时间粒度"]').getByRole('button',{name:zoom,exact:true}).click();await expect(pin).toHaveAttribute('data-milestone-date','2026-09-03');
   expect((await row.boundingBox())!.height).toBe(height);
   await pin.click();const dialog=page.getByRole('dialog',{name:'里程碑详情'});await expect(dialog).toBeVisible();const b=(await dialog.boundingBox())!;expect(b.x).toBeGreaterThanOrEqual(0);expect(b.x+b.width).toBeLessThanOrEqual(viewport.width+1);expect(b.y+b.height).toBeLessThanOrEqual(viewport.height+1);await page.keyboard.press('Escape');
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 }
 await page.screenshot({path:info.outputPath('milestone-narrow.png')});
});
test('项目里程碑位于表头，需求达成标记只出现在所属需求行',async({page})=>{
 await setup(page);await mockGanttReport(page,()=>ganttRequirements,()=> '2026-09-18',()=>milestones.map(m=>m.id==='project-ms'?{...m,achievedAt:'2026-09-09'}:m) as PathMilestone[]);await openProgress(page);
 const surface=page.locator('.workspace-gantt-scroll');await expect(surface.locator('.workspace-gantt-heading [data-milestone-id="project-ms"]')).toHaveAttribute('data-milestone-date','2026-09-11');
 await expect(surface.locator('.workspace-gantt-heading [data-milestone-actual="project-ms"]')).toHaveCount(1);
 await expect(surface.locator('.workspace-gantt-heading [data-milestone-id="m1"]')).toHaveCount(0);
 await expect(surface.locator('[data-row-id="r1"] [data-milestone-id="m1"]')).toHaveCount(1);await expect(surface.locator('[data-row-id="r2"] [data-milestone-id]')).toHaveCount(0);
});
test('未排期需求只显示已达成标记，未达成目标与预测不扩大日期范围',async({page})=>{
 await mockGanttData(page);const row={...requirement,status:'not_started',plannedStart:null,plannedEnd:null,actualStart:null,actualEnd:null,observationEnd:null,workItems:[],progress:0,scheduleComplete:false};
 const items:PathMilestone[]=[{...milestones[0],id:'forecast-only',targetDate:null,achievedAt:null,forecastEnd:'2030-12-20',confirmationMode:'auto'},{...milestones[0],id:'target',targetDate:'2030-12-20',achievedAt:null,confirmationMode:'manual'},{...milestones[0],id:'actual',achievedAt:'2026-09-04',targetDate:null,confirmationMode:'auto'}];
 await mockGanttReport(page,()=>[row],()=> '2026-09-18',()=>items);await openProgress(page);
 const surface=page.locator('.workspace-gantt-scroll');await page.getByRole('button',{name:'适配全部',exact:true}).click();
 await expect(surface.locator('[data-row-id="r1"] [data-milestone-id]')).toHaveCount(1);await expect(surface.locator('[data-milestone-id="actual"]')).toHaveAttribute('data-milestone-date','2026-09-04');
 const dates=await surface.locator('[data-date]').evaluateAll(es=>es.map(e=>e.getAttribute('data-date')!));expect(dates.length).toBeGreaterThan(0);expect(dates.every(d=>d<'2027-01-01')).toBe(true);
 await expect(surface.locator('.gantt-date-actual,.gantt-date-plan,.gantt-date-delay')).toHaveCount(0);
});
test('部分排期保留实际进度与达成记录，不画虚假延期或完整截止线',async({page})=>{
 await mockGanttData(page);
 const partial={...requirement,title:'EPDS-DCIM-137【租户管理】',asOfDate:'2026-09-18',plannedStart:'2026-09-07',plannedEnd:'2026-09-11',scheduleComplete:false,plannedProgress:null,progress:24,progressGap:0,riskEvaluated:false,riskLevel:'low',riskReason:'缺少完整排期，暂无法评估风险',actualStart:'2026-09-07',observationEnd:'2026-09-18',workItems:requirement.workItems.map((w,i)=>({...w,status:'in_progress',progress:24,actualEnd:null,plannedStart:i?null:'2026-09-07',plannedEnd:i?null:'2026-09-11'}))};
 await mockGanttReport(page,()=>[partial],()=>partial.asOfDate,()=>[{...milestones[0],achievedAt:'2026-09-10',confirmationMode:'auto'}]);await page.route('**/api/requirements/r1',route=>route.fulfill({json:partial}));await openProgress(page);
 const row=page.locator('[data-row-id="r1"]');await expect(row.locator('.gantt-date-actual')).toHaveAttribute('data-end','2026-09-18');await expect(row.locator('.gantt-date-plan')).toHaveClass(/is-partial-plan/);await expect(row.locator('.gantt-date-delay,.gantt-date-deadline')).toHaveCount(0);await expect(row.locator('.gantt-progress-value')).toHaveText('24%');await expect(row.locator('[data-milestone-id="m1"]')).toHaveCount(1);
 await row.locator('.gantt-date-hitbox').focus();await expect(page.getByRole('tooltip')).toContainText('缺少');await expect(page.getByRole('tooltip')).not.toContainText('应达');await page.keyboard.press('Escape');
 await page.goto('/requirements/r1');await expect(page.locator('.requirement-overview')).toContainText('2 项待排期');await expect(page.locator('.requirement-overview')).not.toContainText('计划 0%');
});

test('流程预览只保留工作行，里程碑在第2日末尾切开，不新增一天', async ({ page }, info) => {
  await mockGanttData(page);
  const template = { id: 't1', projectId: 'p1', name: '阶段交付流程', description: '', dependencyMode: 'dependencies', createdAt: '2026-09-01', updatedAt: '2026-09-01', items: [
    { id: 'ta', clientKey: 'ta', templateId: 't1', title: 'MPS编写', kind: 'work', sortOrder: 0, durationDays: 2, startOffsetDays: 0, predecessorIds: [] },
    { id: 'tb', clientKey: 'tb', templateId: 't1', title: 'MDS编写', kind: 'work', sortOrder: 1, durationDays: 3, startOffsetDays: 2, predecessorIds: ['ta'] },
    { id: 'tm', clientKey: 'tm', templateId: 't1', title: 'MPS基线', kind: 'milestone', sortOrder: 2, durationDays: 0, startOffsetDays: 2, predecessorIds: ['ta'] },
  ] };
  await page.route('**/api/templates*', r => r.fulfill({ json: [template] }));
  await page.goto('/templates?edit=t1'); await expect(page.locator('[data-layout-ready="true"]')).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: '流程预览', exact: true }).click();
  await expect(page.locator('.template-plan-row')).toHaveCount(2);
  const ratio = await page.locator('.template-milestone-plan').evaluate(root => {
    const width = root.querySelector('.template-plan-scale')!.getBoundingClientRect().width;
    const point = parseFloat(root.querySelector<HTMLElement>('[data-milestone-id="tm"]')!.style.left);
    return point / width;
  }); expect(ratio).toBeCloseTo(2 / 5, 2);
  await page.locator('.template-milestone-plan .gantt-milestone-label').click();
  await expect(page.locator('.template-preview-selection')).toContainText('第 2 个工作日结束');
  await expect(page.locator('.template-plan-row .template-plan-name.is-milestone-related')).toContainText('MPS编写');
  await page.locator('.template-milestone-plan').screenshot({ path: info.outputPath('template-slices.png') });
});
test('需求路径排期预览复用切面，独立里程碑和验收点不增加工作行', async ({ page }, info) => {
  await mockGanttData(page);
  const data = analysePaths({ projectId: 'p1', projectName: '测试项目', projectEnd: '2026-09-30', revision: 1, asOfDate: '2026-09-07',
    requirements: [{ ...req('r1'), projectId: 'p1', title: requirement.title }], workItems: [work('w1', 'r1', 2), work('w2', 'r1', 3)],
    milestones: milestones.filter(m => m.requirementId).map(m => m.id === 'm4' ? { ...m, targetDate: null } : m) as PathMilestone[],
    dependencies: [{ id: 'work-to-milestone', projectId: 'p1', sourceRequirementId: 'r1', sourceWorkItemId: 'w1', targetRequirementId: 'r1', targetWorkItemId: null, targetMilestoneId: 'm4', origin: 'manual' }],
  });
  data.requirements=data.requirements.map(r=>({...r,featureId:'other-p1'}));data.featureContext=workspaceFixture('p1','测试项目',[requirement]).analysis.featureContext;
  await page.route('**/path-graph*', r => r.fulfill({ json: {analysis:data} }));
  await page.goto('/?projectId=p1&workspaceView=graph&scopeType=requirement&scopeId=r1'); await expect(page.locator('[data-layout-ready="true"]')).toBeVisible({ timeout: 20000 });
  await page.getByRole('button',{name:'排期预览',exact:true}).click();
  const chart = page.locator('.path-draft-gantt'); await expect(chart.locator('.path-draft-gantt-row')).toHaveCount(2);
  await expect(chart.locator('.gantt-milestone-rail')).toHaveCount(1);
  await expect(chart.locator('[data-milestone-id="m4"]')).toHaveCount(1);
  await expect(chart.locator('.gantt-milestone-label[aria-label*="文档基线"]')).toHaveAttribute('aria-label', /预计/);
  await expect(chart.locator('.path-gantt-name').filter({ hasText: '基线' })).toHaveCount(0);
  const panelBox = (await page.locator('.graph-auxiliary').boundingBox())!, toolbarBox = (await chart.locator('.gantt-navigation').boundingBox())!, rowBox = (await chart.locator('.path-draft-gantt-track').nth(1).boundingBox())!;
  expect(toolbarBox.y).toBeGreaterThan(panelBox.y + 35);
  expect(rowBox.y + rowBox.height).toBeLessThan(panelBox.y + panelBox.height);
  await expect(page.locator('.graph-auxiliary')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: info.outputPath('path-workspace.png') });
  await chart.screenshot({ path: info.outputPath('path-slices.png') });
});
test('里程碑标记在全部主题与减少动态效果下保持日期及几何位置',{tag:'@responsive'},async({page},info)=>{
 await setup(page);await openProgress(page);const row=page.locator('[data-row-id="r1"]'),pin=row.locator('[data-milestone-id="m1"]');
 const geometry=()=>pin.evaluate(e=>({left:(e as HTMLElement).style.left,top:getComputedStyle(e).top,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}));const before=await geometry();
 for(const theme of themes){await page.evaluate(value=>{localStorage.setItem('project-manage:theme',value);window.dispatchEvent(new StorageEvent('storage',{key:'project-manage:theme',newValue:value}));},theme.id);await expect(page.locator('html')).toHaveAttribute('data-theme',theme.id);expect(await geometry()).toEqual(before);await expect(pin).toHaveAttribute('data-milestone-date','2026-09-03');}
 await page.screenshot({path:info.outputPath('milestone-night.png')});
});
