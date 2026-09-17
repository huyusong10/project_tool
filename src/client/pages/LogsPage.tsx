import { searchAudit } from '../features/audit/api';
import { Button } from '../components/Button';
import { useLocation } from 'react-router-dom';
import { Select } from '../components/Select';
import { useListPagination } from '../use-list-pagination';
import { usePageSearchParams, usePageScrollPosition } from '../use-page-view';
import { readPagination } from '../pagination';
import { usePagedResourceQuery } from '../use-paged-resource-query';
import { useDeferredValue, useEffect, useState } from "react";
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
  feature: "特性", feature_relation: "特性规划关系", project: "项目", requirement: "需求", work_item: "工作项", progress: "进展",
  issue: "问题", issue_update: "问题进展", person: "人员", account: "账号", template: "流程设计", api_token: "MCP Token", backup: "数据库备份", system_branding: "系统品牌",
};

export function LogsPage() {
  const { session } = useSession();
  const { selectedProjectId } = useProjects();
  const { openLogin } = useUiActions();
  const location=useLocation(),admin = isAdmin(session)&&location.pathname!=='/project-logs';
  const [view, setView] = usePageSearchParams(['q','actorType','action','entityType','from','to','snapshot'], admin);
  const keyword = view.get('q') || '', deferredKeyword = useDeferredValue(keyword);
  const actorType = view.get('actorType') || '', action = view.get('action') || '', entityType = view.get('entityType') || '';
  const from = view.get('from') || '', to = view.get('to') || '';
  const { page, pageSize } = readPagination(view, 50, 'main', [20, 50]);
  const snapshot = view.get('snapshot');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (deferredKeyword.trim()) params.set('q', deferredKeyword.trim());
  for (const [key, value] of Object.entries({ actorType, action, entityType, from, to })) if (value) params.set(key, value);
  if (!admin && selectedProjectId) params.set('projectId', selectedProjectId);
  if (snapshot !== null) params.set('snapshot', snapshot);
  const filterKey = JSON.stringify([admin ? 'platform' : selectedProjectId, deferredKeyword, actorType, action, entityType, from, to]);
  const { data, isLoading, error, isFetching, clearError } = usePagedResourceQuery<AuditPage>(
    [...keys.auditSearch, filterKey, page, pageSize, snapshot, refreshVersion], signal => searchAudit(params, { signal }), filterKey, session.authenticated && (admin || Boolean(selectedProjectId)));
  const pagination = useListPagination({ total: data?.total || 0, filterKey, defaultPageSize: 50, options: [20, 50], personal: admin,
    ready: Boolean(data) && !error, loading: isFetching, serverPage: data?.page, serverPageSize: data?.pageSize, failed: Boolean(error) });
  usePageScrollPosition(!isLoading, admin);
  useEffect(() => {
    if (data && snapshot === null && !isFetching && !error) setView(current => { const next = new URLSearchParams(current); next.set('snapshot', String(data.snapshot)); return next; });
  }, [data, snapshot, isFetching, error, setView]);
  const updateFilter = (key: string, value: string) => setView(current => { const next = new URLSearchParams(current); next.set(key, value); next.set('page', '1'); next.delete('snapshot'); return next; });
  const refetch = () => { clearError(); setView(current => { const next = new URLSearchParams(current); next.delete('snapshot'); next.set('page', '1'); return next; }); setRefreshVersion(value => value + 1); };
  const listUnavailable = Boolean(error && !data);
  if (!session.authenticated) return <><PageHeader title="操作日志" /><div className="page-content"><EmptyState title="登录后查看操作日志" detail="网页和MCP写入会统一记录。" action={<Button variant="primary" className="primary-button" onClick={openLogin}>用户登录</Button>} /></div></>;
  return <>
    <PageHeader title={admin ? "操作审计" : "项目日志"} />
    <div className="page-content logs-page">
      <FilterBar className="audit-filters">
        <SearchInput value={keyword} onChange={(value) => updateFilter("q", value)} placeholder="搜索用户、Token、操作内容、实体ID或拼音" />
        <Select value={actorType} onChange={(event) => updateFilter("actorType", event.target.value)}><option value="">全部来源</option><option value="user">用户</option><option value="token">MCP Token</option></Select>
        <Select value={action} onChange={(event) => updateFilter("action", event.target.value)}><option value="">全部动作</option>{Object.entries(auditActionLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Select>
        <Select value={entityType} onChange={(event) => updateFilter("entityType", event.target.value)}><option value="">全部对象</option>{Object.entries(auditEntityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Select>
        <label className="audit-date"><span>从</span><input type="date" value={from} onChange={(event) => updateFilter("from", event.target.value)} /></label>
        <label className="audit-date"><span>至</span><input type="date" value={to} onChange={(event) => updateFilter("to", event.target.value)} /></label>
      </FilterBar>
      {error && data && <div className="warning-banner">操作日志刷新失败，当前展示的是上次成功结果。<Button variant="secondary" className="ghost-button" disabled={isFetching} onClick={() => void refetch()}>重新加载</Button></div>}
      <section className="panel audit-panel audit-page-panel paged-panel">
        <header><div><h2>写入记录</h2><p>共 {data?.total || 0} 条，按时间倒序</p></div><Button variant="secondary" type="button" className="ghost-button" disabled={isFetching} onClick={refetch}>刷新</Button></header>
        <div className="audit-table paged-body" ref={pagination.scrollRef}>
          <div className="audit-head"><span>时间</span><span>来源</span><span>对象</span><span>动作</span><span>内容</span></div>
          {data?.items.map((item) => <div key={item.id}>
            <span>{new Date(item.createdAt).toLocaleString("zh-CN")}</span>
            <span title={item.actorType === "token" && item.tokenName ? `MCP Token：${item.tokenName}` : undefined}>{item.actorName || "已删除用户"}{item.actorType === "token" && ` · MCP${item.tokenName ? `（${item.tokenName}）` : ""}`}</span>
            <span>{auditEntityLabels[item.entityType] || item.entityType}</span>
            <span>{auditActionLabels[item.action] || item.action}</span>
            <span title={item.entityId || undefined}>{item.summary}</span>
          </div>)}
          {listUnavailable
            ? <EmptyState title="操作日志加载失败" detail={error?.message || "暂时无法读取操作日志。"} action={<Button variant="secondary" className="ghost-button" disabled={isFetching} onClick={() => void refetch()}>重新加载</Button>} />
            : !data?.items.length && !isLoading && <EmptyState title="没有符合条件的日志" detail="调整搜索词或筛选条件后重试。" />}
        </div>
        {!listUnavailable && <Pagination {...pagination.props} label="日志分页" />}
      </section>
    </div>
  </>;
}
