import { expect, test, type Page, type Route } from "@playwright/test";
import { isBusinessDay } from "../../src/shared/workday";

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

const workItem = {
  id: "w1", requirementId: "r1", templateItemId: "ti1", title: "接口开发", ownerId: "u1", ownerName: "张三",
  collaborators: [], assigneeIds: ["u1"], assigneeNames: ["张三"], status: "in_progress",
  plannedStart: "2026-09-01", plannedEnd: "2026-09-10", actualStart: "2026-09-01", actualEnd: null,
  forecastEnd: null, blockedAt: null, blockedReason: null, milestoneLabel: "接口基线", progress: 40, sortOrder: 0,
  version: 1, createdAt: "2026-09-01", updatedAt: "2026-09-02",
};

const requirement = {
  id: "r1", projectId: "p1", projectName: "测试项目", templateId: "t1", templateName: "研发流程",
  title: "统一甘特样式", ownerId: null, ownerName: null, status: "in_progress", plannedStart: "2026-09-01",
  plannedEnd: "2026-09-10", progress: 61, plannedProgress: 91, progressGap: 30, riskLevel: "medium",
  asOfDate: "2026-09-03",
  riskEvaluated: true, riskReason: "P1进度Gap 30%", priority: "P1", createdAt: "2026-09-01", updatedAt: "2026-09-02",
  workItems: [workItem], progressUpdates: [], recentProgressUpdates: [{
    id: "u1", requirementId: "r1", workItemId: "w1", workItemTitle: "接口开发", percent: 61, workItemPercent: 40,
    content: "完成接口权限校验与异常分支联调，补充回归场景并记录后续优化建议，等待产品侧确认边界。",
    createdAt: "2026-09-02T10:00:00.000Z", updatedAt: "2026-09-02T10:00:00.000Z",
  }], delayed: false, highRisk: false,
  finishVariance: 0, durationVariance: 0, effectiveEnd: "2026-09-10", issueSummary: { active: 0, overdue: 0 },
};

async function mockGanttData(page: Page, progressRequests: Array<Record<string, unknown>> = []) {
  await page.route("**/api/**", async (route: Route) => {
    const pathname = new URL(route.request().url()).pathname;
    const json = (value: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(value) });
    if (pathname === "/api/session") return json({ authenticated: true, accountId: "admin", username: "admin", role: "admin", globalRole: "admin", personId: null, mustChangePassword: false, managedProjectIds: [] });
    if (pathname === "/api/projects") return json([{ id: "p1", name: "测试项目", status: "active", plannedStart: "2026-09-01", plannedEnd: "2026-09-30", defaultTemplateId: "t1", createdAt: "2026-09-01", updatedAt: "2026-09-01" }]);
    if (pathname === "/api/dashboard") return json({
      summary: { total: 2, active: 2, completed: 0, delayed: 0, highRisk: 0, completionRate: 0 },
      requirements: [requirement, { ...requirement, id: "r2", title: "领先计划流程", progress: 70, plannedProgress: 50, progressGap: 0, riskLevel: "low", riskReason: "进展正常", workItems: [
        { ...workItem, id: "w2", requirementId: "r2", plannedEnd: "2026-09-09", milestoneLabel: "方案评审" },
        { ...workItem, id: "w3", requirementId: "r2", plannedEnd: "2026-09-10", milestoneLabel: "验收通过" },
        { ...workItem, id: "w4", requirementId: "r2", plannedEnd: "2026-09-10", milestoneLabel: "正式上线" },
      ] }],
      issues: { summary: { total: 0, inProgress: 0, deferred: 0, resolved: 0, active: 0, highPriority: 0, overdue: 0, unassigned: 0, closureRate: 0 }, attention: [] },
      charts: { statuses: [], risks: [], weeks: [], varianceTop: [] },
    });
    if (pathname === "/api/requirements/r1/progress" && route.request().method() === "POST") {
      progressRequests.push(route.request().postDataJSON() as Record<string, unknown>);
      return json(requirement);
    }
    if (pathname === "/api/requirements/r1") return json(requirement);
    if (pathname === "/api/templates") return json([]);
    if (pathname === "/api/people") return json([]);
    return json({});
  });
}

test("项目与需求甘特统一展示状态进度及今日进度差", async ({ page }, testInfo) => {
  test.skip(!["laptop-1366", "hidpi-3k-200", "desktop-1080p"].includes(testInfo.project.name), "统一甘特图仅验证代表性桌面视口");
  const progressRequests: Array<Record<string, unknown>> = [];
  await mockGanttData(page, progressRequests);

  await page.goto("/");
  await expect(page.locator(".project-gantt-grid")).toBeVisible();
  await expect(page.locator(".project-gantt-toolbar .view-tabs button.active")).toHaveText("日");
  await expect(page.locator(".project-gantt-grid .unified-gantt-plan")).toHaveCount(2);
  await expect(page.locator(".project-gantt-grid .unified-gantt-progress-actual")).toHaveCount(2);
  await expect(page.locator(".project-gantt-grid .unified-gantt-progress-gap.is-behind")).toHaveCount(1);
  await expect(page.locator(".project-gantt-grid .unified-gantt-progress-gap.is-behind")).toHaveText("落后 30%");
  await expect(page.locator(".project-gantt-grid .unified-gantt-progress-gap.is-ahead")).toHaveCount(1);
  await expect(page.locator(".project-gantt-grid .unified-gantt-progress-target")).toHaveCount(0);
  await expect(page.locator(".project-gantt-grid .unified-gantt-plan-end")).toHaveCount(2);
  await expect(page.locator(".project-gantt-grid .unified-gantt-label")).toHaveCount(0);
  await expect(page.locator(".gantt-row").filter({ hasText: "统一甘特样式" }).locator(".gantt-progress-marker")).toHaveText("61");
  await expect(page.locator(".gantt-row").filter({ hasText: "领先计划流程" }).locator(".gantt-progress-marker")).toHaveText("70");
  await expect(page.getByText("中风险 · 落后30%", { exact: true })).toBeVisible();
  await expect(page.getByText("领先20%", { exact: true })).toBeVisible();
  const delayedRow = page.locator(".gantt-row").filter({ hasText: "统一甘特样式" });
  const todayLineBox = await delayedRow.locator(".gantt-today-line").boundingBox();
  const behindBox = await delayedRow.locator(".unified-gantt-progress-gap.is-behind").boundingBox();
  expect(todayLineBox).not.toBeNull();
  expect(behindBox).not.toBeNull();
  expect(Math.abs((behindBox!.x + behindBox!.width) - todayLineBox!.x)).toBeLessThanOrEqual(1.5);
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
  await expect(page.locator(".requirement-gantt-toolbar .view-tabs button.active")).toHaveText("日");
  await expect(page.locator(".requirement-gantt-grid .unified-gantt-plan")).toHaveCount(1);
  await expect(page.locator(".requirement-gantt-grid .unified-gantt-actual")).toHaveCount(1);
  await expect(page.locator(".requirement-gantt-grid .unified-gantt-plan-end")).toHaveCount(1);
  await expect(page.locator(".requirement-gantt-grid .unified-gantt-label")).toHaveCount(0);
  await expect(page.locator(".requirement-gantt-grid .gantt-progress-marker")).toHaveText("40");
  await expect(page.locator(".requirement-gantt-grid .gantt-milestone-marker")).toContainText("接口基线");
  await page.locator(".requirement-gantt-grid .gantt-progress-marker").click();
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
