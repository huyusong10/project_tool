import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { format, subDays } from "date-fns";
import {
  Copy, GripVertical, Pencil, Plus, RefreshCcw, RotateCcw, Save, Settings2, Trash2, X,
} from "lucide-react";
import { api, jsonBody } from "../api";
import { useApp } from "../app-context";
import { Chart } from "../components/Chart";
import { EmptyState, Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import {
  analyticsCatalog as fallbackCatalog,
  defaultAnalyticsLayout,
  type AnalyticsCatalog,
  type AnalyticsCatalogDataset,
  type AnalyticsLayout,
  type AnalyticsLayoutResponse,
  type AnalyticsPanelConfig,
  type AnalyticsPanelResult,
  type AnalyticsQueryResponse,
  type AnalyticsRange,
} from "../../shared/analytics";

type RangePreset = "30" | "90" | "180" | "project" | "custom";

function today() {
  return format(new Date(), "yyyy-MM-dd");
}

function cloneLayout(layout: AnalyticsLayout): AnalyticsLayout {
  return JSON.parse(JSON.stringify(layout)) as AnalyticsLayout;
}

function valueLabel(value: number, unit: AnalyticsPanelResult["unit"]) {
  if (unit === "percent") return `${value}%`;
  if (unit === "days") return `${value}天`;
  return `${value}`;
}

function chartOption(panel: AnalyticsPanelConfig, result: AnalyticsPanelResult) {
  const labels = result.rows.map((row) => row.label);
  const primary = result.rows.map((row) => row.value);
  const secondary = result.rows.map((row) => row.secondaryValue || 0);
  const series = [
    {
      name: result.measureLabel,
      type: panel.visualization,
      data: primary,
      smooth: panel.visualization === "line",
      symbolSize: 7,
      lineStyle: { width: 3, color: "#2d6cdf" },
      itemStyle: { color: "#2d6cdf", borderRadius: panel.visualization === "bar" ? 4 : undefined },
      areaStyle: panel.visualization === "line" ? { color: "rgba(45,108,223,.1)" } : undefined,
    },
    ...(result.secondaryMeasureLabel ? [{
      name: result.secondaryMeasureLabel,
      type: panel.visualization,
      data: secondary,
      smooth: panel.visualization === "line",
      symbolSize: 7,
      lineStyle: { width: 2, color: "#d78a14" },
      itemStyle: { color: "#d78a14", borderRadius: panel.visualization === "bar" ? 4 : undefined },
    }] : []),
  ];
  if (panel.visualization === "donut") return {
    tooltip: { trigger: "item" },
    legend: { bottom: 0, textStyle: { color: "#68768a" } },
    series: [{
      name: result.measureLabel, type: "pie", radius: ["46%", "70%"], center: ["50%", "44%"],
      label: { show: false }, data: result.rows.map((row) => ({ name: row.label, value: row.value })),
      color: ["#2d6cdf", "#1d9a6c", "#d78a14", "#7c8da5", "#8d67ca", "#df6565", "#66a6b8"],
    }],
  };
  const horizontal = panel.visualization === "bar" && ["requirement", "person", "owner"].includes(panel.dimension || "");
  if (horizontal) return {
    tooltip: { trigger: "axis" },
    grid: { left: 120, right: 24, top: 16, bottom: 24 },
    xAxis: { type: "value", splitLine: { lineStyle: { color: "#edf1f5" } }, axisLabel: { color: "#788598" } },
    yAxis: { type: "category", inverse: true, data: labels, axisLabel: { color: "#536176", width: 105, overflow: "truncate" } },
    series,
  };
  return {
    tooltip: { trigger: "axis" },
    legend: result.secondaryMeasureLabel ? { top: 0, right: 12, textStyle: { color: "#68768a" } } : undefined,
    grid: { left: 42, right: 18, top: result.secondaryMeasureLabel ? 34 : 16, bottom: 40 },
    xAxis: { type: "category", data: labels, axisLabel: { color: "#788598", hideOverlap: true }, axisLine: { lineStyle: { color: "#dfe5ed" } } },
    yAxis: { type: "value", minInterval: result.unit === "count" ? 1 : undefined, splitLine: { lineStyle: { color: "#edf1f5" } }, axisLabel: { color: "#788598" } },
    series,
  };
}

function PanelContent({ panel, result, loading, retry }: {
  panel: AnalyticsPanelConfig;
  result?: AnalyticsPanelResult;
  loading?: boolean;
  retry?: () => void;
}) {
  if (loading) return <div className="analytics-panel-loading">正在计算…</div>;
  if (!result || result.error) return <EmptyState title="图表加载失败" detail={result?.error || "暂时无法读取分析数据。"} action={retry ? <button className="ghost-button" onClick={retry}><RefreshCcw size={14} />重试</button> : undefined} />;
  if (!result.rows.length) return <EmptyState title="暂无数据" detail="当前项目和时间范围内没有可展示的数据。" />;
  if (panel.visualization === "kpi") return <div className="analytics-kpi">
    <strong>{valueLabel(result.rows[0]?.value || 0, result.unit)}</strong>
    <span>{result.measureLabel}</span>
  </div>;
  if (panel.visualization === "table") return <div className="analytics-table-scroll"><table className="analytics-table">
    <thead><tr><th>{result.dimensionLabel || "项目"}</th><th>{result.measureLabel}</th>{result.secondaryMeasureLabel && <th>{result.secondaryMeasureLabel}</th>}</tr></thead>
    <tbody>{result.rows.map((row) => <tr key={row.key}><td>{row.label}</td><td>{valueLabel(row.value, result.unit)}</td>{result.secondaryMeasureLabel && <td>{valueLabel(row.secondaryValue || 0, result.unit)}</td>}</tr>)}</tbody>
  </table></div>;
  return <Chart option={chartOption(panel, result)} height={panel.size === "large" ? 290 : 238} ariaLabel={`${panel.title}图表`} />;
}

function AnalyticsPanelCard({ panel, result, loading, editing, children, onEdit, onCopy, onDelete, retry }: {
  panel: AnalyticsPanelConfig;
  result?: AnalyticsPanelResult;
  loading: boolean;
  editing: boolean;
  children?: ReactNode;
  onEdit?: () => void;
  onCopy?: () => void;
  onDelete?: () => void;
  retry?: () => void;
}) {
  return <article className={`analytics-panel analytics-panel-${panel.size}${editing ? " is-editing" : ""}`}>
    <header>
      <div>{children}<h2>{panel.title}</h2><span>{result?.snapshot ? "当前快照" : panel.timeScope === "future30" ? "未来30天" : "跟随时间范围"}</span></div>
      {editing && <div className="analytics-panel-actions">
        <button aria-label={`编辑${panel.title}`} title="编辑" onClick={onEdit}><Pencil size={14} /></button>
        <button aria-label={`复制${panel.title}`} title="复制" onClick={onCopy}><Copy size={14} /></button>
        <button className="danger" aria-label={`删除${panel.title}`} title="删除" onClick={onDelete}><Trash2 size={14} /></button>
      </div>}
    </header>
    <div className="analytics-panel-body"><PanelContent panel={panel} result={result} loading={loading} retry={retry} /></div>
  </article>;
}

function DraggablePanel({ panel, children }: { panel: AnalyticsPanelConfig; children: ReactNode }) {
  const drag = useDraggable({ id: panel.id });
  const drop = useDroppable({ id: panel.id });
  const setRef = (node: HTMLElement | null) => { drag.setNodeRef(node); drop.setNodeRef(node); };
  const style = drag.transform ? { transform: `translate3d(${drag.transform.x}px,${drag.transform.y}px,0)`, zIndex: 20 } as CSSProperties : undefined;
  return <div ref={setRef} style={style} className={`analytics-drag-item analytics-panel-${panel.size}${drag.isDragging ? " is-dragging" : ""}`}>
    <button className="analytics-drag-handle" aria-label={`拖动${panel.title}调整顺序`} {...drag.listeners} {...drag.attributes}><GripVertical size={16} /></button>
    {children}
  </div>;
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
    queryKey: ["analytics-preview", projectId, range, panel],
    queryFn: () => api<AnalyticsQueryResponse>("/api/analytics/query", { method: "POST", body: jsonBody({ projectId, range, panels: [panel] }) }),
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
    <div className="analytics-config-preview"><span>实时预览</span><AnalyticsPanelCard panel={panel} result={preview.data?.results[0]} loading={preview.isLoading} editing={false} /></div>
  </div>;
}

export function AnalyticsPage() {
  const { projects, selectedProjectId, session } = useApp();
  const client = useQueryClient();
  const [preset, setPreset] = useState<RangePreset>("90");
  const [customFrom, setCustomFrom] = useState(format(subDays(new Date(), 89), "yyyy-MM-dd"));
  const [customTo, setCustomTo] = useState(today());
  const [draft, setDraft] = useState<AnalyticsLayout | null>(null);
  const [editingPanel, setEditingPanel] = useState<AnalyticsPanelConfig | null>(null);
  const project = projects.find((item) => item.id === selectedProjectId);
  const range = useMemo<AnalyticsRange>(() => {
    if (preset === "custom") return { from: customFrom, to: customTo };
    if (preset === "project" && project?.plannedStart && project?.plannedEnd) return { from: project.plannedStart, to: project.plannedEnd };
    const days = Number(preset === "project" ? 90 : preset);
    return { from: format(subDays(new Date(), days - 1), "yyyy-MM-dd"), to: today() };
  }, [customFrom, customTo, preset, project?.plannedEnd, project?.plannedStart]);
  const catalogQuery = useQuery({ queryKey: ["analytics-catalog"], queryFn: () => api<AnalyticsCatalog>("/api/analytics/catalog") });
  const layoutQuery = useQuery({ queryKey: ["analytics-layout", session.accountId || "guest"], queryFn: () => api<AnalyticsLayoutResponse>("/api/analytics/layout") });
  const catalog = catalogQuery.data || fallbackCatalog;
  const savedLayout = layoutQuery.data?.layout || defaultAnalyticsLayout;
  const activeLayout = draft || savedLayout;
  useEffect(() => { setDraft(null); }, [session.accountId]);
  const dataQuery = useQuery({
    queryKey: ["analytics-data", selectedProjectId, range, activeLayout],
    queryFn: () => api<AnalyticsQueryResponse>("/api/analytics/query", { method: "POST", body: jsonBody({ projectId: selectedProjectId, range, panels: activeLayout.panels }) }),
    enabled: Boolean(selectedProjectId),
  });
  const resultMap = new Map((dataQuery.data?.results || []).map((result) => [result.panelId, result]));
  const saveLayout = useMutation({
    mutationFn: (layout: AnalyticsLayout) => api<AnalyticsLayoutResponse>("/api/analytics/layout", { method: "PUT", body: jsonBody(layout) }),
    onSuccess: () => { setDraft(null); void client.invalidateQueries({ queryKey: ["analytics-layout"] }); },
  });
  const resetLayout = useMutation({
    mutationFn: () => api<AnalyticsLayoutResponse>("/api/analytics/layout", { method: "DELETE" }),
    onSuccess: () => { setDraft(null); void client.invalidateQueries({ queryKey: ["analytics-layout"] }); },
  });
  const beginEditing = () => setDraft(cloneLayout(savedLayout));
  const updatePanel = (panel: AnalyticsPanelConfig) => {
    setDraft((current) => current ? ({ ...current, panels: current.panels.some((item) => item.id === panel.id) ? current.panels.map((item) => item.id === panel.id ? panel : item) : [...current.panels, panel] }) : current);
    setEditingPanel(null);
  };
  const addPanel = () => {
    const id = `panel-${Date.now().toString(36)}`;
    setEditingPanel({ id, title: "新图表", dataset: "requirements", measure: "count", visualization: "kpi", size: "small", timeScope: "snapshot", sort: "desc", limit: 10 });
  };
  const copyPanel = (panel: AnalyticsPanelConfig) => setDraft((current) => current && current.panels.length < 24 ? ({ ...current, panels: [...current.panels, { ...cloneLayout({ version: 1, panels: [panel] }).panels[0], id: `panel-${Date.now().toString(36)}`, title: `${panel.title}副本` }] }) : current);
  const deletePanel = (panelId: string) => setDraft((current) => current && current.panels.length > 1 ? ({ ...current, panels: current.panels.filter((item) => item.id !== panelId) }) : current);
  const dragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setDraft((current) => {
      if (!current) return current;
      const from = current.panels.findIndex((panel) => panel.id === active.id);
      const to = current.panels.findIndex((panel) => panel.id === over.id);
      if (from < 0 || to < 0) return current;
      const panels = [...current.panels]; const [moved] = panels.splice(from, 1); panels.splice(to, 0, moved);
      return { ...current, panels };
    });
  };
  if (!projects.length) return <><PageHeader title="统计分析" /><div className="page-content"><EmptyState title="暂无可分析项目" detail="创建项目后，这里会生成默认分析看板。" /></div></>;
  return <>
    <PageHeader title="统计分析" actions={!draft && layoutQuery.data?.canCustomize ? <button className="primary-button" onClick={beginEditing}><Settings2 size={15} />编辑看板</button> : draft ? <>
      <button className="ghost-button" onClick={() => setDraft(null)}><X size={15} />取消编辑</button>
      <button className="primary-button" onClick={() => saveLayout.mutate(draft)} disabled={saveLayout.isPending}><Save size={15} />保存布局</button>
    </> : null} />
    <div className="page-content analytics-page">
      <section className="analytics-toolbar">
        <div className="view-tabs" aria-label="分析时间范围">
          {([['30', '近30天'], ['90', '近90天'], ['180', '近180天'], ['project', '项目周期'], ['custom', '自定义']] as Array<[RangePreset, string]>).map(([value, label]) => <button key={value} className={preset === value ? "active" : ""} onClick={() => setPreset(value)}>{label}</button>)}
        </div>
        {preset === "custom" && <div className="analytics-custom-range"><input aria-label="分析开始日期" type="date" value={customFrom} max={customTo} onChange={(event) => setCustomFrom(event.target.value)} /><span>至</span><input aria-label="分析结束日期" type="date" value={customTo} min={customFrom} onChange={(event) => setCustomTo(event.target.value)} /></div>}
        <span className="analytics-range-label">{range.from} 至 {range.to}</span>
        {draft && <div className="analytics-edit-actions"><button className="ghost-button" disabled={draft.panels.length >= 24} onClick={addPanel}><Plus size={15} />新增图表</button><button className="ghost-button" onClick={() => confirm("恢复系统默认看板？当前个人布局将被删除。") && resetLayout.mutate()} disabled={resetLayout.isPending}><RotateCcw size={15} />恢复默认</button></div>}
      </section>
      {!session.authenticated && <p className="analytics-guest-note">当前展示系统默认看板；登录后可配置并保存个人布局。</p>}
      {(saveLayout.error || resetLayout.error) && <p className="form-error">{saveLayout.error?.message || resetLayout.error?.message}</p>}
      <DndContext onDragEnd={dragEnd}>
        <section className={`analytics-grid${draft ? " is-editing" : ""}`}>
          {activeLayout.panels.map((panel) => {
            const card = <AnalyticsPanelCard
              panel={panel} result={resultMap.get(panel.id)} loading={dataQuery.isLoading} editing={Boolean(draft)} retry={() => void dataQuery.refetch()}
              onEdit={() => setEditingPanel(panel)} onCopy={() => copyPanel(panel)} onDelete={() => deletePanel(panel.id)}
            />;
            return draft ? <DraggablePanel panel={panel} key={panel.id}>{card}</DraggablePanel> : <div className={`analytics-grid-item analytics-panel-${panel.size}`} key={panel.id}>{card}</div>;
          })}
        </section>
      </DndContext>
      {dataQuery.error && <EmptyState title="分析数据加载失败" detail={dataQuery.error.message} action={<button className="ghost-button" onClick={() => void dataQuery.refetch()}><RefreshCcw size={15} />重新加载</button>} />}
      {editingPanel && <Modal title="配置分析图表" width={1080} onClose={() => setEditingPanel(null)}><PanelEditor initial={editingPanel} catalog={catalog} range={range} projectId={selectedProjectId} onClose={() => setEditingPanel(null)} onSave={updatePanel} /></Modal>}
    </div>
  </>;
}
