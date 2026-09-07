import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
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

async function mockApplication(page: Page, patches: Array<{ path: string; body: Record<string, unknown> }>, options: { issue?: Partial<Issue>; account?: Partial<Account>; requirement?: Partial<Requirement>; workItem?: Partial<WorkItem> } = {}) {
  let currentProject = structuredClone(project);
  let currentPeople = structuredClone(people);
  let currentRequirement = { ...structuredClone(requirement), ...options.requirement };
  if (options.workItem) currentRequirement = { ...currentRequirement, workItems: currentRequirement.workItems.map((item, index) => index === 0 ? { ...item, ...options.workItem } : item) };
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
      const globalRole = (body?.role as Account["globalRole"] | undefined) || currentAccount.globalRole;
      currentAccount = { ...currentAccount, ...body, globalRole, role: globalRole === "admin" ? "admin" : currentAccount.managedProjects.length ? "project_manager" : "user" };
      return json(currentAccount);
    }
    return json({});
  });
}

for (const mode of ["start", "deadline"] as const) {
  test(`调整排期${mode}：等待提交不能改值或关闭，失败保留草稿并只重试一次`, async ({ page }) => {
    await mockApplication(page, [], { workItem: { status: "in_progress", progress: 10, actualStart: "2026-09-01" } });
    const submissions: Array<Record<string, unknown>> = [];
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/requirements/r1/reschedule", async (route) => {
      submissions.push(route.request().postDataJSON());
      if (submissions.length === 1) { await waiting; return route.fulfill({ status: 500, json: { error: "排期暂时保存失败" } }); }
      return route.fulfill({ json: requirement });
    });
    try {
      await page.goto("/requirements/r1");
      await page.getByRole("button", { name: "调整计划", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "调整需求计划" });
      const radio = dialog.getByRole("radio", { name: mode === "start" ? /按开始日期正排/ : /按截止日期倒排/ });
      await radio.click();
      const date = dialog.getByLabel(mode === "start" ? "计划开始" : "计划完成", { exact: true });
      const reason = dialog.getByRole("textbox", { name: "变更原因", exact: true });
      await date.fill("2026-09-10");
      await reason.fill("保留这次排期调整说明");
      await dialog.getByRole("button", { name: "保存排期", exact: true }).click();
      await expect.poll(() => submissions.length).toBe(1);
      await expect(date).toBeDisabled();
      await expect(radio).toBeDisabled();
      await expect(reason).toBeDisabled();
      await expect(dialog.getByRole("combobox", { name: "绑定流程", exact: true })).toBeDisabled();
      await expect(dialog.getByRole("button", { name: "关闭", exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeVisible();
      await dialog.locator("form").evaluate((form) => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
      expect(submissions).toHaveLength(1);
      release();
      await expect(dialog.getByText("排期暂时保存失败")).toBeVisible();
      await expect(date).toHaveValue("2026-09-10");
      await expect(reason).toHaveValue("保留这次排期调整说明");
      await radio.click();
      await expect(date).toHaveValue("2026-09-10");
      await dialog.getByRole("button", { name: "保存排期", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      const input = { scheduleMode: mode, [mode === "start" ? "plannedStart" : "plannedEnd"]: "2026-09-10", reason: "保留这次排期调整说明", expectedVersion: 1 };
      expect(submissions).toEqual([input, input]);
    } finally { release(); }
  });
}

test("调整排期：后台变更阻止旧流程确认，重读后只保留已修改草稿", async ({ page }, testInfo) => {
  await mockApplication(page, []);
  let serverRequirement = structuredClone(requirement);
  const submissions: Array<{ path: string; body: Record<string, unknown> }> = [];
  await page.route("**/api/templates?*", (route) => route.fulfill({ json: [
    { id: "t1", projectId: "p1", name: "研发流程", items: [] },
    { id: "t2", projectId: "p1", name: "新交付流程", items: [] },
  ] }));
  await page.route("**/api/requirements/r1", (route) => route.fulfill({ json: serverRequirement }));
  for (const endpoint of ["reschedule", "reselect-template"]) await page.route(`**/api/requirements/r1/${endpoint}`, (route) => {
    submissions.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
    return route.fulfill({ json: serverRequirement });
  });
  await page.goto("/requirements/r1");
  await page.getByRole("button", { name: "调整计划", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "调整需求计划" });
  const flow = dialog.getByRole("combobox", { name: "绑定流程", exact: true });
  await flow.selectOption("t2");
  await dialog.getByRole("radio", { name: /按截止日期倒排/ }).click();
  await dialog.getByLabel("计划完成", { exact: true }).fill("2026-09-10");
  await dialog.getByRole("button", { name: "保存排期", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "切换需求流程" });
  await expect(confirmation).toBeVisible();
  await expect(flow).toBeDisabled();
  await expect(dialog.getByLabel("计划完成", { exact: true })).toBeDisabled();
  await expect(confirmation.getByText(/目标流程：新交付流程/)).toBeVisible();
  await expect(confirmation.getByText(/计划完成：2026-09-10/)).toBeVisible();
  serverRequirement = { ...serverRequirement, title: "后台刚更新的需求", templateId: "t2", templateName: "新交付流程", version: 2, plannedStart: "2026-09-03", plannedEnd: "2026-09-07" };
  await page.evaluate(() => { window.dispatchEvent(new Event("offline")); window.dispatchEvent(new Event("online")); });
  await expect(page.getByRole("heading", { name: "后台刚更新的需求", exact: true })).toBeVisible();
  await expect(confirmation.getByText("需求计划已更新，请取消后重新加载当前计划。", { exact: true })).toBeVisible();
  await expect(confirmation.getByRole("button", { name: "确认切换", exact: true })).toBeDisabled();
  expect(submissions).toHaveLength(0);
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(flow).toHaveValue("t2");
  await expect(dialog.getByLabel("计划完成", { exact: true })).toHaveValue("2026-09-10");
  await expect(dialog.getByRole("button", { name: "保存排期", exact: true })).toBeDisabled();
  await expect(dialog.getByText("需求计划已在其他位置更新，请重新加载；已修改的排期草稿会保留。", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "重新加载当前计划", exact: true }).click();
  await expect(dialog.getByText(/当前流程：新交付流程/)).toBeVisible();
  await expect(dialog.getByText(/当前计划：2026-09-03 → 2026-09-07/)).toBeVisible();
  await dialog.screenshot({ path: testInfo.outputPath("schedule-conflict.png"), animations: "disabled" });
  await dialog.getByRole("button", { name: "保存排期", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(submissions).toEqual([{ path: "/api/requirements/r1/reschedule", body: { scheduleMode: "deadline", plannedEnd: "2026-09-10", expectedVersion: 2 } }]);
});

test("调整排期：切换确认取消后保留草稿，提交中锁定两层窗口，失败只重试确认快照", async ({ page }, testInfo) => {
  await mockApplication(page, []);
  await page.route("**/api/templates?*", (route) => route.fulfill({ json: [
    { id: "t1", projectId: "p1", name: "研发流程", items: [] },
    { id: "t2", projectId: "p1", name: "新交付流程", items: [] },
  ] }));
  const submissions: Array<Record<string, unknown>> = [];
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/requirements/r1/reselect-template", async (route) => {
    submissions.push(route.request().postDataJSON());
    if (submissions.length === 1) { await waiting; return route.fulfill({ status: 500, json: { error: "流程暂时切换失败" } }); }
    return route.fulfill({ json: requirement });
  });
  try {
    await page.goto("/requirements/r1");
    await page.getByRole("button", { name: "调整计划", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "调整需求计划" });
    const flow = dialog.getByRole("combobox", { name: "绑定流程", exact: true });
    const date = dialog.getByLabel("计划开始", { exact: true });
    await flow.selectOption("t2");
    await date.fill("2026-09-10");
    await dialog.getByRole("button", { name: "保存排期", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "切换需求流程" });
    await expect(confirmation).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(date).toHaveValue("2026-09-10");
    await expect(flow).toHaveValue("t2");
    expect(submissions).toHaveLength(0);
    await dialog.getByRole("button", { name: "保存排期", exact: true }).click();
    await confirmation.getByRole("button", { name: "确认切换", exact: true }).click();
    await expect.poll(() => submissions.length).toBe(1);
    await expect(date).toBeDisabled();
    await expect(flow).toBeDisabled();
    await expect(page.getByRole("button", { name: "关闭", exact: true })).toHaveCount(0);
    await expect(confirmation.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(confirmation).toBeVisible();
    await dialog.locator("form").evaluate((form) => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    release();
    await expect(confirmation.getByText("流程暂时切换失败")).toBeVisible();
    await expect(confirmation.getByText(/目标流程：新交付流程/)).toBeVisible();
    await expect(confirmation.getByText(/计划开始：2026-09-10/)).toBeVisible();
    await confirmation.screenshot({ path: testInfo.outputPath("schedule-confirmation.png"), animations: "disabled" });
    expect(submissions).toHaveLength(1);
    await confirmation.getByRole("button", { name: "确认切换", exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(dialog).toHaveCount(0);
    const input = { scheduleMode: "start", plannedStart: "2026-09-10", templateId: "t2", confirmTemplateReset: true, expectedVersion: 1 };
    expect(submissions).toEqual([input, input]);
  } finally { release(); }
});

test("调整排期：提交冲突不能抬高草稿版本，加载失败需重试读取再保存", async ({ page }) => {
  await mockApplication(page, []);
  let serverRequirement = structuredClone(requirement);
  let failRefresh = false;
  const submissions: Array<Record<string, unknown>> = [];
  await page.route("**/api/requirements/r1", (route) => failRefresh
    ? route.fulfill({ status: 503, json: { error: "当前计划加载失败" } })
    : route.fulfill({ json: serverRequirement }));
  await page.route("**/api/requirements/r1/reschedule", (route) => {
    submissions.push(route.request().postDataJSON());
    if (submissions.length === 1) {
      failRefresh = true;
      return route.fulfill({ status: 409, json: { error: "需求已被更新，请核对后重试", code: "STALE_WRITE", currentVersion: 2 } });
    }
    return route.fulfill({ json: serverRequirement });
  });
  await page.goto("/requirements/r1");
  await page.getByRole("button", { name: "调整计划", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "调整需求计划" });
  await dialog.getByLabel("计划开始", { exact: true }).fill("2026-09-10");
  serverRequirement = { ...serverRequirement, title: "后台更新了日期", version: 2, plannedStart: "2026-09-03", plannedEnd: "2026-09-07" };
  await dialog.getByRole("button", { name: "保存排期", exact: true }).click();
  await expect.poll(() => submissions.length).toBe(1);
  expect(submissions[0]).toEqual({ scheduleMode: "start", plannedStart: "2026-09-10", expectedVersion: 1 });
  await expect(dialog.getByText("当前计划加载失败")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "保存排期", exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("计划开始", { exact: true })).toHaveValue("2026-09-10");
  failRefresh = false;
  await dialog.getByRole("button", { name: "重新加载当前计划", exact: true }).click();
  await expect(dialog.getByText(/当前计划：2026-09-03 → 2026-09-07/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "保存排期", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "保存排期", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(submissions[1]).toEqual({ scheduleMode: "start", plannedStart: "2026-09-10", expectedVersion: 2 });
});

test('需求排期已落库但响应异常时核对需求与全部工作项日期', async ({ page }) => {
  await mockApplication(page, []);
  let current: Requirement = structuredClone(requirement);
  let submissions = 0;
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: current }));
  await page.route('**/api/requirements/r1/reschedule', (route) => {
    submissions += 1;
    current = {
      ...current,
      plannedStart: '2026-09-02',
      plannedEnd: '2026-09-04',
      version: 2,
      workItems: [
        { ...current.workItems[0], plannedStart: '2026-09-02', plannedEnd: '2026-09-04', version: 2 },
        { ...current.workItems[1], plannedStart: '2026-09-07', plannedEnd: '2026-09-09', version: 2 },
      ],
    };
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '调整计划', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '调整需求计划', exact: true });
  await dialog.getByLabel('计划开始', { exact: true }).fill('2026-09-02');
  await dialog.getByRole('button', { name: '保存排期', exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('已核对最新状态：需求排期已保存', { exact: true })).toBeVisible();
  expect(submissions).toBe(1);
});

test('旧版非工作日排期已保存但响应异常时按统一锚点核对', async ({ page }) => {
  const legacyItem = { ...workItem, plannedStart: '2026-09-04', plannedEnd: '2026-09-06' };
  const cancelledLegacy = { ...secondWorkItem, status: 'cancelled', plannedStart: '2026-08-24', plannedEnd: '2026-08-28', version: 2 };
  let current: Requirement = {
    ...structuredClone(requirement), plannedStart: '2026-09-04', plannedEnd: '2026-09-06', workItems: [legacyItem, cancelledLegacy],
  };
  await mockApplication(page, [], { requirement: current });
  let submissions = 0;
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: current }));
  await page.route('**/api/requirements/r1/reschedule', (route) => {
    submissions += 1;
    current = {
      ...current, plannedStart: '2026-09-11', plannedEnd: '2026-09-11', version: 2,
      workItems: [{ ...legacyItem, plannedStart: '2026-09-11', plannedEnd: '2026-09-11', version: 2 }, cancelledLegacy],
    };
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '调整计划', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '调整需求计划', exact: true });
  await dialog.getByRole('radio', { name: /按截止日期倒排/ }).click();
  await dialog.getByLabel('计划完成', { exact: true }).fill('2026-09-11');
  await dialog.getByLabel('变更原因', { exact: true }).fill('调整剩余有效工作项计划');
  await dialog.getByRole('button', { name: '保存排期', exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('已核对最新状态：需求排期已保存', { exact: true })).toBeVisible();
  expect(submissions).toBe(1);
});

test('仅终态工作项缺少排期时不显示补全计划入口', async ({ page }) => {
  await mockApplication(page, [], { requirement: {
    workItems: [{ ...workItem, status: 'cancelled', plannedStart: null, plannedEnd: null }],
  } });
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: /工作项设置|编辑工作项/ }).click();
  await expect(page.getByRole('button', { name: '补全计划', exact: true })).toHaveCount(0);
});

test('重选流程已落库但响应异常时核对新流程生成的完整计划', async ({ page }) => {
  await mockApplication(page, []);
  const nextTemplate = {
    id: 't2', projectId: 'p1', name: '新交付流程', description: '', createdAt: '2026-09-01', updatedAt: '2026-09-01', items: [
      { id: 'ti21', templateId: 't2', title: '方案确认', startOffsetDays: 0, durationDays: 2, milestoneLabel: '方案基线', sortOrder: 0 },
      { id: 'ti22', templateId: 't2', title: '交付验证', startOffsetDays: 2, durationDays: 3, milestoneLabel: null, sortOrder: 1 },
    ],
  };
  let current: Requirement = structuredClone(requirement);
  let submissions = 0;
  await page.route('**/api/templates?*', (route) => route.fulfill({ json: [
    { id: 't1', projectId: 'p1', name: '研发流程', items: [] },
    nextTemplate,
  ] }));
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: current }));
  await page.route('**/api/requirements/r1/reselect-template', (route) => {
    submissions += 1;
    current = {
      ...current,
      templateId: 't2', templateName: '新交付流程', plannedStart: '2026-09-10', plannedEnd: '2026-09-16', version: 2,
      workItems: [
        { ...workItem, id: 'nw1', templateItemId: 'ti21', title: '方案确认', milestoneLabel: '方案基线', plannedStart: '2026-09-10', plannedEnd: '2026-09-11' },
        { ...secondWorkItem, id: 'nw2', templateItemId: 'ti22', title: '交付验证', milestoneLabel: null, plannedStart: '2026-09-14', plannedEnd: '2026-09-16' },
      ],
    };
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '调整计划', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '调整需求计划', exact: true });
  await dialog.getByRole('combobox', { name: '绑定流程', exact: true }).selectOption('t2');
  await dialog.getByLabel('计划开始', { exact: true }).fill('2026-09-10');
  await dialog.getByRole('button', { name: '保存排期', exact: true }).click();
  await page.getByRole('dialog', { name: '切换需求流程', exact: true }).getByRole('button', { name: '确认切换', exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('已核对最新状态：需求排期已保存', { exact: true })).toBeVisible();
  expect(submissions).toBe(1);
});

test('首次生成计划已落库但响应异常时核对全部模板工作项', async ({ page }) => {
  await mockApplication(page, []);
  let current: Requirement = { ...structuredClone(requirement), status: 'planning', plannedStart: null, plannedEnd: null, workItems: [] };
  let submissions = 0;
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: current }));
  await page.route('**/api/requirements/r1/reschedule', (route) => {
    submissions += 1;
    current = {
      ...current,
      plannedStart: '2026-09-10', plannedEnd: '2026-09-16', version: 2,
      workItems: [
        { ...workItem, id: 'nw1', milestoneLabel: null, plannedStart: '2026-09-10', plannedEnd: '2026-09-11' },
        { ...secondWorkItem, id: 'nw2', plannedStart: '2026-09-14', plannedEnd: '2026-09-16' },
      ],
    };
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '调整计划', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '调整需求计划', exact: true });
  await dialog.getByLabel('计划开始', { exact: true }).fill('2026-09-10');
  await dialog.getByRole('button', { name: '保存排期', exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('已核对最新状态：需求排期已保存', { exact: true })).toBeVisible();
  expect(submissions).toBe(1);
});

