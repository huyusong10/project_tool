import { moduleLogger } from '../../scripts/runtime-logger.mjs';
import { getDatabaseContext } from './database-context';
const log = moduleLogger('analytics');
import { getPeopleConcurrency } from './services/reporting';
import { listRequirements, requirementCompletionDate } from './services/requirements';
import { recordAudit } from './services/audit';
import { nextUpdatedAt } from './services/support';
import type { Actor } from './auth';
import {
  analyticsCatalog,
  analyticsPanelSizes,
  analyticsSorts,
  analyticsTimeScopes,
  analyticsVisualizations,
  catalogDataset,
  catalogMeasure,
  defaultAnalyticsLayout,
  type AnalyticsDataRow,
  type AnalyticsLayout,
  type AnalyticsLayoutResponse,
  type AnalyticsPanelConfig,
  type AnalyticsPanelResult,
  type AnalyticsQueryResponse,
  type AnalyticsRange,
} from '../shared/analytics';
import { canonicalizeLabel, textSafetyIssue } from '../shared/search';
import {
  addCalendarDays,
  businessDateFromDateTime,
  businessDayDelta,
  businessDaysInclusive,
  priorityLabels,
  requirementStatusLabels,
  riskLabels,
  startOfWeekIso,
  todayIso,
} from '../shared/domain';
import { AppError, fail, forbidden } from './errors';
import { isValidIsoDate } from '../shared/workday';
import { requireAuthorizationActor } from './authorization';

type GenericRecord = Record<string, any>;
type AnalyticsContext = {
  requirements: GenericRecord[];
  workItems: GenericRecord[];
  issues: GenericRecord[];
  peopleByRange: Map<string, GenericRecord[]>;
  progress: GenericRecord[];
  errors: Record<string, string>;
};

const issueStatusLabels: Record<string, string> = {
  in_progress: '处理中', deferred: '挂起', resolved: '已解决',
};

function cloneDefaultLayout(): AnalyticsLayout {
  return JSON.parse(JSON.stringify(defaultAnalyticsLayout)) as AnalyticsLayout;
}

type AnalyticsLayoutRow = { configJson: string; updatedAt: string };

function analyticsLayoutRow(accountId: string) {
  return getDatabaseContext().sqlite.prepare('SELECT config_json AS configJson, updated_at AS updatedAt FROM analytics_layouts WHERE account_id=?')
    .get(accountId) as AnalyticsLayoutRow | undefined;
}

function assertExpectedLayoutUpdatedAt(value: unknown, currentUpdatedAt: string | null, action = '保存') {
  if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, 'expectedUpdatedAt')) return;
  if ((value as Record<string, unknown>).expectedUpdatedAt !== currentUpdatedAt) {
    throw new AppError(`个人分析布局已被其他会话修改，请重新读取后再${action}`, 409, 'STALE_WRITE', { currentUpdatedAt });
  }
}

function validationError(message: string): never {
  fail(message);
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], message: string) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) validationError(message);
}

function stringArray(value: unknown) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) validationError('分析筛选条件格式不合法');
  return [...new Set(value as string[])];
}

