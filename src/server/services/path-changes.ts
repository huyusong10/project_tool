import {normalizeDirectEstimates,persistDirectEstimates} from './direct-estimates';
import {deliveryImpact,deliveryTargetChange} from '../../shared/delivery-impact';
import {analyseChecked as analyse,normalizePathEstimates,persistPathEstimates} from './path-estimates';
import { createHash, randomUUID } from 'node:crypto';
import { sqlite } from '../database';
import type { Actor } from '../auth';
import { assertProjectReadable,assertProjectManager, requireAuthorizationActor } from '../authorization';
import { fail, notFound } from '../errors';
import { applyDependencyChangesInput, dependencyChangesInput, type DependencyChangesInput, type DependencyChangeReceipt } from '../../shared/path-contracts';
import { assertRelationAccess, checkedRevision, insertDependency, loadPathInput } from './paths';
import { recordAudit } from './audit';
import {prepareEditorEntities,prepareEditorLayouts,persistEditorEntities} from './editor-entities';
import {dependencySource,dependencyTarget} from '../../shared/paths';
import {settleMilestones} from './milestones';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Preview and commit use the same final network, never a sequence of public single-item writes. */
function prepare(projectId: string, input: DependencyChangesInput, actor: Actor) {
  const current = requireAuthorizationActor(actor);
  assertProjectReadable(current, projectId);
  checkedRevision(projectId, input.expectedRevision);
  const snapshot = loadPathInput(projectId);
  const before=analyse(structuredClone(snapshot), input.target);
  const { add, remove, estimates,entities=[],layouts=[] } = input.changes;
  const removed=snapshot.dependencies.filter(e=>remove.includes(e.id));
  const beforeEstimates=new Map(snapshot.workItems.filter(w=>estimates.some(p=>p.workItemId===w.id)).map(w=>[w.id,{durationDays:w.durationDays,earliestStart:w.earliestStart,unblockEstimate:w.unblockEstimate,forecastEnd:w.forecastEnd}]));
  if (!add.length && !remove.length && !estimates.length&&!entities.length&&!layouts.length) fail('没有需要保存的修改');
  if (new Set(remove).size !== remove.length || new Set(add.map(e => e.clientId)).size !== add.length
    || new Set(estimates.map(e => e.workItemId)).size !== estimates.length) fail('批次中存在重复修改');
  for (const id of remove) {
    const edge = snapshot.dependencies.find(e => e.id === id);
    if (!edge) fail('要移除的依赖已经不存在', 'STALE_WRITE', 409, { dependencyIds: [id] });
    assertRelationAccess(edge, actor);
  }
  snapshot.dependencies = snapshot.dependencies.filter(e => !remove.includes(e.id));
  const expanded=prepareEditorEntities(snapshot,entities,actor);
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
  normalizePathEstimates(snapshot,estimates,actor);
  const directEstimateIds=entities.filter(c=>c.entity==='requirement'&&c.op!=='delete'&&c.data.forecastEnd!==undefined).map(c=>c.id);
  normalizeDirectEstimates(snapshot,directEstimateIds);
  const analysis = analyse(snapshot, input.target);
  const validIds=new Set([...analysis.nodes.map(n=>n.id),...snapshot.requirements.map(r=>r.id)]);
  for(const layout of layouts)for(const id of Object.keys(layout.positions))if(!validIds.has(id))fail('布局包含失效节点');
  return { snapshot, analysis, expanded,directEstimateIds,expectedRevision: input.expectedRevision, asOfDate: snapshot.asOfDate,
    differences:{target:deliveryTargetChange(before,analysis),impact:deliveryImpact(before,analysis),added:add,removed,entities,estimates:estimates.map(p=>({workItemId:p.workItemId,before:beforeEstimates.get(p.workItemId)!,after:analysis.nodes.find(n=>n.id===p.workItemId)!.estimate}))},
    previewToken: hash({ contract:'delivery-execution-v1', projectId, ...input, asOfDate: snapshot.asOfDate }),
    count: add.length + remove.length + estimates.length+entities.length+layouts.length };
}

