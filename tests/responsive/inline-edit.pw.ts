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
  defaultTemplateId: "t1", isSample: false, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
};
const people: Person[] = [
  { id: "u1", name: "张三", jobTitle: "前端工程师", active: 1, createdAt: "2026-09-01", updatedAt: "2026-09-01" },
  { id: "u2", name: "李四", jobTitle: "测试工程师", active: 1, createdAt: "2026-09-01", updatedAt: "2026-09-01" },
];
const workItem: WorkItem = {
  id: "w1", requirementId: "r1", templateItemId: "ti1", title: "设计", ownerId: null, ownerName: null,
  collaborators: [], assigneeIds: [], assigneeNames: [], status: "not_started", plannedStart: "2026-09-01",
  plannedEnd: "2026-09-03", actualStart: null, actualEnd: null, forecastEnd: null, blockedAt: null,
  blockedReason: null, milestoneLabel: "需求基线", progress: 0, sortOrder: 0, version: 1, createdAt: "2026-09-01", updatedAt: "2026-09-01",
};
const secondWorkItem: WorkItem = {
  ...workItem,
  id: "w2",
  templateItemId: "ti2",
  title: "开发",
  plannedStart: "2026-09-04",
  plannedEnd: "2026-09-08",
  milestoneLabel: null,
  sortOrder: 1,
};
const requirement: Requirement = {
  id: "r1", projectId: "p1", projectName: "测试项目", templateId: "t1", templateName: "研发流程",
  title: "原需求", ownerId: null, ownerName: null, status: "not_started", plannedStart: "2026-09-01",
  plannedEnd: "2026-09-03", progress: 0, plannedProgress: 0, progressGap: 0, acceptedAt: null, acceptedByAccountId: null, version: 1, riskLevel: "low",
  riskEvaluated: true, riskReason: "", priority: "P2", createdAt: "2026-09-01", updatedAt: "2026-09-01",
  workItems: [workItem, secondWorkItem], progressUpdates: [], recentProgressUpdates: [], delayed: false, highRisk: false,
  finishVariance: 0, durationVariance: 0, effectiveEnd: "2026-09-03", issueSummary: { active: 0, overdue: 0 },
};
const issue: Issue = {
  id: "i1", projectId: "p1", projectName: "测试项目", requirementId: "r1", requirementTitle: "原需求",
  sourceRef: null, title: "联调问题", impact: "影响发布", reporter: "测试", ownerId: "u1", ownerName: "张三",
  status: "in_progress", priority: "P2", progress: 50, discoveredAt: "2026-09-01", dueDate: "2026-09-05",
  resolvedAt: null, version: 1, createdAt: "2026-09-01", updatedAt: "2026-09-01", latestUpdate: null,
  latestUpdateAt: null, overdue: false, updates: [],
};
const account: Account = {
  id: "a1", username: "zhangsan", personId: "u1", personName: "张三", jobTitle: "前端工程师",
  globalRole: "user", role: "user", status: "active", mustChangePassword: false, isBuiltin: false,
  lastLoginAt: null, createdAt: "2026-09-01", updatedAt: "2026-09-01", managedProjects: [],
  activeAssignments: { requirements: 0, workItems: 0, issues: 0 },
};

