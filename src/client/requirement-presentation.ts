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

export function requirementScheduleGaps(requirement: Requirement) {
  if (requirement.status === 'cancelled') return [];
  const items = requirement.executionMode === 'direct' ? [requirement] : requirement.workItems || [];
  return items.filter(item => item.status !== 'cancelled').flatMap(item => {
    const missing = [!item.plannedStart && '计划开始', !item.plannedEnd && '计划完成'].filter(Boolean) as string[];
    return missing.length ? [{id:item.id, title:item.title, missing}] : [];
  });
}

export function requirementScheduleSummary(requirement: Requirement) {
  const gaps = requirementScheduleGaps(requirement);
  return {
    gaps,
    label: gaps.length && requirement.executionMode !== 'direct' ? `${gaps.length} 项${requirement.status==='completed'?'缺计划':'待排期'}` : gaps.length&&requirement.status==='completed'?'未记录计划':requirementScheduleLabel(requirement),
    title: gaps.length ? gaps.map(item => `${item.title}：缺少${item.missing.join('、')}`).join('；') : '排期尚不完整，暂时无法计算计划偏差',
  };
}

export function requirementVarianceValue(requirement: Requirement): number | null {
  if (requirement.status === "planning" || requirement.status === "cancelled" || requirement.scheduleComplete === false || !requirement.plannedStart || !requirement.plannedEnd) return null;
  if (requirement.status === "completed") return requirement.effectiveEnd === null ? null : requirement.finishVariance;
  if (requirement.finishVariance > 0) return requirement.finishVariance;
  if (requirement.status === "not_started" && requirement.progress === 0 && requirement.plannedProgress === 0) return null;
  return requirement.scheduleVarianceDays ?? null;
}

export function requirementVarianceDisplay(requirement: Requirement): { label: string; className: string; title: string; detail?: string } {
  const progressDetail = `实际进度 ${requirement.progress}%，${requirement.plannedProgress === null ? '计划进度待确定' : `计划进度 ${requirement.plannedProgress}%`}`;
  if (requirement.status !== "cancelled" && (requirement.status === "planning" || requirement.scheduleComplete === false || !requirement.plannedStart || !requirement.plannedEnd)) {
    const schedule = requirementScheduleSummary(requirement);
    return { label: schedule.label, className: "muted", title: schedule.title };
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
    return { label: `进度落后 ${variance}个工作日`, className: "danger-text", title: `${progressDetail}${reference}，落后 ${variance} 个工作日`, detail: progressDetail + reference };
  }
  if (variance < 0) {
    return { label: `进度领先 ${Math.abs(variance)}个工作日`, className: "safe-text", title: `${progressDetail}${reference}，领先 ${Math.abs(variance)} 个工作日`, detail: progressDetail + reference };
  }
  return { label: "进度符合计划", className: "", title: `${progressDetail}；当前进展与计划曲线一致`, detail: progressDetail };
}

export function requirementDeliveryDate(r:Requirement){
  if(r.status==='completed')return {label:'工作完成',value:r.executionCompletedAt||r.actualEnd||'日期未记录',help:'以最后一个有效工作项的实际完成日期为准'};
  if(r.status==='cancelled')return {label:'已取消',value:'—',help:'保留原计划与执行记录'};
  return {label:'预计工作完成',value:r.executionForecastEnd||'待确认',help:'根据工作进度、工期和依赖估算'};
}
