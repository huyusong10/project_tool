import { randomUUID } from 'node:crypto';
import { coordinationKeys } from '../../shared/blocker-coordination';
import { createRequirementInputSchema, directRequirementCommandSchema, rescheduleRequirementInputSchema, updateRequirementInputSchema } from '../../shared/contracts';
import { addBusinessDays, businessDaysInclusive, rescheduleDirectDates, todayIso } from '../../shared/domain';
import { analysePaths, dependencySource } from '../../shared/paths';
import type { Actor } from '../auth';
import { assertProjectManager, assertRequirementOwnerOrManager, canManageProject, requireAuthorizationActor } from '../authorization';
import { getDatabaseContext } from '../database-context';
import { fail, forbidden, notFound } from '../errors';
import { preserveRecordedAcceptance } from './acceptance-history';
import { recordAudit } from './audit';
import { assertCoordinationAccess, isCoordinationEdit, persistCoordination, validateCoordination } from './blocker-coordination';
import { normalizeDirectEstimates, persistDirectEstimates } from './direct-estimates';
import { invalidateForecastReview } from './forecast-reviews';
import { persistOrganization, validateOrganization } from './intake-metadata';
import { settleMilestones } from './milestones';
import { loadPathInput } from './paths';
import { persistRequirementLinks } from './reference-links';
import { recordRequirementClarification } from './requirement-events';
import { getRequirement, type RequirementRecord } from './requirements';
import { assertExpectedVersion, assertVersionedWrite, describeChanges, normalizeRequirementText, nullableText, requireActiveProject, type JsonObject } from './support';

function refreshDirectForecast(id:string){
  const row=getDatabaseContext().sqlite.prepare('SELECT project_id AS projectId FROM requirements WHERE id=?').get(id) as {projectId:string};
  const snapshot=loadPathInput(row.projectId);normalizeDirectEstimates(snapshot,[id]);persistDirectEstimates(snapshot,[id]);
}

