import { requirementStatusLabels, requirementStatuses, workItemStatuses } from "./domain";

export const analyticsVisualizations = ["kpi", "bar", "line", "donut", "table"] as const;
export const analyticsPanelSizes = ["small", "medium", "large"] as const;
export const analyticsTimeScopes = ["snapshot", "range", "future30"] as const;
export const analyticsSorts = ["asc", "desc"] as const;

export type AnalyticsVisualization = typeof analyticsVisualizations[number];
export type AnalyticsPanelSize = typeof analyticsPanelSizes[number];
export type AnalyticsTimeScope = typeof analyticsTimeScopes[number];
export type AnalyticsSort = typeof analyticsSorts[number];

export type AnalyticsPanelConfig = {
  id: string;
  title: string;
  dataset: string;
  measure: string;
  secondaryMeasure?: string;
  dimension?: string;
  visualization: AnalyticsVisualization;
  size: AnalyticsPanelSize;
  timeScope: AnalyticsTimeScope;
  filters?: Record<string, string[]>;
  sort?: AnalyticsSort;
  limit?: number;
};

export type AnalyticsLayout = {
  version: 1;
  panels: AnalyticsPanelConfig[];
};

export type AnalyticsCatalogOption = { value: string; label: string };
export type AnalyticsCatalogMeasure = {
  id: string;
  label: string;
  unit: "count" | "percent" | "days";
  dimensions: string[];
  visualizations: AnalyticsVisualization[];
};
export type AnalyticsCatalogDimension = { id: string; label: string };
export type AnalyticsCatalogFilter = { id: string; label: string; options: AnalyticsCatalogOption[] };
export type AnalyticsCatalogDataset = {
  id: string;
  label: string;
  measures: AnalyticsCatalogMeasure[];
  dimensions: AnalyticsCatalogDimension[];
  filters: AnalyticsCatalogFilter[];
};
export type AnalyticsCatalog = {
  datasets: AnalyticsCatalogDataset[];
  visualizations: Array<{ id: AnalyticsVisualization; label: string }>;
  sizes: Array<{ id: AnalyticsPanelSize; label: string }>;
};

export type AnalyticsRange = { from: string; to: string };
export type AnalyticsQueryRequest = {
  projectId: string;
  range: AnalyticsRange;
  panels: AnalyticsPanelConfig[];
};
export type AnalyticsDataRow = {
  key: string;
  label: string;
  value: number;
  secondaryValue?: number;
  sampleCount?: number;
  secondarySampleCount?: number;
};
export type AnalyticsPanelResult = {
  panelId: string;
  rows: AnalyticsDataRow[];
  measureLabel: string;
  secondaryMeasureLabel?: string;
  dimensionLabel?: string;
  unit: "count" | "percent" | "days";
  snapshot: boolean;
  error?: string;
};
export type AnalyticsQueryResponse = { asOfDate: string; range: AnalyticsRange; results: AnalyticsPanelResult[] };
export type AnalyticsLayoutResponse = {
  layout: AnalyticsLayout;
  source: "default" | "personal";
  canCustomize: boolean;
  updatedAt: string | null;
};

const snapshotVisualizations: AnalyticsVisualization[] = ["kpi", "bar", "donut", "table"];
const groupedVisualizations: AnalyticsVisualization[] = ["bar", "line", "donut", "table"];
const requirementStatusOptions = requirementStatuses.map((value) => ({ value, label: requirementStatusLabels[value] }));
const workItemStatusOptions = workItemStatuses.map((value) => ({ value, label: requirementStatusLabels[value] }));
const issueStatusOptions = [
  { value: "in_progress", label: "处理中" },
  { value: "deferred", label: "挂起" }, { value: "resolved", label: "已解决" },
];
const priorityOptions = ["P0", "P1", "P2", "P3"].map((value) => ({ value, label: value }));
const riskOptions = [
  { value: "high", label: "高风险" }, { value: "medium", label: "中风险" }, { value: "low", label: "低风险" },
];

