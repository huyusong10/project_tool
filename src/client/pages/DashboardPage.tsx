import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  CircleDot,
  Plus,
} from "lucide-react";
import { api } from "../api";
import { useProjects, useSession, useUiActions } from "../app-context";
import { keys } from "../query-keys";
import type { Dashboard } from "../types";
import { issueStatusLabels } from "../../shared/domain";
import { EmptyState, LoadingState } from "../components/Feedback";
import { MetricCard } from "../components/MetricCard";
import { ProjectGantt } from "../components/ProjectGantt";
import { PageHeader } from "../components/PageHeader";
import { ProjectForm } from "../components/ManagementForms";
import { isAdmin } from "../permissions";
import { dashboardOverview, type DashboardOverview, type DashboardScope } from '../../shared/dashboard';
import { todayIso } from '../../shared/domain';
import { useProjectGanttFilters, type ProjectGanttFilters } from '../use-project-gantt-filters';

function DashboardMetrics({ overview, filters }: { overview?: DashboardOverview; filters: ProjectGanttFilters }) {
  const count = (scope: DashboardScope) => overview?.counts[scope] ?? '—';
  const select = (scope: DashboardScope, text: string, title?: string) => <button type="button" className="stat-detail-button"
    onClick={() => filters.selectScope(scope)} title={title} aria-pressed={filters.isScopeSelected(scope)}>{text}</button>;
  const range = overview ? `${overview.asOfDate.slice(5).replace('-', '/')}—${overview.dueThrough.slice(5).replace('-', '/')}` : '—';
  return <section className="stats-grid dashboard-top-stats" aria-label="项目需求概览">
    <MetricCard label="进行中" value={count('in_progress')} icon={CircleDot} tone="blue"
      onClick={() => filters.selectScope('in_progress')} selected={filters.isScopeSelected('in_progress')} title="查看当前项目全部进行中的需求"
      detail={<>{select('not_started', `未开始 ${count('not_started')}`)}{Boolean(overview?.counts.uncertain) && <> · {select('uncertain', `待确认 ${count('uncertain')}`, '未结束需求中，排期不完整或风险待评估的去重数量；不作为低风险处理')}</>}</>} />
    <MetricCard label="需要关注" value={count('attention')} icon={AlertTriangle} tone="red"
      onClick={() => filters.selectScope('attention')} selected={filters.isScopeSelected('attention')} title="未结束需求中，已延期或高风险的去重数量"
      detail={<>{select('delayed', `已延期 ${count('delayed')}`)} · {select('high_risk', `未延期高风险 ${count('high_risk')}`)}</>} />
    <MetricCard label="近期到期" value={count('due_soon')} icon={Clock3} tone="amber"
      onClick={() => filters.selectScope('due_soon')} selected={filters.isScopeSelected('due_soon')}
      title={`今天起五个工作日内计划结束且尚未完成，按项目工作日日历计算：${overview?.asOfDate || '—'} 至 ${overview?.dueThrough || '—'}；排期不完整的需求归入待确认`}
      detail={<>{range} · {select('due_attention', `关注 ${count('due_attention')}`, '近期到期需求中需要关注的数量')}</>} />
    <MetricCard label="近 7 天完成" value={count('recent_completed')} icon={CheckCircle2} tone="green"
      onClick={() => filters.selectScope('recent_completed')} selected={filters.isScopeSelected('recent_completed')}
      title={`按实际完成日期统计，含今日：${overview?.recentFrom || '—'} 至 ${overview?.asOfDate || '—'}；缺少完成日期的历史记录不计入`}
      detail={select('recent_created', `同期新增 ${count('recent_created')} 项`, '同一北京时间日期范围内创建的需求，不代表净增待办量')} />
  </section>;
}

function IssueHealth({ issues }: { issues?: Dashboard["issues"] }) {
  const summary = issues?.summary;
  const total = summary?.total || 0;
  const resolved = summary?.resolved || 0;
  return (
    <section className="dashboard-issue-health" aria-label="问题概览">
      <header className="issue-health-heading">
        <span className="issue-health-icon"><CircleAlert size={16} /></span>
        <div><strong>问题概览</strong><small>共 {total} 条记录</small></div>
      </header>
      <div className="issue-health-stat"><strong>{summary?.active || 0}</strong><span>未闭环</span></div>
      <div className="issue-health-stat"><strong>{summary?.inProgress || 0}</strong><span>处理中</span></div>
      <div className={`issue-health-stat${summary?.overdue ? " is-danger" : ""}`}><strong>{summary?.overdue || 0}</strong><span>已逾期</span></div>
      <div className={`issue-health-stat${summary?.highPriority ? " is-warning" : ""}`}><strong>{summary?.highPriority || 0}</strong><span>P0 / P1</span></div>
      <div className="issue-health-stat is-success"><strong>{resolved}</strong><span>已解决</span></div>
    </section>
  );
}