test("按模板补全：预览和应用期间锁定窗口与输入，失败保留草稿并可重新预览", async ({ page }) => {
  await mockApplication(page, [], { workItem: { plannedStart: null } });
  let releasePreview!: () => void;
  let releaseApply!: () => void;
  const waitingPreview = new Promise<void>((resolve) => { releasePreview = resolve; });
  const waitingApply = new Promise<void>((resolve) => { releaseApply = resolve; });
  let previewCount = 0;
  const applied: Array<Record<string, unknown>> = [];
  await page.route("**/api/requirements/r1/plan-preview", async (route) => {
    previewCount++;
    const body = route.request().postDataJSON();
    if (previewCount === 1) await waitingPreview;
    return route.fulfill({ json: {
      requirementId: "r1", ...body, requirementVersion: previewCount + 4, previewToken: String(previewCount).repeat(64),
      entries: [{ templateItemId: "ti1", workItemId: "w1", title: "设计", currentStart: null, currentEnd: "2026-09-03", proposedStart: body.baseStart, proposedEnd: "2026-09-03", willChange: true, reason: "missing_plan" }],
    } });
  });
  await page.route("**/api/requirements/r1/apply-plan", async (route) => {
    applied.push(route.request().postDataJSON());
    if (applied.length === 1) {
      await waitingApply;
      return route.fulfill({ status: 500, json: { error: "暂时无法保存，请重试" } });
    }
    if (applied.length === 2) return route.fulfill({ status: 409, json: { error: "流程已更新，请重新预览" } });
    return route.fulfill({ json: requirement });
  });
  try {
    await page.goto("/requirements/r1");
    await page.getByRole("button", { name: /工作项设置|编辑工作项/ }).click();
    await page.getByRole("button", { name: "补全计划", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "按模板补全计划" });
    const date = dialog.getByLabel("计划开始", { exact: true });
    const template = dialog.getByRole("combobox", { name: "流程设计", exact: true });
    const generate = dialog.getByRole("button", { name: "生成差异预览" });
    await date.fill("2026-09-02");
    await generate.click();
    await expect.poll(() => previewCount).toBe(1);
    await expect(date).toBeDisabled();
    await expect(template).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "关闭", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    releasePreview();
    const confirm = dialog.getByRole("button", { name: "确认补全", exact: true });
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect.poll(() => applied.length).toBe(1);
    await expect(date).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "重新预览" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "关闭", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    releaseApply();
    await expect(dialog.getByText("暂时无法保存，请重试")).toBeVisible();
    await expect(date).toHaveValue("2026-09-02");
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog.getByText("流程已更新，请重新预览")).toBeVisible();
    await expect(confirm).toHaveCount(0);
    await expect(date).toHaveValue("2026-09-02");
    await generate.click();
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    expect(applied).toEqual([
      { templateId: "t1", baseStart: "2026-09-02", expectedVersion: 5, previewToken: "1".repeat(64), templateItemIds: ["ti1"] },
      { templateId: "t1", baseStart: "2026-09-02", expectedVersion: 5, previewToken: "1".repeat(64), templateItemIds: ["ti1"] },
      { templateId: "t1", baseStart: "2026-09-02", expectedVersion: 6, previewToken: "2".repeat(64), templateItemIds: ["ti1"] },
    ]);
  } finally { releasePreview(); releaseApply(); }
});

test('按模板补全已落库但响应异常时核对需求日期和全部变更项', async ({ page }) => {
  await mockApplication(page, [], { workItem: { plannedStart: null } });
  let current: Requirement = {
    ...structuredClone(requirement),
    workItems: requirement.workItems.map((item, index) => index === 0 ? { ...item, plannedStart: null } : item),
  };
  let applied = 0;
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: current }));
  await page.route('**/api/requirements/r1/plan-preview', (route) => route.fulfill({ json: {
    requirementId: 'r1', templateId: 't1', baseStart: '2026-09-02', requirementVersion: 1, previewToken: 'a'.repeat(64),
    entries: [
      { templateItemId: 'ti1', workItemId: 'w1', title: '设计', milestoneLabel: '需求基线', currentStart: null, currentEnd: '2026-09-03', proposedStart: '2026-09-02', proposedEnd: '2026-09-03', willChange: true, reason: 'missing_plan' },
      { templateItemId: 'ti3', workItemId: null, title: '验收', milestoneLabel: '交付基线', currentStart: null, currentEnd: null, proposedStart: '2026-09-09', proposedEnd: '2026-09-10', willChange: true, reason: 'missing_item' },
    ],
  } }));
  await page.route('**/api/requirements/r1/apply-plan', (route) => {
    applied += 1;
    current = {
      ...current,
      plannedStart: '2026-09-02', plannedEnd: '2026-09-10', version: 2,
      workItems: [
        { ...current.workItems[0], plannedStart: '2026-09-02' },
        current.workItems[1],
        { ...workItem, id: 'w3', templateItemId: 'ti3', title: '验收', milestoneLabel: '交付基线', plannedStart: '2026-09-09', plannedEnd: '2026-09-10', sortOrder: 2 },
      ],
    };
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: /工作项设置|编辑工作项/ }).click();
  await page.getByRole('button', { name: '补全计划', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '按模板补全计划', exact: true });
  await dialog.getByLabel('计划开始', { exact: true }).fill('2026-09-02');
  await dialog.getByRole('button', { name: '生成差异预览', exact: true }).click();
  await dialog.getByRole('button', { name: '确认补全', exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('已核对最新状态：工作计划已补全', { exact: true })).toBeVisible();
  expect(applied).toBe(1);
});

