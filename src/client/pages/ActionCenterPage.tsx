import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CircleAlert, ListTodo, UserRound } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../app-context';
import type { ActionItemsPage, Person } from '../types';
import { actionReasonLabels, type ActionReasonCode } from '../../shared/action-items';
import { EmptyState } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';

const severityLabels = { high: '高', medium: '中', low: '低' } as const;
const reasonOptions = Object.entries(actionReasonLabels) as Array<[ActionReasonCode, string]>;

export function ActionCenterPage() {
  const { selectedProjectId } = useApp();
  const navigate = useNavigate();
  const [severity, setSeverity] = useState('');
  const [reason, setReason] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [ownerId, reason, selectedProjectId, severity]);
  const { data: people = [] } = useQuery({
    queryKey: ['people', selectedProjectId],
    queryFn: () => api<Person[]>(`/api/people?projectId=${encodeURIComponent(selectedProjectId)}`),
    enabled: Boolean(selectedProjectId),
  });
  const query = new URLSearchParams({ projectId: selectedProjectId, page: String(page), pageSize: '20' });
  if (severity) query.set('severity', severity);
  if (reason) query.set('reason', reason);
  if (ownerId) query.set('ownerId', ownerId);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['action-items', selectedProjectId, severity, reason, ownerId, page],
    queryFn: () => api<ActionItemsPage>(`/api/action-items?${query.toString()}`),
    enabled: Boolean(selectedProjectId),
  });
  return <>
    <PageHeader title="异常行动中心" />
    <div className="page-content action-center-page">
      {error ? <section className="panel action-center-list"><EmptyState title="行动项加载失败" detail={error.message} action={<button className="ghost-button" onClick={() => void refetch()}>重新加载</button>} /></section> : <>
      <section className="action-summary">
        <article><ListTodo size={19} /><span>全部行动</span><strong>{data?.summary.total || 0}</strong></article>
        <article className="is-high"><AlertTriangle size={19} /><span>高优先级</span><strong>{data?.summary.high || 0}</strong></article>
        <article className="is-medium"><CircleAlert size={19} /><span>中优先级</span><strong>{data?.summary.medium || 0}</strong></article>
        <article><UserRound size={19} /><span>待规划</span><strong>{data?.summary.byReason.planning || 0}</strong></article>
      </section>
      <section className="panel action-center-list">
        <header><div><h2>待处理事项</h2><p>由需求、工作项和问题状态实时推导，处理源数据后自动消失</p></div></header>
        <div className="filter-bar action-center-filters">
          <select aria-label="严重度" value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="">全部严重度</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select>
          <select aria-label="行动原因" value={reason} onChange={(event) => setReason(event.target.value)}><option value="">全部原因</option>{reasonOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
          <select aria-label="负责人" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}><option value="">全部负责人</option><option value="unassigned">未分派</option>{people.filter((person) => person.active).map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select>
          <span>{data?.total || 0} 项</span>
        </div>
        <div className="action-items">
          {data?.items.map((item) => <button key={item.id} className={`action-item action-${item.severity}`} onClick={() => navigate(item.targetPath)}>
            <span className="action-severity">{severityLabels[item.severity]}</span>
            <div className="action-item-main"><div><strong>{item.title}</strong>{item.contextTitle && <small>{item.contextTitle}</small>}</div><p>{item.reasons.map((entry) => entry.label).join(' · ')}</p></div>
            <div className="action-item-meta"><span>{item.ownerName || '未分派'}</span><span>{item.dueDate || '无截止日期'}{item.overdueWorkdays ? ` · 逾期${item.overdueWorkdays}个工作日` : ''}</span></div>
            <ArrowRight size={16} />
          </button>)}
          {!error && !data?.items.length && !isLoading && <EmptyState title="当前没有待处理事项" detail="筛选范围内的需求、工作项和问题均无客观异常。" />}
        </div>
        {(data?.pages || 0) > 1 && <footer className="pagination"><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button><span>{page} / {data?.pages}</span><button disabled={page >= (data?.pages || 0)} onClick={() => setPage((value) => value + 1)}>下一页</button></footer>}
      </section>
      </>}
    </div>
  </>;
}
