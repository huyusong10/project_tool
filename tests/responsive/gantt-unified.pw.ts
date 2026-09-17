import {chooseOption,selectedValue} from './select-helper';
import { expect, test, type Page } from "@playwright/test";
import { mockGanttData, mockGanttReport, requirement, workItem } from "./gantt-fixture";
import { isBusinessDay } from "../../src/shared/workday";

test('进展表默认展示全部状态，名称排序在刷新和返回后保留', async ({page})=>{
  await mockGanttData(page);
  const rows=['C','A','B'].map((name,index)=>({...requirement,id:name,title:name,sortOrder:index,status:index===2?'completed':'in_progress',workItems:[]}));
  let reverse=false,reads=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/dashboard')reads++;});
  await mockGanttReport(page,()=>reverse?[...rows].reverse():rows);
  await page.goto('/execution');await page.getByRole('button',{name:'展开全部',exact:true}).click();
  const titles=page.locator('.workspace-gantt-row.kind-requirement .workspace-row-title strong');
  await expect(titles).toHaveText(['C','A','B']);
  await page.getByRole('button',{name:'更多筛选',exact:true}).click();
  await chooseOption(page.getByLabel('进展排序',{exact:true}),'name');
  await page.getByRole('region',{name:'更多进展筛选'}).getByRole('button',{name:'关闭',exact:true}).click();
  await expect(titles).toHaveText(['A','B','C']);
  reverse=true;const before=reads;
  await page.evaluate(()=>{window.dispatchEvent(new Event('offline'));window.dispatchEvent(new Event('online'));});
  await expect.poll(()=>reads).toBeGreaterThan(before);await expect(titles).toHaveText(['A','B','C']);
  await page.reload();await expect(titles).toHaveText(['A','B','C']);
  await page.getByRole('button',{name:'更多筛选',exact:true}).click();await expect(selectedValue(page.getByLabel('进展排序',{exact:true}))).toHaveValue('name');
  await chooseOption(page.getByLabel('进展排序',{exact:true}),'manual');
  await page.getByRole('region',{name:'更多进展筛选'}).getByRole('button',{name:'关闭',exact:true}).click();
  await expect(titles).toHaveText(['C','A','B']);
});

async function expectOnlyBusinessDays(locator: ReturnType<Page["locator"]>) {
  const dates = await locator.evaluateAll((ticks) => ticks.map((tick) => tick.getAttribute("data-date") || ""));
  expect(dates.length).toBeGreaterThan(0);
  expect(dates.every((date) => isBusinessDay(date))).toBe(true);
  expect(dates.some((date) => {
    const [year, month, day] = date.split("-").map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return weekday === 0 || weekday === 6;
  }), "法定调休周末应作为工作日出现在时间轴中").toBe(true);
}

