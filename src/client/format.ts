/** 全站统一的日期/时间/字节/时长格式化。 */
export function formatDate(value: string | null | undefined, empty = "—"): string {
  if (!value) return empty;
  const plainDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (plainDate) {
    const [year, month, day] = plainDate.slice(1).map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day) {
      return `${year}/${month}/${day}`;
    }
    return value;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-CN");
}

export function formatDateTime(value: string | null | undefined, empty = "—"): string {
  if (!value) return empty;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

/** 紧凑时间：月-日 时:分，用于列表时间列。 */
export function formatShortDateTime(value: string | null | undefined, empty = ""): string {
  if (!value) return empty;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function relativeTime(value: string | null | undefined, empty = "尚未备份", now = Date.now()): string {
  if (!value) return empty;
  const difference = now - new Date(value).getTime();
  if (difference < 60_000) return "刚刚";
  if (difference < 3_600_000) return `${Math.floor(difference / 60_000)}分钟前`;
  if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)}小时前`;
  return `${Math.floor(difference / 86_400_000)}天前`;
}

export function formatBytes(bytes = 0): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatUptime(seconds = 0): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}天${hours}小时`;
  if (hours) return `${hours}小时${minutes}分钟`;
  return `${Math.max(1, minutes)}分钟`;
}
