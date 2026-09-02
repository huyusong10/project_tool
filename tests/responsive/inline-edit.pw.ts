import { expect, test, type Page, type Route } from "@playwright/test";
import type { Account, Issue, Person, Project, Requirement, WorkItem } from "../../src/client/types";

type Geometry = { tableWidth: number; rowWidth: number; rowHeight: number; cellWidth: number; cellHeight: number };

async function geometry(page: Page, tableSelector: string, rowIndex = 0, cellIndex = 0): Promise<Geometry> {
  return page.locator(tableSelector).evaluate((table, indexes) => {
    const actualTable = table as HTMLTableElement;
    const row = actualTable.tBodies[0]?.rows[indexes.rowIndex];
    const cell = row?.cells[indexes.cellIndex];
    if (!row || !cell) throw new Error("找不到几何测量目标");
    const tableBox = actualTable.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    const cellBox = cell.getBoundingClientRect();
    return { tableWidth: tableBox.width, rowWidth: rowBox.width, rowHeight: rowBox.height, cellWidth: cellBox.width, cellHeight: cellBox.height };
  }, { rowIndex, cellIndex });
}

function expectStable(before: Geometry, after: Geometry) {
  for (const key of Object.keys(before) as Array<keyof Geometry>) {
    expect(Math.abs(before[key] - after[key]), `${key} should remain stable`).toBeLessThanOrEqual(1);
  }
}

const project: Project = {
  id: "p1", name: "测试项目", status: "active", plannedStart: "2026-09-01", plannedEnd: "2026-09-30",
  defaultTemplateId: "t1", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
};
const people: Person[] = [
  { id: "u1", name: "张三", jobTitle: "前端工程师", active: 1, createdAt: "2026-09-01", updatedAt: "2026-09-01" },
  { id: "u2", name: "李四", jobTitle: "测试工程师", active: 1, createdAt: "2026-09-01", updatedAt: "2026-09-01" },
];
const workItem: WorkItem = {
  id: "w1", requirementId: "r1", templateItemId: "ti1", title: "设计", ownerId: null, ownerName: null,
  collaborators: [], assigneeIds: [], assigneeNames: [], status: "not_started", plannedStart: "2026-09-01",
  plannedEnd: "2026-09-03", actualStart: null, actualEnd: null, forecastEnd: null, blockedAt: null,
  blockedReason: null, milestoneLabel: "需求基线", progress: 0, sortOrder: 0, createdAt: "2026-09-01", updatedAt: "2026-09-01",
};
const requirement: Requirement = {
  id: "r1", projectId: "p1", projectName: "测试项目", templateId: "t1", templateName: "研发流程",
  title: "原需求", ownerId: null, ownerName: null, status: "not_started", plannedStart: "2026-09-01",
  plannedEnd: "2026-09-03", progress: 0, plannedProgress: 0, progressGap: 0, riskLevel: "low",
  riskEvaluated: true, riskReason: "", priority: "P2", createdAt: "2026-09-01", updatedAt: "2026-09-01",
  workItems: [workItem], progressUpdates: [], recentProgressUpdates: [], delayed: false, highRisk: false,
  finishVariance: 0, durationVariance: 0, effectiveEnd: "2026-09-03", issueSummary: { active: 0, overdue: 0 },
};
const issue: Issue = {
  id: "i1", projectId: "p1", projectName: "测试项目", requirementId: "r1", requirementTitle: "原需求",
  sourceRef: null, title: "联调问题", impact: "影响发布", reporter: "测试", ownerId: "u1", ownerName: "张三",
  status: "in_progress", priority: "P2", progress: 50, discoveredAt: "2026-09-01", dueDate: "2026-09-05",
  resolvedAt: null, createdAt: "2026-09-01", updatedAt: "2026-09-01", latestUpdate: null,
  latestUpdateAt: null, overdue: false, updates: [],
};
const account: Account = {
  id: "a1", username: "zhangsan", personId: "u1", personName: "张三", jobTitle: "前端工程师",
  globalRole: "user", role: "user", status: "active", mustChangePassword: false, isBuiltin: false,
  lastLoginAt: null, createdAt: "2026-09-01", updatedAt: "2026-09-01", managedProjects: [],
};

