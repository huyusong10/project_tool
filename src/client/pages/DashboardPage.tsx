import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  CircleDot,
  Plus,
  TrendingUp,
} from "lucide-react";
import { api } from "../api";
import { useApp } from "../app-context";
import type { Dashboard } from "../types";
import { requirementStatusLabels } from "../../shared/domain";
import { Chart } from "../components/Chart";
import { EmptyState, Modal } from "../components/Modal";
import { ProjectGantt } from "../components/ProjectGantt";
import { PageHeader } from "../components/PageHeader";
import { ProjectForm } from "../components/ManagementForms";

function Kpi({
  label,
  value,
  detail,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  tone: string;
  icon: typeof Clock3;
}) {
  return (
    <article className={`stat-card stat-${tone}`}>
      <div className="stat-icon">
        <Icon size={18} />
      </div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{detail}</span>
      </div>
    </article>
  );
}

export function DashboardPage() {
  const {
    projects,
    selectedProjectId,
    session,
    openLogin,
  } = useApp();
  const [modal, setModal] = useState<"project" | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", selectedProjectId],
    queryFn: () =>
      api<Dashboard>(
        `/api/dashboard${selectedProjectId ? `?projectId=${selectedProjectId}` : ""}`,
      ),
  });
  const charts = useMemo(
    () => ({
      status: {
        tooltip: { trigger: "item" },
        legend: { bottom: 0, textStyle: { color: "#68768a" } },
        series: [
          {
            type: "pie",
            radius: ["48%", "72%"],
            center: ["50%", "43%"],
            label: { show: false },
            data: (data?.charts.statuses || [])
              .filter((x) => x.count)
              .map((x) => ({
                name: requirementStatusLabels[
                  x.status as keyof typeof requirementStatusLabels
                ],
                value: x.count,
              })),
            color: [
              "#94a3b8",
              "#6f83a0",
              "#2d6cdf",
              "#d78a14",
              "#1d9a6c",
              "#9ca3af",
            ],
          },
        ],
      },
      trend: {
        tooltip: { trigger: "axis" },
        grid: { left: 28, right: 12, top: 18, bottom: 28 },
        xAxis: {
          type: "category",
          data: data?.charts.weeks.map((x) => x.week),
          axisLine: { lineStyle: { color: "#dfe5ed" } },
          axisLabel: { color: "#7b8899" },
        },
        yAxis: {
          type: "value",
          minInterval: 1,
          splitLine: { lineStyle: { color: "#eef1f5" } },
          axisLabel: { color: "#7b8899" },
        },
        series: [
          {
            type: "line",
            smooth: true,
            data: data?.charts.weeks.map((x) => x.completed),
            symbolSize: 7,
            lineStyle: { width: 3, color: "#2d6cdf" },
            itemStyle: { color: "#2d6cdf" },
            areaStyle: { color: "rgba(45,108,223,.12)" },
          },
        ],
      },
      variance: {
        tooltip: { trigger: "axis" },
        grid: { left: 110, right: 22, top: 12, bottom: 22 },
        xAxis: {
          type: "value",
          axisLabel: { color: "#7b8899", formatter: "{value}天" },
          splitLine: { lineStyle: { color: "#eef1f5" } },
        },
        yAxis: {
          type: "category",
          data: data?.charts.varianceTop.map((x) => x.title),
          axisLabel: { color: "#536176", width: 92, overflow: "truncate" },
        },
        series: [
          {
            type: "bar",
            data: data?.charts.varianceTop.map((x) => x.variance),
            barWidth: 13,
            itemStyle: { color: "#df6565", borderRadius: [0, 5, 5, 0] },
          },
        ],
      },
    }),
    [data],
  );
  if (!projects.length && !isLoading)
    return (
      <>
        <PageHeader title="项目进展" />
        <div className="page-content">
          <EmptyState
            title="先创建第一个项目"
            detail="项目用于隔离需求、计划和统计数据。"
            action={
              session.authenticated ? (
                <button
                  className="primary-button"
                  onClick={() => setModal("project")}
                >
                  <Plus size={16} />
                  新建项目
                </button>
              ) : (
                <button className="primary-button" onClick={openLogin}>
                  用户登录
                </button>
              )
            }
          />
          {modal === "project" && (
            <Modal title="新建项目" onClose={() => setModal(null)}>
              <ProjectForm onClose={() => setModal(null)} />
            </Modal>
          )}
        </div>
      </>
    );
  return (
    <>
      <PageHeader title="项目进展" />
      <div className="page-content dashboard-page">
        <section className="stats-grid dashboard-top-stats">
        <Kpi
          label="开发中需求"
          value={data?.summary.active ?? "—"}
          detail={`全部 ${data?.summary.total || 0} 项`}
          icon={CircleDot}
          tone="blue"
        />
        <Kpi
          label="已完成需求"
          value={data?.summary.completed ?? "—"}
          detail={`完成率 ${data?.summary.completionRate || 0}%`}
          icon={CheckCircle2}
          tone="green"
        />
        <Kpi
          label="延期需求"
          value={data?.summary.delayed ?? "—"}
          detail="按计划与实际自动判断"
          icon={Clock3}
          tone="red"
        />
        <Kpi
          label="高风险需求"
          value={data?.summary.highRisk ?? "—"}
          detail="阻塞或延期≥3工作日"
          icon={AlertTriangle}
          tone="amber"
        />
        </section>
        <ProjectGantt
          requirements={data?.requirements || []}
          projectStart={projects.find((project) => project.id === selectedProjectId)?.plannedStart}
          projectEnd={projects.find((project) => project.id === selectedProjectId)?.plannedEnd}
        />
        <div className="section-heading dashboard-overview-heading">
          <div>
            <h2>统计分析</h2>
          </div>
        </div>
        <section className="dashboard-charts">
        <article className="panel">
          <header>
            <div>
              <h2>状态分布</h2>
              <p>当前需求结构</p>
            </div>
          </header>
          {data?.summary.total ? (
            <Chart
              option={charts.status}
              height={220}
              ariaLabel="需求状态分布图"
            />
          ) : (
            <EmptyState
              title="暂无需求"
              detail="创建需求后自动生成状态分布。"
            />
          )}
        </article>
        <article className="panel chart-wide">
          <header>
            <div>
              <h2>完成趋势</h2>
              <p>最近12周完成数量</p>
            </div>
            <TrendingUp size={18} />
          </header>
          <Chart
            option={charts.trend}
            height={220}
            ariaLabel="最近12周需求完成趋势"
          />
        </article>
        <article className="panel">
          <header>
            <div>
              <h2>耗时偏差 Top 10</h2>
              <p>按延期工作日排序</p>
            </div>
          </header>
          {data?.charts.varianceTop.length ? (
            <Chart
              option={charts.variance}
              height={220}
              ariaLabel="需求耗时偏差排行"
            />
          ) : (
            <EmptyState
              title="暂无延期"
              detail="当前没有可展示的正向耗时偏差。"
            />
          )}
        </article>
        </section>
        {modal === "project" && (
        <Modal title="新建项目" onClose={() => setModal(null)}>
          <ProjectForm onClose={() => setModal(null)} />
        </Modal>
        )}
      </div>
    </>
  );
}
