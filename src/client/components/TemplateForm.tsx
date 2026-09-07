import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { api, jsonBody, requiresWriteRecheck } from "../api";
import { invalidateTemplateViews, keys } from "../query-keys";
import type { TemplateItem, WorkItemTemplate } from "../types";
import { SortableList } from "./SortableList";
import { FormError, FormSubmitActions } from "./Form";
import { Modal } from "./Modal";
import { canonicalizeContent, canonicalizeLabel } from "../../shared/search";
import { useToast } from "./Toast";
import { resolveTemplateOffsets, suggestTemplatePredecessors } from "../../shared/path-template";

type TemplateFormInput = {
  dependencyMode?: 'legacy' | 'dependencies';
  projectId?: string;
  name: string;
  description: string;
  expectedUpdatedAt?: string;
  items: Array<{ id?: string; clientKey?: string; predecessorKeys?: string[]; title: string; startOffsetDays: number; durationDays: number; milestoneLabel: string | null; sortOrder: number }>;
};

function matchesTemplateDraft(template: WorkItemTemplate, input: TemplateFormInput) {
  return template.name === canonicalizeLabel(input.name)
    && (template.dependencyMode || 'legacy') === (input.dependencyMode || 'legacy')
    && template.description === canonicalizeContent(input.description)
    && template.items.length === input.items.length
    && input.items.every((item, index) => {
      const latest = template.items[index];
      return latest?.sortOrder === index
        && (!item.id || latest.id === item.id)
        && latest.title === canonicalizeLabel(item.title)
        && latest.startOffsetDays === item.startOffsetDays
        && latest.durationDays === item.durationDays
        && (input.dependencyMode !== 'dependencies' || JSON.stringify([...(latest.predecessorIds || [])].sort()) === JSON.stringify((item.predecessorKeys || []).map(k => template.items[input.items.findIndex(i => (i.clientKey || i.id) === k)]?.id).sort()))
        && latest.milestoneLabel === (canonicalizeLabel(item.milestoneLabel) || null);
    });
}