async function mockApplication(page: Page, patches: Array<{ path: string; body: Record<string, unknown> }>, options: { issue?: Partial<Issue>; account?: Partial<Account> } = {}) {
  let currentProject = structuredClone(project);
  let currentPeople = structuredClone(people);
  let currentRequirement = structuredClone(requirement);
  let currentIssue = { ...structuredClone(issue), ...options.issue };
  let currentAccount = { ...structuredClone(account), ...options.account };
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
    if (url.pathname === "/api/templates" && method === "GET") return json([{ id: "t1", projectId: "p1", name: "研发流程", description: "", createdAt: "2026-09-01", updatedAt: "2026-09-01", items: [
      { id: "ti1", templateId: "t1", title: "设计", startOffsetDays: 0, durationDays: 2, milestoneLabel: null, sortOrder: 0 },
      { id: "ti2", templateId: "t1", title: "开发", startOffsetDays: 2, durationDays: 3, milestoneLabel: null, sortOrder: 1 },
    ] }]);
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
    if (/^\/api\/work-items\/w[12]$/.test(url.pathname) && method === "PATCH") {
      patches.push({ path: url.pathname, body: body || {} });
      const itemId = url.pathname.split("/").at(-1)!;
      const currentItem = currentRequirement.workItems.find((item) => item.id === itemId)!;
      const ownerId = Object.prototype.hasOwnProperty.call(body || {}, "ownerId") ? String(body?.ownerId || "") || null : currentItem.ownerId;
      const assigneeIds = Array.isArray(body?.assigneeIds) ? body.assigneeIds.map(String) : currentItem.assigneeIds;
      const collaborators = people.filter((person) => assigneeIds.includes(person.id) && person.id !== ownerId);
      const saved = { ...currentItem, ...body, ownerId, ownerName: people.find((person) => person.id === ownerId)?.name || null, collaborators, assigneeIds, assigneeNames: assigneeIds.flatMap((id) => {
        const name = people.find((person) => person.id === id)?.name;
        return name ? [name] : [];
      }) };
      currentRequirement = { ...currentRequirement, workItems: currentRequirement.workItems.map((item) => item.id === saved.id ? saved : item) };
      return json(saved);
    }
    if (url.pathname === "/api/requirements/r1/reorder-work-items" && method === "POST") {
      patches.push({ path: url.pathname, body: body || {} });
      const ids = Array.isArray(body?.ids) ? body.ids.map(String) : [];
      currentRequirement = {
        ...currentRequirement,
        version: currentRequirement.version + 1,
        workItems: ids.map((itemId, index) => ({ ...currentRequirement.workItems.find((item) => item.id === itemId)!, sortOrder: index })),
      };
      return json(currentRequirement);
    }
    if (url.pathname === "/api/issues" && method === "GET") return json({ items: [currentIssue], total: 1, page: 1, pageSize: 50, pages: 1, summary: { total: 1, inProgress: 1, deferred: 0, resolved: 0, active: 1, highPriority: 0, overdue: 0, unassigned: 0, closureRate: 0 } });
    if (url.pathname === "/api/issues/i1" && method === "GET") return json(currentIssue);
    if (url.pathname === "/api/issues/i1" && method === "PATCH") {
      patches.push({ path: url.pathname, body: body || {} });
      if (body?.title === "问题冲突") return json({ error: "问题标题已存在" }, 400);
      currentIssue = { ...currentIssue, ...body };
      return json(currentIssue);
    }
    if (url.pathname === "/api/issues/i1/resolve" && method === "POST") {
      patches.push({ path: url.pathname, body: body || {} });
      currentIssue = { ...currentIssue, status: "resolved", progress: 100, resolvedAt: "2026-09-02", version: currentIssue.version + 1 };
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

test("管理表格支持原地编辑、显式状态命令和失败回滚", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1080p", "交互流程只需在一个桌面视口执行");
  const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
  await mockApplication(page, patches);

  await page.goto("/requirements");
  const requirementBefore = await geometry(page, ".requirements-table");
  await page.getByRole("button", { name: /需求优先级/ }).click();
  await expect(page.locator(".inline-edit-popover")).toHaveCount(1);
  expectStable(requirementBefore, await geometry(page, ".requirements-table"));
  await expect(page.getByRole("option", { name: "P1 · 高", exact: true })).toBeVisible();
  await page.getByRole("option", { name: "P1 · 高", exact: true }).click();
  await expect.poll(() => patches.some((entry) => entry.body.priority === "P1")).toBe(true);
  await expect(page.getByText("P1 · 高", { exact: true })).toHaveCount(1);
  expectStable(requirementBefore, await geometry(page, ".requirements-table"));

  await page.goto("/requirements/r1");
  await page.getByRole("button", { name: /工作项设置|编辑工作项/ }).click();
  const workBefore = await geometry(page, ".work-inline-table");
  await page.getByRole("button", { name: /主负责人：未分配/ }).first().click();
  expectStable(workBefore, await geometry(page, ".work-inline-table"));
  await page.getByRole("option").filter({ hasText: "张三" }).click();
  await expect.poll(() => patches.some((entry) => entry.path === "/api/work-items/w1" && entry.body.ownerId === "u1")).toBe(true);
  await page.getByRole("button", { name: /协作人员：无协作人员/ }).first().click();
  await page.getByText("李四", { exact: true }).click();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect.poll(() => patches.some((entry) => Array.isArray(entry.body.assigneeIds) && entry.body.assigneeIds.includes("u2"))).toBe(true);
  await page.getByRole("button", { name: /计划开始：2026-09-01/ }).first().click();
  await expect(page.locator(".inline-date-popover")).toHaveCount(0);
  await page.getByLabel("计划开始", { exact: true }).first().fill("2026-09-02");
  await expect.poll(() => patches.some((entry) => entry.path === "/api/work-items/w1" && entry.body.plannedStart === "2026-09-02")).toBe(true);
  expectStable(workBefore, await geometry(page, ".work-inline-table"));

  await page.goto("/issues");
  await page.locator(".issue-title-button").click();
  const issueDialog = page.getByRole("dialog", { name: "问题详情" });
  await issueDialog.getByLabel("问题标题", { exact: true }).fill("问题冲突");
  await issueDialog.getByRole("button", { name: "保存修改" }).click();
  await expect(issueDialog.getByText("问题标题已存在")).toBeVisible();
  await issueDialog.getByRole("button", { name: "关闭" }).click();
  await page.locator(".issue-status-trigger").click();
  await page.getByRole("button", { name: /已解决.*确认解决/ }).click();
  await page.getByLabel("填写闭环说明").fill("联调验证通过");
  await page.getByRole("button", { name: "确认变更" }).click();
  await expect.poll(() => patches.some((entry) => entry.path === "/api/issues/i1/resolve" && entry.body.content === "联调验证通过")).toBe(true);
  await expect(page.getByRole("table").getByText("已解决", { exact: true })).toBeVisible();

  await page.goto("/accounts");
  await page.locator(".account-permission-editor").first().getByRole("button").click();
  await page.locator(".account-permission-popover select").selectOption("project_manager");
  await page.locator(".account-permission-popover").getByText("测试项目", { exact: true }).click();
  await page.getByRole("button", { name: "保存权限" }).click();
  await expect.poll(() => patches.some((entry) => entry.path === "/api/accounts/a1" && entry.body.role === "project_manager" && Array.isArray(entry.body.managedProjectIds) && entry.body.managedProjectIds.includes("p1"))).toBe(true);

  await page.goto("/projects");
  await expect(page.locator(".project-table").getByText("测试项目", { exact: true })).toBeVisible();
  await expect(page.locator(".project-table .inline-edit-cell")).toHaveCount(0);

  await page.goto("/people");
  await expect(page.getByRole("heading", { name: "前端工程师" })).toBeVisible();
  await expect(page.locator(".person-card .inline-edit-cell")).toHaveCount(0);
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

test("工作项使用统一拖动手柄调整顺序", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1080p", "拖拽流程只需在一个桌面视口执行");
  const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
  await mockApplication(page, patches);
  await page.goto("/requirements/r1");
  await page.getByRole("button", { name: /工作项设置|编辑工作项/ }).click();

  const handles = page.getByRole("button", { name: /拖动.*调整顺序/ });
  await expect(handles).toHaveCount(2);
  await expect(page.getByRole("button", { name: /上移|下移/ })).toHaveCount(0);
  const first = await handles.nth(0).boundingBox();
  const second = await handles.nth(1).boundingBox();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2);
  await page.mouse.down();
  await page.mouse.move(second!.x + second!.width / 2, second!.y + second!.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect.poll(() => patches.find((entry) => entry.path.endsWith("/reorder-work-items"))?.body.ids).toEqual(["w2", "w1"]);
  await expect(page.locator(".work-inline-table tbody tr").nth(0)).toContainText("开发");
});

test("流程工作项复用统一拖动排序底座", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1080p", "拖拽流程只需在一个桌面视口执行");
  const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
  await mockApplication(page, patches);
  await page.goto("/templates");
  await page.getByRole("button", { name: "编辑流程 研发流程" }).click();

  const handles = page.getByRole("button", { name: /拖动.*调整顺序/ });
  await expect(handles).toHaveCount(2);
  const first = await handles.nth(0).boundingBox();
  const second = await handles.nth(1).boundingBox();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2);
  await page.mouse.down();
  await page.mouse.move(second!.x + second!.width / 2, second!.y + second!.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect(page.locator(".template-editor-row").nth(0).locator("input").first()).toHaveValue("开发");
  await expect(page.locator(".template-editor-row").nth(1).locator("input").first()).toHaveValue("设计");
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

test("问题字段、表格基线和详情工作区保持稳定", async ({ page }, testInfo) => {
  test.skip(!["laptop-1366", "desktop-1080p"].includes(testInfo.project.name), "覆盖常用桌面视口");
  const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
  await mockApplication(page, patches, { issue: { dueDate: "2026-08-25", overdue: true } });
  await page.goto("/issues");

  const primaryTops = await page.locator('.issue-data-row:first-child > .adaptive-data-cell:not([data-importance="secondary"]) .data-cell-primary').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));
  expect(Math.max(...primaryTops) - Math.min(...primaryTops)).toBeLessThanOrEqual(1);
  await expect(page.locator(".issue-data-row:first-child .issue-data-due .data-cell-secondary").filter({ hasText: "已逾期" })).toBeVisible();

  await page.locator(".issue-title-button").click();
  const dialog = page.getByRole("dialog", { name: "问题详情" });
  const before = await dialog.boundingBox();
  expect(before).not.toBeNull();

  const aligned = await Promise.all([2, 3, 4].map(async (index) => (await dialog.locator(".issue-settings-basic .field-shell").nth(index).locator(".field-control").boundingBox())?.y));
  expect(aligned.every((value) => typeof value === "number" && value > 0)).toBe(true);
  const alignedNumbers = aligned.filter((value): value is number => typeof value === "number");
  expect(Math.max(...alignedNumbers) - Math.min(...alignedNumbers)).toBeLessThanOrEqual(1);

  await dialog.getByLabel("问题标题", { exact: true }).fill("保留中的问题草稿");
  await dialog.getByRole("tab", { name: /进展记录/ }).click();
  const after = await dialog.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs(after!.x - before!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(after!.width - before!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(after!.height - before!.height)).toBeLessThanOrEqual(1);
  await expect(dialog.locator(".issue-update-settings-list")).toHaveCSS("overflow-y", "auto");

  await dialog.getByRole("tab", { name: "基本信息" }).click();
  await expect(dialog.getByLabel("问题标题", { exact: true })).toHaveValue("保留中的问题草稿");
});

test("公共数据单元格统一编辑态与次级信息的可见起点", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1080p", "像素级基线只需在一个桌面视口执行");
  const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
  await mockApplication(page, patches, {
    issue: { dueDate: "2026-08-25", overdue: true },
    account: { mustChangePassword: true },
  });

  const textLeft = (selector: string) => page.locator(selector).evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.textContent?.trim()) node = walker.nextNode();
    if (!node) return element.getBoundingClientRect().left;
    const range = document.createRange();
    range.selectNodeContents(node);
    return range.getBoundingClientRect().left;
  });

  await page.goto("/issues");
  const issueCell = ".issue-data-row:first-child .issue-data-due .data-cell";
  const issueValueLeft = await textLeft(`${issueCell} .inline-edit-value`);
  const issueMetaLeft = await textLeft(`${issueCell} .data-cell-secondary`);
  expect(Math.abs(issueValueLeft - issueMetaLeft)).toBeLessThanOrEqual(1);

  await page.goto("/requirements");
  const requirementTitle = ".requirements-table tbody tr:first-child td:first-child .data-cell";
  expect(Math.abs(await textLeft(`${requirementTitle} .data-cell-primary`) - await textLeft(`${requirementTitle} .data-cell-secondary`))).toBeLessThanOrEqual(1);
  const priorityBounds = await page.locator(".requirements-table tbody tr:first-child td:nth-child(2)").evaluate((cell) => {
    const cellRect = cell.getBoundingClientRect();
    const badgeRect = cell.querySelector<HTMLElement>('.priority-badge')!.getBoundingClientRect();
    return { cellLeft: cellRect.left, cellRight: cellRect.right, badgeLeft: badgeRect.left, badgeRight: badgeRect.right };
  });
  expect(priorityBounds.badgeLeft).toBeGreaterThanOrEqual(priorityBounds.cellLeft);
  expect(priorityBounds.badgeRight).toBeLessThanOrEqual(priorityBounds.cellRight);

  await page.goto("/accounts");
  const accountStatus = ".account-data-row:first-child .account-data-status .data-cell";
  const accountBadgeLeft = await page.locator(`${accountStatus} .account-status`).evaluate((element) => element.getBoundingClientRect().left);
  const accountMetaLeft = await textLeft(`${accountStatus} .account-password-state`);
  expect(Math.abs(accountBadgeLeft - accountMetaLeft)).toBeLessThanOrEqual(1);
});