test("按模板补全：确认使用服务器预览版本，修改日期后旧预览立即失效", async ({ page }, testInfo) => {
  await mockApplication(page, [], { workItem: { plannedStart: null } });
  const applied: Array<Record<string, unknown>> = [];
  const previews: Array<Record<string, unknown>> = [];
  await page.route("**/api/requirements/r1/plan-preview", (route) => {
    const body = route.request().postDataJSON();
    previews.push(body);
    return route.fulfill({ json: { requirementId: "r1", ...body, requirementVersion: 7, previewToken: "a".repeat(64), entries: [
      { templateItemId: "ti1", workItemId: "w1", title: "设计", currentStart: null, currentEnd: "2026-09-03", proposedStart: body.baseStart, proposedEnd: "2026-09-03", willChange: true, reason: "missing_plan" },
    ] } });
  });
  await page.route("**/api/requirements/r1/apply-plan", (route) => { applied.push(route.request().postDataJSON()); return route.fulfill({ json: requirement }); });
  await page.goto("/requirements/r1");
  await page.getByRole("button", { name: /工作项设置|编辑工作项/ }).click();
  await page.getByRole("button", { name: "补全计划", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "按模板补全计划" });
  await dialog.getByRole("button", { name: "生成差异预览" }).click();
  await expect(dialog.getByRole("button", { name: "确认补全" })).toBeEnabled();
  await dialog.getByLabel("计划开始", { exact: true }).fill("2026-09-07");
  await expect(dialog.getByRole("button", { name: "确认补全" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "生成差异预览" }).click();
  await expect(dialog.getByRole("button", { name: "确认补全" })).toBeDisabled();
  await expect(dialog.getByText(/补全后的开始日期晚于完成日期/)).toBeVisible();
  expect(applied).toHaveLength(0);
  await dialog.getByLabel("计划开始", { exact: true }).fill("2026-09-02");
  await expect(dialog.getByRole("button", { name: "确认补全" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "生成差异预览" }).click();
  await expect(dialog.getByRole("button", { name: "确认补全" })).toBeEnabled();
  await expect(dialog.getByText(/补全后的开始日期晚于完成日期/)).toHaveCount(0);
  await dialog.screenshot({ path: testInfo.outputPath("plan-preview.png") });
  await dialog.getByRole("button", { name: "确认补全" }).click();
  await expect(dialog).toHaveCount(0);
  expect(previews).toEqual([{ templateId: "t1", baseStart: "2026-09-01" }, { templateId: "t1", baseStart: "2026-09-07" }, { templateId: "t1", baseStart: "2026-09-02" }]);
  expect(applied).toEqual([{ templateId: "t1", baseStart: "2026-09-02", expectedVersion: 7, previewToken: "a".repeat(64), templateItemIds: ["ti1"] }]);
});

test("按模板补全：需求和流程后台更新后旧预览立即失效", async ({ page }) => {
  await mockApplication(page, [], { workItem: { plannedStart: null } });
  let serverRequirement = { ...structuredClone(requirement), workItems: requirement.workItems.map((item, index) => index === 0 ? { ...item, plannedStart: null } : item) };
  let serverTemplate = {
    id: "t1", projectId: "p1", name: "研发流程", description: "", createdAt: "2026-09-01", updatedAt: "2026-09-01", items: [
      { id: "ti1", templateId: "t1", title: "设计", startOffsetDays: 0, durationDays: 2, milestoneLabel: null, sortOrder: 0 },
    ],
  };
  let previewCount = 0;
  await page.route("**/api/templates?*", (route) => route.fulfill({ json: [serverTemplate] }));
  await page.route("**/api/requirements/r1", (route) => route.fulfill({ json: serverRequirement }));
  await page.route("**/api/requirements/r1/plan-preview", (route) => {
    const body = route.request().postDataJSON();
    previewCount += 1;
    return route.fulfill({ json: {
      requirementId: "r1", ...body, requirementVersion: serverRequirement.version, previewToken: (previewCount === 1 ? "a" : "b").repeat(64),
      entries: [{ templateItemId: "ti1", workItemId: "w1", title: "设计", currentStart: null, currentEnd: "2026-09-03", proposedStart: body.baseStart, proposedEnd: "2026-09-03", willChange: true, reason: "missing_plan" }],
    } });
  });

  await page.goto("/requirements/r1");
  await page.getByRole("button", { name: /工作项设置|编辑工作项/ }).click();
  await page.getByRole("button", { name: "补全计划", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "按模板补全计划" });
  await dialog.getByRole("button", { name: "生成差异预览", exact: true }).click();
  const confirm = dialog.getByRole("button", { name: "确认补全", exact: true });
  await expect(confirm).toBeEnabled();

  serverRequirement = { ...serverRequirement, title: "后台更新后的需求", version: 2 };
  serverTemplate = { ...serverTemplate, updatedAt: "2026-09-02" };
  await page.evaluate(() => { window.dispatchEvent(new Event("offline")); window.dispatchEvent(new Event("online")); });
  await expect(page.getByRole("heading", { name: "后台更新后的需求", exact: true })).toBeVisible();
  await expect(dialog.getByText("需求已更新，当前差异预览已失效，请重新预览。", { exact: true })).toBeVisible();
  await expect(dialog.getByText("流程设计已更新，当前差异预览已失效，请重新预览。", { exact: true })).toBeVisible();
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("button", { name: "重新预览", exact: true }).click();
  await dialog.getByRole("button", { name: "生成差异预览", exact: true }).click();
  await expect.poll(() => previewCount).toBe(2);
  await expect(confirm).toBeEnabled();
});

for (const nextStatus of ["completed", "in_progress"] as const) {
  test(`实际日期纠错失败保留输入（${nextStatus}），使用最新版本重试，取消后重开读取当前日期`, async ({ page }) => {
    const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
    let serverItem: WorkItem = { ...workItem, status: "completed", progress: 100, actualStart: "2026-09-01", actualEnd: "2026-09-03" };
    await mockApplication(page, patches, { workItem: serverItem });
    await page.route("**/api/requirements/r1", (route) => route.fulfill({ json: { ...requirement, workItems: [serverItem, secondWorkItem] } }));
    let releaseFailure!: () => void;
    const pendingFailure = new Promise<void>((resolve) => { releaseFailure = resolve; });
    await page.route("**/api/work-items/w1/correct", async (route) => {
      const body = route.request().postDataJSON();
      patches.push({ path: "/api/work-items/w1/correct", body });
      if (patches.length === 1) {
        serverItem = { ...serverItem, status: nextStatus, progress: nextStatus === "completed" ? 100 : 40, actualStart: "2026-08-31", actualEnd: nextStatus === "completed" ? "2026-09-01" : null, version: 2 };
        await pendingFailure;
        return route.fulfill({ status: 409, json: { error: "工作项已被更新，请核对后重试" } });
      }
      if (serverItem.status !== "completed" && body.actualEnd) return route.fulfill({ status: 400, json: { error: "进行中工作项不能设置实际完成日期" } });
      serverItem = { ...serverItem, ...body, version: serverItem.version + 1 };
      return route.fulfill({ json: serverItem });
    });
    const openDates = async () => {
      await page.getByRole("button", { name: "更多工作项操作" }).first().click();
      await page.getByRole("button", { name: "受控修正实际日期", exact: true }).click();
    };
    try {
      await page.goto("/requirements/r1");
      await openDates();
      const start = page.getByLabel("实际开始", { exact: true });
      const end = page.getByLabel("实际完成", { exact: true });
      const reason = page.getByLabel("纠错原因");
      await start.fill("2026-08-30");
      await end.fill("2026-09-02");
      await reason.fill("保留这次核对结果");
      await page.getByRole("button", { name: "保存纠错" }).click();
      await expect.poll(() => patches.length).toBe(1);
      releaseFailure();
      await expect(page.getByText("工作项已被更新，请核对后重试", { exact: true })).toBeVisible();
      await expect(start).toHaveValue("2026-08-30");
      if (nextStatus === "completed") await expect(end).toHaveValue("2026-09-02");
      else await expect(end).toHaveCount(0);
      await expect(reason).toHaveValue("保留这次核对结果");
      await expect(page.getByText(nextStatus === "completed" ? /当前记录：2026-08-31 至 2026-09-01/ : /当前记录：2026-08-31 至 未填写/)).toBeVisible();
      await page.getByRole("button", { name: "保存纠错" }).click();
      await expect.poll(() => patches.length).toBe(2);
      expect(patches[1].body).toMatchObject({ expectedVersion: 2, actualStart: "2026-08-30", actualEnd: nextStatus === "completed" ? "2026-09-02" : null, reason: "保留这次核对结果" });
      await expect(page.locator(".inline-edit-popover")).toHaveCount(0);
      await openDates();
      await expect(start).toHaveValue("2026-08-30");
      if (nextStatus === "completed") await expect(end).toHaveValue("2026-09-02");
      else await expect(end).toHaveCount(0);
      await expect(reason).toHaveValue("");
      await start.fill("2026-08-29");
      await reason.fill("取消的草稿");
      await page.keyboard.press("Escape");
      await openDates();
      await expect(start).toHaveValue("2026-08-30");
      await expect(reason).toHaveValue("");
      expect(patches).toHaveLength(2);
    } finally { releaseFailure(); }
  });
}

test("实际日期纠错拦截未来和倒置日期，合法提交期间锁定输入", async ({ page }) => {
  const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
  await mockApplication(page, patches, { workItem: { status: "completed", progress: 100, actualStart: "2026-09-01", actualEnd: "2026-09-03" } });
  let releaseSave!: () => void;
  const pendingSave = new Promise<void>((resolve) => { releaseSave = resolve; });
  await page.route("**/api/work-items/w1/correct", async (route) => {
    const body = route.request().postDataJSON();
    patches.push({ path: "/api/work-items/w1/correct", body });
    await pendingSave;
    await route.fulfill({ json: { ...workItem, ...body, status: "completed", progress: 100, version: 2 } });
  });
  try {
    await page.goto("/requirements/r1");
    await page.getByRole("button", { name: "更多工作项操作" }).first().click();
    await page.getByRole("button", { name: "受控修正实际日期", exact: true }).click();
    const start = page.getByLabel("实际开始", { exact: true });
    const end = page.getByLabel("实际完成", { exact: true });
    const reason = page.getByLabel("纠错原因");
    const save = page.getByRole("button", { name: "保存纠错" });
    await reason.fill("核对历史实际日期");
    await start.fill("2099-01-02");
    await save.click();
    await expect(page.getByRole("alert")).toContainText("实际开始日期不能晚于今天");
    expect(patches).toHaveLength(0);
    await start.fill("2026-08-31");
    await end.fill("2099-01-03");
    await save.click();
    await expect(page.getByRole("alert")).toContainText("实际日期不能晚于今天");
    expect(patches).toHaveLength(0);
    await end.fill("2026-08-30");
    await save.click();
    await expect(page.getByRole("alert")).toContainText("实际完成日期不能早于实际开始日期");
    expect(patches).toHaveLength(0);
    await end.fill("2026-09-02");
    await save.click();
    await expect.poll(() => patches.length).toBe(1);
    expect(patches[0].body).toMatchObject({ actualStart: "2026-08-31", actualEnd: "2026-09-02", reason: "核对历史实际日期", expectedVersion: 1 });
    await expect(start).toBeDisabled();
    await expect(end).toBeDisabled();
    await expect(reason).toHaveAttribute("readonly", "");
    releaseSave();
    await expect(page.locator(".inline-edit-popover")).toHaveCount(0);
  } finally { releaseSave(); }
});

test("编辑需求保留未变更的历史负责人，提交失败保留草稿并可更换负责人", async ({ page }) => {
  const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
  await mockApplication(page, patches);
  let current = { ...requirement, ownerId: 'u1', ownerName: '张三', status: 'in_progress', background: '原背景', workItems: [{ ...workItem, status: 'in_progress', actualStart: '2020-01-02' }] };
  await page.route('**/api/people?*', (route) => route.fulfill({ json: people.map((person) => ({ ...person, active: person.id === 'u1' ? 0 : 1 })) }));
  let releaseFailure!: () => void;
  const failing = new Promise<void>((resolve) => { releaseFailure = resolve; });
  await page.route('**/api/requirements/r1', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fulfill({ json: current });
    const body = route.request().postDataJSON();
    patches.push({ path: '/api/requirements/r1', body });
    if (patches.length === 1) {
      await failing;
      return route.fulfill({ status: 409, json: { error: '保存冲突，请核对后重试' } });
    }
    current = { ...current, ...body, version: current.version + 1 };
    return route.fulfill({ json: current });
  });
  try {
    await page.goto('/requirements/r1');
    await page.getByRole('button', { name: '编辑信息', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '编辑需求信息', exact: true });
    const owner = dialog.getByRole('combobox', { name: '需求负责人', exact: true });
    await expect(owner).toHaveValue('u1');
    await expect(owner.getByRole('option', { selected: true })).toContainText('历史负责人');
    const title = dialog.getByRole('textbox', { name: '需求标题', exact: true });
    const background = dialog.getByRole('textbox', { name: '需求背景（可选）', exact: true });
    await title.fill('补充历史说明');
    await background.fill('不可丢失的历史说明');
    await dialog.getByRole('button', { name: '保存信息', exact: true }).click();
    await expect.poll(() => patches.length).toBe(1);
    expect(patches[0].body).not.toHaveProperty('ownerId');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(title).toBeDisabled();
    await expect(owner).toBeDisabled();
    await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toHaveCount(0);
    releaseFailure();
    await expect(dialog.getByRole('alert')).toHaveText('保存冲突，请核对后重试');
    await expect(title).toHaveValue('补充历史说明');
    await expect(background).toHaveValue('不可丢失的历史说明');
    await dialog.getByRole('button', { name: '保存信息', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(patches[1].body).toEqual(patches[0].body);
    expect(current.ownerId).toBe('u1');
    await expect(page.getByRole('heading', { name: '补充历史说明', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '编辑信息', exact: true }).click();
    await owner.selectOption('u2');
    await dialog.getByRole('button', { name: '保存信息', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(patches).toHaveLength(3);
    expect(patches[2].body).toMatchObject({ ownerId: 'u2', expectedVersion: 2 });
  } finally { releaseFailure(); }
});

test("编辑需求未修改时同步最新字段，修改后按字段重读且不覆盖他人更新", async ({ page }, testInfo) => {
  await mockApplication(page, []);
  let current = { ...requirement, ownerId: 'u1', ownerName: '张三', background: '原背景', acceptanceCriteria: '原标准', referenceUrl: '' };
  const writes: Array<Record<string, unknown>> = [];
  await page.route('**/api/requirements/r1', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: current });
    const body = route.request().postDataJSON();
    writes.push(body);
    current = { ...current, ...body, version: current.version + 1 };
    return route.fulfill({ json: current });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '编辑信息', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑需求信息', exact: true });
  const title = dialog.getByLabel('需求标题', { exact: true });
  const priority = dialog.getByRole('combobox', { name: '优先级', exact: true });
  const owner = dialog.getByRole('combobox', { name: '需求负责人', exact: true });
  const background = dialog.getByRole('textbox', { name: '需求背景（可选）', exact: true });
  current = { ...current, version: 2, title: '未编辑时的新标题', priority: 'P1', ownerId: 'u2', ownerName: '李四', background: '最新背景' };
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await expect(title).toHaveValue('未编辑时的新标题');
  await expect(priority).toHaveValue('P1');
  await expect(owner).toHaveValue('u2');
  await expect(background).toHaveValue('最新背景');
  await title.fill('我填写的标题');
  current = { ...current, version: 3, title: '他人再次改名', priority: 'P0', ownerId: 'u1', ownerName: '张三', background: '他人的新背景' };
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await expect(dialog.getByRole('alert')).toContainText('需求已更新');
  await expect(title).toHaveValue('我填写的标题');
  await expect(dialog.getByRole('button', { name: '保存信息', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '重新读取需求', exact: true }).click();
  await expect(title).toHaveValue('我填写的标题');
  await expect(priority).toHaveValue('P0');
  await expect(owner).toHaveValue('u1');
  await expect(background).toHaveValue('他人的新背景');
  await expect(dialog).toContainText('未修改字段已同步');
  if (testInfo.project.name === 'office-1280') await page.screenshot({ path: 'data/round21-ui/info-rebased-1280.png', animations: 'disabled' });
  await dialog.getByRole('button', { name: '保存信息', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes).toEqual([{ title: '我填写的标题', priority: 'P0', background: '他人的新背景', acceptanceCriteria: '原标准', referenceUrl: '', expectedVersion: 3 }]);
});

test('需求信息已落库但响应异常时核对完整字段并关闭', async ({ page }) => {
  await mockApplication(page, []);
  let current: Requirement = { ...structuredClone(requirement), ownerId: 'u1', ownerName: '张三' };
  let submissions = 0;
  await page.route('**/api/requirements/r1', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: current });
    submissions += 1;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    current = {
      ...current,
      title: String(body.title).replace(/\s+/gu, ' ').trim(),
      priority: String(body.priority),
      ownerId: Object.prototype.hasOwnProperty.call(body, 'ownerId') ? String(body.ownerId || '') || null : current.ownerId,
      background: String(body.background || '').trim() || null,
      acceptanceCriteria: String(body.acceptanceCriteria || '').trim() || null,
      referenceUrl: String(body.referenceUrl || '').trim() || null,
      version: 2,
    };
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '编辑信息', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑需求信息', exact: true });
  await dialog.getByLabel('需求标题', { exact: true }).fill('异常  响应后保存的信息');
  await dialog.getByRole('textbox', { name: '需求背景（可选）', exact: true }).fill('完整字段核对');
  await dialog.getByRole('button', { name: '保存信息', exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('已核对最新状态：需求信息已保存', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '异常 响应后保存的信息', exact: true })).toBeVisible();
  expect(submissions).toBe(1);
});

test("编辑需求409重读失败保留输入，显式恢复后使用最新版本和未修改字段", async ({ page }) => {
  await mockApplication(page, []);
  let current = { ...requirement, ownerId: 'u1', ownerName: '张三', background: '原背景' };
  let readFailure = 0;
  const writes: Array<Record<string, unknown>> = [];
  await page.route('**/api/requirements/r1', async (route) => {
    if (route.request().method() === 'GET') return readFailure
      ? route.fulfill({ status: readFailure, json: { error: `读取失败 ${readFailure}` } })
      : route.fulfill({ json: current });
    const body = route.request().postDataJSON();
    writes.push(body);
    if (writes.length === 1) {
      current = { ...current, version: 2, priority: 'P0', background: '冲突后的背景' };
      return route.fulfill({ status: 409, json: { error: '需求已被他人修改' } });
    }
    current = { ...current, ...body, version: current.version + 1 };
    return route.fulfill({ json: current });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '编辑信息', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑需求信息', exact: true });
  const title = dialog.getByLabel('需求标题', { exact: true });
  const owner = dialog.getByRole('combobox', { name: '需求负责人', exact: true });
  await title.fill('保留的需求标题');
  await owner.selectOption('u2');
  readFailure = 503;
  await dialog.getByRole('button', { name: '保存信息', exact: true }).click();
  await expect(dialog).toContainText('读取失败 503');
  await expect(title).toHaveValue('保留的需求标题');
  await expect(owner).toHaveValue('u2');
  await expect(dialog.getByRole('button', { name: '保存信息', exact: true })).toBeDisabled();
  readFailure = 0;
  await dialog.getByRole('button', { name: '重新读取需求', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: '优先级', exact: true })).toHaveValue('P0');
  await expect(dialog.getByRole('textbox', { name: '需求背景（可选）', exact: true })).toHaveValue('冲突后的背景');
  await expect(title).toHaveValue('保留的需求标题');
  await expect(owner).toHaveValue('u2');
  await dialog.getByRole('button', { name: '保存信息', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes[0].expectedVersion).toBe(1);
  expect(writes[1]).toMatchObject({ title: '保留的需求标题', priority: 'P0', ownerId: 'u2', background: '冲突后的背景', expectedVersion: 2 });
});

test("编辑需求期间进入终态时保留输入但禁止继续保存", async ({ page }) => {
  await mockApplication(page, []);
  let current = { ...requirement };
  const writes: Array<Record<string, unknown>> = [];
  await page.route('**/api/requirements/r1', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: current });
    writes.push(route.request().postDataJSON());
    return route.fulfill({ json: current });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '编辑信息', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑需求信息', exact: true });
  const title = dialog.getByLabel('需求标题', { exact: true });
  await title.fill('终态前的输入');
  current = { ...current, version: 2, status: 'completed' };
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await expect(title).toHaveValue('终态前的输入');
  await expect(dialog).toContainText('需求已完成或取消，不能继续编辑信息');
  await expect(dialog.getByRole('button', { name: '保存信息', exact: true })).toBeDisabled();
  expect(writes).toHaveLength(0);
});

test("待验收需求可从详情补齐负责人，但计划和执行入口保持锁定", async ({ page }) => {
  const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
  const completedItems = requirement.workItems.map((item) => ({
    ...item, ownerId: "u1", ownerName: "张三", assigneeIds: ["u1"], assigneeNames: ["张三"],
    status: "completed", progress: 100, actualStart: item.plannedStart, actualEnd: item.plannedEnd,
  }));
  await mockApplication(page, patches, { requirement: {
    status: "pending_acceptance", progress: 100, plannedProgress: 100,
    ownerId: null, ownerName: null, workItems: completedItems,
  } });
  await page.goto('/requirements/r1');
  await expect(page.getByRole('button', { name: '编辑信息', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '调整计划', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '增加进展', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: '编辑信息', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑需求信息', exact: true });
  await expect(dialog.getByRole('combobox', { name: '需求负责人', exact: true })).toHaveValue('');
  await dialog.getByRole('combobox', { name: '需求负责人', exact: true }).selectOption('u2');
  await dialog.getByRole('button', { name: '保存信息', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(patches.find((entry) => entry.path === '/api/requirements/r1')?.body).toMatchObject({ ownerId: 'u2', expectedVersion: 1 });
});

test("待规划需求的工作项显示不可启动原因并保留其他管理操作", async ({ page }) => {
  await mockApplication(page, [], { requirement: { status: 'planning' } });
  await page.goto('/requirements/r1');
  const waiting = page.getByRole('button', { name: '待规划', exact: true }).first();
  await expect(waiting).toBeDisabled();
  await expect(waiting).toHaveAttribute('title', /需求尚未完成规划/);
  await expect(page.getByRole('button', { name: '开始', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '更多工作项操作', exact: true }).first()).toBeVisible();
});

test("需求详情引用刷新失效时保留草稿并阻止误提交", async ({ page }) => {
  await mockApplication(page, [], { workItem: { plannedStart: null } });
  const allTemplates = [
    { id: "t1", projectId: "p1", name: "研发流程", description: "", createdAt: "2026-09-01", updatedAt: "2026-09-01", items: [] },
    { id: "t2", projectId: "p1", name: "备用流程", description: "", createdAt: "2026-09-01", updatedAt: "2026-09-01", items: [] },
  ];
  let availableTemplates = [...allTemplates];
  let availablePeople = [...people];
  let templateReads = 0;
  let peopleReads = 0;
  await page.route("**/api/templates?*", (route) => {
    templateReads++;
    return route.fulfill({ json: availableTemplates });
  });
  await page.route("**/api/people?*", (route) => {
    peopleReads++;
    return route.fulfill({ json: availablePeople });
  });
  const reconnect = () => page.evaluate(() => { window.dispatchEvent(new Event("offline")); window.dispatchEvent(new Event("online")); });

  await page.goto("/requirements/r1");
  await page.getByRole("button", { name: "编辑信息", exact: true }).click();
  const infoDialog = page.getByRole("dialog", { name: "编辑需求信息", exact: true });
  const owner = infoDialog.getByRole("combobox", { name: "需求负责人", exact: true });
  await owner.selectOption("u2");
  availablePeople = people.slice(0, 1);
  const initialPeopleReads = peopleReads;
  await reconnect();
  await expect.poll(() => peopleReads).toBeGreaterThan(initialPeopleReads);
  await expect(owner).toHaveValue("u2");
  await expect(owner.locator("option:checked")).toHaveText("李四 · 已不可用，请重新选择");
  await expect(infoDialog.getByRole("alert")).toHaveText("所选负责人已不可用，请重新选择。");
  await expect(infoDialog.getByRole("button", { name: "保存信息", exact: true })).toBeDisabled();
  await infoDialog.getByRole("button", { name: "取消", exact: true }).click();

  await page.getByRole("button", { name: "调整计划", exact: true }).click();
  const scheduleDialog = page.getByRole("dialog", { name: "调整需求计划", exact: true });
  const scheduleTemplate = scheduleDialog.getByRole("combobox", { name: "绑定流程", exact: true });
  await scheduleTemplate.selectOption("t2");
  await scheduleDialog.getByRole("button", { name: "保存排期", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "切换需求流程", exact: true });
  await expect(confirmation).toBeVisible();
  availableTemplates = allTemplates.slice(0, 1);
  const initialTemplateReads = templateReads;
  await reconnect();
  await expect.poll(() => templateReads).toBeGreaterThan(initialTemplateReads);
  await expect(confirmation.getByRole("alert")).toHaveText("所选流程已不可用，请取消后重新选择。");
  await expect(confirmation.getByRole("button", { name: "确认切换", exact: true })).toBeDisabled();
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  await expect(scheduleTemplate).toHaveValue("t2");
  await expect(scheduleTemplate.locator("option:checked")).toHaveText("备用流程（已不可用，请重新选择）");
  await expect(scheduleDialog.getByRole("button", { name: "保存排期", exact: true })).toBeDisabled();
  await scheduleDialog.getByRole("button", { name: "取消", exact: true }).click();

  availableTemplates = [...allTemplates];
  const restoreTemplateReads = templateReads;
  await reconnect();
  await expect.poll(() => templateReads).toBeGreaterThan(restoreTemplateReads);
  await page.getByRole("button", { name: /工作项设置|编辑工作项/ }).click();
  await page.getByRole("button", { name: "补全计划", exact: true }).click();
  const planDialog = page.getByRole("dialog", { name: "按模板补全计划", exact: true });
  const planTemplate = planDialog.getByRole("combobox", { name: "流程设计", exact: true });
  await planTemplate.selectOption("t2");
  availableTemplates = allTemplates.slice(0, 1);
  const planTemplateReads = templateReads;
  await reconnect();
  await expect.poll(() => templateReads).toBeGreaterThan(planTemplateReads);
  await expect(planTemplate).toHaveValue("t2");
  await expect(planTemplate.locator("option:checked")).toHaveText("备用流程（已不可用，请重新选择）");
  await expect(planDialog.getByRole("alert")).toHaveText("所选流程已不可用，请重新选择。");
  await expect(planDialog.getByRole("button", { name: "生成差异预览", exact: true })).toBeDisabled();
});

test("工作项菜单可切换到实际日期修正和历史补录，需求可确认整条补录", async ({ page }) => {
  const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
  await mockApplication(page, patches, {
    workItem: { status: "in_progress", actualStart: "2026-09-01" },
    requirement: { progressUpdates: [{
      id: "pu-source", requirementId: "r1", workItemId: "w1", workItemTitle: "设计", percent: 10, workItemPercent: 10,
      content: "原执行记录", eventType: "progress", supersedesId: null, createdByAccountId: "admin", createdByName: "管理员",
      createdAt: "2026-09-02T08:00:00.000Z", updatedAt: "2026-09-02T08:00:00.000Z",
    }] },
  });
  await page.route("**/api/work-items/w1/correct", async (route) => {
    patches.push({ path: "/api/work-items/w1/correct", body: route.request().postDataJSON() });
    await route.fulfill({ json: { ...workItem, status: "in_progress", actualStart: "2026-08-31" } });
  });
  await page.goto("/requirements/r1");
  await page.getByRole("button", { name: "更多工作项操作" }).first().click();
  await page.getByRole("button", { name: "受控修正实际日期", exact: true }).click();
  await expect(page.locator(".inline-edit-popover")).toHaveCount(1);
  await expect(page.getByLabel("实际开始", { exact: true })).toBeVisible();
  await expect(page.getByLabel("实际完成", { exact: true })).toHaveCount(0);
  await page.getByLabel("实际开始", { exact: true }).fill("2026-08-31");
  await page.getByLabel("工作项纠错关联历史记录", { exact: true }).selectOption("pu-source");
  await page.getByRole("button", { name: "保存纠错" }).click();
  await expect(page.getByRole("alert")).toContainText("请填写纠错原因");
  await page.getByLabel("纠错原因").fill("修正历史开始日期");
  await page.getByRole("button", { name: "保存纠错" }).click();
  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0].body).toMatchObject({ actualStart: "2026-08-31", actualEnd: null, reason: "修正历史开始日期", supersedesId: "pu-source", expectedVersion: 1 });
  await expect(page.locator(".inline-edit-popover")).toHaveCount(0);
  await expect(page.getByLabel("操作反馈").getByText("实际日期已修正", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "更多工作项操作" }).first().click();
  await page.getByRole("button", { name: "标记阻塞" }).click();
  await expect(page.getByLabel("阻塞原因")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "更多工作项操作" }).nth(1).click();
  await page.getByRole("button", { name: "按期完成（历史补录）", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认补录完成" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "需求操作" }).click();
  await page.getByRole("button", { name: "按期完成（历史补录）", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认按期完成" })).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("已有执行记录");
  expect(patches).toHaveLength(1);

  let historical = { ...requirement, workItems: [{ ...workItem, plannedStart: "2020-01-02", plannedEnd: null as string | null }] };
  await page.route("**/api/requirements/r1", (route) => route.fulfill({ json: historical }));
  await page.route("**/api/requirements/r1/complete-as-planned", (route) => {
    patches.push({ path: "/api/requirements/r1/complete-as-planned", body: route.request().postDataJSON() });
    historical = { ...historical, status: "completed", progress: 100 };
    return route.fulfill({ json: historical });
  });
  for (const [end, warning] of [[null, "补齐"], ["2099-01-02", "计划尚未结束"], ["2020-01-03", ""]] as const) {
    historical.workItems[0].plannedEnd = end;
    await page.reload();
    await page.getByRole("button", { name: "需求操作" }).click();
    await page.getByRole("button", { name: "按期完成（历史补录）", exact: true }).click();
    const confirm = page.getByRole("button", { name: "确认按期完成" });
    if (warning) {
      await expect(confirm).toBeDisabled();
      await expect(page.getByRole("alert")).toContainText(warning);
    } else {
      await expect(confirm).toBeEnabled();
      await confirm.click();
      await expect(confirm).toHaveCount(0);
    }
  }
  expect(patches).toHaveLength(2);
  expect(patches[1]).toEqual({ path: "/api/requirements/r1/complete-as-planned", body: { expectedVersion: 1 } });
});

test('需求历史补录响应异常时不能把其他完成方式误认成补录成功', async ({ page }) => {
  let current: Requirement = {
    ...structuredClone(requirement),
    workItems: [
      { ...workItem, plannedStart: '2020-01-02', plannedEnd: '2020-01-03' },
      { ...secondWorkItem, plannedStart: '2020-01-06', plannedEnd: '2020-01-07' },
    ],
  };
  await mockApplication(page, [], { requirement: current });
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: current }));
  await page.route('**/api/requirements/r1/complete-as-planned', (route) => {
    current = {
      ...current, status: 'completed', progress: 100, version: 2,
      workItems: current.workItems.map((item) => ({
        ...item, status: 'completed', progress: 100, actualStart: '2020-01-08', actualEnd: '2020-01-09', version: 2,
      })),
    };
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved elsewhere' });
  });

  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '需求操作', exact: true }).click();
  await page.getByRole('button', { name: '按期完成（历史补录）', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '按期完成（历史补录）', exact: true });
  await dialog.getByRole('button', { name: '确认按期完成', exact: true }).click();

  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('需求已经结束，请关闭后重新选择操作。', { exact: true })).toBeVisible();
  await expect(page.getByText('已核对最新状态：需求已完成', { exact: true })).toHaveCount(0);
});

test('需求历史补录已落库但响应异常时核对全部实际日期和完成记录', async ({ page }) => {
  let current: Requirement = {
    ...structuredClone(requirement),
    workItems: [
      { ...workItem, plannedStart: '2020-01-02', plannedEnd: '2020-01-03' },
      { ...secondWorkItem, plannedStart: '2020-01-06', plannedEnd: '2020-01-07' },
    ],
  };
  await mockApplication(page, [], { requirement: current });
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: current }));
  await page.route('**/api/requirements/r1/complete-as-planned', (route) => {
    const completionAt = '2026-09-06T01:00:00.000Z';
    const acceptanceAt = '2026-09-06T01:00:00.001Z';
    const completedItems = current.workItems.map((item) => ({
      ...item, status: 'completed' as const, progress: 100, actualStart: item.plannedStart, actualEnd: item.plannedEnd,
      version: item.version + 1, updatedAt: completionAt,
    }));
    current = {
      ...current, status: 'completed', progress: 100, version: current.version + 2, updatedAt: acceptanceAt,
      workItems: completedItems,
      progressUpdates: [{
        id: 'backfill-accept', requirementId: 'r1', workItemId: null, workItemTitle: null,
        percent: 100, workItemPercent: null, content: '历史补录，按计划完成；确认验收',
        eventType: 'accept', supersedesId: null, createdByAccountId: 'admin', createdByName: '管理员',
        createdAt: acceptanceAt, updatedAt: acceptanceAt,
      }, ...completedItems.map((item, index) => ({
        id: `backfill-${index}`, requirementId: 'r1', workItemId: item.id, workItemTitle: item.title,
        percent: 100, workItemPercent: 100, content: `历史补录，按计划完成（${item.plannedStart} 至 ${item.plannedEnd}）`,
        eventType: 'complete', supersedesId: null, createdByAccountId: 'admin', createdByName: '管理员',
        createdAt: completionAt, updatedAt: completionAt,
      }))],
    };
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '需求操作', exact: true }).click();
  await page.getByRole('button', { name: '按期完成（历史补录）', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '按期完成（历史补录）', exact: true });
  await dialog.getByRole('button', { name: '确认按期完成', exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('已核对最新状态：需求已按期补录完成', { exact: true })).toBeVisible();
});

test('取消需求响应异常时核对本次取消原因而非只看终态', async ({ page }) => {
  const baseline = structuredClone(requirement);
  const reason = '本次取消原因';
  let current = structuredClone(baseline);
  let eventMode: 'other-reason' | 'other-author' | 'matching' = 'other-reason';
  await mockApplication(page, [], { requirement: current });
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: current }));
  await page.route('**/api/requirements/r1/cancel', (route) => {
    const updatedAt = '2026-09-06T01:00:00.000Z';
    current = {
      ...current, status: 'cancelled', version: current.version + 1, updatedAt,
      progressUpdates: [{
        id: `${eventMode}-cancel`, requirementId: 'r1', workItemId: null, workItemTitle: null,
        percent: current.progress, workItemPercent: null, content: eventMode === 'other-reason' ? '其他操作的取消原因' : reason,
        eventType: 'cancel', supersedesId: null,
        createdByAccountId: eventMode === 'other-author' ? 'other-account' : 'admin',
        createdByName: eventMode === 'other-author' ? '其他用户' : '管理员',
        createdAt: updatedAt, updatedAt,
      }],
    };
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  const cancel = async () => {
    await page.getByRole('button', { name: '需求操作', exact: true }).click();
    await page.getByRole('button', { name: '取消需求', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '取消需求', exact: true });
    await dialog.getByLabel('取消原因', { exact: true }).fill(reason);
    await dialog.getByRole('button', { name: '确认取消', exact: true }).click();
    return dialog;
  };

  await page.goto('/requirements/r1');
  const mismatched = await cancel();
  await expect(mismatched).toBeVisible();
  await expect(mismatched.getByText('需求已经结束，请关闭后重新选择操作。', { exact: true })).toBeVisible();
  await expect(page.getByText('已核对最新状态：需求已取消', { exact: true })).toHaveCount(0);
  await mismatched.getByRole('button', { name: '取消', exact: true }).click();

  current = structuredClone(baseline);
  eventMode = 'other-author';
  await page.reload();
  const otherAuthor = await cancel();
  await expect(otherAuthor).toBeVisible();
  await expect(page.getByText('已核对最新状态：需求已取消', { exact: true })).toHaveCount(0);

  current = structuredClone(baseline);
  eventMode = 'matching';
  await page.reload();
  const matched = await cancel();
  await expect(matched).toHaveCount(0);
  await expect(page.getByText('已核对最新状态：需求已取消', { exact: true })).toBeVisible();
});

test("工作项纠错历史显示被更正记录", async ({ page }) => {
  await mockApplication(page, [], { requirement: { progressUpdates: [
    {
      id: "pu-correction", requirementId: "r1", workItemId: "w1", workItemTitle: "设计", percent: 20, workItemPercent: 20,
      content: "修正实际日期", eventType: "correction", supersedesId: "pu-source", createdByAccountId: "admin", createdByName: "管理员",
      createdAt: "2026-09-03T08:00:00.000Z", updatedAt: "2026-09-03T08:00:00.000Z",
    },
    {
      id: "pu-source", requirementId: "r1", workItemId: "w1", workItemTitle: "设计", percent: 10, workItemPercent: 10,
      content: "原执行记录", eventType: "progress", supersedesId: null, createdByAccountId: "admin", createdByName: "管理员",
      createdAt: "2026-09-02T08:00:00.000Z", updatedAt: "2026-09-02T08:00:00.000Z",
    },
  ] } });
  await page.goto("/requirements/r1");
  const correction = page.locator(".progress-feed > article").filter({ hasText: "修正实际日期" });
  await expect(correction).toContainText("更正：");
  await expect(correction).toContainText("进展");
  await expect(correction).not.toContainText("原记录不可用");
});

test("已取消需求保留工作项受控修正，但不开放重开和推进", async ({ page }) => {
  const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
  const cancelledItem = {
    ...workItem,
    status: "cancelled" as const,
    progress: 40,
    actualStart: "2026-09-01",
    actualEnd: null,
  };
  await mockApplication(page, patches, { workItem: cancelledItem });
  await page.route("**/api/requirements/r1", (route) => route.fulfill({
    json: { ...requirement, status: "cancelled", progress: 40, workItems: [cancelledItem] },
  }));
  await page.route("**/api/work-items/w1/correct", async (route) => {
    patches.push({ path: "/api/work-items/w1/correct", body: route.request().postDataJSON() });
    await route.fulfill({ json: { ...cancelledItem, actualStart: "2026-08-31", version: 2 } });
  });

  await page.goto("/requirements/r1");
  await page.getByRole("button", { name: "更多工作项操作", exact: true }).click();
  await expect(page.getByRole("button", { name: "受控修正实际日期", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "重开/返工", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "受控修正实际日期", exact: true }).click();
  await page.getByLabel("实际开始", { exact: true }).fill("2026-08-31");
  await page.getByLabel("纠错原因", { exact: true }).fill("修正取消前的历史日期");
  await page.getByRole("button", { name: "保存纠错", exact: true }).click();

  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0]).toEqual({
    path: "/api/work-items/w1/correct",
    body: { actualStart: "2026-08-31", actualEnd: null, reason: "修正取消前的历史日期", expectedVersion: 1 },
  });
});

test("从工作项菜单直接切换到需求操作时，新菜单不会被旧浮层关闭", async ({ page }) => {
  await mockApplication(page, []);
  await page.goto("/requirements/r1");

  await page.getByRole("button", { name: "更多工作项操作" }).first().click();
  await expect(page.getByRole("button", { name: "按期完成（历史补录）", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "需求操作", exact: true }).click();
  await expect(page.locator(".inline-edit-popover")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "按期完成（历史补录）", exact: true })).toBeVisible();
});

test("修正实际日期使用打开弹层时的工作项版本，后台刷新不能把旧输入配新版本提交", async ({ page }) => {
  await mockApplication(page, [], { workItem: { status: "in_progress", actualStart: "2026-09-01" } });
  let current = {
    ...structuredClone(requirement),
    workItems: requirement.workItems.map((item, index) => index === 0
      ? { ...item, status: "in_progress" as const, actualStart: "2026-09-01", version: 1 }
      : item),
  };
  let reads = 0;
  const corrections: Array<Record<string, unknown>> = [];
  await page.route("**/api/requirements/r1", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    reads += 1;
    return route.fulfill({ json: current });
  });
  await page.route("**/api/work-items/w1/correct", async (route) => {
    corrections.push(route.request().postDataJSON());
    await route.fulfill({ status: 409, json: { error: "工作项已更新，请核对后重试", code: "STALE_WRITE" } });
  });

  await page.goto("/requirements/r1");
  await page.getByRole("button", { name: "更多工作项操作" }).first().click();
  await page.getByRole("button", { name: "受控修正实际日期", exact: true }).click();
  const actualStart = page.getByLabel("实际开始", { exact: true });
  const reason = page.getByRole("textbox", { name: "纠错原因", exact: true });
  await actualStart.fill("2026-08-31");
  await reason.fill("保留打开时的修正草稿");

  current = {
    ...current,
    version: 2,
    workItems: current.workItems.map((item, index) => index === 0
      ? { ...item, actualStart: "2026-08-30", version: 2 }
      : item),
  };
  await page.evaluate(() => { window.dispatchEvent(new Event("offline")); window.dispatchEvent(new Event("online")); });
  await expect.poll(() => reads).toBeGreaterThan(1);
  await page.getByRole("button", { name: "保存纠错", exact: true }).click();

  await expect.poll(() => corrections.length).toBe(1);
  expect(corrections[0]).toMatchObject({ actualStart: "2026-08-31", reason: "保留打开时的修正草稿", expectedVersion: 1 });
  await expect(actualStart).toHaveValue("2026-08-31");
  await expect(reason).toHaveValue("保留打开时的修正草稿");
});

test("工作项历史补录固定确认版本，计划变化后核对新日期再重试", async ({ page }) => {
  await mockApplication(page, []);
  let current = { ...structuredClone(requirement), workItems: [{ ...workItem, plannedStart: "2020-01-02", plannedEnd: "2020-01-03" }] };
  let reads = 0;
  const submissions: Array<Record<string, unknown>> = [];
  await page.route("**/api/requirements/r1", (route) => { reads++; return route.fulfill({ json: current }); });
  await page.route("**/api/work-items/w1/complete-as-planned", (route) => {
    submissions.push(route.request().postDataJSON());
    return submissions.length === 1
      ? route.fulfill({ status: 409, json: { error: "计划已更新，请重新核对", code: "STALE_WRITE" } })
      : route.fulfill({ json: { ...current.workItems[0], status: "completed", progress: 100 } });
  });
  await page.goto("/requirements/r1");
  await page.getByRole("button", { name: "更多工作项操作" }).first().click();
  await page.getByRole("button", { name: "按期完成（历史补录）", exact: true }).click();
  current = { ...current, version: 2, workItems: [{ ...current.workItems[0], plannedEnd: "2020-01-06", version: 2 }] };
  const previousReads = reads;
  await page.evaluate(() => { window.dispatchEvent(new Event("offline")); window.dispatchEvent(new Event("online")); });
  await expect.poll(() => reads).toBeGreaterThan(previousReads);
  const popover = page.locator(".inline-edit-popover");
  await popover.getByRole("button", { name: "确认补录完成", exact: true }).click();
  await expect(popover.getByText(/已读取最新工作项（版本 2）/)).toBeVisible();
  await expect(popover).toContainText("2020-01-06");
  expect(submissions).toEqual([{ expectedVersion: 1 }]);
  await popover.getByRole("button", { name: "确认补录完成", exact: true }).click();
  await expect(popover).toHaveCount(0);
  expect(submissions).toEqual([{ expectedVersion: 1 }, { expectedVersion: 2 }]);
});

test("工作项历史补录成功但响应异常时读取状态并避免重复提交", async ({ page }) => {
  await mockApplication(page, []);
  let current = {
    ...structuredClone(requirement),
    workItems: [{ ...workItem, plannedStart: "2020-01-02", plannedEnd: "2020-01-03" }],
  };
  let submissions = 0;
  await page.route("**/api/requirements/r1", (route) => route.fulfill({ json: current }));
  await page.route("**/api/work-items/w1/complete-as-planned", (route) => {
    submissions += 1;
    const completedAt = '2026-09-05T08:00:00.000Z';
    current = {
      ...current,
      status: "pending_acceptance",
      progress: 100,
      version: 2,
      workItems: [{
        ...current.workItems[0],
        status: "completed",
        progress: 100,
        actualStart: "2020-01-02",
        actualEnd: "2020-01-03",
        version: 2,
        updatedAt: completedAt,
      }],
      progressUpdates: [{
        id: 'backfill-complete', requirementId: 'r1', workItemId: 'w1', workItemTitle: '设计',
        percent: 100, workItemPercent: 100, content: '历史补录，按计划完成（2020-01-02 至 2020-01-03）',
        eventType: 'complete', createdByAccountId: 'admin', createdByName: '管理员',
        createdAt: completedAt, updatedAt: completedAt,
      }],
    };
    return route.fulfill({ status: 200, contentType: "text/html", body: "saved" });
  });

  await page.goto("/requirements/r1");
  await page.getByRole("button", { name: "更多工作项操作", exact: true }).click();
  await page.getByRole("button", { name: "按期完成（历史补录）", exact: true }).click();
  await page.getByRole("button", { name: "确认补录完成", exact: true }).click();

  await expect(page.locator(".inline-edit-popover")).toHaveCount(0);
  await expect(page.getByText("已核对最新状态：工作项已按计划补录完成", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "已完成", exact: true })).toBeVisible();
  expect(submissions).toBe(1);
});

