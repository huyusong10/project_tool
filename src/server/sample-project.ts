import {ensureOtherFeature} from './other-feature';
import type Database from 'better-sqlite3';
import { addBusinessDays, todayIso } from '../shared/domain';
import { AppError } from './errors';

type SqliteDatabase = Database.Database;

function nextResourceTimestamp(current: string, floor: string) {
  const currentTime = Date.parse(current);
  const floorTime = Date.parse(floor);
  return new Date(Math.max(
    Number.isFinite(floorTime) ? floorTime : Date.now(),
    Number.isFinite(currentTime) ? currentTime + 1 : 0,
  )).toISOString();
}

function sampleWriteConflict(): never {
  throw new AppError('样板人员或账号已被其他用户修改，请重试', 409, 'STALE_WRITE');
}

export const SAMPLE_PROJECT_ID = 'sample-project-v1';
export const SAMPLE_META_KEY = 'sample_project_v1';

const people = [
  { key: 'pm', id: 'sample-v1-person-pm', name: '样板·产品经理', jobTitle: '产品经理', role: 'manager' },
  { key: 'architect', id: 'sample-v1-person-architect', name: '样板·架构师', jobTitle: '系统架构师', role: 'member' },
  { key: 'frontend', id: 'sample-v1-person-frontend', name: '样板·前端工程师', jobTitle: '前端工程师', role: 'member' },
  { key: 'backend', id: 'sample-v1-person-backend', name: '样板·后端工程师', jobTitle: '后端工程师', role: 'member' },
  { key: 'test', id: 'sample-v1-person-test', name: '样板·测试工程师', jobTitle: '测试工程师', role: 'member' },
  { key: 'viewer', id: 'sample-v1-person-viewer', name: '样板·观察者', jobTitle: '项目观察者', role: 'viewer' },
] as const;

type PersonKey = (typeof people)[number]['key'];
const personByKey = Object.fromEntries(people.map((person) => [person.key, person])) as Record<PersonKey, (typeof people)[number]>;
export const SAMPLE_PERSON_IDS = people.map((person) => person.id);

const standardTemplate = {
  id: 'sample-v1-template-standard',
  name: '标准研发交付流程',
  description: '从需求澄清到发布的标准研发流程。前后端并行开发，方案评审和上线作为关键里程碑。',
  items: [
    { key: 'clarify', title: '需求澄清', offset: 0, duration: 2, milestone: null },
    { key: 'design', title: '方案设计', offset: 2, duration: 3, milestone: '方案评审' },
    { key: 'frontend', title: '前端开发', offset: 5, duration: 5, milestone: null },
    { key: 'backend', title: '后端开发', offset: 5, duration: 6, milestone: null },
    { key: 'integration', title: '联调', offset: 11, duration: 3, milestone: null },
    { key: 'test', title: '测试验收', offset: 14, duration: 3, milestone: '验收通过' },
    { key: 'release', title: '发布', offset: 17, duration: 1, milestone: '正式上线' },
  ],
} as const;

const hotfixTemplate = {
  id: 'sample-v1-template-hotfix',
  name: '紧急问题修复流程',
  description: '用于线上紧急问题的短流程，强调快速定位、验证和可回退发布。',
  items: [
    { key: 'locate', title: '问题定位', offset: 0, duration: 1, milestone: null },
    { key: 'fix', title: '修复实现', offset: 1, duration: 2, milestone: null },
    { key: 'verify', title: '回归验证', offset: 3, duration: 1, milestone: '验证通过' },
    { key: 'release', title: '修复发布', offset: 4, duration: 1, milestone: '修复上线' },
  ],
} as const;

const archivedTemplate = {
  id: 'sample-v1-template-archived',
  name: '旧版串行交付流程',
  description: '用于展示已归档流程的筛选、恢复和永久删除。',
  items: [
    { key: 'design', title: '设计', offset: 0, duration: 3, milestone: null },
    { key: 'develop', title: '开发', offset: 3, duration: 6, milestone: null },
    { key: 'verify', title: '验证', offset: 9, duration: 3, milestone: '交付' },
  ],
} as const;

