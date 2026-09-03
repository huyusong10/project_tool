import { isBusinessDay, isValidIsoDate } from './workday';

export const requirementStatuses = ['planning', 'not_started', 'in_progress', 'blocked', 'pending_acceptance', 'completed', 'cancelled'] as const;
export const workItemStatuses = ['not_started', 'in_progress', 'blocked', 'completed', 'cancelled'] as const;
export const issueStatuses = ['in_progress', 'deferred', 'resolved'] as const;
export const riskLevels = ['low', 'medium', 'high'] as const;
export const priorities = ['P0', 'P1', 'P2', 'P3'] as const;
export const projectRoles = ['viewer', 'member', 'manager'] as const;
export const maxTemplateItems = 200;
export const maxTemplateOffsetDays = 1830;
export const maxTemplateDurationDays = 1830;

export type RequirementStatus = (typeof requirementStatuses)[number];
export type WorkItemStatus = (typeof workItemStatuses)[number];
export type IssueStatus = (typeof issueStatuses)[number];
export type RiskLevel = (typeof riskLevels)[number];
export type Priority = (typeof priorities)[number];
export type ProjectRole = (typeof projectRoles)[number];

export const requirementStatusLabels: Record<RequirementStatus, string> = {
  planning: '待规划',
  not_started: '未开始',
  in_progress: '进行中',
  blocked: '阻塞',
  pending_acceptance: '待验收',
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

export function signedProgressVariance(actualProgress: number, plannedProgress: number): number {
  const actual = Number.isFinite(actualProgress) ? Math.round(actualProgress) : 0;
  const planned = Number.isFinite(plannedProgress) ? Math.round(plannedProgress) : 0;
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
  if (!isValidIsoDate(start) || !isValidIsoDate(end)) return 0;
  let cursor = parseIsoDate(start);
  const target = parseIsoDate(end);
  if (cursor > target) return -businessDaysInclusive(end, start);
  let total = 0;
  while (cursor <= target) {
    if (isBusinessDay(isoDate(cursor))) total += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return total;
}

export function businessDayDelta(planned?: string | null, actual?: string | null): number {
  if (!isValidIsoDate(planned) || !isValidIsoDate(actual) || planned === actual) return 0;
  if (actual > planned) return Math.max(0, businessDaysInclusive(addCalendarDays(planned, 1), actual));
  return -Math.max(0, businessDaysInclusive(addCalendarDays(actual, 1), planned));
}

export function isOverdueByWorkday(due?: string | null, asOf = todayIso()): boolean {
  return businessDayDelta(due, asOf) > 0;
}

export type WorkItemLike = {
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
  in_progress: ['progress', 'block', 'complete', 'cancel'],
  blocked: ['note', 'unblock', 'cancel'],
  completed: ['reopen', 'correct'],
  cancelled: ['reopen', 'correct'],
} as const satisfies Record<WorkItemStatus, readonly string[]>;

export const requirementActionsByStatus = {
  planning: ['edit', 'reschedule', 'reselect_template', 'cancel'],
  not_started: ['edit', 'reschedule', 'reselect_template', 'cancel'],
  in_progress: ['edit', 'reschedule', 'cancel'],
  blocked: ['edit', 'reschedule', 'cancel'],
  pending_acceptance: ['accept', 'rework', 'cancel'],
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

export function isTerminalRequirementStatus(status: string): boolean {
  return terminalRequirementStatuses.includes(status as RequirementStatus);
}

export function deriveWorkItemStatus(item: WorkItemLike): WorkItemStatus {
  return workItemStatuses.includes(item.status as WorkItemStatus) ? item.status as WorkItemStatus : 'not_started';
}

export function workItemPlannedDuration(item: WorkItemLike): number {
  return Math.max(1, businessDaysInclusive(item.plannedStart, item.plannedEnd) || 1);
}

export function workItemPlannedProgress(item: WorkItemLike, today = todayIso()): number {
  if (!item.plannedStart || !item.plannedEnd || today < item.plannedStart) return 0;
  if (today >= item.plannedEnd) return 100;
  const elapsed = Math.max(0, businessDaysInclusive(item.plannedStart, today));
  return Math.min(100, Math.round((elapsed / workItemPlannedDuration(item)) * 100));
}

export function workItemActualProgress(item: WorkItemLike): number {
  if (deriveWorkItemStatus(item) === 'completed') return 100;
  const progress = Number(item.progress ?? 0);
  return Number.isFinite(progress) ? Math.min(100, Math.max(0, Math.round(progress))) : 0;
}

type WeightedWorkItem = WorkItemLike & { plannedDuration: number };

function plannedProgressWithDuration(item: WeightedWorkItem, today: string) {
  if (!item.plannedStart || !item.plannedEnd || today < item.plannedStart) return 0;
  if (today >= item.plannedEnd) return 100;
  const elapsed = Math.max(0, businessDaysInclusive(item.plannedStart, today));
  return Math.min(100, Math.round((elapsed / item.plannedDuration) * 100));
}

function scheduleVarianceFromProgress(items: WeightedWorkItem[], actualProgress: number, today: string) {
  if (!items.length || items.some((item) => !item.plannedStart || !item.plannedEnd)) return null;
  const totalWeight = items.reduce((sum, item) => sum + item.plannedDuration, 0);
  if (!totalWeight) return null;

  const plannedStarts = items.map((item) => item.plannedStart as string).sort();
  const plannedEnds = items.map((item) => item.plannedEnd as string).sort();
  const plannedStart = plannedStarts[0];
  const plannedEnd = plannedEnds.at(-1) as string;
  const plannedProgressAt = (date: string) => Math.round(items.reduce(
    (sum, item) => sum + item.plannedDuration * plannedProgressWithDuration(item, date),
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
  const observedEnd = item.actualEnd || (item.actualStart ? today : null);
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
  requirement: {
    status?: string; priority?: string; plannedStart?: string | null; plannedEnd?: string | null;
    acceptedAt?: string | null; ownerId?: string | null;
  },
  workItems: WorkItemLike[],
  today = todayIso(),
  highRiskDelayDays = 3,
) {
  const items = workItems.map((item) => ({
    ...item,
    derivedStatus: deriveWorkItemStatus(item),
    plannedDuration: workItemPlannedDuration(item),
  }));
  const activeItems = items.filter((item) => item.derivedStatus !== 'cancelled');
  const plannedEnds = activeItems.map((item) => item.plannedEnd).filter((value): value is string => Boolean(value));
  const derivedPlannedEnd = plannedEnds.sort().at(-1) || requirement.plannedEnd || null;
  let status: RequirementStatus;
  if (requirement.status === 'cancelled') status = 'cancelled';
  else if (requirement.acceptedAt && activeItems.length && activeItems.every((item) => item.derivedStatus === 'completed')) status = 'completed';
  else if (activeItems.length && activeItems.every((item) => item.derivedStatus === 'completed')) status = 'pending_acceptance';
  else if (activeItems.some((item) => item.derivedStatus === 'blocked')) status = 'blocked';
  else if (activeItems.some((item) => ['in_progress', 'completed'].includes(item.derivedStatus))) status = 'in_progress';
  else if (requirement.status === 'in_progress' || requirement.status === 'blocked') status = requirement.status;
  else if (!requirement.ownerId || !activeItems.length || activeItems.some((item) => !item.plannedStart || !item.plannedEnd)) status = 'planning';
  else status = 'not_started';

  const totalWeight = activeItems.reduce((sum, item) => sum + item.plannedDuration, 0);
  const actualWeightedProgress = activeItems.reduce(
    (sum, item) => sum + item.plannedDuration * workItemActualProgress(item), 0,
  );
  const plannedWeightedProgress = activeItems.reduce(
    (sum, item) => sum + item.plannedDuration * plannedProgressWithDuration(item, today), 0,
  );
  const progress = totalWeight ? Math.round(actualWeightedProgress / totalWeight) : 0;
  const plannedProgress = totalWeight ? Math.round(plannedWeightedProgress / totalWeight) : 0;
  const scheduleVariance = scheduleVarianceFromProgress(activeItems, progress, today);

  const actualEnds = activeItems.map((item) => item.actualEnd).filter((value): value is string => Boolean(value));
  const effectiveEnd = ['completed', 'pending_acceptance'].includes(status)
    ? actualEnds.sort().at(-1) || derivedPlannedEnd
    : status === 'cancelled'
      ? derivedPlannedEnd
      : derivedPlannedEnd && today > derivedPlannedEnd ? today : derivedPlannedEnd;
  const finishVariance = businessDayDelta(derivedPlannedEnd, effectiveEnd);
  const progressGap = Math.max(0, plannedProgress - progress);
  const priority = priorities.includes(requirement.priority as Priority) ? requirement.priority as Priority : 'P2';
  const threshold = riskGapThresholds[priority];
  const gapRiskLevel = riskLevelFromProgressGap(priority, progressGap);
  const riskEvaluated = !['completed', 'pending_acceptance', 'cancelled', 'planning'].includes(status) && Boolean(derivedPlannedEnd);
  let riskLevel: RiskLevel = 'low';
  let riskReason: string;
  if (!riskEvaluated) {
    riskReason = status === 'completed'
      ? '需求已完成，不再计算当前风险'
      : status === 'pending_acceptance'
        ? '工作项已全部完成，等待验收'
      : status === 'cancelled'
        ? '需求已取消，不再计算当前风险'
        : '缺少完整排期，暂无法评估风险';
  } else if (status === 'blocked') {
    riskLevel = 'high';
    riskReason = '存在阻塞工作项，直接判定为高风险';
  } else if (finishVariance >= highRiskDelayDays) {
    riskLevel = 'high';
    riskReason = `已延期${finishVariance}个工作日，直接判定为高风险`;
  } else if (gapRiskLevel === 'high') {
    riskLevel = 'high';
    riskReason = `${priority}进度Gap ${progressGap}% ≥ 高风险阈值${threshold.high}%`;
  } else if (finishVariance >= 1) {
    riskLevel = 'medium';
    riskReason = `已延期${finishVariance}个工作日，至少判定为中风险`;
  } else if (gapRiskLevel === 'medium') {
    riskLevel = 'medium';
    riskReason = `${priority}进度Gap ${progressGap}% ≥ 中风险阈值${threshold.medium}%`;
  } else {
    riskReason = `${priority}进度Gap ${progressGap}% < 中风险阈值${threshold.medium}%`;
  }

  return {
    status,
    progress,
    plannedProgress,
    progressGap,
    scheduleVarianceDays: scheduleVariance?.varianceDays ?? null,
    scheduleReferenceDate: scheduleVariance?.referenceDate ?? null,
    riskLevel,
    riskEvaluated,
    riskReason,
    highRisk: riskEvaluated && riskLevel === 'high',
    plannedEnd: derivedPlannedEnd,
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
  return metrics.status === 'blocked' || metrics.finishVariance >= threshold;
}
