import {workspaceFixture} from './workspace-fixture';
import type {Page,Route} from '@playwright/test';
import type {Account,Issue,Person,Project,Requirement,WorkItem} from '../../src/client/types';
export const project: Project = {
  id: "p1", name: "测试项目", status: "active", plannedStart: "2026-09-01", plannedEnd: "2026-09-30",
  defaultTemplateId: "t1", isSample: false, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
};
export const people: Person[] = [
  { id: "u1", name: "张三", jobTitle: "前端工程师", active: 1, createdAt: "2026-09-01", updatedAt: "2026-09-01" },
  { id: "u2", name: "李四", jobTitle: "测试工程师", active: 1, createdAt: "2026-09-01", updatedAt: "2026-09-01" },
];
export const workItem: WorkItem = {
  id: "w1", requirementId: "r1", templateItemId: "ti1", title: "设计", ownerId: null, ownerName: null,
  collaborators: [], assigneeIds: [], assigneeNames: [], status: "not_started", plannedStart: "2026-09-01",
  plannedEnd: "2026-09-03", actualStart: null, actualEnd: null, forecastEnd: null, blockedAt: null,
  blockedReason: null, milestoneLabel: "需求基线", progress: 0, sortOrder: 0, version: 1, createdAt: "2026-09-01", updatedAt: "2026-09-01",
};
export const secondWorkItem: WorkItem = {
  ...workItem,
  id: "w2",
  templateItemId: "ti2",
  title: "开发",
  plannedStart: "2026-09-04",
  plannedEnd: "2026-09-08",
  milestoneLabel: null,
  sortOrder: 1,
};
export const requirement: Requirement = {
  id: "r1", projectId: "p1", projectName: "测试项目", templateId: "t1", templateName: "研发流程",
  title: "原需求", ownerId: null, ownerName: null, status: "not_started", plannedStart: "2026-09-01",
  plannedEnd: "2026-09-03", progress: 0, plannedProgress: 0, progressGap: 0, acceptedAt: null, acceptedByAccountId: null, version: 1, riskLevel: "low",
  riskEvaluated: true, riskReason: "", priority: "P2", createdAt: "2026-09-01", updatedAt: "2026-09-01",
  workItems: [workItem, secondWorkItem], progressUpdates: [], recentProgressUpdates: [], delayed: false, highRisk: false,
  finishVariance: 0, durationVariance: 0, effectiveEnd: "2026-09-03", issueSummary: { active: 0, overdue: 0 },
};
export const issue: Issue = {
  id: "i1", projectId: "p1", projectName: "测试项目", requirementId: "r1", requirementTitle: "原需求",
  sourceRef: null, title: "联调问题", impact: "影响发布", reporter: "测试", ownerId: "u1", ownerName: "张三",
  status: "in_progress", priority: "P2", progress: 50, discoveredAt: "2026-09-01", dueDate: "2026-09-05",
  resolvedAt: null, version: 1, createdAt: "2026-09-01", updatedAt: "2026-09-01", latestUpdate: null,
  latestUpdateAt: null, overdue: false, updates: [],
};
export const account: Account = {
  id: "a1", username: "zhangsan", personId: "u1", personName: "张三", jobTitle: "前端工程师",
  globalRole: "user", role: "user", status: "active", mustChangePassword: false, isBuiltin: false,
  lastLoginAt: null, createdAt: "2026-09-01", updatedAt: "2026-09-01", managedProjects: [],
  activeAssignments: { requirements: 0, workItems: 0, issues: 0 },
};

export async function mockApplication(page: Page, patches: Array<{ path: string; body: Record<string, unknown> }>, options: { issue?: Partial<Issue>; account?: Partial<Account>; requirement?: Partial<Requirement>; workItem?: Partial<WorkItem> } = {}) {
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
    if (url.pathname.endsWith('/path-graph')) return json({analysis:workspaceFixture('p1',currentProject.name,[currentRequirement]).analysis});
    if (url.pathname.endsWith('/feature-overview')) return json(workspaceFixture('p1',currentProject.name,[currentRequirement]).overview);
    if (url.pathname.endsWith('/features')) return json(workspaceFixture('p1',currentProject.name,[currentRequirement]).features);
    if (url.pathname === '/api/dashboard') return json({asOfDate:'2026-09-03',summary:{total:1,active:1,completed:0,delayed:0,highRisk:0,completionRate:0},requirements:[currentRequirement],featureOverview:workspaceFixture('p1',currentProject.name,[currentRequirement]).overview,charts:{statuses:[],risks:[],weeks:[],varianceTop:[]}});
    return json({});
  });
}
