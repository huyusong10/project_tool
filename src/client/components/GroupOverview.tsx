import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { emptyGroupOverview, groupAssessmentLabels, groupOverviewInput, type GroupOverviewInput, type RequirementGroup, type IntakeCatalog } from '../../shared/intake';
import type { GroupOverview, GroupOverviewReport } from '../../shared/group-overview';
import { api, InvalidResponseError, isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from '../api';
import { useSession } from '../app-context';
import { canManageProject } from '../permissions';
import { keys, invalidateRequirementViews } from '../query-keys';
import { useResourceQuery } from '../use-resource-query';
import { useListPagination } from '../use-list-pagination';
import { formatDateTime } from '../format';
import { Modal } from './Modal';
import { Pagination } from './Pagination';
import { StatusBadge } from './Badge';
import { GroupManager, readGroupOperationRecheck, persistGroupOperationRecheck, type GroupOperationRecheck } from './RequirementIntake';
import './group-overview.css';

type PendingAssessment = { group: RequirementGroup; overview: GroupOverviewInput };
function readPending(key: string): PendingAssessment | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null') as PendingAssessment | null;
    return value && typeof value.group?.id === 'string' && Number.isInteger(value.group.version) && groupOverviewInput.safeParse(value.overview).success ? value : null;
  } catch { return null; }
}
function validateReport(value: GroupOverviewReport) {
  if (!value || !Array.isArray(value.groups) || typeof value.ungroupedCount !== 'number' || !value.groups.every(group =>
    typeof group.id === 'string' && typeof group.name === 'string' && Number.isInteger(group.version) &&
    groupOverviewInput.safeParse(group.overview).success && Array.isArray(group.requirements) && Array.isArray(group.recentUpdates) &&
    group.counts && ['total','completed','inProgress','delayed','unscheduled','recentCompleted'].every(key => Number.isFinite(group.counts[key as keyof typeof group.counts])))) {
    throw new InvalidResponseError(200, false, '总体进展响应不完整');
  }
}
function Assessment({value}: {value: GroupOverviewInput['assessment']}) {
  return <span className={'group-assessment group-assessment-' + value}>{groupAssessmentLabels[value]}</span>;
}
function OverviewDetails({group}: {group: GroupOverview}) {
  return <div className="group-overview-details">
    {group.overview.note && <p className="group-overview-note"><span>原因或变化</span>{group.overview.note}</p>}
    <div className="group-overview-evidence">
      <div><h3>需求进展</h3>{group.requirements.length ? <ul>{group.requirements.map(item => <li key={item.id}>
        <Link to={'/requirements/' + item.id}>{item.title}</Link><StatusBadge kind="requirement" value={item.status}/>
        {item.status !== 'completed' && (item.delayed ? <small className="danger-text">已延期</small> : !item.scheduleComplete ? <small>排期不完整</small> : null)}
      </li>)}</ul> : <p>尚未关联需求</p>}
      <Link className="group-overview-link" to={'/requirements?group=' + encodeURIComponent(group.id)}>查看分组需求</Link></div>
      <div><h3>最近进展</h3>{group.recentUpdates.length ? <ul className="group-overview-updates">{group.recentUpdates.map(update => <li key={update.id}>
        <Link to={'/requirements/' + update.requirementId}>{update.requirementTitle}</Link><time>{formatDateTime(update.createdAt)}</time><p>{update.content}</p>
      </li>)}</ul> : <p>暂无进展记录</p>}</div>
    </div>
  </div>;
}

