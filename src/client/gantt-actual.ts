import { calculateWorkItemGap } from "../shared/domain";
import { isValidIsoDate } from "../shared/workday";
import type { Requirement, WorkItem } from "./types";

const valid = (value?: string | null) => isValidIsoDate(value) ? value : null;
export function workItemActualRange(item: Pick<WorkItem, "status" | "actualStart" | "actualEnd" | "cancelledAt">, asOfDate: string) {
  const start = valid(item.actualStart);
  const terminal = ["completed", "cancelled"].includes(item.status);
  const end = item.status === "cancelled" ? valid(item.cancelledAt) : valid(item.actualEnd) || (!terminal && start ? valid(asOfDate) : null);
  return { start, end: start && end && end < start ? null : end, ongoing: !terminal && !item.actualEnd && Boolean(start) };
}

export function workItemDisplayGap(item: WorkItem, asOfDate: string) {
  const actual = workItemActualRange(item, asOfDate);
  // 仅供显示，复用工期公式；不修改后端风险与进度汇总。
  const gap = calculateWorkItemGap({ ...item, actualStart: actual.end ? actual.start : null, actualEnd: actual.end }, actual.end || asOfDate);
  return { ...gap, observedEnd: actual.end, actual };
}

export function requirementActualRange(requirement: Requirement, asOfDate: string) {
  if (requirement.actualStart !== undefined || requirement.actualEnd !== undefined) {
    return { start: valid(requirement.actualStart), end: valid(requirement.actualEnd) };
  }
  const ranges = requirement.workItems.map((item) => workItemActualRange(item, asOfDate));
  const start = ranges.map((range) => range.start).filter((date): date is string => Boolean(date)).sort()[0] || null;
  if (!["completed", "pending_acceptance", "cancelled"].includes(requirement.status)) return { start, end: start ? valid(asOfDate) : null };
  const end = ranges.map((range) => range.end).filter((date): date is string => Boolean(date)).sort().at(-1) || null;
  return { start, end };
}
