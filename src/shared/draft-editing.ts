import type {DraftContent} from './requirement-drafts';

export type DraftDocument={title:string;content:DraftContent};
export type DraftConflict={path:string;local:unknown;remote:unknown};
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function itemKey(v:unknown):string|null{
  if(!object(v))return null;
  if(typeof v.id==='string')return v.id;
  if(typeof v.clientId==='string')return v.clientId;
  if(typeof v.key==='string')return v.key;
  if(v.clause)return JSON.stringify([v.requirementId,v.workItemId||'',v.document,v.clause]);
  if(v.templateId)return String(v.requirementId);
  return null;
}
/** Three-way merge, preserving independent edits and explicitly resolving overlapping fields/deletions. */
export function mergeDraftDocument(base:DraftDocument,local:DraftDocument,remote:DraftDocument,choices:Record<string,'local'|'remote'>={}){
  const conflicts:DraftConflict[]=[];
  function merge(b:unknown,l:unknown,r:unknown,path:string):unknown{
    if(equal(l,r))return l;
    if(equal(b,l))return r;
    if(equal(b,r))return l;
    if(object(l)&&object(r)&&object(b))return Object.fromEntries([...new Set([...Object.keys(b),...Object.keys(l),...Object.keys(r)])].map(k=>[k,merge(b[k],l[k],r[k],path?path+'.'+k:k)]).filter(([,v])=>v!==undefined));
    if(Array.isArray(b)&&Array.isArray(l)&&Array.isArray(r)&&[...b,...l,...r].every(v=>itemKey(v)!==null)){
      const maps=[b,l,r].map(a=>new Map(a.map(v=>[itemKey(v)!,v])));
      return [...new Set([...maps[1].keys(),...maps[2].keys(),...maps[0].keys()])].map(k=>merge(maps[0].get(k),maps[1].get(k),maps[2].get(k),path+'['+k+']')).filter(v=>v!==undefined);
    }
    conflicts.push({path,local:l,remote:r});return choices[path]==='remote'?r:l;
  }
  return {document:merge(base,local,remote,'') as DraftDocument,conflicts};
}
export function removalImpact(content:DraftContent,ids:string[]){
  const removed=new Set(ids);
  return {dependencies:content.dependencies.filter(e=>[e.sourceRequirementId,e.targetRequirementId,e.sourceWorkItemId,e.targetWorkItemId,e.sourceMilestoneId,e.targetMilestoneId].some(id=>id&&removed.has(id))),links:content.links.filter(l=>removed.has(l.requirementId)||!!l.workItemId&&removed.has(l.workItemId)),anchors:content.entities.filter(e=>e.data.arrangementAnchor&&removed.has(e.data.arrangementAnchor.replace(/^(start|acceptance|execute):/,'')))};
}
export function removeDraftEntities(content:DraftContent,ids:string[]){
  const next=structuredClone(content),removed=new Set(ids),impact=removalImpact(content,ids);
  next.entities=next.entities.filter(e=>!removed.has(e.id));
  for(const e of next.entities)if(impact.anchors.some(a=>a.id===e.id)){e.data.arrangementAnchor=null;e.data.arrangement='early';}
  next.references=next.references.filter(e=>!removed.has(e.id));
  next.dependencies=next.dependencies.filter(e=>!impact.dependencies.some(d=>d.clientId===e.clientId));
  next.links=next.links.filter(l=>!impact.links.includes(content.links.find(v=>equal(v,l))!));
  next.templates=next.templates.filter(t=>!removed.has(t.requirementId));
  for(const id of removed)delete next.positions[id];
  return next;
}
export function mergeDraftRequirements(content:DraftContent,from:string,to:string){
  const next=structuredClone(content),source=next.entities.find(e=>e.id===from)!,target=next.entities.find(e=>e.id===to)!;
  target.data.acceptanceCriteria=[target.data.acceptanceCriteria,source.data.acceptanceCriteria].filter(Boolean).join('\n');
  target.data.background=[target.data.background,source.data.background].filter(Boolean).join('\n');
  target.data.tags=[...new Set([...target.data.tags||[],...source.data.tags||[]])];
  next.entities=next.entities.filter(e=>e.id!==from).map(e=>e.requirementId===from?{...e,requirementId:to}:e);
  next.dependencies=next.dependencies.map(e=>({...e,sourceRequirementId:e.sourceRequirementId===from?to:e.sourceRequirementId,targetRequirementId:e.targetRequirementId===from?to:e.targetRequirementId}));
  next.links=next.links.map(l=>l.requirementId===from?{...l,requirementId:to}:l);
  const links=new Map<string,DraftContent['links'][number]>();
  for(const l of next.links){const key=JSON.stringify([l.requirementId,l.workItemId,l.document,l.clause]);const old=links.get(key);links.set(key,old?{...l,scope:[old.scope,l.scope].join('\n')}:l);}
  next.links=[...links.values()];
  next.templates=next.templates.filter(t=>t.requirementId!==from);
  for(const e of next.entities)if(e.data.arrangementAnchor?.replace(/^(start|acceptance|execute):/,'')===from)e.data.arrangementAnchor=e.data.arrangementAnchor.replace(from,to);
  next.questions.push('合并 '+source.data.title+' 到 '+target.data.title+' 后，请核对验收范围、估算和需求级前置。');
  return next;
}
export function moveDraftWork(content:DraftContent,workId:string,requirementId:string){
  const next=structuredClone(content),work=next.entities.find(e=>e.id===workId)!;work.requirementId=requirementId;
  next.dependencies=next.dependencies.map(e=>({...e,sourceRequirementId:e.sourceWorkItemId===workId?requirementId:e.sourceRequirementId,targetRequirementId:e.targetWorkItemId===workId?requirementId:e.targetRequirementId}));
  next.links=next.links.map(l=>l.workItemId===workId?{...l,requirementId}:l);
  return next;
}
