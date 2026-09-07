import {
  accountStatusOptions,
  issueStatusOptions,
  priorityOptions,
  projectStatusOptions,
  requirementStatusOptions,
  riskOptions,
  workItemStatusOptions,
  type UiOption,
} from "../ui-options";

type StatusBadgeKind = "requirement" | "issue" | "priority" | "risk" | "account" | "workItem" | "project";

const optionLookup: Record<StatusBadgeKind, UiOption[]> = {
  requirement: requirementStatusOptions,
  issue: issueStatusOptions,
  priority: priorityOptions,
  risk: riskOptions,
  account: accountStatusOptions,
  workItem: workItemStatusOptions,
  project: projectStatusOptions,
};

/** 状态徽章统一入口：按域查找 label 与 toneClass，替代手拼 class。 */
export function StatusBadge({
  kind,
  value,
  short = false,
  className = "",
}: {
  kind: StatusBadgeKind;
  value: string;
  /** priority 域使用短标签（P0 而非 P0 · 紧急）。 */
  short?: boolean;
  className?: string;
}) {
  const option = optionLookup[kind].find((entry) => entry.value === value);
  const label = option
    ? (short && kind === "priority" ? option.value : option.label)
    : value;
  const toneClass = option?.toneClass || "status-pill";
  return <span className={`${toneClass}${className ? ` ${className}` : ""}`}>{label}</span>;
}
