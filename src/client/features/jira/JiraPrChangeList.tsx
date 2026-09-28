import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ExternalLink, History, MessageSquarePlus, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { JiraPr, PrItem, PrReceipt, PrRemote, PrStep } from '../../../shared/jira-pr';
import type { JiraProgressRow } from '../../../shared/jira';
import { AdaptiveDataCell as Cell, AdaptiveDataList, AdaptiveDataRow } from '../../components/AdaptiveDataList';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/Badge';
import { FilterBar } from '../../components/FilterBar';
import { SearchInput } from '../../components/SearchInput';
import { Select } from '../../components/Select';
import { Pagination } from '../../components/Pagination';
import { TopbarMenu } from '../../components/TopbarMenu';
import { FormError } from '../../components/Form';
import { EmptyState } from '../../components/Feedback';
import { useListPagination } from '../../use-list-pagination';
import { randomUUID } from '../../random-uuid';
import { jiraPrColumns } from './JiraPrLoading';

const done = (s: PrStep) => s.comment.state === 'success' && (s.kind === 'comment' || s.transition.state === 'success');
export function prItemAttention(i: PrItem): string {
  if (i.steps.some(s => s.comment.state === 'unknown' || s.transition.state === 'unknown')) return '推送结果待核对';
  if (i.steps.some(s => s.comment.state === 'failed' || s.transition.state === 'failed')) return '推送未完成';
  if (i.decisionRequired) return '待确认目标';
  if (i.reviewRequired) return '待检查评论';
  if (i.steps.some(s => !s.body.trim())) return '待填写评论';
  return '';
}
export const finalTarget = (i: PrItem) => i.steps.filter(s => s.kind === 'transition' && s.transition.state !== 'success').at(-1)?.target || null;

function CommentInput({ value, disabled, index, onChange }: { value: string; disabled: boolean; index: number; onChange: (body: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current; if (!element) return;
    const resize = () => { element.style.height = '0'; element.style.height = Math.max(112, element.scrollHeight + 2) + 'px'; };
    resize();
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => { if (width !== element.clientWidth) { width = element.clientWidth; resize(); } });
    observer.observe(element); return () => observer.disconnect();
  }, [value]);
  return <textarea ref={ref} aria-label={'Jira 评论 ' + index} value={value} disabled={disabled} onChange={e => onChange(e.target.value)} />;
}
function Receipt({ name, receipt }: { name: string; receipt: PrReceipt }) {
  if (receipt.state === 'pending') return null;
  return <div className="jira-pr-receipt" data-state={receipt.state}><span>{name}：{{ running: '执行中', success: '已完成', failed: '未完成', unknown: '待核对' }[receipt.state]}</span>{receipt.message && <span>{receipt.message}</span>}{receipt.identity && <small>{receipt.identity} · {receipt.at && new Date(receipt.at).toLocaleString('zh-CN')}</small>}</div>;
}
type Props = {
  draft: JiraPr; selected: string; onSelect: (id: string) => void; onChange: (item: PrItem) => void;
  busy: boolean; locked: boolean; remote?: PrRemote; fetching: boolean; remoteError: string; bindingChanged: boolean; rows: JiraProgressRow[];
  loadingProgress: boolean; progressError: string;
  onTarget: (targetId: string | null, regenerate?: boolean) => void; onRefresh: () => void; onAddRequirement: () => void;
  onRemove: () => void; onManual: () => void; onComments: () => void; remoteComments: ReactNode;
  onRegenerate: (step: PrStep) => void; onRecheck: (step: PrStep, part: 'comment' | 'transition', resolution?: 'applied' | 'not_applied') => void;
};

