import { Button } from './Button';
import type { ReactNode } from "react";

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="empty-state"><strong>{title}</strong><p>{detail}</p>{action}</div>;
}

/** 统一加载态：替代各页面一次性 loading class 与各异文案。 */
export function LoadingState({ label = "正在加载…", className = "" }: { label?: string; className?: string }) {
  return <div className={`loading-state${className ? ` ${className}` : ""}`} role="status"><span className="loading-spinner" aria-hidden="true" />{label}</div>;
}

export function RefreshNotice({ pending, onRetry }: { pending: boolean; onRetry: () => void }) {
  return <div className="query-refresh-notice" role="alert">
    <span><strong>刷新失败</strong>，暂时显示上次加载的数据，正在填写的内容已保留。</span>
    <Button busy={(pending)} aria-label={pending ? "重新加载中…" : "重新加载"} variant="secondary" type="button" className="ghost-button" disabled={pending} onClick={onRetry}>{"重新加载"}</Button>
  </div>;
}
