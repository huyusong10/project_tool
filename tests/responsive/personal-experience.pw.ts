import { expect, test, type Page, type Route } from "@playwright/test";
import type { MyWorkItem } from "../../src/client/types";
import {mockGanttReport,requirement as baseRequirement} from './gantt-fixture';

const workItem: MyWorkItem = {
  id: "w1", requirementId: "r1", templateItemId: null, title: "SDS 文档编写", ownerId: "person-1", ownerName: "胡宇松",
  collaborators: [], assigneeIds: ["person-1"], assigneeNames: ["胡宇松"], status: "in_progress",
  plannedStart: "2026-09-01", plannedEnd: "2026-09-09", actualStart: "2026-09-02", actualEnd: null,
  forecastEnd: null, blockedAt: null, blockedReason: null, milestoneLabel: null, progress: 40, sortOrder: 0,
  version: 1, createdAt: "2026-09-01T08:00:00.000Z", updatedAt: "2026-09-03T08:00:00.000Z",
  projectId: "p1", projectName: "DCIM", requirementTitle: "SDS 软件架构文档基线", requirementStatus: "in_progress", assignmentType: "owner", overdue: false,
};

async function mockPersonalExperience(page: Page, personalItem = workItem, asOfDate = "2026-09-03", requirementAsOfDate = asOfDate) {
  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const json = (value: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(value) });
    if (url.pathname === "/api/session") return json({ authenticated: true, accountId: "a1", username: "胡宇松", role: "project_manager", globalRole: "user", personId: "person-1", mustChangePassword: false, managedProjectIds: ["p1"] });
    if (url.pathname === "/api/projects") return json([{ id: "p1", name: "DCIM", status: "active", plannedStart: "2026-08-01", plannedEnd: "2026-10-31", defaultTemplateId: null, createdAt: "2026-08-01", updatedAt: "2026-09-03" }]);
    if (url.pathname === "/api/people") return json([]);
    if (url.pathname === "/api/dashboard") return json({
      asOfDate,
      summary: { total: 1, active: 1, completed: 0, delayed: 0, highRisk: 1, completionRate: 0 },
      requirements: [{
        id: "r1", projectId: "p1", projectName: "DCIM", templateId: null, templateName: null, title: "SDS 软件架构文档基线",
        ownerId: "person-1", ownerName: "胡宇松", status: "in_progress", plannedStart: "2026-09-01", plannedEnd: "2026-09-09",
        progress: 40, plannedProgress: 35, progressGap: 0, riskLevel: "high", riskEvaluated: true, riskReason: "存在阻塞项", priority: "P1",
        createdAt: "2026-09-01", updatedAt: "2026-09-03", workItems: [workItem], recentProgressUpdates: [], delayed: false, highRisk: true,
        finishVariance: 0, durationVariance: 0, effectiveEnd: "2026-09-09", issueSummary: { active: 0, overdue: 0 }, asOfDate: requirementAsOfDate,
      }],
      issues: { summary: { total: 0, inProgress: 0, deferred: 0, resolved: 0, active: 0, highPriority: 0, overdue: 0, unassigned: 0, closureRate: 0 }, attention: [] },
      actions: { items: [{ id: "requirement:r1", sourceType: "requirement", sourceId: "r1", projectId: "p1", requirementId: "r1", contextTitle: null, title: "SDS 软件架构文档基线", severity: "high", reasons: [{ code: "high_risk", label: "高风险" }], reasonCodes: ["high_risk"], ownerId: "person-1", ownerName: "胡宇松", dueDate: "2026-09-09", overdueWorkdays: 0, targetPath: "/requirements/r1", updatedAt: "2026-09-03" }], total: 1, page: 1, pageSize: 5, pages: 1, summary: { total: 1, high: 1, medium: 0, low: 0, byReason: { high_risk: 1 } } },
      charts: { statuses: [], risks: [], weeks: [], varianceTop: [] },
    });
    if (url.pathname === "/api/my-work") return json({
      asOfDate,
      summary: { total: 1, notStarted: 0, inProgress: 1, blocked: 0, completed: 0, overdue: 0 }, requirements: [], items: [personalItem],
      completionTrend: [], upcoming: [], recentProgress: [],
    });
    if (url.pathname === "/api/tokens" && route.request().method() === "POST") return json({ id: "t1", name: "Claude Desktop", prefix: "1234567890", token: "pm_1234567890_secret", expiresAt: "2026-12-02T00:00:00.000Z", createdAt: "2026-09-03T00:00:00.000Z" });
    if (url.pathname === "/api/tokens") return json([]);
    return json({});
  });
  const current={...baseRequirement,title:'SDS 软件架构文档基线',ownerId:'person-1',ownerName:'胡宇松',workItems:[personalItem],asOfDate:requirementAsOfDate,actualStart:personalItem.actualStart,observationEnd:asOfDate};
  await mockGanttReport(page,()=>[current],()=>asOfDate);
  await page.route('**/api/requirements/r1',route=>route.fulfill({json:current}));
}

