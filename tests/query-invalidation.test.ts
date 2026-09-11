import { QueryClient, type QueryKey } from '@tanstack/react-query';
import { expect, it } from 'vitest';
import { invalidateAccountPermissionViews, invalidateAccountViews, invalidateArchiveViews, invalidateIssueViews, invalidateProjectAccessViews, invalidateProjectMemberViews, invalidateProjectViews, invalidateRequirementViews, keys } from '../src/client/query-keys';

it('问题变更同时刷新问题、行动中心、我的工作、账号在办计数、分析和审计，保留无关缓存', () => {
  const client = new QueryClient();
  const dependent = [
    [...keys.issues, 'project-a', 'active'], keys.issue('issue-a'), keys.requirement('requirement-a'),
    [...keys.dashboard, 'project-a'], [...keys.actionItems, 'project-a', 'high'],
    keys.myWork, [...keys.analyticsData, 'project-a'], [...keys.analyticsPreview, 'project-a'],
    [...keys.accounts, 'all'], [...keys.auditSearch, 'project-a'],
  ];
  try {
    dependent.forEach((key) => client.setQueryData(key, { previous: true }));
    client.setQueryData(keys.people, { unchanged: true });
    invalidateIssueViews(client, 'issue-a');
    for (const key of dependent) expect(client.getQueryState(key)?.isInvalidated, key.join('/')).toBe(true);
    expect(client.getQueryState(keys.people)?.isInvalidated).toBe(false);
  } finally { client.clear(); }
});

it('需求和工作项变更同时刷新问题关联名称与账号页在办计数', () => {
  const client = new QueryClient();
  const dependent = [
    keys.groupOverview, keys.requirements, keys.requirement('requirement-a'), keys.issues, keys.issue('issue-a'), keys.accounts,
  ];
  try {
    dependent.forEach((key) => client.setQueryData(key, { previous: true }));
    client.setQueryData(keys.branding, { unchanged: true });
    invalidateRequirementViews(client, 'requirement-a');
    for (const key of dependent) expect(client.getQueryState(key)?.isInvalidated, key.join('/')).toBe(true);
    expect(client.getQueryState(keys.branding)?.isInvalidated).toBe(false);
  } finally { client.clear(); }
});

for (const [name, invalidateViews] of [['项目变更', invalidateProjectViews], ['归档恢复/删除', invalidateArchiveViews]] as const) {
  it(`${name}刷新全部受影响的派生列表与详情，不触碰品牌和个人布局`, () => {
    const client = new QueryClient();
    const dependent: QueryKey[] = [
      keys.projects, keys.groupOverview, keys.requirements, keys.requirement('r1'), keys.issues, keys.issue('i1'),
      keys.dashboard, keys.myWork, keys.actionItems, keys.peopleConcurrency,
      keys.analyticsData, keys.analyticsPreview, keys.auditSearch,
      keys.archives, keys.projectArchives, keys.people, keys.accounts,
      keys.peopleCandidates, keys.projectMembers, keys.templates,
    ];
    try {
      dependent.forEach((key) => client.setQueryData(key, { previous: true }));
      client.setQueryData(keys.branding, { unchanged: true });
      client.setQueryData(keys.analyticsLayout, { unchanged: true });
      invalidateViews(client);
      for (const key of dependent) expect(client.getQueryState(key)?.isInvalidated, key.join('/')).toBe(true);
      expect(client.getQueryState(keys.branding)?.isInvalidated).toBe(false);
      expect(client.getQueryState(keys.analyticsLayout)?.isInvalidated).toBe(false);
    } finally { client.clear(); }
  });
}

for (const [name, invalidateViews, accessChanged] of [
  ['人员/账号资料变更', invalidateAccountViews, false],
  ['账号权限变更', invalidateAccountPermissionViews, true],
  ['添加项目成员', invalidateProjectMemberViews, true],
  ['项目角色变更', invalidateProjectAccessViews, true],
] as const) {
  it(`${name}刷新人员名称、归属和派生视图，权限变化额外刷新可见范围`, () => {
    const client = new QueryClient();
    const dependent: QueryKey[] = [
      keys.accounts, [...keys.people, 'all'], [...keys.people, 'p1'], [...keys.projectMembers, 'p1'],
      [...keys.peopleCandidates, 'p1', '旧姓名'], keys.groupOverview, keys.requirements, keys.requirement('r1'),
      keys.issues, keys.issue('i1'), keys.dashboard, keys.myWork, keys.actionItems,
      keys.peopleConcurrency, keys.analyticsData, keys.analyticsPreview, keys.auditSearch,
    ];
    if (accessChanged) dependent.push(keys.projects, keys.session, keys.templates, keys.archives, keys.projectArchives);
    try {
      dependent.forEach((key) => client.setQueryData(key, { previous: true }));
      client.setQueryData(keys.branding, { unchanged: true });
      client.setQueryData(keys.analyticsLayout, { unchanged: true });
      invalidateViews(client);
      for (const key of dependent) expect(client.getQueryState(key)?.isInvalidated, key.join('/')).toBe(true);
      expect(client.getQueryState(keys.branding)?.isInvalidated).toBe(false);
      expect(client.getQueryState(keys.analyticsLayout)?.isInvalidated).toBe(false);
    } finally { client.clear(); }
  });
}
