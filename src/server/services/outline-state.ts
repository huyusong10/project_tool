import {sqlite} from '../database';
import {fail} from '../errors';
import type {OutlineKind,OutlineSnapshot} from '../../shared/outline';
type Ordered={id:string;version:number;sortOrder:number};
export function outlineSiblings(projectId:string,kind:OutlineKind,parentId:string,writable=true):Ordered[]{
  let table='',where='',args:unknown[]=[];
  if(kind==='feature'){
    if(parentId!==projectId)fail('排序父级必须是当前项目');
    table='features';where="project_id=? AND archived_at IS NULL AND kind='feature'";args=[projectId];
  }else if(kind==='phase'){
    if(!sqlite.prepare('SELECT 1 FROM features WHERE id=? AND project_id=? AND archived_at IS NULL').get(parentId,projectId))fail('特性不存在或已归档');
    table='feature_phases';where='feature_id=? AND project_id=?';args=[parentId,projectId];
  }else if(kind==='work'){
    if(!sqlite.prepare('SELECT 1 FROM requirements r JOIN features f ON f.id=r.feature_id WHERE r.id=? AND r.project_id=? AND r.deleted_at IS NULL AND f.archived_at IS NULL').get(parentId,projectId))fail('需求不存在或已归档');
    table='work_items';where='requirement_id=?';args=[parentId];
  }else{
    const phase=sqlite.prepare('SELECT feature_id AS featureId,delivered_at AS deliveredAt FROM feature_phases WHERE id=? AND project_id=?').get(parentId,projectId) as {featureId:string;deliveredAt:string|null}|undefined;
    const featureId=phase?.featureId||parentId;
    if(!sqlite.prepare('SELECT 1 FROM features WHERE id=? AND project_id=?'+(writable?' AND archived_at IS NULL':'')).get(featureId,projectId))fail('归属特性不存在或已归档');
    table='requirements';where='project_id=? AND feature_id=? AND phase_id IS ? AND deleted_at IS NULL';args=[projectId,featureId,phase?parentId:null];
  }
  return sqlite.prepare(`SELECT id,version,sort_order AS sortOrder FROM ${table} WHERE ${where} ORDER BY sort_order,id`).all(...args) as Ordered[];
}

export function outlineSnapshot(projectId:string,kind:OutlineKind,parentId:string):OutlineSnapshot {return {kind,parentId,items:outlineSiblings(projectId,kind,parentId,false)};}
