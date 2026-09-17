import { randomUUID } from 'node:crypto';
import { applyFeatureRelationDraft, featureRelationInput, type FeatureRelation, type FeatureRelationChange, type FeatureRequirement, type FeatureRequirements } from '../../shared/features';
import { featureInput, type Feature } from '../../shared/intake';
import { normalizeReferenceLinks, readReferenceLinks } from '../../shared/reference-links';
import type { Actor } from '../auth';
import { assertProjectManager, assertProjectReadable, requireAuthorizationActor } from '../authorization';
import { getDatabaseContext } from '../database-context';
import { fail, notFound } from '../errors';
import { recordAudit } from './audit';
import { phaseRequirementFacts } from './feature-phases';
import { requireActiveProject } from './support';

export function readFeatures(projectId: string, state: 'active'|'archived'|'all' = 'active'): Feature[] {
  const rows = getDatabaseContext().sqlite.prepare(`SELECT g.id,g.kind,g.project_id AS projectId,g.name,g.sort_order AS sortOrder,g.version,g.description,g.archived_at AS archivedAt,
    g.expectation,g.progress_summary AS progressSummary,g.assessment,g.assessment_note AS note,
    g.reference_links AS referenceLinks,g.assessed_at AS assessedAt,g.assessed_by AS assessedBy,a.username AS assessedByName
    FROM features g LEFT JOIN accounts a ON a.id=g.assessed_by
    WHERE g.project_id=? ${state==='all'?'':state==='active'?'AND g.archived_at IS NULL':'AND g.archived_at IS NOT NULL'}
    ORDER BY (g.kind='other'),g.sort_order,g.name,g.id`).all(projectId) as Array<Omit<Feature,'overview'> & Feature['overview']>;
  return rows.map(({expectation,progressSummary,assessment,note,referenceLinks,...feature})=>({...feature,name:feature.kind==='other'?'其他需求':feature.name,referenceLinks:readReferenceLinks(referenceLinks),overview:{expectation,progressSummary,assessment,note}}));
}
export function listFeatures(projectId: string, state: 'active'|'archived'|'all', actor: Actor) {
  assertProjectReadable(requireAuthorizationActor(actor),projectId);return readFeatures(projectId,state);
}
function manager(projectId:string,actor:Actor) { assertProjectManager(requireAuthorizationActor(actor),projectId);requireActiveProject(projectId); }
function currentFeature(projectId:string,id:string,version?:number) {
  const value=readFeatures(projectId,'all').find(g=>g.id===id);
  if(!value)notFound('特性不存在');
  if(version!==undefined&&value.version!==version)fail('特性已变化，请读取最新资料并核对','STALE_WRITE');
  return value;
}
function audit(projectId:string,id:string,actor:Actor,action:string,before:unknown,after:unknown) {
  recordAudit(actor,action,'feature',id,'修改特性；修改前：'+JSON.stringify(before)+'；修改后：'+JSON.stringify(after),projectId);
}
export function saveFeature(projectId:string,raw:unknown,actor:Actor) {
  const input=featureInput.parse(raw);
  return getDatabaseContext().sqlite.transaction(()=>{
    manager(projectId,actor);
    const before=input.id?currentFeature(projectId,input.id,input.expectedVersion??0):null;
    if(before?.kind==='other')fail('其他需求是系统归类，不能修改特性资料');
    if(before?.archivedAt)fail('特性已归档，请先恢复');
    if(['其他特性','其他需求'].includes(input.name))fail('该名称用于系统归类，请使用其他特性名称');
    const id=before?.id||randomUUID(),now=new Date().toISOString();
    if(before)getDatabaseContext().sqlite.prepare('UPDATE features SET name=?,description=?,version=version+1,updated_at=? WHERE id=?').run(input.name,input.description??before.description,now,id);
    else getDatabaseContext().sqlite.prepare('INSERT INTO features(id,project_id,name,description,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,projectId,input.name,input.description??'',now,now);
    // Metadata edits must not reorder siblings or invalidate their versions.
    if(!before||input.sortOrder!==undefined){
      const ordered=readFeatures(projectId).filter(g=>g.id!==id&&g.kind!=='other').map(g=>g.id);
      ordered.splice(Math.min(input.sortOrder??ordered.length,ordered.length),0,id);
      for(const [order,featureId] of ordered.entries())getDatabaseContext().sqlite.prepare('UPDATE features SET sort_order=?,version=version+1,updated_at=? WHERE id=? AND sort_order<>?').run(order,now,featureId,order);
    }
    if(input.referenceLinks!==undefined)getDatabaseContext().sqlite.prepare('UPDATE features SET reference_links=? WHERE id=?').run(JSON.stringify(normalizeReferenceLinks(input.referenceLinks)),id);
    if(input.overview) {
      const {expectation,progressSummary,assessment,note}=input.overview;
      getDatabaseContext().sqlite.prepare('UPDATE features SET expectation=?,progress_summary=?,assessment=?,assessment_note=?,assessed_at=?,assessed_by=? WHERE id=?').run(expectation,progressSummary,assessment,note,now,actor.accountId,id);
    }
    const after=currentFeature(projectId,id);audit(projectId,id,actor,before?'update':'create',before,after);return after;
  }).immediate();
}
export function archiveFeature(projectId:string,id:string,expectedVersion:number,archived:boolean,actor:Actor) {
  return getDatabaseContext().sqlite.transaction(()=>{
    manager(projectId,actor);const before=currentFeature(projectId,id,expectedVersion);if(before.kind==='other')fail('其他需求是系统归类，不能归档或删除');
    if(Boolean(before.archivedAt)===archived)fail('特性状态已变化，请读取最新资料','STALE_WRITE');
    if(archived&&getDatabaseContext().sqlite.prepare("SELECT 1 FROM requirements WHERE feature_id=? AND status NOT IN ('completed','cancelled') LIMIT 1").get(id))fail('请先完成、取消或移出未完成需求','DEPENDENCY_CONFLICT');
    const now=new Date().toISOString();
    getDatabaseContext().sqlite.prepare('UPDATE features SET archived_at=?,version=version+1,updated_at=? WHERE id=?').run(archived?now:null,now,id);
    const after=currentFeature(projectId,id);audit(projectId,id,actor,archived?'archive':'restore',before,after);return after;
  }).immediate();
}
export function deleteFeature(projectId:string,id:string,expectedVersion:number,actor:Actor) {
  return getDatabaseContext().sqlite.transaction(()=>{
    manager(projectId,actor);const before=currentFeature(projectId,id,expectedVersion);if(before.kind==='other')fail('其他需求是系统归类，不能归档或删除');
    if(getDatabaseContext().sqlite.prepare('SELECT 1 FROM feature_phases WHERE feature_id=? LIMIT 1').get(id))fail('特性仍有 Phase，请先处理 Phase');
    if(getDatabaseContext().sqlite.prepare('SELECT 1 FROM requirements WHERE feature_id=? LIMIT 1').get(id))fail('特性仍有关联需求，请使用归档或先调整归属','DEPENDENCY_CONFLICT');
    if(getDatabaseContext().sqlite.prepare('SELECT 1 FROM feature_relations WHERE source_feature_id=? OR target_feature_id=? LIMIT 1').get(id,id))fail('请先移除特性的规划关系','DEPENDENCY_CONFLICT');
    getDatabaseContext().sqlite.prepare('DELETE FROM features WHERE id=?').run(id);
    getDatabaseContext().sqlite.prepare("DELETE FROM diagram_layouts WHERE project_id=? AND scope=?").run(projectId,'feature:'+id);
    const layouts=getDatabaseContext().sqlite.prepare("SELECT direction,positions FROM diagram_layouts WHERE project_id=? AND scope='features'").all(projectId) as Array<{direction:string;positions:string}>;
    for(const layout of layouts){
      const positions=JSON.parse(layout.positions) as Record<string,unknown>;
      if(!Object.hasOwn(positions,'feature:'+id))continue;
      delete positions['feature:'+id];
      getDatabaseContext().sqlite.prepare("UPDATE diagram_layouts SET positions=?,version=version+1,updated_at=? WHERE project_id=? AND scope='features' AND direction=?").run(JSON.stringify(positions),new Date().toISOString(),projectId,layout.direction);
    }
    audit(projectId,id,actor,'delete',before,null);
  }).immediate();
}
export function readFeatureRequirements(projectId:string,id:string,state:'current'|'archived',page:number,pageSize:number,actor:Actor):FeatureRequirements {
  assertProjectReadable(requireAuthorizationActor(actor),projectId);
  return getDatabaseContext().sqlite.transaction(()=>{
    if(id!=='unassigned')currentFeature(projectId,id);
    const where=`project_id=? AND ${id==='unassigned'?'feature_id IS NULL':'feature_id=?'} AND deleted_at IS ${state==='current'?'NULL':'NOT NULL'}`;
    const params=id==='unassigned'?[projectId]:[projectId,id];
    const total=(getDatabaseContext().sqlite.prepare('SELECT COUNT(*) AS count FROM requirements WHERE '+where).get(...params) as {count:number}).count;
    const items=getDatabaseContext().sqlite.prepare('SELECT id,title,status,version,feature_id AS featureId,deleted_at AS deletedAt,actual_end AS actualEnd FROM requirements WHERE '+where+' ORDER BY updated_at DESC,id LIMIT ? OFFSET ?').all(...params,pageSize,(page-1)*pageSize) as FeatureRequirement[];
    const facts=new Map(phaseRequirementFacts(projectId).map(r=>[r.id,r]));for(const item of items){const fact=facts.get(item.id);if(fact){item.status=fact.status;item.executionStage=fact.executionStage;}}
    return {items,total,page,pageSize,pages:Math.max(1,Math.ceil(total/pageSize))};
  })();
}
export function readFeatureRelations(projectId:string):FeatureRelation[] {
  return getDatabaseContext().sqlite.prepare('SELECT id,project_id AS projectId,source_feature_id AS sourceFeatureId,target_feature_id AS targetFeatureId,note,version FROM feature_relations WHERE project_id=? ORDER BY id').all(projectId) as FeatureRelation[];
}
export function listFeatureRelations(projectId:string,actor:Actor) {
  assertProjectReadable(requireAuthorizationActor(actor),projectId);return readFeatureRelations(projectId);
}
function validateFeatureRelations(relations:FeatureRelation[]) {
  const pairs=new Set<string>(),next=new Map<string,string[]>();
  for(const relation of relations){
    const pair=relation.sourceFeatureId+'>'+relation.targetFeatureId;
    if(pairs.has(pair))fail('规划关系已存在','DEPENDENCY_CONFLICT');
    pairs.add(pair);next.set(relation.sourceFeatureId,[...(next.get(relation.sourceFeatureId)||[]),relation.targetFeatureId]);
  }
  const active=new Set<string>(),done=new Set<string>();
  const visit=(id:string)=>{if(active.has(id))fail('规划关系形成循环，请核对前置与后续特性（包含保留的归档关系）','DEPENDENCY_CONFLICT');if(done.has(id))return;active.add(id);for(const child of next.get(id)||[])visit(child);active.delete(id);done.add(id);};
  for(const id of next.keys())visit(id);
}
export function prepareFeatureRelationChanges(projectId:string,changes:FeatureRelationChange[],actor:Actor) {
  const before=readFeatureRelations(projectId);
  if(!changes.length)return {before,after:before};
  manager(projectId,actor);
  if(new Set(changes.map(c=>c.id)).size!==changes.length)fail('批次中存在重复的规划关系修改');
  for(const change of changes){
    const old=before.find(r=>r.id===change.id);
    if(change.op==='create'){
      if(old)fail('新增规划关系标识重复','DEPENDENCY_CONFLICT');
      if([change.sourceFeatureId,change.targetFeatureId].some(id=>currentFeature(projectId,id).kind==='other'))fail('其他需求不能建立特性规划关系，请关联具体需求');
      for(const id of [change.sourceFeatureId,change.targetFeatureId])if(currentFeature(projectId,id).archivedAt)fail('归档特性不能修改规划关系');
    }else{
      if(!old||old.version!==change.expectedVersion)fail('规划关系已变化，请读取最新资料','STALE_WRITE',409,{featureRelationIds:[change.id]});
      if(change.op==='update')for(const id of [old.sourceFeatureId,old.targetFeatureId])if(currentFeature(projectId,id).archivedAt)fail('归档特性不能修改规划关系');
    }
  }
  const after=applyFeatureRelationDraft(before,changes,projectId);validateFeatureRelations(after);
  return {before,after};
}
export function persistFeatureRelationChanges(projectId:string,changes:FeatureRelationChange[],before:FeatureRelation[],actor:Actor) {
  const ids:Record<string,string>=Object.create(null),now=new Date().toISOString();
  // Release removed endpoint pairs before inserting replacements in the final batch.
  for(const change of [...changes.filter(c=>c.op==='delete'),...changes.filter(c=>c.op!=='delete')]){
    const old=before.find(r=>r.id===change.id),id=change.op==='create'?randomUUID():change.id;
    if(change.op==='create'){
      ids[change.id]=id;getDatabaseContext().sqlite.prepare('INSERT INTO feature_relations(id,project_id,source_feature_id,target_feature_id,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,projectId,change.sourceFeatureId,change.targetFeatureId,change.note,now,now);
    }else if(change.op==='delete')getDatabaseContext().sqlite.prepare('DELETE FROM feature_relations WHERE id=?').run(id);
    else getDatabaseContext().sqlite.prepare('UPDATE feature_relations SET note=?,version=version+1,updated_at=? WHERE id=?').run(change.note,now,id);
    const after=change.op==='delete'?null:readFeatureRelations(projectId).find(r=>r.id===id);
    recordAudit(actor,change.op,'feature_relation',id,'规划关系；修改前：'+JSON.stringify(old??null)+'；修改后：'+JSON.stringify(after),projectId);
  }
  return ids;
}
export function saveFeatureRelation(projectId:string,raw:unknown,actor:Actor) {
  const input=featureRelationInput.parse(raw);
  return getDatabaseContext().sqlite.transaction(()=>{
    manager(projectId,actor);
    const relations=readFeatureRelations(projectId),before=input.id?relations.find(r=>r.id===input.id):undefined;
    if(input.id&&(!before||before.version!==input.expectedVersion))fail('规划关系已变化，请读取最新资料','STALE_WRITE');
    for(const id of [input.sourceFeatureId,input.targetFeatureId])if(currentFeature(projectId,id).archivedAt)fail('归档特性不能修改规划关系');
    if((!before||before.sourceFeatureId!==input.sourceFeatureId||before.targetFeatureId!==input.targetFeatureId)&&[input.sourceFeatureId,input.targetFeatureId].some(id=>currentFeature(projectId,id).kind==='other'))fail('其他需求不能建立特性规划关系，请关联具体需求');
    const rest=relations.filter(r=>r.id!==input.id);
    validateFeatureRelations([...rest,{...input,id:input.id||'new',projectId,version:before?.version||0}]);
    const id=input.id||randomUUID(),now=new Date().toISOString();
    if(before)getDatabaseContext().sqlite.prepare('UPDATE feature_relations SET source_feature_id=?,target_feature_id=?,note=?,version=version+1,updated_at=? WHERE id=?').run(input.sourceFeatureId,input.targetFeatureId,input.note,now,id);
    else getDatabaseContext().sqlite.prepare('INSERT INTO feature_relations(id,project_id,source_feature_id,target_feature_id,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,projectId,input.sourceFeatureId,input.targetFeatureId,input.note,now,now);
    const after=readFeatureRelations(projectId).find(r=>r.id===id)!;
    recordAudit(actor,before?'update':'create','feature_relation',id,'规划关系；修改前：'+JSON.stringify(before??null)+'；修改后：'+JSON.stringify(after),projectId);return after;
  }).immediate();
}
export function deleteFeatureRelation(projectId:string,id:string,expectedVersion:number,actor:Actor) {
  return getDatabaseContext().sqlite.transaction(()=>{
    manager(projectId,actor);const before=readFeatureRelations(projectId).find(r=>r.id===id);
    if(!before||before.version!==expectedVersion)fail('规划关系已变化，请读取最新资料','STALE_WRITE');
    // Archived relationships remain editable through explicit deletion, including cycle cleanup.
    getDatabaseContext().sqlite.prepare('DELETE FROM feature_relations WHERE id=?').run(id);
    recordAudit(actor,'delete','feature_relation',id,'移除规划关系；修改前：'+JSON.stringify(before)+'；修改后：null',projectId);return {ok:true};
  }).immediate();
}