export function previewDependencyChanges(projectId: string, raw: unknown, actor: Actor) {
  return sqlite.transaction(() => {
    const result = prepare(projectId, dependencyChangesInput.parse(raw), actor);
    return { analysis: result.analysis, expectedRevision: result.expectedRevision, asOfDate: result.asOfDate,
      previewToken: result.previewToken, count: result.count, differences:result.differences };
  })();
}

type ReceiptRow = { batch_id: string; project_id: string; actor_type: string; actor_id: string; content_hash: string;
  committed_revision: number; added_ids: string; created_at: string };
const readReceipt = (batchId: string) => sqlite.prepare('SELECT * FROM dependency_change_receipts WHERE batch_id=?').get(batchId) as ReceiptRow | undefined;
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
  return sqlite.transaction(() => {
    assertProjectReadable(requireAuthorizationActor(actor), projectId);
    const receipt = readReceipt(batchId);
    if (receipt) {
      assertReceipt(receipt, projectId, actor);
      if (receipt.content_hash !== contentHash) fail('批次标识已经用于另一组修改', 'DEPENDENCY_CONFLICT');
      return receiptValue(receipt);
    }
    const prepared = prepare(projectId, input, actor);
    if (previewToken !== prepared.previewToken) fail('预览已失效，请重新预览', 'STALE_WRITE');
    const addedIds: Record<string, string> = {}, now = new Date().toISOString();
    for (const id of input.changes.remove) sqlite.prepare('DELETE FROM dependency_edges WHERE id=?').run(id);
    Object.assign(addedIds,persistEditorEntities(prepared.snapshot,input.changes.entities||[],prepared.expanded,actor));
    const mapId=(id:string|null|undefined)=>id?addedIds[id]||id:null;
    for (const edge of input.changes.add) {
      const id = randomUUID(); addedIds[edge.clientId] = id;
      insertDependency({ id, projectId, sourceRequirementId: mapId(edge.sourceRequirementId)||'', sourceWorkItemId: mapId(edge.sourceWorkItemId),
        targetRequirementId: mapId(edge.targetRequirementId)||'', targetWorkItemId: mapId(edge.targetWorkItemId),sourceMilestoneId:mapId(edge.sourceMilestoneId),targetMilestoneId:mapId(edge.targetMilestoneId), origin: 'manual' });
    }
    persistPathEstimates({...prepared.snapshot,workItems:prepared.snapshot.workItems.map(w=>({...w,id:mapId(w.id)!,arrangementAnchor:mapId(w.arrangementAnchor)}))},input.changes.estimates.map(p=>({...p,workItemId:mapId(p.workItemId)!})));
    persistDirectEstimates(prepared.snapshot,prepared.directEstimateIds,addedIds);
    if(input.changes.add.length||input.changes.remove.length||input.changes.entities?.length)settleMilestones(projectId,actor);
    for(const layout of input.changes.layouts||[]){
      const mapped=(id:string)=>id.startsWith('execute:')?'execute:'+mapId(id.slice(8)):id.startsWith('start:')?'start:'+mapId(id.slice(6)):id.startsWith('acceptance:')?'acceptance:'+mapId(id.slice(11)):mapId(id)!;
      const scope=layout.scope.startsWith('requirement:')?'requirement:'+mapId(layout.scope.slice(12)):layout.scope;
      sqlite.prepare('INSERT INTO diagram_layouts(project_id,scope,direction,positions,version,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(project_id,scope,direction) DO UPDATE SET positions=excluded.positions,version=excluded.version,updated_at=excluded.updated_at').run(projectId,scope,layout.direction,JSON.stringify(Object.fromEntries(Object.entries(layout.positions).map(([id,p])=>[mapped(id),p]))),layout.expectedVersion+1,now);
    }
    recordAudit(actor, 'apply_dependency_changes', 'project', projectId, '保存 ' + prepared.count + ' 项画布修改');
    const revision = (sqlite.prepare('SELECT analysis_revision AS revision FROM projects WHERE id=?').get(projectId) as { revision: number }).revision;
    sqlite.prepare('INSERT INTO dependency_change_receipts (batch_id,project_id,actor_type,actor_id,content_hash,committed_revision,added_ids,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(batchId, projectId, actor.type, actor.id, contentHash, revision, JSON.stringify(addedIds), now);
    return { batchId, committedRevision: revision, addedIds, createdAt: now };
  }).immediate();
}
