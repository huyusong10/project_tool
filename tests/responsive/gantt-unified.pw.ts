import { expect, test, type Page } from "@playwright/test";
import { mockGanttData, requirement, workItem } from "./gantt-fixture";
import { isBusinessDay } from "../../src/shared/workday";

test('甘特默认优先展示风险与关键阻塞，数据刷新保留主动排序', async ({ page }) => {
  await mockGanttData(page);
  const rows = [
    { ...requirement, id: 'low', title: '低风险', riskLevel: 'low', priority: 'P0' },
    { ...requirement, id: 'pending', title: '待评估', riskEvaluated: false, priority: 'P1' },
    { ...requirement, id: 'medium', title: '中风险', priority: 'P2' },
    { ...requirement, id: 'high', title: '高风险', riskLevel: 'high', priority: 'P3', pathRisk: { critical: false, blockedCritical: false, minFloat: 3 } },
    { ...requirement, id: 'blocked', title: '关键阻塞', riskLevel: 'high', priority: 'P3', pathRisk: { critical: true, blockedCritical: true, minFloat: 0 } },
    { ...requirement, id: 'closed', title: '已结束', status: 'completed', riskLevel: 'high', priority: 'P0' },
  ];
  let reads = 0;
  await page.route('**/api/dashboard**', route => {
    reads++;
    return route.fulfill({ json: {
      summary: { total: rows.length, active: 5, completed: 1, delayed: 0, highRisk: 2, completionRate: 17 },
      requirements: reads === 1 ? rows : [...rows].reverse(),
      issues: { summary: {}, attention: [] }, charts: { statuses: [], risks: [], weeks: [], varianceTop: [] },
    } });
  });
  await page.goto('/');
  const titles = page.locator('.gantt-requirement-link');
  await expect(titles).toHaveText(['关键阻塞', '高风险', '中风险', '待评估', '低风险']);
  await page.getByLabel('按状态筛选',{exact:true}).selectOption('');
  await expect(titles).toHaveText(['关键阻塞', '高风险', '中风险', '待评估', '低风险', '已结束']);
  await page.reload();await expect(page.getByLabel('按状态筛选',{exact:true})).toHaveValue('');
  await expect(titles).toHaveText(['关键阻塞', '高风险', '中风险', '待评估', '低风险', '已结束']);
  await page.getByLabel('按状态筛选',{exact:true}).selectOption('unfinished');
  await page.getByLabel('需求排序', { exact: true }).selectOption('priority');
  const chosenOrder = await titles.allTextContents();
  expect(chosenOrder.slice(0, 3)).toEqual(['低风险', '待评估', '中风险']);
  const before = reads;
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await expect.poll(() => reads).toBeGreaterThan(before);
  await expect(page.getByLabel('需求排序', { exact: true })).toHaveValue('priority');
  await expect(titles).toHaveText(chosenOrder);
  await page.reload();await expect(page.getByLabel('需求排序',{exact:true})).toHaveValue('priority');
  await page.getByTitle('清除全部筛选',{exact:true}).click();
  await expect(page.getByLabel('需求排序',{exact:true})).toHaveValue('risk');
  await expect(titles).toHaveText(['关键阻塞', '高风险', '中风险', '待评估', '低风险']);
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

test("超期未完成需求的欠账段延伸覆盖延期区", async ({ page }) => {
  await mockGanttData(page);
  const overdue = { ...requirement, plannedEnd: "2026-09-02", effectiveEnd: "2026-09-04", plannedProgress: 100, progress: 60, progressGap: 40, delayed: true, finishVariance: 2 };
  await page.route("**/api/dashboard**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    summary: { total: 1, active: 1, completed: 0, delayed: 1, highRisk: 0, completionRate: 0 },
    requirements: [overdue],
    issues: { summary: { total: 0, inProgress: 0, deferred: 0, resolved: 0, active: 0, highPriority: 0, overdue: 0, unassigned: 0, closureRate: 0 }, attention: [] },
    charts: { statuses: [], risks: [], weeks: [], varianceTop: [] },
  }) }));
  await page.goto("/");
  const row = page.locator(".gantt-row").filter({ hasText: "统一甘特样式" });
  const behind = row.locator(".unified-gantt-progress-gap.is-behind");
  const delay = row.locator(".unified-gantt-delay");
  await expect(delay).toHaveCount(1);
  await expect(delay).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  // 延期区不再自画边框，避免与欠账段的虚线框相位错开叠成实线
  await expect(delay).toHaveCSS("border-top-width", "0px");
  const behindBox = await behind.boundingBox();
  const delayBox = await delay.boundingBox();
  expect(behindBox).not.toBeNull();
  expect(delayBox).not.toBeNull();
  // 欠账段右缘延伸到延期区末端，不在原计划结束点截断
  expect(Math.abs((behindBox!.x + behindBox!.width) - (delayBox!.x + delayBox!.width))).toBeLessThanOrEqual(2);
});

