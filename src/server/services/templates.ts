

import { workStageInput, milestoneKindInput, type WorkStage, type MilestoneKind } from '../../shared/execution-stage';

import { createHash, randomUUID } from 'node:crypto';

import { getDatabaseContext } from '../database-context';

import type { Actor } from '../auth';

import { maxTemplateDurationDays, maxTemplateItems, maxTemplateOffsetDays } from '../../shared/domain';

import { normalizeSearchText } from '../../shared/search';

import { fail, notFound } from '../errors';

import { assertProjectManager, assertProjectResourceReadable, requireAuthorizationActor } from '../authorization';

import { recordAudit as audit } from './audit';

import { prepareTemplateGraph, saveTemplateGraph } from './path-templates';

import { requireActiveProject, assertExpectedUpdatedAt, ensureEnum, milestoneLabel, nowIso, nextUpdatedAt, nullableText, requireLabel, requireText, row, rows, templateDescription, type JsonObject } from './support';

import { assertOptionalArchiveGeneration } from './archive-guards';

type TemplateItemInput = import('../../shared/path-template').TemplateDependencyItem & { id?: string; clientKey?: string; predecessorKeys?: string[]; title: string; startOffsetDays: number; durationDays: number; milestoneLabel: string | null; sortOrder: number };

function parseTemplateItems(input: unknown): TemplateItemInput[] {
  if (!Array.isArray(input)) return [];
  if (input.length > maxTemplateItems) fail(`流程工作项不能超过${maxTemplateItems}个`);
  return input.map((value, index) => {
    if (typeof value === 'string') return { title: requireLabel(value, '工作项名称'), startOffsetDays: index, durationDays: 1, milestoneLabel: null, sortOrder: index };
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('流程工作项格式不正确');
    const item = value as JsonObject;
    if (Object.keys(item).some((key) => ![
      'workStage','milestoneKind','id', 'clientKey', 'predecessorKeys', 'title', 'startOffsetDays', 'durationDays', 'milestoneLabel', 'sortOrder', 'kind','arrangement','arrangementAnchor','confirmationMode',
    ].includes(key))) fail('流程工作项不能提交未声明字段');
    const startOffsetDays = Number(item.startOffsetDays ?? index);
    const durationDays = item.kind==='milestone'?0:Number(item.durationDays ?? 1);
    if (!Number.isInteger(startOffsetDays) || startOffsetDays < 0 || startOffsetDays > maxTemplateOffsetDays) fail(`开始偏移必须是0到${maxTemplateOffsetDays}之间的整数`);
    if (!Number.isInteger(durationDays) || durationDays < (item.kind==='milestone'?0:1) || durationDays > maxTemplateDurationDays) fail(`工期必须是1到${maxTemplateDurationDays}之间的整数`);
    return {
      workStage:workStageInput.parse(item.workStage),milestoneKind:milestoneKindInput.parse(item.milestoneKind),
      kind:item.kind===undefined?'work':ensureEnum(item.kind,['work','milestone'] as const,'元素类型'),arrangement:item.arrangement===undefined?'early':ensureEnum(item.arrangement,['early','late'] as const,'安排方式'),arrangementAnchor:nullableText(item.arrangementAnchor),confirmationMode:item.confirmationMode===undefined?'auto':ensureEnum(item.confirmationMode,['auto','manual'] as const,'确认方式'),
      id: nullableText(item.id) || undefined,
      clientKey: nullableText(item.clientKey) || undefined,
      predecessorKeys: item.predecessorKeys === undefined ? undefined : Array.isArray(item.predecessorKeys) ? item.predecessorKeys.map(String) : fail('前置工作项格式不正确'),
      title: requireLabel(item.title, '工作项名称'), startOffsetDays, durationDays,
      milestoneLabel: milestoneLabel(item.milestoneLabel),
      sortOrder: Number.isInteger(Number(item.sortOrder)) ? Number(item.sortOrder) : index,
    };
  });
}

