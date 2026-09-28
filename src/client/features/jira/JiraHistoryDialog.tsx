import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '../../app-context';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { Pagination } from '../../components/Pagination';
import { useListPagination } from '../../use-list-pagination';
import { FormError } from '../../components/Form';
import type { JiraAction } from '../../../shared/jira';
import { JiraActionDialog } from './JiraActionDialog';
import { useJiraRefreshViews } from './JiraRequirement';
import { jiraFeedback } from './feedback';
import * as jira from './api';

export function JiraHistoryDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { session } = useSession(), refresh = useJiraRefreshViews(projectId), [selected, setSelected] = useState<JiraAction | null>(null);
  const query = useQuery({ queryKey: ['jira-operations', session.accountId, projectId], queryFn: () => jira.operations(projectId), retry: false });
  const pages = useListPagination({ items: query.data || [], id: 'jiraHistory', defaultPageSize: 10, ready: !!query.data });
  return <Modal title="Jira 操作记录" width={800} layout="workspace" onClose={onClose}><div className="jira-history paged-panel"><FormError>{jiraFeedback(query.error)}</FormError><div className="paged-body" ref={pages.scrollRef}>{pages.items.map(record => <div className="jira-history-row" key={record.id}><div className="jira-cell-stack"><strong>{record.items.map(i => i.key).join('、')}</strong><small>{new Date(record.createdAt).toLocaleString('zh-CN', { hour12: false })} · {record.legacy ? '历史同步' : record.items[0]?.transitionName}</small><span>{record.items.some(i => i.outcome === 'unknown') ? '结果待核对' : record.items.map(i => i.message || '待确认').join('；')}</span></div><Button variant="secondary" onClick={() => setSelected(record)}>查看结果</Button></div>)}{!query.data?.length && <p className="text-muted">暂无操作记录</p>}</div><Pagination {...pages.props} label="Jira 操作记录分页" /></div>{selected && <JiraActionDialog projectId={projectId} initial={selected} onClose={() => setSelected(null)} onChanged={refresh} />}</Modal>;
}
