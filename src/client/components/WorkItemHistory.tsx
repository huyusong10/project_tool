import type {Requirement} from '../types';
import {useListPagination} from '../use-list-pagination';
import {formatDateTime} from '../format';
import {Pagination} from './Pagination';
import {EmptyState} from './Feedback';

export function WorkItemHistory({requirement, workItemId}: {requirement: Requirement; workItemId: string}) {
  const pagination = useListPagination({items: (requirement.progressUpdates || []).filter(update => update.workItemId === workItemId), id: 'work-history:' + workItemId, defaultPageSize: 10, ready: true});
  return <div className="work-item-history">
    <div ref={pagination.scrollRef}>{pagination.items.map(update => <article className="work-history-entry" key={update.id}>
      <header><time>{formatDateTime(update.createdAt)}</time><span>{update.createdByName || '系统记录'}</span></header>
      <p>{update.content}</p><small>{update.workItemPercent == null ? '执行记录' : `完成度 ${update.workItemPercent}%`}</small>
    </article>)}</div>
    {!pagination.items.length && <EmptyState title="暂无执行记录" detail="开始、更新或完成此工作项后，记录会显示在这里。"/>}
    <Pagination {...pagination.props} label="工作项记录分页"/>
  </div>;
}
