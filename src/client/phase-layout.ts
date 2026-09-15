import type {PathAnalysis,DiagramLayout} from '../shared/paths';
import type {FeatureOverview} from '../shared/feature-overview';
import type {FeaturePhase} from '../shared/feature-phases';
import {layoutDependencyGraph,type Point,type LayoutNode,type LayoutEdge} from './path-layout';
import {vacantPosition} from './fixed-routing';
import type {DependencyChanges} from '../shared/path-contracts';

export type PhaseRegion={id:string;name:string;phase?:FeaturePhase;scope:string|null;nodeIds:string[];x:number;y:number;width:number;height:number};
export const phaseLayoutScope=(featureId:string,phaseId:string)=>`feature-phase:${featureId}:${phaseId}`;
export const PHASE_HEADER=148,PHASE_PADDING=24;
const HEADER=PHASE_HEADER;
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
    const relative:Record<string,Point>={};for(const id of ids)if(saved[id])relative[id]={x:Math.max(0,saved[id].x),y:Math.max(0,saved[id].y)};
    const region:PhaseRegion={...definition,scope,nodeIds:ids,x:regions.length?regions.at(-1)!.x+regions.at(-1)!.width+56:24,y:24,width:ids.length?Math.max(320,48+244+Math.max(0,...Object.values(relative).map(p=>p.x))):320,height:ids.length?HEADER+Math.max(0,...Object.values(relative).map(p=>p.y))+224:HEADER+56};
    for(const [id,p] of Object.entries(relative))positions[id]={x:region.x+24+p.x,y:region.y+HEADER+p.y};regions.push(region);
  }
  if(external.length)regions.push({id:'external',name:'其他特性的依赖',scope:null,nodeIds:external,x:regions.length?regions.at(-1)!.x+regions.at(-1)!.width+56:24,y:24,width:320,height:HEADER+56});
  return {regions,positions};
}
/** Measure and arrange each topology before placing its frame. Saved positions are local to a Phase. */
export async function arrangePhaseRegions(engine:Parameters<typeof layoutDependencyGraph>[0],nodes:LayoutNode[],edges:LayoutEdge[],definitions:PhaseRegion[],saved:Record<string,Point>,previous?:{regions:PhaseRegion[];positions:Record<string,Point>},reset=false){
  const regions:PhaseRegion[]=[],positions:Record<string,Point>={};
  for(const definition of definitions){
    const members=definition.nodeIds.map(id=>nodes.find(n=>n.id===id)).filter((n):n is LayoutNode=>!!n);
    const links=edges.filter(e=>definition.nodeIds.includes(e.source)&&definition.nodeIds.includes(e.target));
    const relative:Record<string,Point>={};
    if(!reset)for(const n of members){
      const old=previous?.regions.find(r=>r.id===definition.id&&r.nodeIds.includes(n.id)),p=saved[n.id]||old&&previous?.positions[n.id],origin=saved[n.id]?definition:old;
      if(p&&origin)relative[n.id]={x:Math.max(0,p.x-origin.x-PHASE_PADDING),y:Math.max(0,p.y-origin.y-HEADER)};
    }
    if(members.some(n=>!relative[n.id])){
      const arranged=await layoutDependencyGraph(engine,members,links);
      const minX=Math.min(...Object.values(arranged.nodes).map(p=>p.x)),minY=Math.min(...Object.values(arranged.nodes).map(p=>p.y));
      const occupied=members.filter(n=>relative[n.id]).map(n=>({...n,...relative[n.id]}));
      for(const n of members)if(!relative[n.id]){
        const p=arranged.nodes[n.id],placed=vacantPosition(occupied,n.id,{x:p.x-minX,y:p.y-minY},n.width,n.height);
        relative[n.id]=placed;occupied.push({...n,...placed});
      }
    }
    const region={...definition,x:regions.length?regions.at(-1)!.x+regions.at(-1)!.width+80:24,y:24,
      width:Math.max(320,...members.map(n=>relative[n.id].x+n.width+PHASE_PADDING*2)),
      height:Math.max(HEADER+56,...members.map(n=>relative[n.id].y+n.height+HEADER+PHASE_PADDING*2))};
    for(const n of members)positions[n.id]={x:region.x+PHASE_PADDING+relative[n.id].x,y:region.y+HEADER+relative[n.id].y};
    regions.push(region);
  }
  return {regions,positions};
}
export function constrainPhasePosition(regions:PhaseRegion[],id:string,p:Point):Point{
  const region=regions.find(r=>r.nodeIds.includes(id));return region?{x:Math.max(region.x+PHASE_PADDING,p.x),y:Math.max(region.y+HEADER,p.y)}:p;
}
export function phaseLayoutChanges(changes:DependencyChanges,formal:DiagramLayout[],regions:PhaseRegion[],positions:Record<string,Point>):DependencyChanges{
  const layouts=[...(changes.layouts||[])];
  for(const region of regions){if(!region.scope)continue;const scope=region.scope,old=formal.find(l=>l.scope===scope&&l.direction==='right'),draft=layouts.find(l=>l.scope===scope&&l.direction==='right');
    const relative=Object.fromEntries(region.nodeIds.flatMap(id=>{const point=positions[id];if(point){const p=constrainPhasePosition(regions,id,point);return [[id,{x:p.x-region.x-24,y:p.y-region.y-HEADER}]];}const p=draft?.positions[id]||old?.positions[id];return p?[[id,p]]:[];}));
    const item={scope,direction:'right' as const,expectedVersion:old?.version||0,positions:relative},index=layouts.findIndex(l=>l.scope===scope&&l.direction==='right');if(index<0)layouts.push(item);else layouts[index]=item;
  }
  return {...changes,layouts};
}
