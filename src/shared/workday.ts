import chineseDays from 'chinese-days';

export const workdayCalendarCoverage = {
  fromYear: 2004,
  toYear: 2026,
  source: 'chinese-days@1.5.9',
} as const;

function yearOf(value: string) {
  return Number(value.slice(0, 4));
}

export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function isWeekday(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

export function isWorkdayCalendarCovered(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return true;
  const year = yearOf(value);
  return year >= workdayCalendarCoverage.fromYear && year <= workdayCalendarCoverage.toYear;
}

export function hasWorkdayCalendarFallback(values: Array<string | null | undefined>) {
  return values.some((value) => isValidIsoDate(value) && !isWorkdayCalendarCovered(value));
}

export function isBusinessDay(value: string) {
  if (!isValidIsoDate(value)) return false;
  if (!isWorkdayCalendarCovered(value)) return isWeekday(value);
  return chineseDays.isWorkday(value);
}

const dayMilliseconds = 86_400_000;
// 每年最多366项；仅缓存节假日库覆盖的23年，不随用户查询范围增长。
const yearAdjustments = new Map<number, Int16Array>();

function weekdayCount(start: number, end: number) {
  const days = (end - start) / dayMilliseconds + 1;
  let count = Math.floor(days / 7) * 5;
  const firstWeekday = new Date(start).getUTCDay();
  for (let offset = 0; offset < days % 7; offset += 1) {
    const weekday = (firstWeekday + offset) % 7;
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}

function adjustmentsForYear(year: number) {
  const cached = yearAdjustments.get(year);
  if (cached) return cached;
  const first = Date.UTC(year, 0, 1);
  const days = (Date.UTC(year + 1, 0, 1) - first) / dayMilliseconds;
  const prefix = new Int16Array(days + 1);
  for (let index = 0; index < days; index += 1) {
    const date = new Date(first + index * dayMilliseconds);
    const weekday = date.getUTCDay();
    const adjustment = Number(isBusinessDay(date.toISOString().slice(0, 10))) - Number(weekday !== 0 && weekday !== 6);
    prefix[index + 1] = prefix[index] + adjustment;
  }
  yearAdjustments.set(year, prefix);
  return prefix;
}

export function countBusinessDays(start?: string | null, end?: string | null): number {
  if (!isValidIsoDate(start) || !isValidIsoDate(end)) return 0;
  if (start > end) return -countBusinessDays(end, start);
  const first = Date.parse(`${start}T00:00:00Z`);
  const last = Date.parse(`${end}T00:00:00Z`);
  let count = weekdayCount(first, last);
  const firstCoveredYear = Math.max(yearOf(start), workdayCalendarCoverage.fromYear);
  const lastCoveredYear = Math.min(yearOf(end), workdayCalendarCoverage.toYear);
  for (let year = firstCoveredYear; year <= lastCoveredYear; year += 1) {
    const yearStart = Date.UTC(year, 0, 1);
    const yearEnd = Date.UTC(year + 1, 0, 1) - dayMilliseconds;
    const from = (Math.max(first, yearStart) - yearStart) / dayMilliseconds;
    const to = (Math.min(last, yearEnd) - yearStart) / dayMilliseconds + 1;
    const adjustments = adjustmentsForYear(year);
    count += adjustments[to] - adjustments[from];
  }
  return count;
}
