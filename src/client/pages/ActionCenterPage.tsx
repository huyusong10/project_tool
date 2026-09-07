import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CircleAlert, ListTodo, UserRound } from 'lucide-react';
import { api } from '../api';
import { useProjects } from '../app-context';
import { keys } from '../query-keys';
import type { ActionItemsPage } from '../types';
import { actionReasonLabels, type ActionReasonCode } from '../../shared/action-items';
import { EmptyState, LoadingState } from '../components/Feedback';
import { FilterBar } from '../components/FilterBar';
import { Pagination } from '../components/Pagination';
import { PageHeader } from '../components/PageHeader';

const severityLabels = { high: '高', medium: '中', low: '低' } as const;
const reasonOptions = Object.entries(actionReasonLabels) as Array<[ActionReasonCode, string]>;

export function ActionCenterPage() {
  const { selectedProjectId } = useProjects();
  const navigate = useNavigate();
  const [severity, setSeverity] = useState('');
  const [reason, setReason] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [ownerId, reason, selectedProjectId, severity]);
  const query = new URLSearchParams({ projectId: selectedProjectId, page: String(page), pageSize: '20' });
  if (severity) query.set('severity', severity);
  if (reason) query.set('reason', reason);
  if (ownerId) query.set('ownerId', ownerId);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: [...keys.actionItems, selectedProjectId, severity, reason, ownerId, page],
    queryFn: ({ signal }) => api<ActionItemsPage>(`/api/action-items?${query.toString()}`, { signal }),
    enabled: Boolean(selectedProjectId),
  });
  useEffect(() => {
    if (!data) return;
    const lastPage = Math.max(1, data.pages);
    if (page > lastPage) setPage(lastPage);
  }, [data, page]);
  const ownerOptions = data?.ownerOptions || [];
  const selectedOwnerMissing = Boolean(ownerId && ownerId !== 'unassigned'
    && !ownerOptions.some((person) => person.id === ownerId));
  return <>
    <PageHeader title="异常行动中心" />
    <div className="page-content action-center-page">
      {error && !data ? <section className="panel action-center-list"><EmptyState title="行动项加载失败" detail={error.message} action={<button className="ghost-button" disabled={isFetching} onClick={() => void refetch()}>重新加载</button>} /></section> : <>
      {error && data && <div className="warning-banner">行动项刷新失败，当前展示的是上次成功结果。<button className="ghost-button" disabled={isFetching} onClick={() => void refetch()}>重新加载</button></div>}
      <section className="action-summary">
        <article><ListTodo size={19} /><span>全部行动</span><strong>{data?.summary.total || 0}</strong></article>
        <article className="is-high"><AlertTriangle size={19} /><span>高优先级</span><strong>{data?.summary.high || 0}</strong></article>
        <article className="is-medium"><CircleAlert size={19} /><span>中优先级</span><strong>{data?.summary.medium || 0}</strong></article>
        <article><UserRound size={19} /><span>待规划</span><strong>{data?.summary.byReason.planning || 0}</strong></article>
      </section>
      <section className="panel action-center-list">
        <header><div><h2>待处理事项</h2><p>由需求、工作项和问题状态实时推导，处理源数据后自动消失{data?.asOfDate ? ` · 截至 ${data.asOfDate}` : ''}</p></div></header>
        <FilterBar className="action-center-filters" result={`${data?.total || 0} 项`}>
          <select aria-label="严重度" value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="">全部严重度</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select>
          <select aria-label="行动原因" value={reason} onChange={(event) => setReason(event.target.value)}><option value="">全部原因</option>{reasonOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
          <select aria-label="负责人" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
            <option value="">全部负责人</option>
            {(data?.hasUnassigned || ownerId === 'unassigned') && <option value="unassigned">未分派</option>}
            {selectedOwnerMissing && <option value={ownerId}>当前筛选负责人（暂无行动）</option>}
            {ownerOptions.map((person) => <option value={person.id} key={person.id}>{person.name}（{person.count}）</option>)}
          </select>
        </FilterBar>
        <div className="action-items">
          {isLoading && !data && <LoadingState label="正在加载行动项…" className="stable-panel-state" />}
          {data?.items.map((item) => <button key={item.id} className={`action-item action-${item.severity}`} onClick={() => navigate(item.targetPath)}>
            <span className="action-severity">{severityLabels[item.severity]}</span>
            <div className="action-item-main"><div><strong>{item.title}</strong>{item.contextTitle && <small>{item.contextTitle}</small>}</div><p>{item.reasons.map((entry) => entry.label).join(' · ')}</p></div>
            <div className="action-item-meta"><span>{item.ownerName || '未分派'}</span><span>{item.dueDate || '无截止日期'}{item.overdueWorkdays ? ` · 逾期${item.overdueWorkdays}个工作日` : ''}</span></div>
            <ArrowRight size={16} />
          </button>)}
          {data && !data.items.length && !isLoading && <EmptyState title="当前没有待处理事项" detail="筛选范围内的需求、工作项和问题均无客观异常。" />}
        </div>
        {(data?.pages || 0) > 1 && <Pagination page={page} pages={data?.pages || 0} onChange={setPage} className="pagination" />}
      </section>
      </>}
    </div>
  </>;
}
