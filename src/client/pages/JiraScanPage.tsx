import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { ExternalLink, EyeOff, History, Link2, Plus, RefreshCw, ScanSearch, Settings2, Square, Undo2 } from 'lucide-react';
import { useProjects, useSession } from '../app-context';
import { canManageProject } from '../permissions';
import { Button } from '../components/Button';
import { PageHeader } from '../components/PageHeader';
import { SearchInput } from '../components/SearchInput';
import { Select } from '../components/Select';
import { FilterBar } from '../components/FilterBar';
import { JiraViewTabs } from '../features/jira/JiraViewTabs';
import { StatusBadge } from '../components/Badge';
import { Pagination } from '../components/Pagination';
import { useListPagination } from '../use-list-pagination';
import { AdaptiveDataCell as Cell, AdaptiveDataList, AdaptiveDataRow, type AdaptiveDataColumn } from '../components/AdaptiveDataList';
import { EmptyState, LoadingState } from '../components/Feedback';
import { FormError, FormField } from '../components/Form';
import { Modal } from '../components/Modal';
import { TopbarMenu } from '../components/TopbarMenu';
import { RequirementForm, type RequirementCreateRecheck } from '../components/ManagementForms';
import { jiraAssociationLabels, jiraSetupMessages, type JiraImportPreview, type JiraScanRow, type JiraRefresh } from '../../shared/jira';
import { requirementStatusOptions } from '../ui-options';
import { JiraSettingsDialog } from '../features/jira/JiraSettingsDialog';
import { JiraHistoryDialog } from '../features/jira/JiraHistoryDialog';
import { JiraReadStatus, JiraRequirementControls, useJiraRefreshViews } from '../features/jira/JiraRequirement';
import { jiraFeedback } from '../features/jira/feedback';
import * as jira from '../features/jira/api';
import '../features/jira/jira.css';