function templateItemsUnchanged(templateId: string, items: TemplateItemInput[]) {
  const current = rows<Required<TemplateItemInput>&{predecessorIds:string}>(`SELECT id, title, sort_order AS sortOrder, predecessor_ids AS predecessorIds,
    start_offset_days AS startOffsetDays, duration_days AS durationDays, work_stage AS workStage,milestone_kind AS milestoneKind,milestone_label AS milestoneLabel,kind,arrangement,arrangement_anchor AS arrangementAnchor,confirmation_mode AS confirmationMode
    FROM template_items WHERE template_id=? AND deleted_at IS NULL ORDER BY sort_order, rowid`, templateId);
  return current.length === items.length && items.every((item, index) => {
    const existing = current[index];
    return (item.workStage||null)===(existing.workStage||null) && (item.milestoneKind||'ordinary')===existing.milestoneKind && item.id === existing.id && item.title === existing.title && index === existing.sortOrder
      && item.startOffsetDays === existing.startOffsetDays && item.durationDays === existing.durationDays
      && item.milestoneLabel === existing.milestoneLabel && (item.kind||'work')===existing.kind && (item.arrangement||'early')===existing.arrangement && (item.arrangementAnchor||null)===(existing.arrangementAnchor||null) && (item.confirmationMode||'auto')===existing.confirmationMode
      && JSON.stringify((JSON.parse(existing.predecessorIds) as string[]).sort()) === JSON.stringify((item.predecessorKeys||[]).map(key=>items.find(i=>(i.clientKey||i.id)===key)?.id).sort());
  });
}

export function listTemplates(projectId?: string | null, includeDeleted = false) {
  if (projectId) requireActiveProject(projectId);
  const templates = rows<any>(`SELECT id, project_id AS projectId, name, description, dependency_mode AS dependencyMode, created_at AS createdAt, updated_at AS updatedAt, deleted_at AS deletedAt
    FROM work_item_templates ${projectId ? 'WHERE project_id=?' : includeDeleted ? '' : 'WHERE deleted_at IS NULL'}
    ${projectId && !includeDeleted ? 'AND deleted_at IS NULL' : ''} ORDER BY created_at`, ...(projectId ? [projectId] : []));
  const itemWhere = [
    ...(projectId ? ['t.project_id=?'] : []),
    ...(!includeDeleted ? ['t.deleted_at IS NULL', 'i.deleted_at IS NULL'] : []),
  ];
  const items = rows<any>(`SELECT i.id, i.template_id AS templateId, i.title, i.sort_order AS sortOrder,
    i.start_offset_days AS startOffsetDays, i.duration_days AS durationDays, i.predecessor_ids AS predecessorIds, i.work_stage AS workStage,i.milestone_kind AS milestoneKind,i.milestone_label AS milestoneLabel, i.kind,i.arrangement,i.arrangement_anchor AS arrangementAnchor,i.confirmation_mode AS confirmationMode, i.deleted_at AS deletedAt
    FROM template_items i JOIN work_item_templates t ON t.id=i.template_id
    ${itemWhere.length ? `WHERE ${itemWhere.join(' AND ')}` : ''} ORDER BY i.sort_order`, ...(projectId ? [projectId] : []));
  return templates.map((template) => ({
    ...template,
    layout:(()=>{const l=row<{positions:string;version:number;direction:string}>('SELECT positions,version,direction FROM diagram_layouts WHERE project_id=? AND scope=? AND direction=?',template.projectId,'template:'+template.id,'right');return l?{...l,positions:JSON.parse(l.positions)}:undefined;})(),
    items: items.filter((item) => item.templateId === template.id && (includeDeleted || !item.deletedAt)).map(item => ({ ...item, predecessorIds: JSON.parse(item.predecessorIds) })),
  }));
}

function assertUniqueTemplateName(projectId: string, name: string, exceptId?: string) {
  const normalized = normalizeSearchText(name);
  const duplicate = rows<{ id: string; name: string }>('SELECT id, name FROM work_item_templates WHERE project_id=? AND deleted_at IS NULL', projectId)
    .find((template) => template.id !== exceptId && normalizeSearchText(template.name) === normalized);
  if (duplicate) fail('当前项目已存在同名流程');
}