test('工作项来源链接定位并高亮目标行', async ({ page }) => {
  await mockGanttData(page);
  await page.goto('/requirements/r1?workItemId=w1');
  const target = page.locator('[data-work-item-id="w1"]');
  await expect(target).toHaveClass(/is-target/);
  await expect(target.locator('.requirement-gantt-item')).toContainText('接口开发');
});

test('工作项甘特偏差统一使用需求业务日期', async ({ page }) => {
  await mockGanttData(page);
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: {
    ...requirement,
    asOfDate: '2026-09-03',
    workItems: [{ ...workItem, plannedEnd: '2026-09-02' }],
  } }));
  await page.goto('/requirements/r1');
  const row = page.locator('.requirement-gantt-row').filter({ hasText: '接口开发' });
  await expect(row.locator('.requirement-gap-summary')).toContainText('延期 +1工作日');
  await row.locator('.gantt-bar-hitbox').focus();
  await expect(page.locator('.gantt-popover-metrics')).toContainText('3个工作日');
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

  const history = page.locator('.progress-feed > article').filter({ hasText: note.content });
  await expect(history.locator('.progress-marker')).toHaveText('—');
  await expect(history.locator('.progress-marker')).not.toContainText('61%');
  await expect(history.locator('.progress-marker')).not.toContainText('40%');

  const workRow = page.locator('.requirement-gantt-row').filter({ hasText: '接口开发' });
  await workRow.locator('.gantt-bar-hitbox').focus();
  const updates = page.locator('.gantt-popover-updates');
  await expect(updates).toContainText(note.content);
  await expect(updates.locator('article > span')).toHaveCount(0);
});

