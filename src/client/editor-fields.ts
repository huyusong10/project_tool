import type {EditorHistory} from './editor-session';
import type {DependencyChanges} from '../shared/path-contracts';
import {isDraftTemplateId} from '../shared/template-instance';

/** Field keys already use title:<object> or <object>:<property>, including client IDs with colons. */
export function fieldObjectId(key:string){
  return key.startsWith('title:')?key.slice(6):key.includes(':')?key.slice(0,key.lastIndexOf(':')):undefined;
}

export function templateFieldActive<T extends {items:ReadonlyArray<{clientKey:string}>}>(state:EditorHistory<T>,key:string){
  const id=fieldObjectId(key);
  return !id||id==='template'||state.values[state.index].items.some(item=>item.clientKey===id);
}

/** Keep inactive buffers on disk for undo; only objects in the current document can block saving. */
export function projectFieldActive(state:EditorHistory<DependencyChanges>,key:string){
  const id=fieldObjectId(key);if(!id)return true;
  const planning=state.values[state.index].featureRelations?.find(c=>c.id===id);
  if(planning)return planning.op!=='delete';
  if(state.server?.featureContext?.relations.some(r=>r.id===id))return true;
  const changes=state.values[state.index].entities||[];
  const source=state.server;
  const exists=(objectId:string,visited=new Set<string>()):boolean=>{
    if(visited.has(objectId))return true;visited.add(objectId);
    const current=changes.find(change=>change.id===objectId);
    if(current?.op==='delete')return false;
    const node=source?.nodes.find(node=>node.id===objectId);
    const milestone=source?.milestones?.find(item=>item.id===objectId);
    const generated=isDraftTemplateId(objectId,changes);
    const parent=current?.requirementId||node?.requirementId||milestone?.requirementId||(generated?objectId.slice(0,objectId.indexOf(':template:')):undefined);
    if(parent&&parent!==objectId&&!exists(parent,visited))return false;
    if(current||node||milestone||generated||source?.requirements.some(r=>r.id===objectId))return true;
    // A complete project snapshot also excludes undone creations after redo is truncated.
    // Keep the raw buffer; refreshing or undoing can make its object available again.
    return !source;
  };
  return exists(id);
}