const columns: AdaptiveDataColumn[] = [
  { key: 'requirement', label: '需求', track: 'minmax(220px,2fr)', compact: 'primary', importance: 'primary' },
  { key: 'scope', label: 'Feature / Phase', track: 'minmax(140px,1fr)', compact: 'full' },
  { key: 'local', label: '本地状态', track: 'minmax(100px,.65fr)', compact: 'detail' },
  { key: 'issue', label: 'Jira 编号', track: 'minmax(110px,.7fr)', compact: 'detail' },
  { key: 'remote', label: 'Jira 当前状态', track: 'minmax(175px,1.2fr)', compact: 'full' },
  { key: 'actions', label: '操作', track: '180px', compact: 'actions', align: 'end' },
];
const discoveryColumns: AdaptiveDataColumn[] = [
  { key: 'issue', label: 'Jira 事项', track: 'minmax(240px,2fr)', importance: 'primary', compact: 'primary' },
  { key: 'remote', label: 'Jira 状态', track: 'minmax(110px,.7fr)' },
  { key: 'requirement', label: '本地关联', track: 'minmax(220px,1.5fr)', compact: 'full' },
  { key: 'actions', label: '操作', track: '180px', compact: 'actions', align: 'end' },
];
export function JiraScanPage() {
  const { selectedProjectId } = useProjects(), { session } = useSession();
  if (!selectedProjectId) return <PageHeader title="Jira 进展管理" />;
  if (!canManageProject(session, selectedProjectId)) return <div className="page-content">只有项目经理可以管理 Jira 进展。</div>;
  return <JiraProject key={session.accountId + ':' + selectedProjectId} projectId={selectedProjectId} accountId={session.accountId || ''} />;
}
function JiraProject({ projectId, accountId }: { projectId: string; accountId: string }) {
  const client = useQueryClient(), [params, setParams] = useSearchParams(), discovery = params.get('view') === 'discovery';
  const refreshViews = useJiraRefreshViews(projectId), stopped = useRef(false), locked = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [progress, setProgress] = useState<JiraRefresh | null>(null), [settingsOpen, setSettingsOpen] = useState(false), [historyOpen, setHistoryOpen] = useState(false);
  const [search, setSearch] = useState(''), [feature, setFeature] = useState(''), [phase, setPhase] = useState(''), [local, setLocal] = useState(''), [remote, setRemote] = useState(''), [association, setAssociation] = useState(''), [readState, setReadState] = useState('');
  const [discoverySearch, setDiscoverySearch] = useState(''), [discoveryAssociation, setDiscoveryAssociation] = useState(''), [ignored, setIgnored] = useState(false);
  const [binding, setBinding] = useState<JiraScanRow | null>(null), [requirementId, setRequirementId] = useState(''), [importing, setImporting] = useState<JiraImportPreview | null>(null), [recheck, setRecheck] = useState<RequirementCreateRecheck | null>(null);
  const config = useQuery({ queryKey: ['jira-settings', projectId], queryFn: () => jira.settings(projectId), retry: false });
  const connection = useQuery({ queryKey: ['jira-connection', accountId], queryFn: jira.connection, retry: false });
  const enabled = !!connection.data?.verifiedAt && connection.data.available && !!config.data?.settings.enabled;
  const progressQuery = useQuery({ queryKey: ['jira-progress', accountId, projectId, connection.data?.version], queryFn: () => jira.progress(projectId), retry: false, refetchOnWindowFocus: false });
  const scanKey = ['jira-scan', accountId, projectId, connection.data?.version];
  const scan = useQuery({ queryKey: scanKey, queryFn: () => jira.latestScan(projectId), enabled: discovery && enabled, retry: false, refetchOnWindowFocus: false });
  useEffect(() => () => { stopped.current = true; }, []);
  function reset() {
    if (discovery) { setDiscoverySearch(''); setDiscoveryAssociation(''); setIgnored(false); }
    else { setSearch(''); setFeature(''); setPhase(''); setLocal(''); setRemote(''); setAssociation(''); setReadState(''); }
  }
  function switchView(view: 'progress' | 'discovery') {
    setParams(previous => { const next = new URLSearchParams(previous); if (view === 'discovery') next.set('view', view); else next.delete('view'); return next; });
  }
  async function run(work: () => Promise<void>) {
    if (locked.current) return; locked.current = true; setBusy(true); setError('');
    try { await work(); } catch (e) { setError(jiraFeedback(e)); } finally { locked.current = false; setBusy(false); refreshViews(); }
  }
  function refreshAll() {
    stopped.current = false; setProgress(null);
    void run(async () => {
      let next: JiraRefresh | null = null;
      do { next = await jira.refreshProgress(projectId, next ? { id: next.id, offset: next.offset } : {}); setProgress(next); await progressQuery.refetch(); }
      while (!next.complete && !stopped.current);
    });
  }
  function discover() {
    stopped.current = false;
    void run(async () => {
      await client.cancelQueries({ queryKey: scanKey });
      let next = await jira.scan(projectId); client.setQueryData(scanKey, next);
      while (next.nextStartAt !== null && !stopped.current && !next.warnings.length) { next = await jira.scan(projectId, next.nextStartAt, next.id); client.setQueryData(scanKey, next); }
    });
  }
  const rows = progressQuery.data?.rows || [];
  const featureOptions = [...new Map(rows.map(r => [JSON.stringify(r.featureId), r.featureName || '未归属 Feature'])).entries()];
  const phaseOptions = [...new Map(rows.filter(r => JSON.stringify(r.featureId) === feature).map(r => [JSON.stringify(r.phaseId), r.phaseName || '未归属 Phase'])).entries()];
  const includes = (query: string, ...values: Array<string | null | undefined>) => values.join(' ').toLowerCase().includes(query.trim().toLowerCase());
  const filtered = rows.filter(r => includes(search, r.title, r.binding?.key, r.issue?.title, ...r.references.map(x => x.key)) && (!feature || JSON.stringify(r.featureId) === feature) && (!phase || JSON.stringify(r.phaseId) === phase) && (!local || r.localStatus === local) && (!remote || r.issue?.status.id === remote && r.readState === 'success') && (!association || (association === 'linked') === !!r.binding) && (!readState || r.readState === readState));
  const found = (scan.data?.rows || []).filter(r => !r.requirementId && r.ignored === ignored && includes(discoverySearch, r.key, r.issue?.title, ...r.candidates.map(c => c.title)) && (!discoveryAssociation || r.association === discoveryAssociation));
  const pages = useListPagination({ items: filtered, id: 'jiraProgress', filterKey: JSON.stringify({ search, feature, phase, local, remote, association, readState }), ready: !!progressQuery.data, disabled: busy });
  const discoveredPages = useListPagination({ items: found, id: 'jiraDiscovery', filterKey: JSON.stringify({ discoverySearch, discoveryAssociation, ignored }), ready: !!scan.data, disabled: busy });
  const statusOptions = [...new Map(rows.filter(r => r.issue && r.readState === 'success').map(r => [r.issue!.status.id, r.issue!.status.name])).entries()];
  return <>
    <PageHeader title="Jira 进展管理" actions={<><Button variant="primary" busy={busy} disabled={!enabled || busy} onClick={discovery ? discover : refreshAll}>{discovery ? <ScanSearch size={16} /> : <RefreshCw size={16} />}{discovery ? '扫描 Jira' : '刷新 Jira 状态'}</Button>{busy && <Button variant="secondary" onClick={() => { stopped.current = true; }}><Square size={14} />停止后续读取</Button>}</>}
      secondaryActions={discovery && <Button variant="secondary" disabled={!config.data || busy} onClick={() => setSettingsOpen(true)}><Settings2 size={15} />发现范围</Button>}
      moreActions={<><Button variant="menu" disabled={busy} onClick={() => setHistoryOpen(true)}><History size={15} />操作记录</Button>{!discovery && <Button variant="menu" disabled={!config.data || busy} onClick={() => setSettingsOpen(true)}><Settings2 size={15} />发现范围与启停</Button>}</>} />
    <div className="page-content jira-progress-page">
      <JiraViewTabs projectId={projectId} value={discovery ? 'discovery' : 'progress'} onChange={switchView} disabled={busy} />
      <FormError>{error || jiraFeedback(config.error) || jiraFeedback(connection.error) || jiraFeedback(progressQuery.error) || (discovery ? jiraFeedback(scan.error) : '')}</FormError>
      {progressQuery.error && <Button variant="secondary" busy={progressQuery.isFetching} onClick={() => void progressQuery.refetch()}><RefreshCw size={15} />重新读取列表</Button>}
      {!enabled && <div className="warning-banner">{connection.data?.setupIssue ? jiraSetupMessages[connection.data.setupIssue] : config.data?.settings.enabled === false ? '项目 Jira 集成已停用' : '请在个人设置中验证 Jira 连接后读取或修改状态。'}</div>}
      {discovery && scan.data?.warnings.map(w => <div className="warning-banner" key={w}>{w}</div>)}
      <FilterBar result={`${discovery ? found.length : filtered.length} 条`} onReset={reset} resetDisabled={discovery ? !discoverySearch && !discoveryAssociation && !ignored : !search && !feature && !phase && !local && !remote && !association && !readState}>
        <SearchInput aria-label="搜索 Jira 需求" placeholder="需求标题、Jira 编号" value={discovery ? discoverySearch : search} onChange={discovery ? setDiscoverySearch : setSearch} />
        <div className="jira-filter-fields" role="group" aria-label="Jira 筛选条件">
        {!discovery && <>
          <Select aria-label="Feature" value={feature} onChange={e => { setFeature(e.target.value); setPhase(''); }}><option value="">全部 Feature</option>{featureOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select>
          <Select aria-label="Phase" value={phase} disabled={!feature} onChange={e => setPhase(e.target.value)}><option value="">全部 Phase</option>{phaseOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select>
          <Select aria-label="本地状态" value={local} onChange={e => setLocal(e.target.value)}><option value="">本地状态</option>{requirementStatusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
          <Select aria-label="Jira 状态" value={remote} onChange={e => setRemote(e.target.value)}><option value="">Jira 状态</option>{statusOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</Select>
          <Select aria-label="读取结果" value={readState} onChange={e => setReadState(e.target.value)}><option value="">读取结果</option><option value="unread">尚未读取</option><option value="success">读取成功</option><option value="failed">读取异常</option></Select>
        </>}
        <Select aria-label="关联情况" value={discovery ? discoveryAssociation : association} onChange={e => (discovery ? setDiscoveryAssociation : setAssociation)(e.target.value)}><option value="">关联情况</option>{discovery ? Object.entries(jiraAssociationLabels).filter(([k]) => k !== 'linked').map(([k, label]) => <option key={k} value={k}>{label}</option>) : <><option value="linked">已关联</option><option value="none">未关联</option></>}</Select>
        {discovery && <label className="jira-check"><input type="checkbox" checked={ignored} onChange={e => setIgnored(e.target.checked)} />已忽略</label>}
        </div>
      </FilterBar>
      {progressQuery.isLoading && <LoadingState />}
      {!discovery ? <AdaptiveDataList label="Jira 需求进展" columns={columns} className="paged-panel" bodyRef={pages.scrollRef} empty={!filtered.length && <EmptyState title="没有符合条件的需求" detail={rows.length ? '调整筛选后查看其他需求。' : '当前项目暂无需求。'} />} footer={<Pagination {...pages.props} label="Jira 需求分页" />}>
        {pages.items.map(row => <AdaptiveDataRow key={row.requirementId}><Cell column="requirement"><Link className="jira-requirement-title" title={row.title} to={'/requirements/' + row.requirementId}>{row.title}</Link></Cell><Cell column="scope"><div className="jira-cell-stack"><span>{row.featureName || '未归属 Feature'}</span><small>{row.phaseName || '未归属 Phase'}</small></div></Cell><Cell column="local"><StatusBadge kind="requirement" value={row.localStatus} /></Cell><Cell column="issue">{row.binding ? <a className="jira-issue-link" href={row.binding.url} target="_blank" rel="noreferrer">{row.binding.key}<ExternalLink size={13} /></a> : <span className="text-muted">{row.references.length ? '有待确认引用' : '未关联'}</span>}</Cell><Cell column="remote"><JiraReadStatus row={row} /></Cell><Cell column="actions"><JiraRequirementControls projectId={projectId} row={row} enabled={enabled} disabled={busy} /></Cell></AdaptiveDataRow>)}
      </AdaptiveDataList> : <AdaptiveDataList label="未纳入 Jira 事项" columns={discoveryColumns} className="paged-panel" bodyRef={discoveredPages.scrollRef} empty={!found.length && <EmptyState title={scan.data ? '没有待处理事项' : '尚未扫描 Jira'} detail={scan.data ? '已关联的事项在进展管理中查看。' : '选择发现范围后扫描。'} />} footer={<Pagination {...discoveredPages.props} label="Jira 发现结果分页" />}>
        {discoveredPages.items.map(row => <AdaptiveDataRow key={row.key}><Cell column="issue"><div className="jira-cell-stack">{row.issue ? <a className="jira-issue-link" href={row.issue.url} target="_blank" rel="noreferrer">{row.key}<ExternalLink size={13} /></a> : row.key}<strong>{row.issue?.title || '无法读取'}</strong><small>{row.issue?.type}</small></div></Cell><Cell column="remote"><span className="status-pill">{row.issue?.status.name || '未知'}</span></Cell><Cell column="requirement"><div className="jira-cell-stack"><span>{jiraAssociationLabels[row.association]}</span>{row.candidates.map(c => <div key={c.id}><Link to={'/requirements/' + c.id}>{c.title}</Link><small>{c.reason}</small></div>)}{row.problem && <span className="text-danger">{row.problem}</span>}</div></Cell><Cell column="actions"><div className="jira-row-controls">{row.association === 'none' ? <Button variant="secondary" size="small" disabled={busy || !enabled || !row.issue} onClick={() => void run(async () => setImporting(await jira.importPreview(projectId, row.key)))}><Plus size={14} />录入需求</Button> : <Button variant="secondary" size="small" disabled={busy || !enabled || !row.issue} onClick={() => { setBinding(row); setRequirementId(row.candidates.length === 1 ? row.candidates[0].id : ''); }}><Link2 size={14} />确认关联</Button>}<TopbarMenu label={row.key + ' 更多操作'} disabled={busy}><Button variant="menu" disabled={!enabled || !row.issue} onClick={() => { setBinding(row); setRequirementId(''); }}><Link2 size={15} />关联已有需求</Button><Button variant="menu" onClick={() => void run(async () => { await jira.ignore(projectId, row.key, !row.ignored); await scan.refetch(); })}>{row.ignored ? <Undo2 size={15} /> : <EyeOff size={15} />}{row.ignored ? '恢复事项' : '忽略事项'}</Button></TopbarMenu></div></Cell></AdaptiveDataRow>)}
      </AdaptiveDataList>}
      <footer className="jira-progress-summary" aria-label="Jira 连接与读取状态"><span>个人连接：{connection.data?.identity || '未验证'}</span><Link to="/settings">个人设置</Link>{progress && !discovery && <span role="status">已读取 {progress.offset} / {progress.total} 项{progress.failed ? `，${progress.failed} 项未完成` : ''}{!progress.complete ? ' · 结果不完整' : ''}</span>}{discovery && scan.data && <span role="status">已读取 {scan.data.rows.length} 项 · Jira 范围共 {scan.data.total} 项{scan.data.complete ? '' : ' · 结果不完整'}</span>}</footer>
    </div>
    {settingsOpen && config.data && <JiraSettingsDialog projectId={projectId} current={config.data} onClose={() => setSettingsOpen(false)} onSaved={saved => { client.setQueryData(['jira-settings', projectId], saved); client.removeQueries({ queryKey: ['jira-scan', accountId, projectId] }); }} />}
    {historyOpen && <JiraHistoryDialog projectId={projectId} onClose={() => setHistoryOpen(false)} />}
    {binding && <Modal title={'关联 ' + binding.key} onClose={() => setBinding(null)} closable={!busy}><form className="jira-action-content" onSubmit={e => { e.preventDefault(); void run(async () => { await jira.bind(projectId, requirementId, binding.key); setBinding(null); }); }}><FormField label="本地需求"><Select aria-label="关联的本地需求" value={requirementId} disabled={busy} onChange={e => setRequirementId(e.target.value)}><option value="">选择需求</option>{rows.filter(r => !r.binding).sort((a, b) => Number(binding.candidates.some(c => c.id === b.requirementId)) - Number(binding.candidates.some(c => c.id === a.requirementId))).map(r => <option key={r.requirementId} value={r.requirementId}>{r.title}</option>)}</Select></FormField><FormError>{error}</FormError><div className="form-actions"><Button variant="primary" type="submit" disabled={busy || !requirementId}>确认关联</Button></div></form></Modal>}
    {importing && <RequirementForm key={importing.id} projectId={projectId} draftKey={'jira:' + importing.issue.key} initialRequirementIds={rows.map(r => r.requirementId)} initialInput={{ title: importing.issue.title, referenceLinks: importing.links }} createRequest={input => jira.importRequirement(projectId, importing.id, input)} recheck={recheck} onRecheckChange={setRecheck} onClose={() => { setImporting(null); setRecheck(null); refreshViews(); }} />}
  </>;
}