async function mockApplication(page: Page, patches: Array<{ path: string; body: Record<string, unknown> }>) {
  let currentProject = structuredClone(project);
  let currentPeople = structuredClone(people);
  let currentRequirement = structuredClone(requirement);
  let currentIssue = structuredClone(issue);
  let currentAccount = structuredClone(account);
  await page.route("**/api/**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = request.postDataJSON?.() as Record<string, unknown> | undefined;
    const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (url.pathname === "/api/session") return json({ authenticated: true, accountId: "admin", username: "admin", httpWarning: true, role: "admin", globalRole: "admin", personId: null, mustChangePassword: false, managedProjectIds: [] });
    if (url.pathname === "/api/projects" && method === "GET") return json([currentProject]);
    if (url.pathname === "/api/projects/p1" && method === "PATCH") {
      patches.push({ path: url.pathname, body: body || {} });
      currentProject = { ...currentProject, ...body };
      return json(currentProject);
    }
    if (url.pathname === "/api/templates") return json([{ id: "t1", name: "研发流程", description: "", createdAt: "2026-09-01", updatedAt: "2026-09-01", items: [] }]);
    if (url.pathname === "/api/people") return json(currentPeople);
    if (url.pathname === "/api/people/u1" && method === "PATCH") {
      patches.push({ path: url.pathname, body: body || {} });
      currentPeople = currentPeople.map((person) => person.id === "u1" ? { ...person, ...body } : person);
      return json(currentPeople.find((person) => person.id === "u1"));
    }
    if (url.pathname === "/api/requirements" && method === "GET") return json([currentRequirement]);
    if (url.pathname === "/api/requirements/r1" && method === "GET") return json(currentRequirement);
    if (url.pathname === "/api/requirements/r1" && method === "PATCH") {
      patches.push({ path: url.pathname, body: body || {} });
      if (body?.title === "冲突") return json({ error: "需求标题已存在" }, 400);
      currentRequirement = { ...currentRequirement, ...body };
      return json(currentRequirement);
    }
    if (url.pathname === "/api/work-items/w1" && method === "PATCH") {
      patches.push({ path: url.pathname, body: body || {} });
      const ownerId = Object.prototype.hasOwnProperty.call(body || {}, "ownerId") ? String(body?.ownerId || "") || null : currentRequirement.workItems[0].ownerId;
      const assigneeIds = Array.isArray(body?.assigneeIds) ? body.assigneeIds.map(String) : currentRequirement.workItems[0].assigneeIds;
      const collaborators = people.filter((person) => assigneeIds.includes(person.id) && person.id !== ownerId);
      const saved = { ...currentRequirement.workItems[0], ...body, ownerId, ownerName: people.find((person) => person.id === ownerId)?.name || null, collaborators, assigneeIds, assigneeNames: assigneeIds.flatMap((id) => {
        const name = people.find((person) => person.id === id)?.name;
        return name ? [name] : [];
      }) };
      currentRequirement = { ...currentRequirement, workItems: [saved] };
      return json(saved);
    }
    if (url.pathname === "/api/issues" && method === "GET") return json({ items: [currentIssue], total: 1, page: 1, pageSize: 50, pages: 1, summary: { total: 1, open: 0, inProgress: 1, deferred: 0, resolved: 0, active: 1, highPriority: 0, overdue: 0, unassigned: 0, closureRate: 0 } });
    if (url.pathname === "/api/issues/i1" && method === "PATCH") {
      patches.push({ path: url.pathname, body: body || {} });
      currentIssue = { ...currentIssue, ...body, progress: body?.status === "resolved" ? 100 : currentIssue.progress };
      return json(currentIssue);
    }
    if (url.pathname === "/api/accounts" && method === "GET") return json([currentAccount]);
    if (url.pathname === "/api/accounts/a1" && method === "PATCH") {
      patches.push({ path: url.pathname, body: body || {} });
      const role = (body?.role as Account["role"] | undefined) || currentAccount.role;
      const managedIds = Array.isArray(body?.managedProjectIds) ? body.managedProjectIds.map(String) : [];
      currentAccount = { ...currentAccount, ...body, role, managedProjects: role === "project_manager" && managedIds.includes("p1") ? [{ id: "p1", name: "测试项目" }] : [] };
      return json(currentAccount);
    }
    return json({});
  });
}