test('工作项历史补录响应异常时不把其他账号的相同补录误认成本人提交', async ({ page }) => {
  let current: Requirement = {
    ...structuredClone(requirement),
    workItems: [{ ...workItem, plannedStart: '2020-01-02', plannedEnd: '2020-01-03' }],
  };
  await mockApplication(page, [], { requirement: current });
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: current }));
  await page.route('**/api/work-items/w1/complete-as-planned', (route) => {
    const completedAt = '2026-09-05T08:00:00.000Z';
    current = {
      ...current, status: 'pending_acceptance', progress: 100, version: 2,
      workItems: [{
        ...current.workItems[0], status: 'completed', progress: 100,
        actualStart: '2020-01-02', actualEnd: '2020-01-03', version: 2, updatedAt: completedAt,
      }],
      progressUpdates: [{
        id: 'other-backfill', requirementId: 'r1', workItemId: 'w1', workItemTitle: '设计',
        percent: 100, workItemPercent: 100, content: '历史补录，按计划完成（2020-01-02 至 2020-01-03）',
        eventType: 'complete', createdByAccountId: 'other-account', createdByName: '其他用户',
        createdAt: completedAt, updatedAt: completedAt,
      }],
    };
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved elsewhere' });
  });

  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '更多工作项操作', exact: true }).click();
  await page.getByRole('button', { name: '按期完成（历史补录）', exact: true }).click();
  const popover = page.locator('.inline-edit-popover');
  await popover.getByRole('button', { name: '确认补录完成', exact: true }).click();

  await expect(popover).toBeVisible();
  await expect(page.getByText('已核对最新状态：工作项已按计划补录完成', { exact: true })).toHaveCount(0);
});

for (const [eventAccountId, reconciled] of [['admin', true], ['other-account', false]] as const) {
  test(`工作项受控修正响应异常时${reconciled ? '核对本人纠错事件' : '不误认其他账号的相同纠错'}`, async ({ page }) => {
    const startedItem = { ...workItem, status: 'in_progress' as const, actualStart: '2026-09-01', progress: 40 };
    let current: Requirement = {
      ...structuredClone(requirement), status: 'in_progress', progress: 40,
      workItems: [startedItem, secondWorkItem], progressUpdates: [],
    };
    await mockApplication(page, [], { requirement: current });
    await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: current }));
    await page.route('**/api/work-items/w1/correct', (route) => {
      const correctedAt = '2026-09-05T08:00:00.000Z';
      current = {
        ...current, version: 2,
        workItems: [{ ...startedItem, actualStart: '2026-08-31', version: 2, updatedAt: correctedAt }, secondWorkItem],
        progressUpdates: [{
          id: `${eventAccountId}-correction`, requirementId: 'r1', workItemId: 'w1', workItemTitle: '设计',
          percent: 40, workItemPercent: 40, content: '核对实际开始日期', eventType: 'correction',
          createdByAccountId: eventAccountId, createdByName: eventAccountId,
          createdAt: correctedAt, updatedAt: correctedAt,
        }],
      };
      return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
    });

    await page.goto('/requirements/r1');
    await page.getByRole('button', { name: '更多工作项操作', exact: true }).first().click();
    await page.getByRole('button', { name: '受控修正实际日期', exact: true }).click();
    const popover = page.locator('.inline-edit-popover');
    await popover.getByLabel('实际开始', { exact: true }).fill('2026-08-31');
    await popover.getByLabel('纠错原因', { exact: true }).fill('核对实际开始日期');
    await popover.getByRole('button', { name: '保存纠错', exact: true }).click();

    await expect(popover).toHaveCount(reconciled ? 0 : 1);
    await expect(page.getByText('已核对最新状态：实际日期已修正', { exact: true })).toHaveCount(reconciled ? 1 : 0);
  });
}

