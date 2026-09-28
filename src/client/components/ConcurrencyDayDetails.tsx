import { useState } from 'react';
import { Link } from 'react-router-dom';
import * as reportingApi from '../features/reporting/api';
import { keys } from '../query-keys';
import { useResourceQuery } from '../use-resource-query';
import type { PeopleConcurrency } from '../types';
import { Button } from './Button';
import { EmptyState, LoadingState } from './Feedback';
import { Modal } from './Modal';

export function ConcurrencyDayDetails({ projectId, personId, date, onClose }: {
  projectId: string; personId: string; date: string; onClose: () => void;
}) {
  const [fresh, setFresh] = useState(false);
  const query = useResourceQuery<PeopleConcurrency>([...keys.peopleConcurrency, projectId, 'day', personId, date],
    signal => reportingApi.analyticsPeopleConcurrencyQuery(new URLSearchParams({ projectId, personId, from: date, to: date }), { signal }),
    true, () => setFresh(true), true);
  const person = query.data?.people.find(person => person.id === personId);
  const day = person?.days.find(day => day.date === date);
  const retry = <Button variant="secondary" disabled={query.isFetching} onClick={() => void query.refetch()}>重新读取</Button>;
  return <Modal title="人员工作明细" onClose={onClose}>
    {!fresh && !query.error ? <LoadingState label="正在读取当天工作…" /> : query.unavailable ?
      <EmptyState title="工作明细加载失败" detail={query.error?.message || '暂时无法读取当天工作。'} action={retry} /> : <>
      {query.error && <div className="warning-banner">工作明细刷新失败，当前显示上次读取结果。{retry}</div>}
      <p className="human-day-summary">{person?.name || '所选人员'} · {date} · {date <= query.data!.asOfDate ? '实际工作' : '计划工作'} · {day?.count || 0} 项</p>
      {day?.items.length ? <ul className="human-day-items">{day.items.map(item => <li key={item.id}>
        <Link className="human-work-link" to={`/requirements/${encodeURIComponent(item.requirementId)}?${new URLSearchParams({ projectId, ...(item.id === item.requirementId ? {} : { workItemId: item.id }) })}`}>
          <strong>{item.title}</strong>{item.id !== item.requirementId && <span>{item.requirementTitle}</span>}
        </Link>
      </li>)}</ul> : <EmptyState title="当天暂无工作" detail="工作安排可能已调整，可关闭后继续查看其他日期。" />}
    </>}
  </Modal>;
}
