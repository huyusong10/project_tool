import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, History, RefreshCw, Save, Send, Square, Trash2 } from 'lucide-react';
import type { JiraPr, PrEdit, PrItem, PrPreview, PrStep, PrTargetPlan } from '../../../shared/jira-pr';
import { Button, ButtonLink } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import { FormError } from '../../components/Form';
import { Modal } from '../../components/Modal';
import { useSession } from '../../app-context';
import { JiraPrCreate } from './JiraPrCreate';
import { JiraPrAddRequirement } from './JiraPrAddRequirement';
import { JiraManualSyncDialog } from './JiraManualSyncDialog';
import { JiraViewTabs } from './JiraViewTabs';
import { JiraPrChangeList, prItemAttention } from './JiraPrChangeList';
import { jiraFeedback } from './feedback';
import * as api from './pr-api';
import * as jira from './api';

const done = (s: PrStep) => s.comment.state === 'success' && (s.kind === 'comment' || s.transition.state === 'success');
function storedInput(key: string): PrEdit | null { try { const value = JSON.parse(sessionStorage.getItem(key) || 'null'); return value && Number.isInteger(value.version) && Array.isArray(value.items) ? value : null; } catch { return null; } }
export function JiraPrEditor({ initial }: { initial: JiraPr }) {
  const { session } = useSession(), client = useQueryClient();
  const storageKey = `jira-pr-input:${session.accountId}:${initial.projectId}:${initial.id}`;
  const [recovered, setRecovered] = useState(() => storedInput(storageKey)), [conflict, setConflict] = useState<JiraPr | null>(null);
  const [draft, setDraft] = useState(initial), [selected, setSelected] = useState('');
  const [targetPlan, setTargetPlan] = useState<{ targetId: string | null; regenerate: boolean; plan: PrTargetPlan } | null>(null);
  const [addOpen, setAddOpen] = useState(false), [manualIds, setManualIds] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false), [saving, setSaving] = useState(false), [dirty, setDirty] = useState(false), [error, setError] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [generationOpen, setGenerationOpen] = useState(false);
  const [preview, setPreview] = useState<PrPreview | null>(null), [updateOpen, setUpdateOpen] = useState(false), [closeOpen, setCloseOpen] = useState(false);
  const [replacement, setReplacement] = useState<{ stepId: string; body: string } | null>(null), [checking, setChecking] = useState<{ stepId: string; part: 'comment' | 'transition'; resolution: 'applied' | 'not_applied' } | null>(null), [acknowledged, setAcknowledged] = useState(false);
  const current = useRef(draft), revision = useRef(0), savedRevision = useRef(0), saveTask = useRef<Promise<JiraPr> | null>(null), mounted = useRef(true), working = useRef(false);
  const locked = busy || draft.state !== 'active' || draft.items.some(i => i.steps.some(s => s.comment.state === 'unknown' || s.transition.state === 'unknown'));
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function retain(next: JiraPr | null) { try { if (next) sessionStorage.setItem(storageKey, JSON.stringify(api.editPayload(next))); else sessionStorage.removeItem(storageKey); } catch { /* Server autosave remains available without browser storage. */ } }
  function accept(next: JiraPr) { current.current = next; setDraft(next); revision.current++; savedRevision.current = revision.current; setDirty(false); setPreview(null); retain(null); setRecovered(null); client.setQueryData(['jira-pr', next.projectId, next.id], next); void client.invalidateQueries({ queryKey: ['jira-prs', draft.projectId] }); }
  function change(next: JiraPr) { current.current = next; revision.current++; setDraft(next); setDirty(true); setPreview(null); retain(next); }
  async function saveDraft(): Promise<JiraPr> {
    if (saveTask.current) { await saveTask.current; return saveDraft(); }
    if (savedRevision.current === revision.current) return current.current;
    const snapshot = current.current, stamp = revision.current;
    setSaving(true);
    const promise = api.save(snapshot.projectId, snapshot.id, api.editPayload(snapshot)); saveTask.current = promise;
    try {
      const result = await promise;
      const next = revision.current === stamp ? result : { ...current.current, version: result.version, updatedAt: result.updatedAt };
      current.current = next; savedRevision.current = stamp;
      client.setQueryData(['jira-pr', result.projectId, result.id], result);
      retain(revision.current === stamp ? null : next);
      if (mounted.current) { setDraft(next); setDirty(revision.current !== stamp); setError(''); }
      return next;
    } finally { saveTask.current = null; if (mounted.current) setSaving(false); }
  }
  useEffect(() => {
    if (!dirty || busy || saving || error || conflict || recovered) return;
    const timer = window.setTimeout(() => { void saveDraft().catch(e => setError(jiraFeedback(e))); }, 700);
    return () => window.clearTimeout(timer);
  });
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (savedRevision.current !== revision.current) e.preventDefault(); };
    window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler);
  }, []);
  async function run(work: (pr: JiraPr) => Promise<void>, save = true) {
    if (working.current) return; working.current = true; setBusy(true); setError('');
    try { const pr = save ? await saveDraft() : current.current; await work(pr); }
    catch (e) { setError(jiraFeedback(e)); } finally { working.current = false; if (mounted.current) setBusy(false); }
  }
  useEffect(() => {
    if (initial.version <= current.current.version || busy || saving) return;
    if (revision.current !== savedRevision.current) {
      setConflict(initial); setError('服务端草稿已更新，请比较后保留需要的内容');
    } else {
      current.current = initial; setDraft(initial); setPreview(null); setTargetPlan(null);
    }
  }, [initial, busy, saving]);
  useEffect(() => {
    if (draft.state !== 'running' && !publishing) return;
    const timer = window.setInterval(() => { if (savedRevision.current === revision.current) void api.read(draft.projectId, draft.id).then(next => { if (mounted.current && savedRevision.current === revision.current && next.version >= current.current.version) { current.current = next; setDraft(next); } }).catch(() => {}); }, 1500);
    return () => window.clearInterval(timer);
  }, [draft.id, draft.projectId, draft.state, publishing]);
  const item = draft.items.find(i => i.requirementId === selected);
  const connection = useQuery({ queryKey: ['jira-connection', session.accountId], queryFn: jira.connection, retry: false, refetchOnWindowFocus: false });
  const connectionReady = connection.isSuccess && !connection.isFetching;
  const remoteKey = ['jira-pr-remote', session.accountId, draft.projectId, draft.id, item?.requirementId, item?.bindingVersion, connection.data?.version, connection.data?.baseUrl];
  const progress = useQuery({ queryKey: ['jira-progress', session.accountId, draft.projectId, connection.data?.version, connection.data?.baseUrl], queryFn: () => jira.progress(draft.projectId), enabled: connectionReady, retry: false, refetchOnWindowFocus: false });
  const remote = useQuery({ queryKey: remoteKey, queryFn: () => api.remote(draft.projectId, item!.requirementId), enabled: !!item && connectionReady && !!connection.data?.verifiedAt, retry: false, refetchOnWindowFocus: false, gcTime: 0 });
  const bindingChanged = !!item && !!remote.data && (remote.data.site !== item.site || remote.data.bindingVersion !== item.bindingVersion || remote.data.issue.id !== item.issueId);
  const [remoteComments, setRemoteComments] = useState<Awaited<ReturnType<typeof api.comments>> | null>(null);
  function updateItem(value: PrItem) { change({ ...current.current, items: current.current.items.map(i => i.requirementId === value.requirementId ? value : i) }); }
  function updateStep(stepId: string, patch: Partial<PrStep>) { if (item) updateItem({ ...item, steps: item.steps.map(s => s.id === stepId ? { ...s, ...patch } : s) }); }
  function applyTarget(plan: PrTargetPlan) {
    if (!plan.steps) return;
    if (current.current.version !== plan.version) { setTargetPlan(null); setError('草稿已变化，请重新选择最终状态'); return; }
    const originalItem = current.current.items.find(i => i.requirementId === plan.requirementId);
    if (!originalItem) return;
    change({ ...current.current, items: current.current.items.map(i => i.requirementId === plan.requirementId ? { ...i, steps: plan.steps!, decisionRequired: false, reviewRequired: i.reviewRequired || plan.retainedComments > 0 } : i) });
    setTargetPlan(null);
  }
  function planTarget(targetId: string | null, regenerate = false, routeIds?: string[]) {
    if (!item) return;
    void run(async pr => {
      const plan = await api.planTarget(pr, item.requirementId, targetId, routeIds, regenerate);
      client.setQueryData(remoteKey, plan.remote);
      void client.invalidateQueries({ queryKey: ['jira-progress'] });
      if (!plan.steps || plan.retainedComments || regenerate) setTargetPlan({ targetId, regenerate, plan });
      else applyTarget(plan);
    });
  }
  const complete = draft.items.flatMap(i => i.steps).filter(done).length, count = draft.items.flatMap(i => i.steps).length;
  async function refreshResult() { accept(await api.read(draft.projectId, draft.id)); if (item) await remote.refetch(); void client.invalidateQueries({ queryKey: ['jira-progress'] }); }
  return <>
    <PageHeader title="Jira PR" actions={<><Button variant="primary" disabled={locked || saving || !count || !!recovered || !!conflict} busy={publishing} onClick={() => void run(async pr => setPreview(await api.prepare(pr.projectId, pr.id, pr.version)))}><Send size={16} />推送到 Jira</Button>{(publishing || draft.state === 'running') && <Button onClick={() => void api.stop(draft.projectId, draft.id).catch(e => setError(jiraFeedback(e)))}><Square size={15} />停止后续推送</Button>}</>}
      secondaryActions={<><Button disabled={locked || !!draft.startedAt || saving} onClick={() => void run(async () => setUpdateOpen(true))}><RefreshCw size={15} />更新草稿</Button></>}
      moreActions={<><Button variant="menu" disabled={locked || saving || !dirty} onClick={() => void run(async () => {})}><Save size={15} />保存草稿</Button><Button variant="menu" disabled={busy || saving || dirty} onClick={() => void run(refreshResult, false)}><RefreshCw size={15} />读取最新结果</Button><Button variant="menu" disabled={locked || saving} onClick={() => setCloseOpen(true)}><Trash2 size={15} />结束 PR，放弃剩余操作</Button></>} />
    <div className="page-content jira-pr-page">
      <JiraViewTabs projectId={draft.projectId} value="prs" disabled={busy || saving || dirty} />
      <div className="jira-pr-summary jira-pr-workspace-summary"><span className="status-pill">{{ active: '草稿 / 待继续', running: '推送中', completed: '已完成', abandoned: '已结束' }[draft.state]}</span><span>{draft.items.length} 个需求 · {count} 条评论</span><strong className={draft.items.some(prItemAttention) ? 'text-danger' : ''}>{draft.items.filter(prItemAttention).length} 项待处理</strong>{complete > 0 && <span>{complete} 项已推送</span>}<span className="jira-pr-save-state" role="status">{saving ? '正在保存' : dirty ? '尚未保存' : '已保存'}</span><ButtonLink to={'/jira/prs?view=history&projectId=' + draft.projectId} variant="link"><History size={15} />历史与同步记录</ButtonLink></div>
      <FormError>{error}</FormError>
      {recovered && <div className="warning-banner">此浏览器保留了尚未保存的输入。<Button variant="link" disabled={locked} onClick={() => {
        const next = { ...draft, version: recovered.version, items: recovered.items.flatMap(edit => { const old = draft.items.find(i => i.requirementId === edit.requirementId); return old ? [{ ...old, ...edit, steps: edit.steps.map(s => ({ ...s, comment: old.steps.find(before => before.id === s.id)?.comment || { state: 'pending' as const }, transition: old.steps.find(before => before.id === s.id)?.transition || { state: 'pending' as const } })) }] : []; }) };
        if (recovered.version !== draft.version) { setConflict(draft); setError('服务端草稿已更新，请比较后选择要保留的内容'); }
        change(next); setRecovered(null);
      }}>恢复未保存输入</Button><Button variant="link" onClick={() => { retain(null); setRecovered(null); }}>丢弃浏览器中的输入</Button></div>}
      {error && <div className="jira-pr-summary"><Button disabled={busy || saving || !dirty} onClick={() => void run(async () => {}, true)}><Save size={15} />重试保存当前输入</Button><Button disabled={busy || saving} onClick={() => void run(async () => { const latest = await api.read(draft.projectId, draft.id); if (dirty) setConflict(latest); else accept(latest); }, false)}><RefreshCw size={15} />读取并比较服务端草稿</Button></div>}
      <JiraPrChangeList draft={draft} selected={selected} onSelect={id => { setSelected(id); setRemoteComments(null); }} onChange={updateItem}
        busy={busy} locked={locked} remote={connectionReady ? remote.data : undefined} fetching={connection.isFetching || remote.isFetching} remoteError={jiraFeedback(remote.error)} bindingChanged={bindingChanged} rows={connectionReady ? progress.data?.rows || [] : []}
        loadingProgress={connection.isPending || connection.isFetching || progress.isLoading} progressError={jiraFeedback(connection.error) || jiraFeedback(progress.error)}
        onTarget={planTarget} onRefresh={() => { void remote.refetch().then(() => client.invalidateQueries({ queryKey: ['jira-progress'] })); }}
        onAddRequirement={() => void run(async () => setAddOpen(true))}
        onRemove={() => { if (item) change({ ...current.current, items: current.current.items.filter(i => i.requirementId !== item.requirementId) }); }}
        onManual={() => { if (item) void run(async () => setManualIds(item.sources.filter(s => s.jiraSyncState !== 'synced').map(s => s.id))); }}
        onComments={() => { if (item) void run(async () => setRemoteComments(await api.comments(draft.projectId, item.requirementId))); }}
        onRegenerate={step => { if (item) void run(async pr => { const result = await api.regenerate(pr.projectId, pr.id, item.requirementId, step.sourceIds, step.target); setReplacement({ stepId: step.id, body: result.body }); }); }}
        onRecheck={(step, part, resolution) => { if (resolution) { setChecking({ stepId: step.id, part, resolution }); setAcknowledged(false); } else if (item) void run(async pr => accept(await api.recheck(pr.projectId, pr.id, item.requirementId, step.id, part)), false); }}
        remoteComments={remoteComments && item && <details open><summary>Jira 评论（{remoteComments.total}）</summary>{remoteComments.comments.map(c => <section className="jira-pr-remote-comment" key={c.id}><small>{c.author?.displayName} · {new Date(c.created).toLocaleString('zh-CN')}</small><pre className="jira-pr-body-preview">{c.body}</pre></section>)}{remoteComments.nextStartAt !== null && <Button disabled={busy} onClick={() => void run(async () => { const next = await api.comments(draft.projectId, item.requirementId, remoteComments.nextStartAt!); setRemoteComments({ ...next, comments: [...remoteComments.comments, ...next.comments] }); })}>加载后续评论</Button>}</details>} />
      <footer className="jira-progress-summary"><span>个人连接：{connection.isPending || connection.isFetching ? '正在读取…' : connection.error ? '读取失败' : connection.data?.identity || '未验证'}</span><ButtonLink variant="link" to="/settings">个人设置</ButtonLink><span>收集截止：{new Date(draft.collectedAt).toLocaleString('zh-CN')}</span>{!!draft.warnings.length && <Button variant="link" onClick={() => setGenerationOpen(true)}><FileText size={14} />查看生成记录</Button>}</footer>
      {(connection.error || progress.error) && <div className="jira-pr-summary"><FormError>{jiraFeedback(connection.error) || jiraFeedback(progress.error)}</FormError><Button disabled={connection.isFetching || progress.isFetching} onClick={() => { if (connection.error) void connection.refetch(); else void progress.refetch(); }}><RefreshCw size={15} />重新读取连接与状态</Button></div>}
    </div>
    {generationOpen && <Modal title="生成记录" width={720} onClose={() => setGenerationOpen(false)}><p>生成时间：{new Date(draft.collectedAt).toLocaleString('zh-CN')}</p><p>以下为生成时未纳入或需要检查的内容；当前处理情况以需求列表为准。</p><ul className="jira-pr-generation-notes">{draft.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></Modal>}
    {updateOpen && <JiraPrCreate projectId={draft.projectId} current={draft} onClose={() => setUpdateOpen(false)} onCreated={next => { accept(next); setUpdateOpen(false); }} />}
    {addOpen && <JiraPrAddRequirement pr={draft} onClose={() => setAddOpen(false)} onAdded={(next, id) => { accept(next); setSelected(id); setAddOpen(false); }} />}
    {manualIds && <JiraManualSyncDialog projectId={draft.projectId} ids={manualIds} onClose={() => setManualIds(null)} onDone={() => { setManualIds(null); void run(refreshResult, false); }} />}
    {preview && <Modal title="确认推送到 Jira" width={860} layout="workspace" onClose={() => setPreview(null)} closable={!busy}><div className="jira-pr-create"><div className="jira-pr-create-body"><p>Jira 身份：{preview.identity}</p>{preview.items.map(i => <section key={i.requirementId}><h3>{i.issue.key} · 当前 {i.issue.status.name}</h3>{i.steps.filter(s => !done(s)).map((s, n) => <section className="jira-pr-step" key={s.id}><strong>{n + 1}. {s.kind === 'transition' ? `${s.transitionName || '执行时验证'} → ${s.target?.name}` : '发布评论'}</strong>{s.comment.state === 'success' ? <p>评论已经发布，本次不重复发送。</p> : <pre className="jira-pr-body-preview">{s.body.trim() + '\n\n[PM-PR:' + draft.id + ':' + s.id + ']'}</pre>}</section>)}</section>)}</div><footer className="jira-pr-dialog-footer"><FormError>{error}</FormError><div className="form-actions"><Button disabled={busy} onClick={() => setPreview(null)}>返回修改</Button>{publishing && <Button onClick={() => void api.stop(draft.projectId, draft.id).catch(e => setError(jiraFeedback(e)))}><Square size={15} />停止后续推送</Button>}<Button variant="primary" busy={busy} onClick={() => void run(async pr => { setPublishing(true); try { const next = await api.execute(pr.projectId, pr.id, preview.id); accept(next); setPreview(null); if (item) await remote.refetch(); void client.invalidateQueries({ queryKey: ['jira-progress'] }); } finally { setPublishing(false); } }, false)}><Send size={16} />确认推送到 Jira</Button></div></footer></div></Modal>}
    {targetPlan && <Modal title={targetPlan.regenerate ? '重新生成本项评论' : targetPlan.plan.steps ? '确认目标变更' : '选择流转路径'} width={860} layout="workspace" onClose={() => setTargetPlan(null)} closable={!busy}>
      <div className="jira-pr-create"><div className="jira-pr-create-body">
        <p>{targetPlan.plan.remote.issue.key} · 当前 {targetPlan.plan.remote.issue.status.name}</p>
        {!targetPlan.plan.steps ? <div className="jira-pr-route-options">{targetPlan.plan.routes.map((route, index) => <Button key={index} wrap width="block" disabled={busy} onClick={() => planTarget(targetPlan.targetId, targetPlan.regenerate, route.map(e => e.id))}><span>{targetPlan.plan.remote.issue.status.name}{route.map(e => ' → ' + e.to.name).join('')}<small>{route.map(e => e.name).join(' → ')}</small></span></Button>)}</div> : <>
          {targetPlan.regenerate && <p className="warning-banner">确认后替换本项尚未发布的评论。已发布内容不变。</p>}
          {!!targetPlan.plan.retainedComments && <p className="warning-banner">{targetPlan.plan.retainedComments} 条原评论已保留为独立评论。请检查其中不再适用的状态描述。</p>}
          <details><summary>修改前的评论</summary>{item?.steps.map(s => <pre key={s.id} className="jira-pr-body-preview">{s.body}</pre>)}</details>
          {targetPlan.plan.steps.map((s, index) => <section className="jira-pr-step" key={s.id}><h3>{index + 1}. {s.kind === 'transition' ? '转入' + s.target?.name + '时的评论' : '进展评论'}{s.comment.state === 'success' ? '（已发布，不变）' : ''}</h3><pre className="jira-pr-body-preview">{s.body}</pre></section>)}
        </>}
        <FormError>{error}</FormError>
      </div><footer className="jira-pr-dialog-footer"><div className="form-actions"><Button disabled={busy} onClick={() => setTargetPlan(null)}>取消</Button>{targetPlan.plan.steps && <Button variant="primary" disabled={busy} onClick={() => applyTarget(targetPlan.plan)}>{targetPlan.regenerate ? '确认替换未发布评论' : '保留评论并应用目标'}</Button>}</div></footer></div>
    </Modal>}
    {replacement && <Modal title="重新生成评论预览" width={800} layout="workspace" onClose={() => setReplacement(null)}><div className="jira-pr-create"><div className="jira-pr-create-body"><pre className="jira-pr-body-preview">{replacement.body}</pre></div><footer className="jira-pr-dialog-footer"><div className="form-actions"><Button onClick={() => setReplacement(null)}>保留原文</Button><Button variant="primary" onClick={() => { updateStep(replacement.stepId, { body: replacement.body, generatedBody: replacement.body }); setReplacement(null); }}>替换当前评论</Button></div></footer></div></Modal>}
    {closeOpen && <Modal title="结束 PR" onClose={() => setCloseOpen(false)} closable={!busy}><p>已发布内容保留，未发布的进展将回到待同步。不会撤销 Jira 中已经完成的操作。</p><FormError>{error}</FormError><div className="form-actions"><Button disabled={busy} onClick={() => setCloseOpen(false)}>取消</Button><Button tone="danger" busy={busy} onClick={() => void run(async pr => { accept(await api.close(pr.projectId, pr.id, pr.version)); setCloseOpen(false); })}>确认结束 PR</Button></div></Modal>}
    {checking && item && <Modal title="确认人工核对结果" onClose={() => setChecking(null)} closable={!busy}><p>{checking.resolution === 'applied' ? '确认本次流转已经成功。' : '请确认已在 Jira 检查原操作。结束核对后，重新推送仍需要新的预览确认。'}</p><label className="jira-check"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />我已在 Jira 核对本次操作</label><FormError>{error}</FormError><div className="form-actions"><Button onClick={() => setChecking(null)} disabled={busy}>取消</Button><Button variant="primary" disabled={!acknowledged} busy={busy} onClick={() => void run(async pr => { accept(await api.recheck(pr.projectId, pr.id, item.requirementId, checking.stepId, checking.part, checking.resolution)); setChecking(null); }, false)}>确认核对结果</Button></div></Modal>}
    {conflict && <Modal title="草稿版本对比" width={900} layout="workspace" onClose={() => { setConflict(null); setError('本地输入尚未保存，请比较版本后再保存'); }}><div className="jira-pr-create"><div className="jira-pr-create-body"><h3>服务端内容</h3>{conflict.items.map(i => <section key={i.requirementId}><strong>{i.key} · {i.title}</strong>{i.steps.map(s => <pre className="jira-pr-body-preview" key={s.id}>{(s.target ? '目标：' + s.target.name + '\n' : '') + s.body}</pre>)}</section>)}<h3>当前本地输入</h3>{draft.items.map(i => <section key={i.requirementId}><strong>{i.key} · {i.title}</strong>{i.steps.map(s => <pre className="jira-pr-body-preview" key={s.id}>{(s.target ? '目标：' + s.target.name + '\n' : '') + s.body}</pre>)}</section>)}</div><footer className="jira-pr-dialog-footer"><div className="form-actions"><Button onClick={() => { accept(conflict); setConflict(null); setError(''); }}>采用服务端内容</Button><Button variant="primary" disabled={conflict.state !== 'active' || conflict.items.some(i => i.steps.some(s => s.comment.state === 'unknown' || s.transition.state === 'unknown'))} onClick={() => { change({ ...draft, version: conflict.version }); setConflict(null); setError(''); }}>保留本地内容并保存</Button></div></footer></div></Modal>}
  </>;
}