function validatePanel(value: unknown, index: number): AnalyticsPanelConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) validationError(`第${index + 1}个图表配置不合法`);
  const panel = {...value} as Record<string, unknown>;
  if(panel.dataset==='requirements'){
    const retiredMeasures=['commitment_on_time_rate','latest_commitment_on_time_rate'];
    const migratedMeasure=[panel.measure,panel.secondaryMeasure].some(value=>retiredMeasures.includes(String(value)));
    for(const key of ['measure','secondaryMeasure'])if(retiredMeasures.includes(String(panel[key])))panel[key]='on_time_rate';
    if(migratedMeasure&&panel.secondaryMeasure===panel.measure)delete panel.secondaryMeasure;
    if(typeof panel.title==='string'&&/按(首次|最近)承诺交付率/.test(panel.title))panel.title='按期完成率';
    if(panel.filters&&typeof panel.filters==='object'){panel.filters={...panel.filters};delete (panel.filters as Record<string,unknown>).deliveryScope;}
  }
  rejectUnknownKeys(panel, [
    'id', 'title', 'dataset', 'measure', 'secondaryMeasure', 'dimension', 'visualization',
    'size', 'timeScope', 'filters', 'sort', 'limit',
  ], `第${index + 1}个图表包含未声明字段`);
  const requiredStrings = ['id', 'title', 'dataset', 'measure', 'visualization', 'size', 'timeScope'];
  const optionalStrings = ['secondaryMeasure', 'dimension', 'sort'];
  if (requiredStrings.some((key) => typeof panel[key] !== 'string')
    || optionalStrings.some((key) => panel[key] !== undefined && typeof panel[key] !== 'string')
    || (panel.limit !== undefined && typeof panel.limit !== 'number')) {
    validationError(`第${index + 1}个图表字段类型不合法`);
  }
  const id = String(panel.id || '').trim();
  if (textSafetyIssue(panel.title, false)) validationError(`第${index + 1}个图表标题包含不支持的控制字符`);
  const title = canonicalizeLabel(panel.title);
  if (!id || id.length > 80 || !/^[\w-]+$/.test(id)) validationError(`第${index + 1}个图表ID不合法`);
  if (!title || title.length > 60) validationError(`第${index + 1}个图表标题不合法`);
  const datasetId = String(panel.dataset || '');
  const dataset = catalogDataset(datasetId);
  if (!dataset) validationError(`图表“${title}”的数据主题不支持`);
  const measureId = String(panel.measure || '');
  const measure = catalogMeasure(datasetId, measureId);
  if (!measure) validationError(`图表“${title}”的指标不支持`);
  const dimension = panel.dimension ? String(panel.dimension) : undefined;
  if (dimension && !measure.dimensions.includes(dimension)) validationError(`图表“${title}”的分组维度与指标不兼容`);
  const visualization = String(panel.visualization || '') as AnalyticsPanelConfig['visualization'];
  if (!analyticsVisualizations.includes(visualization) || !measure.visualizations.includes(visualization)) {
    validationError(`图表“${title}”的图表类型与指标不兼容`);
  }
  if (visualization === 'kpi' && dimension) validationError(`指标卡“${title}”不能设置分组维度`);
  if (visualization !== 'kpi' && visualization !== 'table' && !dimension) validationError(`图表“${title}”需要设置分组维度`);
  const secondaryMeasure = panel.secondaryMeasure ? String(panel.secondaryMeasure) : undefined;
  if (secondaryMeasure) {
    const secondary = catalogMeasure(datasetId, secondaryMeasure);
    if (!secondary || secondary.unit !== measure.unit || secondaryMeasure === measureId || !['bar', 'line', 'table'].includes(visualization)
      || (dimension && !secondary.dimensions.includes(dimension)) || !secondary.visualizations.includes(visualization)) {
      validationError(`图表“${title}”的对比指标不兼容`);
    }
  }
  const size = String(panel.size || '') as AnalyticsPanelConfig['size'];
  const timeScope = String(panel.timeScope || '') as AnalyticsPanelConfig['timeScope'];
  if (!analyticsPanelSizes.includes(size)) validationError(`图表“${title}”的尺寸不合法`);
  if (!analyticsTimeScopes.includes(timeScope)) validationError(`图表“${title}”的时间策略不合法`);
  const sort = panel.sort === undefined ? undefined : String(panel.sort) as AnalyticsPanelConfig['sort'];
  if (sort && !analyticsSorts.includes(sort)) validationError(`图表“${title}”的排序不合法`);
  const limit = panel.limit === undefined ? undefined : Number(panel.limit);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 50)) validationError(`图表“${title}”的数量限制需为1到50`);
  const filters: Record<string, string[]> = {};
  if (panel.filters !== undefined) {
    if (!panel.filters || typeof panel.filters !== 'object' || Array.isArray(panel.filters)) validationError(`图表“${title}”的筛选配置不合法`);
    for (const [filterId, rawValues] of Object.entries(panel.filters as Record<string, unknown>)) {
      const definition = dataset.filters.find((filter) => filter.id === filterId);
      if (!definition) validationError(`图表“${title}”包含不支持的筛选项`);
      const values = stringArray(rawValues);
      if (values.some((item) => !definition.options.some((option) => option.value === item))) validationError(`图表“${title}”包含不支持的筛选值`);
      if (values.length) filters[filterId] = values;
    }
  }
  return {
    id, title, dataset: datasetId, measure: measureId, secondaryMeasure, dimension, visualization,
    size, timeScope, ...(Object.keys(filters).length ? { filters } : {}), ...(sort ? { sort } : {}), ...(limit ? { limit } : {}),
  };
}