export function createTemplate(input:JsonObject,actor:Actor){return templateBatch(null,input,actor);}

export function updateTemplate(id:string,input:JsonObject,actor:Actor){return templateBatch(id,input,actor);}

function templateBatch(id:string|null,raw:JsonObject,actor:Actor){
  const {batchId,layout,...input}=raw;
  if(!batchId&&!layout)return id?updateTemplateCore(id,input,actor):createTemplateCore(input,actor);
  const projectId=id?row<{projectId:string}>('SELECT project_id AS projectId FROM work_item_templates WHERE id=?',id)?.projectId:String(input.projectId||'');
  if(!projectId)notFound('流程不存在');
  return getDatabaseContext().sqlite.transaction(()=>{
    assertProjectManager(requireAuthorizationActor(actor),projectId);
    const hash=createHash('sha256').update(JSON.stringify({id,...raw})).digest('hex');
    if(batchId){const receipt=row<{actorId:string;actorType:string;projectId:string;hash:string;ids:string}>('SELECT actor_id AS actorId,actor_type AS actorType,project_id AS projectId,content_hash AS hash,added_ids AS ids FROM dependency_change_receipts WHERE batch_id=?',batchId);
      if(receipt){if(receipt.actorId!==actor.id||receipt.actorType!==actor.type||receipt.projectId!==projectId)notFound('本账号的提交回执不存在');if(receipt.hash!==hash)fail('批次标识已用于其他内容');return listTemplates(projectId).find(t=>t.id===JSON.parse(receipt.ids).$template);}}
    const result=id?updateTemplateCore(id,input,actor):createTemplateCore(input,actor);
    const submitted=(input.items||[]) as Array<{id?:string;clientKey?:string}>;const ids:Record<string,string>={$template:result.id};submitted.forEach((n,i)=>{ids[n.clientKey||n.id||String(i)]=result.items[i].id;});
    if(layout){const value=layout as {direction:string;expectedVersion:number;positions:Record<string,{x:number;y:number}>},scope='template:'+result.id;
      const existing=row<{version:number}>('SELECT version FROM diagram_layouts WHERE project_id=? AND scope=? AND direction=?',projectId,scope,value.direction);
      if((existing?.version||0)!==value.expectedVersion)fail('流程布局已经变化','STALE_WRITE',409);
      const valid=new Set(result.items.map((i:{id:string})=>i.id)),positions=Object.fromEntries(Object.entries(value.positions).map(([key,p])=>[ids[key]||key,p]));
      if(Object.keys(positions).some(key=>!valid.has(key)))fail('布局包含失效元素');
      getDatabaseContext().sqlite.prepare('INSERT INTO diagram_layouts(project_id,scope,direction,positions,version,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(project_id,scope,direction) DO UPDATE SET positions=excluded.positions,version=excluded.version,updated_at=excluded.updated_at').run(projectId,scope,value.direction,JSON.stringify(positions),value.expectedVersion+1,nowIso());
    }
    if(batchId)getDatabaseContext().sqlite.prepare('INSERT INTO dependency_change_receipts(batch_id,project_id,actor_type,actor_id,content_hash,committed_revision,added_ids,created_at) VALUES (?,?,?,?,?,?,?,?)').run(batchId,projectId,actor.type,actor.id,hash,row<{revision:number}>('SELECT analysis_revision AS revision FROM projects WHERE id=?',projectId)!.revision,JSON.stringify(ids),nowIso());
    return listTemplates(projectId).find(t=>t.id===result.id);
  }).immediate();
}

