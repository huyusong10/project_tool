import { randomUUID } from 'node:crypto';
import { sqlite } from '../database';
import { fail } from '../errors';
import { resolveTemplateOffsets, type TemplateDependencyItem } from '../../shared/path-template';
import { insertDependency, getPathAnalysis } from './paths';

export function prepareTemplateGraph<T extends TemplateDependencyItem>(items: T[], mode: string) {
  if (!['legacy','dependencies'].includes(mode)) fail('流程排期模式不合法');
  if (mode === 'dependencies') {
    if (items.some(i=>!Array.isArray(i.predecessorKeys))) fail('依赖流程必须提交每项前置（无前置请传空列表），不能用旧编辑器覆盖');
    try { resolveTemplateOffsets(items); } catch (error) { fail((error as Error).message, 'DEPENDENCY_CONFLICT'); }
  }
  return items;
}
export function saveTemplateGraph(templateId: string, mode: string, items: TemplateDependencyItem[]) {
  const saved = sqlite.prepare('SELECT id FROM template_items WHERE template_id=? AND deleted_at IS NULL ORDER BY sort_order').all(templateId) as Array<{id:string}>;
  const mapping = new Map(items.map((item,i)=>[item.clientKey||item.id||String(i),saved[i].id]));
  sqlite.prepare('UPDATE work_item_templates SET dependency_mode=? WHERE id=?').run(mode,templateId);
  const update=sqlite.prepare('UPDATE template_items SET predecessor_ids=? WHERE id=?');
  items.forEach((item,i)=> update.run(JSON.stringify(mode==='dependencies' ? (item.predecessorKeys||[]).map(k=>mapping.get(k)!) : []),saved[i].id));
}
export function instantiateTemplateGraph(requirementId: string, templateId: string, createdIds: string[], baseStart: string) {
  const template = sqlite.prepare('SELECT dependency_mode AS mode FROM work_item_templates WHERE id=?').get(templateId) as {mode:string};
  if(template.mode!=='dependencies'||!createdIds.length) return;
  const req=sqlite.prepare('SELECT project_id AS projectId FROM requirements WHERE id=?').get(requirementId) as {projectId:string};
  const items=sqlite.prepare('SELECT id,predecessor_ids AS predecessors,duration_days AS duration FROM template_items WHERE template_id=? AND deleted_at IS NULL').all(templateId) as Array<{id:string;predecessors:string;duration:number}>;
  const work=sqlite.prepare('SELECT id,template_item_id AS templateId FROM work_items WHERE requirement_id=?').all(requirementId) as Array<{id:string;templateId:string|null}>;
  const map=new Map(work.map(w=>[w.templateId,w.id])), created=new Set(createdIds);
  for(const item of items) {
    const target=map.get(item.id); if(!target||!created.has(target)) continue;
    sqlite.prepare('UPDATE work_items SET duration_days=? WHERE id=?').run(item.duration,target);
    for(const previous of JSON.parse(item.predecessors) as string[]) {
      const source=map.get(previous); if(!source) continue;
      insertDependency({id:randomUUID(),projectId:req.projectId,sourceRequirementId:requirementId,sourceWorkItemId:source,targetRequirementId:requirementId,targetWorkItemId:target,origin:'template'});
    }
  }
  getPathAnalysis(req.projectId);
  // Only a wholly generated new instance is automatically reviewed. Mixed historical work remains explicit.
  if(work.every(w=>created.has(w.id))) sqlite.prepare('UPDATE requirements SET dependencies_reviewed_at=?,schedule_anchor=? WHERE id=?').run(new Date().toISOString(),baseStart,requirementId);
}
