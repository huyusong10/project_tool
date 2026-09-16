import { Button } from './Button';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, InvalidResponseError, isWriteOutcomeUnknown, jsonBody } from '../api';
import { useSession } from '../app-context';
import { canManageProject } from '../permissions';
import { invalidateRequirementViews } from '../query-keys';
import type { Requirement } from '../types';
import { todayIso } from '../../shared/domain';
import { Modal } from './Modal';

type SubmissionDraft = { version: number; actualDate: string; content: string; pending: boolean };
export function TestSubmissionButton({ requirement: r }: { requirement: Requirement }) {
  const { session } = useSession(), client = useQueryClient();
  const account = session.accountId || session.username || 'guest', key = 'pm-test-submission:' + account + ':' + r.id;
  const [draft, setDraft] = useState<SubmissionDraft | null>(null), [open, setOpen] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const alive = useRef(true), lock = useRef(false);
  useEffect(() => { alive.current = true; setOpen(false); setError(''); setDraft(null); try { const value = JSON.parse(sessionStorage.getItem(key) || 'null'); if (value && typeof value.version === 'number' && typeof value.actualDate === 'string' && typeof value.content === 'string') setDraft(value); } catch { /* Invalid local draft is ignored. */ } return () => { alive.current = false; }; }, [key]);
  const store = (value: SubmissionDraft | null) => { setDraft(value); try { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); } catch { /* The open form retains its input. */ } };
  if ((!canManageProject(session, r.projectId) && session.personId !== r.ownerId) || r.deletedAt) return null;
  const hasSubmission = r.milestones?.some(m => m.milestoneKind === 'test_submitted' && m.achievedAt && !m.cancelled && (!r.stageResetAt || (m.achievedRecordedAt || m.achievedAt) > r.stageResetAt));
  if (!draft?.pending && (r.status !== 'in_progress' || hasSubmission)) return null;
  const done = () => { store(null); invalidateRequirementViews(client, r.id); setOpen(false); };
  const save = async () => {
    if (!draft || lock.current || draft.pending) return;
    lock.current = true; setBusy(true); setError(''); store({ ...draft, pending: true });
    try {
      const result = await api<Requirement>('/api/projects/' + r.projectId + '/requirements/' + r.id + '/test-submission', { method: 'POST', body: jsonBody({ expectedVersion: draft.version, actualDate: draft.actualDate, content: draft.content }) });
      if (!result || result.id !== r.id || result.version <= draft.version || !result.milestones?.some(m => m.milestoneKind === 'test_submitted' && m.achievedAt === draft.actualDate)) throw new InvalidResponseError(200, true, '提测记录返回不完整');
      if (alive.current) done();
    } catch (e) {
      if (alive.current) { setError((e as Error).message); if (!(isWriteOutcomeUnknown(e) || e instanceof ApiError && (e.status === 409 || e.status >= 500))) store({ ...draft, pending: false }); }
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  const read = async () => {
    if (!draft || busy) return; setBusy(true);
    try {
      const latest = await api<Requirement>('/api/requirements/' + r.id);
      if (!latest || latest.id !== r.id || !Number.isInteger(latest.version)) throw new InvalidResponseError(200, false, '需求返回不完整');
      if (!alive.current) return;
      if (latest.milestones?.some(m => m.milestoneKind === 'test_submitted' && m.achievedAt === draft.actualDate && (!latest.stageResetAt || (m.achievedRecordedAt || m.achievedAt) > latest.stageResetAt))) { done(); return; }
      if (latest.status !== 'in_progress' || latest.stageResetAt !== r.stageResetAt) { setError('需求状态已变化，请关闭后核对；填写内容已保留。'); return; }
      store({ ...draft, version: latest.version, pending: false }); setError('已核对当前记录，请确认日期和说明后保存。'); invalidateRequirementViews(client, r.id);
    } catch (e) { if (alive.current) setError((e as Error).message); } finally { if (alive.current) setBusy(false); }
  };
  return <><Button variant="secondary" size="compact" aria-label={draft?.pending ? '核对提测记录' : '记录提测'} title="记录提测" className="ghost-button" onClick={() => { if (!draft) store({ version: r.version, actualDate: todayIso(), content: '', pending: false }); setOpen(true); }}>{draft?.pending ? '核对' : '提测'}</Button>{open && draft && <Modal title="记录提测" closable={!busy} onClose={() => setOpen(false)}><form className="feature-form" onSubmit={e => { e.preventDefault(); void save(); }}><p>记录实际提测事实。测试进度由测试工作项计算。</p><fieldset disabled={busy || draft.pending}><label className="field"><span>实际提测日期</span><input type="date" required max={todayIso()} value={draft.actualDate} onChange={e => store({ ...draft, actualDate: e.target.value })} /></label><label className="field"><span>说明</span><textarea rows={3} maxLength={2000} value={draft.content} onChange={e => store({ ...draft, content: e.target.value })} /></label></fieldset>{error && <p className="warning-banner" role="alert">{error}</p>}{draft.pending && <Button variant="secondary" type="button" className="ghost-button" disabled={busy} onClick={() => void read()}>读取最新记录并核对</Button>}<div className="form-actions"><Button variant="secondary" type="button" className="ghost-button" disabled={busy} onClick={() => setOpen(false)}>关闭</Button><Button variant="primary" type="submit" className="primary-button" disabled={busy || draft.pending}>保存提测记录</Button></div></form></Modal>}</>;
}
