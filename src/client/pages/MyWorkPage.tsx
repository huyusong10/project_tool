import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, CircleStop, Clock3, MessageSquarePlus, Play } from 'lucide-react';
import { api, jsonBody } from '../api';
import { useSession } from '../app-context';
import { invalidateRequirementViews, keys } from '../query-keys';
import { cacheResourceUpdate, useResourceQuery } from '../use-resource-query';
import type { MyWork, MyWorkItem, Requirement } from '../types';
import { requirementStatusLabels } from '../../shared/domain';
import { Chart } from '../components/Chart';
import { GapTimeline } from '../components/GapTimeline';
import { EmptyState, LoadingState, RefreshNotice } from '../components/Feedback';
import { PageHeader } from '../components/PageHeader';
import { ProgressForm } from '../components/ProgressForm';
import { ResizablePanel } from '../components/ResizablePanel';
import { WorkItemActions } from '../components/WorkItemActions';
import { ViewTabs } from '../components/ViewTabs';

export function MyWorkPage() {
  const client = useQueryClient(); const navigate = useNavigate();
  const { session } = useSession();
  const [filter, setFilter] = useState('active');
  const [progressItem, setProgressItem] = useState<MyWorkItem>();
  const { data, isLoading, error, refetch, isFetching, unavailable } = useResourceQuery<MyWork>(keys.myWork, '/api/my-work');
  useEffect(() => {
    if (unavailable && error) setProgressItem(undefined);
  }, [error, unavailable]);
  const items = (data?.items || []).filter((item) => filter === 'all' || (filter === 'active' ? !['completed', 'cancelled'].includes(item.status) : item.status === filter));
  const action = useMutation({
    mutationFn: ({ item, action, content, reason, expectedVersion = item.version }: { item: MyWorkItem; action: string; content?: string; reason?: string; expectedVersion?: number }) => api(`/api/work-items/${item.id}/${action}`, {
      method: 'POST', body: jsonBody({ expectedVersion, content, reason }),
    }),
    onSuccess: (_result, variables) => {
      invalidateRequirementViews(client, variables.item.requirementId);
    },
  });
  const charts = useMemo(() => ({
    completion: { grid: { left: 35, right: 12, top: 18, bottom: 32 }, tooltip: { trigger: 'axis' }, xAxis: { type: 'category', data: data?.completionTrend.map((item) => item.week.slice(5)) || [] }, yAxis: { type: 'value', minInterval: 1 }, series: [{ type: 'bar', data: data?.completionTrend.map((item) => item.completed) || [], itemStyle: { color: '#2f6feb', borderRadius: [5, 5, 0, 0] } }] },
    upcoming: { grid: { left: 35, right: 12, top: 18, bottom: 32 }, tooltip: { trigger: 'axis' }, xAxis: { type: 'category', data: data?.upcoming.map((item) => item.date.slice(5)) || [] }, yAxis: { type: 'value', minInterval: 1 }, series: [{ type: 'line', smooth: true, data: data?.upcoming.map((item) => item.count) || [], lineStyle: { color: '#18a779', width: 3 }, itemStyle: { color: '#18a779' }, areaStyle: { color: 'rgba(24,167,121,.12)' } }] },
  }), [data]);
  const metrics: Array<{ label: string; value: number; Icon: typeof Clock3 }> = [
    { label: '待开始', value: data?.summary.notStarted || 0, Icon: Clock3 },
    { label: '进行中', value: data?.summary.inProgress || 0, Icon: Play },
    { label: '阻塞', value: data?.summary.blocked || 0, Icon: CircleStop },
    { label: '已延期', value: data?.summary.overdue || 0, Icon: AlertTriangle },
    { label: '已完成', value: data?.summary.completed || 0, Icon: Check },
  ];
  return <>
    <PageHeader title="我的工作" />
    <div className="page-content my-work-page">
      {isLoading && <LoadingState className="stable-panel-state" label="正在加载我的工作…" />}
      {!isLoading && unavailable && <EmptyState title="我的工作加载失败" detail={error?.message || '暂无可用数据，请重新加载。'} action={<button className="ghost-button" disabled={isFetching} onClick={() => void refetch()}>重新加载</button>} />}
      {!unavailable && <>
      {error && <RefreshNotice pending={isFetching} onRetry={() => void refetch()} />}
      <section className="my-work-summary">
        {metrics.map(({ label, value, Icon }) => <article key={label}><Icon size={19} /><span>{label}</span><strong>{value}</strong></article>)}
      </section>
      {!!data?.requirements.length && <section className="panel my-owned-requirements">
        <header><div><h2>我负责的需求</h2><p>规划完整度、交付风险和待处理事项</p></div></header>
        <div className="my-owned-requirement-grid">
          {data.requirements.map((requirement) => <button key={requirement.id} onClick={() => navigate(`/requirements/${requirement.id}`)}>
            <div><span className={`priority-badge priority-${requirement.priority.toLowerCase()}`}>{requirement.priority}</span><strong>{requirement.title}</strong></div>
            <p>{requirement.projectName} · {requirement.plannedStart || "待排期"} → {requirement.plannedEnd || "待排期"}</p>
            <footer><span className={`status-pill status-${requirement.status}`}>{requirementStatusLabels[requirement.status as keyof typeof requirementStatusLabels] || requirement.status}</span><span>{requirement.planningReasons.join("、") || (requirement.highRisk ? "高风险" : requirement.delayed ? "已延期" : "计划正常")}</span><b>{requirement.actionCount} 项待处理</b></footer>
          </button>)}
        </div>
      </section>}
      <ResizablePanel
        className="panel my-work-list stable-workspace-panel"
        storageKey={`${session.accountId || session.username || 'guest'}:my-work-gantt`}
        defaultHeight={520}
        minHeight={360}
      >
        <header><div><h2>分配给我的工作项</h2><p>主负责人和协作工作都会显示</p></div><ViewTabs value={filter} onChange={setFilter} options={[['active', '当前'], ['not_started', '未开始'], ['in_progress', '进行中'], ['blocked', '阻塞'], ['completed', '已完成'], ['all', '全部']].map(([value, label]) => ({ value, label }))} /></header>
        {isLoading && !data ? <LoadingState className="stable-panel-state" label="正在加载工作项…" /> : <GapTimeline
          items={items}
          asOfDate={data?.asOfDate}
          showStatusFilters={false}
          showGapSummary={false}
          showUnscheduled
          actionColumnWidth={164}
          ariaLabel="分配给我的工作项甘特图"
          emptyState={{ message: '当前筛选下没有工作项', actionLabel: '查看全部', onAction: () => setFilter('all') }}
          onItemClick={(baseItem) => {
            const item = baseItem as MyWorkItem;
            navigate(`/requirements/${item.requirementId}?workItemId=${encodeURIComponent(item.id)}`);
          }}
          renderItemMeta={(baseItem) => {
            const item = baseItem as MyWorkItem;
            return <><small title={`${item.projectName} · ${item.requirementTitle}`}>{item.projectName} · {item.requirementTitle}</small><em className="my-work-assignment-badge">{item.assignmentType === 'owner' ? '主责' : '协作'}</em>{item.overdue && <em className="my-work-overdue-badge">延期</em>}</>;
          }}
          renderActions={(baseItem) => {
            const item = baseItem as MyWorkItem;
            return <div className="my-work-gantt-actions">
              {['in_progress', 'blocked'].includes(item.status) && <button className="my-work-progress-action" onClick={() => setProgressItem(item)} title="写进展" aria-label={`为${item.title}写进展`}><MessageSquarePlus size={15} /><span>进展</span></button>}
              <WorkItemActions item={item} startDisabledReason={item.requirementStatus === 'planning' ? '需求尚未完成规划，请联系需求负责人或项目经理补齐负责人和排期。' : undefined} onAction={(nextAction, text, expectedVersion) => action.mutateAsync({ item, action: nextAction, expectedVersion, ...(nextAction === 'block' ? { reason: text } : { content: text }) })} onReload={async () => {
                const [latest, requirement] = await Promise.all([
                  refetch({ throwOnError: true }),
                  api<Requirement>(`/api/requirements/${item.requirementId}`),
                ]);
                const current = latest.data?.items.find((entry) => entry.id === item.id);
                if (!current) throw new Error('工作项已不在我的工作中，请关闭操作面板。');
                return {
                  item: current,
                  updates: (requirement.progressUpdates || []).filter((update) => update.workItemId === item.id),
                };
              }} />
            </div>;
          }}
        />}
      </ResizablePanel>
      <section className="my-work-charts"><article className="panel"><header><div><h2>完成趋势</h2><p>近8个有完成记录的自然周</p></div></header><Chart option={charts.completion} height={230} ariaLabel="我的工作完成趋势" /></article><article className="panel"><header><div><h2>近期并发</h2><p>未来10个工作日的计划工作项数</p></div></header><Chart option={charts.upcoming} height={230} ariaLabel="我的近期工作并发趋势" /></article></section>
      </>}
    </div>
    {progressItem && !unavailable && <ProgressForm
      key={progressItem.id}
      title="添加工作进展"
      submitLabel="保存进展"
      requirementId={progressItem.requirementId}
      scope={{ items: (data?.items || []).filter((item) => item.id === progressItem.id), updates: (data?.recentProgress || []).filter((update) => update.requirementId === progressItem.requirementId), allowRequirementNote: false }}
      loadScope={async () => {
        const latest = await api<MyWork>('/api/my-work');
        cacheResourceUpdate(client, keys.myWork, latest);
        return { items: latest.items.filter((item) => item.id === progressItem.id), updates: latest.recentProgress.filter((update) => update.requirementId === progressItem.requirementId), allowRequirementNote: false };
      }}
      contextLabel={`${progressItem.projectName} · ${progressItem.requirementTitle}`}
      fixedItemId={progressItem.id}
      onClose={() => setProgressItem(undefined)}
    />}
  </>;
}
