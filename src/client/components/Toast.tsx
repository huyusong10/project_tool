import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";

export type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; kind: ToastKind; message: string };

type ToastContextValue = {
  push: (kind: ToastKind, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("ToastContext未初始化");
  return context;
}

const MAX_TOASTS = 5;

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const Icon = item.kind === "success" ? CheckCircle2 : item.kind === "error" ? CircleAlert : Info;
  return (
    <div className={`toast toast-${item.kind}`} role={item.kind === "error" ? "alert" : "status"}>
      <Icon size={17} aria-hidden="true" />
      <span className="toast-message">{item.message}</span>
      <button type="button" className="toast-close" aria-label="关闭通知" onClick={() => onDismiss(item.id)}>
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = ++nextId.current;
    setItems((current) => [...current.slice(-(MAX_TOASTS - 1)), { id, kind, message }]);
    timers.current.set(id, setTimeout(() => dismiss(id), kind === "error" ? 5200 : 3400));
  }, [dismiss]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => clearTimeout(timer));
  }, []);

  const value = useMemo<ToastContextValue>(() => ({
    push,
    success: (message) => push("success", message),
    error: (message) => push("error", message),
    info: (message) => push("info", message),
  }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {typeof document === "undefined" ? null : createPortal(
        <div className="toast-region" aria-label="操作反馈">
          {items.map((item) => <ToastCard key={item.id} item={item} onDismiss={dismiss} />)}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
