import { createHash, randomUUID } from 'node:crypto';
import { requirementCommitments } from '../../shared/commitments';
import { deliveryImpact } from '../../shared/delivery-impact';
import { businessDayDelta, businessDaysInclusive, initialWorkEstimates, todayIso } from '../../shared/domain';
import { applyDependencyPlanInput, dependencyInput, dependencyPlanInput, pathEstimateInput, pathVersion, reviewDependenciesInput } from '../../shared/path-contracts';
import { acceptanceId, analysePaths, dependencySource, dependencyTarget, type Dependency, type DiagramLayout, type PathAnalysis, type PathInput, type PathMilestone, type PathRequirement, type PathWork } from '../../shared/paths';
import { readReferenceLinks } from '../../shared/reference-links';
import type { Actor } from '../auth';
import { assertProjectManager, assertProjectReadable, assertRequirementOwnerOrManager, assertWorkItemParticipantOrManager, requireAuthorizationActor } from '../authorization';
import { config } from '../config';
import { getDatabaseContext } from '../database-context';
import { fail, notFound } from '../errors';
import { recordAudit } from './audit';
import { loadBlockerCoordination } from './blocker-coordination';
import { loadCommitments } from './commitments';
import { persistForecastReviews, recordForecastReviews } from './forecast-reviews';
import { refreshPathAssignments } from './path-assignments';
import { analyseChecked, normalizePathEstimates, persistPathEstimates } from './path-estimates';

const all = <T>(sql: string, ...args: unknown[]) => getDatabaseContext().sqlite.prepare(sql).all(...args) as T[];
const one = <T>(sql: string, ...args: unknown[]) => getDatabaseContext().sqlite.prepare(sql).get(...args) as T | undefined;
export const dependencySelect = `SELECT id, project_id AS projectId, coalesce(source_requirement_id,'') AS sourceRequirementId, source_work_item_id AS sourceWorkItemId,
 coalesce(target_requirement_id,'') AS targetRequirementId, target_work_item_id AS targetWorkItemId, source_milestone_id AS sourceMilestoneId,target_milestone_id AS targetMilestoneId, origin FROM dependency_edges`;