export const analyticsCatalog: AnalyticsCatalog = {
  visualizations: [
    { id: "kpi", label: "指标卡" }, { id: "bar", label: "柱状图" },
    { id: "line", label: "折线图" }, { id: "donut", label: "环形图" }, { id: "table", label: "表格" },
  ],
  sizes: [{ id: "small", label: "小" }, { id: "medium", label: "中" }, { id: "large", label: "大" }],
  datasets: [
    {
      id: "requirements", label: "需求",
      measures: [
        { id: "count", label: "需求数量", unit: "count", dimensions: ["status", "priority", "risk", "template", "owner", "week"], visualizations: ["kpi", ...groupedVisualizations] },
        { id: "active_count", label: "活跃需求", unit: "count", dimensions: ["priority", "risk", "template", "owner"], visualizations: snapshotVisualizations },
        { id: "completed_count", label: "完成需求", unit: "count", dimensions: ["week", "priority", "template", "owner"], visualizations: ["kpi", ...groupedVisualizations] },
        { id: "on_time_rate", label: "按期完成率", unit: "percent", dimensions: ["priority", "template", "owner"], visualizations: snapshotVisualizations },
        { id: "delayed_count", label: "延期需求", unit: "count", dimensions: ["priority", "risk", "template", "owner"], visualizations: snapshotVisualizations },
        { id: "finish_variance", label: "完成偏差", unit: "days", dimensions: ["requirement", "priority", "risk", "template", "owner"], visualizations: ["kpi", "bar", "table"] },
        { id: "due_count", label: "到期需求", unit: "count", dimensions: ["day", "week", "priority", "owner"], visualizations: ["kpi", "bar", "line", "table"] },
      ],
      dimensions: [
        { id: "status", label: "状态" }, { id: "priority", label: "优先级" }, { id: "risk", label: "风险" },
        { id: "template", label: "流程" }, { id: "owner", label: "负责人" }, { id: "requirement", label: "需求" },
        { id: "week", label: "周" }, { id: "day", label: "日期" },
      ],
      filters: [
        { id: "status", label: "状态", options: requirementStatusOptions }, { id: "priority", label: "优先级", options: priorityOptions },
        { id: "risk", label: "风险", options: riskOptions },
      ],
    },
    {
      id: "work_items", label: "工作项",
      measures: [
        { id: "count", label: "工作项数量", unit: "count", dimensions: ["status", "owner", "week"], visualizations: ["kpi", ...groupedVisualizations] },
        { id: "completed_count", label: "完成工作项", unit: "count", dimensions: ["week", "owner"], visualizations: ["kpi", ...groupedVisualizations] },
        { id: "on_time_rate", label: "按期完成率", unit: "percent", dimensions: ["owner"], visualizations: snapshotVisualizations },
        { id: "average_cycle_days", label: "平均实际周期", unit: "days", dimensions: ["owner", "week"], visualizations: ["kpi", "bar", "line", "table"] },
      ],
      dimensions: [{ id: "status", label: "状态" }, { id: "owner", label: "负责人" }, { id: "week", label: "周" }],
      filters: [{ id: "status", label: "状态", options: workItemStatusOptions }],
    },
    {
      id: "issues", label: "问题",
      measures: [
        { id: "count", label: "新增问题", unit: "count", dimensions: ["week", "status", "priority", "scope", "owner"], visualizations: ["kpi", ...groupedVisualizations] },
        { id: "active_count", label: "活跃问题", unit: "count", dimensions: ["status", "priority", "scope", "owner"], visualizations: snapshotVisualizations },
        { id: "resolved_count", label: "闭环问题", unit: "count", dimensions: ["week", "priority", "scope", "owner"], visualizations: ["kpi", ...groupedVisualizations] },
        { id: "closure_rate", label: "问题闭环率", unit: "percent", dimensions: ["priority", "scope", "owner"], visualizations: snapshotVisualizations },
        { id: "overdue_count", label: "逾期问题", unit: "count", dimensions: ["priority", "scope", "owner"], visualizations: snapshotVisualizations },
        { id: "average_resolution_days", label: "平均闭环周期", unit: "days", dimensions: ["week", "priority", "owner"], visualizations: ["kpi", "bar", "line", "table"] },
      ],
      dimensions: [
        { id: "week", label: "周" }, { id: "status", label: "状态" }, { id: "priority", label: "优先级" },
        { id: "scope", label: "范围" }, { id: "owner", label: "负责人" },
      ],
      filters: [
        { id: "status", label: "状态", options: issueStatusOptions }, { id: "priority", label: "优先级", options: priorityOptions },
        { id: "scope", label: "范围", options: [{ value: "public", label: "公共问题" }, { value: "requirement", label: "需求问题" }] },
      ],
    },
    {
      id: "people", label: "人员并发",
      measures: [
        { id: "current_concurrency", label: "当前并发", unit: "count", dimensions: ["person", "job_title"], visualizations: ["kpi", "bar", "table"] },
        { id: "peak_concurrency", label: "区间峰值并发", unit: "count", dimensions: ["person", "job_title"], visualizations: ["kpi", "bar", "table"] },
      ],
      dimensions: [{ id: "person", label: "人员" }, { id: "job_title", label: "岗位" }],
      filters: [],
    },
    {
      id: "progress", label: "进展记录",
      measures: [
        { id: "update_count", label: "进展更新数", unit: "count", dimensions: ["week", "requirement", "creator"], visualizations: ["kpi", ...groupedVisualizations] },
        { id: "requirements_updated", label: "有更新的需求数", unit: "count", dimensions: ["week", "creator"], visualizations: ["kpi", "bar", "line", "table"] },
      ],
      dimensions: [{ id: "week", label: "周" }, { id: "requirement", label: "需求" }, { id: "creator", label: "填写人" }],
      filters: [],
    },
  ],
};

