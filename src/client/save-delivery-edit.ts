import type {useDependencyDraft} from './use-graph-draft';
import type {DependencyChanges} from '../shared/path-contracts';

/** A single-object edit saves directly; an existing batch or downstream impact is reviewed once. */
export async function saveDeliveryEdit(draft:ReturnType<typeof useDependencyDraft>,changes:DependencyChanges,requirementId:string,showReview:()=>void,onSaved:()=>void,alwaysReview=false){
  const hasOtherDraft=draft.count>0;
  draft.begin();draft.change(changes);await draft.flush();
  if(alwaysReview||hasOtherDraft||draft.conflict||draft.pending){showReview();return;}
  const saved=await draft.save(preview=>{
    if(preview.differences.impact?.some(i=>i.requirementId!==requirementId)){showReview();return false;}
    return true;
  });
  if(saved)onSaved();
}
