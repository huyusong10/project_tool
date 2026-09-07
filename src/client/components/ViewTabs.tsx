import type { ReactNode } from "react";

/** 视图切换：统一 .view-tabs 的写法；语义为切换按钮组（aria-pressed），非整页 tablist。 */
export function ViewTabs<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className = "",
}: {
  options: Array<{ value: T; label: ReactNode }>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div className={`view-tabs${className ? ` ${className}` : ""}`} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          aria-pressed={option.value === value}
          className={option.value === value ? "active" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
