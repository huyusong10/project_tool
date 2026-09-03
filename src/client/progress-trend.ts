import { businessDateFromDateTime } from "../shared/domain";
import type { ProgressUpdate } from "./types";

type ProgressSnapshot = Pick<ProgressUpdate, "id" | "percent" | "createdAt">;

export function dailyProgressTrend(updates: ProgressSnapshot[]) {
  const latestByDate = new Map<string, ProgressSnapshot>();
  for (const update of updates) {
    const date = businessDateFromDateTime(update.createdAt);
    const current = latestByDate.get(date);
    if (!current || update.createdAt > current.createdAt || (update.createdAt === current.createdAt && update.id > current.id)) {
      latestByDate.set(date, update);
    }
  }
  return [...latestByDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, update]) => ({ date, actualProgress: update.percent }));
}