export const deliveryColumns={deliveryScope:'delivery_scope',executionMode:'execution_mode',acceptanceOwnerId:'acceptance_owner_id',durationDays:'duration_days',forecastEnd:'forecast_end',unblockEstimate:'unblock_estimate'} as const;
export function validateDeliveryFields(projectId:string,value:JsonObject,actor:Actor,current?:RequirementRecord,conflict=false){
  const auth=requireAuthorizationActor(actor);validateOrganization(projectId,value);if(value.featureId!==undefined&&value.featureId!==current?.featureId||value.phaseId!==undefined&&value.phaseId!==current?.phaseId)assertProjectManager(requireAuthorizationActor(actor),projectId);
  if(value.deliveryScope!==undefined&&value.deliveryScope!==current?.deliveryScope||value.acceptanceOwnerId!==undefined&&value.acceptanceOwnerId!==current?.acceptanceOwnerId)assertProjectManager(auth,projectId);
  if(value.acceptanceOwnerId){const valid=getDatabaseContext().sqlite.prepare("SELECT 1 FROM project_people pp JOIN people p ON p.id=pp.person_id JOIN accounts a ON a.person_id=p.id WHERE pp.project_id=? AND p.id=? AND pp.project_role IN ('manager','member') AND p.active=1 AND p.deleted_at IS NULL AND a.status='active' AND a.deleted_at IS NULL").get(projectId,value.acceptanceOwnerId);if(!valid)fail('验收人必须是有有效账号的当前项目成员');}
  if(value.ownerId&&!getDatabaseContext().sqlite.prepare("SELECT 1 FROM project_people pp JOIN people p ON p.id=pp.person_id JOIN accounts a ON a.person_id=p.id AND a.status='active' AND a.deleted_at IS NULL WHERE pp.project_id=? AND p.id=? AND pp.project_role IN ('member','manager') AND p.active=1 AND p.deleted_at IS NULL").get(projectId,value.ownerId))fail('负责人必须是有效项目成员',conflict?'DEPENDENCY_CONFLICT':'VALIDATION_ERROR',conflict?409:400);
  if(current&&value.ownerId===null&&current.actualStart)fail('需求已执行，不能清空负责人');
  for(const key of ['forecastEnd','unblockEstimate'])if(value[key]&&String(value[key])<todayIso())fail('预测日期不能早于今天');
}
export function assertRequirementAcceptor(id:string,actor:Actor){
  const auth=requireAuthorizationActor(actor),r=getDatabaseContext().sqlite.prepare(`SELECT r.project_id AS projectId,r.acceptance_owner_id AS acceptanceOwnerId,
    EXISTS(SELECT 1 FROM project_people pp JOIN people p ON p.id=pp.person_id JOIN accounts a ON a.person_id=p.id WHERE pp.project_id=r.project_id AND pp.person_id=r.acceptance_owner_id AND pp.project_role IN ('manager','member') AND p.active=1 AND p.deleted_at IS NULL AND a.status='active' AND a.deleted_at IS NULL) AS acceptanceOwnerValid FROM requirements r WHERE r.id=? AND r.deleted_at IS NULL`).get(id) as {projectId:string;acceptanceOwnerId:string|null;acceptanceOwnerValid:boolean}|undefined;
  if(!r)notFound('需求不存在');
  if(canManageProject(auth,r.projectId))return;
  if(r.acceptanceOwnerId===auth.personId&&r.acceptanceOwnerValid)return;
  forbidden('只有指定验收人或项目经理可以验收和退回本需求');
}
function event(id:string,type:string,content:string,actor:Actor,workItem?:{id:string;progress:number}){
  const now=new Date().toISOString(),r=getDatabaseContext().sqlite.prepare('SELECT progress FROM requirements WHERE id=?').get(id) as {progress:number};
  getDatabaseContext().sqlite.prepare('INSERT INTO progress_updates(id,requirement_id,work_item_id,percent,work_item_percent,content,event_type,created_by_account_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),id,workItem?.id||null,r.progress,workItem?.progress??null,content,type,actor.accountId||null,now,now);
  recordAudit(actor,type,workItem?'work_item':'requirement',workItem?.id||id,content);
}
export function createDirectRequirement(raw:JsonObject,actor:Actor,deferNormalization=false){
  const v=normalizeRequirementText(createRequirementInputSchema.parse(raw)),auth=requireAuthorizationActor(actor);requireActiveProject(v.projectId);
  assertProjectManager(auth,v.projectId);validateDeliveryFields(v.projectId,v,actor);
  if(v.templateId)fail('直接执行不能同时使用流程；请选择工作项分解');
  const id=randomUUID(),now=new Date().toISOString();
  let start=v.plannedStart||null,end=v.plannedEnd||null;
  for(const d of [start,end])if(d&&businessDaysInclusive(d,d)!==1)fail('计划日期必须是工作日');
  if(v.durationDays){if(start)end=addBusinessDays(start,v.durationDays-1);else if(end)start=addBusinessDays(end,1-v.durationDays);}
  getDatabaseContext().sqlite.transaction(()=>{
    requireActiveProject(v.projectId);assertProjectManager(requireAuthorizationActor(actor),v.projectId);
    getDatabaseContext().sqlite.prepare(`INSERT INTO requirements(id,project_id,title,owner_id,background,acceptance_criteria,reference_url,status,progress,priority,delivery_scope,execution_mode,acceptance_owner_id,planned_start,planned_end,duration_days,forecast_end,unblock_estimate,dependencies_reviewed_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'not_started',0,?,?,'direct',?,?,?,?,?,?,?,?,?)`).run(id,v.projectId,v.title,v.ownerId||null,v.background||null,v.acceptanceCriteria||null,v.referenceUrl||null,v.priority,v.deliveryScope||'committed',v.acceptanceOwnerId||null,start,end,v.durationDays||null,v.forecastEnd||null,v.unblockEstimate||null,now,now,now);
    persistRequirementLinks(id,v);
    getDatabaseContext().sqlite.prepare('UPDATE requirements SET schedule_anchor=? WHERE id=?').run(start,id);persistOrganization(id,v.projectId,v);
    if(v.forecastEnd&&!deferNormalization)refreshDirectForecast(id);
    const organization = JSON.stringify({featureId:v.featureId,phaseId:v.phaseId,reason:v.reason});
    recordAudit(actor,'create','requirement',id,'创建需求：'+v.title+(organization==='{}'?'':'；'+organization));
    requireActiveProject(v.projectId,true);assertProjectManager(requireAuthorizationActor(actor),v.projectId);validateDeliveryFields(v.projectId,v,actor,undefined,true);
  }).immediate();
  return getRequirement(id,false,!deferNormalization);
}
export function updateDeliveryRequirement(id:string,raw:JsonObject,actor:Actor,split=false,deferNormalization=false){
  const value=normalizeRequirementText(updateRequirementInputSchema.parse(raw)),r=getRequirement(id,false,!deferNormalization),auth=requireAuthorizationActor(actor);
  const wasManager=canManageProject(auth,r.projectId);
  if(isCoordinationEdit(value))assertCoordinationAccess('requirement',id,value,actor);else assertRequirementOwnerOrManager(auth,id);assertExpectedVersion(value,r.version);
  if(['completed','cancelled'].includes(r.status))fail('已结束需求不能编辑');
  validateDeliveryFields(r.projectId,value,actor,r);
  requireActiveProject(r.projectId);
  if(value.plannedStart!==undefined||value.plannedEnd!==undefined){
    if(r.executionMode!=='direct')fail('请在工作项中调整计划');
    const start=value.plannedStart===undefined?r.plannedStart:value.plannedStart,end=value.plannedEnd===undefined?r.plannedEnd:value.plannedEnd;
    if(start&&end&&start>end)fail('计划完成日期不能早于开始日期');
    for(const day of [start,end])if(day&&businessDaysInclusive(day,day)!==1)fail('计划日期必须是工作日');
  }
  const nextMode=value.executionMode||r.executionMode;
  if(nextMode!==r.executionMode){
    if(nextMode==='direct'&&(r.workItems?.length||r.actualStart||r.splitAt))fail('有工作项或执行历史的需求不能切回直接执行');
    if(nextMode==='work_items'&&r.executionMode==='direct'&&!split)fail('请通过拆分预览和整批保存建立剩余工作项');
    if(['blocked','pending_acceptance'].includes(r.status))fail('请先解除阻塞或返工，再拆分需求');
  }
  const coordinationChanged=coordinationKeys.some(k=>value[k]!==undefined);if(coordinationChanged){if(r.status!=='blocked')fail('只有阻塞对象可以修改协调信息');Object.assign(value,validateCoordination(r.projectId,{...r,...value}));}
  const columns={blockedCoordinatorId:'blocked_coordinator_id',blockedNextReviewAt:'blocked_next_review_at',blockedIssueId:'blocked_issue_id',...deliveryColumns,title:'title',ownerId:'owner_id',background:'background',acceptanceCriteria:'acceptance_criteria',referenceUrl:'reference_url',referenceLinks:'reference_links',plannedStart:'planned_start',plannedEnd:'planned_end',priority:'priority'};
  const changes=Object.entries(value).filter(([k])=>k in columns),now=new Date().toISOString();
  if(!changes.length&&value.featureId===undefined&&value.phaseId===undefined)fail('没有需要保存的修改');
  getDatabaseContext().sqlite.transaction(()=>{
    requireActiveProject(r.projectId);validateDeliveryFields(r.projectId,value,actor,r);
    persistOrganization(id,r.projectId,value);
    const setters=changes.map(([k])=>columns[k as keyof typeof columns]+'=?');
    const extra=split&&r.executionMode==='direct'&&nextMode==='work_items'?',split_base_progress=?,split_at=?':'';
    const updated=getDatabaseContext().sqlite.prepare('UPDATE requirements SET '+(setters.length?setters.join(',')+',':'')+(extra?extra.slice(1)+',':'')+'version=version+1,updated_at=? WHERE id=? AND version=?').run(...changes.map(([k,v])=>k==='referenceLinks'?JSON.stringify(v):v??null),...(extra?[Math.min(99,r.progress),now]:[]),now,id,r.version);
    assertVersionedWrite(updated,'需求');
    if(value.referenceLinks!==undefined||value.referenceUrl!==undefined)persistRequirementLinks(id,value,r);
    if(coordinationChanged)persistCoordination('requirement',id,r.projectId,value,actor);
    if(value.forecastEnd!==undefined&&!split&&!deferNormalization)refreshDirectForecast(id);
    recordRequirementClarification(r, { background: value.background, acceptanceCriteria: value.acceptanceCriteria }, actor, now);
    if(extra)event(id,'split','拆分剩余工作；已完成基线 '+r.progress+'%。'+(value.reason||''),actor);
    else recordAudit(actor,'update','requirement',id,'修改需求：'+r.title+'；'+describeChanges(r,value)+(value.reason?'；'+value.reason:''));
    requireActiveProject(r.projectId,true);if(wasManager)assertProjectManager(requireAuthorizationActor(actor),r.projectId);else assertRequirementOwnerOrManager(requireAuthorizationActor(actor),id);validateDeliveryFields(r.projectId,value,actor,r,true);
  }).immediate();
  return getRequirement(id,false,!deferNormalization);
}
export function directStartConditions(id:string){
  const r=getRequirement(id),snapshot=loadPathInput(r.projectId),analysis=analysePaths(snapshot),own=snapshot.requirements.find(x=>x.id===id)!;
  const unmet=snapshot.dependencies.filter(e=>e.targetRequirementId===id&&!e.targetWorkItemId&&!e.targetMilestoneId&&!own.acknowledgedDependencies?.includes(e.id)&&!analysis.nodes.find(n=>n.id===dependencySource(e))?.complete);
  return {dependencyRevision:snapshot.revision,unmetPredecessors:unmet.map(e=>({id:e.id,title:analysis.nodes.find(n=>n.id===dependencySource(e))?.title||'前置交付'}))};
}
export function executeDirectRequirement(id:string,action:'start'|'progress'|'complete'|'rework',raw:JsonObject,actor:Actor){
  const input=directRequirementCommandSchema.parse(raw),auth=requireAuthorizationActor(actor);
  return getDatabaseContext().sqlite.transaction(()=>{
    const r=getRequirement(id);requireActiveProject(r.projectId);assertExpectedVersion(input,r.version);
    if(r.executionMode!=='direct')fail('此需求通过工作项推进，请操作对应工作项');
    assertRequirementOwnerOrManager(auth,id);
    const allowed={start:['not_started'],progress:['in_progress'],complete:['in_progress'],rework:['completed']};
    if(!allowed[action].includes(r.status))fail('当前状态不能执行此操作','INVALID_TRANSITION');
    const now=new Date().toISOString(),today=todayIso();let sets='',args:unknown[]=[];
    let content=input.content||input.reason||({start:'开始需求',complete:'工作完成'} as Record<string,string>)[action]||'';
    if(input.ownerId!==undefined&&action!=='start')fail('只有开始时可以补选负责人');
    if(action==='start'){
      const ownerId=input.ownerId||r.ownerId;
      if(r.ownerId&&r.ownerValid&&input.ownerId&&input.ownerId!==r.ownerId)fail('负责人已指定，请刷新后开始');
      if(!ownerId)fail('开始前请指定需求负责人');validateDeliveryFields(r.projectId,{ownerId},actor,r);
      sets="status='in_progress',actual_start=?,owner_id=?";args=[today,ownerId];
      if(ownerId!==r.ownerId)content+='；'+describeChanges(r,{ownerId});
    }else if(action==='progress'){
      if(input.progress===undefined)fail('请填写需求进度');
      if(input.progress<r.progress)fail('普通进展不能降低完成度，请执行返工或纠错');
      content=nullableText(content)||`完成度：${r.progress}% → ${input.progress}%`;sets='progress=?';args=[input.progress];
    }else if(action==='complete'){
      const end=input.actualEnd||today;
      if(end>today||!r.actualStart||end<r.actualStart)fail('实际完成日期应在实际开始日期和今天之间');
      sets="status='completed',progress=100,actual_end=?";args=[end];
    }else{
      content=(nullableText(content)||'重新打开需求')+'；原完成日期：'+(r.actualEnd||'未记录');
      preserveRecordedAcceptance(id);sets="status='in_progress',progress=?,actual_end=NULL,accepted_at=NULL,accepted_by_account_id=NULL";args=[input.progress??99];
    }
    const updated=getDatabaseContext().sqlite.prepare('UPDATE requirements SET '+sets+',version=version+1,updated_at=? WHERE id=? AND version=?').run(...args,now,id,r.version);
    assertVersionedWrite(updated,'需求');event(id,action,content,actor);settleMilestones(r.projectId,actor);
    requireActiveProject(r.projectId,true);assertRequirementOwnerOrManager(requireAuthorizationActor(actor),id);
    return getRequirement(id);
  }).immediate();
}

export function returnRequirement(id:string,input:JsonObject,actor:Actor){
  const r=getRequirement(id);if(r.executionMode==='direct')return executeDirectRequirement(id,'rework',input,actor);
  requireActiveProject(r.projectId);assertRequirementOwnerOrManager(requireAuthorizationActor(actor),id);assertExpectedVersion(input,r.version);
  if(r.status!=='completed')fail('当前需求不能退回');
  const reason=nullableText(input.reason)||'需求返工',ids=Array.isArray(input.workItemIds)?input.workItemIds.map(String):[];
  if(!ids.length||ids.some(id=>!r.workItems?.some(w=>w.id===id&&w.status==='completed')))fail('请选择需要返工的已完成工作项');
  getDatabaseContext().sqlite.transaction(()=>{
    requireActiveProject(r.projectId);
    preserveRecordedAcceptance(id);
    for(const wid of new Set(ids))getDatabaseContext().sqlite.prepare("UPDATE work_items SET status=CASE WHEN actual_start IS NULL THEN 'not_started' ELSE 'in_progress' END,progress=CASE WHEN actual_start IS NULL THEN 0 ELSE 99 END,actual_end=NULL,version=version+1,updated_at=? WHERE id=?").run(new Date().toISOString(),wid);
    const updated=getDatabaseContext().sqlite.prepare("UPDATE requirements SET status='in_progress',progress=99,accepted_at=NULL,accepted_by_account_id=NULL,version=version+1,updated_at=? WHERE id=? AND version=?").run(new Date().toISOString(),id,r.version);
    assertVersionedWrite(updated,'需求');for(const wid of new Set(ids))invalidateForecastReview('work',wid);assertRequirementOwnerOrManager(requireAuthorizationActor(actor),id);
    const returned=r.workItems!.filter(w=>ids.includes(w.id));
    event(id,'rework',reason+'；返工项：'+returned.map(w=>w.title).join('、')+'；原完成日期：'+(r.executionCompletedAt||r.actualEnd||'未记录'),actor);
    for(const w of returned)event(id,'rework',reason,actor,{id:w.id,progress:w.actualStart?99:0});
  }).immediate();return getRequirement(id);
}

export function rescheduleDirectRequirement(id:string,raw:JsonObject,actor:Actor){
  const value=rescheduleRequirementInputSchema.parse(raw);
  return getDatabaseContext().sqlite.transaction(()=>{
    const r=getRequirement(id);requireActiveProject(r.projectId);assertProjectManager(requireAuthorizationActor(actor),r.projectId);assertExpectedVersion(value,r.version);
    if(['completed','cancelled'].includes(r.status))fail('已结束需求不能重新排期');
    const reason=nullableText(value.reason)||describeChanges(r,value);
    let dates:ReturnType<typeof rescheduleDirectDates>;
    try{dates=rescheduleDirectDates(r,value);}catch(error){fail((error as Error).message);}
    const {plannedStart:start,plannedEnd:end}=dates;
    const updated=getDatabaseContext().sqlite.prepare('UPDATE requirements SET planned_start=?,planned_end=?,schedule_anchor=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(start,end,start,new Date().toISOString(),id,r.version);
    assertVersionedWrite(updated,'需求');event(id,'reschedule',reason+'；计划 '+(start||'待定')+' 至 '+(end||'待定'),actor);
    return getRequirement(id);
  }).immediate();
}