function createTemplateCore(input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => !['projectId', 'name', 'description', 'items', 'dependencyMode'].includes(key))) {
    fail('新建流程不能提交未声明字段');
  }
  if (Object.prototype.hasOwnProperty.call(input, 'expectedUpdatedAt')) {
    fail('新建流程不能提交更新版本字段');
  }
  const id = randomUUID(); const now = nowIso(); const projectId = requireText(input.projectId, '项目');
  requireActiveProject(projectId);
  const name = requireLabel(input.name, '流程名称');
  assertUniqueTemplateName(projectId, name);
  const description = templateDescription(input.description);
  const mode = String(input.dependencyMode || 'legacy');
  const items = prepareTemplateGraph(parseTemplateItems(input.items), mode);
  if (!items.length) fail('模板至少需要一个工作项');
  const tx = getDatabaseContext().sqlite.transaction(() => {
    getDatabaseContext().sqlite.prepare('INSERT INTO work_item_templates (id, project_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, projectId, name, description, now, now);
    const insert = getDatabaseContext().sqlite.prepare(`INSERT INTO template_items
      (id, template_id, title, sort_order, start_offset_days, duration_days, milestone_label,kind) VALUES (?, ?, ?, ?, ?, ?, ?,?)`);
    items.forEach((item, index) => insert.run(randomUUID(), id, item.title, index, item.startOffsetDays, item.durationDays, item.milestoneLabel,item.kind||'work'));
    saveTemplateGraph(id, mode, items);
    requireActiveProject(projectId, true);
    assertProjectManager(requireAuthorizationActor(actor), projectId);
    audit(actor, 'create', 'template', id, `创建流程：${name}`);
  });
  tx();
  return listTemplates(projectId).find((item: any) => item.id === id);
}

function updateTemplateCore(id: string, input: JsonObject, actor: Actor) {
  if (Object.keys(input).some((key) => !['name', 'description', 'items', 'expectedUpdatedAt', 'dependencyMode'].includes(key))) {
    fail('流程编辑不能提交未声明字段');
  }
  const current = row<{ projectId: string; name: string; description: string; updatedAt: string }>('SELECT project_id AS projectId, name, description, updated_at AS updatedAt FROM work_item_templates WHERE id=? AND deleted_at IS NULL', id);
  if (!current) notFound('模板不存在');
  assertExpectedUpdatedAt(input, current.updatedAt, '流程');
  if (input.projectId !== undefined && requireText(input.projectId, '项目') !== current.projectId) {
    fail('流程不能通过普通编辑迁移到其他项目');
  }
  const name = input.name === undefined ? current.name : requireLabel(input.name, '模板名称');
  assertUniqueTemplateName(current.projectId, name, id);
  const description = input.description === undefined ? current.description : templateDescription(input.description);
  const oldMode = row<{mode:string}>('SELECT dependency_mode AS mode FROM work_item_templates WHERE id=?',id)!.mode;
  const mode = String(input.dependencyMode || oldMode);
  if (oldMode === 'dependencies' && mode !== oldMode) fail('已启用依赖的流程不能退回偏移模式');
  if (mode !== oldMode && input.items === undefined) fail('切换模式必须核对全部工作项');
  const items = input.items === undefined ? null : prepareTemplateGraph(parseTemplateItems(input.items), mode);
  if (items && !items.length) fail('模板至少需要一个工作项');
  if (items) {
    const submittedIds = items.flatMap((item) => item.id ? [item.id] : []);
    if (new Set(submittedIds).size !== submittedIds.length) fail('同一流程工作项不能重复提交');
    const existingIds = new Set(rows<{ id: string }>(
      'SELECT id FROM template_items WHERE template_id=? AND deleted_at IS NULL', id,
    ).map((item) => item.id));
    if (submittedIds.some((itemId) => !existingIds.has(itemId))) {
      fail('流程工作项已失效或不属于当前流程，请刷新后重试');
    }
  }
  if (mode === oldMode && name === current.name && description === current.description && (!items || templateItemsUnchanged(id, items))) {
    getDatabaseContext().sqlite.transaction(() => {
      requireActiveProject(current.projectId, true);
      assertProjectManager(requireAuthorizationActor(actor), current.projectId);
    })();
    return listTemplates(current.projectId).find((item: any) => item.id === id);
  }
  const updatedAt = nextUpdatedAt(current.updatedAt);
  const tx = getDatabaseContext().sqlite.transaction(() => {
    const changed = getDatabaseContext().sqlite.prepare(`UPDATE work_item_templates SET name=?, description=?, updated_at=?
      WHERE id=? AND updated_at=? AND deleted_at IS NULL`).run(name, description, updatedAt, id, current.updatedAt);
    if (!changed.changes) fail('流程已被其他用户修改，请重新打开后再保存', 'STALE_WRITE', 409);
    if (items) {
      const existing = new Set(rows<{ id: string }>('SELECT id FROM template_items WHERE template_id=? AND deleted_at IS NULL', id).map((item) => item.id));
      const kept = new Set<string>();
      const update = getDatabaseContext().sqlite.prepare(`UPDATE template_items SET title=?, sort_order=?, start_offset_days=?, duration_days=?, milestone_label=?,kind=?, deleted_at=NULL
        WHERE id=? AND template_id=?`);
      const insert = getDatabaseContext().sqlite.prepare(`INSERT INTO template_items
        (id, template_id, title, sort_order, start_offset_days, duration_days, milestone_label,kind) VALUES (?, ?, ?, ?, ?, ?, ?,?)`);
      items.forEach((item, index) => {
        if (item.id && existing.has(item.id)) {
          update.run(item.title, index, item.startOffsetDays, item.durationDays, item.milestoneLabel,item.kind||'work', item.id, id); kept.add(item.id);
        } else {
          const newId = randomUUID(); insert.run(newId, id, item.title, index, item.startOffsetDays, item.durationDays, item.milestoneLabel,item.kind||'work'); kept.add(newId);
        }
      });
      for (const itemId of existing) if (!kept.has(itemId)) getDatabaseContext().sqlite.prepare('UPDATE template_items SET deleted_at=? WHERE id=?').run(updatedAt, itemId);
      saveTemplateGraph(id, mode, items);
    }
    requireActiveProject(current.projectId, true);
    assertProjectManager(requireAuthorizationActor(actor), current.projectId);
    audit(actor, 'update', 'template', id, `更新模板：${name}`);
  });
  tx();
  return listTemplates(current.projectId).find((item: any) => item.id === id);
}