type WorkState = 'not_started' | 'in_progress' | 'completed' | 'cancelled';
type WorkSpec = {
  key: string;
  title: string;
  offset: number;
  duration: number;
  owner?: PersonKey;
  collaborators?: PersonKey[];
  state?: WorkState;
  progress?: number;
  actualStart?: number;
  actualEnd?: number;
  forecastEnd?: number;
  blockedReason?: string;
  milestone?: string | null;
  templateItemId?: string | null;
};

const templateItemId = (templateId: string, key: string) => `${templateId}-item-${key}`;
const standardWork = (overrides: Partial<Record<(typeof standardTemplate.items)[number]['key'], Partial<WorkSpec>>> = {}): WorkSpec[] =>
  standardTemplate.items.map((item) => ({
    key: item.key,
    title: item.title,
    offset: item.offset,
    duration: item.duration,
    milestone: item.milestone,
    templateItemId: templateItemId(standardTemplate.id, item.key),
    ...overrides[item.key],
  }));
const hotfixWork = (state: WorkState, owners: PersonKey[]): WorkSpec[] => hotfixTemplate.items.map((item, index) => ({
  key: item.key,
  title: item.title,
  offset: item.offset,
  duration: item.duration,
  milestone: item.milestone,
  templateItemId: templateItemId(hotfixTemplate.id, item.key),
  owner: owners[index] || owners.at(-1),
  state,
}));

type RequirementSpec = {
  key: string;
  title: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  owner: PersonKey;
  start: number;
  templateId: string | null;
  status?: string;
  archived?: boolean;
  items: WorkSpec[];
};

