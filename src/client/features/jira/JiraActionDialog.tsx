import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ExternalLink, RefreshCw } from 'lucide-react';
import { Button } from '../../components/Button';
import { Modal, useSynchronousPendingLock } from '../../components/Modal';
import { Select } from '../../components/Select';
import { FormError, FormField } from '../../components/Form';
import { LoadingState } from '../../components/Feedback';
import { useSession } from '../../app-context';
import type { JiraAction } from '../../../shared/jira';
import { jiraFeedback } from './feedback';
import * as jira from './api';

export function JiraActionDialog({ projectId, requirementId, initial, onClose, onChanged }: { projectId: string; requirementId?: string; initial?: JiraAction; onClose: () => void; onChanged: () => void }) {
  const { session } = useSession(), [selected, setSelected] = useState(''), [reason, setReason] = useState('');
  const [preview, setPreview] = useState<JiraAction | null>(initial || null), [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState('');
  const revision = useRef(0), lock = useSynchronousPendingLock(pending);
  const options = useQuery({ queryKey: ['jira-action-options', session.accountId, projectId, requirementId], queryFn: () => jira.transitionOptions(projectId, requirementId!), enabled: !!requirementId && !initial, retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false });
  const choice = options.data?.transitions.find(t => t.id === selected);
  useEffect(() => {
    if (initial) return;
    const request = ++revision.current;
    if (!selected || !options.data || choice?.requiredFields.length) return;
    const data = options.data;
    let alive = true;
    const timer = window.setTimeout(() => { void jira.previewAction(projectId, { requirementId: data.requirementId, transitionId: selected, bindingVersion: data.bindingVersion, credentialVersion: data.credentialVersion, remoteUpdated: data.issue.updated, fromId: data.issue.status.id, reason }).then(result => {
      if (alive && revision.current === request) setPreview(result);
    }).catch(e => { if (alive && revision.current === request) setError(jiraFeedback(e)); }); }, 250);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [projectId, selected, reason, options.data, choice?.requiredFields.length, initial]);
  async function perform(action: 'execute' | 'read' | 'recheck' | 'acknowledge') {
    if (!preview) return;
    setPending(true); setError('');
    try {
      if (action === 'execute') setUncertain(true);
      const next = action === 'execute' ? await jira.executeAction(projectId, preview.id) : action === 'read' ? await jira.readAction(projectId, preview.id) : await jira.recheckAction(projectId, preview.id, action === 'acknowledge');
      setPreview(next); setUncertain(false); onChanged();
    } catch (e) { setError(jiraFeedback(e)); } finally { setPending(false); }
  }
  const finished = !!preview && (preview.state !== 'preview' || !!initial), disabled = lock.busy || uncertain;
  return <Modal title={finished ? 'Jira 操作结果' : '修改 Jira 状态'} width={620} onClose={onClose} closable={!pending}>
    <div className="jira-action-content jira-transition-content">
      {!finished && <>
        {options.isFetching && <LoadingState label="正在读取 Jira 可用操作" />}
        <FormError>{jiraFeedback(options.error)}</FormError>
        {options.error && <Button variant="secondary" onClick={() => { setSelected(''); setPreview(null); void options.refetch(); }}><RefreshCw size={15} />重新读取</Button>}
        {options.data && <>
          <div className="jira-action-heading"><a href={options.data.issue.url} target="_blank" rel="noreferrer">{options.data.issue.key}<ExternalLink size={13} /></a><strong>{options.data.issue.title}</strong><span className="status-pill">{options.data.issue.status.name}</span><Button variant="secondary" iconOnly aria-label="重新读取可用操作" title="重新读取可用操作" disabled={disabled || options.isFetching} onClick={() => { setSelected(''); setPreview(null); setError(''); void options.refetch(); }}><RefreshCw size={15} /></Button></div>
          <FormField label="Jira 操作"><Select aria-label="Jira 操作" value={selected} disabled={disabled || options.isFetching} onChange={e => { setSelected(e.target.value); setPreview(null); setError(''); }}><option value="">选择操作</option>{options.data.transitions.map(t => <option key={t.id} value={t.id}>{t.name} → {t.to.name}</option>)}</Select></FormField>
          {!options.data.transitions.length && <p className="text-muted">当前账号没有可执行的操作，可在 Jira 查看权限和流程。</p>}
          {!!choice?.requiredFields.length && <p className="warning-banner">请在 Jira 补充：{choice.requiredFields.join('、')}。<a href={options.data.issue.url} target="_blank" rel="noreferrer">打开 Jira</a></p>}
          <FormField label="备注（选填）"><input aria-label="备注（选填）" value={reason} maxLength={2000} disabled={disabled} onChange={e => { setReason(e.target.value); setPreview(null); setError(''); }} /></FormField>
          {preview && <div className="jira-state-change"><span>{preview.items[0].from.name}</span><ArrowRight size={16} /><strong>{preview.items[0].target.name}</strong></div>}
        </>}
      </>}
      {finished && preview.items.map(item => <section key={item.requirementId} className="jira-operation-result"><strong>{item.key} · {item.title}</strong><div className="jira-state-change"><span>{item.from.name}</span><ArrowRight size={16} /><span>{item.target.name}</span></div><span className="status-pill">{{ ready: '待确认', running: '执行中', success: '已完成', failed: '未完成', unknown: '待核对', checked: '已人工核对', partial: '部分完成' }[item.outcome]}</span><p role="status">{item.message}</p>{item.observed && <p>当前读取：{item.observed.status.name} · {new Date(item.observed.checkedAt).toLocaleString('zh-CN', { hour12: false })}</p>}</section>)}
      <FormError>{error}</FormError>
      {uncertain && <p className="warning-banner">提交结果尚未确认，请先读取本次操作结果，不要重复提交。</p>}
      <div className="form-actions"><Button variant="secondary" disabled={pending} onClick={onClose}>关闭</Button>
        {(finished || uncertain) && <Button variant="secondary" disabled={pending} onClick={() => lock.run(() => void perform('read'))}><RefreshCw size={15} />读取结果</Button>}
        {preview?.items.some(i => i.outcome === 'unknown') && <><Button variant="secondary" disabled={pending} onClick={() => lock.run(() => void perform('recheck'))}>核对当前状态</Button><Button variant="secondary" disabled={pending || preview.items.some(i => i.outcome === 'unknown' && !i.observed)} onClick={() => lock.run(() => void perform('acknowledge'))}>已核对，结束本次操作</Button></>}
        {!finished && <Button variant="primary" disabled={disabled || !preview || !!error || !!options.error || options.isFetching} busy={pending} onClick={() => lock.run(() => void perform('execute'))}>确认修改 Jira</Button>}
      </div>
    </div>
  </Modal>;
}
