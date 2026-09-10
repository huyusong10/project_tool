import { expect, test, type Page } from "@playwright/test";
import { mockGanttData, requirement, workItem } from "./gantt-fixture";

const skins = [ ["classic", "经典蓝白"], ["swiss", "瑞士排版"], ["forest", "暖纸森林"], ["midnight", "午夜控制台"], ["soft", "柔彩悬浮"], ["industrial", "工业黄黑"], ["dcim", "杰瑞橙"] ];
async function chooseSkin(page: Page, label: string) {
  await page.getByRole("button", { name: /^切换风格/ }).click();
  await page.getByRole("menuitemradio", { name: new RegExp("^" + label) }).click();
}

for (const [skin, label] of [...skins, ['system', '跟随系统']]) test(`${label}：390px 顶栏返回与操作按钮可点击且互不遮挡`, async ({ page }) => {
  await mockGanttData(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/requirements/r1');
  await chooseSkin(page, label);
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await expect(page.locator('.sidebar')).toHaveClass(/sidebar-collapsed/);
    await page.getByRole('button', { name: '返回', exact: true }).click({ trial: true });
    await page.getByRole('button', { name: /^切换风格/ }).click({ trial: true });
    await page.locator('.project-switcher-button').click({ trial: true });
    expect((await page.locator('.topbar').boundingBox())?.height).toBe(88);
    await page.getByRole('button', { name: '编辑信息', exact: true }).click();
    await expect(page.getByRole('dialog').getByLabel('需求标题', { exact: true })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), skin).toBeLessThanOrEqual(390);
  }
});

for (const [skin, label] of skins) test(`${label}：布局、双轨三种粒度、长标题与完整提示`, async ({ page }, info) => {
  await mockGanttData(page);
  const title = "EPDS-2026-018 设备监控与告警处理：" + "跨模块联动及异常恢复的完整需求说明、".repeat(8);
  await page.route("**/api/requirements/r1", (route) => route.fulfill({ json: {
    ...requirement, title, workItems: [workItem, { ...workItem, id: "cancelled", title: "已取消的历史工作项", status: "cancelled", cancelledAt: "2026-09-02" }],
  } }));
  await page.goto("/");
  await expect(page.locator(".gantt-row")).toHaveCount(2);
  const before = await page.locator(".dashboard-top-stats,.project-gantt-panel,.gantt-filter-bar,.gantt-corner").evaluateAll((elements) => elements.map((element) => {
    const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
  }));
  await chooseSkin(page, label);
  await expect(page.locator("html")).toHaveAttribute("data-theme", skin);
  const after = await page.locator(".dashboard-top-stats,.project-gantt-panel,.gantt-filter-bar,.gantt-corner").evaluateAll((elements) => elements.map((element) => {
    const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
  }));
  expect(after).toEqual(before);
  await page.screenshot({ path: info.outputPath(`${skin}-home.png`), animations: "disabled" });
  const scroll = page.locator(".project-gantt-scroll");
  await scroll.evaluate((element) => { element.scrollLeft = 80; });
  await expect.poll(()=>scroll.evaluate(e=>e.scrollLeft)).toBeGreaterThan(80);
  const initialRange = await page.locator('.project-gantt-panel .gantt-visible-range').textContent();
  await page.getByRole("button", { name: /^甘特显示方式/ }).click();
  await page.getByRole("button", { name: "计划·实际双轨", exact: true }).click();
  await expect(page.locator(".gantt-date-actual")).toHaveCount(2);
  expect(await page.locator('.project-gantt-panel .gantt-visible-range').textContent()).toBe(initialRange);
  for (const zoom of ["日", "周", "月"]) {
    await page.getByLabel("时间粒度").getByRole("button", { name: zoom, exact: true }).click();
    await expect(page.locator(".gantt-date-plan").first()).toBeAttached();
    await expect(page.locator(".gantt-row").filter({ hasText: "统一甘特样式" }).locator(".gantt-date-actual")).toHaveAttribute("data-end", "2026-09-03");
    expect(await page.locator(".gantt-date-plan").first().evaluate((e) => e.getBoundingClientRect().y)).toBeLessThan(await page.locator(".gantt-date-actual").first().evaluate((e) => e.getBoundingClientRect().y));
  }
  await page.screenshot({ path: info.outputPath(`${skin}-split.png`), animations: "disabled" });
  await page.goto("/requirements/r1");
  await expect(page.getByRole("button", { name: /^甘特显示方式/ })).toHaveAttribute("aria-label", "甘特显示方式，当前计划·实际双轨");
  const heading = page.getByRole("heading", { name: title, exact: true });
  expect((await heading.boundingBox())!.width).toBeGreaterThan(120);
  await heading.focus();
  await expect(page.locator(".page-title-full")).toHaveText(title);
  const cancelled = page.locator('[data-work-item-id="cancelled"]');
  await expect(cancelled.locator(".gantt-date-actual")).toHaveAttribute("data-end", "2026-09-02");
  await expect(cancelled.locator(".requirement-gap-summary")).toHaveText("已取消");
  await page.screenshot({ path: info.outputPath(`${skin}-detail.png`), animations: "disabled" });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", skin);
});

