import { createHash, randomUUID } from 'node:crypto';
import { deliveryImpact, deliveryTargetChange } from '../../shared/delivery-impact';
import { decorateForecastBasis } from '../../shared/forecast-basis';
import { applyDependencyChangesInput, dependencyChangesInput, type DependencyChangeReceipt, type DependencyChangesInput } from '../../shared/path-contracts';
import { dependencySource, dependencyTarget, remapPathNodeId } from '../../shared/paths';
import type { Actor } from '../auth';
import { assertProjectManager, assertProjectReadable, requireAuthorizationActor } from '../authorization';
import { getDatabaseContext } from '../database-context';
import { fail, notFound } from '../errors';
import { recordAudit } from './audit';
import { loadBlockerCoordination } from './blocker-coordination';
import { persistCommitment, prepareCommitment } from './commitments';
import { persistDirectEstimates } from './direct-estimates';
import { persistEditorEntities, prepareEditorEntities, prepareEditorLayouts } from './editor-entities';
import { withFeatureContext } from './feature-context';
import { persistFeatureRelationChanges, prepareFeatureRelationChanges, readFeatures } from './features';
import { persistForecastReviews, recordForecastReviews } from './forecast-reviews';
import { settleMilestones } from './milestones';
import { analyseChecked as analyse, normalizePathEstimates, persistPathEstimates } from './path-estimates';
import { assertRelationAccess, checkedRevision, insertDependency, loadPathInput } from './paths';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Preview and commit use the same final network, never a sequence of public single-item writes. */
function prepare(projectId: string, input: DependencyChangesInput, actor: Actor) {
  const current = requireAuthorizationActor(actor);
  assertProjectReadable(current, projectId);
  checkedRevision(projectId, input.expectedRevision);
  const snapshot = loadPathInput(projectId);
  const before=analyse(structuredClone(snapshot), input.target);
  const { add, remove, estimates,entities=[],layouts=[],featureRelations=[] } = input.changes;
  const features=prepareFeatureRelationChanges(projectId,featureRelations,actor);
  const beforeEstimates=new Map(snapshot.workItems.filter(w=>estimates.some(p=>p.workItemId===w.id)).map(w=>[w.id,{durationDays:w.durationDays,earliestStart:w.earliestStart,unblockEstimate:w.unblockEstimate,forecastEnd:w.forecastEnd}]));
  if (!add.length && !remove.length && !estimates.length&&!entities.length&&!layouts.length&&!featureRelations.length&&!input.changes.commitment) fail('没有需要保存的修改');
  if (new Set(remove).size !== remove.length || new Set(add.map(e => e.clientId)).size !== add.length
    || new Set(estimates.map(e => e.workItemId)).size !== estimates.length) fail('批次中存在重复修改');
  const expanded=prepareEditorEntities(snapshot,entities,actor);
  const deletedWorkIds=new Set(entities.filter(c=>c.entity==='work'&&c.op==='delete').map(c=>c.id));
  const autoRemoved=(e:typeof snapshot.dependencies[number])=>deletedWorkIds.has(e.sourceWorkItemId||'')||deletedWorkIds.has(e.targetWorkItemId||'');
  const removed=snapshot.dependencies.filter(e=>remove.includes(e.id)||autoRemoved(e));
  for(const id of remove){
    const edge=snapshot.dependencies.find(e=>e.id===id);
    if(!edge)fail('要移除的依赖已经不存在','STALE_WRITE',409,{dependencyIds:[id]});
    if(autoRemoved(edge))continue;
    if(expanded.get(edge.sourceRequirementId)?.dependencies.some(e=>e.id===id))assertProjectManager(current,projectId);
    else assertRelationAccess(edge,actor);
  }
  snapshot.dependencies=snapshot.dependencies.filter(e=>!removed.some(r=>r.id===e.id));
  if(entities.some(c=>c.data.ownerId!==undefined||Object.keys(c.data).some(k=>k.startsWith('blocked')))){
    const blocked=[...snapshot.requirements,...snapshot.workItems].filter(v=>v.status==='blocked');
    const coordinations=loadBlockerCoordination(projectId,blocked.map(v=>({id:v.id,owner_id:v.ownerId||null,blocked_coordinator_id:v.blockedCoordinatorId||null,blocked_next_review_at:v.blockedNextReviewAt||null,blocked_issue_id:v.blockedIssueId||null})));
    for(const value of blocked)value.blockerCoordination=coordinations[value.id];
  }
  prepareEditorLayouts(snapshot,layouts,actor);
  const createdRequirements=new Set(entities.filter(c=>c.entity==='requirement'&&c.op==='create').map(c=>c.id));
  for (const { clientId, ...value } of add) {
    const edge = { ...value, id: clientId, projectId, origin: 'manual' };
    if(createdRequirements.has(edge.sourceRequirementId)||createdRequirements.has(edge.targetRequirementId))assertProjectManager(current,projectId);else assertRelationAccess(edge, actor);
    for(const [req,work,milestone] of [[edge.sourceRequirementId,edge.sourceWorkItemId,edge.sourceMilestoneId],[edge.targetRequirementId,edge.targetWorkItemId,edge.targetMilestoneId]]){
      if(milestone){if(work||!snapshot.milestones?.some(m=>m.id===milestone&&(m.requirementId||'')===req&&!m.cancelled))fail('里程碑端点无效');}
      else {if(!snapshot.requirements.some(r=>r.id===req&&!r.deletedAt))fail('需求端点无效');if(work&&!snapshot.workItems.some(w=>w.id===work&&w.requirementId===req))fail('工作项端点无效');}
    }
    if(snapshot.milestones?.some(m=>m.id===edge.targetMilestoneId&&m.achievedAt)||snapshot.workItems.some(w=>w.id===edge.targetWorkItemId&&['completed','cancelled'].includes(w.status))||snapshot.requirements.some(r=>r.id===edge.targetRequirementId&&['completed','cancelled'].includes(r.status)))fail('已结束交付不能增加前置');
    if (snapshot.dependencies.some(e => dependencySource(e)===dependencySource(edge)&&dependencyTarget(e)===dependencyTarget(edge))) fail('这条依赖已经存在', 'DEPENDENCY_CONFLICT');
    if (snapshot.dependencies.some(e => e.id === clientId)) fail('新增关系标识重复');
    snapshot.dependencies.push(edge);
  }
  normalizePathEstimates(snapshot,estimates,actor,entities);
  const directEstimateIds=entities.filter(c=>c.entity==='requirement'&&c.op!=='delete'&&(c.data.forecastEnd!==undefined||c.data.reviewForecast)).map(c=>c.id);
  const analysis = withFeatureContext(analyse(snapshot, input.target),snapshot.requirements,actor);
  analysis.featureContext!.relations=features.after;
  recordForecastReviews(snapshot,analysis,input.changes,actor);decorateForecastBasis(snapshot,analysis);
  const validIds=new Set([...analysis.nodes.map(n=>n.id),...snapshot.requirements.map(r=>r.id)]);
  const featureIds=layouts.some(l=>l.scope==='features')?new Set([
    'feature:unassigned',
    ...(getDatabaseContext().sqlite.prepare('SELECT id FROM features WHERE project_id=?').all(projectId) as {id:string}[]).map(g=>'feature:'+g.id),
    ...(snapshot.milestones||[]).filter(m=>!m.requirementId).map(m=>m.id),
  ]):new Set<string>();
  for(const layout of layouts)for(const id of Object.keys(layout.positions))if(!(layout.scope==='features'?featureIds:validIds).has(id))fail('布局包含失效节点');
  const commitment=input.changes.commitment?prepareCommitment(snapshot,input.changes.commitment,actor):undefined;
  return { snapshot, analysis,commitment, expanded,directEstimateIds,features,expectedRevision: input.expectedRevision, asOfDate: snapshot.asOfDate,
    differences:{commitment,target:deliveryTargetChange(before,analysis),impact:deliveryImpact(before,analysis),added:add,removed,entities,featureRelations,estimates:estimates.map(p=>({workItemId:p.workItemId,before:beforeEstimates.get(p.workItemId)!,after:analysis.nodes.find(n=>n.id===p.workItemId)!.estimate}))},
    previewToken: hash({ contract:'template-drafts-v2', projectId, ...input, templates:[...expanded.values()].map(e=>[e.key,e.version]), asOfDate: snapshot.asOfDate,
      ...(featureRelations.length?{features:{relations:features.before,groups:readFeatures(projectId,'all').map(g=>[g.id,g.version,g.archivedAt])}}:{}) }),
    count: add.length + remove.length + estimates.length+entities.length+layouts.length+featureRelations.length+Number(!!input.changes.commitment) };
}

