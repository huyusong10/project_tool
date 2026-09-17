import { featureArchiveBatchInput, outlineOrderInput, outlineRestoreInput, type OutlineOrderResult } from '../../shared/outline';
import type { Actor } from '../auth';
import { assertProjectManager, requireAuthorizationActor } from '../authorization';
import { getDatabaseContext } from '../database-context';
import { fail } from '../errors';
import { recordAudit } from './audit';
import { archiveFeature, readFeatures } from './features';
import { persistOrganization } from './intake-metadata';
import { outlineSnapshot, outlineSiblings as siblings } from './outline-state';
import { requireActiveProject } from './support';

export function orderOutline(projectId:string,raw:unknown,actor:Actor):OutlineOrderResult{
  const input=outlineOrderInput.parse(raw);
  return getDatabaseContext().sqlite.transaction(()=>{
    assertProjectManager(requireAuthorizationActor(actor),projectId);requireActiveProject(projectId);
    const before=siblings(projectId,input.kind,input.parentId),versions=new Map(before.map(i=>[i.id,i.version]));
    if(input.items.length!==before.length||new Set(input.items.map(i=>i.id)).size!==before.length||input.items.some(i=>versions.get(i.id)!==i.expectedVersion))fail('同级内容或版本已变化，请读取最新顺序并核对','STALE_WRITE',409);
    const table={feature:'features',phase:'feature_phases',requirement:'requirements',work:'work_items'}[input.kind],now=new Date().toISOString();
    for(const [index,item] of input.items.entries())getDatabaseContext().sqlite.prepare(`UPDATE ${table} SET sort_order=?,version=version+1,updated_at=${input.kind==='work'?"CASE WHEN status='cancelled' THEN updated_at ELSE ? END":'?'} WHERE id=? AND sort_order<>?`).run(index,now,item.id,index);
    if(input.kind==='work'&&before.some((i,index)=>i.id!==input.items[index].id))getDatabaseContext().sqlite.prepare('UPDATE requirements SET version=version+1,updated_at=? WHERE id=?').run(now,input.parentId);
    const items=siblings(projectId,input.kind,input.parentId);
    recordAudit(actor,'reorder',input.kind,input.parentId,JSON.stringify({before,after:items}),projectId);
    return {kind:input.kind,parentId:input.parentId,items,undo:{before:[{kind:input.kind,parentId:input.parentId,items:before}],expected:[{kind:input.kind,parentId:input.parentId,items}]}};
  }).immediate();
}
export function archiveFeatures(projectId:string,raw:unknown,actor:Actor){
  const input=featureArchiveBatchInput.parse(raw);
  return getDatabaseContext().sqlite.transaction(()=>{
    assertProjectManager(requireAuthorizationActor(actor),projectId);requireActiveProject(projectId);
    if(new Set(input.items.map(i=>i.id)).size!==input.items.length)fail('所选特性重复');
    const features=readFeatures(projectId,'all');
    const errors=input.items.flatMap(item=>{
      const f=features.find(f=>f.id===item.id);
      const reason=!f?'特性不存在':f.kind==='other'?'系统归类不能归档':f.archivedAt?'特性已归档':f.version!==item.expectedVersion?'版本已变化':getDatabaseContext().sqlite.prepare("SELECT 1 FROM requirements WHERE feature_id=? AND status NOT IN ('completed','cancelled') LIMIT 1").get(item.id)?'仍有未完成需求':'';
      return reason?[{id:item.id,name:f?.name||item.id,reason}]:[];
    });
    if(errors.length)fail(errors.map(e=>e.name+'：'+e.reason).join('；'),'DEPENDENCY_CONFLICT',409,{items:errors});
    for(const item of input.items)archiveFeature(projectId,item.id,item.expectedVersion,true,actor);
    return {archivedIds:input.items.map(i=>i.id)};
  }).immediate();
}

export function restoreOutline(projectId:string,raw:unknown,actor:Actor){
  const input=outlineRestoreInput.parse(raw);
  return getDatabaseContext().sqlite.transaction(()=>{
    assertProjectManager(requireAuthorizationActor(actor),projectId);requireActiveProject(projectId);
    const groupKey=(g:{kind:string;parentId:string})=>g.kind+':'+g.parentId;
    const beforeKeys=input.before.map(groupKey).sort(),expectedKeys=input.expected.map(groupKey).sort();
    if(new Set(beforeKeys).size!==beforeKeys.length||JSON.stringify(beforeKeys)!==JSON.stringify(expectedKeys))fail('撤销范围不一致');
    const objects=(groups:typeof input.before)=>groups.flatMap(g=>g.items.map(i=>g.kind+':'+i.id)).sort();
    const beforeIds=objects(input.before),expectedIds=objects(input.expected);
    if(new Set(beforeIds).size!==beforeIds.length||JSON.stringify(beforeIds)!==JSON.stringify(expectedIds))fail('撤销对象集合不一致');
    for(const g of input.expected){siblings(projectId,g.kind,g.parentId);const actual=outlineSnapshot(projectId,g.kind,g.parentId);if(JSON.stringify(actual.items)!==JSON.stringify(g.items))fail('内容或顺序已变化，不能撤销本次操作','STALE_WRITE',409);}
    const now=new Date().toISOString();
    for(const g of input.before){
      if(g.kind!=='requirement'){
        const expected=input.expected.find(e=>groupKey(e)===groupKey(g))!;
        if(JSON.stringify(g.items.map(i=>i.id).sort())!==JSON.stringify(expected.items.map(i=>i.id).sort()))fail('只有需求可以跨归属移动');
      }
      for(const [index,item] of g.items.entries()){
        if(g.kind==='requirement'){
          const phase=getDatabaseContext().sqlite.prepare('SELECT feature_id AS featureId FROM feature_phases WHERE id=? AND project_id=?').get(g.parentId,projectId) as {featureId:string}|undefined;
          persistOrganization(item.id,projectId,{featureId:phase?.featureId||g.parentId,phaseId:phase?g.parentId:null,reason:input.reason});
        }
        const table={feature:'features',phase:'feature_phases',requirement:'requirements',work:'work_items'}[g.kind];
        getDatabaseContext().sqlite.prepare(`UPDATE ${table} SET sort_order=?,version=version+1,updated_at=${g.kind==='work'?"CASE WHEN status='cancelled' THEN updated_at ELSE ? END":'?'} WHERE id=?`).run(index,now,item.id);
      }
      if(g.kind==='work')getDatabaseContext().sqlite.prepare('UPDATE requirements SET version=version+1,updated_at=? WHERE id=?').run(now,g.parentId);
    }
    recordAudit(actor,'update','project',projectId,'撤销清单操作；原因：'+(input.reason||''),projectId);
    return {restored:true,groups:input.before.map(g=>outlineSnapshot(projectId,g.kind,g.parentId))};
  }).immediate();
}