const requirements: RequirementSpec[] = [
  {
    key: 'permission', title: 'DEMO-01【统一权限中心接入】', priority: 'P0', owner: 'architect', start: -18, templateId: standardTemplate.id,
    items: standardWork({
      clarify: { owner: 'pm', state: 'completed', progress: 100, actualStart: -18, actualEnd: -17 },
      design: { owner: 'architect', collaborators: ['pm'], state: 'completed', progress: 100, actualStart: -16, actualEnd: -14 },
      frontend: { owner: 'frontend', collaborators: ['architect'], state: 'in_progress', progress: 55, actualStart: -12, forecastEnd: 2 },
      backend: { owner: 'backend', collaborators: ['architect'], state: 'in_progress', progress: 35, actualStart: -12, forecastEnd: 5, blockedReason: '等待外部身份平台提供稳定的鉴权接口' },
      integration: { owner: 'test', collaborators: ['frontend', 'backend'] },
      test: { owner: 'test', collaborators: ['pm'] },
      release: { owner: 'backend', collaborators: ['test'] },
    }),
  },
  {
    key: 'dashboard', title: 'DEMO-02【运营看板重构】', priority: 'P1', owner: 'pm', start: -8, templateId: standardTemplate.id,
    items: standardWork({
      clarify: { owner: 'pm', state: 'completed', progress: 100, actualStart: -8, actualEnd: -7 },
      design: { owner: 'architect', collaborators: ['pm'], state: 'completed', progress: 100, actualStart: -6, actualEnd: -4 },
      frontend: { owner: 'frontend', collaborators: ['pm'], state: 'in_progress', progress: 20, actualStart: -3, forecastEnd: 6 },
      backend: { owner: 'backend', collaborators: ['architect'], state: 'in_progress', progress: 15, actualStart: -3, forecastEnd: 7 },
      integration: { owner: 'test', collaborators: ['frontend', 'backend'] },
      test: { owner: 'test', collaborators: ['pm'] },
      release: { owner: 'backend', collaborators: ['test'] },
    }),
  },
  {
    key: 'notice', title: 'DEMO-03【消息通知中心】', priority: 'P2', owner: 'backend', start: 3, templateId: standardTemplate.id,
    items: standardWork({
      clarify: { owner: 'pm' }, design: { owner: 'architect', collaborators: ['pm'] },
      frontend: { owner: 'frontend' }, backend: { owner: 'backend', collaborators: ['architect'] },
      integration: { owner: 'test', collaborators: ['frontend', 'backend'] }, test: { owner: 'test' }, release: { owner: 'backend' },
    }),
  },
  {
    key: 'login', title: 'DEMO-04【登录体验优化】', priority: 'P2', owner: 'frontend', start: -28, templateId: hotfixTemplate.id,
    status: 'completed',
    items: hotfixWork('completed', ['architect', 'frontend', 'test', 'backend']).map((item, index) => ({
      ...item, progress: 100, actualStart: -28 + item.offset, actualEnd: -28 + item.offset + item.duration - 1,
      collaborators: index === 2 ? ['frontend'] : undefined,
    })),
  },
  {
    key: 'import', title: 'DEMO-05【批量导入能力】', priority: 'P3', owner: 'pm', start: -5, templateId: standardTemplate.id,
    items: [
      { key: 'confirm', title: '导入范围确认', offset: 0, duration: 1, owner: 'pm', state: 'completed', progress: 100, actualStart: -5, actualEnd: -5 },
      { key: 'format', title: '数据格式设计', offset: 1, duration: 2, owner: 'architect', collaborators: ['backend'], state: 'completed', progress: 100, actualStart: -4, actualEnd: -3, milestone: '格式冻结' },
      { key: 'service', title: '导入服务开发', offset: 3, duration: 5, owner: 'backend', collaborators: ['architect'], state: 'in_progress', progress: 75, actualStart: -2, forecastEnd: 3 },
      { key: 'pilot', title: '试点客户数据校验（自定义）', offset: 5, duration: 4, owner: 'test', collaborators: ['pm', 'backend'], state: 'in_progress', progress: 60, actualStart: -1, forecastEnd: 4 },
      { key: 'prepare', title: '上线准备', offset: 9, duration: 2, owner: 'backend', collaborators: ['test'], milestone: '可发布' },
    ],
  },
  {
    key: 'cancelled', title: 'DEMO-06【旧版通知渠道改造】', priority: 'P1', owner: 'pm', start: 10, templateId: hotfixTemplate.id,
    status: 'cancelled', items: hotfixWork('cancelled', ['architect', 'backend', 'test', 'backend']),
  },
  {
    key: 'archived', title: 'DEMO-99【已废弃的报表方案】', priority: 'P2', owner: 'architect', start: -35, templateId: archivedTemplate.id,
    archived: true, items: [
      { key: 'draft', title: '旧方案设计', offset: 0, duration: 3, owner: 'architect', state: 'completed', progress: 100, actualStart: -35, actualEnd: -33 },
      { key: 'prototype', title: '旧原型验证', offset: 3, duration: 3, owner: 'frontend', state: 'cancelled' },
    ],
  },
];

const progressEntries = [
  { id: 'sample-v1-progress-permission-1', requirement: 'permission', work: 'clarify', percent: 9, workPercent: 100, content: '完成使用场景梳理，确认管理员、项目经理和普通成员三类权限边界。', author: 'pm', day: -17 },
  { id: 'sample-v1-progress-permission-2', requirement: 'permission', work: 'design', percent: 23, workPercent: 100, content: '权限模型评审通过，形成接口与数据权限清单。', author: 'architect', day: -14 },
  { id: 'sample-v1-progress-permission-3', requirement: 'permission', work: 'backend', percent: 43, workPercent: 35, content: '内部权限校验已完成，外部鉴权接口不稳定，当前转为阻塞。', author: 'backend', day: -2 },
  { id: 'sample-v1-progress-dashboard-1', requirement: 'dashboard', work: 'design', percent: 23, workPercent: 100, content: '看板信息层级和指标口径已完成评审。', author: 'architect', day: -4 },
  { id: 'sample-v1-progress-dashboard-2', requirement: 'dashboard', work: 'frontend', percent: 28, workPercent: 20, content: '完成概览卡片骨架，开始处理图表响应式布局。', author: 'frontend', day: -1 },
  { id: 'sample-v1-progress-login-1', requirement: 'login', work: 'release', percent: 100, workPercent: 100, content: '登录体验优化已发布，回归验证通过。', author: 'test', day: -23 },
  { id: 'sample-v1-progress-import-1', requirement: 'import', work: 'format', percent: 30, workPercent: 100, content: '导入字段规范冻结，并补充异常数据示例。', author: 'architect', day: -3 },
  { id: 'sample-v1-progress-import-2', requirement: 'import', work: 'service', percent: 62, workPercent: 75, content: '主链路开发完成，正在补充分批处理和失败重试。', author: 'backend', day: -1 },
] as const;