test("项目看板、我的工作和个人设置采用新的信息层级", async ({ page }) => {

  await mockPersonalExperience(page);

  await page.goto("/execution");await expect(page.getByRole('region',{name:'当前范围概览'})).toBeVisible();
  await expect(page.getByRole('treegrid')).toBeVisible();await page.getByRole('button',{name:'展开全部',exact:true}).click();
  await expect(page.locator('[data-row-id="r1"] .workspace-row-title')).toHaveText('SDS 软件架构文档基线');

  await page.goto("/my-work");
  await expect(page.getByRole("table", { name: "分配给我的工作项甘特图" })).toBeVisible();
  await expect(page.locator(".my-work-list .unified-gantt-plan")).toHaveCount(1);
  await expect(page.locator(".my-work-list .gantt-progress-marker")).toHaveText("40");
  await expect(page.getByRole("button", { name: "为SDS 文档编写更新进度" })).toBeVisible();
  await expect(page.locator(".my-work-dates")).toHaveCount(0);
  await page.getByRole("button", { name: "SDS 文档编写", exact: true }).click();
  await expect(page).toHaveURL(/\/requirements\/r1\?workItemId=w1$/);
  await page.goto("/my-work");

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

test("我的工作空筛选、拖动卡片高度及刷新恢复布局",{tag:'@responsive'},async({page})=>{
 await mockPersonalExperience(page);await page.goto('/my-work');
 await expect(page.getByRole('table',{name:'分配给我的工作项甘特图'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width+1);
  const workPanel = page.locator(".my-work-list");
  const charts = page.locator(".my-work-charts");
  const panelBeforeEmpty = await workPanel.boundingBox();
  const chartsBeforeEmpty = await charts.boundingBox();
  await workPanel.getByRole("button", { name: "未开始", exact: true }).click();
  await expect(page.getByRole("table", { name: "分配给我的工作项甘特图" })).toBeVisible();
  await expect(page.locator(".requirement-gantt-filter-empty")).toContainText("当前筛选下没有工作项");
  const panelAfterEmpty = await workPanel.boundingBox();
  const chartsAfterEmpty = await charts.boundingBox();
  expect(Math.abs(panelAfterEmpty!.height - panelBeforeEmpty!.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(chartsAfterEmpty!.y - chartsBeforeEmpty!.y)).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "查看全部", exact: true }).click();
  await expect(page.locator(".my-work-list .unified-gantt-plan")).toHaveCount(1);

  const initialPanel = await workPanel.boundingBox();
  const resizeHandle = workPanel.getByRole("button", { name: "调整卡片高度" });
  const handleBox = await resizeHandle.boundingBox();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2 + 64);
  await page.mouse.up();
  const resizedPanel = await workPanel.boundingBox();
  expect(resizedPanel!.height).toBeGreaterThan(initialPanel!.height + 40);
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("project-manage:panel-height:a1:my-work-gantt"))).not.toBeNull();
  await page.reload();
  const restoredPanel = await page.locator(".my-work-list").boundingBox();
  expect(Math.abs(restoredPanel!.height - resizedPanel!.height)).toBeLessThanOrEqual(1);
  await page.locator(".my-work-list").getByRole("button", { name: "调整卡片高度" }).dblclick();
  const resetPanel = await page.locator(".my-work-list").boundingBox();
  expect(Math.abs(resetPanel!.height - initialPanel!.height)).toBeLessThanOrEqual(1);
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("project-manage:panel-height:a1:my-work-gantt"))).toBeNull();


});

test("个人设置在页面保持打开时自动更新 Token 到期状态", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-05T00:00:00.000Z") });
  await mockPersonalExperience(page);
  await page.route("**/api/tokens", (route) => route.fulfill({ json: [{
    id: "expiring", name: "即将到期", prefix: "1234567890", accountId: "a1", accountName: "胡宇松",
    expiresAt: "2026-09-05T00:01:00.000Z", lastUsedAt: null, revokedAt: null, createdAt: "2026-09-04T00:00:00.000Z",
  }] }));

  await page.goto("/settings");
  const row = page.getByRole("row").filter({ hasText: "即将到期" });
  await expect(row.getByText("有效", { exact: true })).toBeVisible();
  await expect(page.getByText("1 个有效 Token", { exact: true })).toBeVisible();

  await page.clock.fastForward(120_000);
  await expect(row.getByText("已过期", { exact: true })).toBeVisible();
  await expect(page.getByText("0 个有效 Token", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "撤销", exact: true })).toHaveCount(0);
});

