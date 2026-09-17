import {chooseOption} from './select-helper';
import { expect, test, type Page } from '@playwright/test';
import { mockGanttData, mockGanttReport, requirement } from './gantt-fixture';

const full = { ...requirement, ownerId: 'u1', ownerName: '异常样例负责人', processingPriority: 'P0' as const, priorityReasons: ['进度落后'], executionMode: 'work_items' as const, background: '需求背景'.repeat(150), acceptanceCriteria: '完整完成标准'.repeat(100), readinessIssues: ['预计交付日期待确认'], riskReason: '排期不完整，交付日期待确认'.repeat(20) };
const direct={...full,executionMode:'direct' as const,status:'in_progress',workItems:[],plannedStart:null,plannedEnd:null,scheduleComplete:false,actualStart:'2026-09-01',actualEnd:null,progress:30,asOfDate:'2026-09-09'};
async function detail(page: Page, value:typeof full|typeof direct = full) { await mockGanttData(page); await mockGanttReport(page,()=>[value]); await page.route('**/api/requirements/r1', route => route.fulfill({json:value})); await page.goto('/?projectId=p1&workspaceView=progress&scopeType=requirement&scopeId=r1&detailId=r1&detailTab=overview'); await expect(page.getByRole('region', {name:'需求概览'})).toBeVisible(); }
async function noOverflow(page:Page) { await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(0); }

test('长需求资料在居中详情内滚动，切换与关闭不改变进展表布局', {tag:'@responsive'}, async ({page}, info) => {
 for(const width of [page.viewportSize()!.width,390]) {
  await page.setViewportSize({width,height:844}); await detail(page);
  const dialog=page.locator('.modal-card-workspace[role=dialog]'),timeline=page.getByRole('treegrid'),before=await timeline.boundingBox();
  const bounds=(await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width);expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.y+bounds.height).toBeLessThanOrEqual(844);
  await expect(dialog.locator('.overview-introduction-text')).toHaveText(full.background);
  await expect(dialog.locator('.overview-introduction-secondary')).toContainText(full.acceptanceCriteria);
  await dialog.getByRole('button',{name:'查看完整资料',exact:true}).click();await expect(dialog.getByRole('tabpanel').locator('.object-fact-wide').filter({has:page.locator('dt',{hasText:'说明'})})).toContainText(full.background);
  expect(await timeline.boundingBox()).toEqual(before);expect(await dialog.boundingBox()).toEqual(bounds);
  await expect(dialog.getByRole('tabpanel')).toHaveCSS('overflow-y','auto');await noOverflow(page);
  await page.screenshot({path:info.outputPath('summary-'+width+'.png')});await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);expect(await timeline.boundingBox()).toEqual(before);
  for(const theme of ['classic','swiss','forest','midnight','soft','industrial','dcim']) {
   await page.evaluate(value=>{localStorage.setItem('project-manage:theme',value);window.dispatchEvent(new StorageEvent('storage',{key:'project-manage:theme',newValue:value}));},theme);
   await expect(page.locator('html')).toHaveAttribute('data-theme',theme);await noOverflow(page);
   await page.locator('[data-row-id="r1"]').getByRole('button',{name:full.title,exact:true}).click();await expect(dialog).toBeVisible();expect(await timeline.boundingBox()).toEqual(before);
   expect(await dialog.evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);await dialog.getByRole('button',{name:'关闭',exact:true}).click();
  }
 }
});

test('直接执行进展表显示真实需求行，未排期偏差不显示假零，完成后直接结束', async ({page}) => {
 await detail(page,direct);
 await expect(page.getByRole('treegrid')).toBeVisible();await expect(page.locator('[data-row-id="r1"]')).toHaveCount(1);
 await expect(page.locator('.requirement-overview .object-facts').locator('div').filter({has:page.locator('dt',{hasText:'偏差'})})).toContainText('未排期');
 await expect(page.getByRole('region',{name:'待补全的排期'})).toContainText('缺少计划开始、计划完成');
 await page.route('**/api/requirements/r1',route=>route.fulfill({json:{...direct,status:'completed',progress:100,actualEnd:'2026-09-09'}}));await page.reload();
 await expect(page.locator('.requirement-overview')).toContainText('已完成');await expect(page.locator('.requirement-overview')).toContainText('未记录计划');await expect(page.getByRole('button',{name:'确认验收',exact:true})).toHaveCount(0);
});

