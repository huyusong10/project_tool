import { createHash, randomUUID } from 'node:crypto';
import { sqlite } from '../database';
import type { Actor } from '../auth';
import { assertProjectManager, assertProjectReadable, requireAuthorizationActor } from '../authorization';
import { fail, notFound } from '../errors';
import { requireActiveProject } from './support';
import { recordAudit } from './audit';
import { previewDependencyChanges, applyDependencyChanges } from './path-changes';
import { readIntakeCatalog, intakeRevision, persistDocuments, persistLink, persistOrganization } from './intake-metadata';
import { importPreviewInput, importApplyInput, type IntakePackage, type ImportPreview, type ImportReceipt, type SourceClause } from '../../shared/intake';
import type { DependencyChangesInput } from '../../shared/path-contracts';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ref=(...parts:string[])=>JSON.stringify(parts);
const entityId=(requirement:string,work?:string)=>'intake:'+ref(requirement,...work?[work]:[]);
type ExistingRequirement={id:string;title:string;status:string;version:number;deletedAt:string|null};

function prepare(projectId:string,pkg:IntakePackage,actor:Actor) {
  assertProjectManager(requireAuthorizationActor(actor),projectId);requireActiveProject(projectId);
  const catalog=readIntakeCatalog(projectId,actor),warnings:string[]=[],errors:string[]=[],existingMatches:ImportPreview['existingMatches']=[],sourceChanges:ImportPreview['sourceChanges']=[];
  const sourceMap=new Map<string,{existing?:SourceClause;title:string;content:string}>();
  for(const d of catalog.documents)for(const c of d.clauses)sourceMap.set(ref(d.key,c.key),{existing:c,title:c.current.title,content:c.current.content});
  if(new Set(pkg.documents.map(d=>d.key)).size!==pkg.documents.length)errors.push('来源文档标识重复');
  for(const d of pkg.documents){
    if(new Set(d.clauses.map(c=>c.key)).size!==d.clauses.length)errors.push(d.title+'：条款标识重复');
    if(!d.complete)warnings.push(d.title+'：本次为选摘，仅统计已导入条款');
    const numbers=new Set<string>();
    for(const c of d.clauses){
      if(c.externalId&&numbers.has(c.externalId))warnings.push(d.title+'：原编号 '+c.externalId+' 重复，按条款标识区分');
      numbers.add(c.externalId);
      const previous=sourceMap.get(ref(d.key,c.key));
      if(previous?.existing){const current=previous.existing.current;warnings.push(d.title+' / '+c.title+'：复用已有条款');if((['section','externalId','title','content','priority'] as const).some(k=>current[k]!==c[k])){warnings.push(d.title+' / '+c.title+'：来源内容变化，已有落实范围将待核对');sourceChanges.push({document:d.title,clause:c.key,before:current,after:{documentVersion:d.version,section:c.section,externalId:c.externalId,title:c.title,content:c.content,priority:c.priority}});}}
      sourceMap.set(ref(d.key,c.key),{existing:previous?.existing,title:c.title,content:c.content});
      if(!pkg.links.some(l=>l.document===d.key&&l.clause===c.key&&pkg.requirements.some(r=>r.key===l.requirement&&r.action!=='skip'))&&!previous?.existing?.links.length&&!(c.deferredReason??previous?.existing?.deferredReason))warnings.push(d.title+' / '+c.title+'：尚未关联交付需求');
    }
  }
  if(new Set(pkg.requirements.map(r=>r.key)).size!==pkg.requirements.length)errors.push('交付需求标识重复');
  const rows=sqlite.prepare('SELECT id,title,status,version,deleted_at AS deletedAt FROM requirements WHERE project_id=?').all(projectId) as ExistingRequirement[];
  const existing=new Map(rows.map(r=>[r.id,r]));
  const requirements=new Map(pkg.requirements.map(r=>[r.key,r]));
  const changes:DependencyChangesInput={expectedRevision:Number(catalog.revision),target:'project',changes:{add:[],remove:[],estimates:[],entities:[]}};
  for(const r of pkg.requirements){
    if(r.action==='skip')continue;
    if(r.action==='link'){
      if(!r.existingId||!existing.has(r.existingId)||existing.get(r.existingId)!.deletedAt)errors.push(r.title+'：请选择当前项目未归档的已有需求');
      if(r.workItems.length)errors.push(r.title+'：关联已有需求时不新增工作项，请在需求详情调整');
    }else{
      if(r.existingId)errors.push(r.title+'：新增交付不能同时指定已有需求');
      if(!r.acceptanceCriteria)warnings.push(r.title+'：尚未填写验收条件');
      if(new Set(r.workItems.map(w=>w.key)).size!==r.workItems.length)errors.push(r.title+'：工作项标识重复');
      changes.changes.entities!.push({entity:'requirement',op:'create',id:entityId(r.key),data:{title:r.title,background:r.background,acceptanceCriteria:r.acceptanceCriteria,ownerId:r.ownerId,deliveryScope:r.deliveryScope,executionMode:r.workItems.length?'work_items':'direct'}});
      for(const w of r.workItems)changes.changes.entities!.push({entity:'work',op:'create',id:entityId(r.key,w.key),requirementId:entityId(r.key),data:{title:w.title,ownerId:w.ownerId,durationDays:w.durationDays??null}});
    }
    const matches=new Map<string,string>();
    for(const l of pkg.links.filter(l=>l.requirement===r.key))for(const linked of sourceMap.get(ref(l.document,l.clause))?.existing?.links||[])if(!linked.deletedAt)matches.set(linked.requirementId,linked.requirementTitle);
    for(const [id,title] of matches)existingMatches.push({requirement:r.key,id,title});
    if(r.action==='create'&&matches.size&&!r.confirmAdditional)errors.push(r.title+'：来源已关联交付，请选择关联已有需求，或明确新增另一份交付');
  }
  const endpoint=(rKey:string,work?:string)=>{
    const r=requirements.get(rKey);
    if(!r||r.action==='skip'){errors.push('引用了不存在或已跳过的交付：'+rKey);return null;}
    const requirementId=r.action==='link'?r.existingId:entityId(r.key);
    if(!requirementId)return null;
    if(work){
      if(r.action==='create'&&!r.workItems.some(w=>w.key===work)){errors.push(r.title+'：找不到工作项 '+work);return null;}
      if(r.action==='link'&&!sqlite.prepare('SELECT 1 FROM work_items WHERE id=? AND requirement_id=?').get(work,requirementId)){errors.push(r.title+'：工作项不属于已有需求');return null;}
    }
    return {requirementId,workItemId:work?(r.action==='link'?work:entityId(r.key,work)):null};
  };
  const linkKeys=new Set<string>();
  for(const l of pkg.links){
    const r=requirements.get(l.requirement);if(r?.action==='skip')continue;
    const target=endpoint(l.requirement,l.workItem),source=sourceMap.get(ref(l.document,l.clause));
    if(!source)errors.push('来源条款不存在：'+l.document+' / '+l.clause);
    const linkKey=ref(l.requirement,l.workItem||'',l.document,l.clause);
    if(linkKeys.has(linkKey))errors.push('同一执行对象与来源条款重复关联');linkKeys.add(linkKey);
    if(target&&r?.action==='link'&&['completed','cancelled'].includes(existing.get(target.requirementId)?.status||'')){
      const old=source?.existing?.links.find(x=>x.requirementId===target.requirementId&&(x.workItemId||null)===target.workItemId);
      if(!old||old.scope!==l.scope)errors.push(r.title+'：已结束需求修改来源，请在详情使用纠错并说明原因');
    }
  }
  for(const [i,d] of pkg.dependencies.entries()){
    if(requirements.get(d.source.requirement)?.action==='skip'||requirements.get(d.target.requirement)?.action==='skip'){warnings.push('已跳过交付的依赖未导入');continue;}
    const source=endpoint(d.source.requirement,d.source.workItem),target=endpoint(d.target.requirement,d.target.workItem);
    if(source&&target){
      const exists=sqlite.prepare('SELECT 1 FROM dependency_edges WHERE project_id=? AND source_requirement_id=? AND source_work_item_id IS ? AND target_requirement_id=? AND target_work_item_id IS ? AND source_milestone_id IS NULL AND target_milestone_id IS NULL').get(projectId,source.requirementId,source.workItemId,target.requirementId,target.workItemId);
      if(!exists)changes.changes.add.push({clientId:'intake:edge:'+i,sourceRequirementId:source.requirementId,sourceWorkItemId:source.workItemId,targetRequirementId:target.requirementId,targetWorkItemId:target.workItemId});
    }
  }
  let core:ReturnType<typeof previewDependencyChanges>|null=null;
  if(!errors.length&&(changes.changes.entities!.length||changes.changes.add.length)){
    try{core=previewDependencyChanges(projectId,changes,actor);}catch(error){errors.push(error instanceof Error?error.message:'无法预览交付安排');}
  }
  if(!pkg.documents.length&&!pkg.requirements.length&&!pkg.links.length)errors.push('导入包为空');
  const preview:ImportPreview={expectedRevision:catalog.revision,previewToken:hash({projectId,pkg,revision:catalog.revision,core:core?.previewToken}),package:pkg,warnings:[...new Set(warnings)],errors:[...new Set(errors)],existingMatches,sourceChanges,differences:core?.differences||null,counts:{requirements:pkg.requirements.filter(r=>r.action==='create').length,workItems:pkg.requirements.filter(r=>r.action==='create').reduce((n,r)=>n+r.workItems.length,0),documents:pkg.documents.length,clauses:pkg.documents.reduce((n,d)=>n+d.clauses.length,0),links:pkg.links.filter(l=>requirements.get(l.requirement)?.action!=='skip').length}};
  return {preview,changes,core};
}
export function previewRequirementImport(projectId:string,raw:unknown,actor:Actor):ImportPreview {
  const input=importPreviewInput.parse(raw);
  return sqlite.transaction(()=>prepare(projectId,input.package,actor).preview)();
}
type ReceiptRow={project_id:string;actor_id:string;content_hash:string;result:string};
const actorKey=(actor:Actor)=>actor.accountId||actor.id;
export function getRequirementImportReceipt(projectId:string,batchId:string,actor:Actor):ImportReceipt {
  assertProjectReadable(requireAuthorizationActor(actor),projectId);
  const row=sqlite.prepare('SELECT * FROM requirement_import_receipts WHERE batch_id=?').get(batchId) as ReceiptRow|undefined;
  if(!row)return {status:'not_found'};
  if(row.project_id!==projectId||row.actor_id!==actorKey(actor))notFound('提交回执不存在');
  return JSON.parse(row.result);
}
export function applyRequirementImport(projectId:string,raw:unknown,actor:Actor):ImportReceipt {
  const input=importApplyInput.parse(raw),contentHash=hash(input.package);
  return sqlite.transaction(()=>{
    assertProjectManager(requireAuthorizationActor(actor),projectId);requireActiveProject(projectId);
    const old=sqlite.prepare('SELECT * FROM requirement_import_receipts WHERE batch_id=?').get(input.batchId) as ReceiptRow|undefined;
    if(old){if(old.project_id!==projectId||old.actor_id!==actorKey(actor))notFound('提交回执不存在');if(old.content_hash!==contentHash)fail('批次标识已用于另一份导入内容','DEPENDENCY_CONFLICT',409);return JSON.parse(old.result) as ImportReceipt;}
    if(intakeRevision(projectId)!==input.expectedRevision)fail('项目资料已变化，请重新预览','STALE_WRITE',409);
    const prepared=prepare(projectId,input.package,actor);
    if(prepared.preview.errors.length)fail(prepared.preview.errors.join('；'));
    if(prepared.preview.previewToken!==input.previewToken)fail('预览已变化，请重新核对','STALE_WRITE',409);
    const created=prepared.core?applyDependencyChanges(projectId,{...prepared.changes,batchId:input.batchId,previewToken:prepared.core.previewToken},actor).addedIds:{};
    persistDocuments(projectId,input.package.documents);
    const requirementIds:Record<string,string>={};
    for(const r of input.package.requirements){
      if(r.action==='skip')continue;
      const id=r.action==='link'?r.existingId!:created[entityId(r.key)];requirementIds[r.key]=id;
      if(r.action==='create'){
        let groupId:string|null=null;
        if(r.group){
          const oldGroup=sqlite.prepare('SELECT id FROM requirement_groups WHERE project_id=? AND name=?').get(projectId,r.group) as {id:string}|undefined;
          groupId=oldGroup?.id||randomUUID();
          if(!oldGroup){const now=new Date().toISOString();sqlite.prepare('INSERT INTO requirement_groups(id,project_id,name,sort_order,created_at,updated_at) VALUES(?,?,?,(SELECT count(*) FROM requirement_groups WHERE project_id=?),?,?)').run(groupId,projectId,r.group,projectId,now,now);}
        }
        persistOrganization(id,projectId,{groupId,tags:r.tags});
      }
    }
    const changedRequirements=new Set<string>();
    for(const l of input.package.links){
      const r=input.package.requirements.find(r=>r.key===l.requirement)!;if(r.action==='skip')continue;
      const id=requirementIds[l.requirement],workId=l.workItem?(r.action==='create'?created[entityId(r.key,l.workItem)]:l.workItem):null;
      const clause=sqlite.prepare('SELECT c.id,c.current_revision_id AS revision FROM source_clauses c JOIN source_documents d ON d.id=c.document_id WHERE d.project_id=? AND d.source_key=? AND c.source_key=?').get(projectId,l.document,l.clause) as {id:string;revision:string};
      const prior=sqlite.prepare("SELECT scope,reviewed_revision_id AS reviewed FROM source_links WHERE requirement_id=? AND coalesce(work_item_id,'')=? AND clause_id=?").get(id,workId||'',clause.id) as {scope:string;reviewed:string}|undefined;
      if(!prior||prior.scope!==l.scope){persistLink(id,workId,clause.id,l.scope,prior?.reviewed||clause.revision);changedRequirements.add(id);}
    }
    for(const id of changedRequirements)sqlite.prepare('UPDATE requirements SET version=version+1,updated_at=? WHERE id=?').run(new Date().toISOString(),id);
    const result:ImportReceipt={status:'applied',batchId:input.batchId,createdAt:new Date().toISOString(),requirementIds};
    sqlite.prepare('INSERT INTO requirement_import_receipts(batch_id,project_id,actor_id,content_hash,result,created_at) VALUES(?,?,?,?,?,?)').run(input.batchId,projectId,actorKey(actor),contentHash,JSON.stringify(result),result.createdAt);
    recordAudit(actor,'import','project',projectId,'导入来源与交付安排：'+prepared.preview.counts.requirements+' 个新需求');
    return result;
  }).immediate();
}
