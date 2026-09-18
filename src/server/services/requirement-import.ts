import { ensureOtherFeature } from '../other-feature';
import { saveFeature } from './features';
import { readFeaturePhases } from './feature-phases';
import { createHash, randomUUID } from 'node:crypto';
import { getDatabaseContext } from '../database-context';
import type { Actor } from '../auth';
import { assertProjectManager, assertProjectReadable, requireAuthorizationActor } from '../authorization';
import { fail, notFound } from '../errors';
import { requireActiveProject } from './support';
import { recordAudit } from './audit';
import { previewDependencyChanges, applyDependencyChanges } from './path-changes';
import { intakeRevision, persistOrganization } from './intake-metadata';
import { importPreviewInput, importApplyInput, type IntakePackage, type ImportPreview, type ImportReceipt } from '../../shared/intake';
import { maxDependencyEntityChanges, type DependencyChangesInput } from '../../shared/path-contracts';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ref=(...parts:string[])=>JSON.stringify(parts);
const entityId=(requirement:string,work?:string)=>'intake:'+ref(requirement,...work?[work]:[]);
type ExistingRequirement={id:string;title:string;status:string;version:number;featureId:string|null;phaseId:string|null;deletedAt:string|null};

function prepare(projectId:string,pkg:IntakePackage,actor:Actor) {
  assertProjectManager(requireAuthorizationActor(actor),projectId);requireActiveProject(projectId);
  const revision=intakeRevision(projectId),warnings:string[]=[],errors:string[]=[],existingMatches:ImportPreview['existingMatches']=[];
  const rows=getDatabaseContext().sqlite.prepare('SELECT feature_id AS featureId,phase_id AS phaseId,id,title,status,version,deleted_at AS deletedAt FROM requirements WHERE project_id=?').all(projectId) as ExistingRequirement[];
  const existing=new Map(rows.map(r=>[r.id,r])),requirements=new Map(pkg.requirements.map(r=>[r.key,r]));
  if(requirements.size!==pkg.requirements.length)errors.push('需求标识重复');
  const changes:DependencyChangesInput={expectedRevision:Number(revision),target:'project',changes:{add:[],remove:[],estimates:[],entities:[]}};
  const phases=readFeaturePhases(projectId),features=getDatabaseContext().sqlite.prepare('SELECT id,name,kind,archived_at AS archivedAt FROM features WHERE project_id=?').all(projectId) as Array<{id:string;name:string;kind:string;archivedAt:string|null}>;
  for(const r of pkg.requirements){
    if(r.action==='skip')continue;
    const old=r.existingId?existing.get(r.existingId):undefined,feature=r.feature===undefined?features.find(f=>f.id===old?.featureId):features.find(f=>['其他特性','其他需求'].includes(r.feature||'')?f.kind==='other':f.name===r.feature);
    if(feature?.archivedAt)errors.push(r.title+'：特性已归档');
    if(r.phase&&!r.feature&&!(r.feature===undefined&&feature))errors.push(r.title+'：指定 Phase 时必须关联特性');
    const destination=r.phase?phases.find(p=>p.featureId===feature?.id&&p.name===r.phase):r.phase===null||r.feature!==undefined&&feature?.id!==old?.featureId?undefined:phases.find(p=>p.id===old?.phaseId);
    if(r.phase&&!destination&&(feature?.kind==='other'||['其他特性','其他需求'].includes(r.feature||'')))errors.push(r.title+'：其他需求不能新建 Phase');
    const previous=phases.find(p=>p.id===old?.phaseId);
    if((destination?.id!==old?.phaseId||!!r.phase&&!destination)&&(destination?.startedAt||previous?.startedAt)&&!r.reason)errors.push(r.title+'：推进后的需求移入移出需要填写原因');
    // Undefined keys disappear on the wire but otherwise reach SQL as NULL.
    // Keep the preview, update dispatch and commit limited to supplied fields.
    const data=Object.fromEntries(Object.entries({...r.action==='create'&&feature?{featureId:feature.id}:{},reason:r.reason,title:r.title,background:r.background,acceptanceCriteria:r.acceptanceCriteria,referenceUrl:r.referenceUrl,referenceLinks:r.referenceLinks,ownerId:r.ownerId,plannedStart:r.plannedStart,plannedEnd:r.plannedEnd,durationDays:r.durationDays}).filter(([,value])=>value!==undefined));
    if(r.action==='update'){
      const old=r.existingId?existing.get(r.existingId):undefined;
      if(!old||old.deletedAt){errors.push(r.title+'：请选择当前项目未归档的已有需求');continue;}
      if(r.expectedVersion!==old.version)errors.push(r.title+'：已有需求版本变化，请重新读取后核对');
      if(['completed','cancelled'].includes(old.status))errors.push(r.title+'：已结束需求请在详情中纠错');
      if(r.workItems.length)errors.push(r.title+'：更新需求说明时不新增工作项，请在详情中添加');
      changes.changes.entities!.push({entity:'requirement',op:'update',id:old.id,expectedVersion:r.expectedVersion,data});
    }else{
      if(r.existingId)errors.push(r.title+'：新建需求不能指定已有需求');
      const matches=rows.filter(old=>!old.deletedAt&&old.title.trim()===r.title.trim());
      for(const old of matches)existingMatches.push({requirement:r.key,id:old.id,title:old.title});
      if(matches.length&&!r.confirmAdditional)errors.push(r.title+'：已有同名需求，请选择更新或确认另建');
      if(new Set(r.workItems.map(w=>w.key)).size!==r.workItems.length)errors.push(r.title+'：工作项标识重复');
      changes.changes.entities!.push({entity:'requirement',op:'create',id:entityId(r.key),data});
      for(const w of r.workItems)changes.changes.entities!.push({entity:'work',op:'create',id:entityId(r.key,w.key),requirementId:entityId(r.key),data:{title:w.title,referenceLinks:w.referenceLinks,workStage:w.workStage,ownerId:w.ownerId,plannedStart:w.plannedStart,plannedEnd:w.plannedEnd,durationDays:w.durationDays??null}});
    }
    if(!r.ownerId&&r.action==='create')warnings.push(r.title+'：未分配负责人');
    if(!r.plannedStart||!r.plannedEnd)warnings.push(r.title+'：计划日期尚未补齐');
  }
  const endpoint=(rKey:string,work?:string)=>{
    const r=requirements.get(rKey);
    if(!r||r.action==='skip'){errors.push('依赖引用了不存在或已跳过的需求：'+rKey);return null;}
    const requirementId=r.action==='update'?r.existingId:entityId(r.key);
    if(!requirementId)return null;
    if(work){
      if(r.action==='create'&&!r.workItems.some(w=>w.key===work)){errors.push(r.title+'：找不到工作项 '+work);return null;}
      if(r.action==='update'&&!getDatabaseContext().sqlite.prepare('SELECT 1 FROM work_items WHERE id=? AND requirement_id=?').get(work,requirementId)){errors.push(r.title+'：工作项不属于已有需求');return null;}
    }
    return {requirementId,workItemId:work?(r.action==='update'?work:entityId(r.key,work)):null};
  };
  for(const [i,d] of pkg.dependencies.entries()){
    if(requirements.get(d.source.requirement)?.action==='skip'||requirements.get(d.target.requirement)?.action==='skip'){warnings.push('已跳过需求的依赖未导入');continue;}
    const source=endpoint(d.source.requirement,d.source.workItem),target=endpoint(d.target.requirement,d.target.workItem);
    if(source&&target){
      const exists=getDatabaseContext().sqlite.prepare('SELECT 1 FROM dependency_edges WHERE project_id=? AND source_requirement_id=? AND source_work_item_id IS ? AND target_requirement_id=? AND target_work_item_id IS ? AND source_milestone_id IS NULL AND target_milestone_id IS NULL').get(projectId,source.requirementId,source.workItemId,target.requirementId,target.workItemId);
      if(!exists)changes.changes.add.push({clientId:'intake:edge:'+i,sourceRequirementId:source.requirementId,sourceWorkItemId:source.workItemId,targetRequirementId:target.requirementId,targetWorkItemId:target.workItemId});
    }
  }
  let core:ReturnType<typeof previewDependencyChanges>|null=null;
  if(changes.changes.entities!.length>maxDependencyEntityChanges)errors.push(`本批有${changes.changes.entities!.length}个需求和工作项，超过单次${maxDependencyEntityChanges}个的上限，请分批导入`);
  if(!errors.length&&(changes.changes.entities!.length||changes.changes.add.length)){
    try{core=previewDependencyChanges(projectId,changes,actor);}catch(error){errors.push(error instanceof Error?error.message:'无法预览需求');}
  }
  if(!pkg.requirements.some(r=>r.action!=='skip'))errors.push('没有选择要导入的需求');
  const preview:ImportPreview={expectedRevision:revision,previewToken:hash({projectId,pkg,revision,core:core?.previewToken}),package:pkg,warnings:[...new Set(warnings)],errors:[...new Set(errors)],existingMatches,differences:core?.differences||null,counts:{requirements:pkg.requirements.filter(r=>r.action==='create').length,updated:pkg.requirements.filter(r=>r.action==='update').length,workItems:pkg.requirements.filter(r=>r.action==='create').reduce((n,r)=>n+r.workItems.length,0)}};
  return {preview,changes,core};
}
export function previewRequirementImport(projectId:string,raw:unknown,actor:Actor):ImportPreview {
  const input=importPreviewInput.parse(raw);
  return getDatabaseContext().sqlite.transaction(()=>prepare(projectId,input.package,actor).preview)();
}
type ReceiptRow={project_id:string;actor_id:string;content_hash:string;result:string};
const actorKey=(actor:Actor)=>actor.accountId||actor.id;
export function getRequirementImportReceipt(projectId:string,batchId:string,actor:Actor):ImportReceipt {
  assertProjectReadable(requireAuthorizationActor(actor),projectId);
  const row=getDatabaseContext().sqlite.prepare('SELECT * FROM requirement_import_receipts WHERE batch_id=?').get(batchId) as ReceiptRow|undefined;
  if(!row)return {status:'not_found'};
  if(row.project_id!==projectId||row.actor_id!==actorKey(actor))notFound('提交回执不存在');
  return JSON.parse(row.result);
}
export function applyRequirementImport(projectId:string,raw:unknown,actor:Actor):ImportReceipt {
  const input=importApplyInput.parse(raw),contentHash=hash(input.package);
  return getDatabaseContext().sqlite.transaction(()=>{
    assertProjectManager(requireAuthorizationActor(actor),projectId);requireActiveProject(projectId);
    const old=getDatabaseContext().sqlite.prepare('SELECT * FROM requirement_import_receipts WHERE batch_id=?').get(input.batchId) as ReceiptRow|undefined;
    if(old){if(old.project_id!==projectId||old.actor_id!==actorKey(actor))notFound('提交回执不存在');if(old.content_hash!==contentHash)fail('批次标识已用于另一份导入内容','DEPENDENCY_CONFLICT',409);return JSON.parse(old.result) as ImportReceipt;}
    if(intakeRevision(projectId)!==input.expectedRevision)fail('项目资料已变化，请重新预览','STALE_WRITE',409);
    const prepared=prepare(projectId,input.package,actor);
    if(prepared.preview.errors.length)fail(prepared.preview.errors.join('；'));
    if(prepared.preview.previewToken!==input.previewToken)fail('预览已变化，请重新核对','STALE_WRITE',409);
    // Resolve names inside this transaction before core creation so a named
    // import never depends on the state of the default Other feature.
    for(const r of input.package.requirements)if(r.action!=='skip'&&r.feature&&!['其他特性','其他需求'].includes(r.feature)&&!getDatabaseContext().sqlite.prepare('SELECT 1 FROM features WHERE project_id=? AND name=?').get(projectId,r.feature)){
      const order=getDatabaseContext().sqlite.prepare('SELECT COUNT(*) AS n FROM features WHERE project_id=? AND archived_at IS NULL').get(projectId) as {n:number};
      saveFeature(projectId,{name:r.feature,sortOrder:order.n},actor);
    }
    const resolved=prepare(projectId,input.package,actor);
    if(resolved.preview.errors.length)fail(resolved.preview.errors.join('；'));
    const created=resolved.core?applyDependencyChanges(projectId,{...resolved.changes,batchId:input.batchId,previewToken:resolved.core.previewToken},actor).addedIds:{};
    const requirementIds:Record<string,string>=Object.create(null);
    for(const r of input.package.requirements){
      if(r.action==='skip')continue;
      const id=r.action==='update'?r.existingId!:created[entityId(r.key)];requirementIds[r.key]=id;
      if(r.action==='create'||r.feature!==undefined||r.phase!==undefined){
        let featureId:string|null=r.action==='update'&&r.feature===undefined?(getDatabaseContext().sqlite.prepare('SELECT feature_id AS id FROM requirements WHERE id=?').get(id) as {id:string|null}).id:null;
        if(r.feature&&['其他特性','其他需求'].includes(r.feature))featureId=ensureOtherFeature(getDatabaseContext().sqlite,projectId);
        else if(r.feature){
          const oldFeature=getDatabaseContext().sqlite.prepare('SELECT id FROM features WHERE project_id=? AND name=?').get(projectId,r.feature) as {id:string}|undefined;
          featureId=oldFeature?.id||randomUUID();
          if(!oldFeature){const now=new Date().toISOString();getDatabaseContext().sqlite.prepare('INSERT INTO features(id,project_id,name,sort_order,created_at,updated_at) VALUES(?,?,?,(SELECT count(*) FROM features WHERE project_id=?),?,?)').run(featureId,projectId,r.feature,projectId,now,now);}
        }
        let phaseId:string|null|undefined;
        if(r.phase){if(!featureId)fail('指定 Phase 时必须同时指定特性');const p=getDatabaseContext().sqlite.prepare('SELECT id FROM feature_phases WHERE feature_id=? AND name=?').get(featureId,r.phase) as {id:string}|undefined;phaseId=p?.id||randomUUID();if(!p){if(getDatabaseContext().sqlite.prepare("SELECT 1 FROM features WHERE id=? AND kind='other'").get(featureId))fail('其他需求不能新建 Phase');const now=new Date().toISOString();getDatabaseContext().sqlite.prepare('INSERT INTO feature_phases(id,project_id,feature_id,name,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(phaseId,projectId,featureId,r.phase,now,now);}}
        else if(r.phase===null)phaseId=null;
        const before=getDatabaseContext().sqlite.prepare('SELECT feature_id AS featureId,phase_id AS phaseId FROM requirements WHERE id=?').get(id);
        persistOrganization(id,projectId,{featureId,phaseId,reason:r.reason});
        const after=getDatabaseContext().sqlite.prepare('SELECT feature_id AS featureId,phase_id AS phaseId FROM requirements WHERE id=?').get(id);if(JSON.stringify(before)!==JSON.stringify(after))recordAudit(actor,'update','requirement',id,'导入调整归属：'+JSON.stringify({before,after,reason:r.reason}),projectId);
      }
    }
    const result:ImportReceipt={status:'applied',batchId:input.batchId,createdAt:new Date().toISOString(),requirementIds};
    getDatabaseContext().sqlite.prepare('INSERT INTO requirement_import_receipts(batch_id,project_id,actor_id,content_hash,result,created_at) VALUES(?,?,?,?,?,?)').run(input.batchId,projectId,actorKey(actor),contentHash,JSON.stringify(result),result.createdAt);
    recordAudit(actor,'import','project',projectId,'导入需求：'+prepared.preview.counts.requirements+' 个新需求');
    return result;
  }).immediate();
}
