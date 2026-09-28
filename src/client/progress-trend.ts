import { businessDateFromDateTime } from "../shared/domain";
import type { ProgressUpdate } from "./types";
import { formatDateTime } from './format';

const progressEventLabels: Record<string,string> = {note:'说明',progress:'进展',start:'开始',block:'阻塞',unblock:'解阻',complete:'完成',reopen:'返工',correction:'纠错',accept:'验收',cancel:'取消'};
export const progressReferenceLabel = (update?:ProgressUpdate) => update ? `${formatDateTime(update.createdAt)} · ${progressEventLabels[update.eventType]||update.eventType}` : '原记录不可用';

type ProgressSnapshot = Pick<ProgressUpdate, "id" | "percent" | "createdAt">;
type ProgressDisplaySnapshot = Pick<ProgressUpdate, "workItemId" | "workItemPercent" | "percent">;

export type ProgressHistoryMetadata = {
  transitionLabel: string;
  transitionTitle: string;
  elapsedLabel: string;
};

export function progressUpdateDisplayValue(update: ProgressDisplaySnapshot) {
  return update.workItemId ? update.workItemPercent ?? null : update.percent;
}

function elapsedTimeLabel(previousAt: string, currentAt: string) {
  const difference = new Date(currentAt).getTime() - new Date(previousAt).getTime();
  if (!Number.isFinite(difference) || difference < 0) return "未知";
  const minutes = Math.floor(difference / 60_000);
  if (minutes < 1) return "不足1分钟";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainingMinutes = minutes % 60;
  const duration = days
    ? `${days}天${hours ? `${hours}小时` : ""}`
    : hours
      ? `${hours}小时${remainingMinutes ? `${remainingMinutes}分钟` : ""}`
      : `${remainingMinutes}分钟`;
  return duration;
}

/** 进展接口按时间倒序返回；百分比按工作项分别衔接，间隔也只比较同一工作项或需求本身。 */
export function progressHistoryMetadata(updates: ProgressUpdate[]) {
  const result = new Map<string, ProgressHistoryMetadata>();
  const previousAt = new Map<string, string>();
  const previousValue = new Map<string, number>();
  for (const update of [...updates].reverse()) {
    const context = update.workItemId ? `work-item:${update.workItemId}` : "requirement";
    const currentValue = update.eventType === 'note' ? null : progressUpdateDisplayValue(update);
    const oldValue = previousValue.get(context);
    const transitionLabel = currentValue === null
      ? update.eventType === 'note' ? "说明" : "—"
      : oldValue === undefined
        ? `首次 · ${currentValue}%`
        : `${oldValue} → ${currentValue}%`;
    result.set(update.id, {
      transitionLabel,
      transitionTitle: currentValue === null
        ? "本次只记录说明，完成度没有变化"
        : oldValue === undefined
          ? `首次完成度记录：${currentValue}%`
          : `完成度从 ${oldValue}% 变为 ${currentValue}%`,
      elapsedLabel: previousAt.has(context) ? elapsedTimeLabel(previousAt.get(context)!, update.createdAt) : "首次记录",
    });
    previousAt.set(context, update.createdAt);
    if (currentValue !== null) previousValue.set(context, currentValue);
  }
  return result;
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
