import type { Page, Route } from "@playwright/test";
import { workspaceFixture } from './workspace-fixture';
import type {PathMilestone} from '../../src/shared/paths';

export const workItem = {
  id: "w1", requirementId: "r1", templateItemId: "ti1", title: "接口开发", ownerId: "u1", ownerName: "张三",
  collaborators: [], assigneeIds: ["u1"], assigneeNames: ["张三"], status: "in_progress",
  plannedStart: "2026-09-01", plannedEnd: "2026-09-10", actualStart: "2026-09-01", actualEnd: null,
  forecastEnd: null, blockedAt: null, blockedReason: null, milestoneLabel: "接口基线", progress: 40, sortOrder: 0, workStage: 'development' as const, durationDays: 1,
  version: 1, createdAt: "2026-09-01", updatedAt: "2026-09-02",
};

const completedLateWorkItem = {
  ...workItem,
  id: "w-late",
  title: "延期完成项",
  status: "completed",
  plannedEnd: "2026-09-10",
  actualEnd: "2026-09-14",
  milestoneLabel: null,
  progress: 100,
};

const completedEarlyWorkItem = {
  ...workItem,
  id: "w-early",
  title: "提前完成项",
  status: "completed",
  plannedEnd: "2026-09-10",
  actualEnd: "2026-09-08",
  milestoneLabel: null,
  progress: 100,
};

export const requirement = {
  id: "r1", projectId: "p1", projectName: "测试项目", templateId: "t1", templateName: "研发流程",
  title: "统一甘特样式", ownerId: null, ownerName: null, status: "in_progress", plannedStart: "2026-09-01", actualStart: '2026-09-01', observationEnd: '2026-09-03',
  plannedEnd: "2026-09-10", progress: 61, plannedProgress: 91, progressGap: 30, riskLevel: "medium",
  asOfDate: "2026-09-03", scheduleComplete: true,
  riskEvaluated: true, riskReason: "P1进度Gap 30%", priority: "P1", createdAt: "2026-09-01", updatedAt: "2026-09-02",
  workItems: [workItem, completedLateWorkItem, completedEarlyWorkItem], progressUpdates: [], recentProgressUpdates: [{
    id: "u1", requirementId: "r1", workItemId: "w1", workItemTitle: "接口开发", percent: 61, workItemPercent: 40,
    content: "完成接口权限校验与异常分支联调，补充回归场景并记录后续优化建议，等待产品侧确认边界。",
    createdAt: "2026-09-02T10:00:00.000Z", updatedAt: "2026-09-02T10:00:00.000Z",
  }], delayed: false, highRisk: false,
  finishVariance: 0, durationVariance: 0, effectiveEnd: "2026-09-10", issueSummary: { active: 0, overdue: 0 },
};

export const ganttRequirements = [requirement, { ...requirement, id: 'r2', title: '领先计划流程', progress: 70, plannedProgress: 50, progressGap: 0, riskLevel: 'low', riskReason: '进展正常', workItems: [
  { ...workItem, id: 'w2', requirementId: 'r2', plannedEnd: '2026-09-09', milestoneLabel: '方案评审' },
  { ...workItem, id: 'w3', requirementId: 'r2', plannedEnd: '2026-09-10', milestoneLabel: '验收通过' },
  { ...workItem, id: 'w4', requirementId: 'r2', plannedEnd: '2026-09-10', milestoneLabel: '正式上线' },
] }];

/** All workspace reads share the same facts, including after a test changes a row. */
export async function mockGanttReport(page: Page, rows: () => Parameters<typeof workspaceFixture>[2], asOfDate = () => '2026-09-03', milestones: () => PathMilestone[] = () => []) {
  await page.route(/\/api\/(dashboard|projects\/p1\/(path-graph|path-analysis|features|feature-overview))(\?|$)/, route => {
    const requirements = rows(), workspace = workspaceFixture('p1', '测试项目', requirements, asOfDate());
    workspace.analysis.milestones = milestones();
    const pathname = new URL(route.request().url()).pathname;
    const json = pathname.endsWith('/path-graph') ? {analysis:workspace.analysis}
      : pathname.endsWith('/path-analysis') ? workspace.analysis
      : pathname.endsWith('/features') ? {features:workspace.features}
      : pathname.endsWith('/feature-overview') ? workspace.overview
      : {asOfDate:asOfDate(), featureOverview:workspace.overview,
        summary:{total:requirements.length,active:requirements.filter(r=>r.status!=='completed').length,completed:requirements.filter(r=>r.status==='completed').length,delayed:0,highRisk:0,completionRate:0},
        requirements,issues:{summary:{total:0,inProgress:0,deferred:0,resolved:0,active:0,highPriority:0,overdue:0,unassigned:0,closureRate:0},attention:[]},
        charts:{statuses:[],risks:[],weeks:[],varianceTop:[]}};
    return route.fulfill({json});
  });
}

export async function mockGanttData(page: Page, progressRequests: Array<Record<string, unknown>> = []) {
  const workspace = workspaceFixture('p1', '测试项目', ganttRequirements);
  await page.route("**/api/**", async (route: Route) => {
    const pathname = new URL(route.request().url()).pathname;
    const json = (value: unknown) => route.fulfill({ contentType: "application/json", body: JSON.stringify(value) });
    if (pathname === "/api/session") return json({ authenticated: true, accountId: "admin", username: "admin", role: "admin", globalRole: "admin", personId: null, mustChangePassword: false, managedProjectIds: [] });
    if (pathname === "/api/projects") return json([{ id: "p1", name: "测试项目", status: "active", plannedStart: "2026-09-01", plannedEnd: "2026-09-30", defaultTemplateId: "t1", createdAt: "2026-09-01", updatedAt: "2026-09-01" }]);
    if (pathname.endsWith('/path-graph')) return json({analysis:workspace.analysis});
    if (pathname.endsWith('/path-analysis')) return json(workspace.analysis);
    if (pathname.endsWith('/features')) return json({features:workspace.features});
    if (pathname.endsWith('/feature-phases')) return json([]);
    if (pathname.endsWith('/feature-overview')) return json(workspace.overview);
    if (pathname === "/api/dashboard") return json({
      summary: { total: 2, active: 2, completed: 0, delayed: 0, highRisk: 0, completionRate: 0 },
      requirements: ganttRequirements, featureOverview: workspace.overview, asOfDate: '2026-09-03',
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
    if (pathname === '/api/my-work') return json({asOfDate:'2026-09-03',summary:{total:1,notStarted:0,inProgress:1,blocked:0,completed:0,overdue:0},requirements:[],items:[{...workItem,projectId:'p1',projectName:'测试项目',requirementTitle:requirement.title,requirementStatus:requirement.status,assignmentType:'owner',overdue:false}],completionTrend:[],upcoming:[],recentProgress:[]});
    return json({});
  });
}

