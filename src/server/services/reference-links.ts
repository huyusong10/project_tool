import {sqlite} from '../database';
import {requirementReferenceLinks} from '../../shared/reference-links';

/** Called inside the owning object's transaction, using its existing version and audit checks. */
export function persistRequirementLinks(id:string,input:{referenceLinks?:unknown;referenceUrl?:unknown},current?:{referenceLinks?:unknown;referenceUrl?:string|null}) {
  const links=requirementReferenceLinks(input,current);
  sqlite.prepare('UPDATE requirements SET reference_links=?,reference_url=? WHERE id=?').run(JSON.stringify(links),links[0]?.url||null,id);
}
