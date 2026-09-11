import { randomUUID } from 'node:crypto';
import { sqlite } from '../database';
import type { Actor } from '../auth';
import { assertProjectManager, assertProjectReadable, requireAuthorizationActor } from '../authorization';
import { fail, notFound } from '../errors';
import { requireActiveProject } from './support';
import { recordAudit } from './audit';
import { groupInput, type RequirementGroup } from '../../shared/intake';
import { featureRelationInput, type FeatureRelation, type FeatureRequirement, type FeatureRequirements } from '../../shared/features';

export function readRequirementGroups(projectId: string, state: 'active'|'archived'|'all' = 'active'): RequirementGroup[] {
  const rows = sqlite.prepare(`SELECT g.id,g.project_id AS projectId,g.name,g.sort_order AS sortOrder,g.version,g.description,g.archived_at AS archivedAt,
    g.expectation,g.progress_summary AS progressSummary,g.assessment,g.assessment_note AS note,
    g.assessed_at AS assessedAt,g.assessed_by AS assessedBy,a.username AS assessedByName
    FROM requirement_groups g LEFT JOIN accounts a ON a.id=g.assessed_by
    WHERE g.project_id=? ${state==='all'?'':state==='active'?'AND g.archived_at IS NULL':'AND g.archived_at IS NOT NULL'}
    ORDER BY g.sort_order,g.name,g.id`).all(projectId) as Array<Omit<RequirementGroup,'overview'> & RequirementGroup['overview']>;
  return rows.map(({expectation,progressSummary,assessment,note,...group})=>({...group,overview:{expectation,progressSummary,assessment,note}}));
}
export function listFeatures(projectId: string, state: 'active'|'archived'|'all', actor: Actor) {
  assertProjectReadable(requireAuthorizationActor(actor),projectId);return readRequirementGroups(projectId,state);
}
function manager(projectId:string,actor:Actor) { assertProjectManager(requireAuthorizationActor(actor),projectId);requireActiveProject(projectId); }
function currentFeature(projectId:string,id:string,version?:number) {
  const value=readRequirementGroups(projectId,'all').find(g=>g.id===id);
  if(!value)notFound('特性不存在');
  if(version!==undefined&&value.version!==version)fail('特性已变化，请读取最新资料并核对','STALE_WRITE');
  return value;
}
function audit(projectId:string,id:string,actor:Actor,action:string,before:unknown,after:unknown) {
  recordAudit(actor,action,'feature',id,'修改特性；修改前：'+JSON.stringify(before)+'；修改后：'+JSON.stringify(after),projectId);
}
export function saveFeature(projectId:string,raw:unknown,actor:Actor) {
  const input=groupInput.parse(raw);
  return sqlite.transaction(()=>{
    manager(projectId,actor);
    const before=input.id?currentFeature(projectId,input.id,input.expectedVersion??0):null;
    if(before?.archivedAt)fail('特性已归档，请先恢复');
    const id=before?.id||randomUUID(),now=new Date().toISOString();
    if(before)sqlite.prepare('UPDATE requirement_groups SET name=?,description=?,version=version+1,updated_at=? WHERE id=?').run(input.name,input.description??before.description,now,id);
    else sqlite.prepare('INSERT INTO requirement_groups(id,project_id,name,description,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,projectId,input.name,input.description??'',now,now);
    const ordered=readRequirementGroups(projectId).filter(g=>g.id!==id).map(g=>g.id);
    ordered.splice(Math.min(input.sortOrder,ordered.length),0,id);
    for(const [order,groupId] of ordered.entries())sqlite.prepare('UPDATE requirement_groups SET sort_order=?,version=version+1,updated_at=? WHERE id=? AND sort_order<>?').run(order,now,groupId,order);
    if(input.overview) {
      const {expectation,progressSummary,assessment,note}=input.overview;
      sqlite.prepare('UPDATE requirement_groups SET expectation=?,progress_summary=?,assessment=?,assessment_note=?,assessed_at=?,assessed_by=? WHERE id=?').run(expectation,progressSummary,assessment,note,now,actor.accountId,id);
    }
    const after=currentFeature(projectId,id);audit(projectId,id,actor,before?'update':'create',before,after);return after;
  }).immediate();
}
export function archiveFeature(projectId:string,id:string,expectedVersion:number,archived:boolean,actor:Actor) {
  return sqlite.transaction(()=>{
    manager(projectId,actor);const before=currentFeature(projectId,id,expectedVersion);
    if(Boolean(before.archivedAt)===archived)fail('特性状态已变化，请读取最新资料','STALE_WRITE');
    if(archived&&sqlite.prepare("SELECT 1 FROM requirements WHERE group_id=? AND status NOT IN ('completed','cancelled') LIMIT 1").get(id))fail('请先完成、取消或移出未完成需求','DEPENDENCY_CONFLICT');
    const now=new Date().toISOString();
    sqlite.prepare('UPDATE requirement_groups SET archived_at=?,version=version+1,updated_at=? WHERE id=?').run(archived?now:null,now,id);
    const after=currentFeature(projectId,id);audit(projectId,id,actor,archived?'archive':'restore',before,after);return after;
  }).immediate();
}
export function deleteFeature(projectId:string,id:string,expectedVersion:number,actor:Actor) {
  return sqlite.transaction(()=>{
    manager(projectId,actor);const before=currentFeature(projectId,id,expectedVersion);
    if(sqlite.prepare('SELECT 1 FROM requirements WHERE group_id=? LIMIT 1').get(id))fail('特性仍有关联需求，请使用归档或先调整归属','DEPENDENCY_CONFLICT');
    if(sqlite.prepare('SELECT 1 FROM feature_relations WHERE source_feature_id=? OR target_feature_id=? LIMIT 1').get(id,id))fail('请先移除特性的规划关系','DEPENDENCY_CONFLICT');
    sqlite.prepare('DELETE FROM requirement_groups WHERE id=?').run(id);
    sqlite.prepare("DELETE FROM diagram_layouts WHERE project_id=? AND scope=?").run(projectId,'feature:'+id);
    const layouts=sqlite.prepare("SELECT direction,positions FROM diagram_layouts WHERE project_id=? AND scope='features'").all(projectId) as Array<{direction:string;positions:string}>;
    for(const layout of layouts){
      const positions=JSON.parse(layout.positions) as Record<string,unknown>;
      if(!Object.hasOwn(positions,'feature:'+id))continue;
      delete positions['feature:'+id];
      sqlite.prepare("UPDATE diagram_layouts SET positions=?,version=version+1,updated_at=? WHERE project_id=? AND scope='features' AND direction=?").run(JSON.stringify(positions),new Date().toISOString(),projectId,layout.direction);
    }
    audit(projectId,id,actor,'delete',before,null);
  }).immediate();
}
export function readFeatureRequirements(projectId:string,id:string,state:'current'|'archived',page:number,pageSize:number,actor:Actor):FeatureRequirements {
  assertProjectReadable(requireAuthorizationActor(actor),projectId);
  return sqlite.transaction(()=>{
    if(id!=='ungrouped')currentFeature(projectId,id);
    const where=`project_id=? AND ${id==='ungrouped'?'group_id IS NULL':'group_id=?'} AND deleted_at IS ${state==='current'?'NULL':'NOT NULL'}`;
    const params=id==='ungrouped'?[projectId]:[projectId,id];
    const total=(sqlite.prepare('SELECT COUNT(*) AS count FROM requirements WHERE '+where).get(...params) as {count:number}).count;
    const items=sqlite.prepare('SELECT id,title,status,version,group_id AS groupId,deleted_at AS deletedAt,actual_end AS actualEnd FROM requirements WHERE '+where+' ORDER BY updated_at DESC,id LIMIT ? OFFSET ?').all(...params,pageSize,(page-1)*pageSize) as FeatureRequirement[];
    return {items,total,page,pageSize,pages:Math.max(1,Math.ceil(total/pageSize))};
  })();
}
export function readFeatureRelations(projectId:string):FeatureRelation[] {
  return sqlite.prepare('SELECT id,project_id AS projectId,source_feature_id AS sourceFeatureId,target_feature_id AS targetFeatureId,note,version FROM feature_relations WHERE project_id=? ORDER BY id').all(projectId) as FeatureRelation[];
}
export function listFeatureRelations(projectId:string,actor:Actor) {
  assertProjectReadable(requireAuthorizationActor(actor),projectId);return readFeatureRelations(projectId);
}
export function saveFeatureRelation(projectId:string,raw:unknown,actor:Actor) {
  const input=featureRelationInput.parse(raw);
  return sqlite.transaction(()=>{
    manager(projectId,actor);
    const relations=readFeatureRelations(projectId),before=input.id?relations.find(r=>r.id===input.id):undefined;
    if(input.id&&(!before||before.version!==input.expectedVersion))fail('规划关系已变化，请读取最新资料','STALE_WRITE');
    for(const id of [input.sourceFeatureId,input.targetFeatureId])if(currentFeature(projectId,id).archivedAt)fail('归档特性不能修改规划关系');
    const rest=relations.filter(r=>r.id!==input.id);
    if(rest.some(r=>r.sourceFeatureId===input.sourceFeatureId&&r.targetFeatureId===input.targetFeatureId))fail('规划关系已存在','DEPENDENCY_CONFLICT');
    const seen=new Set<string>(),pending=[input.targetFeatureId];
    while(pending.length){const id=pending.pop()!;if(id===input.sourceFeatureId)fail('规划关系形成循环，请核对前置与后续特性（包含保留的归档关系）','DEPENDENCY_CONFLICT');if(seen.has(id))continue;seen.add(id);pending.push(...rest.filter(r=>r.sourceFeatureId===id).map(r=>r.targetFeatureId));}
    const id=input.id||randomUUID(),now=new Date().toISOString();
    if(before)sqlite.prepare('UPDATE feature_relations SET source_feature_id=?,target_feature_id=?,note=?,version=version+1,updated_at=? WHERE id=?').run(input.sourceFeatureId,input.targetFeatureId,input.note,now,id);
    else sqlite.prepare('INSERT INTO feature_relations(id,project_id,source_feature_id,target_feature_id,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,projectId,input.sourceFeatureId,input.targetFeatureId,input.note,now,now);
    const after=readFeatureRelations(projectId).find(r=>r.id===id)!;
    recordAudit(actor,before?'update':'create','feature_relation',id,'规划关系；修改前：'+JSON.stringify(before??null)+'；修改后：'+JSON.stringify(after),projectId);return after;
  }).immediate();
}
export function deleteFeatureRelation(projectId:string,id:string,expectedVersion:number,actor:Actor) {
  return sqlite.transaction(()=>{
    manager(projectId,actor);const before=readFeatureRelations(projectId).find(r=>r.id===id);
    if(!before||before.version!==expectedVersion)fail('规划关系已变化，请读取最新资料','STALE_WRITE');
    // Archived relationships remain editable through explicit deletion, including cycle cleanup.
    sqlite.prepare('DELETE FROM feature_relations WHERE id=?').run(id);
    recordAudit(actor,'delete','feature_relation',id,'移除规划关系；修改前：'+JSON.stringify(before)+'；修改后：null',projectId);return {ok:true};
  }).immediate();
}
