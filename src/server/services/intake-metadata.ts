import { randomUUID } from 'node:crypto';
import { sqlite } from '../database';
import type { Actor } from '../auth';
import { assertProjectReadable, assertProjectManager, assertRequirementOwnerOrManager, requireAuthorizationActor } from '../authorization';
import { fail, notFound } from '../errors';
import { requireActiveProject } from './support';
import { recordAudit } from './audit';
import { groupInput, organizationInput, tagsSchema, sourceWriteInput, sourceLinkInput, sourceLinkDeleteInput, deferClauseInput, type IntakeCatalog, type RequirementGroup, type SourceDocument, type SourceClause, type SourceRevision, type SourceLink, type Organization, type SourceDocumentInput } from '../../shared/intake';

export function intakeRevision(projectId: string) {
  const row = sqlite.prepare('SELECT analysis_revision FROM projects WHERE id=? AND deleted_at IS NULL').get(projectId) as {analysis_revision:number}|undefined;
  if (!row) notFound('项目不存在');
  return String(row.analysis_revision);
}
export function assertIntakeRevision(projectId:string, revision:string) {
  if(intakeRevision(projectId)!==revision) fail('项目资料已更新，请重新预览并核对', 'STALE_WRITE', 409);
}
export function validateOrganization(projectId:string, value:Organization) {
  if(value.groupId && !sqlite.prepare('SELECT 1 FROM requirement_groups WHERE id=? AND project_id=?').get(value.groupId,projectId)) fail('分组不属于当前项目');
  if(value.tags !== undefined) tagsSchema.parse(value.tags);
}
export function persistOrganization(id:string, projectId:string, value:Organization) {
  validateOrganization(projectId,value);
  if(value.groupId!==undefined) sqlite.prepare('UPDATE requirements SET group_id=? WHERE id=?').run(value.groupId||null,id);
  if(value.tags!==undefined) sqlite.prepare('UPDATE requirements SET tags=? WHERE id=?').run(JSON.stringify(tagsSchema.parse(value.tags)),id);
}
export function readIntakeCatalog(projectId:string, actor:Actor):IntakeCatalog {
  assertProjectReadable(requireAuthorizationActor(actor),projectId);
  const groups=sqlite.prepare('SELECT id,project_id AS projectId,name,sort_order AS sortOrder,version FROM requirement_groups WHERE project_id=? ORDER BY sort_order,name,id').all(projectId) as RequirementGroup[];
  const documents=sqlite.prepare('SELECT id,source_key AS key,title,url,source_version AS version,complete FROM source_documents WHERE project_id=? ORDER BY title,id').all(projectId) as SourceDocument[];
  const revisions=sqlite.prepare('SELECT v.id,v.document_version AS documentVersion,v.section,v.external_id AS externalId,v.title,v.content,v.priority FROM source_revisions v JOIN source_clauses c ON c.id=v.clause_id JOIN source_documents d ON d.id=c.document_id WHERE d.project_id=?').all(projectId) as SourceRevision[];
  const byRevision=new Map(revisions.map(r=>[r.id,r]));
  const clauses=sqlite.prepare('SELECT c.id,c.source_key AS key,c.document_id AS documentId,c.current_revision_id AS currentRevisionId,c.deferred_reason AS deferredReason FROM source_clauses c JOIN source_documents d ON d.id=c.document_id WHERE d.project_id=? ORDER BY c.created_at,c.id').all(projectId) as Array<SourceClause & {currentRevisionId:string}>;
  const links=sqlite.prepare(`SELECT l.id,l.clause_id AS clauseId,l.requirement_id AS requirementId,l.work_item_id AS workItemId,l.scope,l.reviewed_revision_id AS reviewedRevisionId,
    r.title AS requirementTitle,r.version AS requirementVersion,r.status,r.delivery_scope AS deliveryScope,r.deleted_at AS deletedAt,w.title AS workItemTitle FROM source_links l JOIN requirements r ON r.id=l.requirement_id LEFT JOIN work_items w ON w.id=l.work_item_id WHERE r.project_id=? ORDER BY l.created_at,l.id`).all(projectId) as SourceLink[];
  for(const c of clauses) {
    c.current=byRevision.get(c.currentRevisionId)!;
    c.links=links.filter(l=>l.clauseId===c.id).map(l=>({...l,reviewed:byRevision.get(l.reviewedRevisionId)!,needsReview:l.reviewedRevisionId!==c.currentRevisionId}));
  }
  for(const d of documents){d.complete=Boolean(d.complete);d.clauses=clauses.filter(c=>c.documentId===d.id);}
  const tags=[...new Set((sqlite.prepare('SELECT tags FROM requirements WHERE project_id=? AND deleted_at IS NULL').all(projectId) as Array<{tags:string}>).flatMap(r=>JSON.parse(r.tags) as string[]))].sort();
  return {revision:intakeRevision(projectId),groups,tags,documents};
}
export function saveGroup(projectId:string, raw:unknown, actor:Actor) {
  const input=groupInput.parse(raw);
  return sqlite.transaction(()=>{
    assertProjectManager(requireAuthorizationActor(actor),projectId);requireActiveProject(projectId);
    const id=input.id||randomUUID(),now=new Date().toISOString();
    const ordered=(sqlite.prepare('SELECT id FROM requirement_groups WHERE project_id=? ORDER BY sort_order,name,id').all(projectId) as Array<{id:string}>).map(g=>g.id).filter(value=>value!==id);
    if(input.id){
      const changed=sqlite.prepare('UPDATE requirement_groups SET name=?,sort_order=?,version=version+1,updated_at=? WHERE id=? AND project_id=? AND version=?').run(input.name,input.sortOrder,now,id,projectId,input.expectedVersion??0);
      if(!changed.changes)fail('分组已变化，请刷新核对','STALE_WRITE',409);
    }else sqlite.prepare('INSERT INTO requirement_groups(id,project_id,name,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,projectId,input.name,input.sortOrder,now,now);
    ordered.splice(Math.min(input.sortOrder,ordered.length),0,id);
    for(const [order,groupId] of ordered.entries())sqlite.prepare('UPDATE requirement_groups SET sort_order=?,version=version+1,updated_at=? WHERE id=? AND sort_order<>?').run(order,now,groupId,order);
    recordAudit(actor,'update','project',projectId,'保存需求分组：'+input.name);
    return readIntakeCatalog(projectId,actor);
  }).immediate();
}
export function deleteGroup(projectId:string,id:string,expectedVersion:number,actor:Actor) {
  return sqlite.transaction(()=>{
    assertProjectManager(requireAuthorizationActor(actor),projectId);requireActiveProject(projectId);
    if(!sqlite.prepare('SELECT 1 FROM requirement_groups WHERE id=? AND project_id=? AND version=?').get(id,projectId,expectedVersion))fail('分组已变化，请刷新核对','STALE_WRITE',409);
    sqlite.prepare('UPDATE requirements SET group_id=NULL,version=version+1,updated_at=? WHERE group_id=?').run(new Date().toISOString(),id);
    sqlite.prepare('DELETE FROM requirement_groups WHERE id=?').run(id);
    recordAudit(actor,'update','project',projectId,'删除分组，所属需求移入未分组');
    return readIntakeCatalog(projectId,actor);
  }).immediate();
}
export function updateOrganization(projectId:string,raw:unknown,actor:Actor) {
  const input=organizationInput.parse(raw);
  return sqlite.transaction(()=>{
    assertProjectManager(requireAuthorizationActor(actor),projectId);requireActiveProject(projectId);validateOrganization(projectId,input);
    if(new Set(input.requirements.map(r=>r.id)).size!==input.requirements.length)fail('所选需求重复');
    for(const r of input.requirements){
      const current=sqlite.prepare('SELECT status FROM requirements WHERE id=? AND project_id=? AND version=? AND deleted_at IS NULL').get(r.id,projectId,r.expectedVersion) as {status:string}|undefined;
      if(!current)fail('需求已变化，请刷新核对','STALE_WRITE',409);
      if(['completed','cancelled'].includes(current.status))fail('已结束需求请使用纠错修改资料');
      persistOrganization(r.id,projectId,input);
      sqlite.prepare('UPDATE requirements SET version=version+1,updated_at=? WHERE id=?').run(new Date().toISOString(),r.id);
      recordAudit(actor,'update','requirement',r.id,'调整需求分组与标签');
    }
    return readIntakeCatalog(projectId,actor);
  }).immediate();
}
export function persistDocuments(projectId:string,documents:SourceDocumentInput[]) {
  const now=new Date().toISOString();
  if(new Set(documents.map(d=>d.key)).size!==documents.length)fail('来源文档标识重复');
  for(const d of documents){
    if(new Set(d.clauses.map(c=>c.key)).size!==d.clauses.length)fail('同一文档中的条款标识重复');
    const previous=sqlite.prepare('SELECT id FROM source_documents WHERE project_id=? AND source_key=?').get(projectId,d.key) as {id:string}|undefined;
    const id=previous?.id||randomUUID();
    sqlite.prepare(`INSERT INTO source_documents(id,project_id,source_key,title,url,source_version,complete,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(project_id,source_key) DO UPDATE SET title=excluded.title,url=excluded.url,source_version=excluded.source_version,complete=excluded.complete,updated_at=excluded.updated_at`).run(id,projectId,d.key,d.title,d.url,d.version,Number(d.complete),now,now);
    for(const c of d.clauses){
      const old=sqlite.prepare('SELECT c.id,c.deferred_reason AS deferredReason,c.current_revision_id AS revisionId,v.section,v.external_id AS externalId,v.title,v.content,v.priority FROM source_clauses c JOIN source_revisions v ON v.id=c.current_revision_id WHERE c.document_id=? AND c.source_key=?').get(id,c.key) as ({id:string;revisionId:string;deferredReason:string}&SourceRevision)|undefined;
      const clauseId=old?.id||randomUUID();
      const changed=!old||(['section','externalId','title','content','priority'] as const).some(k=>old[k]!==c[k]);
      const revisionId=changed?randomUUID():old!.revisionId;
      sqlite.prepare(`INSERT INTO source_clauses(id,document_id,source_key,current_revision_id,deferred_reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(document_id,source_key) DO UPDATE SET current_revision_id=excluded.current_revision_id,deferred_reason=excluded.deferred_reason,updated_at=excluded.updated_at`).run(clauseId,id,c.key,revisionId,c.deferredReason??old?.deferredReason??'',now,now);
      if(changed)sqlite.prepare('INSERT INTO source_revisions(id,clause_id,document_version,section,external_id,title,content,priority,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(revisionId,clauseId,d.version,c.section,c.externalId,c.title,c.content,c.priority,now);
    }
  }
}
export function saveSources(projectId:string,raw:unknown,actor:Actor) {
  const input=sourceWriteInput.parse(raw);
  return sqlite.transaction(()=>{
    assertProjectManager(requireAuthorizationActor(actor),projectId);requireActiveProject(projectId);assertIntakeRevision(projectId,input.expectedRevision);
    persistDocuments(projectId,input.documents);recordAudit(actor,'update','project',projectId,'更新来源文档与条款');return readIntakeCatalog(projectId,actor);
  }).immediate();
}
function assertLinkEdit(projectId:string,requirementId:string,expectedVersion:number,reason:string|undefined,actor:Actor) {
  requireActiveProject(projectId);assertRequirementOwnerOrManager(requireAuthorizationActor(actor),requirementId);
  const r=sqlite.prepare('SELECT status,version FROM requirements WHERE id=? AND project_id=? AND deleted_at IS NULL').get(requirementId,projectId) as {status:string;version:number}|undefined;
  if(!r)notFound('需求不存在');
  if(r.version!==expectedVersion)fail('需求已变化，请刷新核对','STALE_WRITE',409);
  if(['completed','cancelled'].includes(r.status)){assertProjectManager(requireAuthorizationActor(actor),projectId);if(!reason?.trim())fail('已结束需求修改来源须填写纠错原因');}
}
export function persistLink(requirementId:string,workItemId:string|null,clauseId:string,scope:string,revisionId:string) {
  const now=new Date().toISOString();
  const previous=sqlite.prepare("SELECT id FROM source_links WHERE requirement_id=? AND coalesce(work_item_id,'')=? AND clause_id=?").get(requirementId,workItemId||'',clauseId) as {id:string}|undefined;
  if(previous)sqlite.prepare('UPDATE source_links SET scope=?,reviewed_revision_id=?,updated_at=? WHERE id=?').run(scope,revisionId,now,previous.id);
  else sqlite.prepare('INSERT INTO source_links(id,clause_id,requirement_id,work_item_id,scope,reviewed_revision_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),clauseId,requirementId,workItemId,scope,revisionId,now,now);
}
export function saveSourceLink(projectId:string,raw:unknown,actor:Actor) {
  const v=sourceLinkInput.parse(raw);
  return sqlite.transaction(()=>{
    assertLinkEdit(projectId,v.requirementId,v.expectedVersion,v.reason,actor);
    const clause=sqlite.prepare('SELECT c.current_revision_id AS revision FROM source_clauses c JOIN source_documents d ON d.id=c.document_id WHERE c.id=? AND d.project_id=?').get(v.clauseId,projectId) as {revision:string}|undefined;
    if(!clause)fail('条款不属于当前项目');
    if(v.workItemId&&!sqlite.prepare('SELECT 1 FROM work_items WHERE id=? AND requirement_id=?').get(v.workItemId,v.requirementId))fail('工作项不属于此需求');
    if(v.reviewedRevisionId&&clause.revision!==v.reviewedRevisionId)fail('来源内容已更新，请重新核对','STALE_WRITE',409);
    persistLink(v.requirementId,v.workItemId,v.clauseId,v.scope,clause.revision);
    sqlite.prepare('UPDATE requirements SET version=version+1,updated_at=? WHERE id=?').run(new Date().toISOString(),v.requirementId);
    recordAudit(actor,'update','requirement',v.requirementId,'修改来源落实范围：'+v.scope+(v.reason?'；纠错：'+v.reason:''));return readIntakeCatalog(projectId,actor);
  }).immediate();
}
export function deleteSourceLink(projectId:string,id:string,raw:unknown,actor:Actor) {
  const v=sourceLinkDeleteInput.parse(raw);
  return sqlite.transaction(()=>{
    assertLinkEdit(projectId,v.requirementId,v.expectedVersion,v.reason,actor);
    if(!sqlite.prepare('DELETE FROM source_links WHERE id=? AND requirement_id=?').run(id,v.requirementId).changes)notFound('关联不存在');
    sqlite.prepare('UPDATE requirements SET version=version+1,updated_at=? WHERE id=?').run(new Date().toISOString(),v.requirementId);
    recordAudit(actor,'update','requirement',v.requirementId,'移除来源关联'+(v.reason?'；纠错：'+v.reason:''));return readIntakeCatalog(projectId,actor);
  }).immediate();
}
export function deferSourceClause(projectId:string,id:string,raw:unknown,actor:Actor) {
  const v=deferClauseInput.parse(raw);
  return sqlite.transaction(()=>{
    assertProjectManager(requireAuthorizationActor(actor),projectId);requireActiveProject(projectId);assertIntakeRevision(projectId,v.expectedRevision);
    if(!sqlite.prepare('UPDATE source_clauses SET deferred_reason=?,updated_at=? WHERE id=? AND document_id IN (SELECT id FROM source_documents WHERE project_id=?)').run(v.reason,new Date().toISOString(),id,projectId).changes)notFound('条款不存在');
    recordAudit(actor,'update','project',projectId,v.reason?'暂缓条款：'+v.reason:'恢复条款安排');return readIntakeCatalog(projectId,actor);
  }).immediate();
}