const issues = [
  { key: 'auth-api', requirement: 'permission', title: '外部鉴权接口偶发超时', impact: '阻塞统一权限中心联调与上线', reporter: 'test', owner: 'architect', status: 'in_progress', priority: 'P0', progress: 40, discovered: -12, due: -3, resolved: null },
  { key: 'export', requirement: null, title: '大数据量导出内存占用过高', impact: '公共导出能力在大数据量下可能失败', reporter: 'backend', owner: 'backend', status: 'in_progress', priority: 'P1', progress: 65, discovered: -5, due: 3, resolved: null },
  { key: 'browser', requirement: 'dashboard', title: '旧版浏览器图表样式错位', impact: '影响少量使用旧版浏览器的用户', reporter: 'viewer', owner: null, status: 'in_progress', priority: 'P2', progress: 0, discovered: -2, due: 10, resolved: null },
  { key: 'vendor', requirement: null, title: '等待供应商开放测试环境', impact: '外部联调暂时无法开展', reporter: 'pm', owner: 'pm', status: 'deferred', priority: 'P2', progress: 30, discovered: -9, due: null, resolved: null },
  { key: 'timezone', requirement: 'login', title: '登录记录时区展示不一致', impact: '审计时间显示存在八小时时差', reporter: 'test', owner: 'frontend', status: 'resolved', priority: 'P3', progress: 100, discovered: -25, due: -20, resolved: -22 },
] as const;

const issueUpdates = [
  { id: 'sample-v1-issue-update-auth-1', issue: 'auth-api', progress: 15, content: '已复现超时问题，确认发生在供应商网关重试阶段。', author: 'test', day: -10 },
  { id: 'sample-v1-issue-update-auth-2', issue: 'auth-api', progress: 40, content: '增加本地缓存和降级方案，等待外部接口稳定后继续联调。', author: 'architect', day: -2 },
  { id: 'sample-v1-issue-update-export-1', issue: 'export', progress: 30, content: '完成内存快照分析，决定改为流式生成文件。', author: 'backend', day: -4 },
  { id: 'sample-v1-issue-update-export-2', issue: 'export', progress: 65, content: '流式导出主链路已完成，正在进行百万行数据压测。', author: 'backend', day: -1 },
  { id: 'sample-v1-issue-update-browser-1', issue: 'browser', progress: 0, content: '已收集浏览器版本和页面截图，等待安排负责人。', author: 'viewer', day: -1 },
  { id: 'sample-v1-issue-update-vendor-1', issue: 'vendor', progress: 30, content: '供应商预计下周开放环境，问题已挂起且移除目标日期。', author: 'pm', day: -6 },
  { id: 'sample-v1-issue-update-timezone-1', issue: 'timezone', progress: 60, content: '统一服务端时间存储格式，前端按本地时区显示。', author: 'frontend', day: -23 },
  { id: 'sample-v1-issue-update-timezone-2', issue: 'timezone', progress: 100, content: '修复已发布并由项目经理确认闭环。', author: 'pm', day: -22 },
] as const;

const authorByUpdateId = new Map<string, PersonKey>([
  ...progressEntries.map((entry) => [entry.id, entry.author] as const),
  ...issueUpdates.map((entry) => [entry.id, entry.author] as const),
]);