test("项目与需求甘特统一展示状态进度及今日进度差", async ({ page }, testInfo) => {
  test.skip(!["laptop-1366", "hidpi-3k-200", "desktop-1080p"].includes(testInfo.project.name), "统一甘特图仅验证代表性桌面视口");
  const progressRequests: Array<Record<string, unknown>> = [];
  await mockGanttData(page, progressRequests);

  await page.goto("/");
  await expect(page.locator(".project-gantt-grid")).toBeVisible();
  await expect(page.locator(".project-gantt-toolbar .gantt-legend").getByText("实际进度", { exact: true })).toBeVisible();
  await expect(page.locator(".project-gantt-toolbar .view-tabs[aria-label=时间粒度] button.active")).toHaveText("日");
  await expect(page.locator(".project-gantt-grid .unified-gantt-plan")).toHaveCount(2);
  await expect(page.locator(".project-gantt-grid .unified-gantt-progress-actual")).toHaveCount(2);
  await expect(page.locator(".project-gantt-grid .unified-gantt-progress-gap.is-behind")).toHaveCount(1);
  await expect(page.locator(".project-gantt-grid .unified-gantt-progress-gap.is-behind")).toHaveText("");
  await expect(page.locator(".project-gantt-grid .unified-gantt-progress-gap.is-behind")).toHaveCSS("border-top-style", "dashed");
  await expect(page.locator(".project-gantt-grid .unified-gantt-progress-gap.is-behind")).toHaveCSS("border-top-color", await themeColor(page, "--gantt-delay"));
  await expect(page.locator(".project-gantt-grid .unified-gantt-progress-gap.is-behind")).not.toHaveCSS("background-image", "none");
  await expect(page.locator(".project-gantt-grid .unified-gantt-progress-gap.is-ahead")).toHaveCount(1);
  await expect(page.locator(".project-gantt-grid .unified-gantt-progress-gap.is-ahead")).toHaveCSS("border-top-color", await themeColor(page, "--gantt-completed"));
  await expect(page.locator(".project-gantt-grid .unified-gantt-progress-target")).toHaveCount(0);
  await expect(page.locator(".project-gantt-grid .unified-gantt-plan-end")).toHaveCount(2);
  await expect(page.locator(".project-gantt-grid .unified-gantt-label")).toHaveCount(0);
  const delayedRow = page.locator(".gantt-row").filter({ hasText: "统一甘特样式" });
  await expect(page.locator(".gantt-row").filter({ hasText: "统一甘特样式" }).locator(".gantt-progress-marker > span")).toHaveText("61");
  await expect(page.locator(".gantt-row").filter({ hasText: "领先计划流程" }).locator(".gantt-progress-marker > span")).toHaveText("70");
  await expect(page.locator(".project-gantt-grid .gantt-progress-marker-tooltip")).toHaveCount(2);
  await expect(delayedRow.locator(".gantt-progress-marker-tooltip")).toHaveCSS("opacity", "0");
  await delayedRow.locator(".gantt-progress-marker").hover();
  await expect(delayedRow.locator(".gantt-progress-marker-tooltip")).toHaveCSS("opacity", "1");
  await expect(delayedRow.locator(".gantt-progress-marker-tooltip")).toHaveText("落后 30% · 应达 91%");
  await expect(page.getByText("中风险 · 落后30%", { exact: true })).toBeVisible();
  await expect(page.getByText("领先20%", { exact: true })).toBeVisible();
  const todayLineBox = await delayedRow.locator(".gantt-today-line").boundingBox();
  const progressMarkerBox = await delayedRow.locator(".gantt-progress-marker").boundingBox();
  expect(todayLineBox).not.toBeNull();
  expect(progressMarkerBox).not.toBeNull();
  expect(progressMarkerBox!.x + progressMarkerBox!.width / 2).toBeLessThan(todayLineBox!.x);
  const milestoneRow = page.locator(".gantt-row").filter({ hasText: "领先计划流程" });
  const milestoneTrackBox = await milestoneRow.locator(".gantt-track").boundingBox();
  const milestoneLabelBoxes = await milestoneRow.locator(".gantt-milestone-marker > b").evaluateAll((labels) => labels.map((label) => {
    const box = label.getBoundingClientRect();
    return { x: box.x, y: box.y, right: box.right, bottom: box.bottom };
  }));
  expect(milestoneTrackBox).not.toBeNull();
  expect(milestoneLabelBoxes.length).toBeGreaterThan(0);
  for (const box of milestoneLabelBoxes) {
    expect(box.x).toBeGreaterThanOrEqual(milestoneTrackBox!.x - 1);
    expect(box.right).toBeLessThanOrEqual(milestoneTrackBox!.x + milestoneTrackBox!.width + 1);
  }
  for (let left = 0; left < milestoneLabelBoxes.length; left += 1) {
    for (let right = left + 1; right < milestoneLabelBoxes.length; right += 1) {
      const a = milestoneLabelBoxes[left];
      const b = milestoneLabelBoxes[right];
      const overlaps = a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
      expect(overlaps).toBe(false);
    }
  }
  await delayedRow.locator(".gantt-track").hover({ position: { x: 4, y: 4 } });
  await expect(page.locator(".gantt-popover")).toBeHidden();
  await delayedRow.locator(".gantt-bar-hitbox").hover();
  await expect(page.locator(".gantt-popover")).toBeVisible();
  await expect(page.locator(".gantt-popover-updates")).toContainText("完成接口权限校验与异常分支联调");
  await expect(page.locator(".gantt-popover-updates article > span")).toHaveText("40%");
  await expect(page.locator(".gantt-popover-updates article > span")).not.toHaveText("61%");
  expect(await page.locator(".gantt-popover-updates p").evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
  const projectWidths = await page.locator(".project-gantt-grid .unified-gantt-plan").evaluateAll((bars) => bars.map((bar) => bar.getBoundingClientRect().width));
  expect(Math.abs(projectWidths[0] - projectWidths[1])).toBeLessThanOrEqual(1);
  await expectOnlyBusinessDays(page.locator(".project-gantt-grid .gantt-scale-tick"));

  await page.goto("/requirements/r1");
  await expect(page.locator(".requirement-gantt-grid")).toBeVisible();
  await expect(page.locator(".requirement-progress-panel").getByRole("button", { name: "调整卡片高度" })).toBeVisible();
  await expect(page.locator(".requirement-gantt-toolbar .view-tabs[aria-label=时间粒度] button.active")).toHaveText("日");
  await expect(page.locator(".requirement-gantt-grid .unified-gantt-plan")).toHaveCount(3);
  await expect(page.locator(".requirement-gantt-grid .unified-gantt-actual")).toHaveCount(3);
  await expect(page.locator(".requirement-gantt-grid .unified-gantt-plan-end")).toHaveCount(3);
  await expect(page.locator(".requirement-gantt-grid .unified-gantt-label")).toHaveCount(0);
  const activeWorkRow = page.locator(".requirement-gantt-row").filter({ hasText: "接口开发" });
  const completedLateRow = page.locator(".requirement-gantt-row").filter({ hasText: "延期完成项" });
  const completedEarlyRow = page.locator(".requirement-gantt-row").filter({ hasText: "提前完成项" });
  await expect(activeWorkRow.locator(".gantt-progress-marker")).toHaveText("40");
  await expect(completedLateRow.locator(".gantt-progress-marker")).toHaveText("100");
  await expect(completedLateRow.locator(".requirement-gap-summary")).toContainText("延期 +2工作日");
  await expect(completedEarlyRow.locator(".requirement-gap-summary")).toContainText("提前 2工作日");
  await expect(completedLateRow.locator(".unified-gantt-actual")).toHaveCSS("background-color", await themeColor(page, "--gantt-completed"));
  await expect(completedLateRow.locator(".unified-gantt-delay")).toHaveCSS("background-color", await themeColor(page, "--gantt-completed"));
  await expect(completedLateRow.locator(".unified-gantt-delay")).toHaveCSS("border-top-color", await themeColor(page, "--gantt-delay"));
  await expect(completedEarlyRow.locator(".unified-gantt-actual")).toHaveCSS("background-color", await themeColor(page, "--gantt-completed"));
  await expect(completedEarlyRow.locator(".unified-gantt-early")).toHaveCSS("border-top-color", await themeColor(page, "--gantt-completed"));
  await expect(completedEarlyRow.locator(".unified-gantt-early")).not.toHaveCSS("background-image", "none");
  await expect(page.locator(".requirement-gantt-grid .gantt-milestone-marker")).toContainText("接口基线");
  await activeWorkRow.locator(".gantt-progress-marker").click();
  await expect(page.getByRole("heading", { name: "更新工作项进度" })).toBeVisible();
  await page.getByLabel("当前完成度（估算）数值").fill("80");
  await page.getByPlaceholder("描述本次实际完成的内容").fill("完成开发，等待联调");
  await page.getByRole("button", { name: "记录进展" }).click();
  await expect.poll(() => progressRequests.length).toBe(1);
  expect(progressRequests[0]).toMatchObject({ workItemId: "w1", workItemPercent: 80, expectedVersion: 1, content: "完成开发，等待联调" });
  expect(typeof progressRequests[0].workItemPercent).toBe("number");
  expect(typeof progressRequests[0].expectedVersion).toBe("number");
  await expectOnlyBusinessDays(page.locator(".requirement-gantt-grid .gantt-scale-tick"));
});

test("时间轴元素横向滚动时不会覆盖左侧标题", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "laptop-1366", "在会触发横向滚动的桌面视口验证图层边界");
  await mockGanttData(page);
  await page.goto("/");

  const scroll = page.locator(".project-gantt-scroll");
  await scroll.evaluate((element) => { element.scrollLeft = element.scrollWidth - element.clientWidth; });
  await page.waitForTimeout(100);
  const layer = await page.locator(".gantt-row").filter({ hasText: "统一甘特样式" }).evaluate((row) => {
    const label = row.querySelector<HTMLElement>(".gantt-requirement-info")!;
    const marker = row.querySelector<HTMLElement>(".gantt-progress-marker")!;
    const labelBox = label.getBoundingClientRect();
    const markerBox = marker.getBoundingClientRect();
    const overlaps = markerBox.left < labelBox.right && markerBox.right > labelBox.left;
    const x = Math.min(labelBox.right - 2, Math.max(labelBox.left + 2, markerBox.left + 2));
    const y = markerBox.top + markerBox.height / 2;
    const topElement = document.elementFromPoint(x, y);
    return {
      overlaps,
      coveredByLabel: Boolean(topElement?.closest(".gantt-requirement-info")),
      isolated: getComputedStyle(row.querySelector<HTMLElement>(".unified-gantt-track")!).isolation,
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

test('项目甘特可向后扩展并恢复自动范围，横向滚动、刷新与排期保持正确',async({page},info)=>{
 await mockGanttData(page);const writes:string[]=[];page.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/api/'))writes.push(r.url());});await page.goto('/');await page.locator('.project-gantt-grid').waitFor();
 const snapshot=()=>page.locator('.project-gantt-scroll').evaluate(e=>({dates:[...e.querySelectorAll('[data-date]')].map(n=>n.getAttribute('data-date')),width:e.scrollWidth,scroll:e.scrollLeft}));
 const original=await snapshot(),bars=await page.locator('.unified-gantt-plan').evaluateAll(es=>es.map(e=>e.getAttribute('style')));expect(bars.length).toBeGreaterThan(0);await page.getByLabel('向后扩展一个月',{exact:true}).click();const first=await snapshot();expect(first.dates.length).toBeGreaterThan(original.dates.length);expect(first.dates.slice(0,original.dates.length)).toEqual(original.dates);expect(first.scroll).toBe(original.scroll);
 await page.getByLabel('向后扩展一个月',{exact:true}).click();const expanded=await snapshot();expect(expanded.dates.length).toBeGreaterThan(first.dates.length);expect(expanded.dates.at(-1)!>'2026-09-30').toBe(true);
 await page.locator('.project-gantt-scroll').evaluate(e=>e.scrollLeft=e.scrollWidth);expect((await snapshot()).scroll).toBeGreaterThan(0);expect(await page.locator('.unified-gantt-plan').evaluateAll(es=>es.map(e=>e.getAttribute('style')))).toEqual(bars);
 await page.reload();await page.locator('.project-gantt-grid').waitFor();expect((await snapshot()).dates).toEqual(expanded.dates);
 await page.getByLabel('恢复自动时间范围',{exact:true}).click();expect((await snapshot()).dates).toEqual(original.dates);await expect(page.getByLabel('恢复自动时间范围',{exact:true})).toBeDisabled();expect(writes).toEqual([]);
 await page.setViewportSize({width:390,height:844});const toolbar=page.locator('.gantt-toolbar-actions');await expect(toolbar).toBeVisible();await toolbar.scrollIntoViewIfNeeded();const geometry=await toolbar.evaluate(e=>{const parent=e.getBoundingClientRect();return {left:parent.left,right:parent.right,children:[...e.children].map(c=>{const b=c.getBoundingClientRect();return {left:b.left,right:b.right};})};});expect(geometry.left).toBeGreaterThanOrEqual(0);expect(geometry.right).toBeLessThanOrEqual(390);for(const box of geometry.children){expect(box.left).toBeGreaterThanOrEqual(geometry.left);expect(box.right).toBeLessThanOrEqual(geometry.right);}await page.screenshot({path:info.outputPath('gantt-range-narrow.png')});
});
