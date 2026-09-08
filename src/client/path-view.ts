import {emptyRequirementFilters,unfinishedStatuses,type RequirementFilters} from '../shared/requirement-view';
import type {PathAnalysis} from '../shared/paths';
import type {GraphCard} from './path-projection';
import {matchesSearch} from '../shared/search';
export function cardFilterItem(c:GraphCard,data:PathAnalysis){
  const r=data.requirements.find(r=>r.id===c.requirementId),n=data.nodes.find(n=>n.id===c.id),risk=data.risks[c.requirementId];
  return {title:c.title,status:c.status,priority:r?.priority,ownerId:c.kind==='requirement'?r?.ownerId:n?.ownerId,
    assigneeIds:c.kind==='requirement'?r?.assigneeIds:n?.assigneeIds,riskLevel:c.risk,riskEvaluated:c.risk!=='pending',unknown:c.unknown,
    delayed:c.kind==='work'?n?.delayed:r?.delayed,
    scheduleComplete:c.kind==='work'?n?.scheduleComplete:r?.scheduleComplete,plannedEnd:n?.plannedEnd||r?.plannedEnd,
    pathRisk:c.kind==='requirement'?risk:{critical:c.critical,blockedCritical:c.critical&&c.status==='blocked',minFloat:c.floatDays}};
}
export function cardSearch(c:GraphCard,data:PathAnalysis,search:string){
  const works=c.kind==='requirement'?data.nodes.filter(n=>n.kind==='work'&&n.requirementId===c.id):[];
  return matchesSearch([{text:c.title,weight:100},{text:c.subtitle,weight:20},...works.map(n=>({text:n.title,weight:20}))],search);
}
export const filterKeys={statuses:'pathStatuses',risks:'pathRisks',owners:'pathOwners',participants:'pathPeople',priorities:'pathPriorities',schedule:'pathSchedule'} as const;
export function readPathFilters(params:URLSearchParams,internal=false):RequirementFilters {
  const f=emptyRequirementFilters();
  for(const [key,param] of Object.entries(filterKeys))f[key as keyof typeof filterKeys]=(params.get(param)||'').split(',').filter(Boolean);
  if(!params.has('pathStatuses')&&!params.has('pathScope')&&!internal)f.statuses=[...unfinishedStatuses];
  f.critical=params.get('pathCritical')==='1';f.attention=params.get('pathScope')==='attention';return f;
}
export function writePathFilters(params:URLSearchParams,f:RequirementFilters){
  const next=new URLSearchParams(params);next.set('pathScope',f.attention?'attention':'custom');
  for(const [key,param] of Object.entries(filterKeys)){const values=f[key as keyof typeof filterKeys];if(values.length)next.set(param,values.join(','));else next.delete(param);}
  next.set('pathStatuses',f.statuses.join(','));if(f.critical)next.set('pathCritical','1');else next.delete('pathCritical');return next;
}
export function graphBranch(id:string,links:Array<{source:string;target:string}>){
  const ids=new Set([id]);for(const direction of ['source','target'] as const){const seen=new Set([id]),queue=[id];const neighbors=new Map<string,string[]>();for(const e of links){const key=e[direction];neighbors.set(key,[...(neighbors.get(key)||[]),e[direction==='source'?'target':'source']]);}for(let i=0;i<queue.length;i++)for(const next of neighbors.get(queue[i])||[])if(!seen.has(next)){seen.add(next);ids.add(next);queue.push(next);}}
  return ids;
}
export function graphContext(ids:Set<string>,links:Array<{source:string;target:string}>){const result=new Set(ids);for(const e of links)if(ids.has(e.source)||ids.has(e.target)){result.add(e.source);result.add(e.target);}return result;}
export type PathOrigin={url:string;label:string;parent?:PathOrigin};
const prefix='pm-path-origin:';
export function readPathOrigin(key:string,state:unknown):PathOrigin|undefined {
  const value=(state as {pathOrigin?:PathOrigin}|null)?.pathOrigin;
  try {const saved=value||JSON.parse(localStorage.getItem(prefix+key)||'null');return saved&&/^\/(paths|requirements\/[^/?]+)(\?|$)/.test(saved.url)?saved:undefined;}catch{return undefined;}
}
export function savePathOrigin(key:string,value:PathOrigin|undefined){try {if(value)localStorage.setItem(prefix+key,JSON.stringify(value));else localStorage.removeItem(prefix+key);}catch{/* Navigation still works in memory. */}}

export function remapEditorUrl(url:string,ids:Record<string,string>){
  const parsed=new URL(url,location.origin),map=(id:string)=>ids[id]||((id.startsWith('acceptance:')||id.startsWith('start:'))?id.split(':')[0]+':'+(ids[id.slice(id.indexOf(':')+1)]||id.slice(id.indexOf(':')+1)):id);
  const requirement=/^\/requirements\/([^/]+)/.exec(parsed.pathname)?.[1];
  if(requirement&&ids[requirement]){parsed.pathname='/requirements/'+ids[requirement];parsed.searchParams.delete('draftProject');}
  for(const key of ['pathNode','workItemId','pathBranch','target']){const value=parsed.searchParams.get(key);if(value)parsed.searchParams.set(key,map(value));}
  return parsed.pathname+parsed.search+parsed.hash;
}
export function remapEditorOrigin(origin:PathOrigin|undefined,ids:Record<string,string>):PathOrigin|undefined{return origin?{...origin,url:remapEditorUrl(origin.url,ids),parent:remapEditorOrigin(origin.parent,ids)}:undefined;}
export function remapEditorViews(scope:string,ids:Record<string,string>){
  try{for(const key of Object.keys(localStorage)){
    if(!['pm-path-origin:','pm-path-view:','pm-graph-view:','pm-detail-scroll:'].some(prefix=>key.startsWith(prefix+scope+':')))continue;
    let next=key;for(const [old,id] of Object.entries(ids))next=next.replaceAll(old,id);
    let value=localStorage.getItem(key)!;
    if(key.startsWith('pm-path-origin:'))value=JSON.stringify(remapEditorOrigin(JSON.parse(value),ids));
    if(key.startsWith('pm-path-view:')&&!value.startsWith('{'))value=remapEditorUrl('/paths?'+value,ids).split('?')[1]||'';
    localStorage.setItem(next,value);if(next!==key)localStorage.removeItem(key);
  }}catch{/* The current navigation state is also remapped in memory. */}
}
