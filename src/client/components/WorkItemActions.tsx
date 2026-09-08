import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, CircleStop, MoreHorizontal, Play, RotateCcw, X } from "lucide-react";
import { requiresWriteRecheck } from "../api";
import { useBusinessDate, useSession } from "../app-context";
import { invalidateRequirementViews } from "../query-keys";
import type { ProgressUpdate, WorkItem } from "../types";
import { canonicalizeContent } from "../../shared/search";
import { AnchoredPopover } from "./InlineEdit";
import { useToast } from "./Toast";

type TextPanel = "block" | "complete" | "reopen" | "cancel";
type Panel = TextPanel | "dates" | "menu" | "backfill";
export type WorkItemReloadSnapshot = { item: WorkItem; updates: ProgressUpdate[] };
type ExpectedOutcome = {
  matches: (latest: WorkItemReloadSnapshot) => boolean;
  reconciledMessage: string;
  successMessage?: string;
};

export function WorkItemActions({
  item,
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
}: {
  item: WorkItem;
  onAction: (action: "start" | "complete" | "block" | "unblock" | "reopen", content: string | undefined, expectedVersion: number) => Promise<unknown>;
  onSaveDates?: (input: { actualStart: string | null; actualEnd: string | null; reason: string; supersedesId: string | null }, expectedVersion: number) => Promise<unknown>;
  onCancel?: (reason: string, expectedVersion: number) => Promise<unknown>;
  onCompleteAsPlanned?: (expectedVersion: number) => Promise<unknown>;
  onReload: () => Promise<WorkItemReloadSnapshot>;
  hasExecutionHistory?: boolean;
  correctionCandidates?: ProgressUpdate[];
  canManage?: boolean;
  stateChangesDisabled?: boolean;
  startDisabledReason?: string;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const { businessDate: today } = useBusinessDate();
  const { session } = useSession();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [reason, setReason] = useState(item.blockedReason || "");
  const [actualStart, setActualStart] = useState(item.actualStart || "");
  const [actualEnd, setActualEnd] = useState(item.actualEnd || "");
  const [supersedesId, setSupersedesId] = useState("");
  const [pending, setPending] = useState(false);
  const [baselineVersion, setBaselineVersion] = useState(item.version);
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [error, setError] = useState("");
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [readError, setReadError] = useState("");
  const [refreshed, setRefreshed] = useState(false);
  const [validationError, setValidationError] = useState("");

  const openPanel = (next: Panel) => {
    // 输入和版本一起取自打开操作面板时的记录，后台刷新不能替换草稿的版本。
    setBaselineVersion(item.version);
    if (next === "dates") {
      setActualStart(item.actualStart || "");
      setActualEnd(item.actualEnd || "");
      setSupersedesId("");
    }
    setReason(""); setError(""); setReadError(""); setValidationError(""); setNeedsRefresh(false); setRefreshed(false); setPanel(next);
  };
  const readLatest = async () => {
    setNeedsRefresh(true); setReadError("");
    try {
      const latest = await onReload();
      if (!mounted.current) return null;
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
    if (submitting.current || (panel && needsRefresh) || operationUnavailable) return;
    submitting.current = true;
    setPending(true); setError("");
    try {
      await operation();
      setPanel(null);
      if (outcome.successMessage) toast.success(outcome.successMessage);
    } catch (caught) {
      if (!mounted.current) return;
      setError(caught instanceof Error ? caught.message : "操作失败，请重试");
      if (requiresWriteRecheck(caught)) {
        const latest = await readLatest();
        if (latest && outcome.matches(latest) && mounted.current) {
          invalidateRequirementViews(client, item.requirementId);
          setPanel(null);
          setError("");
          toast.success(outcome.reconciledMessage);
        }
      }
    } finally { submitting.current = false; if (mounted.current) setPending(false); }
  };

  const canBlock = !stateChangesDisabled && item.status === "in_progress";
  const canCorrect = canManage && onSaveDates && item.status !== "not_started";
  const canBackfill = !stateChangesDisabled && canManage && onCompleteAsPlanned && item.status === "not_started";
  const canOpenMenu = canBlock || canCorrect || canBackfill || Boolean(!stateChangesDisabled && canManage && (["completed", "cancelled"].includes(item.status) || onCancel));
  const backfillUnavailable = !item.plannedStart || !item.plannedEnd ? "请先补齐计划开始和完成日期。"
    : item.plannedStart > item.plannedEnd ? "计划完成日期不能早于开始日期。"
    : item.plannedEnd > today ? "计划尚未结束，暂不能补录完成。"
    : hasExecutionHistory ? "工作项已有执行记录，请使用正常完成或受控修正。" : "";
  const textPanel = panel && panel !== "dates" && panel !== "menu" && panel !== "backfill" ? panel : null;
  const operationUnavailable = panel === "dates" ? item.status === "not_started"
    : panel === "backfill" ? item.status !== "not_started"
    : textPanel === "complete" || textPanel === "block" ? item.status !== "in_progress"
    : textPanel === "reopen" ? !["completed", "cancelled"].includes(item.status)
    : textPanel === "cancel" ? ["completed", "cancelled"].includes(item.status) : false;
  const blocked = needsRefresh || operationUnavailable;
  const readNotice = <>
    {refreshed && <p>已读取最新工作项（版本 {baselineVersion}），本次输入已保留，请核对后重试。</p>}
    {operationUnavailable && <p className="form-error" role="alert">工作项状态已变化，请关闭后重新选择操作。</p>}
    {readError && <p className="form-error" role="alert">{readError}</p>}
    {needsRefresh && <button type="button" className="ghost-button" disabled={pending} onClick={() => void refresh()}>重新读取工作项</button>}
  </>;
  const textConfig: Record<TextPanel, { title: string; label: string; placeholder: string; confirm: string }> = {
    block: { title: "标记工作项阻塞", label: "阻塞原因", placeholder: "说明当前阻塞点", confirm: "确认阻塞" },
    complete: { title: "完成工作项", label: "完成说明", placeholder: "可选：补充交付结果或验证结论", confirm: "确认完成" },
    reopen: { title: "重开工作项", label: "返工原因", placeholder: "说明为什么需要重开或返工", confirm: "确认重开" },
    cancel: { title: "取消工作项", label: "取消原因", placeholder: "说明为什么取消该工作项", confirm: "确认取消" },
  };
  const matchesEvent = (latest: WorkItemReloadSnapshot, eventType: string, content: string) => latest.updates.some((update) => update.workItemId === item.id
    && update.eventType === eventType
    && update.content === canonicalizeContent(content)
    && update.createdByAccountId === session.accountId
    // 旧取消数据靠 updated_at 推断取消日期时纠错会保留原 updated_at（见 services.ts correctWorkItem），此时事件时间不等于记录时间。
    && (update.createdAt === latest.item.updatedAt || latest.item.updatedAt === item.updatedAt));
  const matchesCommandEvent = (
    latest: WorkItemReloadSnapshot,
    expectedVersion: number,
    eventType: string,
    content: string,
    matchesItem: (value: WorkItem) => boolean,
  ) => latest.item.version === expectedVersion + 1
    && matchesItem(latest.item)
    && matchesEvent(latest, eventType, content);

  const submitText = () => {
    if (!textPanel || (textPanel !== "complete" && !reason.trim())) return;
    const expectedVersion = baselineVersion;
    const expectedContent = reason.trim() || "完成工作项";
    if (textPanel === "cancel") {
      if (onCancel) void run(() => onCancel(expectedContent, expectedVersion), {
        matches: (latest) => matchesCommandEvent(latest, expectedVersion, "cancel", expectedContent, (value) => value.status === "cancelled"),
        reconciledMessage: "已核对最新状态：工作项已取消",
      });
      return;
    }
    const expectedStatus = textPanel === "complete" ? "completed" : textPanel === "block" ? "blocked" : null;
    void run(() => onAction(textPanel, textPanel === "complete" && !reason.trim() ? undefined : expectedContent, expectedVersion), {
      matches: (latest) => matchesCommandEvent(latest, expectedVersion, textPanel, expectedContent, (value) => expectedStatus
        ? value.status === expectedStatus
        : ["not_started", "in_progress"].includes(value.status)),
      reconciledMessage: textPanel === "complete" ? "已核对最新状态：工作项已完成"
        : textPanel === "block" ? "已核对最新状态：工作项已阻塞"
          : "已核对最新状态：工作项已重开",
    });
  };

  return <div className="work-item-actions" ref={anchorRef} onClick={(event) => event.stopPropagation()}>
    <div className="work-item-action-row">
      {!stateChangesDisabled && item.status === "not_started" && <button className="work-next-action" disabled={pending || Boolean(startDisabledReason)} title={startDisabledReason} onClick={() => void run(() => onAction("start", undefined, item.version), {
        matches: (latest) => matchesCommandEvent(latest, item.version, "start", "开始工作项", (value) => value.status === "in_progress"),
        reconciledMessage: "已核对最新状态：工作项已开始",
      })}><Play size={14} />{startDisabledReason ? "待规划" : pending ? "提交中" : "开始"}</button>}
      {!stateChangesDisabled && item.status === "in_progress" && <button className="work-next-action" disabled={pending} onClick={() => openPanel("complete")}><Check size={14} />完成</button>}
      {!stateChangesDisabled && item.status === "blocked" && <button className="work-next-action" disabled={pending} onClick={() => void run(() => onAction("unblock", undefined, item.version), {
        matches: (latest) => matchesCommandEvent(latest, item.version, "unblock", "解除阻塞工作项", (value) => value.status === "in_progress"),
        reconciledMessage: "已核对最新状态：工作项已解除阻塞",
      })}><RotateCcw size={14} />{pending ? "提交中" : "解除阻塞"}</button>}
      {item.status === "completed" && <span className="work-action-state is-completed is-icon-only" role="img" aria-label="已完成" title="已完成"><Check size={16} /></span>}
      {item.status === "cancelled" && <span className="work-action-state is-cancelled is-icon-only" role="img" aria-label="已取消" title="已取消"><CircleStop size={16} /></span>}
      {canOpenMenu && <button type="button" className="action-menu-trigger" aria-label="更多工作项操作" title="更多操作" aria-haspopup="dialog" aria-expanded={panel !== null} disabled={pending} onClick={() => panel === "menu" ? setPanel(null) : openPanel("menu")}><MoreHorizontal size={16} /></button>}
    </div>
    {error && panel === null && <small className="work-action-error" title={error}>{error}</small>}
    <AnchoredPopover anchorRef={anchorRef} open={panel !== null} onOutside={() => { if (!pending) setPanel(null); }} width={panel === "menu" ? 210 : 390} className={panel === "menu" ? "action-menu" : ""}>
      {panel === "menu" && <>
        {canCorrect && <button type="button" onClick={() => openPanel("dates")}><CalendarDays size={14} />受控修正实际日期</button>}
        {canBackfill && <button type="button" onClick={() => openPanel("backfill")}><Check size={14} />按期完成（历史补录）</button>}
        {canBlock && <button onClick={() => openPanel("block")}><CircleStop size={14} />标记阻塞</button>}
        {!stateChangesDisabled && canManage && ["completed", "cancelled"].includes(item.status) && <button onClick={() => openPanel("reopen")}><RotateCcw size={14} />重开/返工</button>}
        {!stateChangesDisabled && canManage && onCancel && !["completed", "cancelled"].includes(item.status) && <button className="danger" onClick={() => openPanel("cancel")}><CircleStop size={14} />取消工作项</button>}
      </>}
      {textPanel && <form className="inline-action-form" onSubmit={(event) => { event.preventDefault(); submitText(); }}>
        <header><strong>{textConfig[textPanel].title}</strong><button type="button" disabled={pending} onClick={() => setPanel(null)} aria-label="关闭"><X size={16} /></button></header>
        <label><span>{textConfig[textPanel].label}</span><textarea autoFocus readOnly={pending} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={textConfig[textPanel].placeholder} /></label>
        {textPanel === "complete" && <small className="form-hint">可留空，系统会记录“完成工作项”</small>}
        {error && <p className="form-error">{error}</p>}
        {readNotice}
        <footer><button type="button" className="ghost-button" disabled={pending} onClick={() => setPanel(null)}>取消</button><button className="primary-button" disabled={pending || blocked || (textPanel !== "complete" && !reason.trim())}>{pending ? "提交中" : textConfig[textPanel].confirm}</button></footer>
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
                  : !reason.trim() ? "请填写纠错原因。" : "";
        setValidationError(nextValidationError);
        if (!nextValidationError && onSaveDates) void run(
          () => onSaveDates({ actualStart: actualStart || null, actualEnd: correctedEnd || null, reason: reason.trim(), supersedesId: supersedesId || null }, baselineVersion),
          {
            matches: (latest) => latest.item.version === baselineVersion + 1
              && latest.item.status === item.status
              && latest.item.actualStart === (actualStart || null)
              && latest.item.actualEnd === (correctedEnd || null)
              && matchesEvent(latest, "correction", reason.trim()),
            successMessage: "实际日期已修正",
            reconciledMessage: "已核对最新状态：实际日期已修正",
          },
        );
      }}>
        <header><strong>受控修正实际日期</strong><button type="button" disabled={pending} onClick={() => setPanel(null)} aria-label="关闭"><X size={16} /></button></header>
        <p>仅修正历史实际日期，不改变工作项状态和进度；系统会保留原记录和纠错原因。</p>
        <div className="inline-action-date-grid">
          <label><span>实际开始{item.status !== "cancelled" && "（必填）"}</span><input aria-label="实际开始" type="date" disabled={pending} max={item.status === "cancelled" && item.cancelledAt ? item.cancelledAt : today} value={actualStart} onChange={(event) => { setActualStart(event.target.value); setValidationError(""); }} /></label>
          {item.status === "completed" && <label><span>实际完成（必填）</span><input aria-label="实际完成" type="date" disabled={pending} min={actualStart || undefined} max={today} value={actualEnd} onChange={(event) => { setActualEnd(event.target.value); setValidationError(""); }} /></label>}
        </div>
        {item.status === "cancelled" && item.cancelledAt && <small>取消日期：{item.cancelledAt}</small>}
        {!!correctionCandidates.length && <label><span>关联历史记录（可选）</span><select aria-label="工作项纠错关联历史记录" disabled={pending} value={supersedesId} onChange={(event) => setSupersedesId(event.target.value)}><option value="">不指定</option>{correctionCandidates.map((update) => <option value={update.id} key={update.id}>{new Date(update.createdAt).toLocaleDateString("zh-CN")} · {update.content.slice(0, 28)}</option>)}</select></label>}
        <label><span>纠错原因（必填）</span><textarea aria-label="纠错原因" readOnly={pending} rows={2} value={reason} onChange={(event) => { setReason(event.target.value); setValidationError(""); }} placeholder="说明为什么修正历史数据" /></label>
        {validationError && <p className="form-error" role="alert">{validationError}</p>}
        {error && <p className="form-error">{error}</p>}
        {error && (actualStart !== (item.actualStart || "") || actualEnd !== (item.actualEnd || "")) && <p>当前记录：{item.actualStart || "未填写"} 至 {item.actualEnd || "未填写"}。本次输入已保留，请核对后重试。</p>}
        {readNotice}
        <footer><button type="button" className="ghost-button" disabled={pending} onClick={() => setPanel(null)}>取消</button><button className="primary-button" disabled={pending || blocked}>{pending ? "保存中" : "保存纠错"}</button></footer>
      </form>}
      {panel === "backfill" && <div className="inline-action-form">
        <header><strong>按期完成（历史补录）</strong><button type="button" disabled={pending} onClick={() => setPanel(null)} aria-label="关闭"><X size={16} /></button></header>
        <p>实际开始：{item.plannedStart || "未排期"}<br />实际完成：{item.plannedEnd || "未排期"}</p>
        <p>确认这项历史工作已按计划完成。进度将设为 100%，记录“历史补录，按计划完成”。已有执行记录或未来计划不能使用此操作。</p>
        {backfillUnavailable && <p className="form-error" role="alert">{backfillUnavailable}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {readNotice}
        <footer><button type="button" className="ghost-button" disabled={pending} onClick={() => setPanel(null)}>取消</button><button type="button" className="primary-button" disabled={pending || blocked || Boolean(backfillUnavailable)} onClick={() => { if (onCompleteAsPlanned) void run(() => onCompleteAsPlanned(baselineVersion), {
          matches: (latest) => latest.item.version === baselineVersion + 1
            && latest.item.status === "completed"
            && latest.item.actualStart === item.plannedStart
            && latest.item.actualEnd === item.plannedEnd
            && matchesEvent(latest, "complete", `历史补录，按计划完成（${item.plannedStart} 至 ${item.plannedEnd}）`),
          successMessage: "工作项已按计划补录完成",
          reconciledMessage: "已核对最新状态：工作项已按计划补录完成",
        }); }}>{pending ? "提交中" : "确认补录完成"}</button></footer>
      </div>}
    </AnchoredPopover>
  </div>;
}
