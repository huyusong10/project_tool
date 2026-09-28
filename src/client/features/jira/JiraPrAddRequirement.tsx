import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { JiraPr } from '../../../shared/jira-pr';
import { Modal } from '../../components/Modal';
import { FilterBar } from '../../components/FilterBar';
import { SearchInput } from '../../components/SearchInput';
import { Select } from '../../components/Select';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/Badge';
import { FormError } from '../../components/Form';
import { AdaptiveDataList, AdaptiveDataRow, AdaptiveDataCell as Cell } from '../../components/AdaptiveDataList';
import { Pagination } from '../../components/Pagination';
import { useListPagination } from '../../use-list-pagination';
import * as api from './pr-api';
import { jiraFeedback } from './feedback';

export function JiraPrAddRequirement({ pr, onClose, onAdded }: { pr: JiraPr; onClose: () => void; onAdded: (pr: JiraPr, id: string) => void }) {
  const rows = useQuery({ queryKey: ['jira-pr-candidates', pr.projectId], queryFn: () => api.candidates(pr.projectId), retry: false, refetchOnWindowFocus: false });
  const [search, setSearch] = useState(''), [feature, setFeature] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const features = [...new Map((rows.data || []).map(r => [r.featureId || '__none', r.featureName || '未归属 Feature'])).entries()];
  const filtered = (rows.data || []).filter(r => !pr.items.some(i => i.requirementId === r.requirementId) && (!feature || (r.featureId || '__none') === feature) && `${r.title} ${r.key}`.toLowerCase().includes(search.trim().toLowerCase()));
  const pages = useListPagination({ items: filtered, id: 'prAdd', filterKey: search + feature, ready: !!rows.data, disabled: busy });
  async function add(id: string) { setBusy(true); setError(''); try { onAdded(await api.addRequirement(pr, id), id); } catch (e) { setError(jiraFeedback(e)); } finally { setBusy(false); } }
  return <Modal title="添加需求与评论" width={900} layout="workspace" onClose={onClose} closable={!busy}><div className="jira-pr-create"><div className="jira-pr-create-body jira-pr-scope-body">
    <FilterBar result={`${filtered.length} 个需求`}><SearchInput aria-label="查找待添加需求" value={search} onChange={setSearch} placeholder="需求、Jira 编号" /><Select aria-label="待添加 Feature" value={feature} onChange={e => setFeature(e.target.value)}><option value="">全部 Feature</option>{features.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</Select></FilterBar>
    <FormError>{error || jiraFeedback(rows.error)}</FormError>
    <AdaptiveDataList label="待添加需求" className="paged-panel jira-pr-scope-list" bodyRef={pages.scrollRef} columns={[{ key: 'title', label: '需求 / 归属', track: 'minmax(200px,1fr)' }, { key: 'local', label: '本地状态', track: '110px' }, { key: 'jira', label: 'Jira', track: '110px' }, { key: 'add', label: '操作', track: '70px' }]} footer={<Pagination {...pages.props} />} empty={!filtered.length && <p>没有匹配需求</p>}>
      {pages.items.map(r => <AdaptiveDataRow key={r.requirementId}><Cell column="title"><span className="jira-pr-scope-title"><span><strong>{r.title}</strong><small>{r.featureName || '未归属 Feature'} / {r.phaseName || '未归属 Phase'}</small></span></span></Cell><Cell column="local"><StatusBadge kind="requirement" value={r.localStatus || 'not_started'} /></Cell><Cell column="jira">{r.key || '未关联'}</Cell><Cell column="add"><Button iconOnly title={r.key ? '加入草稿' : '请先关联 Jira'} aria-label={'加入草稿 ' + r.title} disabled={busy || !r.key} onClick={() => void add(r.requirementId)}><Plus size={16} /></Button></Cell></AdaptiveDataRow>)}
    </AdaptiveDataList></div></div></Modal>;
}
