import { useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarDays, Check, CircleStop, MoreHorizontal, Play, RotateCcw, X } from "lucide-react";
import type { WorkItem } from "../types";
import { AnchoredPopover } from "./InlineEdit";

function ActionMenu({ children }: { children: ReactNode }) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const close = () => menuRef.current?.removeAttribute("open");

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (menuRef.current?.open && !menuRef.current.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !menuRef.current?.open) return;
      close();
      menuRef.current.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  return <details ref={menuRef} className="action-menu" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
  }}>
    <summary aria-label="更多工作项操作" title="更多操作"><MoreHorizontal size={16} /></summary>
    <div onClick={(event) => { if ((event.target as HTMLElement).closest("button")) close(); }}>{children}</div>
  </details>;
}

type TextPanel = "block" | "complete" | "reopen" | "cancel";

export function WorkItemActions({
  item,
  onAction,
  onSaveDates,
  onCancel,
  canManage = false,
}: {
  item: WorkItem;
  onAction: (action: "start" | "complete" | "block" | "unblock" | "reopen", content?: string) => Promise<unknown>;
  onSaveDates?: (input: { actualStart: string | null; actualEnd: string | null; reason: string }) => Promise<unknown>;
  onCancel?: (reason: string) => Promise<unknown>;
  canManage?: boolean;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<TextPanel | "dates" | null>(null);
  const [reason, setReason] = useState(item.blockedReason || "");
  const [actualStart, setActualStart] = useState(item.actualStart || "");
  const [actualEnd, setActualEnd] = useState(item.actualEnd || "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (panel !== "dates") return;
    setActualStart(item.actualStart || "");
    setActualEnd(item.actualEnd || "");
  }, [item.actualEnd, item.actualStart, panel]);

  const openPanel = (next: TextPanel | "dates") => { setReason(""); setError(""); setPanel(next); };
  const run = async (operation: () => Promise<unknown>) => {
    setPending(true); setError("");
    try {
      await operation();
      setPanel(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败，请重试");
    } finally { setPending(false); }
  };

  const canBlock = item.status === "in_progress";
  const canOpenMenu = canBlock || Boolean(canManage && (onSaveDates || onCancel));
  const textPanel = panel && panel !== "dates" ? panel : null;
  const textConfig: Record<TextPanel, { title: string; label: string; placeholder: string; confirm: string }> = {
    block: { title: "标记工作项阻塞", label: "阻塞原因", placeholder: "说明当前阻塞点", confirm: "确认阻塞" },
    complete: { title: "完成工作项", label: "完成说明", placeholder: "说明交付结果或验证结论", confirm: "确认完成" },
    reopen: { title: "重开工作项", label: "返工原因", placeholder: "说明为什么需要重开或返工", confirm: "确认重开" },
    cancel: { title: "取消工作项", label: "取消原因", placeholder: "说明为什么取消该工作项", confirm: "确认取消" },
  };

  const submitText = () => {
    if (!textPanel || !reason.trim()) return;
    if (textPanel === "cancel") {
      if (onCancel) void run(() => onCancel(reason.trim()));
      return;
    }
    void run(() => onAction(textPanel, reason.trim()));
  };

  return <div className="work-item-actions" ref={anchorRef} onClick={(event) => event.stopPropagation()}>
    <div className="work-item-action-row">
      {item.status === "not_started" && <button className="work-next-action" disabled={pending} onClick={() => void run(() => onAction("start"))}><Play size={14} />{pending ? "提交中" : "开始"}</button>}
      {item.status === "in_progress" && <button className="work-next-action" disabled={pending} onClick={() => openPanel("complete")}><Check size={14} />完成</button>}
      {item.status === "blocked" && <button className="work-next-action" disabled={pending} onClick={() => void run(() => onAction("unblock"))}><RotateCcw size={14} />{pending ? "提交中" : "解除阻塞"}</button>}
      {item.status === "completed" && <span className="work-action-state is-completed is-icon-only" role="img" aria-label="已完成" title="已完成"><Check size={16} /></span>}
      {item.status === "cancelled" && <span className="work-action-state is-cancelled is-icon-only" role="img" aria-label="已取消" title="已取消"><CircleStop size={16} /></span>}
      {canOpenMenu && <ActionMenu>
        {canManage && onSaveDates && <button onClick={() => openPanel("dates")}><CalendarDays size={14} />受控修正</button>}
        {canBlock && <button onClick={() => openPanel("block")}><CircleStop size={14} />标记阻塞</button>}
        {canManage && ["completed", "cancelled"].includes(item.status) && <button onClick={() => openPanel("reopen")}><RotateCcw size={14} />重开/返工</button>}
        {canManage && onCancel && !["completed", "cancelled"].includes(item.status) && <button className="danger" onClick={() => openPanel("cancel")}><CircleStop size={14} />取消工作项</button>}
      </ActionMenu>}
    </div>
    {error && panel === null && <small className="work-action-error" title={error}>{error}</small>}
    <AnchoredPopover anchorRef={anchorRef} open={Boolean(textPanel)} onOutside={() => setPanel(null)} width={390}>
      {textPanel && <form className="inline-action-form" onSubmit={(event) => { event.preventDefault(); submitText(); }}>
        <header><strong>{textConfig[textPanel].title}</strong><button type="button" onClick={() => setPanel(null)} aria-label="关闭"><X size={16} /></button></header>
        <label><span>{textConfig[textPanel].label}</span><textarea autoFocus rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={textConfig[textPanel].placeholder} /></label>
        {error && <p className="form-error">{error}</p>}
        <footer><button type="button" className="ghost-button" onClick={() => setPanel(null)}>取消</button><button className="primary-button" disabled={pending || !reason.trim()}>{textConfig[textPanel].confirm}</button></footer>
      </form>}
    </AnchoredPopover>
    <AnchoredPopover anchorRef={anchorRef} open={panel === "dates"} onOutside={() => setPanel(null)} width={390}>
      <form className="inline-action-form" onSubmit={(event) => {
        event.preventDefault();
        if (reason.trim() && onSaveDates) void run(() => onSaveDates({ actualStart: actualStart || null, actualEnd: actualEnd || null, reason: reason.trim() }));
      }}>
        <header><strong>高级修正实际日期</strong><button type="button" onClick={() => setPanel(null)} aria-label="关闭"><X size={16} /></button></header>
        <div className="inline-action-date-grid">
          <label><span>实际开始</span><input type="date" value={actualStart} onChange={(event) => setActualStart(event.target.value)} /></label>
          <label><span>实际完成</span><input type="date" value={actualEnd} onChange={(event) => setActualEnd(event.target.value)} /></label>
        </div>
        <label><span>纠错原因</span><textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="说明为什么修正历史数据" /></label>
        {error && <p className="form-error">{error}</p>}
        <footer><button type="button" className="ghost-button" onClick={() => setPanel(null)}>取消</button><button className="primary-button" disabled={pending || !reason.trim()}>保存纠错</button></footer>
      </form>
    </AnchoredPopover>
  </div>;
}
