import {
  issueStatuses,
  issueStatusLabels,
  priorities,
  priorityLabels,
  requirementStatuses,
  requirementStatusLabels,
  riskLevels,
  riskLabels,
  type IssueStatus,
  type Priority,
  type RequirementStatus,
  type RiskLevel,
} from "../shared/domain";

export type UiOption<T extends string = string> = {
  value: T;
  label: string;
  description?: string;
  keywords?: string;
  toneClass?: string;
};

export const priorityOptions: UiOption<Priority>[] = priorities.map((value) => ({
  value,
  label: priorityLabels[value],
  keywords: `${value} ${priorityLabels[value]}`,
  toneClass: `priority-badge priority-${value.toLowerCase()}`,
}));

export const requirementStatusOptions: UiOption<RequirementStatus>[] = requirementStatuses.map((value) => ({
  value,
  label: requirementStatusLabels[value],
  toneClass: `status-pill status-${value}`,
}));

export const issueStatusOptions: UiOption<IssueStatus>[] = issueStatuses.map((value) => ({
  value,
  label: issueStatusLabels[value],
  toneClass: `issue-status issue-status-${value}`,
}));

export const riskOptions: UiOption<RiskLevel>[] = riskLevels.map((value) => ({
  value,
  label: riskLabels[value],
  toneClass: `risk-badge risk-${value}`,
}));

export const accountRoleLabels = {
  user: "普通用户",
  project_manager: "项目经理",
  admin: "管理员",
} as const;

export const accountRoleOptions: UiOption<keyof typeof accountRoleLabels>[] = Object.entries(accountRoleLabels).map(([value, label]) => ({
  value: value as keyof typeof accountRoleLabels,
  label,
}));

export const accountStatusOptions: UiOption<"active" | "disabled">[] = [
  { value: "active", label: "启用", toneClass: "account-status active" },
  { value: "disabled", label: "停用", toneClass: "account-status disabled" },
];
