import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, CircleStop, Clock3, MessageSquarePlus, Play } from 'lucide-react';
import { api, jsonBody } from '../api';
import type { MyWork, MyWorkItem } from '../types';
import { requirementStatusLabels } from '../../shared/domain';
import { Chart } from '../components/Chart';
import { EmptyState, Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { ProgressInput } from '../components/ProgressInput';
import { WorkItemActions } from '../components/WorkItemActions';

function ProgressForm({ item, onClose }: { item: MyWorkItem; onClose: () => void }) {
  const client = useQueryClient();
  const [progress, setProgress] = useState(item.progress);
  const mutation = useMutation({
    mutationFn: (value: { content: string; workItemPercent?: number }) => api(`/api/requirements/${item.requirementId}/progress`, {
      method: 'POST', body: jsonBody({ ...value, workItemId: item.id, expectedVersion: item.version }),
    }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['my-work'] }); onClose(); },
  });
  return <form className="form-grid" onSubmit={(event) => {
    event.preventDefault();
    const value = { content: String(new FormData(event.currentTarget).get('content') || '') };
    mutation.mutate(item.status === 'in_progress' ? { ...value, workItemPercent: progress } : value);
  }}>
    <div className="my-work-context field-full"><strong>{item.title}</strong><span>{item.projectName} · {item.requirementTitle}</span></div>
    {item.status === 'in_progress' && <ProgressInput name="workItemPercent" value={progress} onChange={setProgress} max={99} />}
    {item.status === 'blocked' && <p className="field-help field-full">工作项处于阻塞状态，只能补充说明；解除阻塞后才能继续提高进度。</p>}
    <label className="field field-full"><span>具体进展</span><textarea name="content" rows={5} required autoFocus placeholder="说明完成了什么、当前结果或下一步" /></label>
    {mutation.error && <p className="form-error field-full">{mutation.error.message}</p>}
    <div className="form-actions field-full"><button type="button" className="ghost-button" onClick={onClose}>取消</button><button className="primary-button" disabled={mutation.isPending}>保存进展</button></div>
  </form>;
}

export function MyWorkPage() {
  const client = useQueryClient(); const navigate = useNavigate();
  const [filter, setFilter] = useState('active');
  const [progressItem, setProgressItem] = useState<MyWorkItem>();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['my-work'], queryFn: () => api<MyWork>('/api/my-work') });
  const items = (data?.items || []).filter((item) => filter === 'all' || (filter === 'active' ? !['completed', 'cancelled'].includes(item.status) : item.status === filter));
  const action = useMutation({
    mutationFn: ({ item, action, content, reason }: { item: MyWorkItem; action: string; content?: string; reason?: string }) => api(`/api/work-items/${item.id}/${action}`, {
      method: 'POST', body: jsonBody({ expectedVersion: item.version, content, reason }),
    }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['my-work'] }),
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
      {error && <EmptyState title="我的工作加载失败" detail={error.message} action={<button className="ghost-button" onClick={() => void refetch()}>重新加载</button>} />}
      {!error && <>
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
      <section className="panel my-work-list">
        <header><div><h2>分配给我的工作项</h2><p>主负责人和协作工作都会显示</p></div><div className="view-tabs">{[['active', '当前'], ['not_started', '未开始'], ['in_progress', '进行中'], ['blocked', '阻塞'], ['completed', '已完成'], ['all', '全部']].map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div></header>
        <div className="my-work-items">
          {items.map((item) => <article key={item.id} className={item.overdue ? 'is-overdue' : ''}>
            <button className="my-work-main" onClick={() => navigate(`/requirements/${item.requirementId}`)}>
              <div><span className={`work-status-dot work-${item.status}`} /><strong>{item.title}</strong><em>{item.assignmentType === 'owner' ? '主责' : '协作'}</em></div>
              <p>{item.projectName} · {item.requirementTitle}</p>
            </button>
            <div className="my-work-dates"><span>计划 {item.plannedStart || '—'} → {item.plannedEnd || '—'}</span><span className="my-work-progress"><i><b style={{ width: `${item.progress}%` }} /></i>{item.progress}%</span><b className={item.overdue ? 'danger-text' : ''}>{requirementStatusLabels[item.status as keyof typeof requirementStatusLabels] || item.status}</b></div>
            <div className="my-work-actions">
              <WorkItemActions item={item} onAction={(nextAction, text) => action.mutateAsync({ item, action: nextAction, ...(nextAction === 'block' ? { reason: text } : { content: text }) })} />
              {['in_progress', 'blocked'].includes(item.status) && <button onClick={() => setProgressItem(item)}><MessageSquarePlus size={14} />写进展</button>}
            </div>
          </article>)}
          {!error && !items.length && !isLoading && <EmptyState title="当前没有工作项" detail="分配为主负责人或协作人员后，会自动出现在这里。" />}
        </div>
      </section>
      <section className="my-work-charts"><article className="panel"><header><div><h2>完成趋势</h2><p>近8个有完成记录的自然周</p></div></header><Chart option={charts.completion} height={230} ariaLabel="我的工作完成趋势" /></article><article className="panel"><header><div><h2>近期并发</h2><p>未来10个工作日的计划工作项数</p></div></header><Chart option={charts.upcoming} height={230} ariaLabel="我的近期工作并发趋势" /></article></section>
      </>}
    </div>
    {progressItem && <Modal title="添加工作进展" onClose={() => setProgressItem(undefined)}><ProgressForm item={progressItem} onClose={() => setProgressItem(undefined)} /></Modal>}
  </>;
}