test("DCIM-34 实际条越过原截止日，里程碑落在执行范围内，进度变化不移动日期", async ({ page }, info) => {
  await mockGanttData(page);
  const overdue = { ...requirement, title: 'EPDS-DCIM-34【角色管理】', plannedStart: '2026-08-26', plannedEnd: '2026-09-04',
    actualStart: '2026-08-26', actualEnd: null, observationEnd: '2026-09-11', asOfDate: '2026-09-11',
    workItems:requirement.workItems.map(w=>({...w,plannedStart:'2026-08-26',plannedEnd:'2026-09-04'})), effectiveEnd: '2026-09-11', plannedProgress: 100, progress: 96, progressGap: 4, delayed: true, finishVariance: 5 };
  const writes: string[] = []; page.on('request', r => { if (r.url().includes('/api/') && r.method() !== 'GET') writes.push(r.url()); });
  await mockGanttReport(page,()=>[overdue],()=>overdue.asOfDate,()=>[{id:'ready',title:'提测就绪',projectId:'p1',requirementId:'r1',targetDate:null,achievedAt:'2026-09-08',confirmationMode:'auto',version:2}]);
  await page.goto('/execution');await page.getByRole('button',{name:'展开全部',exact:true}).click();
  const row = page.locator('.workspace-gantt-row.kind-requirement').filter({ hasText: 'EPDS-DCIM-34' });
  const bar = row.locator('.gantt-date-actual');
  const delay = row.locator(".gantt-date-delay");
  await expect(bar).toHaveAttribute('data-start', '2026-08-26');
  await expect(bar).toHaveAttribute('data-end', '2026-09-11');
  await expect(delay).toHaveCount(1);

  await expect(delay).toHaveCSS('border-top-color', await themeColor(page, '--gantt-delay'));
  await expect(row.locator('.unified-gantt-progress-gap')).toHaveCount(0);
  await expect(row.locator('.gantt-progress-end')).toHaveAttribute('data-anchor-date','2026-09-11');
  await expect(row.getByRole('button',{name:/最近达成：提测就绪/})).toBeVisible();
  const geometry = () => row.evaluate(root => {
    const left = (selector: string) => parseFloat(root.querySelector<HTMLElement>(selector)!.style.left);
    const width = parseFloat(root.querySelector<HTMLElement>('.gantt-date-actual')!.style.width);
    return { start: left('.gantt-date-actual'), end: left('.gantt-date-actual') + width,
      deadline: left('.gantt-date-deadline'), milestone: left('[data-milestone-id="ready"]'),
      marker: left('.gantt-progress-end'), today: left('.gantt-today-line') };
  });
  const original = await geometry();
  expect(original.end).toBe(original.today); expect(original.marker).toBe(original.end);
  expect(original.milestone).toBeGreaterThan(original.deadline);
  expect(original.milestone).toBeLessThan(original.end);
  await page.locator('.workspace-gantt-scroll').screenshot({ path: info.outputPath('dcim34-actual-dates.png') });
  overdue.progress = 40; await page.reload(); await expect(row.locator('.gantt-progress-end')).toHaveAttribute('data-anchor-date','2026-09-11');
  expect(await geometry()).toEqual(original);
  overdue.asOfDate = overdue.observationEnd = overdue.effectiveEnd = '2026-09-14';
  await page.reload(); await expect(bar).toHaveAttribute('data-end', '2026-09-14');
  const nextDay = await geometry(); expect(nextDay.end).toBe(nextDay.today); expect(nextDay.end).toBeGreaterThan(original.end);
  expect(writes).toEqual([]);
});

test('工作项来源链接定位到正式详情', async ({ page }) => {
  await mockGanttData(page);
  await page.goto('/requirements/r1?workItemId=w1');
  const target=page.locator('.modal-card-workspace');
  await expect(target.getByRole('heading',{name:'接口开发',exact:true})).toBeVisible();
  await expect(page).toHaveURL(/detailId=w1/);
  await expect(target.getByRole('region',{name:'执行资料'})).toContainText('开发');
});

test('工作项甘特使用需求业务日期，延伸一工作日而非系统日期',async({page})=>{
  await mockGanttData(page);const req={...requirement,workItems:[{...workItem,plannedEnd:'2026-09-02'}]};
  await mockGanttReport(page,()=>[req]);
  await page.goto('/?projectId=p1&workspaceView=progress&scopeType=requirement&scopeId=r1');await page.getByRole('button',{name:'展开全部',exact:true}).click();
  const row=page.locator('.workspace-gantt-row[data-row-id="w1"]');
  await expect(row.locator('.gantt-date-actual')).toHaveAttribute('data-end','2026-09-03');
  expect(await row.locator('.gantt-date-delay').evaluate(e=>parseFloat((e as HTMLElement).style.width))).toBe(40);
  await row.locator('.gantt-date-hitbox').focus();await expect(page.getByRole('tooltip')).toContainText('截至 2026-09-03');
});

