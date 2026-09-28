import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Check, EyeOff, GitPullRequest, Undo2 } from 'lucide-react';
import { useProjects, useSession } from '../app-context';
import { canManageProject } from '../permissions';
import { PageHeader } from '../components/PageHeader';
import { Button, ButtonLink } from '../components/Button';
import { FormError } from '../components/Form';
import { FilterBar } from '../components/FilterBar';
import { SearchInput } from '../components/SearchInput';
import { Select } from '../components/Select';
import { ViewTabs } from '../components/ViewTabs';
import { LoadingState } from '../components/Feedback';
import { AdaptiveDataCell as Cell, AdaptiveDataList, AdaptiveDataRow } from '../components/AdaptiveDataList';
import { Pagination } from '../components/Pagination';
import { useListPagination } from '../use-list-pagination';
import { JiraPrCreate } from '../features/jira/JiraPrCreate';
import { JiraPrEditor } from '../features/jira/JiraPrEditor';
import { JiraPrLoading } from '../features/jira/JiraPrLoading';
import { JiraViewTabs } from '../features/jira/JiraViewTabs';
import { JiraManualSyncDialog } from '../features/jira/JiraManualSyncDialog';
import { jiraFeedback } from '../features/jira/feedback';
import { jiraProgressSyncLabels } from '../../shared/jira-pr';
import * as api from '../features/jira/pr-api';
import '../features/jira/jira.css';
import '../features/jira/jira-pr.css';