export function validateAnalyticsLayout(value: unknown): AnalyticsLayout {
  if (!value || typeof value !== 'object' || Array.isArray(value)) validationError('分析布局格式不合法');
  const layout = value as Record<string, unknown>;
  rejectUnknownKeys(layout, ['version', 'panels', 'expectedUpdatedAt'], '分析布局不能包含未声明字段');
  if (layout.version !== 1) validationError('分析布局版本不支持');
  if (!Array.isArray(layout.panels) || layout.panels.length < 1 || layout.panels.length > 24) validationError('分析布局需包含1到24个图表');
  const panels = layout.panels.map(validatePanel);
  if (new Set(panels.map((panel) => panel.id)).size !== panels.length) validationError('分析布局中的图表ID不能重复');
  return { version: 1, panels };
}

function validateRange(value: unknown): AnalyticsRange {
  if (!value || typeof value !== 'object') validationError('分析时间范围不能为空');
  const range = value as Record<string, unknown>;
  rejectUnknownKeys(range, ['from', 'to'], '分析时间范围不能包含未声明字段');
  const from = String(range.from || ''); const to = String(range.to || '');
  if (!isValidIsoDate(from) || !isValidIsoDate(to) || from > to) validationError('分析时间范围不合法');
  if (businessDaysInclusive(from, to) > 1320) validationError('分析时间范围不能超过5年');
  return { from, to };
}

export function getAnalyticsCatalog() {
  return analyticsCatalog;
}

export function getAnalyticsLayout(accountId?: string | null, canCustomize = false): AnalyticsLayoutResponse {
  if (!accountId) return { layout: cloneDefaultLayout(), source: 'default', canCustomize: false, updatedAt: null };
  const saved = analyticsLayoutRow(accountId);
  if (!saved) return { layout: cloneDefaultLayout(), source: 'default', canCustomize, updatedAt: null };
  try {
    return { layout: validateAnalyticsLayout(JSON.parse(saved.configJson)), source: 'personal', canCustomize, updatedAt: saved.updatedAt };
  } catch {
    return { layout: cloneDefaultLayout(), source: 'default', canCustomize, updatedAt: saved.updatedAt };
  }
}

export function saveAnalyticsLayout(accountId: string, value: unknown, actor: Actor) {
  const layout = validateAnalyticsLayout(value);
  return getDatabaseContext().sqlite.transaction(() => saveAnalyticsLayoutInTransaction(accountId, value, actor, layout))();
}

function assertCurrentLayoutAccount(accountId: string, actor: Actor) {
  if (requireAuthorizationActor(actor).accountId !== accountId) forbidden('只能修改自己的分析布局');
}

