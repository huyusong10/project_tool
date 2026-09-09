import type { Requirement } from "./types";
import { isTerminalRequirementStatus, riskLabels, type RiskLevel } from "../shared/domain";

export function requirementRiskDisplay(requirement: Pick<Requirement, "status" | "riskEvaluated" | "riskLevel">) {
  const closed = isTerminalRequirementStatus(requirement.status);
  const evaluated = !closed && requirement.riskEvaluated;
  return { closed, evaluated, label: closed ? "风险已关闭" : evaluated ? riskLabels[requirement.riskLevel as RiskLevel] : "待评估", className: evaluated ? `risk-${requirement.riskLevel}` : "risk-pending" };
}

export function requirementVarianceValue(requirement: Requirement): number | null {
  if (requirement.status === "planning" || requirement.status === "cancelled" || requirement.scheduleComplete === false || !requirement.plannedStart || !requirement.plannedEnd) return null;
  if (["completed", "pending_acceptance"].includes(requirement.status)) return requirement.finishVariance;
  if (requirement.finishVariance > 0) return requirement.finishVariance;
  if (requirement.status === "not_started" && requirement.progress === 0 && requirement.plannedProgress === 0) return null;
  return requirement.scheduleVarianceDays ?? null;
}

export function requirementVarianceDisplay(requirement: Requirement) {
  const progressDetail = `实际进度 ${requirement.progress}%，计划进度 ${requirement.plannedProgress}%`;
  if (requirement.status !== "cancelled" && (requirement.status === "planning" || requirement.scheduleComplete === false || !requirement.plannedStart || !requirement.plannedEnd)) {
    return { label: "待排期", className: "muted", title: "工作项排期尚不完整，暂时无法计算计划偏差" };
  }
  if (requirement.status === "cancelled") {
    return { label: "已取消", className: "muted", title: "已取消需求不再计算计划偏差" };
  }
  if (requirement.status === "not_started" && requirement.progress === 0 && requirement.plannedProgress === 0) {
    return { label: "未到计划", className: "muted", title: "尚未到计划开始时间" };
  }
  if (["completed", "pending_acceptance"].includes(requirement.status)) {
    if (requirement.finishVariance > 0) {
      return { label: `延期 ${requirement.finishVariance}个工作日`, className: "danger-text", title: "实际完成日期晚于计划完成日期" };
    }
    if (requirement.finishVariance < 0) {
      return { label: `提前 ${Math.abs(requirement.finishVariance)}个工作日`, className: "safe-text", title: "实际完成日期早于计划完成日期" };
    }
    return { label: "按期", className: "", title: "实际完成日期与计划完成日期一致" };
  }
  if (requirement.finishVariance > 0) {
    return {
      label: `已延期 ${requirement.finishVariance}个工作日`,
      className: "danger-text",
      title: `${progressDetail}；截至今天已超过计划完成日期`,
    };
  }

  const variance = requirement.scheduleVarianceDays;
  const reference = requirement.scheduleReferenceDate ? `；当前进展相当于 ${requirement.scheduleReferenceDate} 的计划` : "";
  if (variance === null || variance === undefined) {
    return { label: "待评估", className: "muted", title: `${progressDetail}；暂时无法换算计划偏差` };
  }
  if (variance > 0) {
    return { label: `落后 ${variance}个工作日`, className: "danger-text", title: `${progressDetail}${reference}，落后 ${variance} 个工作日` };
  }
  if (variance < 0) {
    return { label: `领先 ${Math.abs(variance)}个工作日`, className: "safe-text", title: `${progressDetail}${reference}，领先 ${Math.abs(variance)} 个工作日` };
  }
  return { label: "按计划", className: "", title: `${progressDetail}；当前进展与计划曲线一致` };
}