test("管理表格支持原地编辑、复杂状态浮层和失败回滚", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1080p", "交互流程只需在一个桌面视口执行");
  const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
  await mockApplication(page, patches);

  await page.goto("/requirements");
  const requirementBefore = await geometry(page, ".requirements-table");
  await page.getByRole("button", { name: /需求标题：原需求/ }).click();
  await expect(page.locator(".inline-edit-popover")).toHaveCount(1);
  expectStable(requirementBefore, await geometry(page, ".requirements-table"));
  await page.getByLabel("需求标题", { exact: true }).fill("修改后需求");
  expectStable(requirementBefore, await geometry(page, ".requirements-table"));
  await page.getByLabel("需求标题", { exact: true }).press("Enter");
  await expect.poll(() => patches.some((entry) => entry.path === "/api/requirements/r1" && entry.body.title === "修改后需求")).toBe(true);
  await page.getByRole("button", { name: /需求优先级/ }).click();
  await expect(page.getByRole("option", { name: "P1 · 高", exact: true })).toBeVisible();
  await page.getByRole("option", { name: "P1 · 高", exact: true }).click();
  await expect.poll(() => patches.some((entry) => entry.body.priority === "P1")).toBe(true);
  await expect(page.getByText("P1 · 高", { exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: /需求标题：修改后需求/ }).click();
  await page.getByLabel("需求标题", { exact: true }).fill("冲突");
  await page.getByLabel("需求标题", { exact: true }).press("Enter");
  await expect(page.getByText("需求标题已存在")).toBeVisible();
  await expect(page.getByText("修改后需求", { exact: true })).toBeVisible();
  expectStable(requirementBefore, await geometry(page, ".requirements-table"));

  await page.goto("/requirements/r1");
  await page.getByRole("button", { name: /工作项设置|编辑工作项/ }).click();
  const workBefore = await geometry(page, ".work-inline-table");
  await page.getByRole("button", { name: /主负责人：未分配/ }).click();
  expectStable(workBefore, await geometry(page, ".work-inline-table"));
  await page.getByRole("option").filter({ hasText: "张三" }).click();
  await expect.poll(() => patches.some((entry) => entry.path === "/api/work-items/w1" && entry.body.ownerId === "u1")).toBe(true);
  await page.getByRole("button", { name: /协作人员：无协作人员/ }).click();
  await page.getByText("李四", { exact: true }).click();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect.poll(() => patches.some((entry) => Array.isArray(entry.body.assigneeIds) && entry.body.assigneeIds.includes("u2"))).toBe(true);
  await page.getByRole("button", { name: /计划开始：2026-09-01/ }).click();
  await page.getByLabel("计划开始", { exact: true }).fill("2026-09-02");
  await expect.poll(() => patches.some((entry) => entry.path === "/api/work-items/w1" && entry.body.plannedStart === "2026-09-02")).toBe(true);
  expectStable(workBefore, await geometry(page, ".work-inline-table"));

  await page.goto("/issues");
  await page.locator(".issue-status-editor .inline-edit-trigger").click();
  await page.locator(".issue-status-popover select").first().selectOption("resolved");
  await page.getByPlaceholder("填写最终结论或处理结果").fill("联调验证通过");
  await page.getByRole("button", { name: "确认闭环" }).click();
  await expect.poll(() => patches.some((entry) => entry.path === "/api/issues/i1" && entry.body.status === "resolved" && entry.body.updateContent === "联调验证通过")).toBe(true);

  await page.goto("/accounts");
  await page.locator(".account-permission-editor").first().getByRole("button").click();
  await page.locator(".account-permission-popover select").selectOption("project_manager");
  await page.locator(".account-permission-popover").getByText("测试项目", { exact: true }).click();
  await page.getByRole("button", { name: "保存权限" }).click();
  await expect.poll(() => patches.some((entry) => entry.path === "/api/accounts/a1" && entry.body.role === "project_manager" && Array.isArray(entry.body.managedProjectIds) && entry.body.managedProjectIds.includes("p1"))).toBe(true);

  await page.goto("/projects");
  await page.getByRole("button", { name: /项目名称：测试项目/ }).click();
  await page.getByLabel("项目名称", { exact: true }).fill("新版项目");
  await page.getByLabel("项目名称", { exact: true }).press("Enter");
  await expect.poll(() => patches.some((entry) => entry.path === "/api/projects/p1" && entry.body.name === "新版项目")).toBe(true);

  await page.goto("/people");
  await page.getByRole("button", { name: /人员岗位：前端工程师/ }).click();
  await page.getByLabel("人员岗位", { exact: true }).fill("研发工程师");
  await page.getByLabel("人员岗位", { exact: true }).press("Enter");
  await expect.poll(() => patches.some((entry) => entry.path === "/api/people/u1" && entry.body.jobTitle === "研发工程师")).toBe(true);
  await expect(page.getByRole("heading", { name: "研发工程师" })).toBeVisible();
});

test("流程里程碑在需求甘特图展示并可单独调整", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1080p", "交互流程只需在一个桌面视口执行");
  const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
  await mockApplication(page, patches);

  await page.goto("/requirements/r1");
  await expect(page.locator(".gantt-milestone-marker")).toBeVisible();
  await expect(page.locator(".gantt-milestone-marker")).toContainText("需求基线");

  await page.getByRole("button", { name: /工作项设置|编辑工作项/ }).click();
  await page.getByRole("button", { name: /里程碑名称：需求基线/ }).click();
  await page.getByLabel("里程碑名称", { exact: true }).fill("接口基线");
  await page.getByLabel("里程碑名称", { exact: true }).press("Enter");
  await expect.poll(() => patches.some((entry) => entry.path === "/api/work-items/w1" && entry.body.milestoneLabel === "接口基线")).toBe(true);
});

test("编辑浮层在常用分辨率下保持表格几何稳定", async ({ page }, testInfo) => {
  test.skip(!["laptop-1366", "hidpi-3k-200", "desktop-1080p", "desktop-qhd"].includes(testInfo.project.name), "仅检查验收分辨率");
  const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
  await mockApplication(page, patches);
  await page.goto("/requirements");
  const before = await geometry(page, ".requirements-table");
  await page.getByRole("button", { name: /需求优先级/ }).click();
  await expect(page.locator(".inline-edit-popover")).toBeVisible();
  expectStable(before, await geometry(page, ".requirements-table"));
  const popover = await page.locator(".inline-edit-popover").boundingBox();
  const viewport = page.viewportSize();
  expect(popover).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(popover!.x).toBeGreaterThanOrEqual(0);
  expect(popover!.y).toBeGreaterThanOrEqual(0);
  expect(popover!.x + popover!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(popover!.y + popover!.height).toBeLessThanOrEqual(viewport!.height + 1);
});