export function TemplateForm({
  template,
  templateUnavailable = false,
  projectId,
  onClose,
}: {
  template?: WorkItemTemplate;
  templateUnavailable?: boolean;
  projectId: string;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const submitting = useRef(false);
  const mounted = useRef(true);
  const stopTimelineDrag = useRef<(() => void) | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stopTimelineDrag.current?.(); };
  }, []);
  const initialTemplateIds = useRef<Set<string> | null | undefined>(undefined);
  if (initialTemplateIds.current === undefined) {
    const queryKey = [...keys.templates, projectId];
    const cached = client.getQueryData<WorkItemTemplate[]>(queryKey);
    initialTemplateIds.current = client.getQueryState(queryKey)?.status === "success" && cached
      ? new Set(cached.map((item) => item.id))
      : null;
  }
  type TemplateDraftItem = Pick<TemplateItem, "id" | "title" | "startOffsetDays" | "durationDays" | "milestoneLabel" | "sortOrder"> & { uiKey: string; predecessorKeys?: string[] };
  const createDraft = (item: Omit<TemplateDraftItem, "uiKey">): TemplateDraftItem => ({ ...item, uiKey: item.id || crypto.randomUUID() });
  const draftItems = (source: WorkItemTemplate) => source.items.map((item) => createDraft({ id: item.id, predecessorKeys: item.predecessorIds || [], title: item.title, startOffsetDays: item.startOffsetDays, durationDays: item.durationDays, milestoneLabel: item.milestoneLabel, sortOrder: item.sortOrder }));
  const [baseTemplate, setBaseTemplate] = useState(template);
  const [name, setName] = useState(template?.name || "");
  const [description, setDescription] = useState(template?.description || "");
  const [dependencyMode, setDependencyMode] = useState<'legacy' | 'dependencies'>(template?.dependencyMode || (template ? 'legacy' : 'dependencies'));
  const [items, setItems] = useState<TemplateDraftItem[]>(() =>
    template ? draftItems(template) : [
      createDraft({ id: "", title: "设计", startOffsetDays: 0, durationDays: 2, milestoneLabel: null, sortOrder: 0 }),
      createDraft({ id: "", title: "开发", startOffsetDays: 2, durationDays: 5, milestoneLabel: null, sortOrder: 1 }),
      createDraft({ id: "", title: "测试", startOffsetDays: 7, durationDays: 3, milestoneLabel: null, sortOrder: 2 }),
      createDraft({ id: "", title: "发布", startOffsetDays: 10, durationDays: 1, milestoneLabel: "发布基线", sortOrder: 3 }),
    ].map((item,index,all) => ({...item, predecessorKeys:index ? [all[index-1].uiKey] : []})),
  );
  const changed = Boolean(template && baseTemplate && template.updatedAt !== baseTemplate.updatedAt);
  const updateItem = (index: number, patch: Partial<(typeof items)[number]>) => setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  let graphError = '';
  let layoutItems = items;
  if(dependencyMode==='dependencies') { try { layoutItems=resolveTemplateOffsets(items.map(item=>({...item,clientKey:item.uiKey}))); } catch(error) { graphError=(error as Error).message; } }
  const totalDays = Math.max(1, ...layoutItems.map((item) => item.startOffsetDays + item.durationDays));
  const beginTimelineDrag = (event: ReactPointerEvent, index: number, mode: "move" | "resize") => {
    if(dependencyMode==='dependencies') return;
    if (submitting.current) return;
    stopTimelineDrag.current?.();
    event.preventDefault(); event.stopPropagation();
    const startX = event.clientX; const initial = items[index]; const pixelsPerDay = Math.max(18, 520 / totalDays);
    const move = (pointer: PointerEvent) => {
      if (submitting.current) return;
      const delta = Math.round((pointer.clientX - startX) / pixelsPerDay);
      if (mode === "move") updateItem(index, { startOffsetDays: Math.max(0, initial.startOffsetDays + delta) });
      else updateItem(index, { durationDays: Math.max(1, initial.durationDays + delta) });
    };
    const stop = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); window.removeEventListener("pointercancel", stop);
      stopTimelineDrag.current = null;
    };
    stopTimelineDrag.current = stop;
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", stop); window.addEventListener("pointercancel", stop);
  };
  const mutation = useMutation({
    mutationFn: (value: TemplateFormInput) =>
      api(baseTemplate ? `/api/templates/${baseTemplate.id}` : "/api/templates", {
        method: baseTemplate ? "PATCH" : "POST",
        body: jsonBody(value),
    }),
    onSuccess: () => {
      invalidateTemplateViews(client);
      onClose();
    },
    onError: async (error, input) => {
      if (!requiresWriteRecheck(error)) return;
      try {
        const latest = await api<WorkItemTemplate[]>(`/api/templates?projectId=${encodeURIComponent(projectId)}`, { readOnly: true });
        let saved: WorkItemTemplate | undefined;
        if (baseTemplate) {
          saved = latest.find((item) => item.id === baseTemplate.id && matchesTemplateDraft(item, input));
        } else if (initialTemplateIds.current) {
          const created = latest.filter((item) =>
            !initialTemplateIds.current!.has(item.id) && item.projectId === projectId && matchesTemplateDraft(item, input));
          if (created.length === 1) saved = created[0];
        }
        if (saved && mounted.current) {
          invalidateTemplateViews(client);
          toast.success(baseTemplate ? "已核对最新状态：流程设计已保存" : "已核对最新状态：流程已创建");
          onClose();
        }
      } catch {
        // 保留原写入错误和流程草稿，允许用户刷新后再确认。
      }
    },
    onSettled: () => { submitting.current = false; },
  });
  return (
    <Modal title={template ? "编辑流程" : "新建流程"} width={1040} closable={!mutation.isPending} onClose={() => { if (!submitting.current) onClose(); }}>
    {changed && template && <div className="warning-banner">流程已在其他位置更新，当前草稿保持不变。<button type="button" className="ghost-button" disabled={mutation.isPending} onClick={() => {
      stopTimelineDrag.current?.(); setBaseTemplate(template); setName(template.name); setDescription(template.description); setItems(draftItems(template)); setDependencyMode(template.dependencyMode || 'legacy'); mutation.reset();
    }}>使用最新流程</button></div>}
    {templateUnavailable && <div className="warning-banner">流程已归档或删除，当前草稿不能继续保存。</div>}
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (submitting.current || changed || templateUnavailable || graphError) return;
        submitting.current = true;
        stopTimelineDrag.current?.();
        mutation.mutate({ name, description, dependencyMode, ...(baseTemplate ? { expectedUpdatedAt: baseTemplate.updatedAt } : { projectId }), items: layoutItems.map(({ uiKey, ...item }, index) => ({ ...item, clientKey: uiKey, predecessorKeys: item.predecessorKeys || [], id: item.id || undefined, sortOrder: index })) });
      }}
    >
      <fieldset className="form-grid form-fieldset" disabled={mutation.isPending}>
      <label className="field field-full">
        <span>流程名称</span>
        <input name="name" value={name} onChange={(event) => setName(event.target.value)} required />
      </label>
      <label className="field field-full">
        <span>设计说明</span>
        <textarea name="description" rows={4} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="记录流程的设计目标、关键取舍和适用场景，方便后续回溯。" />
      </label>
      {dependencyMode==='legacy' ? <div className="field-help field-full">当前流程按偏移排期。<button type="button" className="ghost-button" onClick={()=>{setItems(suggestTemplatePredecessors(items.map(item=>({...item,clientKey:item.uiKey}))));setDependencyMode('dependencies');}}>生成依赖建议并核对</button></div> : <p className="field-help field-full">前置全部完成后开始；无前置表示独立工作。下方时间条随关系和工期自动生成，保存后用于新需求。</p>}
      <div className={`template-editor field-full${dependencyMode==='dependencies' ? ' template-dependency-editor' : ''}`}>
        <div className="template-item-editor">
          <div className="template-editor-head"><span /><span>工作项</span><span>{dependencyMode==='dependencies' ? '前置工作项' : '开始偏移'}</span><span>工期（工作日）</span><span>里程碑（可选）</span><span /></div>
          <SortableList
            items={items}
            disabled={mutation.isPending}
            getId={(item) => item.uiKey}
            onReorder={(next) => { if (!submitting.current) setItems(next.map((item, itemIndex) => ({ ...item, sortOrder: itemIndex }))); }}
            renderItem={(item, index, sortable) => <div
            ref={sortable.setNodeRef}
            className={`template-editor-row sortable-item${sortable.isDragging ? " is-dragging" : ""}${sortable.isOver ? " is-over" : ""}`}
          >
            <button
              type="button"
              className="template-drag-handle sortable-drag-handle"
              aria-label={`拖动${item.title || "工作项"}调整顺序`}
              title="按住拖动调整顺序"
              {...sortable.handleAttributes}
              {...sortable.handleListeners}
            >
              <GripVertical size={17} />
            </button>
            <input value={item.title} required onChange={(event) => updateItem(index, { title: event.target.value })} />
            {dependencyMode==='dependencies' ? <select multiple aria-label={`${item.title}的前置工作项`} value={item.predecessorKeys || []} onChange={event=>updateItem(index,{predecessorKeys:Array.from(event.target.selectedOptions,option=>option.value)})}>{items.filter(p=>p.uiKey!==item.uiKey).map(p=><option key={p.uiKey} value={p.uiKey}>{p.title}</option>)}</select> : <input aria-label="开始偏移" type="number" min="0" value={item.startOffsetDays} onChange={(event) => updateItem(index, { startOffsetDays: Math.max(0, Number(event.target.value)) })} />}
            <input aria-label="预计工期" type="number" min="1" value={item.durationDays} onChange={(event) => updateItem(index, { durationDays: Math.max(1, Number(event.target.value)) })} />
            <input aria-label="里程碑名称" className="template-milestone-input" maxLength={80} value={item.milestoneLabel || ""} placeholder="如：需求基线" onChange={(event) => updateItem(index, { milestoneLabel: event.target.value || null })} />
            <button type="button" className="template-delete-item" aria-label={`删除${item.title || "工作项"}`} title="删除" disabled={items.length === 1} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index).map(p=>({...p,predecessorKeys:p.predecessorKeys?.filter(k=>k!==item.uiKey)})))}><Trash2 size={14} /></button>
          </div>}
          />
          <button type="button" className="ghost-button add-template-item" onClick={() => setItems((current) => [...current, createDraft({ id: "", title: `工作项${current.length + 1}`, predecessorKeys:current.length?[current.at(-1)!.uiKey]:[], startOffsetDays: totalDays, durationDays: 1, milestoneLabel: null, sortOrder: current.length })])}><Plus size={14} />{dependencyMode==='dependencies'?'接在后面':'添加工作项'}</button>
          {dependencyMode==='dependencies' && <button type="button" className="ghost-button" onClick={()=>setItems(current=>[...current,createDraft({id:'',title:`并行工作${current.length+1}`,predecessorKeys:current.at(-1)?.predecessorKeys || [],startOffsetDays:0,durationDays:1,milestoneLabel:null,sortOrder:current.length})])}>添加并行工作</button>}
        </div>
        <div className="template-gantt">
          <div className="template-gantt-scale"><span>第1个工作日</span><span>共{totalDays}个工作日</span></div>
          {layoutItems.map((item, index) => <div className="template-gantt-row" key={item.uiKey}>
            <span className="template-gantt-title">{item.title || "未命名"}</span>
            <div className="template-gantt-track"><button type="button" className="template-gantt-bar" style={{ left: `${(item.startOffsetDays / totalDays) * 100}%`, width: `${(item.durationDays / totalDays) * 100}%` }} onPointerDown={(event) => beginTimelineDrag(event, index, "move")} title={`第${item.startOffsetDays + 1}个工作日开始，持续${item.durationDays}个工作日`}><span>{item.durationDays}工日</span><i onPointerDown={(event) => beginTimelineDrag(event, index, "resize")} /></button>{item.milestoneLabel?.trim() && <span className={`template-milestone-marker${(item.startOffsetDays + item.durationDays) / totalDays > .72 ? " align-left" : ""}`} style={{ left: `${((item.startOffsetDays + item.durationDays) / totalDays) * 100}%` }} title={`${item.milestoneLabel} · 第${item.startOffsetDays + item.durationDays}个工作日`}><i /><b>{item.milestoneLabel}</b></span>}</div>
          </div>)}
          <p>{dependencyMode==='dependencies'?'日期由前置关系和工期自动生成。按 Ctrl 可多选或取消前置。':'拖动时间条调整开始偏移，拖动右侧手柄调整工期。'}</p>
        </div>
      </div>
      <p className="field-help field-full">
        修改流程不会覆盖已有需求。列表排序只改变展示顺序。
      </p>
      <FormError>{mutation.error?.message}</FormError>
      <FormError>{graphError}</FormError>
      <FormSubmitActions submitLabel="保存流程" pending={mutation.isPending} disabled={changed || templateUnavailable || !!graphError} onCancel={onClose} />
      </fieldset>
    </form>
    </Modal>
  );
}
