import type { DeliveryFields } from './delivery';
import { countBusinessDays, isBusinessDay, isValidIsoDate } from './workday';

export const requirementStatuses = ['not_started', 'in_progress', 'completed', 'cancelled'] as const;
export const workItemStatuses = ['not_started', 'in_progress', 'completed', 'cancelled'] as const;
export const issueStatuses = ['in_progress', 'deferred', 'resolved'] as const;
export const projectStatuses = ['planned', 'active', 'completed'] as const;
export const riskLevels = ['low', 'medium', 'high'] as const;
export const priorities = ['P0', 'P1', 'P2', 'P3'] as const;
export const projectRoles = ['viewer', 'member', 'manager'] as const;
export const maxTemplateItems = 200;
export const maxTemplateOffsetDays = 1830;
export const maxTemplateDurationDays = 1830;

export type RequirementStatus = (typeof requirementStatuses)[number];
export type WorkItemStatus = (typeof workItemStatuses)[number];
export type IssueStatus = (typeof issueStatuses)[number];
export type ProjectStatus = (typeof projectStatuses)[number];
export type RiskLevel = (typeof riskLevels)[number];
export type Priority = (typeof priorities)[number];
export type ProjectRole = (typeof projectRoles)[number];

export const requirementStatusLabels: Record<RequirementStatus, string> = {
  not_started: '未开始',
  in_progress: '进行中',
  completed: '已完成',
  cancelled: '已取消',
};

export const issueStatusLabels: Record<IssueStatus, string> = {
  in_progress: '处理中',
  deferred: '挂起',
  resolved: '已解决',
};

export const riskLabels: Record<RiskLevel, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
};

export const priorityLabels: Record<Priority, string> = {
  P0: 'P0 · 紧急',
  P1: 'P1 · 高',
  P2: 'P2 · 中',
  P3: 'P3 · 低',
};

export const riskGapThresholds: Record<Priority, { medium: number; high: number }> = {
  P0: { medium: 5, high: 20 },
  P1: { medium: 15, high: 40 },
  P2: { medium: 20, high: 50 },
  P3: { medium: 30, high: 60 },
};

export function riskLevelFromProgressGap(priority: Priority, progressGap: number): RiskLevel {
  const threshold = riskGapThresholds[priority];
  if (progressGap >= threshold.high) return 'high';
  if (progressGap >= threshold.medium) return 'medium';
  return 'low';
}

export function signedProgressVariance(actualProgress: number, plannedProgress: number | null): number | null {
  if (plannedProgress === null || !Number.isFinite(plannedProgress)) return null;
  const actual = Number.isFinite(actualProgress) ? Math.round(actualProgress) : 0;
  const planned = Math.round(plannedProgress);
  return actual - planned;
}

export function ganttProgressDisplay(status: string, progress: number): number | '—' {
  if (status === 'completed') return 100;
  if (status === 'cancelled') return '—';
  const value = Number.isFinite(progress) ? Math.round(progress) : 0;
  return Math.min(100, Math.max(0, value));
}

function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function businessDateFromDateTime(value: string | number | Date): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return formatter.format(new Date(value));
}

export function todayIso(): string {
  return businessDateFromDateTime(new Date());
}

export function addCalendarDays(value: string, days: number): string {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

export function startOfWeekIso(value: string): string {
  const day = parseIsoDate(value).getUTCDay();
  return addCalendarDays(value, -(day === 0 ? 6 : day - 1));
}

export function addBusinessDays(value: string, days: number): string {
  let cursor = parseIsoDate(value);
  const direction = days < 0 ? -1 : 1;
  while (!isBusinessDay(isoDate(cursor))) cursor.setUTCDate(cursor.getUTCDate() + direction);
  let remaining = Math.abs(days);
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + direction);
    if (isBusinessDay(isoDate(cursor))) remaining -= 1;
  }
  return isoDate(cursor);
}

export function plannedDatesFromOffset(baseStart: string, startOffsetDays: number, durationDays: number) {
  const plannedStart = addBusinessDays(baseStart, Math.max(0, Math.trunc(startOffsetDays)));
  const plannedEnd = addBusinessDays(plannedStart, Math.max(1, Math.trunc(durationDays)) - 1);
  return { plannedStart, plannedEnd };
}

