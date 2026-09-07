import { expect, test, type Page } from "@playwright/test";
import { mockGanttData, requirement, workItem } from "./gantt-fixture";

const skins = ["swiss", "forest", "midnight", "soft", "industrial", "dcim"];
const cases = [
  { status: "planning", progress: 0, actualStart: null, actualEnd: null },
  { status: "in_progress", progress: 99.6, actualStart: "2026-09-01", actualEnd: "2026-09-14" },
  { status: "completed", progress: 100, actualStart: "2026-09-01", actualEnd: "2026-09-14" },
  { status: "pending_acceptance", progress: 100, actualStart: "2026-09-01", actualEnd: "2026-09-14" },
  { status: "blocked", progress: 40, actualStart: "2026-09-01", actualEnd: "2026-09-14" },
  { status: "cancelled", progress: 30, actualStart: "2026-09-01", actualEnd: "2026-09-03" },
];

async function changeSkin(page: Page, skin: string) {
  await page.evaluate((value) => {
    localStorage.setItem("project-manage:theme", value);
    window.dispatchEvent(new StorageEvent("storage", { key: "project-manage:theme", newValue: value }));
  }, skin);
  await expect(page.locator("html")).toHaveAttribute("data-theme", skin);
}

test("杰瑞橙默认生效，保留已选皮肤和旧明暗偏好", async ({ page }) => {
  await mockGanttData(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "切换风格，当前杰瑞橙" })).toBeVisible();
  for (const [stored, expected] of [["forest", "forest"], ["light", "forest"], ["dark", "midnight"], ["invalid", "dcim"]]) {
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

for (const surface of ["home", "detail"] as const) for (const mode of ["overlay", "split"] as const) {
  test(`${surface} ${mode}：六套皮肤共用完成、执行、阻塞、取消和延期色`, async ({ page }, info) => {
    await mockGanttData(page);
    const rows = cases.filter((item) => surface === "home" || item.status !== "pending_acceptance");
    await page.route("**/api/dashboard**", (route) => route.fulfill({ json: {
      summary: { total: rows.length, active: rows.length, completed: 1, delayed: 0, highRisk: 0, completionRate: 0 },
      requirements: rows.map((item) => ({ ...requirement, ...item, id: item.status, title: item.status, asOfDate: "2026-09-14", effectiveEnd: item.actualEnd || "2026-09-10", workItems: [], riskLevel: "low", progressGap: 0 })),
      issues: { summary: { total: 0 }, attention: [] }, charts: { statuses: [], risks: [], weeks: [], varianceTop: [] },
    } }));
    await page.route("**/api/requirements/r1", (route) => route.fulfill({ json: {
      ...requirement, asOfDate: "2026-09-14", workItems: rows.map((item) => ({ ...workItem, ...item, status: item.status === "planning" ? "not_started" : item.status, id: item.status, title: item.status, milestoneLabel: null, cancelledAt: "2026-09-03" })),
    } }));
    await page.goto(surface === "home" ? "/" : "/requirements/r1");
    if (mode === "split") {
      await page.getByRole("button", { name: /^甘特显示方式/ }).click();
      const menu = (await page.locator(".gantt-view-options").boundingBox())!;
      const sidebar = (await page.locator(".sidebar").boundingBox())!;
      expect(menu.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width);
      expect(menu.x + menu.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      await page.getByRole("button", { name: "计划·实际双轨", exact: true }).click();
    }
    const barSelector = mode === "split" ? ".gantt-date-actual" : surface === "home" ? ".unified-gantt-progress-actual" : ".unified-gantt-actual";
    const markerSelector = mode === "split" ? ".gantt-date-progress" : ".gantt-progress-marker";
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
      await expect(page.locator(`${markerSelector}.gantt-status-in-progress`)).toContainText("100");
      if (mode === "overlay") {
        await expect(page.locator(`${markerSelector}.gantt-status-completed`)).toHaveCSS("background-color", green);
        await expect(page.locator(`${markerSelector}.gantt-status-in-progress`)).toHaveCSS("background-color", blue);
      }
      await expect(bar("blocked")).toHaveCSS("background-color", dark ? "rgb(205, 166, 88)" : "rgb(145, 99, 20)");
      await expect(bar("blocked")).not.toHaveCSS("background-image", "none");
      await expect(bar("cancelled")).toHaveCSS("background-color", dark ? "rgb(150, 157, 169)" : "rgb(104, 113, 129)");
      await expect(bar("cancelled")).not.toHaveCSS("background-image", "none");
      await expect(page.locator(`${barSelector}.gantt-status-planning,${barSelector}.gantt-status-not-started`)).toHaveCount(0);
      const completedRow = surface === "home" ? page.locator(".gantt-row").filter({ has: bar("completed") }) : page.locator('[data-work-item-id="completed"]');
      await expect(completedRow.locator(mode === "split" ? ".gantt-date-delay" : ".unified-gantt-delay")).toHaveCSS("border-top-color", red);
      if (mode === "overlay") await expect(completedRow.locator(".unified-gantt-delay")).toHaveCSS("background-color", green);
      if (surface === "home") {
        await expect(bar("pending-acceptance")).toHaveCSS("background-color", green);
        if (mode === "split") await expect(page.locator(".gantt-date-progress.gantt-status-pending-acceptance")).toHaveText("100% · 待验收");
        else await expect(page.locator(".gantt-progress-marker.gantt-status-pending-acceptance")).toHaveAttribute("aria-label", /待验收/);
      }
      if (surface === "home" && info.project.name === "desktop-1080p") await page.screenshot({ path: info.outputPath(`${skin}-${mode}-states.png`), animations: "disabled" });
    }
  });
}