export function GroupOverviewPanel({projectId}: {projectId: string}) {
  const {session} = useSession();
  const accountKey = session.accountId || session.username || 'guest';
  const storageKey = 'project-manage:group-overview-recheck:' + accountKey + ':' + projectId;
  const [pending,setPendingState] = useState(() => readPending(storageKey));
  const [editing,setEditing] = useState<RequirementGroup | null>(null);
  const [expanded,setExpanded] = useState<string[]>([]);
  const [managing,setManaging] = useState(false);
  const [groupRecheck,setGroupRecheckState] = useState<GroupOperationRecheck | null>(() => readGroupOperationRecheck(accountKey,projectId));
  const setGroupRecheck = (value: GroupOperationRecheck | null) => {setGroupRecheckState(value);persistGroupOperationRecheck(accountKey,projectId,value);};
  const setPending = (value: PendingAssessment | null) => {
    setPendingState(value);
    try {if(value)sessionStorage.setItem(storageKey,JSON.stringify(value));else sessionStorage.removeItem(storageKey);} catch { /* 当前页面仍保留待核对资料。 */ }
  };
  const query = useResourceQuery<GroupOverviewReport>([...keys.groupOverview,projectId,accountKey],'/api/projects/' + projectId + '/group-overview',Boolean(projectId),validateReport);
  const manage = canManageProject(session,projectId);
  const groups = query.data?.groups || [];
  const pagination = useListPagination({items: groups,id:'groupOverview',ready:Boolean(query.data),loading:query.isLoading});
  useEffect(() => {if(query.unavailable || !manage){setEditing(null);setManaging(false);}},[query.unavailable,manage]);
  return <section className="panel group-overview-panel" aria-label="总体进展">
    <header><div><h2>总体进展</h2><p>大致预期与当前情况</p></div><div className="group-overview-actions">
      <button type="button" className="ghost-button" onClick={() => void query.refetch()} disabled={query.isFetching}>刷新</button>
      {manage && <button type="button" className="ghost-button" disabled={query.unavailable || Boolean(pending)} onClick={() => setManaging(true)}><Plus size={15}/>{groups.length ? '管理分组' : '创建分组'}</button>}
    </div></header>
    {query.error && <div role="alert" className="warning-banner">{query.unavailable ? '总体进展加载失败。' : '刷新失败，正在显示上次读取的资料。'}{query.error.message}</div>}
    {query.unavailable ? <p className="group-overview-empty">{query.isLoading ? '加载总体进展…' : '请重新加载总体进展。'}</p> : <>
      {pending && manage && <div role="alert" className="warning-banner">上次保存结果待核对。<button type="button" className="ghost-button" onClick={() => setEditing(pending.group)}>核对上次保存</button></div>}
      {groupRecheck && manage && <div role="alert" className="warning-banner">分组操作结果待核对。<button type="button" className="ghost-button" onClick={() => setManaging(true)}>核对分组操作</button></div>}
      {!groups.length && <p className="group-overview-empty">暂无分组。{manage ? '创建分组后，可记录大致预期和总体判断。' : '项目经理可创建分组并记录总体预期。'}</p>}
      <div ref={pagination.scrollRef} className="group-overview-list">{pagination.items.map(group => {
        const open = expanded.includes(group.id), counts = group.counts;
        return <article className="group-overview-row" key={group.id} aria-label={group.name}>
          <div className="group-overview-main">
            <button type="button" className="group-overview-toggle" aria-label={(open ? '收起 ' : '展开 ') + group.name} aria-expanded={open} aria-controls={'group-detail-' + group.id} onClick={() => setExpanded(value => open ? value.filter(id => id !== group.id) : [...value,group.id])}>
              {open ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}<strong>{group.name}</strong>
            </button>
            <div className="group-overview-text"><span>大致预期</span><p>{group.overview.expectation || '尚未填写预期'}</p></div>
            <div className="group-overview-text"><span>当前情况</span><p>{group.overview.progressSummary || '尚未填写进展简述'}</p></div>
            <div className="group-overview-assessment"><Assessment value={group.overview.assessment}/><small>{group.assessedAt ? formatDateTime(group.assessedAt) + ' · ' + (group.assessedByName || '原评估人') : '尚未评估'}</small></div>
            {manage && <button type="button" className="ghost-button" aria-label={'编辑总体进展 ' + group.name} disabled={Boolean(pending || groupRecheck)} onClick={() => setEditing(group)}>编辑</button>}
          </div>
          <div className="group-overview-facts" aria-label="系统汇总">
            {counts.total ? <><span>完成 {counts.completed}/{counts.total} 个需求</span><span>进行中 {counts.inProgress}</span><span className={counts.delayed ? 'danger-text' : ''}>延期 {counts.delayed}</span><span>排期不完整 {counts.unscheduled}</span><span title={query.data!.recentFrom + ' 至 ' + query.data!.asOfDate}>近七天完成 {counts.recentCompleted}</span></> : <span>尚未关联需求</span>}
          </div>
          {open && <div id={'group-detail-' + group.id}><OverviewDetails group={group}/></div>}
        </article>;
      })}</div>
      {groups.length > 0 && <Pagination {...pagination.props} label="总体进展分页"/>}
      {query.data!.ungroupedCount > 0 && <div className="group-overview-ungrouped"><span>未分组需求 {query.data!.ungroupedCount} 个</span><Link to="/requirements?group=ungrouped">{manage ? '查看并整理' : '查看需求'}</Link></div>}
      {editing && manage && <GroupOverviewEditor key={editing.id} projectId={projectId} group={editing} pending={pending} onPending={setPending} onClose={() => setEditing(null)}/>}
      {managing && manage && <GroupManager projectId={projectId} recheck={groupRecheck} onRecheckChange={setGroupRecheck} onClose={() => setManaging(false)}/>}
    </>}
  </section>;
}