test('工作项历史补录响应异常时不把其他完成日期误认成补录成功', async ({ page }) => {
  let current = {
    ...structuredClone(requirement),
    workItems: [{ ...workItem, plannedStart: '2020-01-02', plannedEnd: '2020-01-03' }],
  };
  await mockApplication(page, [], { requirement: current });
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: current }));
  await page.route('**/api/work-items/w1/complete-as-planned', (route) => {
    current = {
      ...current, status: 'pending_acceptance', progress: 100, version: 2,
      workItems: [{
        ...current.workItems[0], status: 'completed', progress: 100,
        actualStart: '2020-01-06', actualEnd: '2020-01-07', version: 2,
      }],
    };
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'completed elsewhere' });
  });

  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '更多工作项操作', exact: true }).click();
  await page.getByRole('button', { name: '按期完成（历史补录）', exact: true }).click();
  const popover = page.locator('.inline-edit-popover');
  await popover.getByRole('button', { name: '确认补录完成', exact: true }).click();

  await expect(popover).toBeVisible();
  await expect(popover.getByText('工作项状态已变化，请关闭后重新选择操作。', { exact: true })).toBeVisible();
  await expect(page.getByText('已核对最新状态：工作项已按计划补录完成', { exact: true })).toHaveCount(0);
});

for (const recordMatchingEvent of [true, false]) {
  test(`工作项完成响应异常时${recordMatchingEvent ? '按命令事件确认成功' : '不把相同终态误认成本次成功'}`, async ({ page }) => {
    const startedItem = {
      ...workItem,
      status: 'in_progress' as const,
      actualStart: '2026-09-01',
      progress: 60,
    };
    let current: Requirement = {
      ...structuredClone(requirement),
      status: 'in_progress',
      progress: 60,
      workItems: [startedItem, secondWorkItem],
      progressUpdates: [],
    };
    await mockApplication(page, [], { requirement: current });
    await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: current }));
    await page.route('**/api/work-items/w1/complete', (route) => {
      const completedAt = '2026-09-03T08:00:00.000Z';
      current = {
        ...current,
        status: 'pending_acceptance',
        progress: 100,
        version: 2,
        workItems: [{
          ...startedItem,
          status: 'completed',
          progress: 100,
          actualEnd: '2026-09-03',
          version: 2,
          updatedAt: completedAt,
        }, secondWorkItem],
        progressUpdates: recordMatchingEvent ? [{
          id: 'pu-complete', requirementId: 'r1', workItemId: 'w1', workItemTitle: '设计',
          percent: 100, workItemPercent: 100, content: '完成历史交付', eventType: 'complete',
          createdByAccountId: 'admin', createdByName: '管理员',
          createdAt: completedAt, updatedAt: completedAt,
        }] : [],
      };
      return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
    });

    await page.goto('/requirements/r1');
    await page.getByRole('button', { name: '完成', exact: true }).click();
    const popover = page.locator('.inline-edit-popover');
    await popover.getByRole('textbox', { name: '完成说明', exact: true }).fill('完成历史交付');
    await popover.getByRole('button', { name: '确认完成', exact: true }).click();

    if (recordMatchingEvent) {
      await expect(popover).toHaveCount(0);
      await expect(page.getByText('已核对最新状态：工作项已完成', { exact: true })).toBeVisible();
    } else {
      await expect(popover).toBeVisible();
      await expect(page.getByText('已核对最新状态：工作项已完成', { exact: true })).toHaveCount(0);
    }
  });
}

test('工作项完成响应异常时不把其他账号的相同命令误认成本人提交', async ({ page }) => {
  const startedItem = {
    ...workItem, status: 'in_progress' as const, actualStart: '2026-09-01', progress: 60,
  };
  let current: Requirement = {
    ...structuredClone(requirement), status: 'in_progress', progress: 60,
    workItems: [startedItem, secondWorkItem], progressUpdates: [],
  };
  await mockApplication(page, [], { requirement: current });
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: current }));
  await page.route('**/api/work-items/w1/complete', (route) => {
    const completedAt = '2026-09-03T08:00:00.000Z';
    current = {
      ...current, status: 'pending_acceptance', progress: 100, version: 2,
      workItems: [{
        ...startedItem, status: 'completed', progress: 100, actualEnd: '2026-09-03',
        version: 2, updatedAt: completedAt,
      }, secondWorkItem],
      progressUpdates: [{
        id: 'other-complete', requirementId: 'r1', workItemId: 'w1', workItemTitle: '设计',
        percent: 100, workItemPercent: 100, content: '完成历史交付', eventType: 'complete',
        createdByAccountId: 'other-account', createdByName: '其他用户',
        createdAt: completedAt, updatedAt: completedAt,
      }],
    };
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved elsewhere' });
  });

  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  const popover = page.locator('.inline-edit-popover');
  await popover.getByRole('textbox', { name: '完成说明', exact: true }).fill('完成历史交付');
  await popover.getByRole('button', { name: '确认完成', exact: true }).click();

  await expect(popover).toBeVisible();
  await expect(page.getByText('已核对最新状态：工作项已完成', { exact: true })).toHaveCount(0);
});

test("工作项名称行内编辑固定打开版本，后台更新后保留草稿并显式重读", async ({ page }) => {
  await mockApplication(page, []);
  let current = structuredClone(requirement);
  let reads = 0;
  const submissions: Array<Record<string, unknown>> = [];
  await page.route("**/api/requirements/r1", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    reads++;
    return route.fulfill({ json: current });
  });
  await page.route("**/api/work-items/w1", (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    const body = route.request().postDataJSON();
    submissions.push(body);
    const saved = { ...current.workItems[0], ...body, version: current.workItems[0].version + 1 };
    current = { ...current, version: current.version + 1, workItems: [saved, current.workItems[1]] };
    return route.fulfill({ json: saved });
  });

  await page.goto("/requirements/r1");
  await page.getByRole("button", { name: "工作项设置", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "工作项设置", exact: true });
  await dialog.getByRole("button", { name: /工作项名称：设计/ }).click();
  const editor = page.getByLabel("工作项名称", { exact: true });
  await editor.fill("保留的标题草稿");

  current = {
    ...current,
    version: 2,
    workItems: [{ ...current.workItems[0], title: "后台更新的标题", version: 2 }, current.workItems[1]],
  };
  const previousReads = reads;
  await page.evaluate(() => { window.dispatchEvent(new Event("offline")); window.dispatchEvent(new Event("online")); });
  await expect.poll(() => reads).toBeGreaterThan(previousReads);
  await editor.press("Enter");

  expect(submissions).toHaveLength(0);
  await expect(editor).toHaveValue("保留的标题草稿");
  await expect(page.getByText(/工作项已更新/)).toBeVisible();
  await page.getByRole("button", { name: "重新读取工作项", exact: true }).click();
  await expect(editor).toHaveValue("保留的标题草稿");
  await expect(page.getByText(/已读取最新工作项（版本 2）/)).toBeVisible();
  await editor.press("Enter");
  await expect.poll(() => submissions.length).toBe(1);
  expect(submissions[0]).toMatchObject({ title: "保留的标题草稿", expectedVersion: 2 });
});

test("工作项设置偏差使用需求业务日期", async ({ page }) => {
  await mockApplication(page, [], {
    requirement: { asOfDate: "2026-09-03" },
    workItem: {
      status: "in_progress",
      progress: 50,
      plannedStart: "2026-09-01",
      plannedEnd: "2026-09-02",
      actualStart: "2026-09-01",
    },
  });
  await page.goto("/requirements/r1");
  await page.getByRole("button", { name: "工作项设置", exact: true }).click();
  const firstRow = page.getByRole("dialog", { name: "工作项设置", exact: true }).locator("tbody tr").first();
  await expect(firstRow.locator(".work-inline-status")).toContainText("+1工作日");
});

test("工作项负责人、协作者和日期共用版本快照，重读时保留各自草稿", async ({ page }) => {
  await mockApplication(page, []);
  let current = {
    ...structuredClone(requirement),
    workItems: [structuredClone(workItem), { ...structuredClone(secondWorkItem), status: "in_progress" as const, progress: 20, actualStart: "2026-09-04" }],
  };
  let reads = 0;
  const submissions: Array<Record<string, unknown>> = [];
  await page.route("**/api/requirements/r1", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    reads++;
    return route.fulfill({ json: current });
  });
  await page.route("**/api/work-items/w1", (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    const body = route.request().postDataJSON();
    submissions.push(body);
    const source = current.workItems[0];
    const ownerId = Object.prototype.hasOwnProperty.call(body, "ownerId") ? String(body.ownerId || "") || null : source.ownerId;
    const assigneeIds = Array.isArray(body.assigneeIds) ? body.assigneeIds.map(String) : source.assigneeIds;
    const collaborators = people.filter((person) => assigneeIds.includes(person.id) && person.id !== ownerId);
    const saved = {
      ...source,
      ...body,
      ownerId,
      ownerName: people.find((person) => person.id === ownerId)?.name || null,
      assigneeIds,
      assigneeNames: people.filter((person) => assigneeIds.includes(person.id)).map((person) => person.name),
      collaborators,
      version: source.version + 1,
    };
    current = { ...current, version: current.version + 1, workItems: [saved, current.workItems[1]] };
    return route.fulfill({ json: saved });
  });
  const pushBackgroundUpdate = async (changes: Partial<WorkItem>) => {
    const previousReads = reads;
    current = {
      ...current,
      version: current.version + 1,
      workItems: [{ ...current.workItems[0], ...changes, version: current.workItems[0].version + 1 }, current.workItems[1]],
    };
    await page.evaluate(() => { window.dispatchEvent(new Event("offline")); window.dispatchEvent(new Event("online")); });
    await expect.poll(() => reads).toBeGreaterThan(previousReads);
  };
  const reloadDraft = async (popover: Locator, expectedVersion: number) => {
    await expect(popover.getByText(/工作项已更新/)).toBeVisible();
    await popover.getByRole("button", { name: "重新读取工作项", exact: true }).click();
    await expect(popover.getByText(new RegExp(`已读取最新工作项（版本 ${expectedVersion}）`))).toBeVisible();
  };

  await page.goto("/requirements/r1");
  await page.getByRole("button", { name: "工作项设置", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "工作项设置", exact: true });
  const firstRow = dialog.locator("tbody tr").first();

  await firstRow.getByRole("button", { name: /主负责人：未分配/ }).click();
  let popover = page.locator(".inline-select-popover");
  await popover.getByRole("option", { name: /张三/ }).click();
  await popover.getByRole("textbox", { name: "调整原因", exact: true }).fill("保留负责人草稿");
  await pushBackgroundUpdate({ ownerId: "u2", ownerName: "李四", assigneeIds: ["u2"], assigneeNames: ["李四"] });
  await expect(popover.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  expect(submissions).toHaveLength(0);
  await reloadDraft(popover, 2);
  await expect(popover.getByRole("textbox", { name: "调整原因", exact: true })).toHaveValue("保留负责人草稿");
  await popover.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => submissions.length).toBe(1);
  expect(submissions[0]).toMatchObject({ ownerId: "u1", assigneeIds: ["u1"], reason: "保留负责人草稿", expectedVersion: 2 });

  await firstRow.getByRole("button", { name: /计划开始：2026-09-01/ }).click();
  popover = page.locator(".inline-date-popover");
  await popover.getByRole("gridcell", { name: "2026-09-02", exact: true }).click();
  await pushBackgroundUpdate({ plannedStart: "2026-09-03" });
  await expect(popover.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  expect(submissions).toHaveLength(1);
  await reloadDraft(popover, 4);
  await expect(popover.getByRole("gridcell", { name: "2026-09-02", exact: true })).toHaveAttribute("aria-selected", "true");
  await popover.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => submissions.length).toBe(2);
  expect(submissions[1]).toMatchObject({ plannedStart: "2026-09-02", expectedVersion: 4 });

  await firstRow.getByRole("button", { name: /协作人员：无协作人员/ }).click();
  popover = page.locator(".inline-multi-popover");
  await popover.getByRole("checkbox", { name: /李四/ }).check();
  await pushBackgroundUpdate({ title: "后台再次更新标题" });
  await expect(popover.getByRole("button", { name: "完成", exact: true })).toBeDisabled();
  expect(submissions).toHaveLength(2);
  await reloadDraft(popover, 6);
  await expect(popover.getByRole("checkbox", { name: /李四/ })).toBeChecked();
  await popover.getByRole("button", { name: "完成", exact: true }).click();
  await expect.poll(() => submissions.length).toBe(3);
  expect(submissions[2]).toMatchObject({ assigneeIds: ["u1", "u2"], expectedVersion: 6 });
});

test("执行中工作项待确认的负责人失效后禁止提交旧人员", async ({ page }) => {
  await mockApplication(page, [], { workItem: { status: "in_progress", actualStart: "2026-09-01" } });
  let availablePeople = [...people];
  let peopleReads = 0;
  const submissions: Array<Record<string, unknown>> = [];
  await page.route("**/api/people?*", (route) => {
    peopleReads++;
    return route.fulfill({ json: availablePeople });
  });
  await page.route("**/api/work-items/w1", (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ json: { ...workItem, status: "in_progress", actualStart: "2026-09-01", ownerId: "u1", ownerName: "张三", assigneeIds: ["u1"], assigneeNames: ["张三"], version: 2 } });
  });
  await page.goto("/requirements/r1");
  await page.getByRole("button", { name: "工作项设置", exact: true }).click();
  const row = page.getByRole("dialog", { name: "工作项设置", exact: true }).locator("tbody tr").first();
  await row.getByRole("button", { name: /主负责人：未分配/ }).click();
  const popover = page.locator(".inline-select-popover");
  await popover.getByRole("option", { name: /李四/ }).click();
  await popover.getByRole("textbox", { name: "调整原因", exact: true }).fill("切换执行负责人");
  availablePeople = people.slice(0, 1);
  const previousReads = peopleReads;
  await page.evaluate(() => { window.dispatchEvent(new Event("offline")); window.dispatchEvent(new Event("online")); });
  await expect.poll(() => peopleReads).toBeGreaterThan(previousReads);
  await expect(popover.getByRole("alert")).toHaveText("李四已不可用，请重新选择");
  await expect(popover.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  expect(submissions).toHaveLength(0);
  await popover.getByRole("option", { name: /张三/ }).click();
  await popover.getByRole("textbox", { name: "调整原因", exact: true }).fill("改选仍有效人员");
  await popover.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => submissions).toHaveLength(1);
  expect(submissions[0]).toMatchObject({ ownerId: "u1", assigneeIds: ["u1"], reason: "改选仍有效人员", expectedVersion: 1 });
});

test("新增工作项人员刷新失效后保留姓名并要求清理选择", async ({ page }) => {
  await mockApplication(page, []);
  let availablePeople = [...people];
  let peopleReads = 0;
  const submissions: Array<Record<string, unknown>> = [];
  await page.route("**/api/people?*", (route) => {
    peopleReads++;
    return route.fulfill({ json: availablePeople });
  });
  await page.route("**/api/requirements/r1/work-items", (route) => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ json: { ...workItem, id: "w3", title: "人员变化草稿" } });
  });
  await page.goto("/requirements/r1");
  await page.getByRole("button", { name: "工作项设置", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "工作项设置", exact: true });
  await editor.getByRole("button", { name: "添加工作项", exact: true }).click();
  await editor.getByRole("button", { name: /新工作项名称/ }).click();
  await page.getByLabel("新工作项名称", { exact: true }).fill("人员变化草稿");
  await page.getByLabel("新工作项名称", { exact: true }).press("Enter");
  await editor.getByRole("button", { name: /新工作项主负责人：未分配/ }).click();
  await page.locator(".inline-select-popover").getByRole("option", { name: /李四/ }).click();
  await editor.getByRole("button", { name: /新工作项协作人员：选择人员/ }).click();
  const collaborators = page.locator(".inline-multi-popover");
  await collaborators.getByRole("checkbox", { name: /张三/ }).check();
  availablePeople = [];
  const previousReads = peopleReads;
  await page.evaluate(() => { window.dispatchEvent(new Event("offline")); window.dispatchEvent(new Event("online")); });
  await expect.poll(() => peopleReads).toBeGreaterThan(previousReads);
  await expect(collaborators.getByRole("checkbox", { name: /张三/ })).toBeChecked();
  await expect(collaborators.getByRole("alert")).toHaveText("张三已不可用，请取消选择后保存。");
  await expect(collaborators.getByRole("button", { name: "完成", exact: true })).toBeDisabled();
  await collaborators.getByRole("checkbox", { name: /张三/ }).click();
  await collaborators.getByRole("button", { name: "完成", exact: true }).click();
  await expect(editor.getByRole("button", { name: /新工作项主负责人：李四（已不可用）/ })).toBeVisible();
  await expect(editor.getByRole("alert")).toHaveText("新增工作项选择的人员已不可用，请重新选择负责人或协作人员。");
  await expect(editor.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  expect(submissions).toHaveLength(0);
  await editor.getByRole("button", { name: /新工作项主负责人：李四（已不可用）/ }).click();
  await page.locator(".inline-select-popover").getByRole("option", { name: "未分配", exact: true }).click();
  await expect(editor.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => submissions).toHaveLength(1);
  expect(submissions[0]).toMatchObject({ title: "人员变化草稿", ownerId: null, assigneeIds: [], expectedVersion: 1 });
});

test("新增工作项显示在列表末尾并自动滚动到草稿", async ({ page }) => {
  const workItems = Array.from({ length: 14 }, (_, index) => ({
    ...structuredClone(workItem),
    id: `append-${index}`,
    templateItemId: null,
    title: `已有工作项${index + 1}`,
    milestoneLabel: null,
    sortOrder: index,
  }));
  await mockApplication(page, [], { requirement: { workItems } });
  await page.goto("/requirements/r1");
  await page.getByRole("button", { name: "工作项设置", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "工作项设置", exact: true });
  const scrollArea = editor.locator(".work-editor-scroll");

  await editor.getByRole("button", { name: "添加工作项", exact: true }).click();

  const newRow = editor.locator("tbody > tr.work-inline-new-row");
  await expect(newRow).toHaveCount(1);
  await expect(editor.locator("tbody > tr").last()).toHaveClass(/work-inline-new-row/);
  await expect(newRow.getByRole("button", { name: /新工作项名称/ })).toBeFocused();
  await expect.poll(() => scrollArea.evaluate((element) => Math.round(element.scrollTop + element.clientHeight - element.scrollHeight))).toBeGreaterThanOrEqual(-2);
});

