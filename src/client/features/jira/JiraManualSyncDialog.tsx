import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { FormError, FormField } from '../../components/Form';
import * as api from './pr-api';
import { jiraFeedback } from './feedback';

export function JiraManualSyncDialog({ projectId, ids, restore = false, onClose, onDone }: { projectId: string; ids: string[]; restore?: boolean; onClose: () => void; onDone: () => void }) {
  const preview = useQuery({ queryKey: ['jira-manual-preview', projectId, ids, restore], queryFn: () => api.manualPreview(projectId, ids, restore), retry: false, refetchOnWindowFocus: false, gcTime: 0 });
  const [reason, setReason] = useState(''), [url, setUrl] = useState(''), [ack, setAck] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function confirm() {
    if (!preview.data) return; setBusy(true); setError('');
    try { await api.manualConfirm(projectId, { ids, version: preview.data.version, restore, reason, url }); onDone(); }
    catch (e) { setError(jiraFeedback(e)); } finally { setBusy(false); }
  }
  return <Modal title={restore ? '撤销人工同步确认' : '标记已在 Jira 同步'} width={720} onClose={onClose} closable={!busy}>
    <p>{restore ? '撤销后，这些进展恢复待同步。不会撤销 Jira 中的内容。' : '仅记录人工确认，不向 Jira 发布内容。这些进展不会再被自动收集。'}</p>
    <details className="jira-pr-manual-sources"><summary>所选进展（{preview.data?.sources.length ?? ids.length}）</summary>{preview.data?.sources.map(s => <p key={s.id}><strong>{s.title} · {s.key}</strong><br />{new Date(s.createdAt).toLocaleString('zh-CN')} · {s.content || s.eventType}</p>)}</details>
    {!!preview.data?.affectedPrIds.length && <p className="warning-banner">草稿中对应的来源引用将移除，评论正文保留。推送前需要检查正文，避免重复发布。</p>}
    <FormField label="确认说明"><textarea aria-label="人工同步确认说明" rows={3} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} disabled={busy} /></FormField>
    {!restore && <FormField label="Jira 评论链接（选填）"><input aria-label="Jira 评论链接" type="url" value={url} maxLength={2000} onChange={e => setUrl(e.target.value)} disabled={busy} /></FormField>}
    <label className="jira-check"><input type="checkbox" checked={ack} disabled={busy} onChange={e => setAck(e.target.checked)} />{restore ? '确认将所选进展恢复待同步' : '我已核对 Jira，所选进展已经同步'}</label>
    <FormError>{error || jiraFeedback(preview.error)}</FormError><div className="form-actions"><Button disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" disabled={!preview.data || !!preview.error || !reason.trim() || !ack} busy={busy} onClick={() => void confirm()}><Check size={16} />确认</Button></div>
  </Modal>;
}