function uniquePersonName(sqlite: SqliteDatabase, preferred: string) {
  let candidate = preferred;
  let suffix = 2;
  const exists = sqlite.prepare('SELECT 1 FROM people WHERE lower(trim(name))=lower(trim(?)) AND deleted_at IS NULL LIMIT 1');
  while (exists.get(candidate)) candidate = `${preferred}（${suffix++}）`;
  return candidate;
}

function samplePersonUsedOutside(sqlite: SqliteDatabase, personId: string) {
  return Boolean(sqlite.prepare(`SELECT 1 WHERE
    EXISTS (SELECT 1 FROM project_people WHERE person_id=? AND project_id<>?) OR
    EXISTS (SELECT 1 FROM requirements WHERE (owner_id=? OR acceptance_owner_id=?) AND project_id<>?) OR
    EXISTS (SELECT 1 FROM work_items w JOIN requirements r ON r.id=w.requirement_id WHERE w.owner_id=? AND r.project_id<>?) OR
    EXISTS (SELECT 1 FROM work_item_collaborators c JOIN work_items w ON w.id=c.work_item_id JOIN requirements r ON r.id=w.requirement_id WHERE c.person_id=? AND r.project_id<>?) OR
    EXISTS (SELECT 1 FROM issues WHERE owner_id=? AND project_id<>?)
    LIMIT 1`).get(
      personId, SAMPLE_PROJECT_ID, personId, personId, SAMPLE_PROJECT_ID, personId, SAMPLE_PROJECT_ID,
      personId, SAMPLE_PROJECT_ID, personId, SAMPLE_PROJECT_ID,
    ));
}

export function isSampleProjectId(projectId: string) {
  return projectId === SAMPLE_PROJECT_ID;
}

