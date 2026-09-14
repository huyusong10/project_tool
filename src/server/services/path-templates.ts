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
  const update=sqlite.prepare('UPDATE template_items SET work_stage=?,milestone_kind=?,predecessor_ids=?,arrangement=?,arrangement_anchor=?,confirmation_mode=? WHERE id=?');
  items.forEach((item,i)=> update.run(item.workStage||null,item.milestoneKind||'ordinary',JSON.stringify(mode==='dependencies'||item.kind==='milestone' ? (item.predecessorKeys||[]).map(k=>mapping.get(k)!) : []),item.arrangement||'early',mapping.get(item.arrangementAnchor||'')||null,item.milestoneKind==='test_submitted'?'manual':item.confirmationMode||'auto',saved[i].id));
}
export function instantiateTemplateGraph(requirementId: string, templateId: string, createdIds: string[], baseStart: string, deferAnalysis=false) {
  const template = sqlite.prepare('SELECT dependency_mode AS mode FROM work_item_templates WHERE id=?').get(templateId) as {mode:string};
  const req=sqlite.prepare('SELECT project_id AS projectId FROM requirements WHERE id=?').get(requirementId) as {projectId:string};
  const items=sqlite.prepare('SELECT work_stage AS workStage,milestone_kind AS milestoneKind,id,title,kind,confirmation_mode AS confirmationMode,arrangement,arrangement_anchor AS arrangementAnchor,predecessor_ids AS predecessors,duration_days AS duration FROM template_items WHERE template_id=? AND deleted_at IS NULL').all(templateId) as Array<{workStage:string|null;milestoneKind:string;id:string;title:string;kind:string;confirmationMode:string;arrangement:string;arrangementAnchor:string|null;predecessors:string;duration:number}>;
  const work=sqlite.prepare('SELECT id,template_item_id AS templateId FROM work_items WHERE requirement_id=?').all(requirementId) as Array<{id:string;templateId:string|null}>;
  const map=new Map(work.map(w=>[w.templateId,w.id])), created=new Set(createdIds);
  const now=new Date().toISOString();
  for(const item of items.filter(i=>i.kind==='milestone')){
    const old=sqlite.prepare('SELECT id FROM milestones WHERE requirement_id=? AND template_item_id=?').get(requirementId,item.id) as {id:string}|undefined;
    const id=old?.id||randomUUID();map.set(item.id,id);if(old)continue;created.add(id);
    sqlite.prepare('INSERT INTO milestones(id,project_id,requirement_id,template_item_id,title,confirmation_mode,milestone_kind,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id,req.projectId,requirementId,item.id,item.title,item.confirmationMode,item.milestoneKind,now,now);
  }
  for(const item of items) {
    const target=map.get(item.id); if(!target||!created.has(target)) continue;
    if(item.kind!=='milestone')sqlite.prepare('UPDATE work_items SET work_stage=?,duration_days=?,arrangement=?,arrangement_anchor=? WHERE id=?').run(item.workStage,item.duration,item.arrangement,map.get(item.arrangementAnchor)||null,target);
    if(template.mode!=='dependencies'&&item.kind!=='milestone')continue;
    for(const previous of JSON.parse(item.predecessors) as string[]) {
      const source=map.get(previous); if(!source) continue;
      const milestone=items.find(i=>i.id===previous)?.kind==='milestone';
      insertDependency({id:randomUUID(),projectId:req.projectId,sourceRequirementId:requirementId,sourceWorkItemId:milestone?null:source,sourceMilestoneId:milestone?source:null,targetRequirementId:requirementId,targetWorkItemId:item.kind==='milestone'?null:target,targetMilestoneId:item.kind==='milestone'?target:null,origin:'template'});
    }
  }
  if(!deferAnalysis)getPathAnalysis(req.projectId);
  // Only a wholly generated new instance is automatically reviewed. Mixed historical work remains explicit.
  if(template.mode==='dependencies'&&work.every(w=>created.has(w.id))) sqlite.prepare('UPDATE requirements SET dependencies_reviewed_at=?,schedule_anchor=? WHERE id=?').run(new Date().toISOString(),baseStart,requirementId);
}
