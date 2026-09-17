
import { Button } from "../Button";
import { useCallback, useEffect, useRef, useState } from "react";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { useBusinessDate } from "../../app-context";

import { type Revision, type BaseProps, type EditReason, useSaveState, useRevisionGuard, focusTrigger, EditableCell, EditorError, RevisionNotice } from './shared';
import { AnchoredPopover } from './popover';

export function dateFromIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateToIso(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function moveMonth(date: Date, offset: number) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1, 12);
}

export function monthLabel(date: Date) {
  return `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, "0")}月`;
}

export function calendarDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - mondayOffset, 12);
  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index, 12));
}

export function InlineDateCell<TRevision extends Revision = number>({
  value,
  onSave,
  label,
  className = "",
  disabled = false,
  allowClear = true,
  placeholder = "未设置",
  displayMode = "single",
  revision,
  revisionSubject = "记录",
  onReloadRevision,
  reason,
}: BaseProps<TRevision> & {
  value: string | null | undefined;
  onSave: (value: string | null, reason?: string, expectedRevision?: TRevision) => Promise<unknown>;
  allowClear?: boolean;
  reason?: EditReason;
}) {
  const { businessDate: today } = useBusinessDate();
  const currentValue = value || "";
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(currentValue);
  const [reasonText, setReasonText] = useState("");
  const [visibleMonth, setVisibleMonth] = useState(() => dateFromIso(currentValue) || dateFromIso(today)!);
  const feedback = useSaveState();
  const revisionGuard = useRevisionGuard({ revision, subject: revisionSubject, onReload: onReloadRevision, feedback });

  useEffect(() => {
    if (!open && feedback.state !== "saving" && feedback.state !== "error") setDraft(currentValue);
  }, [currentValue, feedback.state, open]);

  const cancel = useCallback((refocus = true) => {
    if (!feedback.isSaving()) {
      setDraft(currentValue);
      setReasonText("");
      feedback.clearError();
    }
    setOpen(false);
    if (refocus) focusTrigger(anchorRef);
  }, [currentValue, feedback]);

  const openPicker = useCallback(() => {
    if (feedback.state !== "error") {
      setDraft(currentValue);
      setReasonText("");
      revisionGuard.capture();
    }
    setVisibleMonth(dateFromIso(feedback.state === "error" ? draft : currentValue) || dateFromIso(today)!);
    feedback.clearError();
    setOpen(true);
  }, [currentValue, draft, feedback, revisionGuard, today]);

  const commit = useCallback(async () => {
    if (feedback.isSaving()) return;
    if (!allowClear && !draft) return feedback.fail(`${label}不能为空`);
    if (!revisionGuard.ensureCurrent()) return;
    if (draft === currentValue) {
      setOpen(false);
      setReasonText("");
      focusTrigger(anchorRef);
      return;
    }
    const normalizedReason = reasonText.trim();
    if (reason?.required && !normalizedReason) return feedback.fail(`${reason.label || "变更原因"}不能为空`);
    const saved = await feedback.save(() => onSave(draft || null, normalizedReason || undefined, revisionGuard.baselineRevision));
    if (saved) {
      setOpen(false);
      setReasonText("");
      focusTrigger(anchorRef);
    }
  }, [allowClear, currentValue, draft, feedback, label, onSave, reason?.label, reason?.required, reasonText, revisionGuard]);

  const monthDays = calendarDays(visibleMonth);
  return <div ref={anchorRef} className="inline-edit-anchor">
    <EditableCell label={label} display={currentValue || <span className="is-placeholder">{placeholder}</span>} fullText={currentValue || placeholder} open={open} disabled={disabled} state={feedback.state} error={feedback.error} displayMode={displayMode} className={className} onOpen={() => {
      openPicker();
    }}>
      <AnchoredPopover anchorRef={anchorRef} open={open} width={320} onOutside={() => cancel(false)} onEscape={cancel} onSuperseded={() => cancel(false)} className="inline-date-popover">
        <div className="inline-date-editor">
          <header>
            <Button variant="ghost" iconOnly type="button" aria-label="上一个月" onClick={() => setVisibleMonth((month) => moveMonth(month, -1))}><ChevronLeft size={16} /></Button>
            <strong>{monthLabel(visibleMonth)}</strong>
            <Button variant="ghost" iconOnly type="button" aria-label="下一个月" onClick={() => setVisibleMonth((month) => moveMonth(month, 1))}><ChevronRight size={16} /></Button>
          </header>
          <div className="inline-calendar-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
          <div className="inline-calendar-grid" role="grid" aria-label={label}>
            {monthDays.map((date) => {
              const iso = dateToIso(date);
              const outside = date.getMonth() !== visibleMonth.getMonth();
              return <button type="button" role="gridcell" key={iso} disabled={feedback.state === "saving"} className={`${outside ? "is-outside" : ""}${draft === iso ? " is-selected" : ""}${today === iso ? " is-today" : ""}`} aria-selected={draft === iso} aria-label={iso} onClick={() => { setDraft(iso); feedback.clearValidationError(); }}>{date.getDate()}</button>;
            })}
          </div>
          {reason && (draft !== currentValue || feedback.state === "saving") && <label className="inline-date-reason"><span>{reason.label || "变更原因"}{reason.required && <em>必填</em>}</span><textarea rows={3} autoFocus readOnly={feedback.state === "saving"} value={reasonText} onChange={(event) => { setReasonText(event.target.value); feedback.clearValidationError(); }} aria-label={reason.label || "变更原因"} placeholder={reason.placeholder || "请说明本次调整原因"} />{reason.help && <small>{reason.help}</small>}</label>}
          <EditorError error={feedback.error} />
          <RevisionNotice guard={revisionGuard} showReload={feedback.reloadRequired || revisionGuard.changed && feedback.state === "error"} subject={revisionSubject} />
          <footer>
            <div>{allowClear && <Button variant="link" type="button" disabled={feedback.state === "saving"} className="inline-date-clear" onClick={() => setDraft("")}>清除</Button>}<Button variant="link" type="button" disabled={feedback.state === "saving"} className="inline-date-today" onClick={() => { setDraft(today); setVisibleMonth(dateFromIso(today)!); }}>今天</Button></div>
            <div><Button variant="secondary" type="button" className="ghost-button" onClick={() => cancel()}>取消</Button><Button variant="primary" type="button" className="primary-button" disabled={feedback.state === "saving" || feedback.reloadRequired || revisionGuard.changed || revisionGuard.refreshing || draft === currentValue} onClick={() => void commit()}>保存</Button></div>
          </footer>
        </div>
      </AnchoredPopover>
    </EditableCell>
  </div>;
}
