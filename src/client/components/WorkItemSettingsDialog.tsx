import { workStageLabels, workStages, type WorkStage } from "../../shared/execution-stage";
import {isAssignablePerson} from '../assignable-people';
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { api, ApiError, isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from "../api";
import { invalidateRequirementViews } from "../query-keys";
import type { Person, Requirement, WorkItem } from "../types";
import { useWorkItemSave } from "../use-work-item-save";
import { calculateWorkItemGap, canDeleteWorkItem } from "../../shared/domain";
import { StatusBadge } from "./Badge";
import { EmptyState } from "./Feedback";
import { FormError } from "./Form";
import { InlineDateCell, InlineMultiSelectCell, InlineSelectCell, InlineTextCell } from "./InlineEdit";
import { Modal } from "./Modal";
import { SortableList } from "./SortableList";
import { WorkItemDeleteDialog } from "./WorkItemDeleteDialog";

type NewWorkItemDraft = {
  workStage?: WorkStage | null;
  title: string;
  milestoneLabel: string;
  ownerId: string;
  collaboratorIds: string[];
  plannedStart: string;
  plannedEnd: string;
  reason?: string;
  baselineVersion: number;
  baselineStatus: Requirement["status"];
  sourceIds: string[];
};

export function WorkItemSettingsDialog({
  requirement,
  people,
  canManageRequirement,
  onClose,
  onOpenPlan,
  onOpenDependencies,
  onReload,
  onWriteNeedsRecheck,
}: {
  requirement: Requirement;
  people: Person[];
  canManageRequirement: boolean;
  onClose: () => void;
  onOpenPlan: () => void;
  onOpenDependencies?: () => void;
  onReload: () => Promise<Requirement>;
  onWriteNeedsRecheck: () => void;
}) {
  const client = useQueryClient();
  const [createUnknown,setCreateUnknown]=useState(false),[reorderUnknown,setReorderUnknown]=useState(false),[inlineUnknown,setInlineUnknown]=useState(false),[deleteUnknown,setDeleteUnknown]=useState(false);
  const [newItem, setNewItem] = useState<NewWorkItemDraft | null>(null);
  const [createNeedsRefresh, setCreateNeedsRefresh] = useState(false);
  const [createReadError, setCreateReadError] = useState("");
  const [createReading, setCreateReading] = useState(false);
  const [createRefreshed, setCreateRefreshed] = useState(false);
  const [reorderReading, setReorderReading] = useState(false);
  const [reorderNeedsRefresh, setReorderNeedsRefresh] = useState(false);
  const [reorderReadError, setReorderReadError] = useState("");
  const [removeTarget, setRemoveTarget] = useState<WorkItem | null>(null);
  const createSubmitting = useRef(false);
  const editorScrollRef = useRef<HTMLDivElement>(null);
  const newItemRowRef = useRef<HTMLTableRowElement>(null);
  const scrollAfterCreateCount = useRef<number | null>(null);
  const reorderSubmitting = useRef(false);
  const createReadingRef = useRef(false);
  const reorderReadingRef = useRef(false);
  const saveWorkItemRequest = useWorkItemSave(requirement.id, people);
  const requirementLocked = ["pending_acceptance", "completed", "cancelled"].includes(requirement.status);
  const eligiblePeople = people.filter(isAssignablePerson);
  const eligiblePersonIds = new Set(eligiblePeople.map((person) => person.id));
  const workItemHistoryIds = new Set((requirement.progressUpdates || []).map((entry) => entry.workItemId));
  const createChanged = Boolean(newItem && (requirement.version !== newItem.baselineVersion || requirement.status !== newItem.baselineStatus));
  const newItemHasUnavailablePeople = Boolean(newItem && [newItem.ownerId, ...newItem.collaboratorIds].some((personId) => personId && !eligiblePersonIds.has(personId)));
  const settingsUnknown = createUnknown || reorderUnknown || inlineUnknown || deleteUnknown;
  const createBlocked = settingsUnknown || createChanged || createNeedsRefresh || createReading || requirementLocked || newItemHasUnavailablePeople;
  const newItemVisible = Boolean(newItem);
  const saveWorkItem = async (item: WorkItem, input: Record<string, unknown>, expectedVersion?: number) => {
    try {
      await saveWorkItemRequest(item, input, expectedVersion);
    } catch (failure) {
      if (isWriteOutcomeUnknown(failure)) {
        setInlineUnknown(true);
        onWriteNeedsRecheck();
      }
      throw failure;
    }
  };

  useEffect(() => {
    if (!newItemVisible) return;
    const frame = window.requestAnimationFrame(() => {
      const scrollArea = editorScrollRef.current;
      if (!scrollArea) return;
      scrollArea.scrollTo({ top: scrollArea.scrollHeight, behavior: "smooth" });
      newItemRowRef.current?.querySelector<HTMLElement>(".inline-edit-trigger")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [newItemVisible]);

  useEffect(() => {
    const previousCount = scrollAfterCreateCount.current;
    if (previousCount === null || requirement.workItems.length <= previousCount) return;
    scrollAfterCreateCount.current = null;
    const frame = window.requestAnimationFrame(() => {
      const scrollArea = editorScrollRef.current;
      scrollArea?.scrollTo({ top: scrollArea.scrollHeight, behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [requirement.workItems.length]);

  const reorderItems = useMutation({
    mutationFn: ({ ids, reason, expectedVersion }: { ids: string[]; reason?: string; expectedVersion: number }) => api(`/api/requirements/${requirement.id}/reorder-work-items`, {
      method: "POST",
      body: jsonBody({ ids, reason, expectedVersion }),
    }),
    onSuccess: () => {
      setReorderNeedsRefresh(false);
      setReorderReadError("");
      invalidateRequirementViews(client, requirement.id);
    },
    onError: async failure => {
      if(isWriteOutcomeUnknown(failure)){setReorderUnknown(true);onWriteNeedsRecheck();}
      if (failure instanceof ApiError && failure.status === 400) return;
      setReorderNeedsRefresh(true);
      // 409 保留当前排序意图，等用户显式重读；未知结果和失权需要立即核对或清场。
      const failureStatus = typeof failure === "object" && failure !== null && "status" in failure
        ? (failure as { status?: unknown }).status : undefined;
      if (!requiresWriteRecheck(failure) || failureStatus === 409) return;
      reorderReadingRef.current = true; setReorderReading(true); setReorderReadError("");
      try {
        await onReload();
      } catch (caught) {
        setReorderReadError(caught instanceof Error ? caught.message : "需求读取失败");
      } finally {
        reorderReadingRef.current = false; setReorderReading(false);
      }
    },
    onSettled: () => { reorderSubmitting.current = false; },
  });
  const createItem = useMutation({
    mutationFn: (draft: NewWorkItemDraft) => api<WorkItem>(`/api/requirements/${requirement.id}/work-items`, {
      method: "POST",
      body: jsonBody({
        title: draft.title,
        workStage: draft.workStage || null,
        milestoneLabel: draft.milestoneLabel || null,
        ownerId: draft.ownerId || null,
        assigneeIds: [draft.ownerId, ...draft.collaboratorIds].filter(Boolean),
        plannedStart: draft.plannedStart || null,
        plannedEnd: draft.plannedEnd || null,
        expectedVersion: draft.baselineVersion,
        ...(draft.reason ? { reason: draft.reason } : {}),
      }),
    }),
    onSuccess: (_created, draft) => {
      scrollAfterCreateCount.current = draft.sourceIds.length;
      setNewItem(null);
      setCreateNeedsRefresh(false);
      setCreateReadError("");
      setCreateRefreshed(false);
      invalidateRequirementViews(client, requirement.id);
    },
    onError: async failure => {
      if(isWriteOutcomeUnknown(failure)){setCreateUnknown(true);onWriteNeedsRecheck();}
      if (failure instanceof ApiError && failure.status === 400) return;
      setCreateNeedsRefresh(true);
      if (!requiresWriteRecheck(failure)) return;
      createReadingRef.current = true; setCreateReading(true); setCreateReadError("");
      try {
        const latest = await onReload();
        setNewItem((current) => current ? { ...current, baselineVersion: latest.version, baselineStatus: latest.status } : current);
        setCreateNeedsRefresh(false); setCreateRefreshed(true);
      } catch (caught) {
        setCreateReadError(caught instanceof Error ? caught.message : "需求读取失败");
      } finally {
        createReadingRef.current = false; setCreateReading(false);
      }
    },
    onSettled: () => { createSubmitting.current = false; },
  });

  const reorderWorkItems = (nextItems: WorkItem[]) => {
    if (reorderSubmitting.current || settingsUnknown || reorderNeedsRefresh || reorderReading) return;
    const ids = nextItems.map((item) => item.id);
    const baseline = {
      version: requirement.version,
      status: requirement.status,
      hadExecution: requirement.workItems.some((item) => item.status !== "not_started"),
    };
    reorderSubmitting.current = true;
    reorderItems.mutate({ ids, expectedVersion: baseline.version });
  };
  const startNewItem = () => {
    setCreateNeedsRefresh(false);
    setCreateReadError("");
    setCreateRefreshed(false);
    setNewItem({
      title: "", milestoneLabel: "", ownerId: "", collaboratorIds: [], plannedStart: "", plannedEnd: "",
      baselineVersion: requirement.version, baselineStatus: requirement.status,
      sourceIds: requirement.workItems.map((item) => item.id),
    });
  };
  const submitNewItem = (reason?: string) => {
    if (!newItem || createSubmitting.current || createBlocked) return;
    createSubmitting.current = true;
    createItem.mutate({ ...newItem, ...(reason ? { reason } : {}) });
  };
  const reloadNewItem = async () => {
    if (!newItem || createReadingRef.current) return;
    createReadingRef.current = true;
    setCreateReading(true);
    setCreateNeedsRefresh(true);
    setCreateReadError("");
    try {
      const latest = await onReload();
      setNewItem((current) => current ? { ...current, baselineVersion: latest.version, baselineStatus: latest.status } : current);
      setCreateNeedsRefresh(false);
      setCreateRefreshed(true);
    } catch (failure) {
      setCreateReadError(failure instanceof Error ? failure.message : "需求读取失败");
    } finally { createReadingRef.current = false; setCreateReading(false); }
  };
  const reloadDirectReorder = async () => {
    reorderReadingRef.current = true;
    setReorderReading(true);
    setReorderReadError("");
    try {
      await onReload();
      setReorderNeedsRefresh(false);
      reorderItems.reset();
    } catch (failure) {
      setReorderReadError(failure instanceof Error ? failure.message : "需求读取失败");
    } finally { reorderReadingRef.current = false; setReorderReading(false); }
  };
  const reloadWorkItemRevision = async (workItemId: string) => {
    const latest = await onReload();
    const current = latest.workItems.find((entry) => entry.id === workItemId);
    if (!current) throw new Error("工作项已不存在，请关闭编辑器。");
    return current.version;
  };

  const closeSettings = () => {
    if (createSubmitting.current || reorderSubmitting.current || createReadingRef.current || reorderReadingRef.current) return;
    onClose();
  };

  return <>
    <Modal title="工作项设置" width={1120} closable={!createItem.isPending && !createReading && !reorderItems.isPending && !reorderReading} onClose={closeSettings}>
      <div className="work-editor-modal">
        <div className="work-editor-modal-toolbar">
          <span>配置名称、人员、计划日期和顺序；日常推进请直接在甘特图操作</span>
          <div className="panel-actions">
            {onOpenDependencies&&<button className="ghost-button" disabled={settingsUnknown} onClick={onOpenDependencies}>前置关系与工期</button>}
            {canManageRequirement && (!requirement.workItems.length || requirement.workItems.some((item) => !['completed', 'cancelled'].includes(item.status) && (!item.plannedStart || !item.plannedEnd))) && <button className="ghost-button" disabled={settingsUnknown} onClick={onOpenPlan}>补全计划</button>}
            <button className="primary-button" disabled={settingsUnknown || Boolean(newItem) || createItem.isPending || createReading} onClick={startNewItem}><Plus size={15} />添加工作项</button>
          </div>
        </div>
        <FormError full={false}>{reorderItems.error?.message}</FormError>
        {settingsUnknown&&<p role="alert" className="warning-banner">刚才的提交结果待核对。请检查操作记录，本窗口不会重复提交。</p>}
        {reorderNeedsRefresh && <div className="warning-banner">工作项顺序未保存，请重新读取需求后再拖动排序。<button type="button" className="ghost-button" disabled={reorderReading || reorderItems.isPending} onClick={() => void reloadDirectReorder()}>{reorderReading ? "读取中…" : "重新读取需求"}</button>{reorderReadError && <FormError full={false}>{reorderReadError}</FormError>}</div>}
        <div className="work-editor-scroll" ref={editorScrollRef}><table className="work-inline-table">
          <thead><tr><th>工作项</th><th>主负责人</th><th>协作人员</th><th>计划开始</th><th>计划完成</th><th>状态 / 偏差</th><th>操作</th></tr></thead>
          <tbody>
          <SortableList
            items={requirement.workItems}
            getId={(item) => item.id}
            disabled={reorderItems.isPending || settingsUnknown || reorderNeedsRefresh || reorderReading}
            onReorder={reorderWorkItems}
            renderItem={(item, _index, sortable) => {
              const gap = calculateWorkItemGap(item, requirement.asOfDate);
              const historicalPeople = [
                ...(item.ownerId && !eligiblePeople.some((person) => person.id === item.ownerId)
                  ? [{ id: item.ownerId, name: item.ownerName || "历史负责人", jobTitle: "历史负责人" }]
                  : []),
                ...item.collaborators.filter((collaborator) => !eligiblePeople.some((person) => person.id === collaborator.id)),
              ];
              const assignmentOptions = [...eligiblePeople, ...historicalPeople].map((person) => ({
                value: person.id, label: person.name,
                description: eligiblePersonIds.has(person.id) ? person.jobTitle || "岗位未设置" : "已不可用，请重新分配",
                disabled: !eligiblePersonIds.has(person.id),
              }));
              const itemLocked = ["completed", "cancelled"].includes(item.status);
              const revisionProps = { revision: item.version, revisionSubject: "工作项", onReloadRevision: () => reloadWorkItemRevision(item.id) };
              const canDelete = canDeleteWorkItem(item, workItemHistoryIds.has(item.id));
              return <tr ref={sortable.setNodeRef} className={`sortable-item${sortable.isDragging ? " is-dragging" : ""}${sortable.isOver ? " is-over" : ""}`}>
                <td><div className="work-item-name-editor"><InlineTextCell {...revisionProps} disabled={itemLocked || settingsUnknown} value={item.title} label="工作项名称" required onSave={(title, expectedVersion, reason) => saveWorkItem(item, { title, ...(reason ? { reason } : {}) }, expectedVersion)} /><InlineSelectCell {...revisionProps} disabled={itemLocked || settingsUnknown} value={item.workStage || ""} label="工作阶段" options={[{value:"",label:"未分类"},...workStages.map(value=>({value,label:workStageLabels[value]}))]} onSave={(workStage,reason,expectedVersion)=>saveWorkItem(item,{workStage:workStage as WorkStage || null,...reason?{reason}:{}},expectedVersion)}/></div></td>
                <td><InlineSelectCell {...revisionProps} disabled={itemLocked || settingsUnknown} value={item.ownerId} label="主负责人" options={[{ value: "", label: "未分配" }, ...assignmentOptions]} onSave={(ownerId, reason, expectedVersion) => saveWorkItem(item, { ownerId: ownerId || null, assigneeIds: [ownerId, ...item.collaborators.map((person) => person.id).filter((personId) => personId !== ownerId)].filter(Boolean), ...(reason ? { reason } : {}) }, expectedVersion)} placeholder="未分配" /></td>
                <td><InlineMultiSelectCell {...revisionProps} disabled={itemLocked || settingsUnknown} value={item.collaborators.map((person) => person.id)} label="协作人员" options={assignmentOptions} excludedValues={item.ownerId ? [item.ownerId] : []} onSave={(collaboratorIds, expectedVersion, reason) => saveWorkItem(item, { assigneeIds: [item.ownerId, ...collaboratorIds].filter(Boolean), ...(reason ? { reason } : {}) }, expectedVersion)} placeholder="无协作人员" renderValue={(selected) => selected.length ? <span className="inline-person-summary">{selected.slice(0, 2).map((person) => person.label).join("、")}{selected.length > 2 ? ` +${selected.length - 2}` : ""}</span> : "无协作人员"} /></td>
                <td><InlineDateCell {...revisionProps} disabled={itemLocked || settingsUnknown} value={item.plannedStart} label="计划开始" onSave={(plannedStart, reason, expectedVersion) => saveWorkItem(item, { plannedStart, ...(reason ? { reason } : {}) }, expectedVersion)} /></td>
                <td><InlineDateCell {...revisionProps} disabled={itemLocked || settingsUnknown} value={item.plannedEnd} label="计划完成" onSave={(plannedEnd, reason, expectedVersion) => saveWorkItem(item, { plannedEnd, ...(reason ? { reason } : {}) }, expectedVersion)} /></td>
                <td><div className="work-inline-status"><StatusBadge kind="workItem" value={item.status} /><b className={gap.finishVariance > 0 ? "danger-text" : "safe-text"}>{gap.finishVariance > 0 ? "+" : ""}{gap.finishVariance}工作日</b><span className="work-item-inline-progress"><i><b style={{ width: `${item.progress}%` }} /></i>{item.progress}%</span></div></td>
                <td><div className="work-setting-actions">
                  <button type="button" className="sortable-drag-handle" aria-label={`拖动${item.title}调整顺序`} title="按住拖动调整顺序" disabled={reorderItems.isPending || settingsUnknown || reorderNeedsRefresh || reorderReading} {...sortable.handleAttributes} {...sortable.handleListeners}><GripVertical size={16} /></button>
                  {item.status === "not_started" && <button type="button" className="danger" aria-label={`删除${item.title}`} title={canDelete ? "删除" : "已有执行信息或进展历史，不能删除"} disabled={!canDelete || settingsUnknown} onClick={() => { if (!settingsUnknown) setRemoveTarget(item); }}><Trash2 size={14} /></button>}
                </div></td>
              </tr>;
            }}
          />
          {newItem && <tr ref={newItemRowRef} className="work-inline-new-row">
            <td><div className="work-item-name-editor"><InlineTextCell disabled={settingsUnknown || createItem.isPending || createReading} value={newItem.title} label="新工作项名称" required placeholder="填写名称" onSave={async (title) => setNewItem((current) => current && ({ ...current, title }))} /><InlineSelectCell disabled={settingsUnknown || createItem.isPending || createReading} value={newItem.workStage || ""} label="新工作项阶段" options={[{value:"",label:"未分类"},...workStages.map(value=>({value,label:workStageLabels[value]}))]} onSave={async workStage=>setNewItem(current=>current&&({...current,workStage:workStage as WorkStage || null}))}/></div></td>
            <td><InlineSelectCell disabled={settingsUnknown || createItem.isPending || createReading} value={newItem.ownerId} label="新工作项主负责人" options={[{ value: "", label: "未分配" }, ...eligiblePeople.map((person) => ({ value: person.id, label: person.name, description: person.jobTitle || "岗位未设置" }))]} onSave={async (ownerId) => setNewItem((current) => current && ({ ...current, ownerId, collaboratorIds: current.collaboratorIds.filter((personId) => personId !== ownerId) }))} placeholder="未分配" /></td>
            <td><InlineMultiSelectCell disabled={settingsUnknown || createItem.isPending || createReading} value={newItem.collaboratorIds} label="新工作项协作人员" options={eligiblePeople.map((person) => ({ value: person.id, label: person.name, description: person.jobTitle || "岗位未设置" }))} excludedValues={newItem.ownerId ? [newItem.ownerId] : []} onSave={async (collaboratorIds) => setNewItem((current) => current && ({ ...current, collaboratorIds }))} placeholder="选择人员" /></td>
            <td><InlineDateCell disabled={settingsUnknown || createItem.isPending || createReading} value={newItem.plannedStart} label="新工作项计划开始" onSave={async (plannedStart) => setNewItem((current) => current && ({ ...current, plannedStart: plannedStart || "" }))} /></td>
            <td><InlineDateCell disabled={settingsUnknown || createItem.isPending || createReading} value={newItem.plannedEnd} label="新工作项计划完成" onSave={async (plannedEnd) => setNewItem((current) => current && ({ ...current, plannedEnd: plannedEnd || "" }))} /></td>
            <td><span className="status-pill status-not_started">待创建</span>{createItem.error && <small className="inline-row-error">{createItem.error.message}</small>}</td>
            <td><div className="inline-row-actions"><button className="ghost-button" disabled={createItem.isPending || createReading} onClick={() => setNewItem(null)}>取消</button><button className="primary-button" disabled={!newItem.title.trim() || createItem.isPending || createBlocked} onClick={() => {
              submitNewItem();
            }}>保存</button></div></td>
          </tr>}
          {newItem && (createChanged || createNeedsRefresh || createReadError || createRefreshed || newItemHasUnavailablePeople) && <tr className="work-inline-feedback"><td colSpan={7}>
            <FormError full={false}>{createChanged ? "需求已更新，请重新读取并核对后再保存；新增草稿已保留。" : createReadError || undefined}</FormError>
            <FormError full={false}>{newItemHasUnavailablePeople ? "新增工作项选择的人员已不可用，请重新选择负责人或协作人员。" : undefined}</FormError>
            {createRefreshed && <span>已读取最新需求（版本 {newItem.baselineVersion}），新增草稿保持不变。</span>}
            {(createChanged || createNeedsRefresh) && <button type="button" className="ghost-button" disabled={createReading || createItem.isPending} onClick={() => void reloadNewItem()}>{createReading ? "读取中…" : "重新读取需求"}</button>}
          </td></tr>}
          </tbody>
        </table>
        {!requirement.workItems.length && !newItem && <EmptyState title="还没有工作项" detail="可新增工作项，或从通用研发模板补充。" />}
        </div>
      </div>
    </Modal>
    {removeTarget && <WorkItemDeleteDialog target={removeTarget} requirement={requirement} canManage onReload={onReload} onWriteNeedsRecheck={() => { setDeleteUnknown(true); onWriteNeedsRecheck(); }} onClose={() => setRemoveTarget(null)} />}
  </>;
}