test("需求历史和趋势图使用同时间的最新进度", async ({ page }, testInfo) => {
  await mockGanttData(page);
  const progressUpdates = [
    { id: 'a-new', percent: 90, content: '最后写入：验收准备完成', createdAt: '2026-09-03T12:00:00.000Z' },
    { id: 'z-old', percent: 20, content: '同一时间的较早记录', createdAt: '2026-09-03T12:00:00.000Z' },
    { id: 'previous-day', percent: 10, content: '前一天的记录', createdAt: '2026-09-02T12:00:00.000Z' },
  ].map((entry) => ({ ...entry, requirementId: 'r1', workItemId: 'w1', workItemTitle: '接口开发', workItemPercent: entry.percent, eventType: 'progress', updatedAt: entry.createdAt }));
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: {
    ...requirement, progress: 90, workItems: [{ ...workItem, progress: 90 }], progressUpdates,
  } }));
  await page.goto('/requirements/r1');
  await page.getByRole('tab',{name:'记录',exact:true}).click();
  await expect(page.locator('.progress-feed > article').first()).toContainText('最后写入：验收准备完成');
  const chart = page.getByRole('img', { name: '需求计划与实际进度趋势', exact: true });
  await chart.scrollIntoViewIfNeeded();
  await expect(chart.locator('canvas')).toBeVisible();
  const box = (await chart.boundingBox())!;
  await chart.hover({ position: { x: box.width - 35, y: 130 } });
  await expect(chart).toContainText('09/03');
  await expect(chart).toContainText(/实际进度\s*90/);
  await page.screenshot({ path: testInfo.outputPath('history-trend.png'), animations: 'disabled' });
});

test("关联工作项的纯说明不显示需求进度或当前工作项进度", async ({ page }) => {
  await mockGanttData(page);
  const note = {
    id: 'work-note', requirementId: 'r1', workItemId: 'w1', workItemTitle: '接口开发', percent: 61,
    workItemPercent: null, content: '仅补充联调说明，没有更新完成度', eventType: 'note',
    createdAt: '2026-09-03T12:00:00.000Z', updatedAt: '2026-09-03T12:00:00.000Z',
  };
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: { ...requirement, progressUpdates: [note] } }));
  await page.goto('/requirements/r1');
  await page.getByRole('tab',{name:'记录',exact:true}).click();

  const history = page.locator('.progress-feed > article').filter({ hasText: note.content });
  await expect(history.locator('.progress-marker')).toHaveText('—');
  await expect(history.locator('.progress-marker')).not.toContainText('61%');
  await expect(history.locator('.progress-marker')).not.toContainText('40%');

  await mockGanttReport(page,()=>[{...requirement,recentProgressUpdates:[note]}]);
  await page.goto('/?projectId=p1&workspaceView=progress&scopeType=requirement&scopeId=r1');await page.getByRole('button',{name:'展开全部',exact:true}).click();
  await page.locator('[data-row-id="w1"] .gantt-date-hitbox').focus();
  const updates=page.locator('.workspace-gantt-summary section');
  await expect(updates).toContainText(note.content);await expect(updates.locator('article > b')).toHaveCount(0);
});