test('行动标签完整单行且三档颜色一致，汇总与筛选使用相同严重度口径',{tag:'@responsive'}, async({page},info)=>{
 await mockGanttData(page);
 const rows=['P0','P1','P2','P3'].map((p,i)=>({id:p,sourceType:'requirement',sourceId:'r1',requirementId:'r1',projectId:'p1',contextTitle:'依赖项目',title:'交付事项 '+p,severity:i<2?'high':i===2?'medium':'low',processingPriority:p,priorityReasons:['实际执行和交付影响'],ownerId:'u1',ownerName:'异常样例负责人',dueDate:'2026-09-10',overdueWorkdays:0,reasonCodes:['high_risk'],reasons:[{code:'high_risk',label:'风险变化'}],targetPath:'/requirements/r1',affectedRequirements:[{id:'r1',title:'很长的受影响需求'.repeat(30)}]}));
 await page.route('**/api/action-items?*',route=>{const severity=new URL(route.request().url()).searchParams.get('severity');const items=rows.filter(r=>!severity||r.severity===severity);return route.fulfill({json:{asOfDate:'2026-09-09',items,total:items.length,page:1,pages:1,pageSize:20,ownerOptions:[],hasUnassigned:false,summary:{total:4,high:2,medium:1,low:1,byReason:{}}}});});
 await page.goto('/actions'); await expect(page.locator('.action-item')).toHaveCount(4);
 const badges=page.locator('.action-priority .action-severity');
 for(const width of [page.viewportSize()!.width,390]) {await page.setViewportSize({width,height:900});await noOverflow(page);for(const badge of await badges.all()){const size=await badge.boundingBox();expect(size!.height).toBeLessThanOrEqual(30);expect(await badge.evaluate(el=>getComputedStyle(el).whiteSpace)).toBe('nowrap');} await page.screenshot({path:info.outputPath('actions-'+width+'.png')});}
 await expect(badges).toHaveText(['高','高','中','低']);await expect(page.locator('.action-summary')).toContainText('优先处理');await expect(page.locator('.action-summary')).toContainText('资料待补齐');
 const overflow=await page.locator('.action-item').evaluateAll(es=>es.flatMap(e=>{const r=e.getBoundingClientRect();return [...e.children].filter(c=>c.getBoundingClientRect().bottom>r.bottom+1).map(c=>c.className);}));expect(overflow).toEqual([]);
 expect((await page.locator('.action-item-main').first().boundingBox())!.width).toBeGreaterThan(100);
 for(const card of await page.locator('.action-summary article').all())expect((await card.boundingBox())!.height).toBeLessThanOrEqual(76);
 await chooseOption(page.getByLabel('处理优先级'), 'high');await expect(page.locator('.action-item')).toHaveCount(2);
});

test('我的工作需求卡片与执行按钮保持卡片样式和间距',{tag:'@responsive'}, async({page},info)=>{
 await mockGanttData(page);
 await page.route('**/api/my-work*',route=>route.fulfill({json:{asOfDate:'2026-09-09',items:[],completionTrend:[],upcoming:[],requirements:[{...full,executionMode:'direct',workItems:[],planningReasons:[],actionCount:1}],summary:{total:0,inProgress:0,blocked:0,completed:0,notStarted:0}}}));
 await page.goto('/my-work');await expect(page.locator('.my-owned-requirement-card')).toHaveCount(1);
 await expect(page.locator('.my-owned-requirement-card')).toContainText('预计交付日期待确认');await expect(page.locator('.my-owned-requirement-card')).not.toContainText('计划正常');
 expect(await page.locator('.my-owned-requirement-link').evaluate(el=>getComputedStyle(el).display)).toBe('grid');
 expect(await page.locator('.delivery-controls').evaluate(el=>getComputedStyle(el).gap)).toBe('8px');
 await page.screenshot({path:info.outputPath('my-work.png')});
 await page.setViewportSize({width:390,height:844}); await noOverflow(page);
});
