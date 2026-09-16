import {DetailToolbar} from './DetailWorkspace';
import {useDeliveryForm} from '../use-delivery-form';
import {WorkItemExecution} from './WorkItemExecution';
import {WorkspaceObjectMark} from './WorkspaceObjectMark';
import { Button } from './Button';
import {FormField, FormSubmitActions} from "./Form";
import {Select} from "./Select";
import {assertCleanRequirementDraft} from '../use-graph-draft';
import {useSession} from '../app-context';
import { workStageLabels, workStages, type WorkStage } from "../../shared/execution-stage";
import {isAssignablePerson} from '../assignable-people';
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, ArrowDown, GripVertical, Plus, Trash2 } from "lucide-react";
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
  initialCreate=false, embedded=false, canEdit=true, itemId, onInspect,
  requirement,
  people,
  canManageRequirement,
  onClose,
  onOpenPlan,
  onOpenDependencies,
  onReload,
  onWriteNeedsRecheck,
}: {
  initialCreate?:boolean; embedded?:boolean; canEdit?:boolean; itemId?:string; onInspect?:(id:string)=>void;
  requirement: Requirement;
  people: Person[];
  canManageRequirement: boolean;
  onClose: () => void;
  onOpenPlan: () => void;
  onOpenDependencies?: () => void;
  onReload: () => Promise<Requirement>;
  onWriteNeedsRecheck: () => void;
}) {
  const client = useQueryClient(),{session}=useSession();
  const [receipt,setReceipt,clearReceipt]=useDeliveryForm<{kind:'create';draft:NewWorkItemDraft}|{kind:'reorder';ids:string[];version:number}|null>(requirement.projectId,requirement.id+':work-list-receipt',()=>null);
  const [createUnknown,setCreateUnknown]=useDeliveryForm(requirement.projectId,requirement.id+':create-work-unknown',()=>false),[reorderUnknown,setReorderUnknown]=useDeliveryForm(requirement.projectId,requirement.id+':reorder-work-unknown',()=>false),[inlineUnknown,setInlineUnknown]=useState(false),[deleteUnknown,setDeleteUnknown]=useState(false);
  const [newItem, setNewItem, clearNewItem] = useDeliveryForm<NewWorkItemDraft | null>(requirement.projectId,requirement.id+':new-work',()=>initialCreate?{title:"",milestoneLabel:"",ownerId:"",collaboratorIds:[],plannedStart:"",plannedEnd:"",baselineVersion:requirement.version,baselineStatus:requirement.status,sourceIds:requirement.workItems.map(i=>i.id)}:null);
  const [creationOpen,setCreationOpen]=useDeliveryForm(requirement.projectId,requirement.id+':create-work-open',()=>initialCreate);
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
  const settingsUnknown = !!receipt || createUnknown || reorderUnknown || inlineUnknown || deleteUnknown;
  const createBlocked = settingsUnknown || createChanged || createNeedsRefresh || createReading || requirementLocked || newItemHasUnavailablePeople;
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
    mutationFn: ({ ids, reason, expectedVersion }: { ids: string[]; reason?: string; expectedVersion: number }) => {setReceipt({kind:'reorder',ids,version:expectedVersion});return api(`/api/requirements/${requirement.id}/reorder-work-items`, {
      method: "POST",
      body: jsonBody({ ids, reason, expectedVersion }),
    });},
    onSuccess: () => {
      clearReceipt();setReceipt(null);
      setReorderNeedsRefresh(false);
      setReorderReadError("");
      invalidateRequirementViews(client, requirement.id);
    },
    onError: async failure => {
      if(!isWriteOutcomeUnknown(failure)){setReceipt(null);clearReceipt();}
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
    mutationFn: async (draft: NewWorkItemDraft) => {await assertCleanRequirementDraft(session.accountId||'guest',requirement.id,{action:'edit'});setReceipt({kind:'create',draft});return api<WorkItem>(`/api/requirements/${requirement.id}/work-items`, {
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
    });},
    onSuccess: (_created, draft) => {
      clearReceipt();setReceipt(null);
      scrollAfterCreateCount.current = draft.sourceIds.length;
      setNewItem(null); clearNewItem(); setCreationOpen(false);
      setCreateUnknown(false);
      setCreateNeedsRefresh(false);
      setCreateReadError("");
      setCreateRefreshed(false);
      invalidateRequirementViews(client, requirement.id);
      if (initialCreate) onClose();
    },
    onError: async failure => {
      if(!isWriteOutcomeUnknown(failure)){setReceipt(null);clearReceipt();}
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
    setCreationOpen(true);
    if(newItem)return;
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

  const recheckOperation=async()=>{
    setReorderReading(true);setReorderReadError('');
    try{
      const latest=await onReload();
      const pending=receipt;
      const applied=pending?.kind==='reorder'?latest.version>pending.version&&JSON.stringify(latest.workItems.map(item=>item.id))===JSON.stringify(pending.ids):pending?.kind==='create'?latest.workItems.filter(item=>!pending.draft.sourceIds.includes(item.id)&&item.title===pending.draft.title.trim()&&(item.ownerId||'')===pending.draft.ownerId&&(item.plannedStart||'')===pending.draft.plannedStart&&(item.plannedEnd||'')===pending.draft.plannedEnd).length===1:false;
      if(!applied){setReorderReadError('已读取最新资料，仍无法确认原操作结果。原提交与输入已保留，请核对工作项及记录。');return;}
      setReceipt(null);clearReceipt();setCreateUnknown(false);setReorderUnknown(false);setNewItem(null);clearNewItem();setCreationOpen(false);setReorderNeedsRefresh(false);
    }catch(error){setReorderReadError(error instanceof Error?error.message:'读取失败');}finally{setReorderReading(false);}
  };

  const orderDisabledReason = requirementLocked
    ? `需求${{pending_acceptance:'待验收',completed:'已完成',cancelled:'已取消'}[requirement.status as 'pending_acceptance'|'completed'|'cancelled']}，暂不能新增、调整安排或排序。重新打开需求后可继续。`
    : !canEdit ? '当前无编辑权限或有待核对的修改，暂不能调整安排或排序。'
    : settingsUnknown || reorderNeedsRefresh ? '请先核对刚才的操作结果，再调整顺序。'
    : reorderItems.isPending || reorderReading ? '正在保存或读取顺序，请稍候。' : '';
  const moveItem = (index:number, direction:number) => {
    if(orderDisabledReason)return;
    const next=[...requirement.workItems],target=index+direction;
    if(target<0||target>=next.length)return;
    [next[index],next[target]]=[next[target],next[index]];reorderWorkItems(next);
  };
  const closeSettings = () => {
    if (createSubmitting.current || reorderSubmitting.current || createReadingRef.current || reorderReadingRef.current) return;
    onClose();
  };
  const closeCreation = () => {
    if (createSubmitting.current || createReadingRef.current) return;
    setCreationOpen(false);
    if (initialCreate) onClose();
  };

  const content = <>
      <div className="work-editor-modal">
        {!itemId&&<DetailToolbar><div className="work-editor-modal-toolbar">
          <span>{requirement.workItems.length} 个工作项 · {orderDisabledReason?'当前安排已锁定':'拖动手柄或使用上下移调整顺序'}</span>
          <div className="panel-actions">
            {canEdit&&onOpenDependencies&&<Button aria-label="前置关系与工期" title="前置关系与工期" variant="secondary" className="ghost-button" disabled={settingsUnknown} onClick={onOpenDependencies}>依赖</Button>}
            {canEdit&&canManageRequirement && (!requirement.workItems.length || requirement.workItems.some((item) => !['completed', 'cancelled'].includes(item.status) && (!item.plannedStart || !item.plannedEnd))) && <Button aria-label="补全计划" title="补全计划" variant="secondary" className="ghost-button" disabled={settingsUnknown} onClick={onOpenPlan}>排期</Button>}
            <Button variant="primary" aria-label="添加工作项" className="primary-button" disabled={!canEdit || settingsUnknown || createItem.isPending || createReading} title={orderDisabledReason||undefined} onClick={startNewItem}><Plus size={15} />新增</Button>
          </div>
        </div></DetailToolbar>}
        {!itemId&&orderDisabledReason&&<p className="work-order-notice" role="status">{orderDisabledReason}</p>}
        <FormError full={false}>{reorderItems.error?.message}</FormError>
        {settingsUnknown&&<p role="alert" className="warning-banner">刚才的提交结果待核对。请检查操作记录，本窗口不会重复提交。<Button variant="secondary" disabled={createItem.isPending||reorderItems.isPending||reorderReading} onClick={()=>void recheckOperation()}>核对本次操作</Button></p>}
        {reorderReadError&&!reorderNeedsRefresh&&<p role="alert">{reorderReadError}</p>}
        {reorderNeedsRefresh && <div className="warning-banner">工作项顺序未保存，请重新读取需求后再拖动排序。<Button busy={(reorderReading)} aria-label={reorderReading ? "读取中…" : "重新读取需求"} variant="secondary" type="button" className="ghost-button" disabled={reorderReading || reorderItems.isPending} onClick={() => void reloadDirectReorder()}>{"重新读取需求"}</Button>{reorderReadError && <FormError full={false}>{reorderReadError}</FormError>}</div>}
        <div className="work-editor-scroll" ref={editorScrollRef}><div className="work-arrangement-list">
          <SortableList
            items={itemId?requirement.workItems.filter(item=>item.id===itemId):requirement.workItems}
            getId={(item) => item.id}
            getPreview={item => ({title:item.title, detail:[item.ownerName || '未分派', item.plannedStart || '待排期', item.plannedEnd || '待定'].join(' · '), kind:'work'})}
            disabled={!!orderDisabledReason || !!itemId}
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
              const itemLocked = !canEdit || ["completed", "cancelled"].includes(item.status);
              const revisionProps = { revision: item.version, revisionSubject: "工作项", onReloadRevision: () => reloadWorkItemRevision(item.id) };
              const canDelete = canDeleteWorkItem(item, workItemHistoryIds.has(item.id));
              return <article ref={sortable.setNodeRef} data-work-id={item.id} className={`work-arrangement-row sortable-item${sortable.isDragging ? " is-dragging" : ""}${sortable.isOver ? " is-over" : ""}`}>
                {!itemId&&<div className="work-arrangement-heading"><button type="button" className="sortable-drag-handle" aria-label={`拖动${item.title}调整顺序`} title={orderDisabledReason||"拖动排序；空格选中、方向键移动、空格放下，Esc 取消"} disabled={!!orderDisabledReason || !!itemId} {...sortable.handleAttributes} {...sortable.handleListeners}><GripVertical size={16} /></button><WorkspaceObjectMark kind="work" status={item.status}/><button className="detail-work-row-title" onClick={()=>onInspect?.(item.id)}><strong>{item.title}</strong></button><span className="work-arrangement-state"><StatusBadge kind="workItem" value={item.status} />{gap.finishVariance!==0&&<small className={gap.finishVariance>0?'danger-text':'safe-text'}>{gap.finishVariance>0?'延期 ':'提前 '}{Math.abs(gap.finishVariance)}工作日</small>}</span><span className="work-arrangement-order"><Button variant="ghost" size="compact" iconOnly title={orderDisabledReason||'上移'} aria-label={'上移'+item.title} disabled={!!orderDisabledReason||_index===0} onClick={()=>moveItem(_index,-1)}><ArrowUp size={14}/></Button><Button variant="ghost" size="compact" iconOnly title={orderDisabledReason||'下移'} aria-label={'下移'+item.title} disabled={!!orderDisabledReason||_index===requirement.workItems.length-1} onClick={()=>moveItem(_index,1)}><ArrowDown size={14}/></Button></span></div>}
                <div className="work-arrangement-fields">
{itemId&&<><label className="work-arrangement-field"><span>名称</span><InlineTextCell {...revisionProps} disabled={itemLocked || settingsUnknown} value={item.title} label="工作项名称" required onSave={(title, expectedVersion, reason) => saveWorkItem(item, { title, ...(reason ? { reason } : {}) }, expectedVersion)} /></label><label className="work-arrangement-field"><span>阶段</span><InlineSelectCell {...revisionProps} disabled={itemLocked || settingsUnknown} value={item.workStage || ""} label="工作阶段" options={[{value:"",label:"未分类"},...workStages.map(value=>({value,label:workStageLabels[value]}))]} onSave={(workStage,reason,expectedVersion)=>saveWorkItem(item,{workStage:workStage as WorkStage || null,...reason?{reason}:{}},expectedVersion)}/></label></>}
<label className="work-arrangement-field"><span>负责人</span><div><InlineSelectCell {...revisionProps} disabled={itemLocked || settingsUnknown} value={item.ownerId} label="主负责人" options={[{ value: "", label: "未分配" }, ...assignmentOptions]} onSave={(ownerId, reason, expectedVersion) => saveWorkItem(item, { ownerId: ownerId || null, assigneeIds: [ownerId, ...item.collaborators.map((person) => person.id).filter((personId) => personId !== ownerId)].filter(Boolean), ...(reason ? { reason } : {}) }, expectedVersion)} placeholder="未分配" /></div></label>
<label className="work-arrangement-field"><span>协作人</span><div><InlineMultiSelectCell {...revisionProps} disabled={itemLocked || settingsUnknown} value={item.collaborators.map((person) => person.id)} label="协作人员" options={assignmentOptions} excludedValues={item.ownerId ? [item.ownerId] : []} onSave={(collaboratorIds, expectedVersion, reason) => saveWorkItem(item, { assigneeIds: [item.ownerId, ...collaboratorIds].filter(Boolean), ...(reason ? { reason } : {}) }, expectedVersion)} placeholder="无协作人员" renderValue={(selected) => selected.length ? <span className="inline-person-summary">{selected.slice(0, 2).map((person) => person.label).join("、")}{selected.length > 2 ? ` +${selected.length - 2}` : ""}</span> : "无协作人员"} /></div></label>
<label className="work-arrangement-field"><span>计划开始</span><div><InlineDateCell {...revisionProps} disabled={itemLocked || settingsUnknown} value={item.plannedStart} label="计划开始" onSave={(plannedStart, reason, expectedVersion) => saveWorkItem(item, { plannedStart, ...(reason ? { reason } : {}) }, expectedVersion)} /></div></label>
<label className="work-arrangement-field"><span>计划完成</span><div><InlineDateCell {...revisionProps} disabled={itemLocked || settingsUnknown} value={item.plannedEnd} label="计划完成" onSave={(plannedEnd, reason, expectedVersion) => saveWorkItem(item, { plannedEnd, ...(reason ? { reason } : {}) }, expectedVersion)} /></div></label>
                </div>
                <div className="work-arrangement-execution">{!itemId&&<WorkItemExecution requirement={requirement} item={item} people={people} presentation="detail" extraMenu={canEdit&&item.status==='not_started'?<Button variant="ghost" tone="danger" size="compact" disabled={!canDelete||settingsUnknown} title={canDelete?'删除工作项':'已有执行信息或进展历史，不能删除'} onClick={()=>setRemoveTarget(item)}>删除</Button>:undefined}>{({progress,actions})=><>{progress}{actions}</>}</WorkItemExecution>}{canEdit&&itemId&&item.status==='not_started'&&<Button variant="secondary" tone="danger" size="compact" title={canDelete?'删除工作项':'已有执行信息或进展历史，不能删除'} disabled={!canDelete||settingsUnknown} onClick={()=>setRemoveTarget(item)}><Trash2 size={14}/>删除</Button>}</div>
              </article>;
            }}
          />
        </div>
        {!requirement.workItems.length && !newItem && <EmptyState title="还没有工作项" detail="可新增工作项，或从通用研发模板补充。" />}
        </div>
      </div>
    </>;
  return <>
    {!initialCreate&&(embedded?content:<Modal title="工作项" width={960} layout="workspace" closable={!createItem.isPending&&!reorderItems.isPending} onClose={closeSettings}>{content}</Modal>)}
    {newItem && creationOpen && <Modal title="添加工作项" closable={!createItem.isPending && !createReading} onClose={closeCreation}>
      <form className="work-create-form" onSubmit={event => {event.preventDefault(); if (newItem.title.trim()) submitNewItem();}}>
        <fieldset className="form-grid form-fieldset" disabled={settingsUnknown || createItem.isPending || createReading}>
          <FormField label="新工作项名称" full><input autoFocus required value={newItem.title} onChange={event => setNewItem({...newItem, title: event.target.value})}/></FormField>
          <FormField label="工作阶段"><Select value={newItem.workStage || ''} onChange={event => setNewItem({...newItem, workStage: event.target.value as WorkStage || null})}><option value="">未分类</option>{workStages.map(stage => <option key={stage} value={stage}>{workStageLabels[stage]}</option>)}</Select></FormField>
          <FormField label="主负责人"><InlineSelectCell disabled={settingsUnknown || createItem.isPending || createReading} value={newItem.ownerId} label="新工作项主负责人" options={[{value:'', label:'未分配'}, ...eligiblePeople.map(person => ({value:person.id, label:person.name}))]} onSave={async ownerId => setNewItem(current => current && ({...current, ownerId, collaboratorIds: current.collaboratorIds.filter(personId => personId !== ownerId)}))} placeholder="未分配"/></FormField>
          <FormField label="协作人员" full><InlineMultiSelectCell disabled={settingsUnknown || createItem.isPending || createReading} value={newItem.collaboratorIds} label="新工作项协作人员" options={eligiblePeople.map(person => ({value:person.id, label:person.name}))} excludedValues={newItem.ownerId ? [newItem.ownerId] : []} onSave={async collaboratorIds => setNewItem(current => current && ({...current, collaboratorIds}))} placeholder="选择人员"/></FormField>
          <FormField label="计划开始"><input type="date" value={newItem.plannedStart} onChange={event => setNewItem({...newItem, plannedStart:event.target.value})}/></FormField>
          <FormField label="计划完成"><input type="date" value={newItem.plannedEnd} onChange={event => setNewItem({...newItem, plannedEnd:event.target.value})}/></FormField>
          <FormField label="变更说明（可选）" full><textarea rows={2} value={newItem.reason || ''} onChange={event => setNewItem({...newItem, reason:event.target.value})}/></FormField>
          <FormError>{createItem.error?.message}</FormError>
          <FormError>{createChanged ? '需求已更新，请重新读取并核对后再保存；新增草稿已保留。' : createReadError || undefined}</FormError>
          <FormError>{newItemHasUnavailablePeople ? '新增工作项选择的人员已不可用，请重新选择负责人或协作人员。' : undefined}</FormError>
          {createRefreshed && <p className="field-help field-full">已读取最新需求（版本 {newItem.baselineVersion}），新增草稿保持不变。</p>}
          {(createChanged || createNeedsRefresh) && <div className="field-full"><Button busy={(createReading)} aria-label={createReading ? '读取中…' : '重新读取需求'} variant="secondary" type="button" className="ghost-button" disabled={createReading || createItem.isPending} onClick={() => void reloadNewItem()}>{'重新读取需求'}</Button></div>}
          <FormSubmitActions submitLabel="保存工作项" pending={createItem.isPending || createReading} disabled={!newItem.title.trim() || createBlocked} onCancel={()=>{setNewItem(null);clearNewItem();closeCreation();}}/>
        </fieldset>
      </form>
    </Modal>}
    {removeTarget && <WorkItemDeleteDialog target={removeTarget} requirement={requirement} canManage onReload={onReload} onWriteNeedsRecheck={() => { setDeleteUnknown(true); onWriteNeedsRecheck(); }} onClose={() => setRemoveTarget(null)} />}
  </>;
}