function saveAnalyticsLayoutInTransaction(accountId: string, value: unknown, actor: Actor, layout: AnalyticsLayout) {
  const existing = analyticsLayoutRow(accountId);
  const currentUpdatedAt = existing?.updatedAt || null;
  assertExpectedLayoutUpdatedAt(value, currentUpdatedAt);
  const serialized = JSON.stringify(layout);
  let unchanged = false;
  if (existing) {
    try {
      unchanged = JSON.stringify(validateAnalyticsLayout(JSON.parse(existing.configJson))) === serialized;
    } catch {
      // 损坏的历史配置仍通过本次保存修复。
    }
  }
  if (unchanged) {
    assertCurrentLayoutAccount(accountId, actor);
    return { layout, source: 'personal' as const, canCustomize: true, updatedAt: existing!.updatedAt };
  }
  const now = currentUpdatedAt ? nextUpdatedAt(currentUpdatedAt) : new Date().toISOString();
  const changed = existing
    ? getDatabaseContext().sqlite.prepare('UPDATE analytics_layouts SET config_json=?, updated_at=? WHERE account_id=? AND updated_at=?')
      .run(serialized, now, accountId, existing.updatedAt)
    : getDatabaseContext().sqlite.prepare('INSERT OR IGNORE INTO analytics_layouts (account_id, config_json, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(accountId, serialized, now, now);
  if (!changed.changes) {
    throw new AppError('个人分析布局已被其他会话修改，请重新读取后再保存', 409, 'STALE_WRITE', {
      currentUpdatedAt: analyticsLayoutRow(accountId)?.updatedAt || null,
    });
  }
  assertCurrentLayoutAccount(accountId, actor);
  recordAudit(actor, 'update', 'analytics_layout', accountId, `保存统计分析布局：${layout.panels.length}个图表`);
  return { layout, source: 'personal' as const, canCustomize: true, updatedAt: now };
}

export function resetAnalyticsLayout(accountId: string, value: unknown, actor: Actor) {
  return getDatabaseContext().sqlite.transaction(() => resetAnalyticsLayoutInTransaction(accountId, value, actor))();
}

function resetAnalyticsLayoutInTransaction(accountId: string, value: unknown, actor: Actor) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) validationError('恢复默认布局参数不合法');
  rejectUnknownKeys(value as Record<string, unknown>, ['expectedUpdatedAt'], '恢复默认布局不能包含未声明字段');
  const existing = analyticsLayoutRow(accountId);
  const currentUpdatedAt = existing?.updatedAt || null;
  assertExpectedLayoutUpdatedAt(value, currentUpdatedAt, '恢复默认');
  if (!existing) {
    assertCurrentLayoutAccount(accountId, actor);
    return { layout: cloneDefaultLayout(), source: 'default' as const, canCustomize: true, updatedAt: null };
  }
  const changed = getDatabaseContext().sqlite.prepare('DELETE FROM analytics_layouts WHERE account_id=? AND updated_at=?').run(accountId, existing.updatedAt);
  if (!changed.changes) {
    throw new AppError('个人分析布局已被其他会话修改，请重新读取后再恢复默认', 409, 'STALE_WRITE', {
      currentUpdatedAt: analyticsLayoutRow(accountId)?.updatedAt || null,
    });
  }
  assertCurrentLayoutAccount(accountId, actor);
  recordAudit(actor, 'reset', 'analytics_layout', accountId, '恢复统计分析默认布局');
  return { layout: cloneDefaultLayout(), source: 'default' as const, canCustomize: true, updatedAt: null };
}

