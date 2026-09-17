import {emptyRequirementFilters,unfinishedStatuses,normalizeRequirementStatusFilter,type RequirementFilters} from '../shared/requirement-view';
import type {PathAnalysis} from '../shared/paths';
import type {GraphCard} from './path-projection';
import {matchesSearch} from '../shared/search';
export function cardFilterItem(c:GraphCard,data:PathAnalysis){
  const r=data.requirements.find(r=>r.id===c.requirementId),n=data.nodes.find(n=>n.id===c.id),risk=data.risks[c.requirementId];
  return {id:c.id,title:c.title,status:c.status,featureId:r?.featureId,deliveryScope:r?.deliveryScope,...risk,ownerId:c.kind==='requirement'?r?.ownerId:n?.ownerId,
    assigneeIds:c.kind==='requirement'?r?.assigneeIds:n?.assigneeIds,riskLevel:c.risk,riskEvaluated:c.risk!=='pending',unknown:c.unknown,
    delayed:c.kind==='work'?n?.delayed:r?.delayed,
    scheduleComplete:c.kind==='work'?n?.scheduleComplete:r?.scheduleComplete,plannedEnd:n?.plannedEnd||r?.plannedEnd,
    pathRisk:c.kind==='requirement'?risk:{critical:c.critical,blockedCritical:c.critical&&c.status==='blocked',minFloat:c.floatDays}};
}
export function cardSearch(c:GraphCard,data:PathAnalysis,search:string){
  const works=c.kind==='requirement'?data.nodes.filter(n=>n.kind==='work'&&n.requirementId===c.id):[];
  return matchesSearch([{text:c.title,weight:100},{text:c.subtitle,weight:20},...works.map(n=>({text:n.title,weight:20}))],search);
}
export const filterKeys={features:'pathFeatures',deliveryScopes:'pathDeliveryScope',statuses:'pathStatuses',risks:'pathRisks',owners:'pathOwners',participants:'pathPeople',priorities:'pathPriorities',schedule:'pathSchedule'} as const;
export function readPathFilters(params:URLSearchParams,internal=false):RequirementFilters {
  const f=emptyRequirementFilters();
  for(const [key,param] of Object.entries(filterKeys))f[key as keyof typeof filterKeys]=(params.get(param)||'').split(',').filter(Boolean);
  f.statuses=[...new Set(f.statuses.flatMap(status=>status==='unfinished'?unfinishedStatuses:[normalizeRequirementStatusFilter(status)]).filter(Boolean))];
  f.deliveryScopes=[];f.priorities=[];
  if(!params.has('pathStatuses')&&!params.has('pathScope')&&!internal)f.statuses=[...unfinishedStatuses];
  f.critical=params.get('pathCritical')==='1';f.attention=params.get('pathScope')==='attention';return f;
}
export function writePathFilters(params:URLSearchParams,f:RequirementFilters){
  const next=new URLSearchParams(params);next.delete('pathTags');next.set('pathScope',f.attention?'attention':'custom');
  for(const [key,param] of Object.entries(filterKeys)){const values=f[key as keyof typeof filterKeys]||[];if(values.length)next.set(param,values.join(','));else next.delete(param);}
  next.set('pathStatuses',f.statuses.join(','));if(f.critical)next.set('pathCritical','1');else next.delete('pathCritical');return next;
}
export function graphBranch(id:string,links:Array<{source:string;target:string}>){
  const ids=new Set([id]);for(const direction of ['source','target'] as const){const seen=new Set([id]),queue=[id];const neighbors=new Map<string,string[]>();for(const e of links){const key=e[direction];neighbors.set(key,[...(neighbors.get(key)||[]),e[direction==='source'?'target':'source']]);}for(let i=0;i<queue.length;i++)for(const next of neighbors.get(queue[i])||[])if(!seen.has(next)){seen.add(next);ids.add(next);queue.push(next);}}
  return ids;
}
export function graphContext(ids:Set<string>,links:Array<{source:string;target:string}>){const result=new Set(ids);for(const e of links)if(ids.has(e.source)||ids.has(e.target)){result.add(e.source);result.add(e.target);}return result;}

export function remapEditorUrl(url:string,ids:Record<string,string>){
  const parsed=new URL(url,location.origin),map=(id:string)=>ids[id]||((id.startsWith('acceptance:')||id.startsWith('start:')||id.startsWith('execute:'))?id.split(':')[0]+':'+(ids[id.slice(id.indexOf(':')+1)]||id.slice(id.indexOf(':')+1)):id);
  const requirement=/^\/requirements\/([^/]+)/.exec(parsed.pathname)?.[1];
  if(requirement&&ids[requirement]){parsed.pathname='/requirements/'+ids[requirement];parsed.searchParams.delete('draftProject');}
  for(const key of ['scopeId','detailId','workspaceLocate','requirementId','pathNode','workItemId','pathBranch','target','pathRelation']){const value=parsed.searchParams.get(key);if(value)parsed.searchParams.set(key,map(value));}
  if(parsed.searchParams.get('requirementId')&&ids[new URL(url,location.origin).searchParams.get('requirementId')||''])parsed.searchParams.delete('draftProject');
  const edge=parsed.searchParams.get('pathEdge');if(edge)parsed.searchParams.set('pathEdge',ids[edge]||edge.split('>').map(map).join('>'));
  return parsed.pathname+parsed.search+parsed.hash;
}
export function remapEditorViews(scope:string,ids:Record<string,string>){
  if(Object.keys(ids).length)try{
    const key='pm-editor-ids:'+scope;
    sessionStorage.setItem(key,JSON.stringify({...JSON.parse(sessionStorage.getItem(key)||'{}'),...ids}));
  }catch{/* The current URL is also remapped after saving. */}
  try{for(const storage of [localStorage,sessionStorage])for(const key of Object.keys(storage)){
    if(!['pm-path-view:','pm-graph-view:','pm-detail-scroll:','pm-canvas-navigation:'].some(prefix=>key.startsWith(prefix+scope+':')))continue;
    let next=key;for(const [old,id] of Object.entries(ids))next=next.replaceAll(old,id);
    let value=storage.getItem(key)!;
    if((key.startsWith('pm-path-view:')||key.startsWith('pm-canvas-navigation:'))&&!value.startsWith('{'))value=remapEditorUrl('/paths?'+value,ids).split('?')[1]||'';
    storage.setItem(next,value);if(next!==key)storage.removeItem(key);
  }}catch{/* The current navigation state is also remapped in memory. */}
}

/** Browser history can still reference a draft ID after its batch was saved. */
export function remapSavedEditorUrl(url:string,scope:string){
  try{
    const ids=JSON.parse(sessionStorage.getItem('pm-editor-ids:'+scope)||'{}');
    return Object.keys(ids).length?remapEditorUrl(url,ids):url;
  }catch{return url;}
}
