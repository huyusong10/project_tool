import * as requirementsApi from '../features/requirements/api';
import { useDeliveryForm } from '../use-delivery-form';
import { useProjects } from '../app-context';
import { Button } from './Button';
import { Select } from './Select';
import { StartAssignmentDialog, type StartAssignment } from './StartAssignmentDialog';
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, CircleStop, MoreHorizontal, Play, RotateCcw } from "lucide-react";
import { isWriteOutcomeUnknown, requiresWriteRecheck } from "../api";
import { useBusinessDate } from "../app-context";
import { invalidateRequirementViews } from "../query-keys";
import type { ProgressUpdate, WorkItem, Requirement } from "../types";
import { progressReferenceLabel } from '../progress-trend';

import { AnchoredPopover } from './inline-edit/popover';
import { useToast } from "./Toast";
import { Modal } from './Modal';

type TextPanel = "complete";
type Panel = TextPanel | "dates" | "menu" | "backfill";
export type WorkItemReloadSnapshot = { item: WorkItem; updates: ProgressUpdate[] };
type ActionReceipt = {action:string; expectedVersion:number; body:Record<string,unknown>};
type ExpectedOutcome = {successMessage?: string; request:ActionReceipt};

function WorkActionSurface({anchorRef, panel, pending, onClose, children}: {anchorRef: RefObject<HTMLElement | null>; panel: Panel | null; pending: boolean; onClose: () => void; children: ReactNode}) {
  if (panel && panel !== 'menu') return <Modal title={{complete: '完成工作项', dates: '修正实际日期', backfill: '按期完成（历史补录）'}[panel]} width={480} closable={!pending} onClose={onClose}>{children}</Modal>;
  return <AnchoredPopover role={panel==='menu'?'menu':'dialog'} anchorRef={anchorRef} align={panel==='menu'?'end':'start'} open={panel !== null} onOutside={onClose} width={panel === 'menu' ? 210 : 390} className={panel === 'menu' ? 'action-menu' : ''}>{children}</AnchoredPopover>;
}

