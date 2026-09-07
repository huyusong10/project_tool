import { businessDateFromDateTime } from "../shared/domain";
import type { ProgressUpdate } from "./types";

type ProgressSnapshot = Pick<ProgressUpdate, "id" | "percent" | "createdAt">;
type ProgressDisplaySnapshot = Pick<ProgressUpdate, "workItemId" | "workItemPercent" | "percent">;

export function progressUpdateDisplayValue(update: ProgressDisplaySnapshot) {
  return update.workItemId ? update.workItemPercent ?? null : update.percent;
}

/** 历史接口按时间和写入顺序倒序返回；同一时间保留先出现的最新快照。 */
export function dailyProgressTrend(updates: ProgressSnapshot[]) {
  const latestByDate = new Map<string, ProgressSnapshot>();
  for (const update of updates) {
    const date = businessDateFromDateTime(update.createdAt);
    const current = latestByDate.get(date);
    if (!current || update.createdAt > current.createdAt) {
      latestByDate.set(date, update);
    }
  }
  return [...latestByDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, update]) => ({ date, actualProgress: update.percent }));
}