function sameOverview(a: GroupOverviewInput, b: GroupOverviewInput) {
  return a.expectation === b.expectation && a.progressSummary === b.progressSummary && a.assessment === b.assessment && a.note === b.note;
}
function GroupOverviewEditor({projectId,group,pending,onPending,onClose}: {
  projectId: string; group: RequirementGroup; pending: PendingAssessment | null;
  onPending: (value: PendingAssessment | null) => void; onClose: () => void;
}) {
  const client = useQueryClient();
  const [baseline,setBaseline] = useState(group);
  const [draft,setDraft] = useState<GroupOverviewInput>(() => pending?.group.id === group.id ? pending.overview : group.overview || {...emptyGroupOverview});
  const [busy,setBusy] = useState(false), [reading,setReading] = useState(false), [needsRecheck,setNeedsRecheck] = useState(Boolean(pending));
  const [latest,setLatest] = useState<RequirementGroup | null | undefined>();
  const [error,setError] = useState('');
  const active = useRef(true), submitting = useRef(false);
  useEffect(() => {active.current=true;return () => {active.current=false;};},[]);
  const readLatest = async () => {
    setReading(true);setError('');
    try {
      const report = await api<GroupOverviewReport>('/api/projects/' + projectId + '/group-overview');validateReport(report);
      if(!active.current)return;
      setLatest(report.groups.find(item => item.id === group.id) || null);
      invalidateRequirementViews(client);
    } catch(cause) {if(active.current)setError(cause instanceof Error ? cause.message : '读取失败，请重试');}
    finally {if(active.current)setReading(false);}
  };
  const save = async () => {
    if(submitting.current || needsRecheck || pending || reading)return;
    const value = groupOverviewInput.parse(draft);
    submitting.current=true;setBusy(true);setError('');onPending({group:baseline,overview:value});
    try {
      const response = await api<IntakeCatalog>('/api/projects/' + projectId + '/requirement-groups',{method:'POST',body:jsonBody({id:baseline.id,name:baseline.name,sortOrder:baseline.sortOrder,expectedVersion:baseline.version,overview:value})});
      const saved=response?.groups?.find(item => item.id===baseline.id);
      if(!saved || saved.version<=baseline.version || !groupOverviewInput.safeParse(saved.overview).success || !sameOverview(saved.overview,value)) throw new InvalidResponseError(200,true,'分组保存响应不完整');
      if(!active.current)return;
      onPending(null);invalidateRequirementViews(client);onClose();
    } catch(cause) {
      if(!active.current)return;
      setError(cause instanceof Error ? cause.message : '保存失败');
      if(!isWriteOutcomeUnknown(cause))onPending(null);
      if(requiresWriteRecheck(cause)) {
        setNeedsRecheck(true);
        if(!isWriteOutcomeUnknown(cause))await readLatest();
      }
    } finally {submitting.current=false;if(active.current)setBusy(false);}
  };
  const confirmLatest = () => {
    if(latest===undefined)return;
    if(!latest){onPending(null);invalidateRequirementViews(client);onClose();return;}
    if(pending && latest.version>pending.group.version && sameOverview(latest.overview,pending.overview)) {
      onPending(null);invalidateRequirementViews(client);onClose();return;
    }
    setBaseline(latest);setLatest(undefined);onPending(null);setNeedsRecheck(false);setError('');
  };
  return <Modal title={'总体进展 · ' + group.name} onClose={onClose} closable={!busy}>
    <form className="group-overview-form" onSubmit={event => {event.preventDefault();void save();}}>
      <fieldset disabled={busy || reading}>
        <label className="field"><span>大致预期</span><textarea aria-label="大致预期" rows={3} maxLength={2000} placeholder="例如：本季度具备试用条件" value={draft.expectation} onChange={event => setDraft({...draft,expectation:event.target.value})}/></label>
        <label className="field"><span>进展简述</span><textarea aria-label="进展简述" rows={3} maxLength={2000} placeholder="目前推进到了哪里" value={draft.progressSummary} onChange={event => setDraft({...draft,progressSummary:event.target.value})}/></label>
        <label className="field"><span>判断</span><select aria-label="判断" value={draft.assessment} onChange={event => setDraft({...draft,assessment:event.target.value as GroupOverviewInput['assessment']})}>{Object.entries(groupAssessmentLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="field"><span>原因或变化说明</span><textarea aria-label="原因或变化说明" rows={3} maxLength={2000} placeholder="补充判断依据，或与之前相比的变化" value={draft.note} onChange={event => setDraft({...draft,note:event.target.value})}/></label>
      </fieldset>
      {error && <p role="alert" className="warning-banner">{error}</p>}
      {(needsRecheck || pending) && <div role="alert" className="warning-banner">保存前请读取并核对最新资料，已填写内容保留。<button type="button" className="ghost-button" disabled={reading || busy} onClick={() => void readLatest()}>{reading ? '读取中…' : '读取最新资料'}</button></div>}
      {latest !== undefined && <div className="group-overview-recheck">{latest ? <>
        <h3>服务器上的最新资料</h3><dl><dt>大致预期</dt><dd>{latest.overview.expectation || '未填写'}</dd><dt>进展简述</dt><dd>{latest.overview.progressSummary || '未填写'}</dd><dt>判断</dt><dd>{groupAssessmentLabels[latest.overview.assessment]}</dd><dt>原因或变化说明</dt><dd>{latest.overview.note || '未填写'}</dd></dl>
        <button type="button" className="ghost-button" onClick={confirmLatest}>{pending && latest.version>pending.group.version && sameOverview(latest.overview,pending.overview) ? '已核对，保存已生效' : '保留输入，按最新资料继续'}</button>
      </> : <><p>该分组已删除，无法继续保存。</p><button type="button" className="ghost-button" onClick={confirmLatest}>完成核对并关闭</button></>}</div>}
      <div className="form-actions"><button type="button" className="ghost-button" disabled={busy} onClick={onClose}>关闭</button><button className="primary-button" disabled={busy || reading || needsRecheck || Boolean(pending)}>{busy ? '保存中…' : '保存总体进展'}</button></div>
    </form>
  </Modal>;
}
