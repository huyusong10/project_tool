export const requirementStatuses = ['planning', 'not_started', 'in_progress', 'blocked', 'completed', 'cancelled'] as const;
export const workItemStatuses = ['not_started', 'in_progress', 'blocked', 'completed', 'cancelled'] as const;
export const issueStatuses = ['open', 'in_progress', 'deferred', 'resolved'] as const;
export const riskLevels = ['low', 'medium', 'high'] as const;
export const priorities = ['P0', 'P1', 'P2', 'P3'] as const;
export const projectRoles = ['viewer', 'member', 'manager'] as const;

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
  completed: '已完成',
  cancelled: '已取消',
};

export const issueStatusLabels: Record<IssueStatus, string> = {
  open: '待处理',
  in_progress: '处理中',
  deferred: '暂缓',
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

function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isWeekday(date: Date): boolean {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

export function todayIso(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return formatter.format(new Date());
}

export function addCalendarDays(value: string, days: number): string {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

export function addBusinessDays(value: string, days: number): string {
  let cursor = parseIsoDate(value);
  const direction = days < 0 ? -1 : 1;
  while (!isWeekday(cursor)) cursor = parseIsoDate(addCalendarDays(isoDate(cursor), direction));
  let remaining = Math.abs(days);
  while (remaining > 0) {
    cursor = parseIsoDate(addCalendarDays(isoDate(cursor), direction));
    if (isWeekday(cursor)) remaining -= 1;
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
  if (!start || !end) return 0;
  let cursor = parseIsoDate(start);
  const target = parseIsoDate(end);
  if (cursor > target) return -businessDaysInclusive(end, start);
  let total = 0;
  while (cursor <= target) {
    if (isWeekday(cursor)) total += 1;
    cursor = parseIsoDate(addCalendarDays(isoDate(cursor), 1));
  }
  return total;
}

export function businessDayDelta(planned?: string | null, actual?: string | null): number {
  if (!planned || !actual || planned === actual) return 0;
  if (actual > planned) return Math.max(0, businessDaysInclusive(addCalendarDays(planned, 1), actual));
  return -Math.max(0, businessDaysInclusive(addCalendarDays(actual, 1), planned));
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

export function deriveWorkItemStatus(item: WorkItemLike): WorkItemStatus {
  if (item.status === 'cancelled') return 'cancelled';
  if (item.actualEnd) return 'completed';
  if (item.blockedAt || item.status === 'blocked') return 'blocked';
  if (item.actualStart) return 'in_progress';
  return 'not_started';
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
  requirement: { status?: string; priority?: string; plannedStart?: string | null; plannedEnd?: string | null },
  workItems: WorkItemLike[],
  today = todayIso(),
) {
  const items = workItems.map((item) => ({ ...item, derivedStatus: deriveWorkItemStatus(item) }));
  const activeItems = items.filter((item) => item.derivedStatus !== 'cancelled');
  const plannedEnds = activeItems.map((item) => item.plannedEnd).filter((value): value is string => Boolean(value));
  const derivedPlannedEnd = plannedEnds.sort().at(-1) || requirement.plannedEnd || null;
  let status: RequirementStatus;
  if (requirement.status === 'cancelled') status = 'cancelled';
  else if (!activeItems.length || !activeItems.some((item) => item.plannedStart && item.plannedEnd)) status = 'planning';
  else if (activeItems.some((item) => item.derivedStatus === 'blocked')) status = 'blocked';
  else if (activeItems.every((item) => item.derivedStatus === 'completed')) status = 'completed';
  else if (activeItems.some((item) => ['in_progress', 'completed'].includes(item.derivedStatus))) status = 'in_progress';
  else status = 'not_started';

  const totalWeight = activeItems.reduce((sum, item) => sum + workItemPlannedDuration(item), 0);
  const actualWeightedProgress = activeItems.reduce(
    (sum, item) => sum + workItemPlannedDuration(item) * workItemActualProgress(item), 0,
  );
  const plannedWeightedProgress = activeItems.reduce(
    (sum, item) => sum + workItemPlannedDuration(item) * workItemPlannedProgress(item, today), 0,
  );
  const progress = totalWeight ? Math.round(actualWeightedProgress / totalWeight) : 0;
  const plannedProgress = totalWeight ? Math.round(plannedWeightedProgress / totalWeight) : 0;

  const actualEnds = activeItems.map((item) => item.actualEnd).filter((value): value is string => Boolean(value));
  const effectiveEnd = status === 'completed'
    ? actualEnds.sort().at(-1) || derivedPlannedEnd
    : status === 'cancelled'
      ? derivedPlannedEnd
      : derivedPlannedEnd && today > derivedPlannedEnd ? today : derivedPlannedEnd;
  const finishVariance = businessDayDelta(derivedPlannedEnd, effectiveEnd);
  const progressGap = Math.max(0, plannedProgress - progress);
  const priority = priorities.includes(requirement.priority as Priority) ? requirement.priority as Priority : 'P2';
  const threshold = riskGapThresholds[priority];
  const gapRiskLevel = riskLevelFromProgressGap(priority, progressGap);
  const riskEvaluated = !['completed', 'cancelled', 'planning'].includes(status) && Boolean(derivedPlannedEnd);
  let riskLevel: RiskLevel = 'low';
  let riskReason: string;
  if (!riskEvaluated) {
    riskReason = status === 'completed'
      ? '需求已完成，不再计算当前风险'
      : status === 'cancelled'
        ? '需求已取消，不再计算当前风险'
        : '缺少完整排期，暂无法评估风险';
  } else if (status === 'blocked') {
    riskLevel = 'high';
    riskReason = '存在阻塞工作项，直接判定为高风险';
  } else if (finishVariance >= 3) {
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