export function JiraPrChangeList(props: Props) {
  const { draft, selected, onSelect, onChange, busy, locked, remote, fetching, bindingChanged } = props;
  const [search, setSearch] = useState(''), [feature, setFeature] = useState(''), [phase, setPhase] = useState(''), [attention, setAttention] = useState('');
  const features = [...new Set(draft.items.map(i => i.featureName || '未归属 Feature'))];
  const phases = [...new Set(draft.items.filter(i => (i.featureName || '未归属 Feature') === feature).map(i => i.phaseName || '未归属 Phase'))];
  const filtered = draft.items.filter(i => (!feature || (i.featureName || '未归属 Feature') === feature) && (!phase || (i.phaseName || '未归属 Phase') === phase)
    && (!attention || prItemAttention(i)) && `${i.title} ${i.key} ${i.featureName} ${i.phaseName}`.toLowerCase().includes(search.trim().toLowerCase()));
  const pages = useListPagination({ items: filtered, id: 'prItems', filterKey: JSON.stringify([search, feature, phase, attention]), disabled: busy });
  const previousSelection = useRef(selected);
  useEffect(() => {
    if (!selected || previousSelection.current === selected || busy) return;
    const index = filtered.findIndex(i => i.requirementId === selected);
    if (index < 0 && draft.items.some(i => i.requirementId === selected)) { setSearch(''); setFeature(''); setPhase(''); setAttention(''); return; }
    previousSelection.current = selected;
    if (index >= 0) pages.props.onPageChange(Math.floor(index / pages.props.pageSize) + 1);
  }, [selected, busy, filtered, pages.props, draft.items]);
  function navigate(index: number) {
    const item = filtered[index]; if (!item) return;
    pages.props.onPageChange(Math.floor(index / pages.props.pageSize) + 1); onSelect(item.requirementId);
    requestAnimationFrame(() => document.getElementById('jira-pr-item-' + item.requirementId)?.scrollIntoView({ block: 'start' }));
  }
  return <>
    <FilterBar className="jira-pr-filters" result={`${filtered.length} 个需求`}>
      <SearchInput aria-label="搜索 PR 事项" placeholder="需求、Jira 编号" value={search} onChange={setSearch} />
      <Select aria-label="PR Feature" value={feature} onChange={e => { setFeature(e.target.value); setPhase(''); }}><option value="">全部 Feature</option>{features.map(f => <option key={f}>{f}</option>)}</Select>
      <Select aria-label="PR Phase" disabled={!feature} value={phase} onChange={e => setPhase(e.target.value)}><option value="">全部 Phase</option>{phases.map(p => <option key={p}>{p}</option>)}</Select>
      <Select aria-label="PR 处理情况" value={attention} onChange={e => setAttention(e.target.value)}><option value="">全部需求</option><option value="attention">待处理</option></Select>
      <Button disabled={locked || !!draft.startedAt} onClick={props.onAddRequirement}><Plus size={15} />添加需求与评论</Button>
    </FilterBar>
    <AdaptiveDataList label="PR 变更清单" className="jira-pr-changes paged-panel" bodyRef={pages.scrollRef}
      columns={jiraPrColumns}
      footer={<Pagination {...pages.props} label="PR 事项分页" />} empty={!filtered.length && <EmptyState title={draft.items.length ? '没有符合条件的需求' : '草稿暂无事项'} detail="" />}>
      {pages.items.map(i => {
        const expanded = selected === i.requirementId, position = filtered.indexOf(i), target = finalTarget(i);
        const cached = props.rows.find(r => r.requirementId === i.requirementId);
        const current = expanded && remote ? remote.issue.status : cached?.readState === 'success' ? cached.issue?.status : null;
        const checkedAt = expanded && remote ? remote.checkedAt : cached?.checkedAt;
        const mismatch = expanded && bindingChanged;
        const issue = prItemAttention(i);
        const loadingStatus = !current && (props.loadingProgress || expanded && fetching);
        const readFailed = expanded && !!props.remoteError || !!props.progressError || cached?.readState === 'failed';
        const lockedTarget = locked || mismatch || i.steps.some(s => s.comment.state === 'success' && s.kind === 'transition' && s.transition.state !== 'success');
        const patch = (step: PrStep, value: Partial<PrStep>) => onChange({ ...i, steps: i.steps.map(s => s.id === step.id ? { ...s, ...value } : s) });
        return <Fragment key={i.requirementId}>
          <AdaptiveDataRow className={expanded ? 'is-selected' : ''}>
            <Cell column="item"><div className="jira-pr-change-title" id={'jira-pr-item-' + i.requirementId}>
              <Button variant="link" wrap aria-expanded={expanded} aria-label={'编辑需求 ' + i.title} disabled={busy} onClick={() => onSelect(expanded ? '' : i.requirementId)}>{expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}<strong>{i.title.startsWith(i.key) ? i.title : i.key + ' · ' + i.title}</strong></Button>
              <small>{i.featureName || '未归属 Feature'} / {i.phaseName || '未归属 Phase'}</small>
            </div></Cell>
            <Cell column="local"><div className="jira-pr-local"><StatusBadge kind="requirement" value={i.localStatus || 'not_started'} /><strong>{i.localProgress ?? 0}%</strong></div></Cell>
            <Cell column="remote"><div className="jira-cell-stack"><span>{mismatch ? '关联已变化' : current?.name || (loadingStatus ? '正在读取…' : readFailed ? '读取失败' : '尚未读取')}</span>{checkedAt && !mismatch && <small title={new Date(checkedAt).toLocaleString('zh-CN')}>读取于 {new Date(checkedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</small>}</div></Cell>
            <Cell column="target">{expanded ? <Select aria-label={'本次同步到 ' + i.key} value={i.decisionRequired ? '' : target?.id || '__keep'} disabled={lockedTarget || fetching || !remote} onChange={e => props.onTarget(e.target.value === '__keep' ? null : e.target.value)}>
              <option value="" disabled>选择最终状态</option><option value="__keep">保持状态，仅发评论</option>
              {remote?.statuses.filter(s => s.id !== remote.issue.status.id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              {target && !remote?.statuses.some(s => s.id === target.id && s.id !== remote.issue.status.id) && <option value={target.id} disabled>{target.name}（需重新确认）</option>}
            </Select> : <Button variant="link" wrap disabled={busy} onClick={() => onSelect(i.requirementId)}>{target?.name || (i.decisionRequired ? '待选择' : '保持状态')}<ChevronDown size={14} /></Button>}</Cell>
            <Cell column="comments"><div className="jira-cell-stack"><span>{i.steps.length} 条</span><small className={issue ? 'text-danger' : ''}>{issue || (i.steps.every(done) ? '已推送' : '待推送')}</small></div></Cell>
          </AdaptiveDataRow>
          {expanded && <div role="row" className="jira-pr-expanded"><div role="cell" className="jira-pr-item-editor">
            <div className="jira-pr-editor-toolbar">
              <a href={i.site + '/browse/' + i.key} target="_blank" rel="noreferrer">{i.key}<ExternalLink size={14} /></a>
              <ol className="jira-pr-flow" aria-label="拟执行状态路径"><li>{current?.name || '当前状态待读取'}</li>{i.steps.filter(s => s.kind === 'transition' && s.transition.state !== 'success').map(s => <li key={s.id}><span aria-hidden="true">→</span>{s.target?.name || '待选择'}</li>)}</ol>
              <div className="jira-row-controls">
                <Button iconOnly title="上一需求" aria-label="上一需求" disabled={busy || position === 0} onClick={() => navigate(position - 1)}><ChevronLeft size={16} /></Button>
                <Button iconOnly title="下一需求" aria-label="下一需求" disabled={busy || position === filtered.length - 1} onClick={() => navigate(position + 1)}><ChevronRight size={16} /></Button>
                <TopbarMenu label="需求更多操作" disabled={busy}>
                  <Button variant="menu" disabled={fetching} onClick={props.onRefresh}><RefreshCw size={15} />刷新当前 Jira 状态</Button>
                  <Button variant="menu" disabled={lockedTarget || fetching || !remote} onClick={() => props.onTarget(target?.id || null, true)}><RefreshCw size={15} />精简并重新生成本项评论</Button>
                  <Button variant="menu" onClick={props.onComments}><History size={15} />查看 Jira 评论</Button>
                  <Button variant="menu" disabled={locked || !i.sources.some(s => s.jiraSyncState !== 'synced')} onClick={props.onManual}><Check size={15} />标记已在 Jira 同步</Button>
                  <Button variant="menu" tone="danger" disabled={locked || i.steps.some(s => s.comment.state === 'success')} onClick={props.onRemove}><Trash2 size={15} />将需求移出 PR</Button>
                </TopbarMenu>
              </div>
            </div>
            <FormError>{props.remoteError}</FormError>
            {bindingChanged && <p className="warning-banner">Jira 关联已变化，本项不能推送。请将未发布的事项移出后重新生成。</p>}
            {i.decisionRequired && <p className="warning-banner">请选择最终状态并确认路径，或选择保持状态。</p>}
            {i.reviewRequired && <div className="warning-banner">请核对保留的评论，删除已同步或不再适用的内容。<Button variant="link" disabled={locked} onClick={() => onChange({ ...i, reviewRequired: false })}><Check size={15} />已检查评论正文</Button></div>}
            {remote && i.steps.filter(s => s.kind === 'transition' && s.transition.state !== 'success').length > 1 && <small className="jira-pr-path-note">后续转换将在执行前逐项检查权限与必填资料。</small>}
            {remote?.transitions.filter(t => t.id === i.steps.find(s => s.kind === 'transition' && s.transition.state !== 'success')?.transitionId && t.requiredFields.length).map(t => <p key={t.id} className="warning-banner">请先在 Jira 补充：{t.requiredFields.join('、')}</p>)}
            {props.remoteComments}
            <div className="jira-pr-comment-list">
              {i.steps.map((step, index) => {
                const commentLocked = locked || step.comment.state === 'success';
                return <section className="jira-pr-step" key={step.id}>
                  <header><h3>{index + 1}. {step.kind === 'transition' ? '转入' + (step.target?.name || '待选择状态') + '时的评论' : '进展评论'}</h3><TopbarMenu label={'评论 ' + (index + 1) + ' 更多操作'} disabled={busy}>
                    <Button variant="menu" disabled={commentLocked} onClick={() => props.onRegenerate(step)}><RefreshCw size={15} />重新生成评论</Button>
                    {step.kind === 'comment' && <Button variant="menu" tone="danger" disabled={commentLocked} onClick={() => onChange({ ...i, steps: i.steps.filter(s => s.id !== step.id) })}><Trash2 size={15} />删除评论</Button>}
                  </TopbarMenu></header>
                  <div className="field jira-pr-comment-field"><CommentInput index={index + 1} value={step.body} disabled={commentLocked} onChange={body => patch(step, { body })} /></div>
                  {!!i.sources.length && <details className="jira-pr-source-details"><summary>来源进展 · {step.sourceIds.length} 条</summary><div className="jira-pr-sources">{i.sources.map(s => <label key={s.id}><input type="checkbox" checked={step.sourceIds.includes(s.id)} disabled={commentLocked || s.jiraSyncState === 'synced' || i.steps.some(other => other.id !== step.id && other.sourceIds.includes(s.id))} onChange={e => patch(step, { sourceIds: e.target.checked ? [...step.sourceIds, s.id] : step.sourceIds.filter(id => id !== s.id) })} /><span><strong>{new Date(s.createdAt).toLocaleString('zh-CN')} · {s.createdByName || '未记录人员'} · {s.workItemTitle || '需求'}</strong><span>{s.content || s.eventType}</span></span></label>)}</div></details>}
                  <Receipt name="评论" receipt={step.comment} />{step.kind === 'transition' && <Receipt name="状态" receipt={step.transition} />}
                  {(['comment', 'transition'] as const).filter(part => step[part].state === 'unknown').map(part => <div className="jira-pr-summary" key={part}><Button disabled={busy} onClick={() => props.onRecheck(step, part)}><RefreshCw size={14} />核对{part === 'comment' ? '评论' : '状态'}</Button>{part === 'transition' && <Button disabled={busy} onClick={() => props.onRecheck(step, part, 'applied')}>确认流转成功</Button>}<Button disabled={busy} onClick={() => props.onRecheck(step, part, 'not_applied')}>人工核对并结束原操作</Button></div>)}
                </section>;
              })}
              {!locked && <Button disabled={busy || i.steps.length >= 30} onClick={() => onChange({ ...i, steps: [...i.steps, { id: randomUUID(), kind: 'comment', body: '', sourceIds: [], target: null, transitionId: null, transitionName: null, comment: { state: 'pending' }, transition: { state: 'pending' } }] })}><MessageSquarePlus size={16} />添加评论</Button>}
            </div>
          </div></div>}
        </Fragment>;
      })}
    </AdaptiveDataList>
  </>;
}