export function copyTemplate(targetProjectId: string, sourceTemplateId: string, actor: Actor) {
  requireActiveProject(targetProjectId);
  const source = row<{ projectId: string; name: string; description: string; updatedAt: string; dependencyMode:string }>(
    `SELECT project_id AS projectId, name, description, updated_at AS updatedAt, dependency_mode AS dependencyMode
      FROM work_item_templates WHERE id=? AND deleted_at IS NULL`, sourceTemplateId,
  );
  if (!source) notFound('来源流程不存在');
  let name = `${source.name}（副本）`; let suffix = 2;
  while (row('SELECT 1 FROM work_item_templates WHERE project_id=? AND deleted_at IS NULL AND lower(trim(name))=lower(trim(?))', targetProjectId, name)) {
    name = `${source.name}（副本${suffix++}）`;
  }
  const sourceItems = listTemplates(source.projectId).find(t=>t.id===sourceTemplateId)!.items as Array<{id:string;predecessorIds:string[];title:string;kind:'work'|'milestone';confirmationMode:'auto'|'manual';arrangement:'early'|'late';arrangementAnchor:string|null;workStage?:WorkStage|null;milestoneKind?:MilestoneKind;startOffsetDays:number;durationDays:number;milestoneLabel:string|null;sortOrder:number}>;
  const items = sourceItems.map((item) => ({
    clientKey:item.id, predecessorKeys:item.predecessorIds,kind:item.kind,confirmationMode:item.confirmationMode,arrangement:item.arrangement,arrangementAnchor:item.arrangementAnchor,
    title: item.title, workStage:item.workStage,milestoneKind:item.milestoneKind,startOffsetDays: item.startOffsetDays, durationDays: item.durationDays, milestoneLabel: item.milestoneLabel, sortOrder: item.sortOrder,
  }));
  return getDatabaseContext().sqlite.transaction(() => {
    const copied = createTemplate({ projectId: targetProjectId, name, description: source.description, dependencyMode:source.dependencyMode, items }, actor);
    const latestSource = row<{ updatedAt: string }>(
      'SELECT updated_at AS updatedAt FROM work_item_templates WHERE id=? AND project_id=? AND deleted_at IS NULL',
      sourceTemplateId, source.projectId,
    );
    if (!latestSource || latestSource.updatedAt !== source.updatedAt) {
      fail('来源流程已归档或发生变化，请重新读取后再复制', 'DEPENDENCY_CONFLICT', 409);
    }
    assertProjectResourceReadable(requireAuthorizationActor(actor), source.projectId, '来源流程不存在');
    return copied;
  })();
}

