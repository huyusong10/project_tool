import { expect, test, type Page } from "@playwright/test";
import { mockGanttData, requirement, workItem } from "./gantt-fixture";

const skins = ["classic", "swiss", "forest", "midnight", "soft", "industrial", "dcim"];
const cases = [
  { status: "not_started", progress: 0, actualStart: null, actualEnd: null },
  { status: "in_progress", progress: 99.6, actualStart: "2026-09-01", actualEnd: "2026-09-14" },
  { status: "completed", progress: 100, actualStart: "2026-09-01", actualEnd: "2026-09-14" },
  { status: "cancelled", progress: 30, actualStart: "2026-09-01", actualEnd: "2026-09-03" },
];

async function changeSkin(page: Page, skin: string) {
  await page.evaluate((value) => {
    localStorage.setItem("project-manage:theme", value);
    window.dispatchEvent(new StorageEvent("storage", { key: "project-manage:theme", newValue: value }));
  }, skin);
  await expect(page.locator("html")).toHaveAttribute("data-theme", skin);
}

test("夜间默认杰瑞橙，保留已选皮肤并迁移旧明暗偏好", async ({ page }) => {
  await mockGanttData(page);
  await page.emulateMedia({ colorScheme: "dark" });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/execution");
  await expect(page.getByRole("button", { name: "切换风格，当前杰瑞橙" })).toBeVisible();
  for (const [stored, expected] of [["forest", "forest"], ["light", "classic"], ["dark", "dcim"], ["invalid", "dcim"]]) {
    await page.evaluate((value) => localStorage.setItem("project-manage:theme", value), stored);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", expected);
  }
  await page.addInitScript(() => {
    const unavailable = () => { throw new Error("storage unavailable"); };
    Storage.prototype.getItem = unavailable;
    Storage.prototype.setItem = unavailable;
    Storage.prototype.removeItem = unavailable;
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dcim");
  await expect(page.locator(".gantt-row")).toHaveCount(2);
  await page.getByRole("button", { name: /^切换风格/ }).click();
  await page.getByRole("menuitemradio", { name: /瑞士排版/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "swiss");
  await page.getByRole("button", { name: "收起侧边栏" }).click();
  await expect(page.getByRole("button", { name: "展开侧边栏" })).toBeVisible();
  expect(errors).toEqual([]);
});

for (const surface of ["execution", "detail"] as const) for (const mode of ["overlay", "split"] as const) {
  test(`${surface} ${mode}：七套皮肤共用完成、执行、取消和延期色`, async ({ page }, info) => {
    await mockGanttData(page);
    const rows = cases;
    await page.route("**/api/dashboard**", (route) => route.fulfill({ json: {
      summary: { total: rows.length, active: rows.length, completed: 1, delayed: 0, highRisk: 0, completionRate: 0 },
      requirements: rows.map((item) => ({ ...requirement, ...item, id: item.status, title: item.status, asOfDate: "2026-09-14", effectiveEnd: item.actualEnd || "2026-09-10", workItems: [], riskLevel: "low", progressGap: 0 })),
      issues: { summary: { total: 0 }, attention: [] }, charts: { statuses: [], risks: [], weeks: [], varianceTop: [] },
    } }));
    await page.route("**/api/requirements/r1", (route) => route.fulfill({ json: {
      ...requirement, asOfDate: "2026-09-14", workItems: rows.map((item) => ({ ...workItem, ...item, id: item.status, title: item.status, milestoneLabel: null, cancelledAt: "2026-09-03" })),
    } }));
    await page.goto(surface === "execution" ? "/execution" : "/requirements/r1");
    if (surface === 'execution') await page.getByLabel('按状态筛选', { exact: true }).selectOption('');
    if (mode === "split") {
      await page.getByRole("button", { name: /^甘特显示方式/ }).click();
      const menu = (await page.locator(".gantt-view-options").boundingBox())!;
      const sidebar = (await page.locator(".sidebar").boundingBox())!;
      expect(menu.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width);
      expect(menu.x + menu.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      await page.getByRole("button", { name: "计划·实际双轨", exact: true }).click();
    }
    const barSelector = mode === "split" ? ".gantt-date-actual" : ".unified-gantt-actual";
    const markerSelector = mode === "split" ? ".gantt-date-progress" : surface === "execution" ? ".unified-gantt-label" : ".gantt-progress-marker";
    const bar = (status: string) => page.locator(`${barSelector}.gantt-status-${status}`);
    for (const skin of skins) {
      await changeSkin(page, skin);
      const dark = ["midnight", "dcim"].includes(skin);
      const green = dark ? "rgb(120, 173, 147)" : "rgb(53, 116, 91)";
      const blue = dark ? "rgb(120, 153, 188)" : "rgb(68, 107, 145)";
      const red = dark ? "rgb(226, 132, 134)" : "rgb(190, 79, 81)";
      await expect(bar("completed")).toHaveCSS("background-color", green);
      await expect(bar("in-progress")).toHaveCSS("background-color", blue);
      // 99.6% 的显示会取整为 100；业务状态仍是执行中。
      await expect(page.locator(`${markerSelector}.gantt-status-in-progress`)).toContainText(surface === "execution" ? "进行中" : "100");
      if (mode === "overlay" && surface === "detail") {
        await expect(page.locator(`${markerSelector}.gantt-status-completed`)).toHaveCSS("background-color", green);
        await expect(page.locator(`${markerSelector}.gantt-status-in-progress`)).toHaveCSS("background-color", blue);
      }
      await expect(bar("cancelled")).toHaveCSS("background-color", dark ? "rgb(150, 157, 169)" : "rgb(104, 113, 129)");
      await expect(bar("cancelled")).not.toHaveCSS("background-image", "none");
      await expect(page.locator(`${barSelector}.gantt-status-planning,${barSelector}.gantt-status-not-started`)).toHaveCount(0);
      const completedRow = surface === "execution" ? page.locator(".gantt-row").filter({ has: bar("completed") }) : page.locator('[data-work-item-id="completed"]');
      await expect(completedRow.locator(mode === "split" ? ".gantt-date-delay" : ".unified-gantt-delay")).toHaveCSS("border-top-color", red);
      if (mode === "overlay") await expect(completedRow.locator(".unified-gantt-delay")).toHaveCSS("background-color", green);
      if (surface === "execution" && info.project.name === "desktop-1080p") await page.screenshot({ path: info.outputPath(`${skin}-${mode}-states.png`), animations: "disabled" });
    }
  });
}

for (const mode of ["overlay", "split"] as const) test(`${mode}：各执行阶段共用蓝色，阶段文字和测试进度保留`, async ({ page }, info) => {
  await mockGanttData(page);
  const rows = [
    ...["analysis", "development", "integration", "testing"].map(workStage => ({
      ...requirement, id: workStage, title: workStage, progress: 99,
      workItems: [{ ...workItem, workStage, progress: 70, durationDays: 1 }],
    })),
    { ...requirement, id: 'parallel', title: '并行推进', workItems: [
      { ...workItem, id: 'dev', workStage: 'development', progress: 40 },
      { ...workItem, id: 'test', workStage: 'testing', progress: 70 },
    ] },
    { ...requirement, id: 'submitted', title: '已提测需求', workItems: [], actualStart: '2026-09-01', observationEnd: '2026-09-03',
      executionStage: { key: 'test_submitted', label: '已提测', tone: 'submitted', stages: [], currentWork: [] } },
  ];
  await page.route("**/api/dashboard**", route => route.fulfill({ json: {
    summary: { total: rows.length, active: rows.length, completed: 0, delayed: 0, highRisk: 0, completionRate: 0 },
    requirements: rows, issues: { summary: {}, attention: [] },
    charts: { statuses: [], risks: [], weeks: [], varianceTop: [] },
  } }));
  await page.goto('/execution');
  if (mode === 'split') {
    await page.getByRole('button', { name: /^甘特显示方式/ }).click();
    await page.getByRole('button', { name: '计划·实际双轨', exact: true }).click();
  }
  const bars = page.locator(mode === 'split' ? '.gantt-date-actual' : '.unified-gantt-actual');
  const badges = page.locator('.gantt-requirement-info .stage-badge');
  await expect(bars).toHaveCount(rows.length);
  const testing = page.locator('.gantt-row').filter({ has: page.getByRole('button', { name: 'testing', exact: true }) });
  await expect(testing).toContainText('测试中');
  await expect(testing).toContainText('70%');
  await expect(testing).not.toContainText('99%');
  await expect(page.locator('.gantt-row').filter({ hasText: '并行推进' })).toContainText('开发中 · 部分测试');
  await expect(page.locator('.gantt-row').filter({ hasText: '已提测需求' })).toContainText('已提测');
  for (const skin of skins) {
    await changeSkin(page, skin);
    const blue = ['midnight', 'dcim'].includes(skin) ? 'rgb(120, 153, 188)' : 'rgb(68, 107, 145)';
    expect(await bars.evaluateAll(elements => [...new Set(elements.map(el => getComputedStyle(el).backgroundColor))])).toEqual([blue]);
    expect(await badges.evaluateAll(elements => new Set(elements.map(el => getComputedStyle(el).color)).size)).toBe(1);
    if (info.project.name === 'desktop-1080p' && ['classic', 'dcim'].includes(skin)) {
      await page.screenshot({ path: info.outputPath(`${skin}-${mode}-stages.png`), animations: 'disabled' });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath(`${mode}-stages-mobile.png`), fullPage: true });
});
