import { compareCommitments, requirementCommitments, type DeliveryCommitment } from '../../shared/commitments';
import { optionalDateSchema } from '../../shared/contracts';
import { businessDateFromDateTime, todayIso } from '../../shared/domain';
import type { PathInput } from '../../shared/paths';
import type { Actor } from '../auth';
import { assertProjectManager, assertProjectReadable, requireAuthorizationActor } from '../authorization';
import { getDatabaseContext } from '../database-context';
import { fail, notFound } from '../errors';
import { loadAcceptanceHistory } from './acceptance-history';

export function loadCommitments(projectId:string):DeliveryCommitment[] {
  return (getDatabaseContext().sqlite.prepare('SELECT snapshot FROM delivery_commitments WHERE project_id=? ORDER BY confirmed_at,rowid').all(projectId) as {snapshot:string}[]).map(r=>JSON.parse(r.snapshot));
}
export function loadLatestCommitment(projectId:string):DeliveryCommitment|undefined {
  const row=getDatabaseContext().sqlite.prepare('SELECT snapshot FROM delivery_commitments WHERE project_id=? ORDER BY confirmed_at DESC,rowid DESC LIMIT 1').get(projectId) as {snapshot:string}|undefined;
  return row?JSON.parse(row.snapshot):undefined;
}
export function listDeliveryCommitments(projectId:string,actor:Actor) {
  assertProjectReadable(requireAuthorizationActor(actor),projectId);
  return loadCommitments(projectId).reverse();
}
export function getDeliveryCommitment(projectId:string,id:string,actor:Actor) {
  const history=listDeliveryCommitments(projectId,actor).reverse(),index=history.findIndex(c=>c.id===id);
  if(index<0)notFound('交付承诺不存在');
  return {...history[index],previousTargetDate:history[index-1]?.targetDate||null,differences:compareCommitments(history[index-1]||null,history[index])};
}
export function prepareCommitment(snapshot:PathInput,change:{reason:string;milestoneId?:string|null},actor:Actor) {
  assertProjectManager(requireAuthorizationActor(actor),snapshot.projectId);
  const previous=loadLatestCommitment(snapshot.projectId)||null;
  if(previous&&!change.reason.trim())fail('再次确认交付承诺时请填写变更说明');
  const milestone=change.milestoneId?snapshot.milestones?.find(m=>m.id===change.milestoneId&&!m.requirementId&&!m.cancelled):null;
  if(change.milestoneId&&!milestone)fail('请选择当前项目的有效项目里程碑');
  const value:DeliveryCommitment={id:'preview',projectId:snapshot.projectId,projectName:snapshot.projectName,targetDate:snapshot.projectEnd,
    milestoneId:milestone?.id||null,milestoneTitle:milestone?.title||null,reason:change.reason.trim(),confirmedAt:new Date().toISOString(),confirmedBy:actor.accountId||actor.id,confirmedName:actor.label,
    items:[...snapshot.requirements.filter(r=>!r.deletedAt&&r.deliveryScope!=='candidate'&&!['completed','cancelled'].includes(r.status)).map(r=>({id:r.id,kind:'requirement' as const,title:r.title,targetDate:r.plannedEnd,acceptanceCriteria:r.acceptanceCriteria||null})),
      ...(snapshot.milestones||[]).filter(m=>!m.requirementId&&!m.cancelled&&!m.achievedAt).map(m=>({id:m.id,kind:'milestone' as const,title:m.title,targetDate:m.targetDate,acceptanceCriteria:null}))]};
  const included=new Set(value.items.map(i=>i.id));
  value.departures=(previous?.items||[]).filter(i=>!included.has(i.id)).map(i=>{
    const r=i.kind==='requirement'?snapshot.requirements.find(r=>r.id===i.id):null;
    const m=i.kind==='milestone'?snapshot.milestones?.find(m=>m.id===i.id):null;
    return {...i,outcome:r?.status==='completed'&&r.acceptedAt||m?.achievedAt?'delivered':r?.status==='cancelled'||m?.cancelled?'cancelled':'removed'};
  });
  return {value,differences:compareCommitments(previous,value),previousTargetDate:previous?.targetDate||null};
}
export function persistCommitment(value:DeliveryCommitment,id:string,mapping:Record<string,string>,now:string) {
  const saved={...value,id,confirmedAt:now,milestoneId:value.milestoneId?mapping[value.milestoneId]||value.milestoneId:null,items:value.items.map(i=>({...i,id:mapping[i.id]||i.id})),departures:value.departures?.map(i=>({...i,id:mapping[i.id]||i.id}))};
  getDatabaseContext().sqlite.prepare('INSERT INTO delivery_commitments(id,project_id,confirmed_at,snapshot) VALUES (?,?,?,?)').run(id,value.projectId,now,JSON.stringify(saved));
  return saved;
}
export function deliveryCommitmentSummary(projectId:string,actor:Actor,from?:string,to?:string) {
  assertProjectReadable(requireAuthorizationActor(actor),projectId);
  optionalDateSchema.parse(from);optionalDateSchema.parse(to);if(from&&to&&from>to)fail('统计开始日期不能晚于结束日期');
  const history=loadCommitments(projectId),today=todayIso();
  const requirements=getDatabaseContext().sqlite.prepare('SELECT id,status,delivery_scope AS deliveryScope,accepted_at AS acceptedAt,deleted_at AS deletedAt FROM requirements WHERE project_id=?').all(projectId) as {id:string;status:string;deliveryScope:string;acceptedAt:string|null;deletedAt:string|null}[];
  const records=loadAcceptanceHistory(projectId),firstAcceptance=new Map<string,string>();
  const inPeriod=(at:string)=>{const date=businessDateFromDateTime(at);return (!from||date>=from)&&(!to||date<=to);};
  const result={first:{sampleCount:0,onTimeCount:0,rate:null as number|null},latest:{sampleCount:0,onTimeCount:0,rate:null as number|null},acceptedCount:0,withoutCommitment:0,missingFirstDate:0,overdueOpen:0,withdrawnOrCancelled:0,reworkCount:0,reacceptedCount:0};
  for(const event of records){
    if(event.eventType==='accept'){if(!firstAcceptance.has(event.requirementId))firstAcceptance.set(event.requirementId,event.occurredAt);else if(inPeriod(event.occurredAt))result.reacceptedCount++;}
    else if(inPeriod(event.occurredAt))result.reworkCount++;
  }
  for(const r of requirements){
    const acceptedAt=firstAcceptance.get(r.id)||r.acceptedAt,c=requirementCommitments(history,r.id,acceptedAt);
    if(c.first&&(r.deliveryScope==='candidate'||r.status==='cancelled'))result.withdrawnOrCancelled++;
    if(!r.deletedAt&&c.first?.targetDate&&c.first.targetDate<today&&!['completed','cancelled'].includes(r.status)&&r.deliveryScope!=='candidate')result.overdueOpen++;
    const accepted=acceptedAt?businessDateFromDateTime(acceptedAt):null;if(!acceptedAt||!accepted||!inPeriod(acceptedAt))continue;
    result.acceptedCount++;if(!c.first)result.withoutCommitment++;else if(!c.first.targetDate)result.missingFirstDate++;
    for(const key of ['first','latest'] as const){const date=c[key]?.targetDate;if(!date)continue;result[key].sampleCount++;if(accepted<=date)result[key].onTimeCount++;}
  }
  for(const key of ['first','latest'] as const)if(result[key].sampleCount)result[key].rate=Math.round(result[key].onTimeCount/result[key].sampleCount*1000)/10;
  return {...result,asOfDate:today};
}
