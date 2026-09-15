import { sqlite } from '../database';
import type { AuthorizationActor } from '../authorization';
import { assertProjectManager, assertProjectReadable, assertProjectResourceReadable, projectIdForWorkItem } from '../authorization';
import { notFound } from '../errors';
import { requirementQuerySchema, workItemQuerySchema, progressQuerySchema } from '../../shared/query-contracts';
import { isOverdueByWorkday, todayIso } from '../../shared/domain';
import { listRequirements, loadWorkItemsByRequirementIds } from './requirements';
import { getPathAnalysis } from './paths';
import { deliveryForecast } from '../../shared/forecast-basis';
import {compareProgressNames,compareProgressTitles,matchesProgressStatus,matchesProgressStage} from '../../shared/progress-query';
import type {WorkStage} from '../../shared/execution-stage';

function pageInfo(total: number, page: number, pageSize: number) {
  return { total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** New paged reads leave the existing array-shaped requirement endpoint unchanged. */
export function queryRequirements(raw: unknown, actor: AuthorizationActor) {
  const input = requirementQuerySchema.parse(raw);
  if (input.includeDeleted) assertProjectManager(actor, input.projectId);
  else assertProjectReadable(actor, input.projectId);
  return sqlite.transaction(() => {
    const q = input.q?.toLocaleLowerCase();
    const values = listRequirements(input).filter(r => {
      if(!matchesProgressStatus(r.status,input.statuses,input.excludeStatuses)||!matchesProgressStage(r.status,r.executionStage,input.stage||''))return false;
      if (q && ![r.title, r.background, r.acceptanceCriteria, r.ownerName].some(v => v?.toLocaleLowerCase().includes(q))) return false;
      if (input.participantId && r.ownerId !== input.participantId && !r.workItems?.some(w => w.assigneeIds.includes(input.participantId!))) return false;
      if (input.from && (!r.plannedEnd && !r.plannedStart || (r.plannedEnd || r.plannedStart)! < input.from)) return false;
      if (input.to && (!r.plannedStart && !r.plannedEnd || (r.plannedStart || r.plannedEnd)! > input.to)) return false;
      return true;
    });
    values.sort(input.sort==='updated'?(a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id):compareProgressTitles);
    const items = values.slice((input.page - 1) * input.pageSize, input.page * input.pageSize).map(r => {
      if (input.includeWorkItems) return r;
      const { workItems, ...summary } = r;
      return { ...summary, workItemCount: workItems?.length || 0 };
    });
    return { items, ...pageInfo(values.length, input.page, input.pageSize), asOfDate: todayIso() };
  })();
}

type WorkReference = { id: string; title:string; status:string; workStage:WorkStage|null; sortOrder:number; createdAt:string; updatedAt:string; plannedEnd:string|null; requirementId: string; requirementTitle: string; requirementStatus: string; projectId: string; projectName: string; featureId:string|null;featureName:string|null;phaseId:string|null;phaseName:string|null };
const workFrom = 'FROM work_items w JOIN requirements r ON r.id=w.requirement_id JOIN projects p ON p.id=r.project_id LEFT JOIN features f ON f.id=r.feature_id LEFT JOIN feature_phases ph ON ph.id=r.phase_id';
const workReference = 'SELECT w.id,w.title,w.status,w.work_stage AS workStage,w.sort_order AS sortOrder,w.created_at AS createdAt,w.updated_at AS updatedAt,w.planned_end AS plannedEnd,w.requirement_id AS requirementId,r.title AS requirementTitle,r.status AS requirementStatus,r.project_id AS projectId,p.name AS projectName,r.feature_id AS featureId,f.name AS featureName,r.phase_id AS phaseId,ph.name AS phaseName';

function workDetails(references: WorkReference[]) {
  const statuses = new Map(references.map(r => [r.requirementId, r.requirementStatus]));
  const loaded = loadWorkItemsByRequirementIds([...statuses.keys()], statuses);
  const work = new Map([...loaded.workItems.values()].flat().map(w => [w.id, w]));
  const analyses = new Map([...new Set(references.map(r => r.projectId))].map(id => [id, getPathAnalysis(id)]));
  return references.map(reference => {
    const item = work.get(reference.id)!;
    const node = analyses.get(reference.projectId)!.nodes.find(n => n.id === item.id);
    return { ...item, ...reference, deliveryForecast: deliveryForecast(node, analyses.get(reference.projectId)!), forecastBasis: node?.forecastBasis, blockerCoordination: node?.blockerCoordination,
      overdue: !['completed', 'cancelled'].includes(item.status) && isOverdueByWorkday(item.plannedEnd, todayIso()) };
  });
}

export function readWorkItem(id: string, actor: AuthorizationActor) {
  assertProjectResourceReadable(actor, projectIdForWorkItem(id), '工作项不存在');
  return sqlite.transaction(() => {
    const reference = sqlite.prepare(`${workReference} ${workFrom} WHERE w.id=? AND r.deleted_at IS NULL AND p.deleted_at IS NULL`).get(id) as WorkReference | undefined;
    if (!reference) notFound('工作项不存在');
    return workDetails([reference])[0];
  })();
}

export function queryWorkItems(raw: unknown, actor: AuthorizationActor) {
  const input = workItemQuerySchema.parse(raw);
  assertProjectReadable(actor, input.projectId);
  return sqlite.transaction(() => {
    const where = ['r.project_id=?', 'r.deleted_at IS NULL', 'p.deleted_at IS NULL'];
    const params: unknown[] = [input.projectId];
    const add = (clause: string, ...values: unknown[]) => { where.push(clause); params.push(...values); };
    if (input.requirementId) add('r.id=?', input.requirementId);
    if (input.featureId) input.featureId==='unassigned'?add('r.feature_id IS NULL'):add('r.feature_id=?',input.featureId);
    if (input.phaseId) input.phaseId==='unassigned'?add('r.phase_id IS NULL'):add('r.phase_id=?',input.phaseId);
    if (input.workStage) input.workStage==='unclassified'?add('w.work_stage IS NULL'):add('w.work_stage=?',input.workStage);
    if (input.ownerId) add('w.owner_id=?', input.ownerId);
    if (input.participantId) add('(w.owner_id=? OR EXISTS(SELECT 1 FROM work_item_collaborators c WHERE c.work_item_id=w.id AND c.person_id=?))', input.participantId, input.participantId);
    if (input.status) add('w.status=?', input.status);
    if (input.active || input.overdue) add("w.status NOT IN ('completed','cancelled')");
    if (input.overdue) add('business_day_delta(w.planned_end,?)>0', todayIso());
    if (input.unassigned) add('w.owner_id IS NULL');
    if (input.q) add('(search_score(w.title,?)>0 OR search_score(r.title,?)>0)', input.q, input.q);
    if (input.from) add('COALESCE(w.planned_end,w.planned_start)>=?', input.from);
    if (input.to) add('COALESCE(w.planned_start,w.planned_end)<=?', input.to);
    const clause = `${workFrom} WHERE ${where.join(' AND ')}`;
    // Sort lightweight references before pagination; only load full details for the requested page.
    const references = (sqlite.prepare(`${workReference} ${clause}`).all(...params) as WorkReference[])
      .filter(w=>matchesProgressStatus(w.status,input.statuses,input.excludeStatuses));
    references.sort((a,b)=>{
      if(input.sort==='updated')return b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id);
      if(input.sort==='planned_end')return (a.plannedEnd||'9999-12-31').localeCompare(b.plannedEnd||'9999-12-31')||b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id);
      if(input.sort==='name')return compareProgressTitles(a,b);
      return compareProgressNames(a.requirementTitle,b.requirementTitle)||a.requirementId.localeCompare(b.requirementId)||a.sortOrder-b.sortOrder||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id);
    });
    const page=references.slice((input.page-1)*input.pageSize,input.page*input.pageSize);
    return { items: workDetails(page), ...pageInfo(references.length, input.page, input.pageSize), asOfDate: todayIso() };
  })();
}

