import type {Dashboard} from './types';
import type {PathAnalysis} from '../shared/paths';
import type {OutlineKind} from '../shared/outline';
import type {WorkspaceScope} from './workspace-location';
import {workspaceRows,type WorkspaceRow} from './workspace-rows';
export type OutlineRow=WorkspaceRow&{kind:OutlineKind;objectId:string;parentId:string;version:number;system?:boolean;virtual?:boolean;children:OutlineRow[]};
export function outlineRows(report:Dashboard,formal:PathAnalysis):OutlineRow[]{
  const convert=(r:WorkspaceRow,parentId:string):OutlineRow=>{
    const objectId=r.kind==='feature'||r.virtual?r.featureId:r.kind==='phase'?r.phaseId!:r.id;
    const value={...r,objectId,parentId,version:(r.kind==='feature'?r.feature:r.kind==='phase'?r.phase:r.kind==='work'?r.work:r.requirement)?.version||0,system:!!r.virtual||r.kind==='feature'&&r.feature?.kind==='other',children:[] as OutlineRow[]};
    value.children=r.children.map(c=>convert(c,objectId));
    return value;
  };
  return workspaceRows(report,formal,'manual').map(r=>convert(r,formal.projectId));
}
export const flattenOutline=(rows:OutlineRow[]):OutlineRow[]=>rows.flatMap(r=>[r,...flattenOutline(r.children)]);
export function scopeOutline(rows:OutlineRow[],scope:WorkspaceScope):OutlineRow[]{
  if(scope.kind==='project')return rows;
  const id=scope.kind==='unphased'?'unphased:'+scope.id:scope.kind==='feature'?'feature:'+scope.id:scope.kind==='phase'?'phase:'+scope.id:scope.id;
  return flattenOutline(rows).find(r=>r.id===id)?.children||[];
}
export function reorderSelection(ids:string[],selected:string[],target:string,after=false){
  const moving=ids.filter(id=>selected.includes(id)),rest=ids.filter(id=>!selected.includes(id));
  const index=rest.indexOf(target);if(index<0)return ids;
  rest.splice(index+Number(after),0,...moving);return rest;
}