export function plannedStartFromDeadline(deadline: string, items: Array<{ startOffsetDays: number; durationDays: number }>) {
  const latestEndOffset = Math.max(
    0,
    ...items.map((item) => Math.max(0, Math.trunc(item.startOffsetDays)) + Math.max(1, Math.trunc(item.durationDays)) - 1),
  );
  return addBusinessDays(deadline, -latestEndOffset);
}

export function businessDaysInclusive(start?: string | null, end?: string | null): number {
  return countBusinessDays(start, end);
}

export function businessDayDelta(planned?: string | null, actual?: string | null): number {
  if (!isValidIsoDate(planned) || !isValidIsoDate(actual) || planned === actual) return 0;
  if (actual > planned) return Math.max(0, businessDaysInclusive(addCalendarDays(planned, 1), actual));
  return -Math.max(0, businessDaysInclusive(addCalendarDays(actual, 1), planned));
}

export function rebaseBusinessDate(value: string, currentAnchor: string, targetAnchor: string) {
  return addBusinessDays(targetAnchor, businessDayDelta(currentAnchor, value));
}

export function isOverdueByWorkday(due?: string | null, asOf = todayIso()): boolean {
  return businessDayDelta(due, asOf) > 0;
}

export type WorkItemLike = {
  progressWeight?:number|null;
  durationDays?:number|null;
  status: string;
  progress?: number | null;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  forecastEnd?: string | null;
  blockedAt?: string | null;
};

export const terminalWorkItemStatuses: readonly WorkItemStatus[] = ['completed', 'cancelled'];
export const terminalRequirementStatuses: readonly RequirementStatus[] = ['completed', 'cancelled'];

export const workItemActionsByStatus = {
  not_started: ['start', 'cancel'],
  in_progress: ['progress', 'complete', 'cancel'],
  completed: ['reopen', 'correct'],
  cancelled: ['reopen', 'correct'],
} as const satisfies Record<WorkItemStatus, readonly string[]>;

export const requirementActionsByStatus = {
  not_started: ['edit', 'reschedule', 'reselect_template', 'cancel'],
  in_progress: ['edit', 'reschedule', 'cancel'],
  completed: ['rework', 'correct', 'archive'],
  cancelled: ['correct', 'archive'],
} as const satisfies Record<RequirementStatus, readonly string[]>;

export const issueActionsByStatus = {
  in_progress: ['note', 'progress', 'defer', 'resolve'],
  deferred: ['note', 'resume'],
  resolved: ['reopen', 'correct'],
} as const satisfies Record<IssueStatus, readonly string[]>;

export function isTerminalWorkItemStatus(status: string): boolean {
  return terminalWorkItemStatuses.includes(status as WorkItemStatus);
}

export function canDeleteWorkItem(item: WorkItemLike & { blockedReason?: string | null }, hasHistory: boolean): boolean {
  return item.status === 'not_started' && item.progress === 0 && !hasHistory
    && !item.actualStart && !item.actualEnd && !item.blockedAt && !item.blockedReason;
}

export function isTerminalRequirementStatus(status: string): boolean {
  return terminalRequirementStatuses.includes(status as RequirementStatus);
}

export function deriveWorkItemStatus(item: WorkItemLike): WorkItemStatus {
  return workItemStatuses.includes(item.status as WorkItemStatus) ? item.status as WorkItemStatus : 'not_started';
}

export function deriveRequirementScheduleRange(
  requirement: { plannedStart?: string | null; plannedEnd?: string | null },
  workItems: WorkItemLike[],
) {
  const activeItems = workItems.filter((item) => deriveWorkItemStatus(item) !== 'cancelled');
  if (!activeItems.length) {
    return {
      plannedStart: requirement.plannedStart || null,
      plannedEnd: requirement.plannedEnd || null,
      scheduleComplete: false,
    };
  }
  const plannedStarts = activeItems.map((item) => item.plannedStart).filter((value): value is string => Boolean(value));
  const plannedEnds = activeItems.map((item) => item.plannedEnd).filter((value): value is string => Boolean(value));
  return {
    plannedStart: plannedStarts.sort()[0] || null,
    plannedEnd: plannedEnds.sort().at(-1) || null,
    scheduleComplete: activeItems.every((item) => Boolean(item.plannedStart && item.plannedEnd)),
  };
}