export function JiraPrPage() {
  const { selectedProjectId } = useProjects(), { session } = useSession();
  if (!selectedProjectId || !canManageProject(session, selectedProjectId)) return <div className="page-content">只有项目经理可以管理 Jira PR。</div>;
  return <PrPage key={selectedProjectId + ':' + session.accountId} projectId={selectedProjectId} />;
}
function PrPage({ projectId }: { projectId: string }) {
  const { id } = useParams(), navigate = useNavigate(), [params, setParams] = useSearchParams();
  const client = useQueryClient();
  const [creating, setCreating] = useState(params.get('create') === '1');
  const view = params.get('view') === 'sources' ? 'sources' : 'prs';
  const search = params.get('q') || '', feature = params.get('feature') || '', phase = params.get('phase') || '', state = params.get('syncState') ?? 'pending';
  const [selected, setSelected] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [manual, setManual] = useState<{ ids: string[]; restore: boolean } | null>(null);
  const requirement = params.get('requirement') || '', cutoff = params.get('cutoff') || '';
  const setFilters = (values: Record<string, string>, replace = true) => {
    setSelected([]);
    setParams(current => { const next = new URLSearchParams(current); for (const [key, value] of Object.entries(values)) next.set(key, value); return next; }, { replace });
  };
  const list = useQuery({ queryKey: ['jira-prs', projectId], queryFn: () => api.list(projectId), enabled: !id, retry: false, refetchOnWindowFocus: false });
  const active = list.data?.find(p => p.state === 'active' || p.state === 'running');
  const resolvedId = id || (!params.has('view') ? active?.id : undefined);
  const detail = useQuery({ queryKey: ['jira-pr', projectId, resolvedId], queryFn: () => api.read(projectId, resolvedId!), enabled: !!resolvedId, staleTime: 5000, retry: false, refetchOnWindowFocus: false });
  const candidates = useQuery({ queryKey: ['jira-pr-candidates', projectId], queryFn: () => api.candidates(projectId), enabled: !id && view === 'sources', retry: false, refetchOnWindowFocus: false });
  const features = [...new Map((candidates.data || []).map(r => [r.featureId || '__none', r.featureName || '未归属 Feature'])).entries()];
  const phases = [...new Set((candidates.data || []).filter(r => (r.featureId || '__none') === feature).map(r => r.phaseName || '未归属 Phase'))];
  const requirements = (candidates.data || []).filter(r => (!feature || (r.featureId || '__none') === feature) && (!phase || (r.phaseName || '未归属 Phase') === phase));
  const sources = requirements.filter(r => !requirement || r.requirementId === requirement).flatMap(r => r.sources.map(s => ({ ...s, title: r.title, key: r.key, featureName: r.featureName }))).filter(s => (!state || s.jiraSyncState === state) && (!cutoff || s.createdAt <= new Date(cutoff + 'T23:59:59.999+08:00').toISOString()) && `${s.title} ${s.key} ${s.content}`.toLowerCase().includes(search.trim().toLowerCase()));
  const pages = useListPagination({ items: list.data || [], id: 'prs', ready: !!list.data });
  const sourcePages = useListPagination({ items: sources, id: 'prSources', filterKey: JSON.stringify([search, feature, phase, state, requirement, cutoff]), ready: !!candidates.data, disabled: busy });
  const visibleSelected = selected.filter(id => sources.some(s => s.id === id));
  async function ignore(ignored: boolean) {
    setBusy(true); setError('');
    try { await api.ignore(projectId, visibleSelected, ignored); setSelected([]); await candidates.refetch(); } catch (e) { setError(jiraFeedback(e)); } finally { setBusy(false); }
  }
  if (resolvedId) {
    if (!detail.data) return <JiraPrLoading projectId={projectId} error={jiraFeedback(detail.error)} onRetry={() => void detail.refetch()} />;
    if (!id) return <><JiraPrLoading projectId={projectId} /><Navigate replace to={'/jira/prs/' + resolvedId + '?projectId=' + projectId} /></>;
    return <JiraPrEditor key={id} initial={detail.data} />;
  }
  if (!params.has('view') && !list.data) return <JiraPrLoading projectId={projectId} error={jiraFeedback(list.error)} onRetry={() => void list.refetch()} />;
  return <><PageHeader title="Jira PR" actions={active ? <ButtonLink variant="primary" to={'/jira/prs/' + active.id + '?projectId=' + projectId}><GitPullRequest size={16} />继续 PR</ButtonLink> : <Button variant="primary" disabled={list.isLoading || !!list.error} onClick={() => setCreating(true)}><GitPullRequest size={16} />创建 PR</Button>} />
    <div className="page-content jira-pr-page">
      <JiraViewTabs projectId={projectId} value="prs" />
      <ViewTabs ariaLabel="PR 视图" value={view} options={[{ value: 'prs', label: 'PR 列表' }, { value: 'sources', label: '进展同步记录' }]} onChange={value => setFilters({ view: value === 'sources' ? 'sources' : 'history' }, false)} />
      <FormError>{error || jiraFeedback(list.error) || jiraFeedback(candidates.error)}</FormError>
      {view === 'prs' ? <AdaptiveDataList label="Jira PR 列表" columns={[{ key: 'pr', label: 'PR', track: 'minmax(180px,1fr)', compact: 'primary' }, { key: 'state', label: '状态', track: '130px' }, { key: 'count', label: '事项', track: '80px' }, { key: 'time', label: '最近更新', track: '200px' }]} className="paged-panel" bodyRef={pages.scrollRef} footer={<Pagination {...pages.props} loading={list.isLoading} label="PR 历史分页" />} empty={list.isSuccess && !list.data.length && <p>暂无 PR</p>}>
        {list.isLoading && <LoadingState label="正在读取 PR 历史…" />}
        {pages.items.map(p => <AdaptiveDataRow key={p.id}><Cell column="pr"><Link to={'/jira/prs/' + p.id + '?projectId=' + projectId}>PR · {new Date(p.createdAt).toLocaleString('zh-CN')}</Link></Cell><Cell column="state"><span className="status-pill">{{ active: '待继续', running: '推送中', completed: '已完成', abandoned: '已结束' }[p.state]}</span></Cell><Cell column="count">{p.itemCount}</Cell><Cell column="time">{new Date(p.updatedAt).toLocaleString('zh-CN')}</Cell></AdaptiveDataRow>)}
      </AdaptiveDataList> : <>
        <p className="text-muted">待同步记录尚未进入 PR，也未发布到 Jira。未关联记录会保留待同步，创建并确认 PR 后才会推送。</p>
        <FilterBar result={`${sources.length} 条`}><SearchInput aria-label="搜索同步记录" placeholder="需求、编号、进展内容" value={search} onChange={value => setFilters({ q: value })} /><Select aria-label="同步记录 Feature" value={feature} onChange={e => setFilters({ feature: e.target.value, phase: '', requirement: '' })}><option value="">全部 Feature</option>{features.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select><Select aria-label="同步记录 Phase" disabled={!feature} value={phase} onChange={e => setFilters({ phase: e.target.value, requirement: '' })}><option value="">全部 Phase</option>{phases.map(name => <option key={name} value={name}>{name}</option>)}</Select><Select aria-label="同步记录需求" value={requirement} onChange={e => setFilters({ requirement: e.target.value })}><option value="">全部需求</option>{requirements.map(r => <option key={r.requirementId} value={r.requirementId}>{r.title}</option>)}</Select><Select aria-label="进展同步状态" value={state} onChange={e => setFilters({ syncState: e.target.value })}><option value="">全部状态</option>{Object.entries(jiraProgressSyncLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select><label className="jira-check">截至<input type="date" aria-label="同步记录截止日期" value={cutoff} onChange={e => setFilters({ cutoff: e.target.value })} /></label></FilterBar>
        <div className="jira-pr-summary"><label className="jira-check"><input type="checkbox" disabled={busy || !sources.length} checked={!!sources.length && visibleSelected.length === sources.length} onChange={e => setSelected(e.target.checked ? sources.filter(s => s.jiraSyncState !== 'synced' || s.jiraManualAccountId).map(s => s.id) : [])} />全选当前筛选</label><span>已选 {visibleSelected.length} 条</span>{state === 'pending' && <Button disabled={busy || !visibleSelected.length} onClick={() => void ignore(true)}><EyeOff size={15} />不再同步</Button>}{state === 'ignored' && <Button disabled={busy || !visibleSelected.length} onClick={() => void ignore(false)}><Undo2 size={15} />恢复待同步</Button>}<Button disabled={busy || !visibleSelected.length || sources.some(s => visibleSelected.includes(s.id) && s.jiraSyncState === 'synced')} onClick={() => setManual({ ids: visibleSelected, restore: false })}><Check size={15} />标记已在 Jira 同步</Button>{state === 'synced' && <Button disabled={busy || !visibleSelected.length || sources.some(s => visibleSelected.includes(s.id) && !s.jiraManualAccountId)} onClick={() => setManual({ ids: visibleSelected, restore: true })}><Undo2 size={15} />撤销人工确认</Button>}</div>
        <AdaptiveDataList label="进展同步记录" columns={[{ key: 'pick', label: '选择', track: '50px' }, { key: 'source', label: '进展', track: 'minmax(240px,2fr)', compact: 'primary' }, { key: 'requirement', label: '需求', track: 'minmax(180px,1fr)' }, { key: 'state', label: '同步状态', track: '100px' }, { key: 'pr', label: 'PR', track: '100px' }]} className="paged-panel" bodyRef={sourcePages.scrollRef} footer={<Pagination {...sourcePages.props} label="进展同步记录分页" />} empty={!sources.length && <p>没有符合条件的进展</p>}>
          {sourcePages.items.map(s => <AdaptiveDataRow key={s.id}><Cell column="pick"><input type="checkbox" aria-label={'选择进展 ' + s.id} disabled={busy || s.jiraSyncState === 'synced' && !s.jiraManualAccountId} checked={visibleSelected.includes(s.id)} onChange={e => setSelected(e.target.checked ? [...selected, s.id] : selected.filter(id => id !== s.id))} /></Cell><Cell column="source"><div className="jira-cell-stack"><span>{s.content || s.eventType}</span><small>{new Date(s.createdAt).toLocaleString('zh-CN')} · {s.createdByName || '未记录人员'} · {s.workItemTitle || '需求'}</small>{s.jiraManualAccountId && <small title={s.jiraManualReason || undefined}>人工确认于 {s.jiraSyncedAt && new Date(s.jiraSyncedAt).toLocaleString('zh-CN')} · {s.jiraManualReason}</small>}</div></Cell><Cell column="requirement"><Link to={'/requirements/' + encodeURIComponent(s.requirementId) + '?detailTab=history'}>{s.title}</Link></Cell><Cell column="state">{s.jiraManualAccountId ? '已同步（人工确认）' : jiraProgressSyncLabels[s.jiraSyncState]}</Cell><Cell column="pr">{s.jiraPrId ? <Link to={'/jira/prs/' + s.jiraPrId + '?projectId=' + projectId}>查看 PR</Link> : s.jiraManualAccountId ? '人工确认' : '未纳入'}</Cell></AdaptiveDataRow>)}
        </AdaptiveDataList>
      </>}
    </div>
    {creating && <JiraPrCreate projectId={projectId} onClose={() => { setCreating(false); setParams(p => { p.delete('create'); return p; }); }} onCreated={pr => { setCreating(false); client.setQueryData(['jira-pr', projectId, pr.id], pr); void list.refetch(); navigate('/jira/prs/' + pr.id + '?projectId=' + projectId); }} />}
    {manual && <JiraManualSyncDialog projectId={projectId} {...manual} onClose={() => setManual(null)} onDone={() => { setManual(null); setSelected([]); void candidates.refetch(); }} />}
  </>;
}
