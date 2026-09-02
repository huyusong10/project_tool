export const requirementStatuses = ['planning', 'not_started', 'in_progress', 'blocked', 'completed', 'cancelled'] as const;
export const workItemStatuses = ['not_started', 'in_progress', 'blocked', 'completed', 'cancelled'] as const;
export const riskLevels = ['low', 'medium', 'high'] as const;
export const priorities = ['P0', 'P1', 'P2', 'P3'] as const;

export type RequirementStatus = (typeof requirementStatuses)[number];
export type WorkItemStatus = (typeof workItemStatuses)[number];
export type RiskLevel = (typeof riskLevels)[number];
export type Priority = (typeof priorities)[number];

export const requirementStatusLabels: Record<RequirementStatus, string> = {
  planning: '待规划',
  not_started: '未开始',
  in_progress: '进行中',
  blocked: '阻塞',
  completed: '已完成',
  cancelled: '已取消',
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
  requirement: { status?: string; plannedStart?: string | null; plannedEnd?: string | null },
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
  const completedWeight = activeItems
    .filter((item) => item.derivedStatus === 'completed')
    .reduce((sum, item) => sum + workItemPlannedDuration(item), 0);
  const plannedWeight = activeItems
    .filter((item) => item.plannedEnd && item.plannedEnd <= today)
    .reduce((sum, item) => sum + workItemPlannedDuration(item), 0);
  const progress = totalWeight ? Math.round((completedWeight / totalWeight) * 100) : 0;
  const plannedProgress = totalWeight ? Math.round((plannedWeight / totalWeight) * 100) : 0;

  const actualEnds = activeItems.map((item) => item.actualEnd).filter((value): value is string => Boolean(value));
  const effectiveEnd = status === 'completed'
    ? actualEnds.sort().at(-1) || derivedPlannedEnd
    : derivedPlannedEnd && today > derivedPlannedEnd ? today : derivedPlannedEnd;
  const finishVariance = businessDayDelta(derivedPlannedEnd, effectiveEnd);
  const progressGap = Math.max(0, plannedProgress - progress);
  const riskLevel: RiskLevel = status === 'blocked' || finishVariance >= 3
    ? 'high'
    : finishVariance >= 1 || progressGap >= 20
      ? 'medium'
      : 'low';

  return {
    status,
    progress,
    plannedProgress,
    progressGap,
    riskLevel,
    highRisk: riskLevel === 'high',
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