export function workItemPlannedDuration(item: WorkItemLike): number {
  return Math.max(1, businessDaysInclusive(item.plannedStart, item.plannedEnd) || item.durationDays || 1);
}

/** Progress weights do not follow schedule stretching or remaining-time estimates. */
export function workItemProgressWeight(item: WorkItemLike): number {
  return Math.max(1, item.progressWeight ?? item.durationDays ?? workItemPlannedDuration(item));
}

/** Reuse recorded effort; changing calendar dates alone does not reweight a requirement. */
export function requirementProgressWeight(requirement: Pick<DeliveryFields,'executionMode'|'durationDays'>, workItems: WorkItemLike[]): number {
  if(requirement.executionMode==='direct')return Math.max(1,requirement.durationDays??1);
  return Math.max(1,workItems.filter(w=>deriveWorkItemStatus(w)!=='cancelled').reduce((sum,w)=>sum+workItemProgressWeight(w),0));
}

export function initialWorkEstimates(item: WorkItemLike) {
  const durationDays = item.durationDays ?? (businessDaysInclusive(item.plannedStart, item.plannedEnd) || null);
  return { durationDays, progressWeight: item.progressWeight ?? durationDays ?? 1 };
}

export function workItemPlannedProgress(item: WorkItemLike, today = todayIso()): number {
  if (!item.plannedStart || !item.plannedEnd || today < item.plannedStart) return 0;
  if (today >= item.plannedEnd) return 100;
  const elapsed = Math.max(0, businessDaysInclusive(item.plannedStart, today));
  return Math.min(100, Math.round((elapsed / workItemPlannedDuration(item)) * 100));
}

/** 未排齐有效执行项时没有可靠计划百分比；需求趋势和汇总使用同一权重及拆分基线。 */
export function requirementPlannedProgress(
  requirement: DeliveryFields & {status?: string; plannedStart?: string | null; plannedEnd?: string | null},
  workItems: WorkItemLike[],
  today = todayIso(),
): number | null {
  const direct = requirement.executionMode === 'direct';
  const items = (direct ? [{...requirement, status: requirement.status || 'not_started'}] : workItems)
    .filter(item => deriveWorkItemStatus(item) !== 'cancelled');
  if (!items.length || items.some(item => !item.plannedStart || !item.plannedEnd)) return null;
  const total = items.reduce((sum, item) => sum + workItemProgressWeight(item), 0);
  const planned = items.reduce((sum, item) => sum + workItemProgressWeight(item) * workItemPlannedProgress(item, today), 0) / total;
  const base = direct ? 0 : requirement.splitBaseProgress || 0;
  return Math.round(base + (100 - base) * planned / 100);
}

export function workItemActualProgress(item: WorkItemLike): number {
  if (deriveWorkItemStatus(item) === 'completed') return 100;
  const progress = Number(item.progress ?? 0);
  return Number.isFinite(progress) ? Math.min(100, Math.max(0, Math.round(progress))) : 0;
}

type WeightedWorkItem = WorkItemLike & { plannedDuration: number; progressWeight: number };

function plannedProgressWithDuration(item: WeightedWorkItem, today: string) {
  if (!item.plannedStart || !item.plannedEnd || today < item.plannedStart) return 0;
  if (today >= item.plannedEnd) return 100;
  const elapsed = Math.max(0, businessDaysInclusive(item.plannedStart, today));
  return Math.min(100, Math.round((elapsed / item.plannedDuration) * 100));
}

