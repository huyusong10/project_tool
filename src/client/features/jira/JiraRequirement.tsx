import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Link2, Link2Off, RefreshCw, ArrowRightLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSession } from '../../app-context';
import { canManageProject } from '../../permissions';
import { Button } from '../../components/Button';
import { TopbarMenu } from '../../components/TopbarMenu';
import { Modal, ConfirmDialog, useSynchronousPendingLock } from '../../components/Modal';
import { FormError, FormField } from '../../components/Form';
import { Select } from '../../components/Select';
import { JiraActionDialog } from './JiraActionDialog';
import { jiraFeedback } from './feedback';
import { jiraSetupMessages, type JiraProgressRow } from '../../../shared/jira';
import * as jira from './api';
import './jira.css';

export function useJiraRefreshViews(projectId: string) {
  const client = useQueryClient(), { session } = useSession();
  return () => {
    void client.invalidateQueries({ queryKey: ['jira-progress', session.accountId, projectId] });
    void client.invalidateQueries({ queryKey: ['jira-requirement', session.accountId, projectId] });
    void client.invalidateQueries({ queryKey: ['jira-operations', session.accountId, projectId] });
    void client.invalidateQueries({ queryKey: ['jira-scan', session.accountId, projectId] });
  };
}
export function JiraReadStatus({ row }: { row: JiraProgressRow }) {
  return <div className="jira-cell-stack">
    {row.problem ? <span className="text-danger">{row.problem}</span> : row.issue ? <span className="status-pill">{row.issue.status.name}</span> : <span className="text-muted">{row.binding ? '尚未读取' : '未关联'}</span>}
    {row.issue && row.problem && <small>上次读取：{row.issue.status.name}</small>}
    {row.checkedAt && <small>{row.readState === 'failed' ? '尝试读取' : '读取于'} {new Date(row.checkedAt).toLocaleString('zh-CN', { hour12: false })}</small>}
  </div>;
}
export function JiraRequirementControls({ projectId, row, enabled, disabled = false }: { projectId: string; row: JiraProgressRow; enabled: boolean; disabled?: boolean }) {
  const refresh = useJiraRefreshViews(projectId);
  const [action, setAction] = useState<'change' | 'bind' | 'unbind' | null>(null), [key, setKey] = useState('');
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const lock = useSynchronousPendingLock(pending);
  function open(kind: typeof action) { setError(''); setAction(kind); setKey(row.references[0]?.key || ''); }
  async function save(unbind = false) {
    setPending(true); setError('');
    try {
      if (unbind) await jira.unbind(projectId, row.requirementId);
      else await jira.bind(projectId, row.requirementId, key.trim().toUpperCase());
      setAction(null); refresh();
    } catch (e) { setError(jiraFeedback(e)); } finally { setPending(false); }
  }
  return <>
    <div className="jira-row-controls">
      {row.binding ? <Button variant="secondary" size="small" disabled={!enabled || disabled} onClick={() => open('change')}><ArrowRightLeft size={14} />修改状态</Button> : <Button variant="secondary" size="small" disabled={!enabled || disabled} onClick={() => open('bind')}><Link2 size={14} />关联 Jira</Button>}
      {row.binding && <TopbarMenu label={row.title + ' Jira 更多操作'} disabled={disabled || pending}><Button variant="menu" onClick={() => open('unbind')}><Link2Off size={15} />解除关联</Button></TopbarMenu>}
    </div>
    {action === 'change' && <JiraActionDialog projectId={projectId} requirementId={row.requirementId} onClose={() => { setAction(null); refresh(); }} onChanged={refresh} />}
    {action === 'bind' && <Modal title="关联 Jira 事项" onClose={() => setAction(null)} closable={!pending}>
      <form onSubmit={e => { e.preventDefault(); lock.run(() => void save()); }} className="jira-action-content"><strong>{row.title}</strong>
        {!!row.references.length && <FormField label="已有引用"><Select aria-label="已有 Jira 引用" value={row.references.some(r => r.key === key) ? key : ''} disabled={pending} onChange={e => setKey(e.target.value)}><option value="">选择已有引用</option>{row.references.map(r => <option key={r.key} value={r.key}>{r.key} · {r.reason}</option>)}</Select></FormField>}
        <FormField label="Jira 编号"><input aria-label="Jira 编号" required value={key} disabled={pending} onChange={e => setKey(e.target.value)} placeholder="DCIM-123" /></FormField><FormError>{error}</FormError><div className="form-actions"><Button variant="secondary" type="button" disabled={pending} onClick={() => setAction(null)}>取消</Button><Button variant="primary" type="submit" busy={pending} disabled={pending || !key.trim()}>确认关联</Button></div>
      </form></Modal>}
    {action === 'unbind' && <ConfirmDialog title="解除 Jira 关联" description="需求和参考链接均保留；后续刷新不会自动恢复这条关联。" confirmLabel="解除关联" pending={pending} error={error} onClose={() => setAction(null)} onConfirm={() => lock.run(() => void save(true))} />}
  </>;
}
export function JiraRequirement({ projectId, requirementId }: { projectId: string; requirementId: string }) {
  const { session } = useSession(), manage = canManageProject(session, projectId), refresh = useJiraRefreshViews(projectId);
  const link = useQuery({ queryKey: ['jira-link', session.accountId, projectId, requirementId], queryFn: () => jira.requirementLink(projectId, requirementId), enabled: !manage, retry: false });
  const connection = useQuery({ queryKey: ['jira-connection', session.accountId], queryFn: jira.connection, enabled: manage, retry: false });
  const settings = useQuery({ queryKey: ['jira-settings', projectId], queryFn: () => jira.settings(projectId), enabled: manage, retry: false });
  const query = useQuery({ queryKey: ['jira-requirement', session.accountId, projectId, requirementId, connection.data?.version], queryFn: () => jira.requirementProgress(projectId, requirementId), enabled: manage, retry: false, refetchOnWindowFocus: false });
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const lock = useSynchronousPendingLock(pending), enabled = !!connection.data?.verifiedAt && connection.data.available && !!settings.data?.settings.enabled;
  async function read() { setPending(true); setError(''); try { await jira.refreshProgress(projectId, { requirementId }); refresh(); } catch (e) { setError(jiraFeedback(e)); } finally { setPending(false); } }
  if (!manage) return link.data?.url ? <section className="jira-requirement-section"><header><h3>Jira</h3><a href={link.data.url} target="_blank" rel="noreferrer">{link.data.key} <ExternalLink size={13} /></a></header></section> : null;
  return <section className="jira-requirement-section"><header><h3>Jira</h3><Button variant="secondary" iconOnly aria-label="刷新此需求 Jira 状态" title="刷新 Jira 状态" disabled={!enabled || pending} busy={pending} onClick={() => lock.run(() => void read())}><RefreshCw size={15} /></Button></header>
    <FormError>{error || jiraFeedback(query.error)}</FormError>
    {query.data && <div className="jira-requirement-content"><div className="jira-cell-stack">{query.data.binding && <a href={query.data.binding.url} target="_blank" rel="noreferrer">{query.data.binding.key}<ExternalLink size={13} /></a>}<JiraReadStatus row={query.data} /></div><JiraRequirementControls projectId={projectId} row={query.data} enabled={enabled} disabled={pending} /></div>}
    {!enabled && <p className="text-muted">{connection.data?.setupIssue ? jiraSetupMessages[connection.data.setupIssue] : settings.data?.settings.enabled === false ? '项目 Jira 集成已停用' : '尚未验证个人 Jira 连接'} <Link to="/settings">个人设置</Link></p>}
  </section>;
}
