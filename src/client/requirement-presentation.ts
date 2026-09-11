import type { Requirement } from "./types";
import { isTerminalRequirementStatus, riskLabels, type RiskLevel } from "../shared/domain";

export function requirementRiskDisplay(requirement: Pick<Requirement, "status" | "riskEvaluated" | "riskLevel">) {
  const closed = isTerminalRequirementStatus(requirement.status);
  const evaluated = !closed && requirement.riskEvaluated;
  return { closed, evaluated, label: closed ? "风险已关闭" : evaluated ? riskLabels[requirement.riskLevel as RiskLevel] : "待评估", className: evaluated ? `risk-${requirement.riskLevel}` : "risk-pending" };
}

export function requirementScheduleLabel(requirement: Pick<Requirement, 'plannedStart' | 'plannedEnd'>) {
  return requirement.plannedStart || requirement.plannedEnd ? '排期不完整' : '未排期';
}

export function requirementVarianceValue(requirement: Requirement): number | null {
  if (requirement.status === "planning" || requirement.status === "cancelled" || requirement.scheduleComplete === false || !requirement.plannedStart || !requirement.plannedEnd) return null;
  if (requirement.status === "completed") return requirement.effectiveEnd === null ? null : requirement.finishVariance;
  if (requirement.finishVariance > 0) return requirement.finishVariance;
  if (requirement.status === "not_started" && requirement.progress === 0 && requirement.plannedProgress === 0) return null;
  return requirement.scheduleVarianceDays ?? null;
}

export function requirementVarianceDisplay(requirement: Requirement) {
  const progressDetail = `实际进度 ${requirement.progress}%，${requirement.plannedProgress === null ? '计划进度待确定' : `计划进度 ${requirement.plannedProgress}%`}`;
  if (requirement.status !== "cancelled" && (requirement.status === "planning" || requirement.scheduleComplete === false || !requirement.plannedStart || !requirement.plannedEnd)) {
    return { label: requirementScheduleLabel(requirement), className: "muted", title: `${requirement.executionMode === 'direct' ? '需求' : '工作项'}排期尚不完整，暂时无法计算计划偏差` };
  }
  if (requirement.status === "cancelled") {
    return { label: "已取消", className: "muted", title: "已取消需求不再计算计划偏差" };
  }
  if (requirement.status === "not_started" && requirement.progress === 0 && requirement.plannedProgress === 0) {
    return { label: "未到计划", className: "muted", title: "尚未到计划开始时间" };
  }
  if (requirement.status === "completed") {
    if (requirement.effectiveEnd === null) return { label: "完成日期缺失", className: "muted", title: "请补录实际完成日期后再计算偏差" };
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

export function requirementDeliveryDate(r:Requirement){
  if(r.status==='completed')return {label:'工作完成',value:r.executionCompletedAt||r.actualEnd||'日期未记录',help:'以最后一个有效工作项的实际完成日期为准'};
  if(r.status==='cancelled')return {label:'已取消',value:'—',help:'保留原计划与执行记录'};
  return {label:'预计工作完成',value:r.executionForecastEnd||'待确认',help:'根据工作进度、工期和依赖估算'};
}