test("换肤保留编辑草稿、菜单键盘选择不触发提交", async ({ page }) => {
  const writes: string[] = [];
  await mockGanttData(page);
  page.on("request", (request) => { if (request.method() !== "GET") writes.push(request.url()); });
  await page.goto("/requirements/r1");
  // 使用页面现有表单入口，换肤期间不重建表单和输入节点。
  await page.getByRole("button", { name: /编辑信息/ }).click();
  const input = page.getByRole("dialog").getByLabel("需求标题", { exact: true });
  await input.fill("尚未提交的需求草稿");
  await page.evaluate(() => {
    localStorage.setItem("project-manage:theme", "midnight");
    window.dispatchEvent(new StorageEvent("storage", { key: "project-manage:theme", newValue: "midnight" }));
  });
  await expect(input).toHaveValue("尚未提交的需求草稿");
  expect(writes).toEqual([]);
  await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
  const trigger = page.getByRole("button", { name: /^切换风格/ });
  await trigger.focus(); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Home"); await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme-preference", "system");
  await expect(trigger).toBeFocused();
  expect(writes).toEqual([]);
});

test("迁移暗色偏好；存储不可用时仍可切换皮肤", async ({ page }) => {
  await mockGanttData(page);
  await page.addInitScript(() => localStorage.setItem("project-manage:theme", "dark"));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dcim");
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error("blocked storage"); }; });
  await chooseSkin(page, "柔彩悬浮");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "soft");
});

test("全部配色切换复用图表画布，保留进展记录", async ({ page }) => {
  await mockGanttData(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/requirements/r1", (route) => route.fulfill({ json: {
    ...requirement, progressUpdates: [{ id: "update-1", requirementId: "r1", workItemId: "w1", percent: 40, workItemPercent: 40, content: "已经完成接口校验", eventType: "progress", createdAt: "2026-09-02T10:00:00Z", updatedAt: "2026-09-02T10:00:00Z" }],
  } }));
  await page.goto("/requirements/r1");
  const chart = page.getByRole("img", { name: "需求计划与实际进度趋势", exact: true });
  await expect(chart.locator("canvas")).toBeAttached();
  const canvas = await chart.locator("canvas").elementHandle();
  for (const [skin, label] of skins) {
    await chooseSkin(page, label);
    await expect(chart).toHaveAttribute("data-chart-theme", skin);
    expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true);
    await expect(page.locator(".progress-feed")).toContainText("已经完成接口校验");
  }
  expect(errors).toEqual([]);
});

test("甘特视图偏好按账号隔离", async ({ page }) => {
  await mockGanttData(page);
  await page.goto("/");
  await page.getByRole("button", { name: /^甘特显示方式/ }).click();
  await page.getByRole("button", { name: "计划·实际双轨", exact: true }).click();
  await page.route("**/api/session", (route) => route.fulfill({ json: { authenticated: true, accountId: "another-admin", username: "another-admin", role: "admin", globalRole: "admin", personId: null, mustChangePassword: false, managedProjectIds: [] } }));
  await page.reload();
  await expect(page.getByRole("button", { name: /^甘特显示方式/ })).toHaveAttribute("aria-label", "甘特显示方式，当前现有视图");
});

test("我的工作复用双轨与皮肤，百分比不改变执行日期跨度", async ({ page }) => {
  await mockGanttData(page);
  await page.route("**/api/my-work", (route) => route.fulfill({ json: {
    asOfDate: "2026-09-03", summary: { total: 2, notStarted: 0, inProgress: 2, blocked: 0, completed: 0, overdue: 0 }, requirements: [],
    items: [workItem, { ...workItem, id: "another", title: "同日期不同进度", progress: 80 }].map((item) => ({ ...item, projectId: "p1", projectName: "测试项目", requirementTitle: "统一甘特样式", requirementStatus: "in_progress", assignmentType: "owner", overdue: false })),
    completionTrend: [{ week: "2026-09-01", completed: 2 }], upcoming: [{ date: "2026-09-03", count: 2 }], recentProgress: [],
  } }));
  await page.goto("/my-work");
  await page.getByRole("button", { name: /^甘特显示方式/ }).click();
  await page.getByRole("button", { name: "计划·实际双轨", exact: true }).click();
  const bars = page.locator(".gantt-date-actual");
  await expect(bars).toHaveCount(2);
  const widths = await bars.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
  expect(widths[0]).toBe(widths[1]);
  await expect(page.locator(".gantt-date-progress")).toHaveText(["完成 40%", "完成 80%"]);
  await chooseSkin(page, "午夜控制台");
  await expect(page.locator(".themed-chart")).toHaveCount(2);
  await expect(bars.first()).toHaveAttribute("data-end", "2026-09-03");
});

test("实际点击换肤菜单不会触发人员姓名编辑器的离开提交", async ({ page }) => {
  await mockGanttData(page);
  const writes: string[] = [];
  page.on("request", (request) => { if (request.method() !== "GET") writes.push(request.url()); });
  await page.route("**/api/people", (route) => route.fulfill({ json: [{ id: "u1", name: "张三", jobTitle: "工程师", active: 1, createdAt: "2026-09-01", updatedAt: "2026-09-01" }] }));
  await page.route("**/api/accounts", (route) => route.fulfill({ json: [] }));
  await page.goto("/resources");
  await page.getByRole("button", { name: /^人员姓名：张三/ }).click();
  const input = page.getByRole("textbox", { name: "人员姓名", exact: true });
  await input.fill("姓名草稿");
  await chooseSkin(page, "柔彩悬浮");
  await expect(input).toBeVisible();
  await expect(input).toHaveValue("姓名草稿");
  expect(writes).toEqual([]);
});
