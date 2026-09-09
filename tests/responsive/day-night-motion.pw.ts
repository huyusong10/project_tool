import { expect, test, type Page } from "@playwright/test";
import { mockGanttData, requirement } from "./gantt-fixture";

async function choose(page: Page, name: string) {
  await page.getByRole("button", { name: /^切换风格/ }).click();
  await page.getByRole("menuitemradio", { name: new RegExp("^" + name) }).click();
}

test("系统日夜切换保留筛选、滚动与草稿；手选风格不被覆盖", async ({ page }) => {
  await mockGanttData(page);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "classic");
  const search = page.locator(".gantt-filter-search input");
  await search.fill("统一甘特");
  const scroll = page.locator(".project-gantt-scroll");
  await expect(scroll).toHaveAttribute('data-gantt-ready', 'true');
  const visibleAnchor = () => scroll.evaluate(e => {
    const boundary = e.getBoundingClientRect().left + (e.querySelector('[data-gantt-fixed]')?.getBoundingClientRect().width || 0);
    const tick = [...e.querySelectorAll<HTMLElement>('[data-date]')].find(t => t.getBoundingClientRect().right > boundary + 1);
    return { date: tick?.dataset.date, offset: Math.round((tick?.getBoundingClientRect().left || 0) - boundary) };
  });
  await scroll.evaluate((e) => { e.scrollLeft = 80; });
  const before = await visibleAnchor();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dcim");
  await expect(search).toHaveValue("统一甘特");
  // 自动补入左侧日期会改变 scrollLeft；屏幕上的日期与位置应保持不变。
  await expect.poll(visibleAnchor).toEqual(before);
  await choose(page, "经典蓝白");
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "classic");
  await choose(page, "跟随系统");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dcim");
  await page.goto("/requirements/r1");
  await page.getByRole("button", { name: /编辑信息/ }).click();
  const title = page.getByRole("dialog").getByLabel("需求标题", { exact: true });
  await title.fill("日夜切换前的未提交草稿");
  const writes: string[] = [];
  page.on("request", (r) => { if (r.method() !== "GET") writes.push(r.url()); });
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "classic");
  await expect(title).toHaveValue("日夜切换前的未提交草稿");
  expect(writes).toEqual([]);
});

test("日夜偏好跨标签同步，菜单可见且可用键盘选择", async ({ page, context }) => {
  await mockGanttData(page);
  await page.goto("/");
  const second = await context.newPage();
  await mockGanttData(second);
  await second.goto("/");
  await choose(page, "柔彩悬浮");
  await expect(second.locator("html")).toHaveAttribute("data-theme", "soft");
  await second.emulateMedia({ colorScheme: "dark" });
  await expect(second.locator("html")).toHaveAttribute("data-theme", "soft");
  await choose(page, "跟随系统");
  await expect(second.locator("html")).toHaveAttribute("data-theme", "dcim");
  await second.getByRole("button", { name: /^切换风格/ }).click();
  await expect(second.getByRole("menuitemradio")).toHaveCount(8);
  await expect(second.getByRole("menuitemradio", { name: /跟随系统/ })).toHaveAttribute("aria-checked", "true");
  const menu = (await second.locator(".theme-menu").boundingBox())!;
  expect(menu.y + menu.height).toBeLessThanOrEqual(second.viewportSize()!.height);
  await second.keyboard.press("End");
  await second.keyboard.press("Enter");
  await expect(second.locator("html")).toHaveAttribute("data-theme", "industrial");
  await expect(second.getByRole("button", { name: /^切换风格/ })).toBeFocused();
});

test("减少动态效果覆盖菜单、图表与今天定位；换肤复用画布", async ({ page }) => {
  await mockGanttData(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route("**/api/requirements/r1", (route) => route.fulfill({ json: {
    ...requirement, progressUpdates: [{ id: "u1", percent: 40, content: "进展", createdAt: "2026-09-02T10:00:00Z", eventType: "progress" }],
  } }));
  await page.goto("/requirements/r1");
  const chart = page.getByRole("img", { name: "需求计划与实际进度趋势", exact: true });
  await expect(chart).toHaveAttribute("data-chart-motion", "short");
  const canvas = await chart.locator("canvas").elementHandle();
  await choose(page, "柔彩悬浮");
  await expect(chart).toHaveAttribute("data-chart-motion", "none");
  expect(await canvas!.evaluate((e) => e.isConnected)).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: /^切换风格/ }).click();
  await expect(page.locator(".theme-menu")).toHaveCSS("animation-name", "none");
  await page.keyboard.press("Escape");
  await expect(chart).toHaveAttribute("data-chart-motion", "none");
  await page.locator(".requirement-gantt-scroll").evaluate((e) => {
    const original = e.scrollTo.bind(e);
    e.scrollTo = (options: ScrollToOptions | number = {}, y?: number) => {
      if (typeof options === "object") { e.setAttribute("data-scroll-behavior", options.behavior || "auto"); original(options); }
      else original(options, y || 0);
    };
  });
  await page.getByRole("button", { name: "今天", exact: true }).click();
  await expect(page.locator(".requirement-gantt-scroll")).toHaveAttribute("data-scroll-behavior", "auto");
});

test("密集图表与甘特无持续动画，侧栏一次落位", async ({ page }) => {
  await mockGanttData(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route("**/api/requirements/r1", (route) => route.fulfill({ json: {
    ...requirement, progressUpdates: Array.from({ length: 150 }, (_, i) => ({ id: `update-${i}`, percent: i % 100, content: "测试进展", eventType: "progress", createdAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString() })),
  } }));
  await page.goto("/requirements/r1");
  await expect(page.getByRole("img", { name: "需求计划与实际进度趋势", exact: true })).toHaveAttribute("data-chart-motion", "none");
  await expect(page.locator(".sidebar")).toHaveCSS("transition-duration", "0s");
  await expect(page.locator(".unified-gantt-actual").first()).toHaveCSS("animation-name", "none");
  await expect(page.locator(".unified-gantt-actual").first()).toHaveCSS("transition-duration", "0s");
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length)).toBe(0);
});
