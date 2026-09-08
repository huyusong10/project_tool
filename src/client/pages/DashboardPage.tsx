import { useState } from "react";
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
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [...keys.dashboard, selectedProjectId],
    queryFn: ({ signal }) =>
      api<Dashboard>(
        `/api/dashboard${selectedProjectId ? `?projectId=${selectedProjectId}` : ""}`,
        { signal },
      ),
    enabled: Boolean(selectedProjectId),
  });
  if (!projects.length && !isLoading)
    return (
      <>
        <PageHeader title="项目进展" />
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
    <PageHeader title="项目进展" />
    <div className="page-content"><LoadingState className="loading-block" label="加载项目进展…" /></div>
  </>;
  if (error && !data) return <>
    <PageHeader title="项目进展" />
    <div className="page-content"><EmptyState title="项目进展加载失败" detail={error.message} action={<button className="ghost-button" onClick={() => void refetch()}>重新加载</button>} /></div>
  </>;
  return (
    <>
      <PageHeader title="项目进展" />
      <div className="page-content dashboard-page">
        {error && data && <div className="warning-banner">数据刷新失败，当前展示的是上次成功结果。<button className="ghost-button" onClick={() => void refetch()}>重新加载</button></div>}
        <section className="stats-grid dashboard-top-stats">
        <MetricCard
          label="开发中需求"
          value={data?.summary.active ?? "—"}
          detail={`全部 ${data?.summary.total || 0} 项`}
          icon={CircleDot}
          tone="blue"
        />
        <MetricCard
          label="已完成需求"
          value={data?.summary.completed ?? "—"}
          detail={`完成率 ${data?.summary.completionRate || 0}%`}
          icon={CheckCircle2}
          tone="green"
        />
        <MetricCard
          label="延期需求"
          value={data?.summary.delayed ?? "—"}
          detail="按计划与实际自动判断"
          icon={Clock3}
          tone="red"
        />
        <MetricCard
          label="高风险需求"
          value={data?.summary.highRisk ?? "—"}
          detail="优先级 × 进度Gap，阻塞/延期覆盖"
          icon={AlertTriangle}
          tone="amber"
        />
        </section>
        <ProjectGantt
          requirements={data?.requirements || []}
          asOfDate={data?.asOfDate}
          projectStart={projects.find((project) => project.id === selectedProjectId)?.plannedStart}
          projectEnd={projects.find((project) => project.id === selectedProjectId)?.plannedEnd}
          resizeStorageKey={`${session.accountId || session.username || "guest"}:${selectedProjectId}:dashboard-gantt`}
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
