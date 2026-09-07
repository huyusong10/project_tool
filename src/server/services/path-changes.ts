import {analyseChecked as analyse,normalizePathEstimates,persistPathEstimates} from './path-estimates';
import { createHash, randomUUID } from 'node:crypto';
import { sqlite } from '../database';
import type { Actor } from '../auth';
import { assertProjectReadable, requireAuthorizationActor } from '../authorization';
import { fail, notFound } from '../errors';
import { applyDependencyChangesInput, dependencyChangesInput, type DependencyChangesInput, type DependencyChangeReceipt } from '../../shared/path-contracts';
import { assertEndpoints, assertRelationAccess, checkedRevision, insertDependency, loadPathInput } from './paths';
import { recordAudit } from './audit';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Preview and commit use the same final network, never a sequence of public single-item writes. */
function prepare(projectId: string, input: DependencyChangesInput, actor: Actor) {
  const current = requireAuthorizationActor(actor);
  assertProjectReadable(current, projectId);
  checkedRevision(projectId, input.expectedRevision);
  const snapshot = loadPathInput(projectId);
  const { add, remove, estimates } = input.changes;
  const removed=snapshot.dependencies.filter(e=>remove.includes(e.id));
  const beforeEstimates=new Map(snapshot.workItems.filter(w=>estimates.some(p=>p.workItemId===w.id)).map(w=>[w.id,{durationDays:w.durationDays,earliestStart:w.earliestStart,unblockEstimate:w.unblockEstimate,forecastEnd:w.forecastEnd}]));
  if (!add.length && !remove.length && !estimates.length) fail('没有需要保存的修改');
  if (new Set(remove).size !== remove.length || new Set(add.map(e => e.clientId)).size !== add.length
    || new Set(estimates.map(e => e.workItemId)).size !== estimates.length) fail('批次中存在重复修改');
  for (const id of remove) {
    const edge = snapshot.dependencies.find(e => e.id === id);
    if (!edge) fail('要移除的依赖已经不存在', 'STALE_WRITE', 409, { dependencyIds: [id] });
    assertRelationAccess(edge, actor);
  }
  snapshot.dependencies = snapshot.dependencies.filter(e => !remove.includes(e.id));
  for (const { clientId, ...value } of add) {
    const edge = { ...value, id: clientId, projectId, origin: 'manual' };
    assertRelationAccess(edge, actor); assertEndpoints(edge);
    if (snapshot.dependencies.some(e => e.sourceRequirementId === edge.sourceRequirementId && e.sourceWorkItemId === edge.sourceWorkItemId
      && e.targetRequirementId === edge.targetRequirementId && e.targetWorkItemId === edge.targetWorkItemId)) fail('这条依赖已经存在', 'DEPENDENCY_CONFLICT');
    if (snapshot.dependencies.some(e => e.id === clientId)) fail('新增关系标识重复');
    snapshot.dependencies.push(edge);
  }
  normalizePathEstimates(snapshot,estimates,actor);
  const analysis = analyse(snapshot, input.target);
  return { snapshot, analysis, expectedRevision: input.expectedRevision, asOfDate: snapshot.asOfDate,
    differences:{added:add,removed,estimates:estimates.map(p=>({workItemId:p.workItemId,before:beforeEstimates.get(p.workItemId)!,after:analysis.nodes.find(n=>n.id===p.workItemId)!.estimate}))},
    previewToken: hash({ projectId, ...input, asOfDate: snapshot.asOfDate }),
    count: add.length + remove.length + estimates.length };
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
    for (const edge of input.changes.add) {
      const id = randomUUID(); addedIds[edge.clientId] = id;
      insertDependency({ id, projectId, sourceRequirementId: edge.sourceRequirementId, sourceWorkItemId: edge.sourceWorkItemId,
        targetRequirementId: edge.targetRequirementId, targetWorkItemId: edge.targetWorkItemId, origin: 'manual' });
    }
    persistPathEstimates(prepared.snapshot,input.changes.estimates);
    recordAudit(actor, 'apply_dependency_changes', 'project', projectId, '保存 ' + prepared.count + ' 项依赖与工期修改');
    const revision = (sqlite.prepare('SELECT analysis_revision AS revision FROM projects WHERE id=?').get(projectId) as { revision: number }).revision;
    sqlite.prepare('INSERT INTO dependency_change_receipts (batch_id,project_id,actor_type,actor_id,content_hash,committed_revision,added_ids,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(batchId, projectId, actor.type, actor.id, contentHash, revision, JSON.stringify(addedIds), now);
    return { batchId, committedRevision: revision, addedIds, createdAt: now };
  }).immediate();
}
