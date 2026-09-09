import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * 全站 query key 注册表与跨视图失效声明。
 * useQuery 的 key 以 keys.X 为前缀（参数段跟在后方）；失效一律走本文件的 helper，
 * 新增视图时只需在对应 helper 里登记一次。
 */
export const keys = {
  commitments:["delivery-commitments"] as const,
  paths: ["path-analysis"] as const,
  session: ["session"] as const,
  branding: ["branding"] as const,
  projects: ["projects"] as const,
  dashboard: ["dashboard"] as const,
  requirements: ["requirements"] as const,
  requirementDetails: ["requirement"] as const,
  requirement: (id: string) => ["requirement", id] as const,
  issues: ["issues"] as const,
  issueDetails: ["issue"] as const,
  issue: (id: string) => ["issue", id] as const,
  myWork: ["my-work"] as const,
  actionItems: ["action-items"] as const,
  people: ["people"] as const,
  peopleConcurrency: ["people-concurrency"] as const,
  peopleCandidates: ["people-candidates"] as const,
  projectMembers: ["project-members"] as const,
  projectArchives: ["project-archives"] as const,
  analyticsCatalog: ["analytics-catalog"] as const,
  analyticsLayout: ["analytics-layout"] as const,
  analyticsData: ["analytics-data"] as const,
  analyticsPreview: ["analytics-preview"] as const,
  auditSearch: ["audit-search"] as const,
  archives: ["archives"] as const,
  accounts: ["accounts"] as const,
  templates: ["templates"] as const,
  myTokens: ["my-tokens"] as const,
  systemOverview: ["system-overview"] as const,
  backups: ["backups"] as const,
};

export function invalidate(client: QueryClient, queryKey: QueryKey) {
  void client.invalidateQueries({ queryKey });
}

export function invalidateMany(client: QueryClient, queryKeys: QueryKey[]) {
  queryKeys.forEach((queryKey) => invalidate(client, queryKey));
}

export function invalidateAuditViews(client: QueryClient) {
  invalidate(client, keys.auditSearch);
}

/** 北京时间跨日后，刷新所有依赖“今天”推导状态、风险、逾期或区间的数据。 */
export function invalidateBusinessDateViews(client: QueryClient) {
  invalidateMany(client, [
    keys.paths,keys.commitments,
    keys.dashboard, keys.requirements, keys.requirementDetails,
    keys.issues, keys.issueDetails, keys.myWork, keys.actionItems,
    keys.peopleConcurrency, keys.analyticsData, keys.analyticsPreview,
  ]);
}

/** 需求域：需求变更还会影响账号页的在办需求和工作项计数。 */
const requirementViewKeys: QueryKey[] = [
  [...keys.paths], [...keys.commitments],
  [...keys.requirementDetails],
  [...keys.requirements],
  // 问题响应包含关联需求名称；需求改名后必须同步刷新问题列表与已打开详情。
  [...keys.issues],
  [...keys.issueDetails],
  [...keys.dashboard],
  [...keys.myWork],
  [...keys.actionItems],
  [...keys.peopleConcurrency],
  [...keys.analyticsData],
  [...keys.analyticsPreview],
  [...keys.accounts],
  [...keys.auditSearch],
];

export function invalidateRequirementViews(client: QueryClient, requirementId?: string) {
  if (requirementId) invalidate(client, [...keys.requirement(requirementId)]);
  invalidateMany(client, requirementViewKeys);
}

/** 问题域：分派、期限与状态同时影响行动项、个人工作、账号在办计数和分析。 */
export function invalidateIssueViews(client: QueryClient, issueId?: string) {
  if (issueId) invalidate(client, [...keys.issue(issueId)]);
  invalidateMany(client, [
    keys.paths, keys.requirements, keys.issues, keys.requirementDetails, keys.dashboard, keys.myWork, keys.actionItems,
    keys.analyticsData, keys.analyticsPreview, keys.accounts, keys.auditSearch,
  ]);
}

/** 项目改名及归档会影响子项名称、可见范围、人员归属和派生指标。 */
export function invalidateProjectViews(client: QueryClient) {
  invalidateMany(client, [
    keys.projects, keys.archives, keys.projectArchives, keys.session,
    keys.requirementDetails, keys.issueDetails, keys.issues,
    keys.people, keys.peopleCandidates, keys.projectMembers, keys.accounts, keys.templates,
    ...requirementViewKeys,
  ]);
}

/** 添加经理、成员或移出成员都会改变账号归属、操作权限和业务可见范围。 */
export function invalidateProjectMemberViews(client: QueryClient) {
  invalidateAccountPermissionViews(client);
}

/** 项目权限变更：额外影响会话与项目授权信息。 */
export function invalidateProjectAccessViews(client: QueryClient) {
  invalidateProjectMemberViews(client);
}

/** 人员姓名、岗位和登录名同时出现在分派、业务详情、分析与审计中。 */
export function invalidateAccountViews(client: QueryClient) {
  invalidateMany(client, [
    keys.accounts, keys.people, keys.peopleCandidates, keys.projectMembers,
    keys.requirementDetails, keys.issueDetails, keys.issues, keys.auditSearch, keys.myTokens,
    ...requirementViewKeys,
  ]);
}

/** 流程名称用于需求详情和分析分组；归档变化还要刷新两个归档入口。 */
export function invalidateTemplateViews(client: QueryClient, archiveChanged = false) {
  invalidateMany(client, [
    keys.templates, keys.requirements, keys.requirementDetails,
    keys.analyticsData, keys.analyticsPreview, keys.auditSearch,
    ...(archiveChanged ? [keys.archives, keys.projectArchives] : []),
  ]);
}

export function invalidateTokenViews(client: QueryClient) {
  invalidateMany(client, [keys.myTokens, keys.auditSearch]);
}

/** 账号权限变更：额外影响项目成员、项目授权与当前会话。 */
export function invalidateAccountPermissionViews(client: QueryClient) {
  invalidateAccountViews(client);
  invalidateMany(client, [keys.projects, keys.session, keys.templates, keys.archives, keys.projectArchives]);
}

/** 归档恢复/彻底删除：影响全部实体列表与审计。 */
export function invalidateArchiveViews(client: QueryClient) {
  invalidateProjectViews(client);
  invalidate(client, keys.auditSearch);
}

/** 系统管理：备份与概览。 */
export function invalidateSystemViews(client: QueryClient) {
  invalidateMany(client, [[...keys.backups], [...keys.systemOverview], [...keys.auditSearch]]);
}
