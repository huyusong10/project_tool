import type { ComponentType, SVGProps } from "react";

type MetricIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: string | number }>;

/** KPI 指标卡：统一 stat-card 结构（图标 + 标签 + 值 + 明细）。 */
export function MetricCard({
  label,
  value,
  detail,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  detail?: string;
  tone: string;
  icon: MetricIcon;
}) {
  return (
    <article className={`stat-card stat-${tone}`}>
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
