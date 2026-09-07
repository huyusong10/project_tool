import type { ReactNode } from "react";

/** 筛选工具条容器：统一 7 种一次性容器 class；结果计数与重置按钮作为标准尾部。 */
export function FilterBar({
  children,
  result,
  onReset,
  resetDisabled = false,
  resetLabel = "清除筛选",
  className = "",
}: {
  children: ReactNode;
  result?: ReactNode;
  onReset?: () => void;
  resetDisabled?: boolean;
  resetLabel?: string;
  className?: string;
}) {
  return (
    <div className={`filter-bar${className ? ` ${className}` : ""}`}>
      {children}
      {result !== undefined && result !== null && <span className="filter-bar-result">{result}</span>}
      {onReset && <button type="button" className="gantt-reset-button" disabled={resetDisabled} onClick={onReset}>{resetLabel}</button>}
    </div>
  );
}
