import { expect, test, type Page } from '@playwright/test';
import { mockGanttData, requirement } from './gantt-fixture';

const full = { ...requirement, ownerId: 'u1', ownerName: '异常样例负责人', processingPriority: 'P0', priorityReasons: ['关键交付受阻'], deliveryScope: 'committed', executionMode: 'work_items', acceptanceOwnerName: '验收负责人', background: '需求背景'.repeat(150), acceptanceCriteria: '完整验收标准'.repeat(100), readinessIssues: ['预计交付日期待确认'], riskReason: '缺少解除条件，交付日期待确认'.repeat(20) };
async function detail(page: Page, value = full) { await mockGanttData(page); await page.route('**/api/requirements/r1', route => route.fulfill({json:value})); await page.goto('/requirements/r1'); await expect(page.getByRole('region', {name:'需求概览'})).toBeVisible(); }
async function noOverflow(page:Page) { expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(()=>innerWidth)); }

test('需求概览两行且长资料不挤占甘特，浮层展开与关闭不改变布局', async ({page}, info) => {
 await page.setViewportSize({width:1440,height:900}); await detail(page);
 const summary=page.getByRole('region',{name:'需求概览'}),timeline=page.locator('.requirement-progress-panel');
 expect((await summary.boundingBox())!.height).toBeLessThanOrEqual(100);
 expect((await timeline.boundingBox())!.y).toBeLessThan(220);
 const before=await timeline.boundingBox(); await page.getByRole('button',{name:'需求资料与计算说明'}).click();
 await expect(page.getByRole('dialog')).toContainText(full.acceptanceCriteria); expect(await timeline.boundingBox()).toEqual(before);
 await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); expect(await timeline.boundingBox()).toEqual(before);await expect(page.getByRole('button',{name:'需求资料与计算说明'})).toBeFocused();
 await page.screenshot({path:info.outputPath('summary-desktop.png')});
 for(const skin of ['经典蓝白','瑞士排版','暖纸森林','午夜控制台','柔彩悬浮','工业黄黑','杰瑞橙']) {await page.getByRole('button',{name:/^切换风格/}).click();await page.getByRole('menuitemradio',{name:new RegExp('^'+skin)}).click();expect((await summary.boundingBox())!.height).toBeLessThanOrEqual(100);expect(await timeline.boundingBox()).toEqual(before);}
 await page.screenshot({path:info.outputPath('summary-night.png')});
 for(const width of [1280,390]) { await page.setViewportSize({width,height:844}); await noOverflow(page); }
 await page.screenshot({path:info.outputPath('summary-390.png')});
});

test('直接执行甘特显示真实需求行，未排期偏差不显示假零，验收状态仍区分', async ({page},info) => {
 const direct={...full,executionMode:'direct',status:'in_progress',workItems:[],plannedStart:null,plannedEnd:null,scheduleComplete:false,actualStart:'2026-09-01',actualEnd:null,progress:30,asOfDate:'2026-09-09'};
 await detail(page,direct as unknown as typeof full);
 await expect(page.getByRole('table',{name:'需求直接执行甘特图'})).toBeVisible();
 await expect(page.locator('.requirement-gantt-row[data-work-item-id]')).toHaveCount(1);
 await expect(page.getByRole('columnheader',{name:/需求执行/})).toBeVisible();
 await expect(page.locator('.requirement-gap-summary').first()).toHaveText('待排期');
 await expect(page.locator('.requirement-gantt-actions')).toHaveCount(0);
 await page.setViewportSize({width:1280,height:800}); await noOverflow(page);expect((await page.locator('.requirement-overview').boundingBox())!.height).toBeLessThanOrEqual(110);
 await page.screenshot({path:info.outputPath('direct-1280.png')});
 await page.route('**/api/requirements/r1',route=>route.fulfill({json:{...direct,status:'pending_acceptance',progress:100,actualEnd:'2026-09-09'}}));await page.reload();
 await expect(page.locator('.requirement-overview')).toContainText('待验收');await expect(page.locator('.requirement-overview')).toContainText('100%');
 await page.setViewportSize({width:390,height:844});await noOverflow(page);
});