test("进展记录展示同一工作项的完成度变化、耗时和操作人", {tag:'@responsive'},async ({ page }) => {
  await mockGanttData(page);
  const progressUpdates = [
    {
      id: 'latest', requirementId: 'r1', workItemId: 'w1', workItemTitle: '联调', percent: 40,
      workItemPercent: 40, content: '代码返回后端修改中', eventType: 'progress',
      createdByAccountId: 'admin', createdByName: '程中林',
      createdAt: '2026-09-04T17:07:33+08:00', updatedAt: '2026-09-04T17:07:33+08:00',
    },
    {
      id: 'other', requirementId: 'r1', workItemId: 'w2', workItemTitle: '数据开发', percent: 30,
      workItemPercent: 90, content: '其他工作项的记录', eventType: 'progress',
      createdByAccountId: 'admin', createdByName: '张三',
      createdAt: '2026-09-04T10:00:00+08:00', updatedAt: '2026-09-04T10:00:00+08:00',
    },
    {
      id: 'start', requirementId: 'r1', workItemId: 'w1', workItemTitle: '联调', percent: 0,
      workItemPercent: 0, content: '开始工作项', eventType: 'start',
      createdByAccountId: 'admin', createdByName: '程中林',
      createdAt: '2026-09-03T20:12:17+08:00', updatedAt: '2026-09-03T20:12:17+08:00',
    },
  ];
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: { ...requirement, progressUpdates } }));
  await page.goto('/requirements/r1');
  await page.getByRole('tab',{name:'记录',exact:true}).click();

  const latest = page.locator('.progress-feed > article').filter({ hasText: '代码返回后端修改中' });
  await expect(latest.locator('.progress-marker')).toHaveText('0 → 40%');
  await expect(latest.locator('.progress-record-summary')).toContainText('联调');
  await expect(latest.locator('.progress-record-summary')).toContainText('代码返回后端修改中');
  await expect(latest.locator('.progress-event-type')).toHaveCount(0);
  const itemBox = await latest.locator('.progress-record-summary strong').boundingBox();
  const contentBox = await latest.locator('.progress-record-summary span').boundingBox();
  expect(itemBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  expect(Math.abs(itemBox!.y - contentBox!.y)).toBeLessThanOrEqual(3);
  await expect(latest.locator('.progress-record-meta')).toContainText('程中林');
  await expect(latest.locator('.progress-record-meta')).toContainText(/距上次记录\s*20小时55分钟/);
  await expect(latest.locator('.progress-record-meta')).toContainText(/需求总进度\s*40%/);
});

test('项目与需求范围共用双轨时间轴，进度独立记录并保持业务日期',async({page})=>{
  const progressRequests:Array<Record<string,unknown>>=[];await mockGanttData(page,progressRequests);
  await page.goto('/execution');await page.getByRole('button',{name:'展开全部',exact:true}).click();
  const reqRows=page.locator('.workspace-gantt-row.kind-requirement');
  await expect(reqRows.locator('.gantt-date-plan')).toHaveCount(2);await expect(reqRows.locator('.gantt-date-actual')).toHaveCount(2);
  await expect(page.locator('.workspace-time-tools .view-tabs button.active')).toHaveText('日');
  const delayedRow=page.locator('[data-row-id="r1"]');
  await expect(delayedRow.locator('.gantt-progress-value')).toHaveText('80%');
  const position=await delayedRow.evaluate(e=>({actual:parseFloat((e.querySelector('.gantt-date-actual') as HTMLElement).style.left)+parseFloat((e.querySelector('.gantt-date-actual') as HTMLElement).style.width),end:parseFloat((e.querySelector('.gantt-progress-end') as HTMLElement).style.left),today:parseFloat((e.querySelector('.gantt-today-line') as HTMLElement).style.left)}));
  expect(position.end).toBe(position.actual);expect(position.actual).toBe(position.today);
  await delayedRow.locator('.gantt-date-hitbox').focus();
  await expect(page.getByRole('tooltip')).toContainText('完成接口权限校验与异常分支联调');
  await expect(page.locator('.workspace-gantt-summary article > b')).toHaveText('40%');
  const widths=await reqRows.locator('.gantt-date-plan').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().width));expect(Math.abs(widths[0]-widths[1])).toBeLessThanOrEqual(1);
  await expectOnlyBusinessDays(page.locator('.workspace-gantt-grid [data-date]'));await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'进入统一甘特样式',exact:true}).click();
  const workRows=page.locator('.workspace-gantt-row.kind-work');await expect(workRows).toHaveCount(3);
  await expect(workRows.locator('.gantt-date-plan')).toHaveCount(3);await expect(workRows.locator('.gantt-date-actual')).toHaveCount(3);
  const active=page.locator('[data-row-id="w1"]'),late=page.locator('[data-row-id="w-late"]'),early=page.locator('[data-row-id="w-early"]');
  await expect(active.locator('.gantt-progress-value')).toHaveText('40%');await expect(late.locator('.gantt-progress-value')).toHaveText('100%');
  await expect(late.locator('.gantt-date-actual')).toHaveAttribute('data-end','2026-09-14');await expect(early.locator('.gantt-date-actual')).toHaveAttribute('data-end','2026-09-08');
  expect(await late.locator('.gantt-date-delay').evaluate(e=>parseFloat((e as HTMLElement).style.width))).toBe(80);
  await expect(early.locator('.gantt-date-delay')).toHaveCount(0);
  for(const row of [late,early])await expect(row.locator('.gantt-completion-fill')).toHaveCSS('background-color',await themeColor(page,'--gantt-completed'));
  await expect(late.locator('.gantt-date-delay')).toHaveCSS('border-top-color',await themeColor(page,'--gantt-delay'));
  await active.getByRole('button',{name:'更新 接口开发 进度'}).click();
  const form=page.getByRole('dialog',{name:'更新工作项进度',exact:true});
  await form.getByLabel('当前完成度（估算）数值').fill('80');await form.getByRole('textbox',{name:/说明/}).fill('完成开发，等待联调');
  await form.getByRole('button',{name:'记录进展',exact:true}).click();await expect.poll(()=>progressRequests.length).toBe(1);
  expect(progressRequests[0]).toMatchObject({workItemId:'w1',workItemPercent:80,expectedVersion:1,content:'完成开发，等待联调'});
  expect(typeof progressRequests[0].workItemPercent).toBe('number');expect(typeof progressRequests[0].expectedVersion).toBe('number');
  await expectOnlyBusinessDays(page.locator('.workspace-gantt-grid [data-date]'));
});

