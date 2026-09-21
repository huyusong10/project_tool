import {DetailCard} from './DetailCard';
import type {Requirement} from '../types';
import {useListPagination} from '../use-list-pagination';
import {formatDateTime} from '../format';
import {Pagination} from './Pagination';
import {EmptyState} from './Feedback';
import {progressReferenceLabel} from '../progress-trend';

export function WorkItemHistory({requirement, workItemId}: {requirement: Requirement; workItemId: string}) {
  const updates=(requirement.progressUpdates||[]).filter(update=>update.workItemId===workItemId);
  const progressById=new Map(updates.map(update=>[update.id,update]));
  const pagination = useListPagination({items:updates, id: 'work-history:' + workItemId, defaultPageSize: 10, ready: true});
  return <DetailCard title="执行记录" className="work-item-history">
    <div ref={pagination.scrollRef}>{pagination.items.map(update => <article className="work-history-entry" key={update.id}>
      <header><time>{formatDateTime(update.createdAt)}</time><span>{update.createdByName || '系统记录'}</span></header>
      <p>{update.content}</p><small>{update.workItemPercent == null ? '执行记录' : `完成度 ${update.workItemPercent}%`}</small>
      {update.supersedesId&&<small className="progress-correction-reference">更正：{progressReferenceLabel(progressById.get(update.supersedesId))}</small>}
    </article>)}</div>
    {!pagination.items.length && <EmptyState title="暂无执行记录" detail="开始、更新或完成此工作项后，记录会显示在这里。"/>}
    <Pagination {...pagination.props} label="工作项记录分页"/>
  </DetailCard>;
}
