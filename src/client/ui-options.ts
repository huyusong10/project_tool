import {
  issueStatuses,
  issueStatusLabels,
  projectStatuses,
  priorities,
  priorityLabels,
  requirementStatuses,
  requirementStatusLabels,
  riskLevels,
  riskLabels,
  workItemStatuses,
  type IssueStatus,
  type Priority,
  type RequirementStatus,
  type RiskLevel,
  type WorkItemStatus,
} from "../shared/domain";

export type UiOption<T extends string = string> = {
  value: T;
  label: string;
  description?: string;
  keywords?: string;
  toneClass?: string;
  disabled?: boolean;
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

const workItemStatusLabels: Record<WorkItemStatus, string> = {
  not_started: "未开始",
  in_progress: "进行中",
  blocked: "阻塞",
  completed: "已完成",
  cancelled: "已取消",
};

export const workItemStatusOptions: UiOption<WorkItemStatus>[] = workItemStatuses.map((value) => ({
  value,
  label: workItemStatusLabels[value],
  toneClass: `work-item-status-badge badge-${value.replaceAll("_", "-")}`,
}));

const projectStatusLabels: Record<(typeof projectStatuses)[number], string> = {
  planned: "规划中",
  active: "进行中",
  completed: "已完成",
};

export const projectStatusOptions: UiOption<(typeof projectStatuses)[number]>[] = projectStatuses.map((value) => ({
  value,
  label: projectStatusLabels[value],
  toneClass: `status-pill status-${value}`,
}));

export const accountRoleLabels = {
  user: "普通用户",
  project_manager: "项目经理",
  admin: "管理员",
} as const;

export const accountRoleOptions: UiOption<"user" | "admin">[] = [
  { value: "user", label: accountRoleLabels.user },
  { value: "admin", label: accountRoleLabels.admin },
];

export const accountStatusOptions: UiOption<"active" | "disabled">[] = [
  { value: "active", label: "允许登录", toneClass: "account-status active" },
  { value: "disabled", label: "禁止登录", toneClass: "account-status disabled" },
];
