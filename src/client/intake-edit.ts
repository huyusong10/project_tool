import type { IntakePackage } from '../shared/intake';

export function mergeIntakeRequirements(pkg:IntakePackage,from:string,to:string):IntakePackage {
  const next=structuredClone(pkg),source=next.requirements.find(r=>r.key===from),target=next.requirements.find(r=>r.key===to);
  if(!source||!target||from===to||source.action!=='create'||target.action!=='create')return pkg;
  const workKeys=new Map(source.workItems.map(w=>[w.key,from+'::'+w.key]));
  target.workItems.push(...source.workItems.map(w=>({...w,key:workKeys.get(w.key)!})));
  target.acceptanceCriteria=[...new Set([target.acceptanceCriteria,source.acceptanceCriteria].filter(Boolean))].join('\n');
  target.background=[...new Set([target.background,source.background].filter(Boolean))].join('\n');
  target.tags=[...new Set([...target.tags,...source.tags])];
  next.requirements=next.requirements.filter(r=>r.key!==from);
  const endpoint=(e:{requirement:string;workItem?:string})=>e.requirement===from?{requirement:to,...(e.workItem?{workItem:workKeys.get(e.workItem)||e.workItem}:{})}:e;
  next.dependencies=next.dependencies.map(d=>({source:endpoint(d.source),target:endpoint(d.target)}));
  next.links=next.links.map(l=>({...l,...endpoint(l)}));
  const unique=new Map<string,IntakePackage['links'][number]>();
  for(const l of next.links){const key=JSON.stringify([l.requirement,l.workItem,l.document,l.clause]),previous=unique.get(key);unique.set(key,previous?{...previous,scope:[...new Set([previous.scope,l.scope])].join('\n')}:l);}
  next.links=[...unique.values()];
  return next;
}
export function splitIntakeRequirement(pkg:IntakePackage,key:string,newKey:string):IntakePackage {
  const next=structuredClone(pkg),source=next.requirements.find(r=>r.key===key);if(!source)return pkg;
  next.requirements.push({...structuredClone(source),key:newKey,title:source.title+'（后续交付）',action:'create',existingId:undefined,confirmAdditional:false,workItems:[]});
  next.links.push(...next.links.filter(l=>l.requirement===key&&!l.workItem).map(l=>({...l,requirement:newKey})));
  return next;
}
