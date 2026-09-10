import type {EditorEntityChange} from './path-contracts';
import type {Dependency} from './paths';

/** Unedited template elements, used while subsequent draft previews are pending. */
export type DraftTemplateInstance={requirementId:string;key:string;entities:EditorEntityChange[];dependencies:Dependency[]};
export function templateInstanceKey(change:EditorEntityChange){
 const d=change.data;return JSON.stringify([change.id,d.templateId||null,d.executionMode||null,d.plannedStart||null,d.plannedEnd||null]);
}
export function isDraftTemplateId(id:string,changes:ReadonlyArray<EditorEntityChange>){
 return changes.some(c=>c.entity==='requirement'&&c.op==='create'&&!!c.data.templateId&&id.startsWith(c.id+':template:'));
}
