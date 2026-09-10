import {invalidateForecastReview} from './forecast-reviews';
import {preserveRecordedAcceptance} from './acceptance-history';
import {validateCoordination,persistCoordination,isCoordinationEdit,assertCoordinationAccess} from './blocker-coordination';
import {coordinationKeys} from '../../shared/blocker-coordination';
import {randomUUID} from 'node:crypto';
import {sqlite} from '../database';
import type {Actor} from '../auth';
import {assertProjectManager,assertRequirementOwnerOrManager,canManageProject,requireAuthorizationActor} from '../authorization';
import {fail,forbidden,notFound} from '../errors';
import {createRequirementInputSchema,updateRequirementInputSchema,directRequirementCommandSchema,rescheduleRequirementInputSchema} from '../../shared/contracts';
import {addBusinessDays,businessDayDelta,businessDaysInclusive,todayIso} from '../../shared/domain';
import {getRequirement,type RequirementRecord} from './requirements';
import {loadPathInput} from './paths';
import {analysePaths,dependencySource} from '../../shared/paths';
import {recordAudit} from './audit';
import {settleMilestones} from './milestones';
import {requireActiveProject,assertExpectedVersion,assertVersionedWrite,requireText,normalizeRequirementText,type JsonObject} from './support';
import {normalizeDirectEstimates,persistDirectEstimates} from './direct-estimates';

function refreshDirectForecast(id:string){
  const row=sqlite.prepare('SELECT project_id AS projectId FROM requirements WHERE id=?').get(id) as {projectId:string};
  const snapshot=loadPathInput(row.projectId);normalizeDirectEstimates(snapshot,[id]);persistDirectEstimates(snapshot,[id]);
}

