import type {PathAnalysis,DiagramLayout} from '../shared/paths';
import type {FeatureOverview} from '../shared/feature-overview';
import type {FeaturePhase} from '../shared/feature-phases';
import type {Point} from './path-layout';
import type {DependencyChanges} from '../shared/path-contracts';

export type PhaseRegion={id:string;name:string;phase?:FeaturePhase;scope:string|null;nodeIds:string[];x:number;y:number;width:number;height:number};
export const phaseLayoutScope=(featureId:string,phaseId:string)=>`feature-phase:${featureId}:${phaseId}`;
export const PHASE_HEADER=148,PHASE_PADDING=24;
const WIDTH=640,HEADER=PHASE_HEADER,ROW=248,COL=300;
/** Regions are display geometry. They never add dependency edges or change membership. */
export function featurePhaseLayout(data:PathAnalysis,feature:FeatureOverview|undefined,featureId:string,cardIds:string[]){
  const previous=data.layouts?.find(l=>l.scope==='feature:'+featureId&&l.direction==='right')?.positions||{};
  const phases=[...(feature?.phases||[])].sort((a,b)=>a.sortOrder-b.sortOrder||a.id.localeCompare(b.id));
  const definitions:Array<{id:string;name:string;phase?:FeaturePhase}>=[...phases.map(p=>({id:p.id,name:p.name,phase:p})),{id:'unassigned',name:'未安排 Phase'}];
  const members=new Map(data.featureContext?.requirements.concat(data.requirements).map(r=>[r.id,r])||data.requirements.map(r=>[r.id,r]));
  const external=cardIds.filter(id=>(members.get(id)?.featureId||'unassigned')!==featureId||!members.has(id));
  const regions:PhaseRegion[]=[],positions:Record<string,Point>={};
  for(const definition of definitions){
    const scope=phaseLayoutScope(featureId,definition.id),saved=data.layouts?.find(l=>l.scope===scope&&l.direction==='right')?.positions||{};
    const ids=cardIds.filter(id=>!external.includes(id)&&(members.get(id)?.phaseId||'unassigned')===definition.id).sort((a,b)=>(previous[a]?.x||0)-(previous[b]?.x||0)||(previous[a]?.y||0)-(previous[b]?.y||0)||a.localeCompare(b));
    const relative:Record<string,Point>={};for(const id of ids)if(saved[id])relative[id]={x:Math.max(0,Math.min(WIDTH-284,saved[id].x)),y:Math.max(0,saved[id].y)};
    for(const id of ids)if(!relative[id]){let slot=0,p:Point;do{p={x:(slot%2)*COL,y:Math.floor(slot/2)*ROW};slot++;}while(Object.values(relative).some(q=>Math.abs(q.x-p.x)<280&&Math.abs(q.y-p.y)<ROW));relative[id]=p;}
    const region:PhaseRegion={...definition,scope,nodeIds:ids,x:regions.length?regions.at(-1)!.x+regions.at(-1)!.width+56:24,y:24,width:ids.length?Math.max(320,48+244+Math.max(0,...Object.values(relative).map(p=>p.x))):320,height:ids.length?HEADER+Math.max(0,...Object.values(relative).map(p=>p.y))+224:HEADER+56};
    for(const [id,p] of Object.entries(relative))positions[id]={x:region.x+24+p.x,y:region.y+HEADER+p.y};regions.push(region);
  }
  if(external.length){const region:PhaseRegion={id:'external',name:'其他特性的依赖',scope:null,nodeIds:external,x:regions.length?regions.at(-1)!.x+regions.at(-1)!.width+56:24,y:24,width:WIDTH,height:Math.max(420,HEADER+Math.ceil(external.length/2)*ROW)};external.forEach((id,i)=>{positions[id]={x:region.x+24+(i%2)*COL,y:region.y+HEADER+Math.floor(i/2)*ROW};});regions.push(region);}
  return {regions,positions};
}
export function constrainPhasePosition(regions:PhaseRegion[],id:string,p:Point,width=244):Point{
  const region=regions.find(r=>r.nodeIds.includes(id));return region?{x:Math.max(region.x+24,Math.min(region.x+region.width-width-PHASE_PADDING,p.x)),y:Math.max(region.y+HEADER,p.y)}:p;
}
export function phaseLayoutChanges(changes:DependencyChanges,formal:DiagramLayout[],regions:PhaseRegion[],positions:Record<string,Point>):DependencyChanges{
  const layouts=[...(changes.layouts||[])];
  for(const region of regions){if(!region.scope)continue;const scope=region.scope,old=formal.find(l=>l.scope===scope&&l.direction==='right'),draft=layouts.find(l=>l.scope===scope&&l.direction==='right');
    const relative=Object.fromEntries(region.nodeIds.flatMap(id=>{const point=positions[id];if(point){const p=constrainPhasePosition(regions,id,point);return [[id,{x:p.x-region.x-24,y:p.y-region.y-HEADER}]];}const p=draft?.positions[id]||old?.positions[id];return p?[[id,p]]:[];}));
    const item={scope,direction:'right' as const,expectedVersion:old?.version||0,positions:relative},index=layouts.findIndex(l=>l.scope===scope&&l.direction==='right');if(index<0)layouts.push(item);else layouts[index]=item;
  }
  return {...changes,layouts};
}