/** Append-only history uses a rowid snapshot so new entries do not shift later pages. */
export function queryProgressUpdates(raw: unknown, actor: AuthorizationActor) {
  const input = progressQuerySchema.parse(raw);
  assertProjectReadable(actor, input.projectId);
  return sqlite.transaction(() => {
    const { latest } = sqlite.prepare('SELECT COALESCE(MAX(u.rowid),0) AS latest FROM progress_updates u JOIN requirements r ON r.id=u.requirement_id WHERE r.project_id=? AND r.deleted_at IS NULL').get(input.projectId) as { latest: number };
    const snapshot = Math.min(input.snapshot ?? latest, latest);
    const where = ['r.project_id=?', 'r.deleted_at IS NULL', 'u.rowid<=?'];
    const params: unknown[] = [input.projectId, snapshot];
    const add = (clause: string, value: unknown) => { where.push(clause); params.push(value); };
    if (input.requirementId) add('r.id=?', input.requirementId);
    if (input.workItemId) add('u.work_item_id=?', input.workItemId);
    if (input.authorAccountId) add('u.created_by_account_id=?', input.authorAccountId);
    if (input.eventType) add('u.event_type=?', input.eventType);
    if (input.q) add('search_plain_match(u.content,?)=1', input.q);
    if (input.from) add('u.created_at>=?', new Date(input.from + 'T00:00:00.000+08:00').toISOString());
    if (input.to) add('u.created_at<=?', new Date(input.to + 'T23:59:59.999+08:00').toISOString());
    const from = `FROM progress_updates u JOIN requirements r ON r.id=u.requirement_id LEFT JOIN work_items w ON w.id=u.work_item_id LEFT JOIN accounts a ON a.id=u.created_by_account_id WHERE ${where.join(' AND ')}`;
    const { total } = sqlite.prepare(`SELECT COUNT(*) AS total ${from}`).get(...params) as { total: number };
    const items = sqlite.prepare(`SELECT u.id,r.project_id AS projectId,u.requirement_id AS requirementId,r.title AS requirementTitle,
      u.work_item_id AS workItemId,w.title AS workItemTitle,u.percent,u.work_item_percent AS workItemPercent,
      u.content,u.event_type AS eventType,u.supersedes_id AS supersedesId,u.created_by_account_id AS createdByAccountId,
      a.username AS createdByName,u.created_at AS createdAt,u.updated_at AS updatedAt ${from}
      ORDER BY u.created_at DESC,u.rowid DESC LIMIT ? OFFSET ?`).all(...params, input.pageSize, (input.page - 1) * input.pageSize);
    return { items, ...pageInfo(total, input.page, input.pageSize), snapshot, timeZone: 'Asia/Shanghai' };
  })();
}
