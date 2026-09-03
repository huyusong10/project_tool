import chineseDays from 'chinese-days';

export const workdayCalendarCoverage = {
  fromYear: 2004,
  toYear: 2026,
  source: 'chinese-days@1.5.9',
} as const;

function yearOf(value: string) {
  return Number(value.slice(0, 4));
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

export function isBusinessDay(value: string) {
  if (!isWorkdayCalendarCovered(value)) return isWeekday(value);
  return chineseDays.isWorkday(value);
}

export function workdayCalendarWarning(from?: string | null, to?: string | null) {
  const values = [from, to].filter((value): value is string => Boolean(value));
  if (!values.some((value) => !isWorkdayCalendarCovered(value))) return null;
  return `法定节假日数据覆盖${workdayCalendarCoverage.fromYear}—${workdayCalendarCoverage.toYear}年，超出范围按周一至周五计算。`;
}