function PublicIssueAttention({ issues }: { issues: Dashboard["issues"]["attention"] }) {
  if (!issues.length) return null;
  return (
    <section className="panel dashboard-public-issues">
      <header>
        <h2>热点问题</h2>
      </header>
      <div className="dashboard-public-list">
        {issues.map((issue) => (
          <Link to={`/issues?scope=public&issueId=${encodeURIComponent(issue.id)}`} key={issue.id}>
            <div className="dashboard-public-title">
              <span className={`priority-badge priority-${issue.priority.toLowerCase()}`}>{issue.priority}</span>
              <strong>{issue.title}</strong>
            </div>
            <span className={`issue-status issue-status-${issue.status}`}>{issueStatusLabels[issue.status as keyof typeof issueStatusLabels] || issue.status}</span>
            <span className="dashboard-issue-progress"><i><b style={{ width: `${issue.progress}%` }} /></i>{issue.progress}%</span>
            <span>{issue.ownerName || "未分配"}</span>
            <span className={issue.overdue ? "danger-text" : ""}>{issue.dueDate || "未设置目标日期"}{issue.overdue ? " · 已逾期" : ""}</span>
            <small>{issue.latestUpdate || issue.impact || "暂无进展说明"}</small>
            <ArrowRight size={15} />
          </Link>
        ))}
      </div>
    </section>
  );
}

function ActionOverview({ actions }: { actions?: Dashboard["actions"] }) {
  if (!actions?.summary.total) return null;
  return <section className="panel dashboard-actions">
    <header><div><h2>异常行动</h2><p>高 {actions.summary.high} · 中 {actions.summary.medium} · 低 {actions.summary.low}</p></div><Link to="/actions">查看全部 <ArrowRight size={15} /></Link></header>
    <div className="dashboard-action-list">{actions.items.map((item) => <Link to={item.targetPath} key={item.id}><span className={`action-severity action-${item.severity}`}>{item.severity === "high" ? "高" : item.severity === "medium" ? "中" : "低"}</span><strong>{item.title}</strong><small>{item.reasons.map((reason) => reason.label).join(" · ")}</small><ArrowRight size={15} /></Link>)}</div>
  </section>;
}

export function DashboardPage() {
  const { session } = useSession();
  const { projects, selectedProjectId } = useProjects();
  const { openLogin } = useUiActions();
  const [modal, setModal] = useState<"project" | null>(null);
  const ganttStorageKey = `${session.accountId || session.username || "guest"}:${selectedProjectId}:dashboard-gantt`;
  const filters = useProjectGanttFilters(ganttStorageKey);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [...keys.dashboard, selectedProjectId],
    queryFn: ({ signal }) =>
      api<Dashboard>(
        `/api/dashboard${selectedProjectId ? `?projectId=${selectedProjectId}` : ""}`,
        { signal },
      ),
    enabled: Boolean(selectedProjectId),
  });
  // The fallback lets the rebuilt client work with an older running server.
  const overview = useMemo(() => data ? data.overview || dashboardOverview(data.requirements, data.asOfDate || data.requirements[0]?.asOfDate || todayIso()) : undefined, [data]);
  if (!projects.length && !isLoading)
    return (
      <>
        <PageHeader title="执行进展" />
        <div className="page-content">
          <EmptyState
            title="先创建第一个项目"
            detail="项目用于隔离需求、计划和统计数据。"
            action={
              isAdmin(session) ? (
                <button
                  className="primary-button"
                  onClick={() => setModal("project")}
                >
                  <Plus size={16} />
                  新建项目
                </button>
              ) : !session.authenticated ? (
                <button className="primary-button" onClick={openLogin}>
                  用户登录
                </button>
              ) : null
            }
          />
          {modal === "project" && (
            <ProjectForm onClose={() => setModal(null)} />
          )}
        </div>
      </>
    );
  if (selectedProjectId && isLoading && !data) return <>
    <PageHeader title="执行进展" />
    <div className="page-content"><LoadingState className="loading-block" label="加载项目进展…" /></div>
  </>;
  if (error && !data) return <>
    <PageHeader title="执行进展" />
    <div className="page-content"><EmptyState title="项目进展加载失败" detail={error.message} action={<button className="ghost-button" onClick={() => void refetch()}>重新加载</button>} /></div>
  </>;
  return (
    <>
      <PageHeader title="执行进展" />
      <div className="page-content dashboard-page">
        {error && data && <div className="warning-banner">数据刷新失败，当前展示的是上次成功结果。<button className="ghost-button" onClick={() => void refetch()}>重新加载</button></div>}
        <DashboardMetrics overview={overview} filters={filters} />
        <ProjectGantt
          projectId={selectedProjectId || undefined}
          requirements={data?.requirements || []}
          asOfDate={overview?.asOfDate}
          projectStart={projects.find((project) => project.id === selectedProjectId)?.plannedStart}
          projectEnd={projects.find((project) => project.id === selectedProjectId)?.plannedEnd}
          resizeStorageKey={ganttStorageKey}
          filters={filters}
        />
        <IssueHealth issues={data?.issues} />
        <PublicIssueAttention issues={data?.issues?.attention || []} />
        <ActionOverview actions={data?.actions} />
        {modal === "project" && (
        <ProjectForm onClose={() => setModal(null)} />
        )}
      </div>
    </>
  );
}
