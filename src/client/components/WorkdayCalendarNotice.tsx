import { AlertTriangle } from "lucide-react";
import { hasWorkdayCalendarFallback, workdayCalendarCoverage } from "../../shared/workday";

export function WorkdayCalendarNotice({ values, className = "" }: {
  values: Array<string | null | undefined>;
  className?: string;
}) {
  if (!hasWorkdayCalendarFallback(values)) return null;
  return <p className={`workday-calendar-notice ${className}`.trim()} role="status">
    <AlertTriangle size={14} aria-hidden="true" />
    日期超出法定工作日日历 {workdayCalendarCoverage.fromYear}—{workdayCalendarCoverage.toYear} 年覆盖范围，将按周一至周五计算；节假日与调休可能不准确。
  </p>;
}
