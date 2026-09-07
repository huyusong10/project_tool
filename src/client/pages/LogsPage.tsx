import { useDeferredValue, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useProjects, useSession, useUiActions } from "../app-context";
import { keys } from "../query-keys";
import type { AuditPage } from "../types";
import { EmptyState } from "../components/Feedback";
import { FilterBar } from "../components/FilterBar";
import { Pagination } from "../components/Pagination";
import { PageHeader } from "../components/PageHeader";
import { isAdmin } from "../permissions";
import { SearchInput } from "../components/SearchInput";

const auditActionLabels: Record<string, string> = {
  create: "创建", update: "修改", archive: "归档", restore: "恢复", delete: "删除",
  permanent_delete: "永久删除", start: "开始", complete: "完成", block: "阻塞",
  unblock: "解除阻塞", cancel: "取消", reorder: "排序", apply_template: "应用模板",
  apply_plan: "补全计划", revoke: "撤销", add_member: "添加成员", remove_member: "移出成员",
  reset_password: "重置密码", change_password: "修改密码", import: "导入",
};
const auditEntityLabels: Record<string, string> = {
  project: "项目", requirement: "需求", work_item: "工作项", progress: "进展",
  issue: "问题", issue_update: "问题进展", person: "人员", account: "账号", template: "流程设计", api_token: "MCP Token", backup: "数据库备份", system_branding: "系统品牌",
};

export function LogsPage() {
  const { session } = useSession();
  const { selectedProjectId } = useProjects();
  const { openLogin } = useUiActions();
  const admin = isAdmin(session);
  const [keyword, setKeyword] = useState("");
  const deferredKeyword = useDeferredValue(keyword);
  const [actorType, setActorType] = useState("");
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [snapshot, setSnapshot] = useState<number | null>(null);
  const params = new URLSearchParams({ page: String(page), pageSize: "50" });
  if (deferredKeyword.trim()) params.set("q", deferredKeyword.trim());
  if (actorType) params.set("actorType", actorType);
  if (action) params.set("action", action);
  if (entityType) params.set("entityType", entityType);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (!admin && selectedProjectId) params.set("projectId", selectedProjectId);
  if (page > 1 && snapshot !== null) params.set("snapshot", String(snapshot));
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: [...keys.auditSearch, selectedProjectId, admin, deferredKeyword, actorType, action, entityType, from, to, page],
    queryFn: ({ signal }) => api<AuditPage>(`/api/audit/search?${params}`, { signal }),
    enabled: session.authenticated && (admin || Boolean(selectedProjectId)),
  });
  const resetPage = (update: () => void) => { update(); setSnapshot(null); setPage(1); };
  const listUnavailable = Boolean(error && !data);
  const changePage = (nextPage: number) => {
    setSnapshot(nextPage === 1 ? null : (snapshot ?? data?.snapshot ?? null));
    setPage(nextPage);
  };
  if (!session.authenticated) return <><PageHeader title="操作日志" /><div className="page-content"><EmptyState title="登录后查看操作日志" detail="网页和MCP写入会统一记录。" action={<button className="primary-button" onClick={openLogin}>用户登录</button>} /></div></>;
  return <>
    <PageHeader title={admin ? "操作审计" : "项目日志"} />
    <div className="page-content logs-page">
      <FilterBar className="audit-filters">
        <SearchInput value={keyword} onChange={(value) => resetPage(() => setKeyword(value))} placeholder="搜索用户、Token、操作内容、实体ID或拼音" />
        <select value={actorType} onChange={(event) => resetPage(() => setActorType(event.target.value))}><option value="">全部来源</option><option value="user">用户</option><option value="token">MCP Token</option></select>
        <select value={action} onChange={(event) => resetPage(() => setAction(event.target.value))}><option value="">全部动作</option>{Object.entries(auditActionLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
        <select value={entityType} onChange={(event) => resetPage(() => setEntityType(event.target.value))}><option value="">全部对象</option>{Object.entries(auditEntityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
        <label className="audit-date"><span>从</span><input type="date" value={from} onChange={(event) => resetPage(() => setFrom(event.target.value))} /></label>
        <label className="audit-date"><span>至</span><input type="date" value={to} onChange={(event) => resetPage(() => setTo(event.target.value))} /></label>
      </FilterBar>
      {error && data && <div className="warning-banner">操作日志刷新失败，当前展示的是上次成功结果。<button className="ghost-button" disabled={isFetching} onClick={() => void refetch()}>重新加载</button></div>}
      <section className="panel audit-panel audit-page-panel">
        <header><div><h2>写入记录</h2><p>共 {data?.total || 0} 条，按时间倒序</p></div></header>
        <div className="audit-table">
          <div className="audit-head"><span>时间</span><span>来源</span><span>对象</span><span>动作</span><span>内容</span></div>
          {data?.items.map((item) => <div key={item.id}>
            <span>{new Date(item.createdAt).toLocaleString("zh-CN")}</span>
            <span title={item.actorType === "token" && item.tokenName ? `MCP Token：${item.tokenName}` : undefined}>{item.actorName || "已删除用户"}{item.actorType === "token" && ` · MCP${item.tokenName ? `（${item.tokenName}）` : ""}`}</span>
            <span>{auditEntityLabels[item.entityType] || item.entityType}</span>
            <span>{auditActionLabels[item.action] || item.action}</span>
            <span title={item.entityId || undefined}>{item.summary}</span>
          </div>)}
          {listUnavailable
            ? <EmptyState title="操作日志加载失败" detail={error?.message || "暂时无法读取操作日志。"} action={<button className="ghost-button" disabled={isFetching} onClick={() => void refetch()}>重新加载</button>} />
            : !data?.items.length && !isLoading && <EmptyState title="没有符合条件的日志" detail="调整搜索词或筛选条件后重试。" />}
        </div>
        {!listUnavailable && <Pagination page={data?.page || 1} pages={data?.pages || 1} onChange={changePage} />}
      </section>
    </div>
  </>;
}
