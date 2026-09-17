import {sqlite} from '../database';
import type {Actor} from '../auth';
import {assertProjectManager,assertProjectReadable,assertRequirementOwnerOrManager,requireAuthorizationActor} from '../authorization';
import {fail,notFound} from '../errors';
import {recordAudit} from './audit';
import {loadPathInput,getPathAnalysis} from './paths';
import type {Dependency,PathInput} from '../../shared/paths';
import {reopenRequirementForMilestone} from '../services';
import {todayIso} from '../../shared/domain';
export function deliveredDate(input:PathInput,e:Dependency){
  if(e.sourceMilestoneId)return input.milestones?.find(m=>m.id===e.sourceMilestoneId&&!m.cancelled)?.achievedAt||null;
  if(e.sourceWorkItemId){const w=input.workItems.find(w=>w.id===e.sourceWorkItemId);return w?.status==='completed'?w.actualEnd:null;}
  const r=input.requirements.find(r=>r.id===e.sourceRequirementId);return r?.status==='completed'?r.acceptedAt:null;
}
/** Execution and graph-save callers already own a transaction. Reads never settle milestones. */
export function settleMilestones(projectId:string,actor:Actor){
  const input=loadPathInput(projectId),remaining=(input.milestones||[]).filter(m=>!m.achievedAt&&!m.cancelled&&m.confirmationMode==='auto'&&m.milestoneKind!=='test_submitted'&&(!m.requirementId||input.requirements.some(r=>r.id===m.requirementId&&!r.deletedAt&&r.status!=='cancelled')));
  const now=new Date().toISOString();let changed=true;
  while(changed){changed=false;for(const m of remaining){if(m.achievedAt)continue;const incoming=input.dependencies.filter(e=>e.targetMilestoneId===m.id),dates=incoming.map(e=>deliveredDate(input,e));if(!dates.length||dates.some(d=>!d))continue;m.achievedAt=(dates as string[]).sort().at(-1)!;
    sqlite.prepare('UPDATE milestones SET achieved_at=?,achieved_recorded_at=?,version=version+1,updated_at=? WHERE id=? AND achieved_at IS NULL').run(m.achievedAt,now,now,m.id);recordAudit(actor,'achieve','milestone',m.id,'里程碑达成：'+m.title+' · '+m.achievedAt,projectId);changed=true;}}
}
export function milestoneCommand(id:string,action:'achieve'|'reopen',raw:{expectedVersion:number},actor:Actor){
  return sqlite.transaction(()=>{
    const m=sqlite.prepare('SELECT milestone_kind AS milestoneKind,project_id AS projectId,requirement_id AS requirementId,version,title,achieved_at AS achievedAt FROM milestones WHERE id=?').get(id) as {milestoneKind:string;projectId:string;requirementId:string|null;version:number;title:string;achievedAt:string|null}|undefined;
    if(!m)notFound('里程碑不存在');const current=requireAuthorizationActor(actor);if(m.requirementId)assertRequirementOwnerOrManager(current,m.requirementId);else assertProjectManager(current,m.projectId);
    if(m.requirementId&&sqlite.prepare("SELECT 1 FROM requirements WHERE id=? AND (deleted_at IS NOT NULL OR status='cancelled')").get(m.requirementId))fail('已结束需求不能操作里程碑');
    if(action==='achieve'&&m.achievedAt||action==='reopen'&&!m.achievedAt)fail('里程碑状态不支持此操作');
    if(m.version!==raw.expectedVersion)fail('里程碑已更新','STALE_WRITE',409);
    if(m.milestoneKind==='test_submitted'&&action==='reopen')fail('提测记录保留为历史，需求返工后可记录新一轮提测');
    if(action==='achieve'){
      const input=loadPathInput(m.projectId);if(input.dependencies.filter(e=>e.targetMilestoneId===id).some(e=>!deliveredDate(input,e)))fail('里程碑前置尚未交付');
      sqlite.prepare('UPDATE milestones SET achieved_at=?,achieved_recorded_at=?,achieved_by=?,version=version+1,updated_at=? WHERE id=?').run(todayIso(),new Date().toISOString(),actor.accountId||null,new Date().toISOString(),id);
    }else sqlite.prepare("UPDATE milestones SET achieved_at=NULL,achieved_by=NULL,confirmation_mode='manual',version=version+1,updated_at=? WHERE id=?").run(new Date().toISOString(),id);
    if(action==='reopen'&&m.requirementId)reopenRequirementForMilestone(m.requirementId,m.title,actor);
    recordAudit(actor,action,'milestone',id,(action==='achieve'?'确认里程碑：':'重新打开里程碑：')+m.title+' · 原达成日 '+(m.achievedAt||'无'),m.projectId);settleMilestones(m.projectId,actor);return getPathAnalysis(m.projectId);
  }).immediate();
}
export function readDiagramLayouts(projectId:string,actor:Actor){assertProjectReadable(requireAuthorizationActor(actor),projectId);return loadPathInput(projectId).layouts||[];}