export function ensureBuiltInSampleProject(sqlite: SqliteDatabase, enabled: boolean) {
  if (!enabled || sqlite.prepare('SELECT 1 FROM system_meta WHERE key=?').get(SAMPLE_META_KEY)) return false;
  if (sqlite.prepare('SELECT 1 FROM projects WHERE id=?').get(SAMPLE_PROJECT_ID)) {
    throw new Error('样板项目固定ID已被占用，无法完成初始化');
  }

  const baseDate = todayIso();
  const seedInstant = new Date();
  const d = (offset: number) => addBusinessDays(baseDate, offset);
  const at = (offset: number) => new Date(seedInstant.getTime() + offset * 86_400_000).toISOString();
  const now = seedInstant.toISOString();

  sqlite.transaction(() => {
    sqlite.prepare(`INSERT INTO projects
      (id, name, status, planned_start, planned_end, default_template_id, created_at, updated_at)
      VALUES (?, '研发协同功能样板（可删除）', 'active', ?, ?, NULL, ?, ?)`)
      .run(SAMPLE_PROJECT_ID, d(-35), d(35), now, now);

    const actualNames = new Map<PersonKey, string>();
    const insertPerson = sqlite.prepare(`INSERT INTO people (id, name, job_title, active, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)`);
    const insertMembership = sqlite.prepare(`INSERT INTO project_people (project_id, person_id, project_role, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)`);
    for (const person of people) {
      const name = uniquePersonName(sqlite, person.name);
      actualNames.set(person.key, name);
      insertPerson.run(person.id, name, person.jobTitle, at(-36), at(-36));
      insertMembership.run(SAMPLE_PROJECT_ID, person.id, person.role, at(-36), at(-36));
    }

    const insertTemplate = sqlite.prepare(`INSERT INTO work_item_templates
      (id, project_id, name, description, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const insertTemplateItem = sqlite.prepare(`INSERT INTO template_items
      (id, template_id, title, sort_order, start_offset_days, duration_days, milestone_label)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const template of [standardTemplate, hotfixTemplate, archivedTemplate]) {
      const deletedAt = template.id === archivedTemplate.id ? at(-2) : null;
      insertTemplate.run(template.id, SAMPLE_PROJECT_ID, template.name, template.description, at(-35), deletedAt || at(-35), deletedAt);
      template.items.forEach((item, index) => insertTemplateItem.run(
        templateItemId(template.id, item.key), template.id, item.title, index, item.offset, item.duration, item.milestone,
      ));
    }
    sqlite.prepare('UPDATE projects SET default_template_id=? WHERE id=?').run(standardTemplate.id, SAMPLE_PROJECT_ID);

    const otherFeatureId=ensureOtherFeature(sqlite,SAMPLE_PROJECT_ID);
    const requirementIds = new Map<string, string>();
    const workItemIds = new Map<string, string>();
    const insertRequirement = sqlite.prepare(`INSERT INTO requirements
      (id, project_id, template_id, title, owner_id, status, planned_start, planned_end, progress, risk_level, accepted_at, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'low', ?, ?, ?, ?)`);
    const insertWorkItem = sqlite.prepare(`INSERT INTO work_items
      (id, requirement_id, template_item_id, title, owner_id, status, planned_start, planned_end,
       actual_start, actual_end, forecast_end, blocked_at, blocked_reason, milestone_label, progress, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertCollaborator = sqlite.prepare('INSERT INTO work_item_collaborators (work_item_id, person_id) VALUES (?, ?)');

    for (const requirement of requirements) {
      const requirementId = `sample-v1-requirement-${requirement.key}`;
      requirementIds.set(requirement.key, requirementId);
      const plannedStart = d(requirement.start);
      const plannedEndOffset = Math.max(...requirement.items.map((item) => item.offset + item.duration - 1));
      const deletedAt = requirement.archived ? at(-2) : null;
      const activeItems = requirement.items.filter((item) => item.state !== 'cancelled');
      const totalWeight = activeItems.reduce((sum, item) => sum + item.duration, 0);
      const progress = totalWeight ? Math.round(activeItems.reduce((sum, item) => sum + item.duration * (item.progress || 0), 0) / totalWeight) : 0;
      const allCompleted = activeItems.length > 0 && activeItems.every((item) => item.state === 'completed');
      const storedStatus = requirement.status || (allCompleted ? 'completed'
          : requirement.items.some((item) => ['in_progress', 'completed'].includes(item.state || 'not_started')) ? 'in_progress' : 'not_started');
      const storedProgress = storedStatus === 'completed' ? 100 : storedStatus === 'cancelled' ? Math.min(progress, 99) : progress;
      const acceptedAt = storedStatus === 'completed' ? at(requirement.start + plannedEndOffset) : null;
      insertRequirement.run(
        requirementId, SAMPLE_PROJECT_ID, requirement.templateId, requirement.title, personByKey[requirement.owner].id,
        storedStatus, plannedStart, addBusinessDays(plannedStart, plannedEndOffset), storedProgress, acceptedAt,
        at(requirement.start - 2), deletedAt || now, deletedAt,
      );
      sqlite.prepare('UPDATE requirements SET feature_id=? WHERE id=?').run(otherFeatureId,requirementId);
      requirement.items.forEach((item, index) => {
        const workItemId = `sample-v1-work-${requirement.key}-${item.key}`;
        workItemIds.set(`${requirement.key}:${item.key}`, workItemId);
        const state = item.state || 'not_started';
        const blockedAt = null;
        insertWorkItem.run(
          workItemId, requirementId, item.templateItemId || null, item.title,
          item.owner ? personByKey[item.owner].id : null, state,
          addBusinessDays(plannedStart, item.offset), addBusinessDays(plannedStart, item.offset + item.duration - 1),
          item.actualStart === undefined ? null : d(item.actualStart), item.actualEnd === undefined ? null : d(item.actualEnd),
          item.forecastEnd === undefined ? null : d(item.forecastEnd), blockedAt, item.blockedReason || null,
          item.milestone || null, item.progress || 0, index, at(requirement.start - 1), now,
        );
        for (const collaborator of item.collaborators || []) {
          if (item.owner !== collaborator) insertCollaborator.run(workItemId, personByKey[collaborator].id);
        }
      });
    }

    const insertProgress = sqlite.prepare(`INSERT INTO progress_updates
      (id, requirement_id, work_item_id, percent, work_item_percent, content, created_by_account_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`);
    for (const entry of progressEntries) {
      const createdAt = at(entry.day);
      insertProgress.run(entry.id, requirementIds.get(entry.requirement), workItemIds.get(`${entry.requirement}:${entry.work}`), entry.percent, entry.workPercent, entry.content, createdAt, createdAt);
    }

    const issueIds = new Map<string, string>();
    const insertIssue = sqlite.prepare(`INSERT INTO issues
      (id, project_id, requirement_id, source_ref, title, impact, reporter, owner_id, status, priority, progress,
       discovered_at, due_date, resolved_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const issue of issues) {
      const issueId = `sample-v1-issue-${issue.key}`;
      issueIds.set(issue.key, issueId);
      insertIssue.run(
        issueId, SAMPLE_PROJECT_ID, issue.requirement ? requirementIds.get(issue.requirement) : null,
        `DEMO-${issue.key.toUpperCase()}`, issue.title, issue.impact, actualNames.get(issue.reporter),
        issue.owner ? personByKey[issue.owner].id : null, issue.status, issue.priority, issue.progress,
        d(issue.discovered), issue.due === null ? null : d(issue.due), issue.resolved === null ? null : d(issue.resolved),
        at(issue.discovered), at(issue.resolved ?? -1),
      );
    }

    const insertIssueUpdate = sqlite.prepare(`INSERT INTO issue_updates
      (id, issue_id, progress, content, created_by_account_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?, ?)`);
    for (const entry of issueUpdates) {
      const createdAt = at(entry.day);
      insertIssueUpdate.run(entry.id, issueIds.get(entry.issue), entry.progress, entry.content, createdAt, createdAt);
    }

    sqlite.prepare(`INSERT INTO system_meta (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run(SAMPLE_META_KEY, JSON.stringify({ projectId: SAMPLE_PROJECT_ID, version: 1, baseDate }), now, now);
  })();
  return true;
}

export function linkSampleProgressAuthors(sqlite: SqliteDatabase) {
  const account = sqlite.prepare('SELECT id FROM accounts WHERE person_id=? LIMIT 1');
  const updateProgress = sqlite.prepare('UPDATE progress_updates SET created_by_account_id=? WHERE id=? AND created_by_account_id IS NULL');
  const updateIssue = sqlite.prepare('UPDATE issue_updates SET created_by_account_id=? WHERE id=? AND created_by_account_id IS NULL');
  sqlite.transaction(() => {
    for (const [updateId, personKey] of authorByUpdateId) {
      const found = account.get(personByKey[personKey].id) as { id: string } | undefined;
      if (!found) continue;
      if (updateId.startsWith('sample-v1-progress-')) updateProgress.run(found.id, updateId);
      else updateIssue.run(found.id, updateId);
    }
  })();
}

export function archiveUnusedSamplePeople(sqlite: SqliteDatabase, now: string, preserveAccountId?: string) {
  const getPerson = sqlite.prepare('SELECT updated_at AS updatedAt FROM people WHERE id=? AND deleted_at IS NULL');
  const getAccount = sqlite.prepare(`SELECT id, updated_at AS updatedAt FROM accounts
    WHERE person_id=? AND is_builtin=0 AND deleted_at IS NULL AND (? IS NULL OR id<>?)`);
  const archivePerson = sqlite.prepare(`UPDATE people SET active=0, deleted_at=?, updated_at=?
    WHERE id=? AND updated_at=? AND deleted_at IS NULL`);
  const disableAccount = sqlite.prepare(`UPDATE accounts SET status='disabled', session_version=session_version+1, updated_at=?
    WHERE id=? AND updated_at=? AND deleted_at IS NULL`);
  for (const personId of SAMPLE_PERSON_IDS) {
    if (samplePersonUsedOutside(sqlite, personId)) continue;
    const person = getPerson.get(personId) as { updatedAt: string } | undefined;
    if (!person) continue;
    const personUpdatedAt = nextResourceTimestamp(person.updatedAt, now);
    if (!archivePerson.run(personUpdatedAt, personUpdatedAt, personId, person.updatedAt).changes) sampleWriteConflict();
    const account = getAccount.get(personId, preserveAccountId || null, preserveAccountId || null) as { id: string; updatedAt: string } | undefined;
    if (!account) continue;
    const accountUpdatedAt = nextResourceTimestamp(account.updatedAt, now);
    if (!disableAccount.run(accountUpdatedAt, account.id, account.updatedAt).changes) sampleWriteConflict();
  }
}

export function restoreSamplePeople(sqlite: SqliteDatabase, now: string) {
  const getPerson = sqlite.prepare('SELECT updated_at AS updatedAt FROM people WHERE id=? AND deleted_at IS NOT NULL');
  const getAccount = sqlite.prepare('SELECT id, updated_at AS updatedAt FROM accounts WHERE person_id=? AND is_builtin=0 AND deleted_at IS NULL');
  const restorePerson = sqlite.prepare(`UPDATE people SET active=1, deleted_at=NULL, updated_at=?
    WHERE id=? AND updated_at=? AND deleted_at IS NOT NULL`);
  const enableAccount = sqlite.prepare(`UPDATE accounts SET status='active', updated_at=?
    WHERE id=? AND updated_at=? AND deleted_at IS NULL`);
  for (const personId of SAMPLE_PERSON_IDS) {
    const person = getPerson.get(personId) as { updatedAt: string } | undefined;
    if (!person) continue;
    const personUpdatedAt = nextResourceTimestamp(person.updatedAt, now);
    if (!restorePerson.run(personUpdatedAt, personId, person.updatedAt).changes) sampleWriteConflict();
    const account = getAccount.get(personId) as { id: string; updatedAt: string } | undefined;
    if (!account) continue;
    const accountUpdatedAt = nextResourceTimestamp(account.updatedAt, now);
    if (!enableAccount.run(accountUpdatedAt, account.id, account.updatedAt).changes) sampleWriteConflict();
  }
}

export function deleteOrReleaseSamplePeople(sqlite: SqliteDatabase, now: string) {
  const deleteAccounts = sqlite.prepare('DELETE FROM accounts WHERE person_id=? AND is_builtin=0');
  const deletePerson = sqlite.prepare('DELETE FROM people WHERE id=?');
  const getArchivedPerson = sqlite.prepare('SELECT updated_at AS updatedAt FROM people WHERE id=? AND deleted_at IS NOT NULL');
  const getAccount = sqlite.prepare('SELECT id, updated_at AS updatedAt FROM accounts WHERE person_id=? AND is_builtin=0 AND deleted_at IS NULL');
  const releasePerson = sqlite.prepare(`UPDATE people SET active=1, deleted_at=NULL, updated_at=?
    WHERE id=? AND updated_at=? AND deleted_at IS NOT NULL`);
  const releaseAccount = sqlite.prepare(`UPDATE accounts SET status='active', updated_at=?
    WHERE id=? AND updated_at=? AND deleted_at IS NULL`);
  for (const personId of SAMPLE_PERSON_IDS) {
    if (samplePersonUsedOutside(sqlite, personId)) {
      const person = getArchivedPerson.get(personId) as { updatedAt: string } | undefined;
      if (!person) continue;
      const personUpdatedAt = nextResourceTimestamp(person.updatedAt, now);
      if (!releasePerson.run(personUpdatedAt, personId, person.updatedAt).changes) sampleWriteConflict();
      const account = getAccount.get(personId) as { id: string; updatedAt: string } | undefined;
      if (!account) continue;
      const accountUpdatedAt = nextResourceTimestamp(account.updatedAt, now);
      if (!releaseAccount.run(accountUpdatedAt, account.id, account.updatedAt).changes) sampleWriteConflict();
    } else {
      deleteAccounts.run(personId);
      deletePerson.run(personId);
    }
  }
}