function scheduleVarianceFromProgress(items: WeightedWorkItem[], actualProgress: number, today: string) {
  if (!items.length || items.some((item) => !item.plannedStart || !item.plannedEnd)) return null;
  const totalWeight = items.reduce((sum, item) => sum + item.progressWeight, 0);
  if (!totalWeight) return null;

  const plannedStarts = items.map((item) => item.plannedStart as string).sort();
  const plannedEnds = items.map((item) => item.plannedEnd as string).sort();
  const plannedStart = plannedStarts[0];
  const plannedEnd = plannedEnds.at(-1) as string;
  const plannedProgressAt = (date: string) => Math.round(items.reduce(
    (sum, item) => sum + item.progressWeight * plannedProgressWithDuration(item, date),
    0,
  ) / totalWeight);
  const actual = Math.min(100, Math.max(0, Math.round(actualProgress)));
  const plannedToday = plannedProgressAt(today);
  let referenceDate = today;

  if (actual < plannedToday) {
    referenceDate = addBusinessDays(plannedStart, -1);
    const searchEnd = today < plannedEnd ? today : plannedEnd;
    for (let cursor = plannedStart; cursor <= searchEnd; cursor = addCalendarDays(cursor, 1)) {
      if (!isBusinessDay(cursor)) continue;
      if (plannedProgressAt(cursor) > actual) break;
      referenceDate = cursor;
    }
  } else if (actual > plannedToday) {
    referenceDate = plannedEnd;
    for (let cursor = today; cursor <= plannedEnd; cursor = addCalendarDays(cursor, 1)) {
      if (!isBusinessDay(cursor)) continue;
      if (plannedProgressAt(cursor) >= actual) {
        referenceDate = cursor;
        break;
      }
    }
  }

  return {
    referenceDate,
    varianceDays: businessDayDelta(referenceDate, today),
  };
}

export function calculateWorkItemGap(item: WorkItemLike, today = todayIso()) {
  const observedEnd = item.actualEnd || (!isTerminalWorkItemStatus(item.status) && item.actualStart ? today : null);
  const planDuration = businessDaysInclusive(item.plannedStart, item.plannedEnd);
  const actualDuration = businessDaysInclusive(item.actualStart, observedEnd);
  return {
    observedEnd,
    effectiveEnd: observedEnd,
    planDuration,
    actualDuration,
    finishVariance: businessDayDelta(item.plannedEnd, observedEnd),
    durationVariance: actualDuration && planDuration ? actualDuration - planDuration : 0,
  };
}