function loadContext(projectId: string, panels: AnalyticsPanelConfig[], range: AnalyticsRange, asOfDate: string): AnalyticsContext {
  const datasets = new Set(panels.map((panel) => panel.dataset));
  let requirementRows: GenericRecord[] = [];
  let workItems: GenericRecord[] = [];
  let issues: GenericRecord[] = [];
  let progress: GenericRecord[] = [];
  const peopleByRange = new Map<string, GenericRecord[]>();
  const errors: Record<string, string> = {};
  const messageOf = (dataset: string, error: unknown) => {
    log.error({ event: 'analytics.dataset_failed', err: error, projectId, dataset }, '图表数据读取失败');
    return '图表数据读取失败';
  };
  if (datasets.has('requirements') || datasets.has('work_items')) {
    try {
      const requirements = listRequirements({ projectId }, asOfDate);
      requirementRows = requirements.map((requirement) => ({
        ...requirement,priority:requirement.processingPriority||'unassessed',deliveryScope:requirement.deliveryScope||'committed',
        template: requirement.templateName || '未绑定流程', owner: requirement.ownerName || '未分配',
        risk: requirement.riskEvaluated ? requirement.riskLevel : 'unassessed',
        completedAt: requirementCompletionDate(requirement),
      }));
      workItems = requirements.filter(r=>!r.deletedAt).flatMap((requirement) => (requirement.workItems || []).map((item) => ({
        ...item, requirementTitle: requirement.title, owner: item.ownerName || '未分配',
      })));
    } catch (error) {
      const message = messageOf('requirements/work_items', error);
      if (datasets.has('requirements')) errors.requirements = message;
      if (datasets.has('work_items')) errors.work_items = message;
    }
  }
  if (datasets.has('issues')) try {
    issues = getDatabaseContext().sqlite.prepare(`SELECT i.id, i.title, i.status, i.priority,
      i.requirement_id AS requirementId, i.owner_id AS ownerId, COALESCE(p.name, '未分配') AS owner,
      i.discovered_at AS discoveredAt, i.due_date AS dueDate, i.resolved_at AS resolvedAt,
      i.created_at AS createdAt, i.updated_at AS updatedAt
      FROM issues i LEFT JOIN people p ON p.id=i.owner_id
      LEFT JOIN requirements r ON r.id=i.requirement_id
      WHERE i.project_id=? AND (i.requirement_id IS NULL OR r.deleted_at IS NULL)`).all(projectId) as GenericRecord[];
  } catch (error) { errors.issues = messageOf('issues', error); }
  if (datasets.has('progress')) try {
    progress = getDatabaseContext().sqlite.prepare(`SELECT u.id, u.requirement_id AS requirementId,
      r.title AS requirement, COALESCE(a.username, '系统/未知') AS creator, u.created_at AS createdAt
      FROM progress_updates u JOIN requirements r ON r.id=u.requirement_id
      LEFT JOIN accounts a ON a.id=u.created_by_account_id
      WHERE r.project_id=? AND r.deleted_at IS NULL`).all(projectId) as GenericRecord[];
  } catch (error) { errors.progress = messageOf('progress', error); }
  if (datasets.has('people')) {
    try {
      const ranges = new Map(panels.filter((panel) => panel.dataset === 'people').map((panel) => {
        const panelRange = peopleRange(panel, range, asOfDate);
        return [rangeKey(panelRange), panelRange];
      }));
      for (const [key, panelRange] of ranges) {
        const loadedPeople = getPeopleConcurrency({ projectId, from: panelRange.from, to: panelRange.to }, asOfDate).people;
        peopleByRange.set(key, loadedPeople.map((person) => ({
          ...person,
          person: person.name,
          job_title: person.jobTitle || '岗位未设置',
        })));
      }
    } catch (error) { errors.people = messageOf('people', error); }
  }
  return { requirements: requirementRows, workItems, issues, progress, peopleByRange, errors };
}

function inRange(value: string | null | undefined, range: AnalyticsRange) {
  return Boolean(value && value >= range.from && value <= range.to);
}

function eventDate(dataset: string, measure: string, record: GenericRecord) {
  if (dataset === 'requirements') {
    if (['completed_count','on_time_rate'].includes(measure)) return record.completedAt;
    if (measure === 'due_count') return record.plannedEnd;
    if (measure === 'finish_variance') return record.completedAt || record.plannedEnd;
    return record.createdAt ? businessDateFromDateTime(record.createdAt) : null;
  }
  if (dataset === 'work_items') {
    if (measure === 'completed_count' || measure === 'on_time_rate' || measure === 'average_cycle_days') return record.actualEnd;
    return record.createdAt ? businessDateFromDateTime(record.createdAt) : null;
  }
  if (dataset === 'issues') {
    if (measure === 'resolved_count' || measure === 'average_resolution_days') return record.resolvedAt;
    return record.discoveredAt;
  }
  if (dataset === 'progress') return record.createdAt ? businessDateFromDateTime(record.createdAt) : null;
  return null;
}

