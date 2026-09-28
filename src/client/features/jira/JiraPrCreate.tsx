import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GitPullRequest, RefreshCw } from 'lucide-react';
import { useSession } from '../../app-context';
import { Modal } from '../../components/Modal';
import { Button, ButtonLink } from '../../components/Button';
import { StatusBadge } from '../../components/Badge';
import { FormError, FormField } from '../../components/Form';
import { SearchInput } from '../../components/SearchInput';
import { FilterBar } from '../../components/FilterBar';
import { AdaptiveDataCell as Cell, AdaptiveDataList, AdaptiveDataRow } from '../../components/AdaptiveDataList';
import { Pagination } from '../../components/Pagination';
import { useListPagination } from '../../use-list-pagination';
import { JiraMultiSelect } from './JiraMultiSelect';
import { jiraFeedback } from './feedback';
import { connectionFeedback } from './connection-feedback';
import { jiraSetupMessages } from '../../../shared/jira';
import type { JiraPr, PrGeneration } from '../../../shared/jira-pr';
import * as prApi from './pr-api';
import * as jira from './api';

export function JiraPrCreate({ projectId, current, onClose, onCreated }: { projectId: string; current?: JiraPr; onClose: () => void; onCreated: (pr: JiraPr) => void }) {
  const { session } = useSession();
  const connection = useQuery({ queryKey: ['jira-connection', session.accountId], queryFn: jira.connection, retry: false, refetchOnWindowFocus: false });
  const settings = useQuery({ queryKey: ['jira-settings', projectId], queryFn: () => jira.settings(projectId), retry: false, refetchOnWindowFocus: false });
  const checking = connection.isPending || connection.isFetching || settings.isPending || settings.isFetching;
  const prerequisite = connectionFeedback(connection.error) || jiraFeedback(settings.error)
    || (connection.data?.setupIssue ? jiraSetupMessages[connection.data.setupIssue] : settings.data?.settings.enabled === false ? '项目 Jira 集成已停用，请在 Jira 进展管理中核对项目设置。'
      : connection.data?.problem || (!connection.data?.verifiedAt || !connection.data.available ? '请在个人设置中验证 Jira 连接后整理 PR。' : ''));
  const ready = !checking && !prerequisite;
  const rows = useQuery({ queryKey: ['jira-pr-candidates', projectId], queryFn: () => prApi.candidates(projectId), retry: false, refetchOnWindowFocus: false });
  const [features, setFeatures] = useState<string[]>(current?.scope.featureIds.map(id => id || '__none') || []);
  const [excluded, setExcluded] = useState<string[]>(current?.scope.excludedRequirementIds || []), [search, setSearch] = useState('');
  const [generation, setGeneration] = useState<PrGeneration | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const options = [...new Map((rows.data || []).map(r => [r.featureId || '__none', r.featureName || '未归属 Feature'])).entries()].map(([value, label]) => ({ value, label }));
  const selected = (rows.data || []).filter(r => features.includes(r.featureId || '__none'));
  const sources = selected.filter(r => !excluded.includes(r.requirementId)).flatMap(r => r.sources.filter(s => s.jiraSyncState === 'pending'));
  const dates = sources.map(s => s.createdAt).sort();
  const filtered = selected.filter(r => `${r.title} ${r.key || ''} ${r.phaseName || ''} ${r.featureName || ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  const pages = useListPagination({ items: filtered, id: 'prScope', filterKey: features.join() + search, ready: !!rows.data, disabled: busy });
  const included = selected.filter(r => !excluded.includes(r.requirementId)).length;
  async function generate() {
    if (!ready) return;
    setBusy(true); setError('');
    try {
      const next = await prApi.generate(projectId, { featureIds: features.map(f => f === '__none' ? null : f), excludedRequirementIds: excluded }, current);
      if (current) setGeneration(next);
      else onCreated(await prApi.apply(projectId, next.id));
    } catch (e) { setError(jiraFeedback(e)); } finally { setBusy(false); }
  }
  async function apply() {
    if (!generation || !ready) return; setBusy(true); setError('');
    try { onCreated(await prApi.apply(projectId, generation.id)); } catch (e) { setError(jiraFeedback(e)); } finally { setBusy(false); }
  }
  return <Modal title={current ? '更新 PR 草稿' : '创建 PR'} width={1040} layout="workspace" onClose={onClose} closable={!busy}>
    <div className="jira-pr-create">
      <div className={'jira-pr-create-body' + (!generation ? ' jira-pr-scope-body' : '')}>
        {!ready && <div className="warning-banner jira-pr-prerequisite" role="status"><p>{checking ? '正在核对 Jira 连接与项目设置…' : prerequisite}</p><div className="jira-pr-summary">{!connection.data?.setupIssue && settings.data?.settings.enabled !== false && <ButtonLink variant="link" to="/settings">个人设置</ButtonLink>}<Button disabled={busy || checking} onClick={() => { setError(''); void connection.refetch(); void settings.refetch(); }}><RefreshCw size={15} />重新读取连接与设置</Button></div></div>}
        {!generation ? <>
          <FormField label="同步的 Feature"><JiraMultiSelect label="同步的 Feature" value={features} options={options} onChange={setFeatures} disabled={busy || !ready} loading={rows.isFetching} maxSelections={options.length} bulkSelection /></FormField>
          <div className="jira-pr-summary" role="status"><strong>{included} 个需求 · {sources.length} 条待同步进展</strong><span>{dates.length ? `${new Date(dates[0]).toLocaleDateString('zh-CN')} 至 ${new Date(dates.at(-1)!).toLocaleDateString('zh-CN')}` : '无待同步进展'}</span></div>
          <FilterBar result={`${filtered.length} 个需求`}><SearchInput aria-label="搜索 PR 范围" placeholder="需求、Feature、Phase、Jira 编号" value={search} onChange={setSearch} /><label className="jira-check"><input type="checkbox" disabled={busy || !filtered.length} checked={!!filtered.length && filtered.every(r => !excluded.includes(r.requirementId))} onChange={e => setExcluded(e.target.checked ? excluded.filter(id => !filtered.some(r => r.requirementId === id)) : [...new Set([...excluded, ...filtered.map(r => r.requirementId)])])} />纳入筛选结果</label></FilterBar>
          <AdaptiveDataList label="PR 同步范围" columns={[{ key: 'title', label: '需求 / 归属', track: 'minmax(240px,1fr)', compact: 'primary' }, { key: 'local', label: '本地状态', track: '140px' }, { key: 'progress', label: '待同步', track: '90px' }, { key: 'jira', label: 'Jira', track: '110px' }]} className="paged-panel jira-pr-scope-list" bodyRef={pages.scrollRef} footer={<Pagination {...pages.props} label="PR 范围分页" />} empty={!filtered.length && <p className="text-muted">{features.length ? '没有匹配需求' : '请选择 Feature'}</p>}>
            {pages.items.map(r => <AdaptiveDataRow key={r.requirementId}>
              <Cell column="title"><label className="jira-pr-scope-title"><input type="checkbox" aria-label={'纳入 ' + r.title} disabled={busy} checked={!excluded.includes(r.requirementId)} onChange={e => setExcluded(e.target.checked ? excluded.filter(id => id !== r.requirementId) : [...excluded, r.requirementId])} /><span><strong title={r.title}>{r.title}{r.archived ? '（已归档）' : ''}</strong><small title={(r.featureName || '') + ' / ' + r.phaseName}>{r.featureName || '未归属 Feature'} / {r.phaseName || '未归属 Phase'}</small></span></label></Cell>
              <Cell column="local"><StatusBadge kind="requirement" value={r.localStatus || 'not_started'} /><small>{r.localProgress ?? 0}%</small></Cell>
              <Cell column="progress">{r.sources.filter(s => s.jiraSyncState === 'pending').length} 条</Cell><Cell column="jira">{r.key || '未关联'}</Cell>
            </AdaptiveDataRow>)}
          </AdaptiveDataList>
        </> : <>
          <div className="jira-pr-summary"><strong>{generation.items.length} 个事项</strong><span>{generation.items.flatMap(i => i.sources).length} 条新增进展 · {generation.items.flatMap(i => i.steps).length} 条新增评论</span></div>
          {generation.warnings.map((w, i) => <p className="warning-banner" key={i}>{w}</p>)}
          {generation.items.map(item => <section className="jira-pr-generation-item" key={item.requirementId}><h3>{item.title}</h3><p>{item.basis}{item.decisionRequired ? ' · 状态待选择' : ''}</p>{item.steps.map(step => <div key={step.id}><strong>{step.kind === 'transition' ? `拟进入 ${step.target?.name || '待选择'}` : '发布评论'}</strong><pre className="jira-pr-body-preview">{step.body}</pre></div>)}</section>)}
        </>}
      </div>
      <footer className="jira-pr-dialog-footer"><FormError>{error || jiraFeedback(rows.error)}</FormError><div className="form-actions"><Button onClick={onClose} disabled={busy}>取消</Button>{generation ? <><Button disabled={busy} onClick={() => setGeneration(null)}>返回范围</Button><Button variant="primary" busy={busy} disabled={!ready || !generation.items.length} onClick={() => void apply()}><GitPullRequest size={16} />加入当前草稿</Button></> : <Button variant="primary" busy={busy} disabled={!ready || !features.length || !included || rows.isFetching} onClick={() => void generate()}>{current ? <RefreshCw size={16} /> : <GitPullRequest size={16} />}{current ? '预览新增内容' : '创建 PR'}</Button>}</div></footer>
    </div>
  </Modal>;
}