export function deriveRequirementMetrics(
  requirement: DeliveryFields & {
    status?: string; priority?: string; plannedStart?: string | null; plannedEnd?: string | null;
    acceptedAt?: string | null; ownerId?: string | null;
  },
  workItems: WorkItemLike[],
  today = todayIso(),
  highRiskDelayDays = 3,
) {
  const direct = requirement.executionMode === 'direct';
  const executionItems: WorkItemLike[] = direct ? [{...requirement,status:requirement.status||'not_started',progress:requirement.progress||0}] : workItems;
  const items = executionItems.map((item) => ({
    ...item,
    derivedStatus: deriveWorkItemStatus(item),
    plannedDuration: workItemPlannedDuration(item),
    progressWeight: workItemProgressWeight(item),
  }));
  const activeItems = items.filter((item) => item.derivedStatus !== 'cancelled');
  const schedule = deriveRequirementScheduleRange(requirement, activeItems);
  if(requirement.splitAt){schedule.plannedStart=requirement.plannedStart||schedule.plannedStart;schedule.plannedEnd=requirement.plannedEnd||schedule.plannedEnd;}
  const derivedPlannedStart = schedule.plannedStart;
  const derivedPlannedEnd = schedule.plannedEnd;
  let status: RequirementStatus;
  if (requirement.status === 'cancelled') status = 'cancelled';
  else if(direct) status = requirementStatuses.includes(requirement.status as RequirementStatus) ? requirement.status as RequirementStatus : 'not_started';
  else if (activeItems.length && activeItems.every((item) => item.derivedStatus === 'completed')) status = 'completed';
  else if (activeItems.some((item) => ['in_progress', 'completed'].includes(item.derivedStatus))) status = 'in_progress';
  else if (requirement.status === 'in_progress') status = 'in_progress';
  else status = 'not_started';

  const totalWeight = activeItems.reduce((sum, item) => sum + item.progressWeight, 0);
  const actualWeightedProgress = activeItems.reduce(
    (sum, item) => sum + item.progressWeight * workItemActualProgress(item), 0,
  );
  const base=direct?0:requirement.splitBaseProgress||0;
  const remainingProgress=totalWeight ? actualWeightedProgress / totalWeight : 0;
  const progress = direct ? requirement.progress||0 : Math.min(status==='completed'?100:99,Math.round(base+(100-base)*remainingProgress/100));
  const plannedProgress = requirementPlannedProgress(requirement, workItems, today);
  const scheduleVariance = scheduleVarianceFromProgress(activeItems, base?remainingProgress:progress, today);

  const actualEnds = activeItems.map((item) => item.actualEnd).filter((value): value is string => Boolean(value));
  // Execution delay stops at the last work completion; accepting later does not extend it.
  const effectiveEnd = status==='completed' ? actualEnds.length===activeItems.length ? actualEnds.sort().at(-1)||null : null
    : !schedule.scheduleComplete ? null : status === 'cancelled'
      ? derivedPlannedEnd
      : derivedPlannedEnd && today > derivedPlannedEnd ? today : derivedPlannedEnd;
  const finishVariance = schedule.scheduleComplete ? businessDayDelta(derivedPlannedEnd, effectiveEnd) : 0;
  const progressGap = plannedProgress === null ? 0 : Math.max(0, plannedProgress - progress);
  const priority: Priority = 'P2';
  const threshold = riskGapThresholds[priority];
  const gapRiskLevel = riskLevelFromProgressGap(priority, progressGap);
  const riskEvaluated = !['completed','cancelled'].includes(status) && schedule.scheduleComplete&&Boolean(derivedPlannedEnd);
  let riskLevel: RiskLevel = 'low';
  let riskReason: string;
  if (!riskEvaluated) {
    riskReason = status === 'completed'
      ? '需求已完成，不再计算当前风险'
      : status === 'cancelled'
        ? '需求已取消，不再计算当前风险'
        : '缺少完整排期，暂无法评估风险';
  } else if (finishVariance >= highRiskDelayDays) {
    riskLevel = 'high';
    riskReason = `已延期${finishVariance}个工作日，直接判定为高风险`;
  } else if (gapRiskLevel === 'high') {
    riskLevel = 'high';
    riskReason = `进度Gap ${progressGap}% ≥ 高风险阈值${threshold.high}%`;
  } else if (finishVariance >= 1) {
    riskLevel = 'medium';
    riskReason = `已延期${finishVariance}个工作日，至少判定为中风险`;
  } else if (gapRiskLevel === 'medium') {
    riskLevel = 'medium';
    riskReason = `进度Gap ${progressGap}% ≥ 中风险阈值${threshold.medium}%`;
  } else {
    riskReason = `进度Gap ${progressGap}% < 中风险阈值${threshold.medium}%`;
  }

  return {
    status,
    progress,
    plannedProgress,
    progressGap,
    plannedStart: derivedPlannedStart,
    plannedEnd: derivedPlannedEnd,
    scheduleComplete: schedule.scheduleComplete,
    scheduleVarianceDays: scheduleVariance?.varianceDays ?? null,
    scheduleReferenceDate: scheduleVariance?.referenceDate ?? null,
    riskLevel,
    riskEvaluated,
    riskReason,
    highRisk: riskEvaluated && riskLevel === 'high',
    effectiveEnd,
    finishVariance,
    delayed: finishVariance > 0,
  };
}

export function isRequirementDelayed(
  requirement: { status: string; plannedEnd?: string | null },
  workItems: WorkItemLike[],
  today = todayIso(),
) {
  const metrics = deriveRequirementMetrics(requirement, workItems, today);
  return { effectiveEnd: metrics.effectiveEnd, variance: metrics.finishVariance, delayed: metrics.delayed };
}

export function isHighRisk(
  requirement: { status: string; riskLevel?: string; plannedEnd?: string | null },
  workItems: WorkItemLike[],
  threshold = 3,
  today = todayIso(),
) {
  const metrics = deriveRequirementMetrics(requirement, workItems, today);
  return metrics.finishVariance >= threshold;
}
