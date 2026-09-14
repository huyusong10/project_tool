import {useAppNavigate} from '../use-app-navigation';

import { usePageSearchParams, usePageScrollPosition } from '../use-page-view';
import { usePagedResourceQuery } from '../use-paged-resource-query';
import { useListPagination } from '../use-list-pagination';
import { readPagination } from '../pagination';
import { AlertTriangle, ArrowRight, CircleAlert, ListTodo, ArrowDown } from 'lucide-react';
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
  const navigate = useAppNavigate();
  const [params, setParams] = usePageSearchParams(['severity', 'reason', 'ownerId', 'page']);
  const severity = params.get('severity') || '', reason = params.get('reason') && params.get('reason')! in actionReasonLabels ? params.get('reason')! : '', ownerId = params.get('ownerId') || '';
  const { page, pageSize } = readPagination(params, 10);
  const updateFilter = (key: string, value: string) => setParams(current => { const next = new URLSearchParams(current); next.set(key, value); next.delete('page'); return next; });
  const clearFilters = () => setParams(current => { const next = new URLSearchParams(current); for (const key of ['severity','reason','ownerId']) next.delete(key); next.set('page','1'); return next; });
  const query = new URLSearchParams({ projectId: selectedProjectId, page: String(page), pageSize: String(pageSize) });
  if (severity) query.set('severity', severity);
  if (reason) query.set('reason', reason);
  if (ownerId) query.set('ownerId', ownerId);
  const filterKey = JSON.stringify([selectedProjectId, severity, reason, ownerId]);
  const { data, isLoading, error, refetch, isFetching } = usePagedResourceQuery<ActionItemsPage>(
    [...keys.actionItems, selectedProjectId, severity, reason, ownerId, page, pageSize], `/api/action-items?${query}`, filterKey, Boolean(selectedProjectId));
  const pagination = useListPagination({ total: data?.total || 0, defaultPageSize: 10, filterKey, ready: Boolean(data) && !error, loading: isFetching,
    serverPage: data?.page, serverPageSize: data?.pageSize, failed: Boolean(error) });
  usePageScrollPosition(!isLoading);
  const ownerOptions = data?.ownerOptions || [];
  const selectedOwnerMissing = Boolean(ownerId && ownerId !== 'unassigned'
    && !ownerOptions.some((person) => person.id === ownerId));
  return <>
    <PageHeader title="项目工作区" />
    <div className="page-content action-center-page">
      {error && !data ? <section className="panel action-center-list"><EmptyState title="行动项加载失败" detail={error.message} action={<button className="ghost-button" disabled={isFetching} onClick={() => void refetch()}>重新加载</button>} /></section> : <>
      {error && data && <div className="warning-banner">行动项刷新失败，当前展示的是上次成功结果。<button className="ghost-button" disabled={isFetching} onClick={() => void refetch()}>重新加载</button></div>}
      <section className="action-summary">
        <article><ListTodo size={19} /><span>全部行动</span><strong>{data?.summary.total || 0}</strong></article>
        <article className="is-high"><AlertTriangle size={19} /><span>优先处理</span><strong>{data?.summary.high || 0}</strong></article>
        <article className="is-normal"><CircleAlert size={19} /><span>需要处理</span><strong>{data?.summary.medium || 0}</strong></article>
        <article><ArrowDown size={19} /><span>资料待补齐</span><strong>{data?.summary.low || 0}</strong></article>
      </section>
      <section className="panel action-center-list paged-panel">
        <header><div><h2>待处理事项</h2><p>由需求、工作项和问题状态实时推导，处理源数据后自动消失{data?.asOfDate ? ` · 截至 ${data.asOfDate}` : ''}</p></div></header>
        <FilterBar className="action-center-filters" result={`${data?.total || 0} 项`}>
          <select aria-label="处理优先级" value={severity} onChange={(event) => updateFilter('severity', event.target.value)}><option value="">全部处理优先级</option><option value="high">P0 紧急 / P1 高</option><option value="medium">P2 正常</option><option value="low">P3 较低</option></select>
          <select aria-label="行动原因" value={reason} onChange={(event) => updateFilter('reason', event.target.value)}><option value="">全部原因</option>{reasonOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
          <select aria-label="负责人" value={ownerId} onChange={(event) => updateFilter('ownerId', event.target.value)}>
            <option value="">全部负责人</option>
            {(data?.hasUnassigned || ownerId === 'unassigned') && <option value="unassigned">未分派</option>}
            {selectedOwnerMissing && <option value={ownerId}>当前筛选负责人（暂无行动）</option>}
            {ownerOptions.map((person) => <option value={person.id} key={person.id}>{person.name}（{person.count}）</option>)}
          </select>
        </FilterBar>
        <div className="action-items paged-body" ref={pagination.scrollRef}>
          {isLoading && !data && <LoadingState label="正在加载行动项…" className="stable-panel-state" />}
          {data?.items.map((item) => <button key={item.id} className={`action-item action-${item.severity}`} onClick={() => navigate(item.targetPath)}>
            <div className="action-priority">{<span className={`action-severity action-${item.severity}`}>{severityLabels[item.severity]}</span>}</div>
            <div className="action-item-main"><div><strong>{item.title}</strong>{item.contextTitle && <small>{item.contextTitle}</small>}</div><p>{item.reasons.map((entry) => entry.label).join(' · ')}</p>{!!item.affectedRequirements?.length&&<small title={item.affectedRequirements.map(r=>r.title).join('、')}>影响 {item.affectedRequirements.length} 个交付需求 · {item.affectedRequirements.map(r=>r.title).join('、')}</small>}</div>
            <div className="action-item-meta"><span>{item.ownerName || '未分派'}</span>{item.nextReviewAt&&<span>下次核对 {item.nextReviewAt}</span>}<span>{item.dueDate || '无截止日期'}{item.overdueWorkdays ? ` · 逾期${item.overdueWorkdays}个工作日` : ''}</span></div>
            <ArrowRight size={16} />
          </button>)}
          {data && !data.items.length && !isLoading && <EmptyState title={severity||reason||ownerId?'没有匹配的待处理事项':'当前没有待处理事项'} detail={severity||reason||ownerId?'当前条件下无匹配，其他范围仍可能有待处理事项。':'当前可见范围内没有待处理事项。'} action={severity||reason||ownerId?<button className="ghost-button" onClick={clearFilters}>清空筛选</button>:undefined}/>}
        </div>
        {data && <Pagination {...pagination.props} label="待处理事项分页" />}
      </section>
      </>}
    </div>
  </>;
}
