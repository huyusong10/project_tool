import type { ComponentType, ReactNode, SVGProps } from "react";

type MetricIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: string | number }>;

/** KPI 指标卡：统一 stat-card 结构（图标 + 标签 + 值 + 明细）。 */
export function MetricCard({
  label,
  value,
  detail,
  tone,
  icon: Icon,
  onClick, selected, title,
}: {
  label: string;
  value: string | number;
  detail?: ReactNode;
  tone: string;
  icon: MetricIcon;
  onClick?: () => void;
  selected?: boolean;
  title?: string;
}) {
  return (
    <article className={`stat-card stat-${tone}${onClick ? ' stat-card-interactive' : ''}${selected ? ' is-selected' : ''}`}>
      {onClick && <button type="button" className="stat-card-select" aria-label={`${label} ${value} 项`} aria-pressed={selected} title={title} onClick={onClick} />}
      <div className="stat-icon">
        <Icon size={18} />
      </div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        {detail !== undefined && <span>{detail}</span>}
      </div>
    </article>
  );
}