function effectiveRange(panel: AnalyticsPanelConfig, globalRange: AnalyticsRange, asOfDate: string): AnalyticsRange | null {
  if (panel.timeScope === 'snapshot') return null;
  if (panel.timeScope === 'future30') return { from: asOfDate, to: addCalendarDays(asOfDate, 30) };
  return globalRange;
}

function peopleRange(panel: AnalyticsPanelConfig, globalRange: AnalyticsRange, asOfDate: string): AnalyticsRange {
  return effectiveRange(panel, globalRange, asOfDate) || { from: asOfDate, to: asOfDate };
}

function rangeKey(range: AnalyticsRange) {
  return `${range.from}:${range.to}`;
}

function applyPanelFilters(records: GenericRecord[], panel: AnalyticsPanelConfig) {
  return records.filter((record) => Object.entries(panel.filters || {}).every(([key, values]) => {
    if (!values.length) return true;
    const current = key === 'scope' ? (record.requirementId ? 'requirement' : 'public') : record[key];
    return values.includes(String(current));
  }));
}

function eligibleRecords(dataset: string, measure: string, records: GenericRecord[], panel: AnalyticsPanelConfig, globalRange: AnalyticsRange, asOfDate: string) {
  const range = effectiveRange(panel, globalRange, asOfDate);
  let result = records;
  if (range && dataset !== 'people') result = result.filter((record) => inRange(eventDate(dataset, measure, record), range));
  if (dataset === 'requirements') {
    result=result.filter(r=>!r.deletedAt);
    if (measure === 'active_count') result = result.filter((record) => !['completed', 'cancelled'].includes(record.status));
    if (['completed_count','on_time_rate'].includes(measure)) result = result.filter((record) => Boolean(record.completedAt));
    if (measure === 'on_time_rate') result = result.filter((record) => Boolean(record.plannedEnd));
    if (measure === 'delayed_count') result = result.filter((record) => record.delayed);
    if (measure === 'finish_variance') result = result.filter((record) => Number(record.finishVariance || 0) > 0);
    if (measure === 'due_count') result = result.filter((record) => Boolean(record.plannedEnd) && !['completed', 'cancelled'].includes(record.status));
  } else if (dataset === 'work_items') {
    if (measure === 'completed_count' || measure === 'on_time_rate' || measure === 'average_cycle_days') result = result.filter((record) => Boolean(record.actualEnd));
    if (measure === 'on_time_rate') result = result.filter((record) => Boolean(record.plannedEnd));
    if (measure === 'average_cycle_days') result = result.filter((record) => Boolean(record.actualStart));
  } else if (dataset === 'issues') {
    if (measure === 'active_count') result = result.filter((record) => record.status !== 'resolved');
    if (measure === 'resolved_count' || measure === 'average_resolution_days') result = result.filter((record) => Boolean(record.resolvedAt));
    if (measure === 'closure_rate') result = result.filter((record) => record.status === 'resolved' || Boolean(record.discoveredAt));
    if (measure === 'overdue_count') result = result.filter((record) => record.status !== 'resolved' && businessDayDelta(record.dueDate, asOfDate) > 0);
  }
  return result;
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function measureValue(dataset: string, measure: string, records: GenericRecord[]) {
  if (!records.length) return 0;
  if (dataset === 'requirements') {
    if (measure === 'on_time_rate') return round(records.filter((record) => businessDayDelta(record.plannedEnd, record.completedAt) <= 0).length / records.length * 100);
    if (measure === 'finish_variance') return round(records.reduce((sum, record) => sum + Number(record.finishVariance || 0), 0) / records.length);
  }
  if (dataset === 'work_items') {
    if (measure === 'on_time_rate') return round(records.filter((record) => businessDayDelta(record.plannedEnd, record.actualEnd) <= 0).length / records.length * 100);
    if (measure === 'average_cycle_days') return round(records.reduce((sum, record) => sum + Math.max(1, businessDaysInclusive(record.actualStart, record.actualEnd)), 0) / records.length);
  }
  if (dataset === 'issues') {
    if (measure === 'closure_rate') return round(records.filter((record) => record.status === 'resolved').length / records.length * 100);
    if (measure === 'average_resolution_days') return round(records.reduce((sum, record) => sum + Math.max(1, businessDaysInclusive(record.discoveredAt, record.resolvedAt)), 0) / records.length);
  }
  if (dataset === 'people') {
    if (measure === 'current_concurrency') return records.reduce((sum, record) => sum + Number(record.currentCount || 0), 0);
    if (measure === 'peak_concurrency') return records.reduce((sum, record) => sum + Number(record.peakCount || 0), 0);
  }
  if (dataset === 'progress' && measure === 'requirements_updated') return new Set(records.map((record) => record.requirementId)).size;
  return records.length;
}

function shortDate(value: string) {
  return `${value.slice(5, 7)}/${value.slice(8, 10)}`;
}

function dimensionValue(dataset: string, dimension: string, record: GenericRecord, measure: string) {
  if (dimension === 'week' || dimension === 'day') {
    const date = eventDate(dataset, measure, record);
    if (!date) return { key: 'unknown', label: '日期未知' };
    const key = dimension === 'week' ? startOfWeekIso(date) : date;
    return { key, label: dimension === 'week' ? `${shortDate(key)}周` : shortDate(key) };
  }
  if (dimension === 'requirement') return {
    key: String(dataset === 'requirements' ? record.id : record.requirementId),
    label: String(record.title || record.requirement || '未设置'),
  };
  if (dimension === 'template') return {
    key: String(record.templateId || 'unbound'),
    label: String(record.template || '未绑定流程'),
  };
  const raw = dimension === 'person' ? record.person
        : dimension === 'owner' ? record.owner
          : dimension === 'scope' ? (record.requirementId ? 'requirement' : 'public')
            : record[dimension];
  const key = String(raw ?? 'unknown');
  if (dimension === 'status') return { key, label: dataset === 'issues' ? issueStatusLabels[key] || key : requirementStatusLabels[key as keyof typeof requirementStatusLabels] || key };
  if (dimension === 'priority') return { key, label: priorityLabels[key as keyof typeof priorityLabels] || key };
  if (dimension === 'risk') return { key, label: key === 'unassessed' ? '未评估' : riskLabels[key as keyof typeof riskLabels] || key };
  if (dimension === 'scope') return { key, label: key === 'public' ? '公共问题' : '需求问题' };
  return { key, label: key === 'unknown' ? '未设置' : key };
}

function aggregateMeasure(context: AnalyticsContext, panel: AnalyticsPanelConfig, measure: string, range: AnalyticsRange, asOfDate: string) {
  const sources: Record<string, GenericRecord[]> = {
    requirements: context.requirements, work_items: context.workItems, issues: context.issues,
    people: context.peopleByRange.get(rangeKey(peopleRange(panel, range, asOfDate))) || [], progress: context.progress,
  };
  const source = sources[panel.dataset] || [];
  const filtered = applyPanelFilters(source, panel);
  const eligible = eligibleRecords(panel.dataset, measure, filtered, panel, range, asOfDate);
  if (!panel.dimension) return new Map([['total', { key: 'total', label: '总计', value: measureValue(panel.dataset, measure, eligible), sampleCount: eligible.length }]]);
  const groups = new Map<string, { key: string; label: string; records: GenericRecord[] }>();
  for (const record of eligible) {
    const dimension = dimensionValue(panel.dataset, panel.dimension, record, measure);
    const current = groups.get(dimension.key) || { ...dimension, records: [] as GenericRecord[] };
    current.records.push(record); groups.set(dimension.key, current);
  }
  return new Map([...groups.entries()].map(([key, group]) => [key, {
    key, label: group.label, value: measureValue(panel.dataset, measure, group.records), sampleCount: group.records.length,
  }]));
}

function queryPanel(context: AnalyticsContext, panel: AnalyticsPanelConfig, range: AnalyticsRange, asOfDate: string): AnalyticsPanelResult {
  if (context.errors[panel.dataset]) throw new Error(context.errors[panel.dataset]);
  const measure = catalogMeasure(panel.dataset, panel.measure)!;
  const dimensionLabel = catalogDataset(panel.dataset)?.dimensions.find((dimension) => dimension.id === panel.dimension)?.label;
  const primary = aggregateMeasure(context, panel, panel.measure, range, asOfDate);
  const secondaryDefinition = panel.secondaryMeasure ? catalogMeasure(panel.dataset, panel.secondaryMeasure) : undefined;
  const secondary = panel.secondaryMeasure ? aggregateMeasure(context, panel, panel.secondaryMeasure, range, asOfDate) : new Map();
  const keys = [...new Set([...primary.keys(), ...secondary.keys()])];
  let rows: AnalyticsDataRow[] = keys.map((key) => ({
    key,
    label: primary.get(key)?.label || secondary.get(key)?.label || key,
    value: primary.get(key)?.value || 0,
    ...(measure.unit !== 'count' ? { sampleCount: primary.get(key)?.sampleCount || 0 } : {}),
    ...(panel.secondaryMeasure ? { secondaryValue: secondary.get(key)?.value || 0,
      ...(measure.unit !== 'count' ? { secondarySampleCount: secondary.get(key)?.sampleCount || 0 } : {}),
    } : {}),
  }));
  const chronological = panel.dimension === 'week' || panel.dimension === 'day';
  const direction = panel.sort || (chronological ? 'asc' : 'desc');
  rows.sort((left, right) => chronological
    ? (direction === 'asc' ? left.key.localeCompare(right.key) : right.key.localeCompare(left.key))
    : direction === 'asc' ? left.value - right.value : right.value - left.value);
  if (panel.limit) rows = rows.slice(0, panel.limit);
  return {
    panelId: panel.id, rows, measureLabel: measure.label,
    secondaryMeasureLabel: secondaryDefinition?.label, dimensionLabel, unit: measure.unit,
    snapshot: panel.timeScope === 'snapshot',
  };
}

export function queryAnalytics(value: unknown): AnalyticsQueryResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) validationError('分析查询格式不合法');
  const input = value as Record<string, unknown>;
  rejectUnknownKeys(input, ['projectId', 'range', 'panels'], '分析查询不能包含未声明字段');
  const projectId = String(input.projectId || '').trim();
  if (!projectId || !getDatabaseContext().sqlite.prepare('SELECT id FROM projects WHERE id=? AND deleted_at IS NULL').get(projectId)) validationError('请选择有效项目');
  const range = validateRange(input.range);
  const layout = validateAnalyticsLayout({ version: 1, panels: input.panels });
  const asOfDate = todayIso();
  const context = loadContext(projectId, layout.panels, range, asOfDate);
  const results = layout.panels.map((panel) => {
    try {
      return queryPanel(context, panel, range, asOfDate);
    } catch (error) {
      log.error({ event: 'analytics.panel_failed', err: error, projectId, panelId: panel.id }, '图表查询失败');
      const measure = catalogMeasure(panel.dataset, panel.measure);
      return {
        panelId: panel.id, rows: [], measureLabel: measure?.label || panel.measure,
        unit: measure?.unit || 'count', snapshot: panel.timeScope === 'snapshot',
        error: '图表查询失败',
      } as AnalyticsPanelResult;
    }
  });
  return { asOfDate, range, results };
}