test("需求列表为已评估的中风险显示统一徽章", async ({ page }) => {
  await mockApplication(page, [], { requirement: { riskLevel: "medium", riskEvaluated: true, highRisk: false } });
  await page.goto("/requirements");
  await expect(page.locator(".requirements-table .risk-badge.risk-medium")).toHaveText("中风险");
});

test("终态工作项在设置页保持只读，历史日期仅由受控修正入口处理", async ({ page }) => {
  await mockApplication(page, [], { workItem: { status: "completed", progress: 100, actualStart: "2026-09-01", actualEnd: "2026-09-03" } });
  await page.goto("/requirements/r1");
  await page.getByRole("button", { name: "工作项设置", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "工作项设置", exact: true });
  const firstRow = dialog.locator("tbody tr").first();
  for (const name of [/工作项名称：设计/, /里程碑名称：需求基线/, /主负责人：未分配/, /协作人员：无协作人员/, /计划开始：2026-09-01/, /计划完成：2026-09-03/]) {
    await expect(firstRow.getByRole("button", { name })).toBeDisabled();
  }
});

test("无需原因的负责人选择在后台更新后也先保留所选项再提交", async ({ page }) => {
  await mockApplication(page, []);
  let current = structuredClone(requirement);
  let reads = 0;
  const submissions: Array<Record<string, unknown>> = [];
  await page.route("**/api/requirements/r1", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    reads++;
    return route.fulfill({ json: current });
  });
  await page.route("**/api/work-items/w1", (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ json: { ...current.workItems[0], ownerId: "u1", ownerName: "张三", version: 3 } });
  });
  await page.goto("/requirements/r1");
  await page.getByRole("button", { name: "工作项设置", exact: true }).click();
  const row = page.getByRole("dialog", { name: "工作项设置", exact: true }).locator("tbody tr").first();
  await row.getByRole("button", { name: /主负责人：未分配/ }).click();
  current = { ...current, version: 2, workItems: [{ ...current.workItems[0], title: "后台更新", version: 2 }, current.workItems[1]] };
  const previousReads = reads;
  await page.evaluate(() => { window.dispatchEvent(new Event("offline")); window.dispatchEvent(new Event("online")); });
  await expect.poll(() => reads).toBeGreaterThan(previousReads);
  const popover = page.locator(".inline-select-popover");
  await popover.getByRole("option", { name: /张三/ }).click();
  expect(submissions).toHaveLength(0);
  await expect(popover.getByRole("button", { name: "保存所选", exact: true })).toBeDisabled();
  await popover.getByRole("button", { name: "重新读取工作项", exact: true }).click();
  await expect(popover.getByRole("button", { name: "保存所选", exact: true })).toBeEnabled();
  await popover.getByRole("button", { name: "保存所选", exact: true }).click();
  await expect.poll(() => submissions.length).toBe(1);
  expect(submissions[0]).toMatchObject({ ownerId: "u1", assigneeIds: ["u1"], expectedVersion: 2 });
});

test("并发编辑工作项时，较早请求失败不覆盖另一行保存结果", async ({ page }) => {
  const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
  await mockApplication(page, patches);
  let firstRequested = false;
  let releaseFirst!: () => void;
  const firstResponse = new Promise<void>((resolve) => { releaseFirst = resolve; });
  await page.route("**/api/work-items/w1", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    firstRequested = true;
    await firstResponse;
    await route.fulfill({ status: 409, json: { error: "第一行保存冲突", code: "STALE_WRITE" } });
  });
  try {
    await page.goto("/requirements/r1");
    await page.getByRole("button", { name: /工作项设置|编辑工作项/ }).click();
    await page.getByRole("button", { name: /工作项名称：设计/ }).click();
    await page.getByRole("textbox", { name: "工作项名称", exact: true }).fill("设计草稿");
    await page.getByRole("textbox", { name: "工作项名称", exact: true }).press("Enter");
    await expect.poll(() => firstRequested).toBe(true);
    await page.getByRole("button", { name: /工作项名称：开发/ }).click();
    await page.getByRole("textbox", { name: "工作项名称", exact: true }).fill("开发已保存");
    await page.getByRole("textbox", { name: "工作项名称", exact: true }).press("Enter");
    await expect.poll(() => patches.some((entry) => entry.path === "/api/work-items/w2")).toBe(true);
    await expect(page.getByRole("button", { name: /工作项名称：开发已保存/ })).toBeEnabled();
    releaseFirst();
    await expect(page.getByLabel("第一行保存冲突", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /工作项名称：开发已保存/ })).toBeVisible();
  } finally { releaseFirst(); }
});

for (const firstResult of ['failure', 'success'] as const) {
  test(`迟到的文本保存${firstResult}不抢占其他字段焦点，失败草稿可重试`, async ({ page }) => {
    const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
    await mockApplication(page, patches);
    let firstRequested = false;
    let releaseFirst!: () => void;
    const firstResponse = new Promise<void>((resolve) => { releaseFirst = resolve; });
    await page.route('**/api/work-items/w1', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      firstRequested = true;
      await firstResponse;
      if (firstResult === 'failure') await route.fulfill({ status: 409, json: { error: '设计名称保存冲突', code: 'STALE_WRITE' } });
      else await route.fallback();
    });
    try {
      await page.goto('/requirements/r1');
      await page.getByRole('button', { name: /工作项设置|编辑工作项/ }).click();
      await page.getByRole('button', { name: /工作项名称：设计/ }).click();
      const editor = page.getByRole('textbox', { name: '工作项名称', exact: true });
      await editor.fill('设计修改草稿');
      await editor.press('Enter');
      await expect.poll(() => firstRequested).toBe(true);
      await page.getByRole('button', { name: /工作项名称：开发/ }).click();
      await editor.fill('开发尚未提交');
      releaseFirst();
      if (firstResult === 'failure') await expect(page.getByLabel('设计名称保存冲突', { exact: true })).toBeVisible();
      else await expect(page.getByRole('button', { name: /工作项名称：设计修改草稿/ })).toBeEnabled();
      await expect(editor).toHaveValue('开发尚未提交');
      await expect(editor).toBeFocused();
      expect(patches.some((entry) => entry.path === '/api/work-items/w2')).toBe(false);
      await editor.press('Escape');
      if (firstResult === 'failure') {
        await page.getByRole('button', { name: /工作项名称：设计/ }).click();
        await expect(editor).toHaveValue('设计修改草稿');
        await editor.press('Escape');
        await page.getByRole('button', { name: /工作项名称：设计/ }).click();
        await expect(editor).toHaveValue('设计');
      }
    } finally { releaseFirst(); }
  });
}

test('必填文本为空时切换编辑器，只保留新浮层且不提交空值', async ({ page }) => {
  const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
  await mockApplication(page, patches);
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: /工作项设置|编辑工作项/ }).click();
  await page.getByRole('button', { name: /工作项名称：设计/ }).click();
  await page.getByRole('textbox', { name: '工作项名称', exact: true }).fill('');
  await page.getByRole('button', { name: /计划开始：2026-09-01/ }).first().click();
  await expect(page.locator('.inline-edit-popover')).toHaveCount(1);
  await expect(page.locator('.inline-date-popover')).toBeVisible();
  expect(patches).toHaveLength(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /工作项名称：设计/ }).click();
  const editor = page.getByRole('textbox', { name: '工作项名称', exact: true });
  await expect(editor).toHaveValue('');
  await editor.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('工作项名称不能为空');
  await expect(editor).toBeFocused();
  expect(patches).toHaveLength(0);
});

for (const kind of ['单选', '带原因单选', '日期', '多选'] as const) {
  test(`${kind}提交中关闭仍保持锁定，失败重开保留本次输入`, async ({ page }) => {
    const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
    await mockApplication(page, patches, kind === '带原因单选' || kind === '日期' ? { workItem: { status: 'in_progress', actualStart: '2026-09-01' } } : {});
    let requests = 0;
    let release!: () => void;
    const response = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/api/work-items/w1', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      requests += 1;
      await response;
      await route.fulfill({ status: 409, json: { error: '保存故障模拟', code: 'STALE_WRITE' } });
    });
    try {
      await page.goto('/requirements/r1');
      await page.getByRole('button', { name: /工作项设置|编辑工作项/ }).click();
      const trigger = page.getByRole('button', { name: kind === '多选' ? /^协作人员：/ : kind === '日期' ? /^计划开始：/ : /^主负责人：/ }).first();
      await trigger.click();
      if (kind === '多选') {
        await page.getByRole('checkbox', { name: /李四/ }).check();
        await page.locator('.inline-multi-popover').getByRole('button', { name: '完成', exact: true }).click();
      } else if (kind === '日期') {
        await page.getByRole('gridcell', { name: '2026-09-02' }).click();
        await page.getByPlaceholder('请说明计划开始日期调整原因').fill('保留日期调整说明');
        await page.locator('.inline-date-popover').getByRole('button', { name: '保存', exact: true }).click();
      } else {
        await page.getByRole('option').filter({ hasText: '张三' }).click();
        if (kind === '带原因单选') {
          await page.getByLabel('调整原因', { exact: true }).fill('保留负责人调整说明');
          await page.locator('.inline-select-popover').getByRole('button', { name: '保存', exact: true }).click();
        }
      }
      await expect.poll(() => requests).toBe(1);
      if (kind === '单选') {
        await page.getByRole('listbox', { name: '主负责人' }).press('ArrowDown');
        await page.getByRole('listbox', { name: '主负责人' }).press('Enter');
      }
      if (kind === '多选') await expect.soft(page.getByRole('checkbox', { name: /张三/ })).toBeDisabled();
      else if (kind === '日期') await expect.soft(page.getByRole('gridcell', { name: '2026-09-03' })).toBeDisabled();
      else await expect.soft(page.getByRole('option').filter({ hasText: '李四' })).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(page.locator('.inline-edit-popover')).toHaveCount(0);
      await expect.soft(trigger).toBeDisabled();
      expect(requests).toBe(1);
      await page.getByRole('button', { name: /工作项名称：开发/ }).click();
      const otherEditor = page.getByRole('textbox', { name: '工作项名称', exact: true });
      await otherEditor.fill('其他字段尚未提交');
      release();
      await expect(page.getByLabel('保存故障模拟', { exact: true })).toBeVisible();
      await expect(otherEditor).toHaveValue('其他字段尚未提交');
      await expect(otherEditor).toBeFocused();
      expect(patches.some((entry) => entry.path === '/api/work-items/w2')).toBe(false);
      await otherEditor.press('Escape');
      await expect(trigger).toBeEnabled();
      await trigger.click();
      if (kind === '多选') await expect(page.getByRole('checkbox', { name: /李四/ })).toBeChecked();
      else if (kind === '日期') {
        await expect(page.getByRole('gridcell', { name: '2026-09-02' })).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByPlaceholder('请说明计划开始日期调整原因')).toHaveValue('保留日期调整说明');
      } else {
        await expect(page.getByRole('option').filter({ hasText: '张三' })).toHaveAttribute('aria-selected', 'true');
        if (kind === '带原因单选') await expect(page.getByLabel('调整原因', { exact: true })).toHaveValue('保留负责人调整说明');
      }
    } finally { release(); }
  });
}

test("需求列表较早保存失败不回滚另一行的已保存优先级", async ({ page }) => {
  await mockApplication(page, []);
  const secondRequirement: Requirement = {
    ...structuredClone(requirement),
    id: "r2",
    title: "第二需求",
    plannedStart: "2026-09-04",
    plannedEnd: "2026-09-08",
    workItems: [],
  };
  let serverRequirements = [structuredClone(requirement), secondRequirement];
  let reads = 0;
  let firstStarted = false;
  let releaseFirst!: () => void;
  const firstResponse = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const submissions: Array<{ id: string; body: Record<string, unknown> }> = [];
  await page.route("**/api/requirements?*", (route) => {
    reads++;
    return route.fulfill({ json: serverRequirements });
  });
  await page.route("**/api/requirements/r1", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    submissions.push({ id: "r1", body: route.request().postDataJSON() });
    firstStarted = true;
    await firstResponse;
    return route.fulfill({ status: 500, json: { error: "第一条保存失败" } });
  });
  await page.route("**/api/requirements/r2", (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    const body = route.request().postDataJSON();
    submissions.push({ id: "r2", body });
    const saved = { ...serverRequirements[1], priority: String(body.priority), version: 2 } as Requirement;
    serverRequirements = [serverRequirements[0], saved];
    return route.fulfill({ json: saved });
  });
  try {
    await page.goto("/requirements");
    const firstRow = page.locator(".requirements-table tbody tr").filter({ hasText: "原需求" });
    const secondRow = page.locator(".requirements-table tbody tr").filter({ hasText: "第二需求" });
    await firstRow.getByRole("button", { name: /需求优先级/ }).click();
    await page.getByRole("option", { name: "P1 · 高", exact: true }).click();
    await expect.poll(() => firstStarted).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.locator(".inline-select-popover")).toHaveCount(0);
    const readsBeforeSecondSave = reads;
    await secondRow.getByRole("button", { name: /需求优先级/ }).click();
    await page.getByRole("option", { name: "P0 · 紧急", exact: true }).click();
    await expect.poll(() => submissions).toHaveLength(2);
    await expect(secondRow.getByText("P0 · 紧急", { exact: true })).toBeVisible();
    await expect.poll(() => reads).toBeGreaterThan(readsBeforeSecondSave);
    const readsBeforeFailure = reads;
    releaseFirst();
    await expect.poll(() => reads).toBeGreaterThan(readsBeforeFailure);
    await expect(firstRow.getByText("P2 · 中", { exact: true })).toBeVisible();
    await expect(secondRow.getByText("P0 · 紧急", { exact: true })).toBeVisible();
    expect(submissions).toEqual([
      { id: "r1", body: { priority: "P1", expectedVersion: 1 } },
      { id: "r2", body: { priority: "P0", expectedVersion: 1 } },
    ]);
  } finally { releaseFirst(); }
});

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
  const datePopover = page.locator(".inline-date-popover");
  await expect(datePopover).toBeVisible();
  await datePopover.getByRole("button", { name: "下一个月" }).click();
  await expect.poll(() => patches.some((entry) => entry.path === "/api/work-items/w1" && Object.prototype.hasOwnProperty.call(entry.body, "plannedStart"))).toBe(false);
  await datePopover.getByRole("button", { name: "上一个月" }).click();
  await datePopover.getByRole("gridcell", { name: "2026-09-02" }).click();
  await datePopover.getByRole("button", { name: "保存", exact: true }).click();
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
  await expect(page.locator(".account-permission-popover").getByRole("option", { name: "项目经理" })).toHaveCount(0);
  await page.locator(".account-permission-popover select").selectOption("admin");
  await page.getByRole("button", { name: "保存权限" }).click();
  await expect.poll(() => patches.some((entry) => entry.path === "/api/accounts/a1" && entry.body.role === "admin" && entry.body.managedProjectIds === undefined)).toBe(true);

  await page.goto("/projects");
  await expect(page.locator(".project-table").getByText("测试项目", { exact: true })).toBeVisible();
  await expect(page.locator(".project-table .inline-edit-cell")).toHaveCount(0);

  await page.goto("/people");
  await expect(page.getByRole("heading", { name: "前端工程师" })).toBeVisible();
  await expect(page.locator(".person-card .inline-edit-cell")).toHaveCount(0);
});

test("日期翻月不提交，执行中工作项在统一浮窗填写调整原因", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1080p", "交互流程只需在一个桌面视口执行");
  const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
  const browserDialogs: string[] = [];
  page.on("dialog", async (dialog) => { browserDialogs.push(dialog.message()); await dialog.dismiss(); });
  await mockApplication(page, patches, { workItem: { status: "in_progress", actualStart: "2026-09-01", ownerId: "u1", ownerName: "张三", assigneeIds: ["u1"], assigneeNames: ["张三"] } });

  await page.goto("/requirements/r1");
  await page.getByRole("button", { name: /工作项设置|编辑工作项/ }).click();
  const workBefore = await geometry(page, ".work-inline-table");
  await page.getByRole("button", { name: /主负责人：张三/ }).first().click();
  const ownerPicker = page.locator(".inline-select-popover");
  await ownerPicker.getByRole("option", { name: /李四/ }).click();
  await expect(ownerPicker.getByPlaceholder("需求已开始执行，请说明切换主负责人的原因")).toBeVisible();
  expect(patches.some((entry) => entry.path === "/api/work-items/w1" && entry.body.ownerId === "u2")).toBe(false);
  await ownerPicker.getByPlaceholder("需求已开始执行，请说明切换主负责人的原因").fill("调整开发任务分工");
  await ownerPicker.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => patches.some((entry) => entry.path === "/api/work-items/w1" && entry.body.ownerId === "u2" && entry.body.reason === "调整开发任务分工")).toBe(true);
  await page.getByRole("button", { name: /计划开始：2026-09-01/ }).first().click();
  const popover = page.locator(".inline-date-popover");
  await expect(popover).toBeVisible();
  await popover.getByRole("button", { name: "下一个月" }).click();
  await page.waitForTimeout(150);
  expect(patches.some((entry) => entry.path === "/api/work-items/w1" && Object.prototype.hasOwnProperty.call(entry.body, "plannedStart"))).toBe(false);
  expect(browserDialogs).toEqual([]);
  expectStable(workBefore, await geometry(page, ".work-inline-table"));

  await popover.getByRole("button", { name: "上一个月" }).click();
  await popover.getByRole("gridcell", { name: "2026-09-02" }).click();
  await expect(popover.getByPlaceholder("请说明计划开始日期调整原因")).toBeVisible();
  expect(patches.some((entry) => entry.path === "/api/work-items/w1" && Object.prototype.hasOwnProperty.call(entry.body, "plannedStart"))).toBe(false);
  await popover.getByPlaceholder("请说明计划开始日期调整原因").fill("配合联调窗口调整排期");
  await popover.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => patches.some((entry) => entry.path === "/api/work-items/w1" && entry.body.plannedStart === "2026-09-02" && entry.body.reason === "配合联调窗口调整排期")).toBe(true);
  const savedDateButton = page.getByRole("button", { name: /计划开始：2026-09-02/ }).first();
  await expect(savedDateButton.locator(".inline-edit-success")).toBeVisible();
  expect(await savedDateButton.evaluate((button) => {
    const icon = button.querySelector(".inline-edit-success")?.getBoundingClientRect();
    const bounds = button.getBoundingClientRect();
    return Boolean(icon && icon.left >= bounds.left && icon.right <= bounds.right && icon.top >= bounds.top && icon.bottom <= bounds.bottom);
  })).toBe(true);
  expect(browserDialogs).toEqual([]);
  expectStable(workBefore, await geometry(page, ".work-inline-table"));

  const handles = page.getByRole("button", { name: /拖动.*调整顺序/ });
  const first = await handles.nth(0).boundingBox();
  const second = await handles.nth(1).boundingBox();
  await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2);
  await page.mouse.down();
  await page.mouse.move(second!.x + second!.width / 2, second!.y + second!.height / 2, { steps: 12 });
  await page.mouse.up();
  const reasonDialog = page.getByRole("dialog", { name: "调整工作项顺序" });
  await expect(reasonDialog).toBeVisible();
  expect(patches.some((entry) => entry.path.endsWith("/reorder-work-items"))).toBe(false);
  await reasonDialog.getByLabel("调整原因").fill("先完成开发再补充设计归档");
  await reasonDialog.getByRole("button", { name: "确认调整" }).click();
  await expect.poll(() => patches.some((entry) => entry.path.endsWith("/reorder-work-items") && entry.body.reason === "先完成开发再补充设计归档")).toBe(true);
  expect(browserDialogs).toEqual([]);
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