export const defaultAnalyticsLayout: AnalyticsLayout = {
  version: 1,
  panels: [
    { id: "active-requirements", title: "活跃需求", dataset: "requirements", measure: "active_count", visualization: "kpi", size: "small", timeScope: "snapshot" },
    { id: "on-time-rate", title: "按期完成率", dataset: "requirements", measure: "on_time_rate", visualization: "kpi", size: "small", timeScope: "range" },
    { id: "delayed-requirements", title: "延期需求", dataset: "requirements", measure: "delayed_count", visualization: "kpi", size: "small", timeScope: "snapshot" },
    { id: "active-issues", title: "活跃问题", dataset: "issues", measure: "active_count", visualization: "kpi", size: "small", timeScope: "snapshot" },
    { id: "requirement-status", title: "需求状态分布", dataset: "requirements", measure: "count", dimension: "status", visualization: "donut", size: "medium", timeScope: "snapshot", sort: "desc" },
    { id: "delivery-trend", title: "最近交付趋势", dataset: "requirements", measure: "completed_count", dimension: "week", visualization: "line", size: "medium", timeScope: "range", sort: "asc" },
    { id: "risk-distribution", title: "风险分布", dataset: "requirements", measure: "count", dimension: "risk", visualization: "donut", size: "medium", timeScope: "snapshot", sort: "desc" },
    { id: "variance-top", title: "耗时偏差 Top 10", dataset: "requirements", measure: "finish_variance", dimension: "requirement", visualization: "bar", size: "medium", timeScope: "snapshot", sort: "desc", limit: 10 },
    { id: "issue-trend", title: "问题新增与闭环趋势", dataset: "issues", measure: "count", secondaryMeasure: "resolved_count", dimension: "week", visualization: "line", size: "medium", timeScope: "range", sort: "asc" },
    { id: "upcoming-deadlines", title: "未来30天到期需求", dataset: "requirements", measure: "due_count", dimension: "day", visualization: "bar", size: "medium", timeScope: "future30", sort: "asc", limit: 30 },
    { id: "people-concurrency", title: "人员当前并发排行", dataset: "people", measure: "current_concurrency", dimension: "person", visualization: "bar", size: "large", timeScope: "snapshot", sort: "desc", limit: 12 },
  ],
};

export function catalogDataset(id: string) {
  return analyticsCatalog.datasets.find((dataset) => dataset.id === id);
}

export function catalogMeasure(datasetId: string, measureId: string) {
  return catalogDataset(datasetId)?.measures.find((measure) => measure.id === measureId);
}