test("时间轴元素横向滚动时不会覆盖左侧标题", {tag:"@responsive"}, async ({ page }, _testInfo) => {

  await mockGanttData(page);
  await page.goto("/execution");await page.getByRole("button",{name:"展开全部",exact:true}).click();

  const scroll = page.locator(".workspace-gantt-scroll");
  await scroll.locator('[data-row-id="r1"]').scrollIntoViewIfNeeded();
  await scroll.evaluate((element) => {
    const row=element.querySelector('[data-row-id="r1"]')!;
    const actual = row.querySelector<HTMLElement>('.gantt-date-actual')!;
    const label = row.querySelector<HTMLElement>('.workspace-row-label')!;
    element.scrollLeft += actual.getBoundingClientRect().right - label.getBoundingClientRect().right + 4;
  });
  await page.waitForTimeout(100);
  const layer = await page.locator(".workspace-gantt-row.kind-requirement").filter({ hasText: "统一甘特样式" }).evaluate((row) => {
    const label = row.querySelector<HTMLElement>(".workspace-row-label")!;
    const marker = row.querySelector<HTMLElement>(".gantt-progress-text")!;
    const labelBox = label.getBoundingClientRect();
    const markerBox = marker.getBoundingClientRect();
    const overlaps = markerBox.left < labelBox.right && markerBox.right > labelBox.left;
    const x = Math.min(labelBox.right - 2, Math.max(labelBox.left + 2, markerBox.left + 2));
    const y = markerBox.top + markerBox.height / 2;
    const topElement = document.elementFromPoint(x, y);
    return {
      overlaps,
      coveredByLabel: Boolean(topElement?.closest(".workspace-row-label")),
      isolated: getComputedStyle(row.querySelector<HTMLElement>(".workspace-row-track")!).isolation,
    };
  });
  expect(layer.overlaps).toBe(true);
  expect(layer.coveredByLabel).toBe(true);
  expect(layer.isolated).toBe("isolate");
});

async function themeColor(page: Page, token: string) {
  return page.evaluate((name) => {
    const element = document.createElement("span"); element.style.color = `var(${name})`; document.body.append(element);
    const color = getComputedStyle(element).color; element.remove(); return color;
  }, token);
}