test("删除工作项成功后关闭确认并保留设置窗口，不产生重复删除", async ({ page }) => {
  await mockApplication(page, []);
  let current = structuredClone(requirement);
  const submissions: Array<Record<string, unknown>> = [];
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: current }));
  await page.route('**/api/work-items/w1', (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    submissions.push(route.request().postDataJSON());
    current = { ...current, version: 2, workItems: current.workItems.filter((item) => item.id !== 'w1') };
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '工作项设置', exact: true }).click();
  await page.getByRole('button', { name: '删除设计', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除工作项', exact: true });
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '工作项设置', exact: true })).toBeVisible();
  await expect(page.locator('.work-inline-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.work-inline-table tbody')).toContainText('开发');
  expect(submissions).toEqual([{ expectedVersion: 1 }]);
});

test("删除工作项已落库但响应异常时核对列表并避免重复删除", async ({ page }) => {
  await mockApplication(page, []);
  let current = structuredClone(requirement);
  let submissions = 0;
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: current }));
  await page.route('**/api/work-items/w1', (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    submissions += 1;
    current = { ...current, version: 2, workItems: current.workItems.filter((item) => item.id !== 'w1') };
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'deleted' });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '工作项设置', exact: true }).click();
  await page.getByRole('button', { name: '删除设计', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除工作项', exact: true });
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('已核对最新状态：工作项已删除', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '工作项设置', exact: true })).toBeVisible();
  await expect(page.locator('.work-inline-table tbody')).not.toContainText('设计');
  expect(submissions).toBe(1);
});

for (const change of ['renamed', 'started', 'noted', 'removed', 'locked'] as const) {
  test(`删除确认期间工作项${change}后不再允许使用旧确认继续删除`, async ({ page }) => {
    await mockApplication(page, []);
    let current = structuredClone(requirement);
    let reads = 0;
    const submissions: Array<Record<string, unknown>> = [];
    await page.route('**/api/requirements/r1', (route) => { reads++; return route.fulfill({ json: current }); });
    await page.route('**/api/work-items/w1', (route) => {
      submissions.push(route.request().postDataJSON());
      return route.fulfill({ status: 409, json: { error: '工作项已变化', code: 'STALE_WRITE' } });
    });
    await page.goto('/requirements/r1');
    await page.getByRole('button', { name: '工作项设置', exact: true }).click();
    await page.getByRole('button', { name: '删除设计', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '删除工作项', exact: true });
    if (change === 'noted') current = { ...current, progressUpdates: [{
      id: 'note1', requirementId: 'r1', workItemId: 'w1', workItemTitle: '设计', percent: 0, workItemPercent: null,
      content: '补充说明', eventType: 'note', supersedesId: null, createdByAccountId: 'admin', createdByName: 'admin',
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    }] };
    else if (change === 'removed') current = { ...current, version: 2, workItems: [secondWorkItem] };
    else if (change === 'locked') current = { ...current, version: 2, status: 'cancelled' };
    else current = { ...current, version: 2, workItems: current.workItems.map((item) => item.id === 'w1' ? {
      ...item, version: 2, ...(change === 'renamed' ? { title: '其他人调整的设计' } : { status: 'in_progress', actualStart: '2026-09-01', progress: 10 }),
    } : item) };
    const previousReads = reads;
    await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
    await expect.poll(() => reads).toBeGreaterThan(previousReads);
    await expect(dialog.getByRole('button', { name: '确认删除', exact: true })).toBeDisabled();
    await expect(dialog).toContainText('设计');
    expect(submissions).toHaveLength(0);
  });
}

test('删除工作项请求未结束时不能关闭确认或重复提交', async ({ page }) => {
  await mockApplication(page, []);
  let release!: () => void;
  let requests = 0;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/work-items/w1', async (route) => {
    requests++;
    await waiting;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '工作项设置', exact: true }).click();
  await page.getByRole('button', { name: '删除设计', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除工作项', exact: true });
  try {
    await dialog.getByRole('button', { name: '确认删除', exact: true }).dblclick();
    await expect.poll(() => requests).toBe(1);
    await expect(dialog.getByRole('button', { name: '处理中…', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
  } finally { release(); }
  await expect(dialog).toHaveCount(0);
  expect(requests).toBe(1);
});

test('删除工作项冲突后重读失败禁止重试，成功读取后使用新版本', async ({ page }, testInfo) => {
  await mockApplication(page, []);
  let current = structuredClone(requirement);
  let failRead = false;
  const submissions: Array<Record<string, unknown>> = [];
  await page.route('**/api/requirements/r1', (route) => failRead
    ? route.fulfill({ status: 503, json: { error: '读取暂不可用' } }) : route.fulfill({ json: current }));
  await page.route('**/api/work-items/w1', (route) => {
    submissions.push(route.request().postDataJSON());
    if (submissions.length === 1) {
      failRead = true;
      current = { ...current, version: 2, workItems: [{ ...workItem, version: 2, title: '新设计' }, secondWorkItem] };
      return route.fulfill({ status: 409, json: { error: '工作项已变化', code: 'STALE_WRITE' } });
    }
    current = { ...current, version: 3, workItems: [secondWorkItem] };
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '工作项设置', exact: true }).click();
  await page.getByRole('button', { name: '删除设计', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除工作项', exact: true });
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(dialog).toContainText('读取暂不可用');
  await expect(dialog.getByRole('button', { name: '确认删除', exact: true })).toBeDisabled();
  expect(submissions).toEqual([{ expectedVersion: 1 }]);
  if (process.env.ROUND24_SCREENSHOTS && testInfo.project.name === 'office-1280') await page.screenshot({ path: 'data/round24-ui/deletion-conflict-1280.png' });
  failRead = false;
  await dialog.getByRole('button', { name: '重新读取工作项', exact: true }).click();
  await expect(dialog).toContainText('新设计');
  await expect(dialog.getByRole('button', { name: '确认删除', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(submissions).toEqual([{ expectedVersion: 1 }, { expectedVersion: 2 }]);
});

for (const status of [403, 404]) {
  test(`删除工作项后${status}拒绝读取，不再显示旧确认窗口`, async ({ page }) => {
    await mockApplication(page, []);
    let denied = false;
    await page.route('**/api/requirements/r1', (route) => denied
      ? route.fulfill({ status, json: { error: '需求不可访问' } }) : route.fulfill({ json: requirement }));
    await page.route('**/api/work-items/w1', (route) => {
      denied = true;
      return route.fulfill({ status, json: { error: '工作项不可访问' } });
    });
    await page.goto('/requirements/r1');
    await page.getByRole('button', { name: '工作项设置', exact: true }).click();
    await page.getByRole('button', { name: '删除设计', exact: true }).click();
    await page.getByRole('dialog', { name: '删除工作项', exact: true }).getByRole('button', { name: '确认删除', exact: true }).click();
    await expect(page.getByText('需求无法打开', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}

test('工作项删除入口对已有说明或阻塞信息禁用', async ({ page }) => {
  await mockApplication(page, []);
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: {
    ...requirement, workItems: [workItem, { ...secondWorkItem, blockedReason: '等待外部确认' }], progressUpdates: [{
      id: 'note1', requirementId: 'r1', workItemId: 'w1', workItemTitle: '设计', percent: 0, workItemPercent: null,
      content: '补充说明', eventType: 'note', supersedesId: null, createdByAccountId: 'admin', createdByName: 'admin',
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    }],
  } }));
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '工作项设置', exact: true }).click();
  await expect(page.getByRole('button', { name: '删除设计', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '删除开发', exact: true })).toBeDisabled();
});

test('新增草稿期间需求更新后不能携带新版本提交旧内容', async ({ page }, testInfo) => {
  await mockApplication(page, []);
  let current = structuredClone(requirement);
  let reads = 0;
  const submissions: Array<Record<string, unknown>> = [];
  await page.route('**/api/requirements/r1', (route) => { reads++; return route.fulfill({ json: current }); });
  await page.route('**/api/requirements/r1/work-items', (route) => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ json: workItem });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '工作项设置', exact: true }).click();
  await page.getByRole('button', { name: '添加工作项', exact: true }).click();
  await page.getByRole('button', { name: /新工作项名称/ }).click();
  await page.getByLabel('新工作项名称', { exact: true }).fill('草稿任务');
  await page.getByLabel('新工作项名称', { exact: true }).press('Enter');
  current = { ...current, version: 2, title: '后台更新的需求' };
  const previousReads = reads;
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await expect.poll(() => reads).toBeGreaterThan(previousReads);
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await expect(page.getByText('需求已更新', { exact: false })).toBeVisible();
  if (process.env.ROUND25_SCREENSHOTS && testInfo.project.name === 'office-1280') await page.screenshot({ path: 'data/round25-ui/create-conflict-1280.png' });
  expect(submissions).toHaveLength(0);
});

test('执行中新增确认期间需求更新后不能提交旧草稿', async ({ page }) => {
  await mockApplication(page, []);
  let current = { ...structuredClone(requirement), workItems: [{ ...workItem, status: 'in_progress', actualStart: '2026-09-01' }, secondWorkItem] };
  let reads = 0;
  const submissions: Array<Record<string, unknown>> = [];
  await page.route('**/api/requirements/r1', (route) => { reads++; return route.fulfill({ json: current }); });
  await page.route('**/api/requirements/r1/work-items', (route) => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ json: workItem });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '工作项设置', exact: true }).click();
  await page.getByRole('button', { name: '添加工作项', exact: true }).click();
  await page.getByRole('button', { name: /新工作项名称/ }).click();
  await page.getByLabel('新工作项名称', { exact: true }).fill('执行中新增草稿');
  await page.getByLabel('新工作项名称', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新增执行中工作项', exact: true });
  await dialog.getByLabel('新增原因').fill('补充遗漏任务');
  current = { ...current, version: 2, title: '后台更新的需求' };
  const previousReads = reads;
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await expect.poll(() => reads).toBeGreaterThan(previousReads);
  await expect(dialog.getByRole('button', { name: '确认新增', exact: true })).toBeDisabled();
  await expect(dialog.getByLabel('新增原因')).toHaveValue('补充遗漏任务');
  expect(submissions).toHaveLength(0);
});

test('新增工作项提交期间锁定草稿和工作项设置窗口', async ({ page }) => {
  await mockApplication(page, []);
  let release!: () => void;
  let requests = 0;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/requirements/r1/work-items', async (route) => {
    requests++;
    await waiting;
    return route.fulfill({ json: { ...workItem, id: 'w3', title: '等待保存' } });
  });
  await page.goto('/requirements/r1');
  const editor = page.getByRole('dialog', { name: '工作项设置', exact: true });
  await page.getByRole('button', { name: '工作项设置', exact: true }).click();
  await page.getByRole('button', { name: '添加工作项', exact: true }).click();
  await page.getByRole('button', { name: /新工作项名称/ }).click();
  await page.getByLabel('新工作项名称', { exact: true }).fill('等待保存');
  await page.getByLabel('新工作项名称', { exact: true }).press('Enter');
  try {
    await page.getByRole('button', { name: '保存', exact: true }).evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await expect.poll(() => requests).toBe(1);
    await expect(page.getByRole('button', { name: '取消', exact: true })).toBeDisabled();
    await expect(editor).toBeVisible();
  } finally { release(); }
  await expect(editor).toBeVisible();
  await expect.poll(() => page.getByRole('button', { name: /新工作项名称/ }).count()).toBe(0);
});

test('执行中新增提交期间锁定原因和双层窗口', async ({ page }) => {
  await mockApplication(page, [], { workItem: { status: 'in_progress', actualStart: '2026-09-01' } });
  let release!: () => void;
  let requests = 0;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/requirements/r1/work-items', async (route) => {
    requests++;
    await waiting;
    return route.fulfill({ json: { ...workItem, id: 'w3', title: '执行中新增' } });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '工作项设置', exact: true }).click();
  await page.getByRole('button', { name: '添加工作项', exact: true }).click();
  await page.getByRole('button', { name: /新工作项名称/ }).click();
  await page.getByLabel('新工作项名称', { exact: true }).fill('执行中新增');
  await page.getByLabel('新工作项名称', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新增执行中工作项', exact: true });
  await dialog.getByLabel('新增原因').fill('执行中补充范围');
  try {
    await dialog.getByRole('button', { name: '确认新增', exact: true }).dblclick();
    await expect.poll(() => requests).toBe(1);
    await expect(dialog.getByLabel('新增原因')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
  } finally { release(); }
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '工作项设置', exact: true })).toBeVisible();
});

test('排序原因填写期间需求更新后不能携带新版本提交旧顺序', async ({ page }) => {
  await mockApplication(page, []);
  let current = { ...structuredClone(requirement), workItems: [{ ...workItem, status: 'in_progress', actualStart: '2026-09-01' }, secondWorkItem] };
  let reads = 0;
  const submissions: Array<Record<string, unknown>> = [];
  await page.route('**/api/requirements/r1', (route) => { reads++; return route.fulfill({ json: current }); });
  await page.route('**/api/requirements/r1/reorder-work-items', (route) => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ json: [] });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '工作项设置', exact: true }).click();
  const handles = page.getByRole('button', { name: /拖动.*调整顺序/ });
  const first = await handles.nth(0).boundingBox();
  const second = await handles.nth(1).boundingBox();
  await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2);
  await page.mouse.down();
  await page.mouse.move(second!.x + second!.width / 2, second!.y + second!.height / 2, { steps: 12 });
  await page.mouse.up();
  const dialog = page.getByRole('dialog', { name: '调整工作项顺序', exact: true });
  await dialog.getByLabel('调整原因').fill('调整旧顺序');
  current = { ...current, version: 2, title: '后台更新的需求' };
  const previousReads = reads;
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await expect.poll(() => reads).toBeGreaterThan(previousReads);
  await expect(dialog.getByRole('button', { name: '确认调整', exact: true })).toBeDisabled();
  await expect(dialog.getByLabel('调整原因')).toHaveValue('调整旧顺序');
  expect(submissions).toHaveLength(0);
});

test('新增草稿显式重读后保留内容并使用新版本提交', async ({ page }) => {
  await mockApplication(page, []);
  let current = structuredClone(requirement);
  const submissions: Array<Record<string, unknown>> = [];
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: current }));
  await page.route('**/api/requirements/r1/work-items', (route) => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ json: { ...workItem, id: 'w3', title: '保留的新增草稿' } });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '工作项设置', exact: true }).click();
  await page.getByRole('button', { name: '添加工作项', exact: true }).click();
  await page.getByRole('button', { name: /新工作项名称/ }).click();
  await page.getByLabel('新工作项名称', { exact: true }).fill('保留的新增草稿');
  await page.getByLabel('新工作项名称', { exact: true }).press('Enter');
  current = { ...current, version: 2, title: '后台更新的需求' };
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await page.getByRole('button', { name: '重新读取需求', exact: true }).evaluate((button) => {
    (button as HTMLButtonElement).click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await expect(page.getByRole('dialog', { name: '工作项设置', exact: true })).toBeVisible();
  await expect(page.getByText('新增草稿保持不变', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /新工作项名称：保留的新增草稿/ })).toBeVisible();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => submissions).toHaveLength(1);
  expect(submissions[0]).toMatchObject({ title: '保留的新增草稿', expectedVersion: 2 });
});

test('新增工作项已落库但响应异常时按完整草稿核对且不重复创建', async ({ page }) => {
  await mockApplication(page, []);
  let current = structuredClone(requirement);
  const submissions: Array<Record<string, unknown>> = [];
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: current }));
  await page.route('**/api/requirements/r1/work-items', (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    submissions.push(body);
    const created = {
      ...workItem,
      id: 'w3',
      title: String(body.title).replace(/\s+/gu, ' ').trim(),
      milestoneLabel: body.milestoneLabel as string | null,
      ownerId: body.ownerId as string | null,
      ownerName: null,
      assigneeIds: body.assigneeIds as string[],
      assigneeNames: [],
      plannedStart: body.plannedStart as string | null,
      plannedEnd: body.plannedEnd as string | null,
    };
    current = { ...current, version: 2, workItems: [...current.workItems, created] };
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'created' });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '工作项设置', exact: true }).click();
  await page.getByRole('button', { name: '添加工作项', exact: true }).click();
  await page.getByRole('button', { name: /新工作项名称/ }).click();
  await page.getByLabel('新工作项名称', { exact: true }).fill('异常  响应后新增');
  await page.getByLabel('新工作项名称', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '保存', exact: true }).click();

  await expect(page.getByText('已核对最新状态：工作项已创建', { exact: true })).toBeVisible();
  await expect(page.locator('.work-inline-table tbody')).toContainText('异常 响应后新增');
  await expect(page.getByRole('button', { name: /新工作项名称/ })).toHaveCount(0);
  expect(submissions).toHaveLength(1);
});

