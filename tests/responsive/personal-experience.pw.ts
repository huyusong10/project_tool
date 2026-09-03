import { expect, test, type Page, type Route } from "@playwright/test";

const workItem = {
  id: "w1", requirementId: "r1", templateItemId: null, title: "SDS 文档编写", ownerId: "person-1", ownerName: "胡宇松",
  collaborators: [], assigneeIds: ["person-1"], assigneeNames: ["胡宇松"], status: "in_progress",
  plannedStart: "2026-09-01", plannedEnd: "2026-09-09", actualStart: "2026-09-02", actualEnd: null,
  forecastEnd: null, blockedAt: null, blockedReason: null, milestoneLabel: null, progress: 40, sortOrder: 0,
  version: 1, createdAt: "2026-09-01T08:00:00.000Z", updatedAt: "2026-09-03T08:00:00.000Z",
  projectId: "p1", projectName: "DCIM", requirementTitle: "SDS 软件架构文档基线", assignmentType: "owner", overdue: false,
};

async function mockPersonalExperience(page: Page) {
  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const json = (value: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(value) });
    if (url.pathname === "/api/session") return json({ authenticated: true, accountId: "a1", username: "胡宇松", role: "project_manager", globalRole: "user", personId: "person-1", mustChangePassword: false, managedProjectIds: ["p1"] });
    if (url.pathname === "/api/projects") return json([{ id: "p1", name: "DCIM", status: "active", plannedStart: "2026-08-01", plannedEnd: "2026-10-31", defaultTemplateId: null, createdAt: "2026-08-01", updatedAt: "2026-09-03" }]);
    if (url.pathname === "/api/dashboard") return json({
      summary: { total: 1, active: 1, completed: 0, delayed: 0, highRisk: 1, completionRate: 0 },
      requirements: [{
        id: "r1", projectId: "p1", projectName: "DCIM", templateId: null, templateName: null, title: "SDS 软件架构文档基线",
        ownerId: "person-1", ownerName: "胡宇松", status: "in_progress", plannedStart: "2026-09-01", plannedEnd: "2026-09-09",
        progress: 40, plannedProgress: 35, progressGap: 0, riskLevel: "high", riskEvaluated: true, riskReason: "存在阻塞项", priority: "P1",
        createdAt: "2026-09-01", updatedAt: "2026-09-03", workItems: [workItem], recentProgressUpdates: [], delayed: false, highRisk: true,
        finishVariance: 0, durationVariance: 0, effectiveEnd: "2026-09-09", issueSummary: { active: 0, overdue: 0 }, asOfDate: "2026-09-03",
      }],
      issues: { summary: { total: 0, inProgress: 0, deferred: 0, resolved: 0, active: 0, highPriority: 0, overdue: 0, unassigned: 0, closureRate: 0 }, attention: [] },
      actions: { items: [{ id: "requirement:r1", sourceType: "requirement", sourceId: "r1", projectId: "p1", requirementId: "r1", contextTitle: null, title: "SDS 软件架构文档基线", severity: "high", reasons: [{ code: "high_risk", label: "高风险" }], reasonCodes: ["high_risk"], ownerId: "person-1", ownerName: "胡宇松", dueDate: "2026-09-09", overdueWorkdays: 0, targetPath: "/requirements/r1", updatedAt: "2026-09-03" }], total: 1, page: 1, pageSize: 5, pages: 1, summary: { total: 1, high: 1, medium: 0, low: 0, byReason: { high_risk: 1 } } },
      charts: { statuses: [], risks: [], weeks: [], varianceTop: [] },
    });
    if (url.pathname === "/api/my-work") return json({
      summary: { total: 1, notStarted: 0, inProgress: 1, blocked: 0, completed: 0, overdue: 0 }, requirements: [], items: [workItem],
      completionTrend: [], upcoming: [], recentProgress: [],
    });
    if (url.pathname === "/api/tokens" && route.request().method() === "POST") return json({ id: "t1", name: "Claude Desktop", prefix: "1234567890", token: "pm_1234567890_secret", expiresAt: "2026-12-02T00:00:00.000Z", createdAt: "2026-09-03T00:00:00.000Z" });
    if (url.pathname === "/api/tokens") return json([]);
    return json({});
  });
}

test("项目看板、我的工作和个人设置采用新的信息层级", async ({ page }, testInfo) => {
  test.skip(!["laptop-1366", "desktop-1080p", "desktop-qhd"].includes(testInfo.project.name), "代表性桌面视口已覆盖本组体验验证");
  await mockPersonalExperience(page);

  await page.goto("/");
  const gantt = await page.locator(".project-gantt-panel").boundingBox();
  const issue = await page.locator(".dashboard-issue-health").boundingBox();
  const actions = await page.locator(".dashboard-actions").boundingBox();
  expect(gantt).not.toBeNull();
  expect(issue).not.toBeNull();
  expect(actions).not.toBeNull();
  expect(actions!.y).toBeGreaterThan(issue!.y);
  expect(actions!.y).toBeGreaterThan(gantt!.y);

  await page.goto("/my-work");
  await expect(page.getByRole("table", { name: "分配给我的工作项甘特图" })).toBeVisible();
  await expect(page.locator(".my-work-list .unified-gantt-plan")).toHaveCount(1);
  await expect(page.locator(".my-work-list .gantt-progress-marker")).toHaveText("40");
  await expect(page.getByRole("button", { name: "为SDS 文档编写写进展" })).toBeVisible();
  await expect(page.locator(".my-work-dates")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "胡宇松", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "MCP 接入", exact: true })).toBeVisible();
  await expect(page.getByText("/mcp", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "创建第一个 Token" }).click();
  const dialog = page.getByRole("dialog", { name: "创建 MCP Token" });
  await dialog.getByLabel("Token 名称").fill("Claude Desktop");
  await dialog.getByRole("button", { name: "创建 Token" }).click();
  await expect(dialog.getByText("Token 已创建，只显示这一次")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "复制 Token" })).toBeVisible();
});