test('行动标签完整单行且四档颜色一致，汇总与筛选使用相同优先级口径',async({page},info)=>{
 await mockGanttData(page);
 const rows=['P0','P1','P2','P3'].map((p,i)=>({id:p,sourceType:'requirement',sourceId:'r1',requirementId:'r1',projectId:'p1',contextTitle:'依赖项目',title:'交付事项 '+p,severity:i<2?'high':i===2?'medium':'low',processingPriority:p,priorityReasons:['实际执行和交付影响'],ownerId:'u1',ownerName:'异常样例负责人',dueDate:'2026-09-10',overdueWorkdays:0,reasonCodes:['high_risk'],reasons:[{code:'high_risk',label:'风险变化'}],targetPath:'/requirements/r1',affectedRequirements:[{id:'r1',title:'很长的受影响需求'.repeat(30)}]}));
 await page.route('**/api/action-items?*',route=>{const severity=new URL(route.request().url()).searchParams.get('severity');const items=rows.filter(r=>!severity||r.severity===severity);return route.fulfill({json:{asOfDate:'2026-09-09',items,total:items.length,page:1,pages:1,pageSize:20,ownerOptions:[],hasUnassigned:false,summary:{total:4,high:2,medium:1,low:1,byReason:{}}}});});
 await page.goto('/actions'); await expect(page.locator('.action-item')).toHaveCount(4);
 const badges=page.locator('.action-priority .priority-badge');
 for(const width of [1440,390]) {await page.setViewportSize({width,height:900});await noOverflow(page);for(const badge of await badges.all()){const size=await badge.boundingBox();expect(size!.width).toBe(80);expect(size!.height).toBeLessThanOrEqual(30);expect(await badge.evaluate(el=>getComputedStyle(el).whiteSpace)).toBe('nowrap');} await page.screenshot({path:info.outputPath('actions-'+width+'.png')});}
 await expect(page.locator('.action-summary')).toContainText('紧急 / 高');await expect(page.locator('.action-summary')).toContainText('P3');
 const overflow=await page.locator('.action-item').evaluateAll(es=>es.flatMap(e=>{const r=e.getBoundingClientRect();return [...e.children].filter(c=>c.getBoundingClientRect().bottom>r.bottom+1).map(c=>c.className);}));expect(overflow).toEqual([]);
 expect((await page.locator('.action-item-main').first().boundingBox())!.width).toBeGreaterThan(100);
 for(const card of await page.locator('.action-summary article').all())expect((await card.boundingBox())!.height).toBeLessThanOrEqual(76);
 await page.getByLabel('处理优先级').selectOption('high');await expect(page.locator('.action-item')).toHaveCount(2);
});

test('我的工作需求卡片与执行按钮保持卡片样式和间距',async({page},info)=>{
 await mockGanttData(page);
 await page.route('**/api/my-work*',route=>route.fulfill({json:{asOfDate:'2026-09-09',items:[],completionTrend:[],upcoming:[],requirements:[{...full,executionMode:'direct',workItems:[],planningReasons:[],actionCount:1}],summary:{total:0,inProgress:0,blocked:0,completed:0,notStarted:0}}}));
 await page.goto('/my-work');await expect(page.locator('.my-owned-requirement-card')).toHaveCount(1);
 await expect(page.locator('.my-owned-requirement-card')).toContainText('预计交付日期待确认');await expect(page.locator('.my-owned-requirement-card')).not.toContainText('计划正常');
 expect(await page.locator('.my-owned-requirement-link').evaluate(el=>getComputedStyle(el).display)).toBe('grid');
 expect(await page.locator('.delivery-controls').evaluate(el=>getComputedStyle(el).gap)).toBe('8px');
 await page.screenshot({path:info.outputPath('my-work.png')});
 await page.setViewportSize({width:390,height:844}); await noOverflow(page);
});