test("我的工作允许未排期工作项开始并明确显示待排期", async ({ page }) => {
  await mockPersonalExperience(page, {
    ...workItem, status: "not_started", progress: 0, actualStart: null, plannedStart: null, plannedEnd: null, requirementStatus: "not_started",
  });
  await page.goto('/my-work');
  await expect(page.getByRole('button', { name: '开始', exact: true })).toBeEnabled();
  await expect(page.locator('.my-work-list .gantt-unscheduled')).toHaveText('待排期');
  await expect(page.getByRole('button', { name: '暂不可开始', exact: true })).toHaveCount(0);
});

test('我的工作响应未知且回读失败时切换筛选仍保留写入锁', async ({ page }) => {
  const pendingItem: MyWorkItem = {
    ...workItem,
    status: 'not_started',
    progress: 0,
    actualStart: null,
    requirementStatus: 'not_started',
  };
  await mockPersonalExperience(page, pendingItem);
  let failRead = false;
  let submissions = 0;
  const response = {
    asOfDate: '2026-09-03',
    summary: { total: 1, notStarted: 1, inProgress: 0, blocked: 0, completed: 0, overdue: 0 },
    requirements: [],
    items: [pendingItem],
    completionTrend: [],
    upcoming: [],
    recentProgress: [],
  };
  await page.route('**/api/my-work', (route) => failRead
    ? route.fulfill({ status: 503, json: { error: '我的工作读取暂不可用' } })
    : route.fulfill({ json: response }));
  await page.route('**/api/work-items/w1/start', (route) => {
    submissions += 1;
    failRead = true;
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'started' });
  });

  await page.goto('/my-work');
  await page.getByRole('button', { name: '开始', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '工作项操作结果待核对' })).toBeVisible();
  await page.getByRole('button', { name: '进行中', exact: true }).click();
  await expect(page.getByText('当前筛选下没有工作项', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '全部', exact: true }).click();
  await expect(page.getByRole('button', { name: '重新读取工作项', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '开始', exact: true })).toHaveCount(0);
  expect(submissions).toBe(1);

  failRead = false;
  await page.getByRole('button', { name: '重新读取工作项', exact: true }).click();
  await page.getByRole('button', { name: '已核对，结束本次操作', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始', exact: true })).toBeEnabled();
  expect(submissions).toBe(1);
});

test("我的工作甘特使用响应业务日期", async ({ page }) => {
  await mockPersonalExperience(page, {
    ...workItem,
    plannedStart: "2026-09-01",
    plannedEnd: "2026-09-02",
    actualStart: "2026-09-01",
  });
  await page.goto("/my-work");
  await page.locator(".my-work-list .gantt-bar-hitbox").focus();
  await expect(page.locator(".gantt-popover-metrics")).toContainText("+1个工作日 / +1个工作日");
  await expect(page.locator(".my-work-list").getByTitle("截至 2026-09-03", { exact: true })).toBeVisible();
});

test("我的工作空排期甘特仍显示响应业务日期", async ({ page }) => {
  await mockPersonalExperience(page, {
    ...workItem,
    status: "not_started",
    plannedStart: null,
    plannedEnd: null,
    actualStart: null,
  }, "2026-02-16");
  await page.goto("/my-work");
  await expect(page.locator(".my-work-list").getByTitle("截至 2026-02-16", { exact: true })).toBeVisible();
  await expect(page.locator(".my-work-list .gantt-unscheduled")).toHaveText("待排期");
});

test("主页甘特使用仪表盘顶层业务日期", async ({ page }) => {
  await mockPersonalExperience(page, workItem, "2026-02-16", "2026-09-03");
  await page.goto("/execution");
  await page.getByRole('button',{name:'展开全部',exact:true}).click();await page.locator('[data-row-id="r1"] .workspace-row-title').focus();
  await expect(page.getByRole('tooltip')).toContainText('截至 2026-02-16');await expect(page.getByRole('tooltip')).not.toContainText('截至 2026-09-03');
});

test("人力分析首屏使用服务端业务日期窗口", async ({ page }) => {
  await mockPersonalExperience(page);
  const requests: string[] = [];
  await page.route("**/api/analytics/people-concurrency?*", (route) => {
    requests.push(route.request().url());
    return route.fulfill({ json: {
      asOfDate: "2026-02-16",
      from: "2026-02-16",
      to: "2026-02-22",
      dates: ["2026-02-16", "2026-02-24", "2026-02-25", "2026-02-26", "2026-02-27"],
      people: [],
      currentTop: [],
    } });
  });
  await page.goto("/people?view=analysis");
  await expect(page.locator(".human-matrix-heading strong")).toHaveText("02月16日—02月22日");
  await expect.poll(() => requests.length).toBeGreaterThanOrEqual(1);
  const firstRequest = new URL(requests[0]);
  expect(firstRequest.searchParams.has("from")).toBe(false);
  expect(firstRequest.searchParams.has("to")).toBe(false);
});
