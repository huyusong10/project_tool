import {sqlite} from '../database';
import {fail,forbidden} from '../errors';
import {optionalDateSchema,optionalIdSchema} from '../../shared/contracts';
import type {BlockerCoordination} from '../../shared/blocker-coordination';
import type {Actor} from '../auth';
import {recordAudit} from './audit';
import {coordinationKeys} from '../../shared/blocker-coordination';
import {canManageProject,canContributeProject,isRequirementOwner,isWorkItemAssignee,assertProjectReadable,requireAuthorizationActor} from '../authorization';
import {randomUUID} from 'node:crypto';
export function isCoordinationEdit(value:unknown):value is Record<string,unknown> {
  return !!value&&typeof value==='object'&&!Array.isArray(value)&&coordinationKeys.some(k=>Object.hasOwn(value,k))&&Object.keys(value).every(k=>coordinationKeys.some(c=>c===k)||k==='reason'||k==='expectedVersion');
}
export function assertCoordinationAccess(kind:'requirement'|'work',id:string,value:Record<string,unknown>,actor:Actor) {
  const current=requireAuthorizationActor(actor);
  const r=sqlite.prepare(kind==='work'?'SELECT w.requirement_id AS requirementId,r.project_id AS projectId,w.status FROM work_items w JOIN requirements r ON r.id=w.requirement_id WHERE w.id=? AND r.deleted_at IS NULL':'SELECT id AS requirementId,project_id AS projectId,status FROM requirements WHERE id=? AND deleted_at IS NULL').get(id) as {requirementId:string;projectId:string;status:string}|undefined;
  if(!r)fail('跟进对象已失效');assertProjectReadable(current,r.projectId);
  if(r.status!=='blocked')fail('只有阻塞对象可以修改协调信息');
  if(canManageProject(current,r.projectId)||canContributeProject(current,r.projectId)&&(isRequirementOwner(current,r.requirementId)||kind==='work'&&isWorkItemAssignee(current,id)))return;
  const coordination=loadBlockerCoordination(r.projectId)[id];
  if(!canContributeProject(current,r.projectId)||!current.personId||coordination?.coordinatorId!==current.personId||coordination.issueId||!isCoordinationEdit(value)||Object.keys(value).some(k=>!['blockedNextReviewAt','reason','expectedVersion'].includes(k)))forbidden('协调人只能更新自己的跟进说明和下次核对日期；关联问题请在问题中处理');
  // Permission is checked against persisted assignment, never an assignment submitted in this batch.
}
export function validateCoordination(projectId:string,value:Record<string,unknown>) {
  const blockedCoordinatorId=optionalIdSchema.parse(value.blockedCoordinatorId)||null,
    blockedNextReviewAt=optionalDateSchema.parse(value.blockedNextReviewAt)||null,
    blockedIssueId=optionalIdSchema.parse(value.blockedIssueId)||null;
  if(blockedIssueId&&!sqlite.prepare('SELECT 1 FROM issues WHERE id=? AND project_id=?').get(blockedIssueId,projectId))fail('关联问题必须属于当前项目');
  if(!blockedIssueId&&blockedCoordinatorId&&!sqlite.prepare("SELECT 1 FROM project_people pp JOIN people p ON p.id=pp.person_id JOIN accounts a ON a.person_id=p.id WHERE pp.project_id=? AND p.id=? AND pp.project_role IN ('member','manager') AND p.active=1 AND p.deleted_at IS NULL AND a.status='active' AND a.deleted_at IS NULL").get(projectId,blockedCoordinatorId))fail('协调人必须是当前项目的有效成员');
  return {blockedCoordinatorId:blockedIssueId?null:blockedCoordinatorId,blockedNextReviewAt:blockedIssueId?null:blockedNextReviewAt,blockedIssueId};
}
export function persistCoordination(kind:'requirement'|'work',id:string,projectId:string,value:Record<string,unknown>,actor:Actor) {
  const v=validateCoordination(projectId,value),table=kind==='requirement'?'requirements':'work_items';
  sqlite.prepare(`UPDATE ${table} SET blocked_coordinator_id=?,blocked_next_review_at=?,blocked_issue_id=? WHERE id=?`).run(v.blockedCoordinatorId,v.blockedNextReviewAt,v.blockedIssueId,id);
  recordAudit(actor,'coordinate_blocker',kind==='work'?'work_item':'requirement',id,'阻塞协调信息：'+JSON.stringify(v));
  const content=String(value.reason||'').trim();
  if(content){const r=sqlite.prepare(kind==='work'?'SELECT r.id,r.progress FROM requirements r JOIN work_items w ON w.requirement_id=r.id WHERE w.id=?':'SELECT id,progress FROM requirements WHERE id=?').get(id) as {id:string;progress:number};const now=new Date().toISOString();sqlite.prepare("INSERT INTO progress_updates(id,requirement_id,work_item_id,percent,content,event_type,created_by_account_id,created_at,updated_at) VALUES (?,?,?,?,?,'note',?,?,?)").run(randomUUID(),r.id,kind==='work'?id:null,r.progress,'阻塞跟进：'+content,actor.accountId||null,now,now);}
}
/** One project read, independent of visible filters. Permission filtering is applied to action results. */
type CoordinationRow={id:string;owner_id:string|null;blocked_coordinator_id:string|null;blocked_next_review_at:string|null;blocked_issue_id:string|null};
export function loadBlockerCoordination(projectId:string,overrides?:CoordinationRow[]):Record<string,BlockerCoordination> {
  const rows=overrides||sqlite.prepare(`SELECT r.id,r.owner_id,r.blocked_coordinator_id,r.blocked_next_review_at,r.blocked_issue_id FROM requirements r WHERE r.project_id=? AND r.status='blocked'
    UNION ALL SELECT w.id,w.owner_id,w.blocked_coordinator_id,w.blocked_next_review_at,w.blocked_issue_id FROM work_items w JOIN requirements r ON r.id=w.requirement_id WHERE r.project_id=? AND w.status='blocked'`).all(projectId,projectId) as CoordinationRow[];
  if(!rows.length)return {};
  const people=new Map((sqlite.prepare("SELECT p.id,p.name FROM project_people pp JOIN people p ON p.id=pp.person_id JOIN accounts a ON a.person_id=p.id WHERE pp.project_id=? AND pp.project_role IN ('member','manager') AND p.active=1 AND p.deleted_at IS NULL AND a.status='active' AND a.deleted_at IS NULL").all(projectId) as {id:string;name:string}[]).map(p=>[p.id,p.name]));
  const issues=new Map((sqlite.prepare('SELECT id,title,owner_id,next_review_at,status FROM issues WHERE project_id=?').all(projectId) as {id:string;title:string;owner_id:string|null;next_review_at:string|null;status:string}[]).map(i=>[i.id,i]));
  return Object.fromEntries(rows.map(r=>{
    const issue=r.blocked_issue_id?issues.get(r.blocked_issue_id):undefined;
    const owner=issue?.status==='resolved'?r.owner_id:issue?issue.owner_id:r.blocked_coordinator_id||r.owner_id;
    return [r.id,{coordinatorId:owner&&people.has(owner)?owner:null,coordinatorName:owner&&people.get(owner)||'项目经理',nextReviewAt:issue?issue.next_review_at:r.blocked_next_review_at,
      issueId:issue?.id||null,issueTitle:issue?.title||null,issueResolved:issue?.status==='resolved'}];
  }));
}