export function previewDependencyChanges(projectId: string, raw: unknown, actor: Actor) {
  return getDatabaseContext().sqlite.transaction(() => {
    const result = prepare(projectId, dependencyChangesInput.parse(raw), actor);
    return { analysis: result.analysis, expectedRevision: result.expectedRevision, asOfDate: result.asOfDate,
      previewToken: result.previewToken, count: result.count, differences:result.differences,templateInstances:[...result.expanded.values()].map(({requirementId,key,entities,dependencies})=>({requirementId,key,entities,dependencies})) };
  })();
}

type ReceiptRow = { batch_id: string; project_id: string; actor_type: string; actor_id: string; content_hash: string;
  committed_revision: number; added_ids: string; created_at: string };
const readReceipt = (batchId: string) => getDatabaseContext().sqlite.prepare('SELECT * FROM dependency_change_receipts WHERE batch_id=?').get(batchId) as ReceiptRow | undefined;
function receiptValue(row: ReceiptRow): DependencyChangeReceipt {
  return { batchId: row.batch_id, committedRevision: row.committed_revision, addedIds: JSON.parse(row.added_ids), createdAt: row.created_at };
}
function assertReceipt(row: ReceiptRow, projectId: string, actor: Actor) {
  assertProjectReadable(requireAuthorizationActor(actor), projectId);
  if (row.project_id !== projectId || row.actor_type !== actor.type || row.actor_id !== actor.id) notFound('未找到本账号的提交回执');
}
export function getDependencyChangeReceipt(projectId: string, batchId: string, actor: Actor) {
  assertProjectReadable(requireAuthorizationActor(actor), projectId);
  const row = readReceipt(batchId);
  if (!row) return { status: 'not_found' as const };
  assertReceipt(row, projectId, actor);
  return { status: 'applied' as const, ...receiptValue(row) };
}
export function applyDependencyChanges(projectId: string, raw: unknown, actor: Actor): DependencyChangeReceipt {
  const parsed = applyDependencyChangesInput.parse(raw);
  const { batchId, previewToken, ...input } = parsed;
  const contentHash = hash(input);
  return getDatabaseContext().sqlite.transaction(() => {
    assertProjectReadable(requireAuthorizationActor(actor), projectId);
    const receipt = readReceipt(batchId);
    if (receipt) {
      assertReceipt(receipt, projectId, actor);
      if (receipt.content_hash !== contentHash) fail('批次标识已经用于另一组修改', 'DEPENDENCY_CONFLICT');
      return receiptValue(receipt);
    }
    const prepared = prepare(projectId, input, actor);
    if (previewToken !== prepared.previewToken) fail('预览已失效，请重新预览', 'STALE_WRITE');
    // Client IDs are arbitrary strings, including Object.prototype property names.
    const addedIds: Record<string, string> = Object.create(null), now = new Date().toISOString();
    const temporaryIds=[...input.changes.add.map(c=>c.clientId),...(input.changes.entities||[]).filter(c=>c.op==='create').map(c=>c.id),...(input.changes.featureRelations||[]).filter(c=>c.op==='create').map(c=>c.id)];
    if(new Set(temporaryIds).size!==temporaryIds.length)fail('不同对象不能共用临时标识');
    Object.assign(addedIds,persistFeatureRelationChanges(projectId,input.changes.featureRelations||[],prepared.features.before,actor));
    for (const id of input.changes.remove) getDatabaseContext().sqlite.prepare('DELETE FROM dependency_edges WHERE id=?').run(id);
    Object.assign(addedIds,persistEditorEntities(prepared.snapshot,input.changes.entities||[],prepared.expanded,actor,input.changes.remove));
    const mapId=(id:string|null|undefined)=>id?addedIds[id]||id:null;
    for (const edge of input.changes.add) {
      const id = randomUUID(); addedIds[edge.clientId] = id;
      insertDependency({ id, projectId, sourceRequirementId: mapId(edge.sourceRequirementId)||'', sourceWorkItemId: mapId(edge.sourceWorkItemId),
        targetRequirementId: mapId(edge.targetRequirementId)||'', targetWorkItemId: mapId(edge.targetWorkItemId),sourceMilestoneId:mapId(edge.sourceMilestoneId),targetMilestoneId:mapId(edge.targetMilestoneId), origin: 'manual' });
    }
    persistPathEstimates({...prepared.snapshot,workItems:prepared.snapshot.workItems.map(w=>({...w,id:mapId(w.id)!,arrangementAnchor:w.arrangementAnchor?remapPathNodeId(w.arrangementAnchor,addedIds):null}))},input.changes.estimates.map(p=>({...p,workItemId:mapId(p.workItemId)!})));
    persistDirectEstimates(prepared.snapshot,prepared.directEstimateIds,addedIds);
    if(input.changes.add.length||input.changes.remove.length||input.changes.entities?.length)settleMilestones(projectId,actor);
    // Validate the persisted final network before writing a success receipt, never an intermediate graph.
    const final=loadPathInput(projectId),finalTarget=remapPathNodeId(input.target,addedIds);
    if(input.changes.estimates.some(p=>p.reviewForecast)||input.changes.entities?.some(p=>p.data.reviewForecast)){
      const mapped={...input.changes,estimates:input.changes.estimates.map(p=>({...p,workItemId:mapId(p.workItemId)!})),entities:input.changes.entities?.map(p=>({...p,id:mapId(p.id)!}))};
      // Reviews must reference the persisted endpoint IDs, including objects created in this batch.
      for(const p of mapped.estimates)if(p.reviewForecast)final.workItems.find(w=>w.id===p.workItemId)!.forecastReview=null;
      for(const p of mapped.entities||[])if(p.entity==='requirement'&&p.data.reviewForecast)final.requirements.find(r=>r.id===p.id)!.forecastReview=null;
      recordForecastReviews(final,analyse(final,finalTarget),mapped,actor);persistForecastReviews(final,mapped);
    }else analyse(final,finalTarget);
    for(const layout of input.changes.layouts||[]){
      const mapped=(id:string)=>remapPathNodeId(id,addedIds);
      const scope=layout.scope.startsWith('requirement:')?'requirement:'+mapId(layout.scope.slice(12)):layout.scope;
      getDatabaseContext().sqlite.prepare('INSERT INTO diagram_layouts(project_id,scope,direction,positions,version,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(project_id,scope,direction) DO UPDATE SET positions=excluded.positions,version=excluded.version,updated_at=excluded.updated_at').run(projectId,scope,layout.direction,JSON.stringify(Object.fromEntries(Object.entries(layout.positions).map(([id,p])=>[mapped(id),p]))),layout.expectedVersion+1,now);
    }
    if(prepared.commitment){const commitment=persistCommitment(prepared.commitment.value,batchId,addedIds,now);recordAudit(actor,'confirm_delivery_commitment','project',projectId,'确认项目交付承诺：'+commitment.reason);}
    recordAudit(actor, 'apply_dependency_changes', 'project', projectId, '保存 ' + prepared.count + ' 项画布修改');
    const revision = (getDatabaseContext().sqlite.prepare('SELECT analysis_revision AS revision FROM projects WHERE id=?').get(projectId) as { revision: number }).revision;
    getDatabaseContext().sqlite.prepare('INSERT INTO dependency_change_receipts (batch_id,project_id,actor_type,actor_id,content_hash,committed_revision,added_ids,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(batchId, projectId, actor.type, actor.id, contentHash, revision, JSON.stringify(addedIds), now);
    return { batchId, committedRevision: revision, addedIds, createdAt: now };
  }).immediate();
}