export const deliveryColumns={deliveryScope:'delivery_scope',executionMode:'execution_mode',acceptanceOwnerId:'acceptance_owner_id',durationDays:'duration_days',forecastEnd:'forecast_end',unblockEstimate:'unblock_estimate'} as const;
export function validateDeliveryFields(projectId:string,value:JsonObject,actor:Actor,current?:RequirementRecord){
  const auth=requireAuthorizationActor(actor);
  if(value.deliveryScope!==undefined&&value.deliveryScope!==current?.deliveryScope||value.acceptanceOwnerId!==undefined&&value.acceptanceOwnerId!==current?.acceptanceOwnerId)assertProjectManager(auth,projectId);
  if(value.acceptanceOwnerId){const valid=sqlite.prepare("SELECT 1 FROM project_people pp JOIN people p ON p.id=pp.person_id JOIN accounts a ON a.person_id=p.id WHERE pp.project_id=? AND p.id=? AND pp.project_role IN ('manager','member') AND p.active=1 AND p.deleted_at IS NULL AND a.status='active' AND a.deleted_at IS NULL").get(projectId,value.acceptanceOwnerId);if(!valid)fail('验收人必须是有有效账号的当前项目成员');}
  if(value.ownerId&&!sqlite.prepare("SELECT 1 FROM project_people pp JOIN people p ON p.id=pp.person_id JOIN accounts a ON a.person_id=p.id AND a.status='active' AND a.deleted_at IS NULL WHERE pp.project_id=? AND p.id=? AND pp.project_role IN ('member','manager') AND p.active=1 AND p.deleted_at IS NULL").get(projectId,value.ownerId))fail('负责人必须是有效项目成员');
  if(current&&value.deliveryScope==='candidate'&&current.deliveryScope!=='candidate'&&['in_progress','blocked','pending_acceptance'].includes(current.status)&&!String(value.reason||'').trim())fail('撤出已执行需求时请填写原因');
  if(current&&value.ownerId===null&&current.actualStart)fail('需求已执行，不能清空负责人');
  for(const key of ['forecastEnd','unblockEstimate'])if(value[key]&&String(value[key])<todayIso())fail('预测日期不能早于今天');
}
export function assertRequirementAcceptor(id:string,actor:Actor){
  const auth=requireAuthorizationActor(actor),r=sqlite.prepare(`SELECT r.project_id AS projectId,r.acceptance_owner_id AS acceptanceOwnerId,
    EXISTS(SELECT 1 FROM project_people pp JOIN people p ON p.id=pp.person_id JOIN accounts a ON a.person_id=p.id WHERE pp.project_id=r.project_id AND pp.person_id=r.acceptance_owner_id AND pp.project_role IN ('manager','member') AND p.active=1 AND p.deleted_at IS NULL AND a.status='active' AND a.deleted_at IS NULL) AS acceptanceOwnerValid FROM requirements r WHERE r.id=? AND r.deleted_at IS NULL`).get(id) as {projectId:string;acceptanceOwnerId:string|null;acceptanceOwnerValid:boolean}|undefined;
  if(!r)notFound('需求不存在');
  if(canManageProject(auth,r.projectId))return;
  if(r.acceptanceOwnerId===auth.personId&&r.acceptanceOwnerValid)return;
  forbidden('只有指定验收人或项目经理可以验收和退回本需求');
}
function event(id:string,type:string,content:string,actor:Actor){
  const now=new Date().toISOString(),r=sqlite.prepare('SELECT progress FROM requirements WHERE id=?').get(id) as {progress:number};
  sqlite.prepare('INSERT INTO progress_updates(id,requirement_id,percent,content,event_type,created_by_account_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),id,r.progress,content,type,actor.accountId||null,now,now);
  recordAudit(actor,type,'requirement',id,content);
}
export function createDirectRequirement(raw:JsonObject,actor:Actor,deferNormalization=false){
  const v=normalizeRequirementText(createRequirementInputSchema.parse(raw)),auth=requireAuthorizationActor(actor);requireActiveProject(v.projectId);
  assertProjectManager(auth,v.projectId);validateDeliveryFields(v.projectId,v,actor);
  if(v.templateId)fail('直接执行不能同时使用流程；请选择工作项分解');
  const id=randomUUID(),now=new Date().toISOString();
  let start=v.plannedStart||null,end=v.plannedEnd||null;
  for(const d of [start,end])if(d&&businessDaysInclusive(d,d)!==1)fail('计划日期必须是工作日');
  if(v.durationDays){if(start)end=addBusinessDays(start,v.durationDays-1);else if(end)start=addBusinessDays(end,1-v.durationDays);}
  sqlite.transaction(()=>{
    requireActiveProject(v.projectId);assertProjectManager(requireAuthorizationActor(actor),v.projectId);
    sqlite.prepare(`INSERT INTO requirements(id,project_id,title,owner_id,background,acceptance_criteria,reference_url,status,progress,priority,delivery_scope,execution_mode,acceptance_owner_id,planned_start,planned_end,duration_days,forecast_end,unblock_estimate,dependencies_reviewed_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'not_started',0,?,?,'direct',?,?,?,?,?,?,?,?,?)`).run(id,v.projectId,v.title,v.ownerId||null,v.background||null,v.acceptanceCriteria||null,v.referenceUrl||null,v.priority,v.deliveryScope||'committed',v.acceptanceOwnerId||null,start,end,v.durationDays||null,v.forecastEnd||null,v.unblockEstimate||null,now,now,now);
    sqlite.prepare('UPDATE requirements SET schedule_anchor=? WHERE id=?').run(start,id);
    if(v.forecastEnd&&!deferNormalization)refreshDirectForecast(id);
    recordAudit(actor,'create','requirement',id,'创建直接执行需求：'+v.title);
  }).immediate();
  return getRequirement(id,false,!deferNormalization);
}
export function updateDeliveryRequirement(id:string,raw:JsonObject,actor:Actor,split=false,deferNormalization=false){
  const value=normalizeRequirementText(updateRequirementInputSchema.parse(raw)),r=getRequirement(id,false,!deferNormalization),auth=requireAuthorizationActor(actor);
  if(isCoordinationEdit(value))assertCoordinationAccess('requirement',id,value,actor);else assertRequirementOwnerOrManager(auth,id);assertExpectedVersion(value,r.version);
  if(['completed','cancelled'].includes(r.status))fail('已结束需求不能编辑');
  validateDeliveryFields(r.projectId,value,actor,r);
  requireActiveProject(r.projectId);
  const nextMode=value.executionMode||r.executionMode;
  if(nextMode!==r.executionMode){
    if(nextMode==='direct'&&(r.workItems?.length||r.actualStart||r.splitAt))fail('有工作项或执行历史的需求不能切回直接执行');
    if(nextMode==='work_items'&&r.executionMode==='direct'&&!split)fail('请通过拆分预览和整批保存建立剩余工作项');
    if(['blocked','pending_acceptance'].includes(r.status))fail('请先解除阻塞或返工，再拆分需求');
  }
  const coordinationChanged=coordinationKeys.some(k=>value[k]!==undefined);if(coordinationChanged){if(r.status!=='blocked')fail('只有阻塞对象可以修改协调信息');Object.assign(value,validateCoordination(r.projectId,{...r,...value}));}
  const columns={blockedCoordinatorId:'blocked_coordinator_id',blockedNextReviewAt:'blocked_next_review_at',blockedIssueId:'blocked_issue_id',...deliveryColumns,title:'title',ownerId:'owner_id',background:'background',acceptanceCriteria:'acceptance_criteria',referenceUrl:'reference_url',priority:'priority'};
  const changes=Object.entries(value).filter(([k])=>k in columns),now=new Date().toISOString();
  if(!changes.length)fail('没有需要保存的修改');
  sqlite.transaction(()=>{
    requireActiveProject(r.projectId);validateDeliveryFields(r.projectId,value,actor,r);
    const setters=changes.map(([k])=>columns[k as keyof typeof columns]+'=?');
    const extra=split&&r.executionMode==='direct'&&nextMode==='work_items'?',split_base_progress=?,split_at=?':'';
    const updated=sqlite.prepare('UPDATE requirements SET '+setters.join(',')+extra+',version=version+1,updated_at=? WHERE id=? AND version=?').run(...changes.map(([,v])=>v??null),...(extra?[Math.min(99,r.progress),now]:[]),now,id,r.version);
    assertVersionedWrite(updated,'需求');
    if(coordinationChanged)persistCoordination('requirement',id,r.projectId,value,actor);
    if(value.forecastEnd!==undefined&&!split&&!deferNormalization)refreshDirectForecast(id);
    if(extra)event(id,'split','拆分剩余工作；已完成基线 '+r.progress+'%。'+(value.reason||''),actor);
    else recordAudit(actor,'update','requirement',id,'修改需求：'+r.title+(value.reason?'；'+value.reason:''));
  }).immediate();
  return getRequirement(id,false,!deferNormalization);
}
export function directStartConditions(id:string){
  const r=getRequirement(id),snapshot=loadPathInput(r.projectId),analysis=analysePaths(snapshot),own=snapshot.requirements.find(x=>x.id===id)!;
  const unmet=snapshot.dependencies.filter(e=>e.targetRequirementId===id&&!e.targetWorkItemId&&!e.targetMilestoneId&&!own.acknowledgedDependencies?.includes(e.id)&&!analysis.nodes.find(n=>n.id===dependencySource(e))?.complete);
  return {dependencyRevision:snapshot.revision,unmetPredecessors:unmet.map(e=>({id:e.id,title:analysis.nodes.find(n=>n.id===dependencySource(e))?.title||'前置交付'}))};
}
export function executeDirectRequirement(id:string,action:'start'|'progress'|'block'|'unblock'|'submit-acceptance'|'rework',raw:JsonObject,actor:Actor){
  const input=directRequirementCommandSchema.parse(raw),auth=requireAuthorizationActor(actor);
  return sqlite.transaction(()=>{
    if(action!=='block'&&coordinationKeys.some(k=>input[k]!==undefined))fail('只有阻塞命令可以同时设置协调信息');
    const r=getRequirement(id);requireActiveProject(r.projectId);assertExpectedVersion(input,r.version);
    if(r.executionMode!=='direct')fail('此需求通过工作项推进，请操作对应工作项');
    if(action==='rework')assertRequirementAcceptor(id,actor);else assertRequirementOwnerOrManager(auth,id);
    const allowed={start:['not_started'],progress:['in_progress'],block:['in_progress'],unblock:['blocked'],'submit-acceptance':['in_progress'],rework:['pending_acceptance','completed']};
    if(!allowed[action].includes(r.status))fail('当前状态不能执行此操作','INVALID_TRANSITION');
    const now=new Date().toISOString(),today=todayIso();let sets='',args:unknown[]=[];
    let content=input.content||input.reason||({start:'开始需求',unblock:'解除阻塞'} as Record<string,string>)[action]||'';
    if(action==='start'){
      if(r.deliveryScope==='candidate')fail('请项目经理先将需求纳入交付');
      if(!r.ownerId)fail('开始前请指定需求负责人');validateDeliveryFields(r.projectId,{ownerId:r.ownerId},actor,r);
      const conditions=directStartConditions(id);
      if(input.expectedDependencyRevision!==undefined&&input.expectedDependencyRevision!==conditions.dependencyRevision)fail('前置条件已经变化，请重新核对','STALE_WRITE',409);
      if(conditions.unmetPredecessors.length){
        if(input.expectedDependencyRevision!==conditions.dependencyRevision)fail('前置尚未完成，请确认可以开始','DEPENDENCY_CONFLICT',409,conditions);
        const old=(sqlite.prepare('SELECT acknowledged_dependencies AS ids FROM requirements WHERE id=?').get(id) as {ids:string}).ids;
        sqlite.prepare('UPDATE requirements SET acknowledged_dependencies=? WHERE id=?').run(JSON.stringify([...new Set([...JSON.parse(old),...conditions.unmetPredecessors.map(x=>x.id)])]),id);
        content+='；提前开始，未满足前置：'+conditions.unmetPredecessors.map(x=>x.title).join('、');
      }
      sets="status='in_progress',actual_start=?";args=[today];
    }else if(action==='progress'){
      if(input.progress===undefined)fail('请填写需求进度');
      if(input.progress<r.progress)fail('普通进展不能降低完成度，请由项目经理执行纠错');
      content=requireText(content,'进展说明');sets='progress=?';args=[input.progress];
    }
    else if(action==='block'){content=requireText(content,'阻塞原因');sets="status='blocked',blocked_at=?,blocked_reason=?";args=[now,content];}
    else if(action==='unblock'){sets="status='in_progress',blocked_at=NULL,blocked_reason=NULL";}
    else if(action==='submit-acceptance'){content=requireText(content,'交付说明');sets="status='pending_acceptance',progress=100,actual_end=?";args=[today];}
    else{content=requireText(content,'返工原因')+'；原验收日期：'+(r.acceptedAt||'尚未验收');preserveRecordedAcceptance(id);sets="status='in_progress',progress=?,actual_end=NULL,accepted_at=NULL,accepted_by_account_id=NULL";args=[input.progress??99];}
    if(['block','unblock'].includes(action)&&r.forecastDuration&&r.forecastReadyAt){
      const effort=action==='block'?Math.max(1,r.forecastDuration-Math.max(0,businessDayDelta(r.forecastReadyAt,today))):r.forecastDuration;
      sqlite.prepare('UPDATE requirements SET forecast_duration=?,forecast_ready_at=? WHERE id=?').run(effort,today,id);
    }
    const updated=sqlite.prepare('UPDATE requirements SET '+sets+',version=version+1,updated_at=? WHERE id=? AND version=?').run(...args,now,id,r.version);
    assertVersionedWrite(updated,'需求');if(action==='rework')invalidateForecastReview('requirement',id);if(action==='block'){const v=validateCoordination(r.projectId,input);persistCoordination('requirement',id,r.projectId,v,actor);}event(id,action,content,actor);settleMilestones(r.projectId,actor);
    return getRequirement(id);
  }).immediate();
}

export function returnRequirement(id:string,input:JsonObject,actor:Actor){
  const r=getRequirement(id);if(r.executionMode==='direct')return executeDirectRequirement(id,'rework',input,actor);
  requireActiveProject(r.projectId);assertRequirementAcceptor(id,actor);assertExpectedVersion(input,r.version);
  if(!['pending_acceptance','completed'].includes(r.status))fail('当前需求不能退回');
  const reason=requireText(input.reason,'退回原因'),ids=Array.isArray(input.workItemIds)?input.workItemIds.map(String):[];
  if(!ids.length||ids.some(id=>!r.workItems?.some(w=>w.id===id&&w.status==='completed')))fail('请选择需要返工的已完成工作项');
  sqlite.transaction(()=>{
    requireActiveProject(r.projectId);
    preserveRecordedAcceptance(id);
    for(const wid of new Set(ids))sqlite.prepare("UPDATE work_items SET status=CASE WHEN actual_start IS NULL THEN 'not_started' ELSE 'in_progress' END,progress=CASE WHEN actual_start IS NULL THEN 0 ELSE 99 END,actual_end=NULL,version=version+1,updated_at=? WHERE id=?").run(new Date().toISOString(),wid);
    const updated=sqlite.prepare("UPDATE requirements SET status='in_progress',progress=99,accepted_at=NULL,accepted_by_account_id=NULL,version=version+1,updated_at=? WHERE id=? AND version=?").run(new Date().toISOString(),id,r.version);
    assertVersionedWrite(updated,'需求');for(const wid of new Set(ids))invalidateForecastReview('work',wid);assertRequirementAcceptor(id,actor);
    event(id,'rework',reason+'；返工项：'+ids.join('、')+'；原验收日期：'+(r.acceptedAt||'尚未验收'),actor);
  }).immediate();return getRequirement(id);
}

export function rescheduleDirectRequirement(id:string,raw:JsonObject,actor:Actor){
  const value=rescheduleRequirementInputSchema.parse(raw);
  return sqlite.transaction(()=>{
    const r=getRequirement(id);requireActiveProject(r.projectId);assertProjectManager(requireAuthorizationActor(actor),r.projectId);assertExpectedVersion(value,r.version);
    if(['completed','cancelled'].includes(r.status))fail('已结束需求不能重新排期');
    const reason=r.actualStart?requireText(value.reason,'变更原因'):value.reason||'调整计划日期';
    const duration=r.durationDays||(r.plannedStart&&r.plannedEnd?businessDaysInclusive(r.plannedStart,r.plannedEnd):null);
    const start=value.plannedStart||(value.plannedEnd&&duration?addBusinessDays(value.plannedEnd,1-duration):null);
    const end=value.plannedEnd||(value.plannedStart&&duration?addBusinessDays(value.plannedStart,duration-1):null);
    for(const d of [start,end])if(d&&businessDaysInclusive(d,d)!==1)fail('计划日期必须是工作日');
    const updated=sqlite.prepare('UPDATE requirements SET planned_start=?,planned_end=?,schedule_anchor=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(start,end,start,new Date().toISOString(),id,r.version);
    assertVersionedWrite(updated,'需求');event(id,'reschedule',reason+'；计划 '+(start||'待定')+' 至 '+(end||'待定'),actor);
    return getRequirement(id);
  }).immediate();
}