export function archiveTemplate(id: string, actor: Actor, input: JsonObject = {}) {
  if (Object.keys(input).some((key) => key !== 'expectedUpdatedAt')) fail('流程归档不能提交未声明字段');
  const template = row<{ projectId: string; updatedAt: string }>('SELECT project_id AS projectId, updated_at AS updatedAt FROM work_item_templates WHERE id=? AND deleted_at IS NULL', id);
  if (!template) notFound('模板不存在');
  assertExpectedUpdatedAt(input, template.updatedAt, '流程');
  if (row('SELECT 1 FROM projects WHERE id=? AND default_template_id=?', template.projectId, id)) fail('项目默认流程不能归档，请先更换默认流程', 'DEPENDENCY_CONFLICT');
  const activeCount = row<{ count: number }>('SELECT COUNT(*) AS count FROM work_item_templates WHERE project_id=? AND deleted_at IS NULL', template.projectId)?.count || 0;
  if (activeCount <= 1) fail('项目至少需要保留一个有效流程', 'DEPENDENCY_CONFLICT');
  const archivedAt = nextUpdatedAt(template.updatedAt);
  getDatabaseContext().sqlite.transaction(() => {
    const changed = getDatabaseContext().sqlite.prepare(`UPDATE work_item_templates SET deleted_at=?, updated_at=?
      WHERE id=? AND updated_at=? AND deleted_at IS NULL`).run(archivedAt, archivedAt, id, template.updatedAt);
    if (!changed.changes) fail('流程已被其他用户修改，请重新打开后再归档', 'STALE_WRITE', 409);
    if (row('SELECT 1 FROM projects WHERE id=? AND default_template_id=?', template.projectId, id)) {
      fail('项目默认流程不能归档，请先更换默认流程', 'DEPENDENCY_CONFLICT', 409);
    }
    const remaining = row<{ count: number }>('SELECT COUNT(*) AS count FROM work_item_templates WHERE project_id=? AND deleted_at IS NULL', template.projectId)?.count || 0;
    if (!remaining) fail('项目至少需要保留一个有效流程', 'DEPENDENCY_CONFLICT', 409);
    requireActiveProject(template.projectId, true);
    assertProjectManager(requireAuthorizationActor(actor), template.projectId);
    audit(actor, 'archive', 'template', id, '归档流程设计');
  })();
  return { ok: true };
}

export function restoreTemplate(id: string, actor: Actor, input: JsonObject = {}) {
  const template = row<{ projectId: string; name: string; deletedAt: string; updatedAt: string }>(
    'SELECT project_id AS projectId, name, deleted_at AS deletedAt, updated_at AS updatedAt FROM work_item_templates WHERE id=? AND deleted_at IS NOT NULL', id,
  );
  if (!template) notFound('归档模板不存在');
  assertOptionalArchiveGeneration(input, template.deletedAt);
  assertUniqueTemplateName(template.projectId, template.name, id);
  const updatedAt = nextUpdatedAt(template.updatedAt);
  getDatabaseContext().sqlite.transaction(() => {
    const changed = getDatabaseContext().sqlite.prepare(`UPDATE work_item_templates SET deleted_at=NULL, updated_at=?
      WHERE id=? AND deleted_at=? AND updated_at=?`).run(updatedAt, id, template.deletedAt, template.updatedAt);
    if (!changed.changes) fail('归档流程已变化，请刷新后再恢复', 'STALE_WRITE', 409);
    requireActiveProject(template.projectId, true);
    assertProjectManager(requireAuthorizationActor(actor), template.projectId);
    audit(actor, 'restore', 'template', id, '恢复流程设计');
  })();
  return listTemplates(template.projectId, true).find((item: any) => item.id === id);
}
