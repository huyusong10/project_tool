import { expect, test, type Page, type Route } from "@playwright/test";

const workItem = {
  id: "w1", requirementId: "r1", templateItemId: "ti1", title: "接口开发", ownerId: "u1", ownerName: "张三",
  collaborators: [], assigneeIds: ["u1"], assigneeNames: ["张三"], status: "in_progress",
  plannedStart: "2026-09-01", plannedEnd: "2026-09-10", actualStart: "2026-09-01", actualEnd: null,
  forecastEnd: null, blockedAt: null, blockedReason: null, progress: 40, sortOrder: 0,
  createdAt: "2026-09-01", updatedAt: "2026-09-02",
};

const requirement = {
  id: "r1", projectId: "p1", projectName: "测试项目", templateId: "t1", templateName: "研发流程",
  title: "统一甘特样式", ownerId: null, ownerName: null, status: "in_progress", plannedStart: "2026-09-01",
  plannedEnd: "2026-09-10", progress: 40, plannedProgress: 25, progressGap: -15, riskLevel: "low",
  riskEvaluated: true, riskReason: "进展正常", priority: "P1", createdAt: "2026-09-01", updatedAt: "2026-09-02",
  workItems: [workItem], progressUpdates: [], recentProgressUpdates: [], delayed: false, highRisk: false,
  finishVariance: 0, durationVariance: 0, effectiveEnd: "2026-09-10", issueSummary: { active: 0, overdue: 0 },
};

async function mockGanttData(page: Page) {
  await page.route("**/api/**", async (route: Route) => {
    const pathname = new URL(route.request().url()).pathname;
    const json = (value: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(value) });
    if (pathname === "/api/session") return json({ authenticated: true, accountId: "admin", username: "admin", role: "admin", globalRole: "admin", personId: null, mustChangePassword: false, managedProjectIds: [] });
    if (pathname === "/api/projects") return json([{ id: "p1", name: "测试项目", status: "active", plannedStart: "2026-09-01", plannedEnd: "2026-09-30", defaultTemplateId: "t1", createdAt: "2026-09-01", updatedAt: "2026-09-01" }]);
    if (pathname === "/api/dashboard") return json({
      summary: { total: 2, active: 2, completed: 0, delayed: 0, highRisk: 0, completionRate: 0 },
      requirements: [requirement, { ...requirement, id: "r2", title: "相同八日流程", workItems: [{ ...workItem, id: "w2", requirementId: "r2" }] }],
      issues: { summary: { total: 0, open: 0, inProgress: 0, deferred: 0, resolved: 0, active: 0, highPriority: 0, overdue: 0, unassigned: 0, closureRate: 0 }, attention: [] },
      charts: { statuses: [], risks: [], weeks: [], varianceTop: [] },
    });
    if (pathname === "/api/requirements/r1") return json(requirement);
    if (pathname === "/api/templates") return json([]);
    if (pathname === "/api/people") return json([]);
    return json({});
  });
}

test("项目与需求甘特共用日刻度和计划实际状态样式", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1080p", "统一甘特图只需在主桌面视口专项验证");
  await mockGanttData(page);

  await page.goto("/");
  await expect(page.locator(".project-gantt-grid")).toBeVisible();
  await expect(page.locator(".project-gantt-toolbar .view-tabs button.active")).toHaveText("日");
  await expect(page.locator(".project-gantt-grid .unified-gantt-plan")).toHaveCount(2);
  await expect(page.locator(".project-gantt-grid .unified-gantt-actual")).toHaveCount(2);
  await expect(page.locator(".project-gantt-grid .unified-gantt-plan-end")).toHaveCount(2);
  await expect(page.locator(".project-gantt-grid .unified-gantt-label").first()).toHaveText("进行中 · 实际进度 40%");
  const projectWidths = await page.locator(".project-gantt-grid .unified-gantt-plan").evaluateAll((bars) => bars.map((bar) => bar.getBoundingClientRect().width));
  expect(Math.abs(projectWidths[0] - projectWidths[1])).toBeLessThanOrEqual(1);
  await expect(page.locator(".project-gantt-grid .gantt-scale-tick", { hasText: /周六|周日/ })).toHaveCount(0);

  await page.goto("/requirements/r1");
  await expect(page.locator(".requirement-gantt-grid")).toBeVisible();
  await expect(page.locator(".requirement-gantt-toolbar .view-tabs button.active")).toHaveText("日");
  await expect(page.locator(".requirement-gantt-grid .unified-gantt-plan")).toHaveCount(1);
  await expect(page.locator(".requirement-gantt-grid .unified-gantt-actual")).toHaveCount(1);
  await expect(page.locator(".requirement-gantt-grid .unified-gantt-plan-end")).toHaveCount(1);
  await expect(page.locator(".requirement-gantt-grid .unified-gantt-label")).toHaveText("进行中 · 实际进度 40%");
  await expect(page.locator(".requirement-gantt-grid .gantt-scale-tick", { hasText: /周六|周日/ })).toHaveCount(0);
});