test('排序理由显式重读后保留内容并使用新版本提交', async ({ page }) => {
  await mockApplication(page, []);
  let current = { ...structuredClone(requirement), workItems: [{ ...workItem, status: 'in_progress', actualStart: '2026-09-01' }, secondWorkItem] };
  const submissions: Array<Record<string, unknown>> = [];
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: current }));
  await page.route('**/api/requirements/r1/reorder-work-items', (route) => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ json: [] });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '工作项设置', exact: true }).click();
  const handles = page.getByRole('button', { name: /拖动.*调整顺序/ });
  const first = await handles.nth(0).boundingBox();
  const second = await handles.nth(1).boundingBox();
  await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2);
  await page.mouse.down();
  await page.mouse.move(second!.x + second!.width / 2, second!.y + second!.height / 2, { steps: 12 });
  await page.mouse.up();
  const dialog = page.getByRole('dialog', { name: '调整工作项顺序', exact: true });
  await dialog.getByLabel('调整原因').fill('保留的调整理由');
  current = { ...current, version: 2, title: '后台更新的需求' };
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await dialog.getByRole('button', { name: '重新读取需求', exact: true }).click();
  await expect(dialog.getByLabel('调整原因')).toHaveValue('保留的调整理由');
  await dialog.getByRole('button', { name: '确认调整', exact: true }).click();
  await expect.poll(() => submissions).toHaveLength(1);
  expect(submissions[0]).toEqual({ ids: ['w2', 'w1'], reason: '保留的调整理由', expectedVersion: 2 });
});

test('新增工作项被拒绝访问后清除工作项设置与草稿', async ({ page }) => {
  await mockApplication(page, []);
  let denied = false;
  await page.route('**/api/requirements/r1', (route) => denied
    ? route.fulfill({ status: 403, json: { error: '需求不可访问' } }) : route.fulfill({ json: requirement }));
  await page.route('**/api/requirements/r1/work-items', (route) => {
    denied = true;
    return route.fulfill({ status: 403, json: { error: '不能新增工作项' } });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '工作项设置', exact: true }).click();
  await page.getByRole('button', { name: '添加工作项', exact: true }).click();
  await page.getByRole('button', { name: /新工作项名称/ }).click();
  await page.getByLabel('新工作项名称', { exact: true }).fill('不应继续显示的草稿');
  await page.getByLabel('新工作项名称', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('需求无法打开', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('不应继续显示的草稿')).toHaveCount(0);
});

test('新增工作项冲突后重读失败保留草稿，成功读取后使用新版本', async ({ page }) => {
  await mockApplication(page, []);
  let current = structuredClone(requirement);
  let failRead = false;
  const submissions: Array<Record<string, unknown>> = [];
  await page.route('**/api/requirements/r1', (route) => failRead
    ? route.fulfill({ status: 503, json: { error: '读取暂不可用' } }) : route.fulfill({ json: current }));
  await page.route('**/api/requirements/r1/work-items', (route) => {
    submissions.push(route.request().postDataJSON());
    if (submissions.length === 1) {
      failRead = true;
      current = { ...current, version: 2, title: '后台更新的需求' };
      return route.fulfill({ status: 409, json: { error: '需求已变化', code: 'STALE_WRITE' } });
    }
    return route.fulfill({ json: { ...workItem, id: 'w3', title: '冲突后保留草稿' } });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '工作项设置', exact: true }).click();
  await page.getByRole('button', { name: '添加工作项', exact: true }).click();
  await page.getByRole('button', { name: /新工作项名称/ }).click();
  await page.getByLabel('新工作项名称', { exact: true }).fill('冲突后保留草稿');
  await page.getByLabel('新工作项名称', { exact: true }).press('Enter');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重新读取需求', exact: true }).click();
  await expect(page.getByText('读取暂不可用', { exact: true })).toBeVisible();
  expect(submissions).toEqual([expect.objectContaining({ title: '冲突后保留草稿', expectedVersion: 1 })]);
  failRead = false;
  await page.getByRole('button', { name: '重新读取需求', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => submissions).toHaveLength(2);
  expect(submissions[1]).toMatchObject({ title: '冲突后保留草稿', expectedVersion: 2 });
});

test('排序冲突后重读失败保留原因，成功读取后使用新版本', async ({ page }) => {
  await mockApplication(page, []);
  let current = { ...structuredClone(requirement), workItems: [{ ...workItem, status: 'in_progress', actualStart: '2026-09-01' }, secondWorkItem] };
  let failRead = false;
  const submissions: Array<Record<string, unknown>> = [];
  await page.route('**/api/requirements/r1', (route) => failRead
    ? route.fulfill({ status: 503, json: { error: '读取暂不可用' } }) : route.fulfill({ json: current }));
  await page.route('**/api/requirements/r1/reorder-work-items', (route) => {
    submissions.push(route.request().postDataJSON());
    if (submissions.length === 1) {
      failRead = true;
      current = { ...current, version: 2, title: '后台更新的需求' };
      return route.fulfill({ status: 409, json: { error: '需求已变化', code: 'STALE_WRITE' } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '工作项设置', exact: true }).click();
  const handles = page.getByRole('button', { name: /拖动.*调整顺序/ });
  const first = await handles.nth(0).boundingBox();
  const second = await handles.nth(1).boundingBox();
  await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2);
  await page.mouse.down();
  await page.mouse.move(second!.x + second!.width / 2, second!.y + second!.height / 2, { steps: 12 });
  await page.mouse.up();
  const dialog = page.getByRole('dialog', { name: '调整工作项顺序', exact: true });
  await dialog.getByLabel('调整原因').fill('冲突后保留理由');
  await dialog.getByRole('button', { name: '确认调整', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '确认调整', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '重新读取需求', exact: true }).click();
  await expect(dialog).toContainText('读取暂不可用');
  await expect(dialog.getByLabel('调整原因')).toHaveValue('冲突后保留理由');
  expect(submissions).toEqual([{ ids: ['w2', 'w1'], reason: '冲突后保留理由', expectedVersion: 1 }]);
  failRead = false;
  await dialog.getByRole('button', { name: '重新读取需求', exact: true }).click();
  await dialog.getByRole('button', { name: '确认调整', exact: true }).click();
  await expect.poll(() => submissions).toHaveLength(2);
  expect(submissions[1]).toEqual({ ids: ['w2', 'w1'], reason: '冲突后保留理由', expectedVersion: 2 });
});

test('未执行需求直接排序冲突后必须重读再拖动', async ({ page }) => {
  await mockApplication(page, []);
  let current = structuredClone(requirement);
  const submissions: Array<Record<string, unknown>> = [];
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: current }));
  await page.route('**/api/requirements/r1/reorder-work-items', (route) => {
    submissions.push(route.request().postDataJSON());
    if (submissions.length === 1) {
      current = { ...current, title: '后台调整后的需求', version: 2 };
      return route.fulfill({ status: 409, json: { error: '需求已变化', code: 'STALE_WRITE' } });
    }
    return route.fulfill({ json: current });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '工作项设置', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '工作项设置', exact: true });
  const drag = async () => {
    const handles = editor.getByRole('button', { name: /拖动.*调整顺序/ });
    const first = await handles.nth(0).boundingBox();
    const second = await handles.nth(1).boundingBox();
    await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2);
    await page.mouse.down();
    await page.mouse.move(second!.x + second!.width / 2, second!.y + second!.height / 2, { steps: 12 });
    await page.mouse.up();
  };

  await drag();
  await expect.poll(() => submissions).toHaveLength(1);
  expect(submissions[0]).toEqual({ ids: ['w2', 'w1'], expectedVersion: 1 });
  await expect(editor.locator('.warning-banner')).toContainText('工作项顺序未保存，请重新读取需求后再拖动排序。');
  for (const handle of await editor.getByRole('button', { name: /拖动.*调整顺序/ }).all()) await expect(handle).toBeDisabled();
  await editor.getByRole('button', { name: '重新读取需求', exact: true }).click();
  await expect(page.getByRole('heading', { name: '后台调整后的需求', exact: true })).toBeVisible();
  await expect(editor.locator('.warning-banner')).toHaveCount(0);
  await drag();
  await expect.poll(() => submissions).toHaveLength(2);
  expect(submissions[1]).toEqual({ ids: ['w2', 'w1'], expectedVersion: 2 });
});

test('工作项顺序已落库但响应异常时核对完整顺序且不重复提交', async ({ page }) => {
  await mockApplication(page, []);
  let current = structuredClone(requirement);
  const submissions: Array<Record<string, unknown>> = [];
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: current }));
  await page.route('**/api/requirements/r1/reorder-work-items', (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    submissions.push(body);
    const ids = body.ids as string[];
    current = {
      ...current,
      version: 2,
      workItems: ids.map((id, index) => ({ ...current.workItems.find((item) => item.id === id)!, sortOrder: index, version: 2 })),
    };
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '工作项设置', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '工作项设置', exact: true });
  const handles = editor.getByRole('button', { name: /拖动.*调整顺序/ });
  const first = await handles.nth(0).boundingBox();
  const second = await handles.nth(1).boundingBox();
  await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2);
  await page.mouse.down();
  await page.mouse.move(second!.x + second!.width / 2, second!.y + second!.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect(page.getByText('已核对最新状态：工作项顺序已保存', { exact: true })).toBeVisible();
  await expect(editor.locator('.work-inline-table tbody tr').first()).toContainText('开发');
  await expect(editor.locator('.warning-banner')).toHaveCount(0);
  expect(submissions).toHaveLength(1);
  expect(submissions[0].ids).toEqual(['w2', 'w1']);
});

test('排序被拒绝访问后清除理由和双层窗口', async ({ page }) => {
  await mockApplication(page, []);
  let denied = false;
  const executing = { ...requirement, workItems: [{ ...workItem, status: 'in_progress', actualStart: '2026-09-01' }, secondWorkItem] };
  await page.route('**/api/requirements/r1', (route) => denied
    ? route.fulfill({ status: 403, json: { error: '需求不可访问' } }) : route.fulfill({ json: executing }));
  await page.route('**/api/requirements/r1/reorder-work-items', (route) => {
    denied = true;
    return route.fulfill({ status: 403, json: { error: '不能调整顺序' } });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '工作项设置', exact: true }).click();
  const handles = page.getByRole('button', { name: /拖动.*调整顺序/ });
  const first = await handles.nth(0).boundingBox();
  const second = await handles.nth(1).boundingBox();
  await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2);
  await page.mouse.down();
  await page.mouse.move(second!.x + second!.width / 2, second!.y + second!.height / 2, { steps: 12 });
  await page.mouse.up();
  const dialog = page.getByRole('dialog', { name: '调整工作项顺序', exact: true });
  await dialog.getByLabel('调整原因').fill('不应继续显示的理由');
  await dialog.getByRole('button', { name: '确认调整', exact: true }).click();
  await expect(page.getByText('需求无法打开', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('不应继续显示的理由')).toHaveCount(0);
});

test('拖动期间工作项列表变化时取消当前排序且不提交', async ({ page }) => {
  await mockApplication(page, []);
  let current = { ...structuredClone(requirement), workItems: [{ ...workItem, status: 'in_progress', actualStart: '2026-09-01' }, secondWorkItem] };
  const submissions: Array<Record<string, unknown>> = [];
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: current }));
  await page.route('**/api/requirements/r1/reorder-work-items', (route) => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ json: [] });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '工作项设置', exact: true }).click();
  const handles = page.getByRole('button', { name: /拖动.*调整顺序/ });
  const first = await handles.nth(0).boundingBox();
  const second = await handles.nth(1).boundingBox();
  await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2);
  await page.mouse.down();
  await page.mouse.move(second!.x + second!.width / 2, second!.y + second!.height / 2, { steps: 4 });
  current = { ...current, version: 2, workItems: [...current.workItems, { ...secondWorkItem, id: 'w3', title: '后台新增项', sortOrder: 2 }] };
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await expect(page.getByRole('button', { name: '拖动后台新增项调整顺序' })).toBeVisible();
  await page.mouse.up();
  await expect(page.getByRole('dialog', { name: '调整工作项顺序', exact: true })).toHaveCount(0);
  expect(submissions).toHaveLength(0);
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

test("当前需求筛选同时排除已完成和已取消需求", async ({ page }) => {
  await mockApplication(page, []);
  const requirements = [
    { ...structuredClone(requirement), id: "r-active", title: "当前执行需求", status: "in_progress" as const },
    { ...structuredClone(requirement), id: "r-completed", title: "已经完成需求", status: "completed" as const },
    { ...structuredClone(requirement), id: "r-cancelled", title: "已经取消需求", status: "cancelled" as const },
  ];
  await page.route("**/api/requirements?*", (route) => route.fulfill({ json: requirements }));

  await page.goto("/requirements");
  const rows = page.locator(".requirements-table tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("当前执行需求");

  await page.locator(".filter-bar select").selectOption("");
  await expect(rows).toHaveCount(3);
  await page.locator(".filter-bar select").selectOption("cancelled");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("已经取消需求");
});

test("问题字段、表格基线和详情工作区保持稳定", async ({ page }, testInfo) => {
  test.skip(!["laptop-1366", "desktop-1080p"].includes(testInfo.project.name), "覆盖常用桌面视口");
  const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
  await mockApplication(page, patches, { issue: {
    dueDate: "2026-08-25",
    overdue: true,
    updates: [{
      id: "iu1", issueId: "i1", progress: 50, content: "历史进展内容应当可以完整滚动查看", eventType: "progress",
      createdByAccountId: "admin", createdByName: "管理员", createdAt: "2026-09-02T08:00:00.000Z", updatedAt: "2026-09-02T08:00:00.000Z",
    }],
  } });
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
  const updatesPanel = dialog.locator(".issue-settings-updates");
  await expect(updatesPanel).toHaveCSS("overflow-y", "auto");
  await expect(dialog.locator(".issue-update-settings")).toHaveCSS("min-height", "220px");
  const historyRow = dialog.locator(".issue-update-setting-row").first();
  await historyRow.scrollIntoViewIfNeeded();
  const visibleHistory = await historyRow.evaluate((row) => {
    const panel = row.closest<HTMLElement>(".issue-settings-updates")!.getBoundingClientRect();
    const record = row.getBoundingClientRect();
    return record.top >= panel.top - 1 && record.bottom <= panel.bottom + 1;
  });
  expect(visibleHistory).toBe(true);

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

test("问题范围在收起、展开和保存后使用一致名称", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1080p", "交互语义只需在一个桌面视口执行");
  const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
  await mockApplication(page, patches, { issue: { requirementId: null, requirementTitle: null, sourceRef: "DCIM-36" } });
  await page.goto("/issues");

  await expect(page.locator(".issue-data-scope .issue-scope")).toHaveText("DCIM-36");
  await page.locator(".issue-data-scope .inline-edit-trigger").click();
  const picker = page.locator(".inline-select-popover");
  await expect(picker.getByRole("option", { name: "公共问题", exact: true })).toBeVisible();
  await expect(picker.getByRole("option", { name: "DCIM-36", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(picker.getByText("公共问题 · DCIM-36", { exact: true })).toHaveCount(0);

  await picker.getByRole("option", { name: "公共问题", exact: true }).click();
  await expect.poll(() => patches.some((entry) => entry.path === "/api/issues/i1" && entry.body.requirementId === null && entry.body.sourceRef === null)).toBe(true);
  await expect(page.locator(".issue-data-scope .issue-scope")).toHaveText("公共问题");
});

test.describe("北京时间业务日期", () => {
  test.use({ timezoneId: "America/Los_Angeles" });

  test("内联日期选择器跨北京时间午夜更新今天", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1080p", "日期语义只需在一个桌面视口执行");
    await page.clock.install({ time: new Date("2026-09-05T15:59:30.000Z") });
    const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
    await mockApplication(page, patches);

    await page.goto("/requirements/r1");
    await page.getByRole("button", { name: /工作项设置|编辑工作项/ }).click();
    await page.getByRole("button", { name: /计划开始：2026-09-01/ }).first().click();
    const popover = page.locator(".inline-date-popover");
    await expect(popover.getByRole("gridcell", { name: "2026-09-05" })).toHaveClass(/is-today/);

    await page.clock.fastForward(90_000);
    await expect(popover.getByRole("gridcell", { name: "2026-09-06" })).toHaveClass(/is-today/);
    await expect(popover.getByRole("gridcell", { name: "2026-09-05" })).not.toHaveClass(/is-today/);

    await popover.getByRole("button", { name: "今天", exact: true }).click();
    await popover.getByRole("button", { name: "保存", exact: true }).click();
    await expect.poll(() => patches.some((entry) => entry.path === "/api/work-items/w1" && entry.body.plannedStart === "2026-09-06")).toBe(true);
  });

  test("历史补录在跨北京时间午夜后即时解锁", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-1080p", "日期语义只需在一个桌面视口执行");
    await page.clock.install({ time: new Date("2026-09-05T15:59:30.000Z") });
    await mockApplication(page, [], { workItem: { plannedStart: "2026-09-05", plannedEnd: "2026-09-06" } });

    await page.goto("/requirements/r1");
    await page.getByRole("button", { name: "更多工作项操作" }).first().click();
    await page.getByRole("button", { name: "按期完成（历史补录）", exact: true }).first().click();
    const action = page.locator(".inline-action-form").filter({ hasText: "实际开始：2026-09-05" });
    await expect(action.getByRole("alert")).toHaveText("计划尚未结束，暂不能补录完成。");
    await expect(action.getByRole("button", { name: "确认补录完成", exact: true })).toBeDisabled();

    await page.clock.fastForward(90_000);
    await expect(action.getByRole("alert")).toHaveCount(0);
    await expect(action.getByRole("button", { name: "确认补录完成", exact: true })).toBeEnabled();
  });
});