/** Raw snapshot loader deliberately does not call listRequirements: filters and risk enrichment must not truncate the graph. */
export function loadPathInput(projectId: string, asOfDate = todayIso()): PathInput {
  const project = one<{ name: string; revision: number; plannedEnd: string | null }>('SELECT name, analysis_revision AS revision, planned_end AS plannedEnd FROM projects WHERE id=?', projectId);
  if (!project) notFound('项目不存在');
  const requirements = all<PathRequirement>(`SELECT r.sort_order AS sortOrder,r.phase_id AS phaseId,r.stage_reset_at AS stageResetAt,r.feature_id AS featureId,(SELECT CASE WHEN kind='other' THEN '其他需求' ELSE name END FROM features WHERE id=r.feature_id) AS featureName,r.delivery_scope AS deliveryScope,r.execution_mode AS executionMode,r.acceptance_owner_id AS acceptanceOwnerId,
    r.forecast_review AS forecastReview,r.blocked_coordinator_id AS blockedCoordinatorId,r.blocked_next_review_at AS blockedNextReviewAt,r.blocked_issue_id AS blockedIssueId,r.actual_start AS actualStart,r.actual_end AS actualEnd,r.blocked_at AS blockedAt,r.blocked_reason AS blockedReason,
    r.forecast_duration AS forecastDuration,r.forecast_ready_at AS forecastReadyAt,r.duration_days AS durationDays,r.forecast_end AS forecastEnd,r.unblock_estimate AS unblockEstimate,r.split_base_progress AS splitBaseProgress,r.split_at AS splitAt,
    r.progress,r.created_at AS createdAt,r.updated_at AS updatedAt,r.id, r.project_id AS projectId, r.title, r.status, r.priority, r.owner_id AS ownerId,
    r.planned_start AS plannedStart, r.planned_end AS plannedEnd, r.accepted_at AS acceptedAt, r.deleted_at AS deletedAt,
    r.dependencies_reviewed_at AS dependenciesReviewedAt, r.schedule_anchor AS scheduleAnchor, r.forecast_acceptance AS forecastAcceptance,
    r.version,r.background,r.acceptance_criteria AS acceptanceCriteria,r.reference_url AS referenceUrl,r.reference_links AS referenceLinks,r.template_id AS templateId,r.acknowledged_dependencies AS acknowledgedDependencies
    FROM requirements r WHERE r.project_id=? ORDER BY r.id`, projectId);
  const workItems = all<PathWork>(`SELECT w.reference_links AS referenceLinks,w.work_stage AS workStage,w.progress_weight AS progressWeight,w.id, w.version, w.requirement_id AS requirementId, w.title, w.status, w.progress, w.owner_id AS ownerId,
    (SELECT json_group_array(c.person_id) FROM work_item_collaborators c WHERE c.work_item_id=w.id) AS assigneeIds,
    w.planned_start AS plannedStart, w.planned_end AS plannedEnd, w.forecast_review AS forecastReview,w.blocked_coordinator_id AS blockedCoordinatorId,w.blocked_next_review_at AS blockedNextReviewAt,w.blocked_issue_id AS blockedIssueId,w.actual_start AS actualStart, w.actual_end AS actualEnd,
    w.duration_days AS durationDays, w.earliest_start AS earliestStart, w.unblock_estimate AS unblockEstimate,w.arrangement,w.arrangement_anchor AS arrangementAnchor,w.acknowledged_dependencies AS acknowledgedDependencies,
    w.forecast_end AS forecastEnd, w.forecast_duration AS forecastDuration, w.forecast_ready_at AS forecastReadyAt,
    w.blocked_at AS blockedAt, w.blocked_reason AS blockedReason, w.milestone_label AS milestoneLabel
    FROM work_items w JOIN requirements r ON r.id=w.requirement_id WHERE r.project_id=? ORDER BY w.id`, projectId);
  for(const value of [...requirements,...workItems])value.forecastReview=value.forecastReview?JSON.parse(String(value.forecastReview)):null;
  for(const value of [...requirements,...workItems])value.referenceLinks=readReferenceLinks(value.referenceLinks,'referenceUrl' in value?value.referenceUrl:null);
  const commitments=loadCommitments(projectId);for(const r of requirements)r.commitment=requirementCommitments(commitments,r.id,r.acceptedAt);
  const coordinations=[...requirements,...workItems].some(v=>v.status==='blocked')?loadBlockerCoordination(projectId):{};for(const value of [...requirements,...workItems])value.blockerCoordination=coordinations[value.id];
  for(const w of workItems)w.assigneeIds=JSON.parse(String(w.assigneeIds||'[]'));
  refreshPathAssignments({projectId,requirements,workItems});
  for(const r of requirements)r.acknowledgedDependencies=JSON.parse(String(r.acknowledgedDependencies||'[]'));
  for(const w of workItems)w.acknowledgedDependencies=JSON.parse(String(w.acknowledgedDependencies||'[]'));
  return { projectId, projectName: project.name, revision: project.revision, projectEnd: project.plannedEnd, highRiskDelayDays: config.highRiskDelayDays, asOfDate, requirements, workItems,
    dependencies: all<Dependency>(`${dependencySelect} WHERE project_id=? ORDER BY id`, projectId),
    milestones:all<PathMilestone>('SELECT id,project_id AS projectId,requirement_id AS requirementId,title,target_date AS targetDate,confirmation_mode AS confirmationMode,achieved_at AS achievedAt,milestone_kind AS milestoneKind,achieved_recorded_at AS achievedRecordedAt,version,cancelled FROM milestones WHERE project_id=?',projectId),
    layouts:all<DiagramLayout>('SELECT scope,direction,version,positions FROM diagram_layouts WHERE project_id=?',projectId).map(l=>({...l,positions:JSON.parse(String(l.positions))})) };
}
export function getPathAnalysis(projectId: string, target = 'project', asOfDate = todayIso()): PathAnalysis {
  return getDatabaseContext().sqlite.transaction(()=>{try{return analysePaths(loadPathInput(projectId,asOfDate),target);}catch(error){fail((error as Error).message,'DEPENDENCY_CONFLICT');}})();
}
export function readPathAnalysis(projectId: string, target: string | undefined, actor: Actor) {
  assertProjectReadable(requireAuthorizationActor(actor), projectId);
  return getPathAnalysis(projectId, target);
}
export function projectPathOverlay(projectId: string, asOfDate = todayIso()) {
  if (!one('SELECT 1 FROM requirements WHERE project_id=? AND dependencies_reviewed_at IS NOT NULL LIMIT 1', projectId)
    && !one('SELECT 1 FROM dependency_edges WHERE project_id=? LIMIT 1', projectId)) return undefined;
  return getPathAnalysis(projectId, 'project', asOfDate);
}
export function pathProjectForRequirement(id: string) {
  const r = one<{ projectId: string }>('SELECT project_id AS projectId FROM requirements WHERE id=? AND deleted_at IS NULL', id);
  if (!r) notFound('需求不存在'); return r.projectId;
}
export function checkedRevision(projectId: string, revision: number) {
  const current = one<{ revision: number }>('SELECT analysis_revision AS revision FROM projects WHERE id=? AND deleted_at IS NULL', projectId);
  if (!current) notFound('项目不存在');
  if (current.revision !== revision) fail('依赖、进度或计划已变化，请刷新后重新核对', 'STALE_WRITE', 409, undefined, current.revision);
}
export function assertRelationAccess(d: Pick<Dependency, 'projectId' | 'sourceRequirementId' | 'targetRequirementId'>, actor: Actor) {
  const current = requireAuthorizationActor(actor);
  if (d.targetRequirementId&&d.sourceRequirementId === d.targetRequirementId) assertRequirementOwnerOrManager(current, d.targetRequirementId);
  else assertProjectManager(current, d.projectId);
}
export function assertEndpoints(d: Omit<Dependency, 'id' | 'origin'>) {
  for (const [req, work,milestone] of [[d.sourceRequirementId, d.sourceWorkItemId,d.sourceMilestoneId], [d.targetRequirementId, d.targetWorkItemId,d.targetMilestoneId]]) {
    if(milestone){if(work||!one('SELECT 1 FROM milestones WHERE id=? AND project_id=? AND coalesce(requirement_id,\'\')=?',milestone,d.projectId,req))fail('里程碑端点无效');continue;}
    if (!one('SELECT 1 FROM requirements WHERE id=? AND project_id=? AND deleted_at IS NULL', req, d.projectId)) fail('依赖端点必须属于当前项目的有效需求');
    if (work && !one('SELECT 1 FROM work_items WHERE id=? AND requirement_id=?', work, req)) fail('工作项不属于所选需求');
  }
  if(one("SELECT 1 FROM requirements WHERE id=? AND status IN ('completed','cancelled')",d.targetRequirementId)||d.targetWorkItemId&&one("SELECT 1 FROM work_items WHERE id=? AND status IN ('completed','cancelled')",d.targetWorkItemId))fail('已结束的交付不能增加前置关系','TERMINAL_LOCKED');
  if(d.targetMilestoneId&&one('SELECT 1 FROM milestones WHERE id=? AND (achieved_at IS NOT NULL OR cancelled=1)',d.targetMilestoneId))fail('已结束里程碑不能增加前置');
  if (d.sourceWorkItemId && d.sourceWorkItemId === d.targetWorkItemId) fail('工作项不能依赖自身');
}
export function addDependency(projectId: string, raw: unknown, actor: Actor) {
  const { expectedRevision, ...value } = dependencyInput.parse(raw);
  return getDatabaseContext().sqlite.transaction(() => {
    const d = { ...value, projectId }; assertRelationAccess(d, actor); checkedRevision(projectId, expectedRevision); assertEndpoints(d);
    const input = loadPathInput(projectId);
    if (input.dependencies.some(e => dependencySource(e)===dependencySource({...d,id:'',origin:''})&&dependencyTarget(e)===dependencyTarget({...d,id:'',origin:''}))) fail('这条依赖已存在', 'DEPENDENCY_CONFLICT');
    const edge: Dependency = { ...d, id: randomUUID(), origin: 'manual' };
    try { analysePaths({ ...input, dependencies: [...input.dependencies, edge] }); } catch (error) { fail((error as Error).message, 'DEPENDENCY_CONFLICT'); }
    insertDependency(edge);
    recordAudit(actor, 'add_dependency', d.targetRequirementId?'requirement':'project', d.targetRequirementId||d.projectId, '增加交付前置关系');
    return getPathAnalysis(projectId);
  }).immediate();
}
export function insertDependency(d: Dependency) {
  const now = new Date().toISOString();
  getDatabaseContext().sqlite.prepare(`INSERT INTO dependency_edges (id,project_id,source_requirement_id,source_work_item_id,target_requirement_id,target_work_item_id,source_milestone_id,target_milestone_id,origin,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(d.id, d.projectId, d.sourceRequirementId||null, d.sourceWorkItemId, d.targetRequirementId||null, d.targetWorkItemId,d.sourceMilestoneId||null,d.targetMilestoneId||null, d.origin, now, now);
}
export function removeDependency(id: string, raw: unknown, actor: Actor) {
  const { expectedRevision } = pathVersion.parse(raw);
  return getDatabaseContext().sqlite.transaction(() => {
    const d = one<Dependency>(`${dependencySelect} WHERE id=?`, id); if (!d) notFound('依赖不存在');
    assertRelationAccess(d, actor); checkedRevision(d.projectId, expectedRevision);
    getDatabaseContext().sqlite.prepare('DELETE FROM dependency_edges WHERE id=?').run(id);
    recordAudit(actor, 'remove_dependency', d.targetRequirementId?'requirement':'project', d.targetRequirementId||d.projectId, '移除交付前置关系');
    return getPathAnalysis(d.projectId);
  }).immediate();
}
export function reviewDependencies(id: string, raw: unknown, actor: Actor) {
  const input = reviewDependenciesInput.parse(raw);
  return getDatabaseContext().sqlite.transaction(() => {
    const projectId = pathProjectForRequirement(id), current = requireAuthorizationActor(actor);
    if (input.forecastAcceptance !== undefined) assertProjectManager(current, projectId); else assertRequirementOwnerOrManager(current, id);
    checkedRevision(projectId, input.expectedRevision);
    if (input.forecastAcceptance && input.forecastAcceptance < todayIso()) fail('预计验收日期不能早于今天');
    if (input.reviewed !== undefined) getDatabaseContext().sqlite.prepare('UPDATE requirements SET dependencies_reviewed_at=?, version=version+1, updated_at=? WHERE id=?')
      .run(input.reviewed ? new Date().toISOString() : null, new Date().toISOString(), id);
    if (input.forecastAcceptance !== undefined) getDatabaseContext().sqlite.prepare('UPDATE requirements SET forecast_acceptance=?,version=version+1,updated_at=? WHERE id=?')
      .run(input.forecastAcceptance, new Date().toISOString(), id);
    recordAudit(actor, 'review_dependencies', 'requirement', id, input.reviewed === false ? '标记依赖待核对' : input.reviewed ? '核对全部前置（无前置项按独立工作处理）' : '更新预计验收日期');
    return getPathAnalysis(projectId, acceptanceId(id));
  }).immediate();
}
export function updatePathEstimate(id: string, raw: unknown, actor: Actor) {
  const input = pathEstimateInput.parse(raw);
  return getDatabaseContext().sqlite.transaction(() => {
    const w = one<{ requirementId: string; status: string }>('SELECT requirement_id AS requirementId,status FROM work_items WHERE id=?', id); if (!w) notFound('工作项不存在');
    const projectId = pathProjectForRequirement(w.requirementId), current = requireAuthorizationActor(actor);
    if (input.durationDays !== undefined || input.earliestStart !== undefined || input.arrangement !== undefined || input.arrangementAnchor !== undefined) assertRequirementOwnerOrManager(current, w.requirementId);
    else assertWorkItemParticipantOrManager(current, id);
    checkedRevision(projectId, input.expectedRevision);
    const snapshot=loadPathInput(projectId);
    const patch={reviewForecast:input.reviewForecast,durationDays:input.durationDays,earliestStart:input.earliestStart,unblockEstimate:input.unblockEstimate,forecastEnd:input.forecastEnd,arrangement:input.arrangement,arrangementAnchor:input.arrangementAnchor};
    const patches=[{...patch,workItemId:id}];
    normalizePathEstimates(snapshot,patches,actor);analyseChecked(snapshot);
    const reviewChanges={add:[],remove:[],estimates:patches};recordForecastReviews(snapshot,analyseChecked(snapshot),reviewChanges,actor);
    persistPathEstimates(snapshot,patches);persistForecastReviews(snapshot,reviewChanges);
    recordAudit(actor, 'estimate_path', 'work_item', id, '更新工期、开始约束或交付预测');
    return getPathAnalysis(projectId, acceptanceId(w.requirementId));
  }).immediate();
}
export function previewDependencyPlan(id: string, raw: unknown, actor: Actor) {
  const { baseStart, expectedRevision } = dependencyPlanInput.parse(raw), projectId = pathProjectForRequirement(id);
  assertProjectManager(requireAuthorizationActor(actor), projectId); checkedRevision(projectId, expectedRevision);
  if (baseStart < todayIso() || businessDaysInclusive(baseStart, baseStart) !== 1) fail('开始锚点必须为今天或之后的工作日');
  return getDatabaseContext().sqlite.transaction(() => {
    const input = loadPathInput(projectId);
    const before=analysePaths(input);
    const current = input.requirements.find(r => r.id === id)!;
    if (['completed', 'cancelled'].includes(current.status)) fail('已结束需求不能重排', 'TERMINAL_LOCKED');
    current.scheduleAnchor = baseStart;
    const analysis = analysePaths(input);
    if (!current.dependenciesReviewedAt) fail('请先核对当前需求的依赖');
    // Include affected downstream requirements. Started work is a fixed execution fact.
    const scope = new Set([id]); let changed = true;
    while (changed) { changed = false; for (const e of input.dependencies) if (scope.has(e.sourceRequirementId) && !scope.has(e.targetRequirementId)) { scope.add(e.targetRequirementId); changed = true; } }
    const entries = analysis.nodes.filter(n => ['work','execution'].includes(n.kind) && scope.has(n.requirementId!) && n.status === 'not_started').map(n => ({
      workItemId: n.id,kind:n.kind, requirementId: n.requirementId!, title: n.title, currentStart: n.plannedStart, currentEnd: n.plannedEnd,
      proposedStart: n.forecastStart, proposedEnd: n.forecastEnd, reasons: n.unknownReasons,
    }));
    const preview = { requirementId: id, projectId, baseStart, expectedRevision, asOfDate: input.asOfDate, entries,impact:deliveryImpact(before,analysis) };
    return { ...preview, previewToken: createHash('sha256').update(JSON.stringify(preview)).digest('hex'), applicable: entries.length > 0 && entries.every(e => !!e.proposedStart && !!e.proposedEnd) };
  })();
}
export function applyDependencyPlan(id: string, raw: unknown, actor: Actor) {
  const input = applyDependencyPlanInput.parse(raw);
  return getDatabaseContext().sqlite.transaction(() => {
    const preview = previewDependencyPlan(id, { baseStart: input.baseStart, expectedRevision: input.expectedRevision }, actor);
    if (input.previewToken !== preview.previewToken) fail('预览已失效，请重新预览', 'STALE_WRITE');
    if (!preview.applicable) fail('存在待确认的交付条件，暂不能应用');
    const now = new Date().toISOString();
    getDatabaseContext().sqlite.prepare('UPDATE requirements SET schedule_anchor=?,version=version+1,updated_at=? WHERE id=?').run(input.baseStart, now, id);
    const affected = new Set<string>();
    for (const e of preview.entries) {
      if(e.kind==='execution')getDatabaseContext().sqlite.prepare("UPDATE requirements SET planned_start=?,planned_end=?,version=version+1,updated_at=? WHERE id=? AND status='not_started'").run(e.proposedStart,e.proposedEnd,now,e.requirementId);
      else {
        const work = one<PathWork>('SELECT status,planned_start AS plannedStart,planned_end AS plannedEnd,duration_days AS durationDays,progress_weight AS progressWeight FROM work_items WHERE id=?', e.workItemId)!;
        const estimate = initialWorkEstimates(work);
        getDatabaseContext().sqlite.prepare("UPDATE work_items SET duration_days=COALESCE(duration_days,?),progress_weight=COALESCE(progress_weight,?),planned_start=?,planned_end=?,version=version+1,updated_at=? WHERE id=? AND status='not_started'")
          .run(estimate.durationDays || businessDaysInclusive(e.proposedStart,e.proposedEnd) || null, estimate.progressWeight, e.proposedStart, e.proposedEnd, now, e.workItemId);
      }
      affected.add(e.requirementId);
    }
    for (const requirementId of affected) if(!preview.entries.some(e=>e.requirementId===requirementId&&e.kind==='execution'))getDatabaseContext().sqlite.prepare(`UPDATE requirements SET planned_start=(SELECT MIN(planned_start) FROM work_items WHERE requirement_id=? AND status<>'cancelled'),
      planned_end=(SELECT MAX(planned_end) FROM work_items WHERE requirement_id=? AND status<>'cancelled'),version=version+1,updated_at=? WHERE id=?`).run(requirementId, requirementId, now, requirementId);
    recordAudit(actor, 'apply_dependency_plan', 'requirement', id, `按依赖调整 ${preview.entries.length} 项未开始工作，涉及 ${affected.size} 个需求`);
    return getPathAnalysis(preview.projectId, acceptanceId(id));
  }).immediate();
}

/** Direct prerequisites, including whole-requirement entry constraints, for execution controls. */
export function startConditions(requirementIds: string[]) {
  if (!requirementIds.length) return new Map<string,{dependencyRevision:number;unmetPredecessors:Array<{id:string;title:string}>}>();
  const marks=requirementIds.map(()=>'?').join(',');
  const values=all<{workId:string;revision:number;sourceId:string|null;title:string|null}>(`SELECT w.id AS workId,p.analysis_revision AS revision,
    CASE WHEN d.source_milestone_id IS NOT NULL THEN sm.id WHEN d.source_work_item_id IS NULL THEN r.id ELSE sw.id END AS sourceId,
    CASE WHEN d.source_milestone_id IS NOT NULL THEN sm.title WHEN d.source_work_item_id IS NULL THEN r.title || ' · 验收' ELSE r.title || ' · ' || sw.title END AS title
    FROM work_items w JOIN requirements own ON own.id=w.requirement_id JOIN projects p ON p.id=own.project_id
    JOIN dependency_edges d ON d.target_requirement_id=w.requirement_id AND (d.target_work_item_id=w.id OR d.target_work_item_id IS NULL)
    LEFT JOIN requirements r ON r.id=d.source_requirement_id LEFT JOIN work_items sw ON sw.id=d.source_work_item_id LEFT JOIN milestones sm ON sm.id=d.source_milestone_id
    WHERE d.target_milestone_id IS NULL AND NOT EXISTS(SELECT 1 FROM json_each(w.acknowledged_dependencies) WHERE value=d.id) AND (d.target_work_item_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM json_each(own.acknowledged_dependencies) WHERE value=d.id)) AND w.status='not_started' AND w.requirement_id IN (${marks}) AND (
      (d.source_milestone_id IS NOT NULL AND (sm.achieved_at IS NULL OR sm.cancelled=1)) OR (d.source_milestone_id IS NULL AND d.source_work_item_id IS NULL AND NOT(r.status='completed' AND r.accepted_at IS NOT NULL)) OR
      (d.source_work_item_id IS NOT NULL AND NOT(sw.status='completed' AND sw.actual_end IS NOT NULL)))`,...requirementIds);
  const result=new Map<string,{dependencyRevision:number;unmetPredecessors:Array<{id:string;title:string}>}>();
  for(const v of values){const value=result.get(v.workId)||{dependencyRevision:v.revision,unmetPredecessors:[]};
    if(v.sourceId&&!value.unmetPredecessors.some(p=>p.id===v.sourceId))value.unmetPredecessors.push({id:v.sourceId,title:v.title!});result.set(v.workId,value);}
  return result;
}
export function assertStartConditions(workId:string,requirementId:string,input:{reason?:unknown;expectedDependencyRevision?:unknown}) {
  if(input.expectedDependencyRevision!==undefined){const project=one<{revision:number}>('SELECT p.analysis_revision AS revision FROM projects p JOIN requirements r ON r.project_id=p.id WHERE r.id=?',requirementId);if(project?.revision!==input.expectedDependencyRevision)fail('前置条件已经变化，请重新读取并核对后开始','STALE_WRITE',409);}
  const conditions=startConditions([requirementId]).get(workId);
  if(!conditions?.unmetPredecessors.length)return;
  if(typeof input.reason!=='string'||!input.reason.trim())fail(`前置尚未交付：${conditions.unmetPredecessors.map(p=>p.title).join('、')}。核对后可说明执行例外原因再开始。`,'DEPENDENCY_CONFLICT',409);
  if(input.expectedDependencyRevision!==conditions.dependencyRevision)fail('前置条件已经变化，请重新读取并核对后开始','STALE_WRITE',409);
  const snapshot=loadPathInput(pathProjectForRequirement(requirementId)),unmet=new Set(conditions.unmetPredecessors.map(p=>p.id));
  const edges=snapshot.dependencies.filter(d=>d.targetRequirementId===requirementId&&!d.targetMilestoneId&&(!d.targetWorkItemId||d.targetWorkItemId===workId)&&unmet.has(d.sourceMilestoneId||d.sourceWorkItemId||d.sourceRequirementId));
  const req=snapshot.requirements.find(r=>r.id===requirementId)!,work=snapshot.workItems.find(w=>w.id===workId)!;
  getDatabaseContext().sqlite.prepare('UPDATE requirements SET acknowledged_dependencies=? WHERE id=?').run(JSON.stringify([...new Set([...(req.acknowledgedDependencies||[]),...edges.filter(d=>!d.targetWorkItemId).map(d=>d.id)])]),requirementId);
  getDatabaseContext().sqlite.prepare('UPDATE work_items SET acknowledged_dependencies=? WHERE id=?').run(JSON.stringify([...new Set([...(work.acknowledgedDependencies||[]),...edges.filter(d=>d.targetWorkItemId).map(d=>d.id)])]),workId);
  return conditions.unmetPredecessors;
}

/** Freeze a manual effort estimate during a block; waiting days must not consume remaining work. */
export function adjustForecastClock(id:string,action:'block'|'unblock',today:string) {
  const w=one<{duration:number|null;ready:string|null}>('SELECT forecast_duration AS duration,forecast_ready_at AS ready FROM work_items WHERE id=?',id);
  if(!w?.duration||!w.ready)return;
  const duration=action==='block'?Math.max(1,w.duration-Math.max(0,businessDayDelta(w.ready,today))):w.duration;
  getDatabaseContext().sqlite.prepare('UPDATE work_items SET forecast_duration=?,forecast_ready_at=? WHERE id=?').run(duration,today,id);
}
