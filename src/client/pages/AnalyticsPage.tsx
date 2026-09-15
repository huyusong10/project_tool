import { analyticsValue } from "../analytics-presentation";
import { usePageSearchParams, usePageScrollPosition } from "../use-page-view";
import { chartCategoryColor } from "../chart-theme";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy, GripVertical, Pencil, Plus, RefreshCcw, RotateCcw, Save, Settings2, Trash2, X,
} from "lucide-react";
import { api, isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from "../api";
import { useBusinessDate, useProjects, useSession } from "../app-context";
import { keys } from "../query-keys";
import { Chart } from "../components/Chart";
import { ConfirmDialog, Modal, useSynchronousPendingLock } from "../components/Modal";
import { EmptyState, LoadingState } from "../components/Feedback";
import { PageHeader } from "../components/PageHeader";
import { SortableList } from "../components/SortableList";
import { ViewTabs } from "../components/ViewTabs";
import {
  analyticsCatalog as fallbackCatalog,
  defaultAnalyticsLayout,
  type AnalyticsCatalog,
  type AnalyticsLayout,
  type AnalyticsLayoutResponse,
  type AnalyticsPanelConfig,
  type AnalyticsPanelResult,
  type AnalyticsQueryResponse,
  type AnalyticsRange,
} from "../../shared/analytics";
import { addCalendarDays } from "../../shared/domain";

type RangePreset = "30" | "90" | "180" | "project" | "custom";

function cloneLayout(layout: AnalyticsLayout): AnalyticsLayout {
  return JSON.parse(JSON.stringify(layout)) as AnalyticsLayout;
}

type AnalyticsLayoutRecheck = {
  action: "save" | "reset";
  draft: AnalyticsLayout;
  expectedUpdatedAt: string | null;
};

function analyticsLayoutRecheckKey(accountKey: string) {
  return `project-manage:analytics-layout-recheck:${accountKey}`;
}

function validStoredLayout(value: unknown): value is AnalyticsLayout {
  if (!value || typeof value !== "object") return false;
  const layout = value as Partial<AnalyticsLayout>;
  return layout.version === 1 && Array.isArray(layout.panels) && layout.panels.length > 0 && layout.panels.length <= 24
    && layout.panels.every((panel) => panel && typeof panel === "object"
      && typeof panel.id === "string" && typeof panel.title === "string" && typeof panel.dataset === "string"
      && typeof panel.measure === "string" && typeof panel.visualization === "string"
      && typeof panel.size === "string" && typeof panel.timeScope === "string");
}

function readAnalyticsLayoutRecheck(accountKey: string): AnalyticsLayoutRecheck | null {
  try {
    const raw = sessionStorage.getItem(analyticsLayoutRecheckKey(accountKey));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<AnalyticsLayoutRecheck>;
    if (value.action !== "save" && value.action !== "reset" || !validStoredLayout(value.draft)
      || value.expectedUpdatedAt !== null && typeof value.expectedUpdatedAt !== "string") return null;
    return { action: value.action, draft: cloneLayout(value.draft), expectedUpdatedAt: value.expectedUpdatedAt };
  } catch { return null; }
}

function persistAnalyticsLayoutRecheck(accountKey: string, value: AnalyticsLayoutRecheck | null) {
  try {
    const key = analyticsLayoutRecheckKey(accountKey);
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch { /* 当前页面仍保留核对锁。 */ }
}

function valueLabel(value: number | null, unit: AnalyticsPanelResult["unit"]) {
  if (value === null) return "—";
  if (unit === "percent") return `${value}%`;
  if (unit === "days") return `${value}个工作日`;
  return `${value}`;
}

function chartOption(panel: AnalyticsPanelConfig, result: AnalyticsPanelResult) {
  const labels = result.rows.map((row) => row.label);
  const primary = result.rows.map((row) => {
    const color = chartCategoryColor(panel.dimension, row.key);
    return panel.visualization === "bar" && color ? { value: analyticsValue(row, result.unit), itemStyle: { color } } : analyticsValue(row, result.unit);
  });
  const secondary = result.rows.map((row) => analyticsValue(row, result.unit, true));
  const series = [
    {
      name: result.measureLabel,
      type: panel.visualization,
      data: primary,
      smooth: panel.visualization === "line",
      symbolSize: 7,
      lineStyle: { width: 3, color: "var(--chart-line)" },
      itemStyle: { color: panel.visualization === "bar" ? "var(--chart-bar)" : "var(--chart-line)", borderRadius: panel.visualization === "bar" ? 4 : undefined },
      areaStyle: panel.visualization === "line" ? { color: "var(--chart-area)" } : undefined,
    },
    ...(result.secondaryMeasureLabel ? [{
      name: result.secondaryMeasureLabel,
      type: panel.visualization,
      data: secondary,
      smooth: panel.visualization === "line",
      symbolSize: 7,
      lineStyle: { width: 2, color: "var(--chart-secondary)" },
      itemStyle: { color: "var(--chart-secondary)", borderRadius: panel.visualization === "bar" ? 4 : undefined },
    }] : []),
  ];
  if (panel.visualization === "donut") return {
    tooltip: { trigger: "item" },
    legend: { bottom: 0, textStyle: { color: "var(--text-muted)" } },
    series: [{
      name: result.measureLabel, type: "pie", radius: ["46%", "70%"], center: ["50%", "44%"],
      label: { show: false }, data: result.rows.map((row) => ({ name: row.label, value: row.value, itemStyle: { color: chartCategoryColor(panel.dimension, row.key) } })),
      color: ["var(--chart-line)", "var(--success)", "var(--warning)", "var(--text-muted)", "var(--purple)", "var(--danger)", "var(--info)"],
    }],
  };
  const horizontal = panel.visualization === "bar" && ["requirement", "person", "owner"].includes(panel.dimension || "");
  if (horizontal) return {
    tooltip: { trigger: "axis" },
    grid: { left: 120, right: 24, top: 16, bottom: 24 },
    xAxis: { type: "value", splitLine: { lineStyle: { color: "var(--divider)" } }, axisLabel: { color: "var(--text-muted)" } },
    yAxis: { type: "category", inverse: true, data: labels, axisLabel: { color: "var(--text-secondary)", width: 105, overflow: "truncate" } },
    series,
  };
  return {
    tooltip: { trigger: "axis" },
    legend: result.secondaryMeasureLabel ? { top: 0, right: 12, textStyle: { color: "var(--text-muted)" } } : undefined,
    grid: { left: 42, right: 18, top: result.secondaryMeasureLabel ? 34 : 16, bottom: 40 },
    xAxis: { type: "category", data: labels, axisLabel: { color: "var(--text-muted)", hideOverlap: true }, axisLine: { lineStyle: { color: "var(--border-default)" } } },
    yAxis: { type: "value", minInterval: result.unit === "count" ? 1 : undefined, splitLine: { lineStyle: { color: "var(--divider)" } }, axisLabel: { color: "var(--text-muted)" } },
    series,
  };
}

function PanelContent({ panel, result, loading, retry }: {
  panel: AnalyticsPanelConfig;
  result?: AnalyticsPanelResult;
  loading?: boolean;
  retry?: () => void;
}) {
  if (loading) return <LoadingState className="analytics-panel-loading" label="正在计算…" />;
  if (!result || result.error) return <EmptyState title="图表加载失败" detail={result?.error || "暂时无法读取分析数据。"} action={retry ? <button className="ghost-button" onClick={retry}><RefreshCcw size={14} />重试</button> : undefined} />;
  if (!result.rows.length) return <EmptyState title="暂无数据" detail="当前项目和时间范围内没有可展示的数据。" />;
  if (panel.visualization === "kpi") return <div className="analytics-kpi">
    <strong>{valueLabel(analyticsValue(result.rows[0], result.unit), result.unit)}</strong>
    <span>{analyticsValue(result.rows[0], result.unit) === null ? (panel.measure === "on_time_rate" ? "暂无完成样本" : "暂无有效样本") : result.measureLabel}</span>
  </div>;
  if (panel.visualization === "table") return <div className="analytics-table-scroll"><table className="analytics-table">
    <thead><tr><th>{result.dimensionLabel || "项目"}</th><th>{result.measureLabel}</th>{result.secondaryMeasureLabel && <th>{result.secondaryMeasureLabel}</th>}</tr></thead>
    <tbody>{result.rows.map((row) => <tr key={row.key}><td>{row.label}</td><td>{valueLabel(analyticsValue(row, result.unit), result.unit)}</td>{result.secondaryMeasureLabel && <td>{valueLabel(analyticsValue(row, result.unit, true), result.unit)}</td>}</tr>)}</tbody>
  </table></div>;
  return <Chart option={chartOption(panel, result)} height={panel.size === "large" ? 290 : 238} ariaLabel={`${panel.title}图表`} />;
}

function analyticsTimeLabel(panel: AnalyticsPanelConfig, result?: AnalyticsPanelResult, asOfDate?: string) {
  if (result?.snapshot) return asOfDate ? `截至 ${asOfDate}` : "当前快照";
  if (panel.timeScope === "future30") return asOfDate ? `${asOfDate} 起30天` : "未来30天";
  return "跟随时间范围";
}

function AnalyticsPanelCard({ panel, result, asOfDate, loading, editing, disabled = false, children, onEdit, onCopy, onDelete, retry }: {
  panel: AnalyticsPanelConfig;
  result?: AnalyticsPanelResult;
  asOfDate?: string;
  loading: boolean;
  editing: boolean;
  disabled?: boolean;
  children?: ReactNode;
  onEdit?: () => void;
  onCopy?: () => void;
  onDelete?: () => void;
  retry?: () => void;
}) {
  return <article className={`analytics-panel analytics-panel-${panel.size}${editing ? " is-editing" : ""}`}>
    <header>
      <div>{children}<h2>{panel.title}</h2><span>{analyticsTimeLabel(panel, result, asOfDate)}</span></div>
      {editing && <div className="analytics-panel-actions">
        <button aria-label={`编辑${panel.title}`} title="编辑" disabled={disabled} onClick={onEdit}><Pencil size={14} /></button>
        <button aria-label={`复制${panel.title}`} title="复制" disabled={disabled} onClick={onCopy}><Copy size={14} /></button>
        <button className="danger" aria-label={`删除${panel.title}`} title="删除" disabled={disabled} onClick={onDelete}><Trash2 size={14} /></button>
      </div>}
    </header>
    <div className="analytics-panel-body"><PanelContent panel={panel} result={result} loading={loading} retry={retry} /></div>
  </article>;
}

function PanelEditor({ initial, catalog, range, projectId, onClose, onSave }: {
  initial: AnalyticsPanelConfig;
  catalog: AnalyticsCatalog;
  range: AnalyticsRange;
  projectId: string;
  onClose: () => void;
  onSave: (panel: AnalyticsPanelConfig) => void;
}) {
  const [panel, setPanel] = useState(initial);
  const dataset = catalog.datasets.find((item) => item.id === panel.dataset) || catalog.datasets[0];
  const measure = dataset.measures.find((item) => item.id === panel.measure) || dataset.measures[0];
  const compatibleVisualizations = measure.visualizations.filter((item) => panel.dimension ? item !== "kpi" : item === "kpi" || item === "table");
  const secondaryMeasures = dataset.measures.filter((item) => item.id !== panel.measure
    && item.unit === measure.unit
    && (!panel.dimension || item.dimensions.includes(panel.dimension))
    && item.visualizations.includes(panel.visualization));
  const preview = useQuery({
    queryKey: [...keys.analyticsPreview, projectId, range, panel],
    queryFn: ({ signal }) => api<AnalyticsQueryResponse>("/api/analytics/query", { signal, method: "POST", readOnly: true, body: jsonBody({ projectId, range, panels: [panel] }) }),
    enabled: Boolean(projectId),
  });
  const updateDataset = (nextId: string) => {
    const nextDataset = catalog.datasets.find((item) => item.id === nextId)!;
    const nextMeasure = nextDataset.measures[0];
    setPanel((current) => ({ ...current, dataset: nextId, measure: nextMeasure.id, secondaryMeasure: undefined, dimension: undefined, visualization: "kpi", filters: undefined }));
  };
  const updateMeasure = (nextId: string) => {
    const nextMeasure = dataset.measures.find((item) => item.id === nextId)!;
    const nextDimension = panel.dimension && nextMeasure.dimensions.includes(panel.dimension) ? panel.dimension : undefined;
    const nextVisualization = nextMeasure.visualizations.includes(panel.visualization) && (nextDimension || ["kpi", "table"].includes(panel.visualization)) ? panel.visualization : "kpi";
    setPanel((current) => ({ ...current, measure: nextId, secondaryMeasure: undefined, dimension: nextDimension, visualization: nextVisualization }));
  };
  return <div className="analytics-panel-editor">
    <form className="analytics-config-form" onSubmit={(event) => { event.preventDefault(); onSave(panel); }}>
      <label className="field field-full"><span>图表标题</span><input value={panel.title} maxLength={60} required onChange={(event) => setPanel((current) => ({ ...current, title: event.target.value }))} /></label>
      <label className="field"><span>数据主题</span><select value={panel.dataset} onChange={(event) => updateDataset(event.target.value)}>{catalog.datasets.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
      <label className="field"><span>指标</span><select value={panel.measure} onChange={(event) => updateMeasure(event.target.value)}>{dataset.measures.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
      <label className="field"><span>分组维度</span><select value={panel.dimension || ""} onChange={(event) => {
        const dimension = event.target.value || undefined;
        setPanel((current) => ({ ...current, dimension, secondaryMeasure: undefined, visualization: dimension && current.visualization === "kpi" ? "bar" : !dimension && !["kpi", "table"].includes(current.visualization) ? "kpi" : current.visualization }));
      }}><option value="">不分组</option>{measure.dimensions.map((id) => <option value={id} key={id}>{dataset.dimensions.find((item) => item.id === id)?.label || id}</option>)}</select></label>
      <label className="field"><span>图表类型</span><select value={panel.visualization} onChange={(event) => setPanel((current) => ({ ...current, visualization: event.target.value as AnalyticsPanelConfig["visualization"], secondaryMeasure: undefined }))}>{compatibleVisualizations.map((id) => <option value={id} key={id}>{catalog.visualizations.find((item) => item.id === id)?.label || id}</option>)}</select></label>
      {panel.dimension && ["bar", "line", "table"].includes(panel.visualization) && <label className="field"><span>对比指标</span><select value={panel.secondaryMeasure || ""} onChange={(event) => setPanel((current) => ({ ...current, secondaryMeasure: event.target.value || undefined }))}><option value="">不对比</option>{secondaryMeasures.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>}
      <label className="field"><span>时间策略</span><select value={panel.timeScope} onChange={(event) => setPanel((current) => ({ ...current, timeScope: event.target.value as AnalyticsPanelConfig["timeScope"] }))}><option value="snapshot">当前快照</option><option value="range">跟随页面范围</option><option value="future30">未来30天</option></select></label>
      <label className="field"><span>卡片尺寸</span><select value={panel.size} onChange={(event) => setPanel((current) => ({ ...current, size: event.target.value as AnalyticsPanelConfig["size"] }))}>{catalog.sizes.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
      <label className="field"><span>排序</span><select value={panel.sort || "desc"} onChange={(event) => setPanel((current) => ({ ...current, sort: event.target.value as AnalyticsPanelConfig["sort"] }))}><option value="desc">降序</option><option value="asc">升序</option></select></label>
      <label className="field"><span>显示数量</span><input type="number" min={1} max={50} value={panel.limit || 10} onChange={(event) => setPanel((current) => ({ ...current, limit: Number(event.target.value) }))} /></label>
      {!!dataset.filters.length && <div className="analytics-config-filters field-full"><span>筛选条件</span>{dataset.filters.map((filter) => <label className="field" key={filter.id}><span>{filter.label}</span><select value={panel.filters?.[filter.id]?.[0] || ""} onChange={(event) => setPanel((current) => ({ ...current, filters: { ...(current.filters || {}), [filter.id]: event.target.value ? [event.target.value] : [] } }))}><option value="">全部</option>{filter.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>)}</div>}
      {preview.error && <p className="form-error field-full">{preview.error.message}</p>}
      <div className="form-actions field-full"><button type="button" className="ghost-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!panel.title.trim()}>应用配置</button></div>
    </form>
    <div className="analytics-config-preview"><span>实时预览</span><AnalyticsPanelCard panel={panel} result={preview.data?.results[0]} asOfDate={preview.data?.asOfDate} loading={preview.isLoading} editing={false} /></div>
  </div>;
}

export function AnalyticsPage() {
  const { session } = useSession();
  const { projects, selectedProjectId } = useProjects();
  const { businessDate: businessToday } = useBusinessDate();
  const client = useQueryClient();
  const [viewParams, setViewParams] = usePageSearchParams(['range', 'from', 'to']);
  const preset = (['30','90','180','project','custom'].includes(viewParams.get('range') || '') ? viewParams.get('range') : '90') as RangePreset;
  const customFrom = viewParams.get('from') ?? addCalendarDays(businessToday, -89);
  const customTo = viewParams.get('to') ?? businessToday;
  const layoutScope = session.accountId || session.username || "guest";
  const initialLayoutRecheck = readAnalyticsLayoutRecheck(layoutScope);
  const setPreset = (value: RangePreset) => setViewParams(current => { const next = new URLSearchParams(current); next.set('range', value); return next; });
  const setCustomFrom = (value: string) => setViewParams(current => { const next = new URLSearchParams(current); next.set('from', value); next.set('to', customTo); return next; });
  const setCustomTo = (value: string) => setViewParams(current => { const next = new URLSearchParams(current); next.set('from', customFrom); next.set('to', value); return next; });
  const [layoutRecheck, setLayoutRecheckState] = useState<AnalyticsLayoutRecheck | null>(initialLayoutRecheck);
  const [draft, setDraft] = useState<AnalyticsLayout | null>(() => initialLayoutRecheck ? cloneLayout(initialLayoutRecheck.draft) : null);
  const [editingUpdatedAt, setEditingUpdatedAt] = useState<string | null>(initialLayoutRecheck?.expectedUpdatedAt ?? null);
  const [editingPanel, setEditingPanel] = useState<AnalyticsPanelConfig | null>(null);
  const [resetConfirm, setResetConfirm] = useState(false);
  const project = projects.find((item) => item.id === selectedProjectId);
  const range = useMemo<AnalyticsRange>(() => {
    if (preset === "custom") return { from: customFrom, to: customTo };
    if (preset === "project" && project?.plannedStart && project?.plannedEnd) return { from: project.plannedStart, to: project.plannedEnd };
    const days = Number(preset === "project" ? 90 : preset);
    return { from: addCalendarDays(businessToday, -(days - 1)), to: businessToday };
  }, [businessToday, customFrom, customTo, preset, project?.plannedEnd, project?.plannedStart]);
  const catalogQuery = useQuery({ queryKey: keys.analyticsCatalog, queryFn: ({ signal }) => api<AnalyticsCatalog>("/api/analytics/catalog", { signal }) });
  const layoutQuery = useQuery({ queryKey: [...keys.analyticsLayout, layoutScope], queryFn: ({ signal }) => api<AnalyticsLayoutResponse>("/api/analytics/layout", { signal }) });
  const catalog = catalogQuery.data || fallbackCatalog;
  const savedLayout = layoutQuery.data?.layout || defaultAnalyticsLayout;
  const activeLayout = draft || savedLayout;
  const setLayoutRecheck = (value: AnalyticsLayoutRecheck | null) => {
    persistAnalyticsLayoutRecheck(layoutScope, value);
    setLayoutRecheckState(value);
  };
  useEffect(() => {
    const restored = readAnalyticsLayoutRecheck(layoutScope);
    setLayoutRecheckState(restored);
    setDraft(restored ? cloneLayout(restored.draft) : null);
    setEditingUpdatedAt(restored?.expectedUpdatedAt ?? null);
    setEditingPanel(null);
    setResetConfirm(false);
  }, [layoutScope]);
  const dataQuery = useQuery({
    queryKey: [...keys.analyticsData, selectedProjectId, range, activeLayout],
    queryFn: ({ signal }) => api<AnalyticsQueryResponse>("/api/analytics/query", { signal, method: "POST", readOnly: true, body: jsonBody({ projectId: selectedProjectId, range, panels: activeLayout.panels }) }),
    enabled: Boolean(selectedProjectId) && (!layoutQuery.isLoading || layoutQuery.data !== undefined),
  });
  usePageScrollPosition(!dataQuery.isLoading && !layoutQuery.isLoading);
  const dataUnavailable = Boolean(dataQuery.error && !dataQuery.data);
  const resultMap = new Map((dataQuery.data?.results || []).map((result) => [result.panelId, result]));
  const saveLayout = useMutation({
    mutationFn: ({ layout, expectedUpdatedAt }: { layout: AnalyticsLayout; expectedUpdatedAt: string | null }) => api<AnalyticsLayoutResponse>("/api/analytics/layout", {
      method: "PUT", body: jsonBody({ ...layout, expectedUpdatedAt }),
    }),
    onMutate: (input) => setLayoutRecheck({ action: "save", draft: cloneLayout(input.layout), expectedUpdatedAt: input.expectedUpdatedAt }),
    onSuccess: (result) => {
      setLayoutRecheck(null);
      client.setQueryData([...keys.analyticsLayout, layoutScope], result);
      setDraft(null); setEditingUpdatedAt(null);
    },
    onError: async (error, input) => {
      if (!isWriteOutcomeUnknown(error)) { setLayoutRecheck(null); return; }
      try {
        const latest = await api<AnalyticsLayoutResponse>("/api/analytics/layout", { readOnly: true });
        client.setQueryData([...keys.analyticsLayout, layoutScope], latest);
        if (latest.updatedAt !== input.expectedUpdatedAt
          && JSON.stringify(latest.layout) === JSON.stringify(input.layout)) {
          setLayoutRecheck(null);
          saveLayout.reset();
          setDraft(null);
          setEditingUpdatedAt(null);
        }
      } catch {
        // 保留原写入异常与草稿；读回失败不能据此判定布局保存成功。
      }
    },
  });
  const saveLock = useSynchronousPendingLock(saveLayout.isPending);
  const resetLayout = useMutation({
    mutationFn: (expectedUpdatedAt: string | null) => api<AnalyticsLayoutResponse>("/api/analytics/layout", {
      method: "DELETE", body: jsonBody({ expectedUpdatedAt }),
    }),
    onMutate: (expectedUpdatedAt) => setLayoutRecheck({ action: "reset", draft: cloneLayout(draft || savedLayout), expectedUpdatedAt }),
    onSuccess: (result) => {
      setLayoutRecheck(null);
      client.setQueryData([...keys.analyticsLayout, layoutScope], result);
      setResetConfirm(false); setDraft(null); setEditingUpdatedAt(null);
    },
    onError: async (error) => {
      if (isWriteOutcomeUnknown(error)) {
        try {
          const latest = await api<AnalyticsLayoutResponse>("/api/analytics/layout", { readOnly: true });
          client.setQueryData([...keys.analyticsLayout, layoutScope], latest);
          if (latest.source === "default" && latest.updatedAt === null) {
            setLayoutRecheck(null);
            resetLayout.reset();
            setResetConfirm(false);
            setDraft(null);
            setEditingUpdatedAt(null);
            return;
          }
        } catch {
          // 保留原写入异常；读回失败不能据此判定个人布局已删除。
        }
      } else setLayoutRecheck(null);
      if (requiresWriteRecheck(error)) setResetConfirm(false);
    },
  });
  const layoutNeedsRecheck = Boolean(layoutRecheck) || [saveLayout.error, resetLayout.error].some((error) => requiresWriteRecheck(error));
  const clearLayoutOperation = () => {
    saveLayout.reset();
    resetLayout.reset();
  };
  const readLatestLayout = async () => {
    const latest = await layoutQuery.refetch();
    if (latest.error || !latest.data) return;
    if ((layoutRecheck?.action === "save" && JSON.stringify(latest.data.layout) === JSON.stringify(layoutRecheck.draft))
      || (layoutRecheck?.action === "reset" && latest.data.source === "default" && latest.data.updatedAt === null)) {
      setDraft(null);
      setEditingUpdatedAt(null);
    } else if (layoutRecheck && latest.data.updatedAt === layoutRecheck.expectedUpdatedAt) {
      setDraft(cloneLayout(layoutRecheck.draft));
      setEditingUpdatedAt(latest.data.updatedAt);
    } else {
      setDraft(cloneLayout(latest.data.layout));
      setEditingUpdatedAt(latest.data.updatedAt);
    }
    setLayoutRecheck(null);
    setResetConfirm(false);
    saveLayout.reset();
    resetLayout.reset();
  };
  const editingBusy = saveLock.busy || resetLayout.isPending;
  const editingBlocked = editingBusy || layoutNeedsRecheck;
  const beginEditing = () => {
    if (!saveLock.canClose() || layoutRecheck || !catalogQuery.data || !layoutQuery.data) return;
    clearLayoutOperation();
    setDraft(cloneLayout(savedLayout));
    setEditingUpdatedAt(layoutQuery.data?.updatedAt || null);
  };
  const updatePanel = (panel: AnalyticsPanelConfig) => {
    if (!saveLock.canClose()) return;
    setDraft((current) => current ? ({ ...current, panels: current.panels.some((item) => item.id === panel.id) ? current.panels.map((item) => item.id === panel.id ? panel : item) : [...current.panels, panel] }) : current);
    setEditingPanel(null);
  };
  const addPanel = () => {
    if (!saveLock.canClose()) return;
    const id = `panel-${Date.now().toString(36)}`;
    setEditingPanel({ id, title: "新图表", dataset: "requirements", measure: "count", visualization: "kpi", size: "small", timeScope: "snapshot", sort: "desc", limit: 10 });
  };
  const copyPanel = (panel: AnalyticsPanelConfig) => { if (saveLock.canClose()) setDraft((current) => current && current.panels.length < 24 ? ({ ...current, panels: [...current.panels, { ...cloneLayout({ version: 1, panels: [panel] }).panels[0], id: `panel-${Date.now().toString(36)}`, title: `${panel.title}副本` }] }) : current); };
  const deletePanel = (panelId: string) => { if (saveLock.canClose()) setDraft((current) => current && current.panels.length > 1 ? ({ ...current, panels: current.panels.filter((item) => item.id !== panelId) }) : current); };
  const reorderPanels = (panels: AnalyticsPanelConfig[]) => { if (saveLock.canClose()) setDraft((current) => current ? { ...current, panels } : current); };
  if (!projects.length) return <><PageHeader title="统计分析" /><div className="page-content"><EmptyState title="暂无可分析项目" detail="创建项目后，这里会生成默认分析看板。" /></div></>;
  if (layoutQuery.isLoading && !layoutQuery.data) return <><PageHeader title="统计分析" /><div className="page-content"><LoadingState label="正在加载分析看板…" className="tall" /></div></>;
  return <>
    <PageHeader title="统计分析" secondaryActions={draft&&<><button className="ghost-button" disabled={editingBlocked || draft.panels.length >= 24} onClick={addPanel}><Plus size={15} />新增图表</button><button className="ghost-button" onClick={() => { if (!saveLock.canClose()) return; clearLayoutOperation(); setResetConfirm(true); }} disabled={editingBlocked}><RotateCcw size={15} />恢复默认</button></>} actions={!draft && layoutQuery.data?.canCustomize ? <button className="primary-button" disabled={!catalogQuery.data || Boolean(layoutRecheck)} onClick={beginEditing}><Settings2 size={15} />编辑看板</button> : draft ? <>
      <button className="ghost-button" disabled={editingBlocked} onClick={() => { if (saveLock.canClose() && !layoutRecheck) { clearLayoutOperation(); setDraft(null); } }}><X size={15} />取消编辑</button>
      <button className="primary-button" onClick={() => saveLock.run(() => { clearLayoutOperation(); saveLayout.mutate({ layout: cloneLayout(draft), expectedUpdatedAt: editingUpdatedAt }); })} disabled={editingBlocked}><Save size={15} />保存布局</button>
    </> : null} />
    <div className="page-content analytics-page">
      <section className="analytics-toolbar">
        <ViewTabs ariaLabel="分析时间范围" value={preset} onChange={setPreset} options={([['30', '近30天'], ['90', '近90天'], ['180', '近180天'], ['project', '项目周期'], ['custom', '自定义']] as Array<[RangePreset, string]>).map(([value, label]) => ({ value, label }))} />
        {preset === "custom" && <div className="analytics-custom-range"><input aria-label="分析开始日期" type="date" value={customFrom} max={customTo} onChange={(event) => { setCustomFrom(event.target.value); }} /><span>至</span><input aria-label="分析结束日期" type="date" value={customTo} min={customFrom} onChange={(event) => { setCustomTo(event.target.value); }} /></div>}
        <span className="analytics-range-label">{range.from} 至 {range.to}</span>
      </section>
      {!session.authenticated && <p className="analytics-guest-note">当前展示系统默认看板；登录后可配置并保存个人布局。</p>}
      {layoutQuery.error && <div className="warning-banner">个人看板布局{layoutQuery.data ? "刷新失败，当前使用上次成功布局。" : "加载失败，当前显示系统默认布局且暂不可编辑。"}<button className="ghost-button" disabled={layoutQuery.isFetching} onClick={() => void layoutQuery.refetch()}>重新加载</button></div>}
      {catalogQuery.error && <div className="warning-banner">分析指标目录{catalogQuery.data ? "刷新失败，当前使用上次成功目录。" : "加载失败，当前可查看图表但暂不可编辑布局。"}<button className="ghost-button" disabled={catalogQuery.isFetching} onClick={() => void catalogQuery.refetch()}>重新加载</button></div>}
      {dataQuery.error && dataQuery.data && <div className="warning-banner">分析数据刷新失败，当前展示的是上次成功结果。<button className="ghost-button" disabled={dataQuery.isFetching} onClick={() => void dataQuery.refetch()}>重新加载</button></div>}
      {layoutRecheck && <div className="warning-banner" role="alert">布局{layoutRecheck.action === "save" ? "保存" : "恢复默认"}结果待核对，原布局版本与草稿已锁定。<button type="button" className="ghost-button" disabled={layoutQuery.isFetching} onClick={() => void readLatestLayout()}>{layoutQuery.isFetching ? "读取中…" : "重新读取布局"}</button></div>}
      {(saveLayout.error || resetLayout.error) && <div className="analytics-layout-error"><p className="form-error">{saveLayout.error?.message || resetLayout.error?.message}</p>{layoutNeedsRecheck && !layoutRecheck && <button type="button" className="ghost-button" disabled={layoutQuery.isFetching} onClick={() => void readLatestLayout()}>{layoutQuery.isFetching ? "读取中…" : "放弃草稿并读取最新布局"}</button>}</div>}
      {dataUnavailable ? <EmptyState title="分析数据加载失败" detail={dataQuery.error?.message || "暂时无法读取分析数据。"} action={<button className="ghost-button" disabled={dataQuery.isFetching} onClick={() => void dataQuery.refetch()}><RefreshCcw size={15} />重新加载</button>} /> : <section className={`analytics-grid${draft ? " is-editing" : ""}`}>
        {draft ? <SortableList
          items={activeLayout.panels}
          getId={(panel) => panel.id}
          disabled={editingBlocked}
          onReorder={reorderPanels}
          renderItem={(panel, _index, { setNodeRef, handleAttributes, handleListeners, isDragging, transform }) => <div
            ref={setNodeRef}
            style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined }}
            className={`analytics-drag-item analytics-panel-${panel.size}${isDragging ? " is-dragging" : ""}`}
          >
            <button className="analytics-drag-handle sortable-drag-handle" aria-label={`拖动${panel.title}调整顺序`} disabled={editingBlocked} {...handleListeners} {...handleAttributes}><GripVertical size={16} /></button>
            <AnalyticsPanelCard
              panel={panel} result={resultMap.get(panel.id)} asOfDate={dataQuery.data?.asOfDate} loading={dataQuery.isLoading} editing disabled={editingBlocked} retry={() => void dataQuery.refetch()}
              onEdit={() => setEditingPanel(panel)} onCopy={() => copyPanel(panel)} onDelete={() => deletePanel(panel.id)}
            />
          </div>}
        /> : activeLayout.panels.map((panel) => <div className={`analytics-grid-item analytics-panel-${panel.size}`} key={panel.id}>
          <AnalyticsPanelCard panel={panel} result={resultMap.get(panel.id)} asOfDate={dataQuery.data?.asOfDate} loading={dataQuery.isLoading} editing={false} retry={() => void dataQuery.refetch()} />
        </div>)}
      </section>}
      {editingPanel && <Modal title="配置分析图表" width={1080} onClose={() => setEditingPanel(null)}><PanelEditor initial={editingPanel} catalog={catalog} range={range} projectId={selectedProjectId} onClose={() => setEditingPanel(null)} onSave={updatePanel} /></Modal>}
      {resetConfirm && <ConfirmDialog title="恢复默认看板" description="当前个人看板布局将被删除，并恢复为系统默认布局。" confirmLabel="恢复默认" pendingLabel="恢复中…" danger pending={resetLayout.isPending} error={resetLayout.error?.message} onClose={() => { resetLayout.reset(); setResetConfirm(false); }} onConfirm={() => resetLayout.mutate(editingUpdatedAt)} />}
    </div>
  </>;
}