export function WorkItemActions({
  item,
  extraMenu,
  presentation="compact",
  onAction,
  onSaveDates,
  onCancel,
  onCompleteAsPlanned,
  onReload,
  hasExecutionHistory = false,
  correctionCandidates = [],
  canManage = false,
  stateChangesDisabled = false,
  startDisabledReason,
  onOpenChange,
  writeNeedsRecheck = false,
  onWriteNeedsRecheckChange,
}: {
  item: WorkItem;
  extraMenu?: ReactNode;
  presentation?: "compact" | "detail";
  onAction: (action: "start" | "complete" | "reopen", content: string | undefined, expectedVersion: number, expectedDependencyRevision?: number, assignment?: StartAssignment) => Promise<unknown>;
  onSaveDates?: (input: { actualStart: string | null; actualEnd: string | null; reason: string; supersedesId: string | null }, expectedVersion: number) => Promise<unknown>;
  onCancel?: (reason: string, expectedVersion: number) => Promise<unknown>;
  onCompleteAsPlanned?: (expectedVersion: number) => Promise<unknown>;
  onReload: () => Promise<WorkItemReloadSnapshot>;
  hasExecutionHistory?: boolean;
  correctionCandidates?: ProgressUpdate[];
  canManage?: boolean;
  stateChangesDisabled?: boolean;
  startDisabledReason?: string;
  onOpenChange?: (open: boolean) => void;
  writeNeedsRecheck?: boolean;
  onWriteNeedsRecheckChange?: (required: boolean) => void;
}) {
  const client = useQueryClient();
  const [startRequirement,setStartRequirement]=useState<Requirement|null>(null);
  const [preparingStart,setPreparingStart]=useState(false);
  const startReading=useRef(false);
  const toast = useToast();
  const { businessDate: today } = useBusinessDate();

  const {selectedProjectId}=useProjects();
  const [input,setInput,clearInput]=useDeliveryForm(selectedProjectId,item.id+':action-input',()=>({reason:'',actualStart:item.actualStart||'',actualEnd:item.actualEnd||'',supersedesId:'',baselineVersion:item.version,action:null as Panel|null}));
  const [receipt,setReceipt,clearReceipt]=useDeliveryForm<ActionReceipt|null>(selectedProjectId,item.id+':action-receipt',()=>null);
  const receiptRef=useRef(receipt);
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const historyOptions = useMemo(() => panel === 'dates' ? correctionCandidates
    .map(update => <option value={update.id} key={update.id}>{progressReferenceLabel(update)} · {update.content}</option>) : [], [panel, correctionCandidates]);
  const reason=input.reason, setReason=(reason:string)=>setInput(value=>({...value,reason}));
  const actualStart=input.actualStart, setActualStart=(actualStart:string)=>setInput(value=>({...value,actualStart}));
  const actualEnd=input.actualEnd, setActualEnd=(actualEnd:string)=>setInput(value=>({...value,actualEnd}));
  const supersedesId=input.supersedesId, setSupersedesId=(supersedesId:string)=>setInput(value=>({...value,supersedesId}));
  const [pending, setPending] = useState(false);
  const baselineVersion=input.baselineVersion, setBaselineVersion=(baselineVersion:number)=>setInput(value=>({...value,baselineVersion}));
  const submitting = useRef(false);
  const unknownVersion=useRef<number|null>(receipt?.expectedVersion??null);const [reviewRequired,setReviewRequired]=useState(false);
  const [unknownNeedsRead,setUnknownNeedsRead]=useState(!!receipt);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [error, setError] = useState("");
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [readError, setReadError] = useState("");
  const [refreshed, setRefreshed] = useState(false);
  const [validationError, setValidationError] = useState("");
  const changePanel = (next: Panel | null) => { setPanel(next); onOpenChange?.(next !== null); };
  const actionReviewBlocked = writeNeedsRecheck || unknownNeedsRead || reviewRequired;

  const openPanel = (next: Panel) => {
    if(actionReviewBlocked)return;
    if(next!=='menu'&&input.action===next){changePanel(next);return;}
    if(next==='menu'){changePanel(next);return;}
    setInput(value=>({...value,action:next}));
    // 输入和版本一起取自打开操作面板时的记录，后台刷新不能替换草稿的版本。
    unknownVersion.current=null;setReviewRequired(false);
    setBaselineVersion(item.version);
    if (next === "dates") {
      setActualStart(item.actualStart || "");
      setActualEnd(item.actualEnd || "");
      setSupersedesId("");
    }
    setReason(""); setError(""); setReadError(""); setValidationError(""); setNeedsRefresh(false); setRefreshed(false); changePanel(next);
  };
  const readLatest = async () => {
    setNeedsRefresh(true); setReadError("");
    try {
      const latest = await onReload();
      if (!mounted.current) return null;
      if (startRequirement) {
        const parent = await requirementsApi.requirementsById<Requirement>(item.requirementId);
        if (!mounted.current) return null;
        setStartRequirement(parent);
      }
      const unknownBaseline=unknownVersion.current;
      setReviewRequired(!!receiptRef.current||unknownBaseline!==null&&latest.item.version!==unknownBaseline);
      if(unknownBaseline!==null){unknownVersion.current=null;setUnknownNeedsRead(false);}
      if(!receiptRef.current)onWriteNeedsRecheckChange?.(false);
      setBaselineVersion(latest.item.version); setNeedsRefresh(false); setRefreshed(true);
      return latest;
    } catch (caught) {
      if (mounted.current) setReadError(caught instanceof Error ? caught.message : "工作项读取失败");
      return null;
    }
  };
  const refresh = async () => {
    if (submitting.current) return;
    submitting.current = true; setPending(true);
    try { await readLatest(); }
    finally { submitting.current = false; if (mounted.current) setPending(false); }
  };
  const run = async (operation: () => Promise<unknown>, outcome: ExpectedOutcome) => {
    if (submitting.current || actionReviewBlocked || needsRefresh || operationUnavailable) return;
    submitting.current = true;
    setPending(true); setError("");
    receiptRef.current=outcome.request;setReceipt(outcome.request);
    try {
      await operation();
      receiptRef.current=null;setReceipt(null);clearReceipt();
      clearInput();setInput(value=>({...value,action:null,reason:''}));changePanel(null);
      if (outcome.successMessage) toast.success(outcome.successMessage);
      return true;
    } catch (caught) {
      if(!isWriteOutcomeUnknown(caught)){receiptRef.current=null;setReceipt(null);clearReceipt();}
      if (!mounted.current) return;
      setError(caught instanceof Error ? caught.message : "操作失败，请重试");
      if (requiresWriteRecheck(caught)) {
        if (isWriteOutcomeUnknown(caught)) {
          unknownVersion.current = panel ? baselineVersion : item.version;
          setUnknownNeedsRead(true);
          onWriteNeedsRecheckChange?.(true);
        }
        await readLatest();invalidateRequirementViews(client,item.requirementId,'execution');
      }
    } finally { submitting.current = false; if (mounted.current) setPending(false); }
  };

  const start = async () => {
    if(startReading.current||submitting.current||actionReviewBlocked)return;
    startReading.current=true;setPreparingStart(true);setError('');
    try{
      const requirement=await requirementsApi.requirementsById<Requirement>(item.requirementId);
      if(!mounted.current)return;
      if(!item.ownerId||!requirement.ownerId||requirement.ownerValid===false)setStartRequirement(requirement);
      else await run(()=>onAction('start',undefined,item.version),{successMessage:'工作项已开始',request:{action:'start',expectedVersion:item.version,body:{}}});
    }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'读取负责人失败，请重试');}
    finally{startReading.current=false;if(mounted.current)setPreparingStart(false);}
  };
  const canCorrect = canManage && onSaveDates && item.status !== "not_started";
  const canBackfill = !stateChangesDisabled && canManage && onCompleteAsPlanned && item.status === "not_started";
  const canOpenMenu = Boolean(extraMenu) || canCorrect || canBackfill || Boolean(!stateChangesDisabled && canManage && (["completed", "cancelled"].includes(item.status) || onCancel));
  const backfillUnavailable = !item.plannedStart || !item.plannedEnd ? "请先补齐计划开始和完成日期。"
    : item.plannedStart > item.plannedEnd ? "计划完成日期不能早于开始日期。"
    : item.plannedEnd > today ? "计划尚未结束，暂不能补录完成。"
    : hasExecutionHistory ? "工作项已有执行记录，请使用正常完成或修正。" : "";
  const textPanel = panel && panel !== "dates" && panel !== "menu" && panel !== "backfill" ? panel : null;
  const operationUnavailable = panel === "dates" ? item.status === "not_started"
    : panel === "backfill" ? item.status !== "not_started"
    : textPanel === "complete" ? item.status !== "in_progress"
    : false;
  const blocked = needsRefresh || operationUnavailable || reviewRequired;
  const finishReview=()=>{receiptRef.current=null;setReceipt(null);clearReceipt();unknownVersion.current=null;setReviewRequired(false);setUnknownNeedsRead(false);onWriteNeedsRecheckChange?.(false);changePanel(null);};
  const finishReviewButton=receipt&&reviewRequired&&<Button variant="secondary" size="compact" aria-label="已核对，结束本次操作" title="已核对，结束本次操作" disabled={pending||needsRefresh} onClick={finishReview}>结束</Button>;
  const readNotice = <>
    {reviewRequired&&<p className="form-error">提交结果仍待核对，版本已变化。本窗口不再提交，请核对执行记录；已填内容保留。</p>}
    {refreshed && <p>已读取最新工作项（版本 {baselineVersion}），本次输入已保留，请核对后重试。</p>}
    {operationUnavailable && <p className="form-error" role="alert">工作项状态已变化，请关闭后重新选择操作。</p>}
    {readError && <p className="form-error" role="alert">{readError}</p>}
    {needsRefresh && <Button variant="secondary" type="button" className="ghost-button" disabled={pending} aria-label="重新读取工作项" title="重新读取工作项" onClick={() => void refresh()}>重读</Button>}
    {finishReviewButton}
  </>;
  const textConfig: Record<TextPanel, { title: string; label: string; placeholder: string; confirm: string }> = {
    complete: { title: "完成工作项", label: "完成说明（可选）", placeholder: "可选：补充交付结果或验证结论", confirm: "确定" },
  };
  const submitText = () => {
    if (!textPanel) return;
    const expectedVersion = baselineVersion;
    void run(() => onAction("complete", reason.trim() || undefined, expectedVersion), {successMessage:"工作项已完成",request:{action:"complete",expectedVersion,body:{content:reason.trim()||undefined}}});
  };
  const terminalState = item.status === "completed"
    ? <span className="work-action-state is-completed is-icon-only" role="img" aria-label="已完成" title="已完成"><Check size={16} /></span>
    : item.status === "cancelled"
      ? <span className="work-action-state is-cancelled is-icon-only" role="img" aria-label="已取消" title="已取消"><CircleStop size={16} /></span>
      : null;

  const datesAction = canCorrect && <Button aria-label="修正实际日期" title="修正实际日期" variant={presentation==='detail'?'ghost':'menu'} size="compact" disabled={pending || actionReviewBlocked || needsRefresh} type="button" onClick={() => openPanel("dates")}>{presentation!=="detail"&&<CalendarDays size={14} />}修正</Button>;
  const backfillAction = canBackfill && <Button aria-label="按期完成（历史补录）" title="按期完成（历史补录）" variant={presentation==='detail'?'ghost':'menu'} size="compact" disabled={pending || actionReviewBlocked || needsRefresh} type="button" onClick={() => openPanel("backfill")}>{presentation!=="detail"&&<Check size={14} />}补录</Button>;
  const reopenAction = !stateChangesDisabled && canManage && ["completed", "cancelled"].includes(item.status) && <Button aria-label="重开/返工" title="重开/返工" width={presentation==='detail'?'action':undefined} variant={presentation==='detail'?'secondary':'menu'} size="compact" disabled={pending || actionReviewBlocked || needsRefresh} onClick={() => void run(() => onAction("reopen", undefined, item.version), {successMessage:"工作项已重新打开",request:{action:"reopen",expectedVersion:item.version,body:{}}})}><RotateCcw size={14} />重开</Button>;
  const cancelAction = !stateChangesDisabled && canManage && onCancel && !["completed", "cancelled"].includes(item.status) && <Button aria-label="取消工作项" title="取消工作项" variant={presentation==='detail'?'ghost':'menu'} size="compact" disabled={pending || actionReviewBlocked || needsRefresh} tone="danger" className="danger" onClick={() => { if (onCancel) void run(() => onCancel("", item.version), {successMessage:"工作项已取消",request:{action:"cancel",expectedVersion:item.version,body:{reason:""}}}); }}>{presentation!=="detail"&&<CircleStop size={14} />}取消</Button>;
  const secondaryActions = <>{extraMenu}{datesAction}{backfillAction}{reopenAction}{cancelAction}</>;

  return <div className={"work-item-actions"+(presentation==='detail'?' work-item-actions-detail':'')} ref={anchorRef} onClick={(event) => event.stopPropagation()}>
    <div className="work-item-action-row">
      {actionReviewBlocked || needsRefresh ? <>{presentation!=="detail"&&terminalState}<Button variant="secondary" size="compact" width="action" type="button" className="work-next-action" disabled={pending} aria-label="重新读取工作项" title="重新读取工作项" onClick={() => void refresh()}>重读</Button></> : <>
        {!stateChangesDisabled && item.status === "not_started" && <Button variant="secondary" size="compact" width="action" className="work-next-action execution-action" data-action="start" busy={pending || preparingStart} disabled={pending || preparingStart || Boolean(startDisabledReason)} title={startDisabledReason} onClick={() => void start()}><Play size={14} />开始</Button>}
        {!stateChangesDisabled && item.status === "in_progress" && <Button variant="soft" tone="success" size="compact" width="action" className="work-next-action execution-action" data-action="complete" disabled={pending} onClick={() => openPanel("complete")}><Check size={14} />完成</Button>}
        {presentation==="detail"&&reopenAction}
        {presentation!=="detail"&&terminalState}
        {canOpenMenu && presentation!=="detail" && <Button size="compact" variant="ghost" iconOnly type="button" ref={menuRef} className="action-menu-trigger" aria-label="更多工作项操作" title="更多操作" aria-haspopup="dialog" aria-expanded={panel !== null} disabled={pending} onClick={() => panel === "menu" ? changePanel(null) : openPanel("menu")}><MoreHorizontal size={16} /></Button>}
      </>}
    </div>
    {presentation==="detail"&&<div className="work-item-secondary-actions"><span className="work-action-slot" data-work-action="dates">{datesAction}{backfillAction}</span><span className="work-action-slot" data-work-action="cancel">{cancelAction}</span><span className="work-action-slot" data-work-action="delete">{extraMenu}</span></div>}
    {actionReviewBlocked && panel === null && <small className="work-action-error" role="alert">{unknownNeedsRead || writeNeedsRecheck ? "工作项操作结果待核对" : "提交结果仍待核对，工作项版本已变化"}{readError ? `：${readError}` : ""}</small>}
    {!panel&&finishReviewButton}
    {error && panel === null && !actionReviewBlocked && <small className="work-action-error" title={error}>{error}</small>}
    {startRequirement&&<StartAssignmentDialog requirement={startRequirement} workItem={item} pending={pending} blocked={actionReviewBlocked||needsRefresh} recovery={(actionReviewBlocked||needsRefresh)&&<p className="warning-banner">请先关闭此窗口，读取最新状态并核对执行记录，再继续操作。</p>} error={error} onClose={()=>setStartRequirement(null)} onStart={assignment=>run(()=>onAction('start',undefined,item.version,undefined,assignment),{successMessage:'工作项已开始',request:{action:'start',expectedVersion:item.version,body:{...assignment}}}).then(saved=>{if(saved)setStartRequirement(null);return !!saved;})}/>}
    <WorkActionSurface anchorRef={panel==='menu'?menuRef:anchorRef} panel={panel} pending={pending} onClose={() => { if (!pending) changePanel(null); }}>
      {panel === "menu" && secondaryActions}
      {textPanel && <form className="inline-action-form" onSubmit={(event) => { event.preventDefault(); submitText(); }}>
        <p className="work-complete-summary">确认完成 <strong>{item.title}</strong>？</p>
        <label><span>{textConfig[textPanel].label}</span><textarea autoFocus readOnly={pending} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={textConfig[textPanel].placeholder} /></label>
        {textPanel === "complete" && <small className="form-hint">可留空，系统会记录“完成工作项”</small>}
        {error && <p className="form-error">{error}</p>}
        {readNotice}
        <footer><Button variant="secondary" type="button" className="ghost-button" disabled={pending} onClick={() => {clearInput();setInput(value=>({...value,action:null,reason:''}));changePanel(null);}}>取消</Button><Button busy={(pending)} aria-label={pending ? "提交中" : "确认完成"} variant="soft" tone="success" type="submit" className="primary-button" disabled={pending || blocked}>{textConfig[textPanel].confirm}</Button></footer>
      </form>}
      {panel === "dates" && <form className="inline-action-form" noValidate onSubmit={(event) => {
        event.preventDefault();
        const correctedEnd = item.status === "completed" ? actualEnd : "";
        const maximumStart = item.status === "cancelled" && item.cancelledAt ? item.cancelledAt : today;
        const nextValidationError = item.status !== "cancelled" && !actualStart
          ? "请选择实际开始日期。"
          : item.status === "completed" && !correctedEnd
            ? "请选择实际完成日期。"
            : actualStart > maximumStart
              ? item.status === "cancelled" && item.cancelledAt ? `实际开始日期不能晚于取消日期（${item.cancelledAt}）。` : "实际开始日期不能晚于今天。"
              : correctedEnd > today
              ? "实际日期不能晚于今天。"
              : actualStart && correctedEnd && correctedEnd < actualStart
                ? "实际完成日期不能早于实际开始日期。"
                : actualStart === (item.actualStart || "") && correctedEnd === (item.actualEnd || "") && !supersedesId
                  ? "实际日期没有变化，无需保存。"
                  : "";
        setValidationError(nextValidationError);
        if (!nextValidationError && onSaveDates) void run(
          () => onSaveDates({ actualStart: actualStart || null, actualEnd: correctedEnd || null, reason: reason.trim(), supersedesId: supersedesId || null }, baselineVersion),
          {successMessage:"实际日期已修正",request:{action:"dates",expectedVersion:baselineVersion,body:{actualStart:actualStart||null,actualEnd:correctedEnd||null,reason:reason.trim(),supersedesId:supersedesId||null}}},
        );
      }}>
        <p>仅修正历史实际日期，不改变工作项状态和进度；系统会保留原记录和纠错原因。</p>
        <div className="inline-action-date-grid">
          <label><span>实际开始{item.status !== "cancelled" && "（必填）"}</span><input aria-label="实际开始" type="date" disabled={pending} max={item.status === "cancelled" && item.cancelledAt ? item.cancelledAt : today} value={actualStart} onChange={(event) => { setActualStart(event.target.value); setValidationError(""); }} /></label>
          {item.status === "completed" && <label><span>实际完成（必填）</span><input aria-label="实际完成" type="date" disabled={pending} min={actualStart || undefined} max={today} value={actualEnd} onChange={(event) => { setActualEnd(event.target.value); setValidationError(""); }} /></label>}
        </div>
        {item.status === "cancelled" && item.cancelledAt && <small>取消日期：{item.cancelledAt}</small>}
        {!!historyOptions.length && <label><span>关联历史记录（可选）</span><Select aria-label="工作项纠错关联历史记录" disabled={pending} value={supersedesId} onChange={(event) => setSupersedesId(event.target.value)}><option value="">不指定</option>{historyOptions}</Select></label>}
        <label><span>纠错说明（可选）</span><textarea aria-label="纠错原因" readOnly={pending} rows={2} value={reason} onChange={(event) => { setReason(event.target.value); setValidationError(""); }} placeholder="说明为什么修正历史数据" /></label>
        {validationError && <p className="form-error" role="alert">{validationError}</p>}
        {error && <p className="form-error">{error}</p>}
        {error && (actualStart !== (item.actualStart || "") || actualEnd !== (item.actualEnd || "")) && <p>当前记录：{item.actualStart || "未填写"} 至 {item.actualEnd || "未填写"}。本次输入已保留，请核对后重试。</p>}
        {readNotice}
        <footer><Button variant="secondary" type="button" className="ghost-button" disabled={pending} onClick={() => {clearInput();setInput(value=>({...value,action:null,reason:''}));changePanel(null);}}>取消</Button><Button busy={(pending)} aria-label={pending ? "保存中" : "保存纠错"} variant="primary" type="submit" className="primary-button" disabled={pending || blocked}>{"保存纠错"}</Button></footer>
      </form>}
      {panel === "backfill" && <div className="inline-action-form">
        <p>实际开始：{item.plannedStart || "未排期"}<br />实际完成：{item.plannedEnd || "未排期"}</p>
        <p>确认这项历史工作已按计划完成。进度将设为 100%，记录“历史补录，按计划完成”。已有执行记录或未来计划不能使用此操作。</p>
        {backfillUnavailable && <p className="form-error" role="alert">{backfillUnavailable}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {readNotice}
        <footer><Button variant="secondary" type="button" className="ghost-button" disabled={pending} onClick={() => {clearInput();setInput(value=>({...value,action:null,reason:''}));changePanel(null);}}>取消</Button><Button busy={(pending)} aria-label={pending ? "提交中" : "确认补录完成"} variant="soft" tone="success" type="button" className="primary-button" disabled={pending || blocked || Boolean(backfillUnavailable)} onClick={() => { if (onCompleteAsPlanned) void run(() => onCompleteAsPlanned(baselineVersion), {successMessage:"工作项已按计划补录完成",request:{action:"complete-as-planned",expectedVersion:baselineVersion,body:{}}}); }}>{"确认补录完成"}</Button></footer>
      </div>}
    </WorkActionSurface>
  </div>;
}
