import { layoutDependencyGraph, type LayoutEdge, type LayoutNode, type RoutedLayout } from './path-layout';
import type { ElkNode } from 'elkjs';
type Engine = { layout(graph: ElkNode): Promise<ElkNode> };
const cache = new Map<string, RoutedLayout>();
export function graphComponents(nodes: LayoutNode[], edges: LayoutEdge[]) {
  const neighbors = new Map(nodes.map(n => [n.id, [] as string[]]));
  edges.forEach(e => { neighbors.get(e.source)?.push(e.target); neighbors.get(e.target)?.push(e.source); });
  const seen = new Set<string>(), result: string[][] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    const ids = [node.id]; seen.add(node.id);
    for (let i = 0; i < ids.length; i++) for (const id of neighbors.get(ids[i]) || []) {
      if (!seen.has(id)) { seen.add(id); ids.push(id); }
    }
    result.push(ids);
  }
  return result;
}

const snapshots = new WeakMap<RoutedLayout, { nodes: Map<string,string>; edges: Map<string,string>; vertical: boolean }>();
const edgeKey = (e: LayoutEdge) => JSON.stringify([e.source,e.target,e.label,e.labelWidth]);
export async function stableGraphLayout(engine: Engine, nodes: LayoutNode[], edges: LayoutEdge[], vertical: boolean,
  previous: RoutedLayout | null, anchorId?: string, arrange = false): Promise<RoutedLayout> {
  const result: RoutedLayout = { width: 0, height: 0, nodes: {}, edges: {} }, prior=previous&&snapshots.get(previous);
  const nodeMap=new Map(nodes.map(n=>[n.id,n]));
  const components=await Promise.all(graphComponents(nodes,edges).map(async ids=>{
    const set=new Set(ids),localNodes=nodes.filter(n=>set.has(n.id)),localEdges=edges.filter(e=>set.has(e.source));
    // Removed edges and split components can keep their old valid routes and node positions.
    if(!arrange&&previous&&prior?.vertical===vertical&&localNodes.every(n=>prior.nodes.get(n.id)===JSON.stringify([n.width,n.height]))
      &&localEdges.every(e=>prior.edges.get(e.id)===edgeKey(e))) {
      return {ids,retained:true,layout:{width:previous.width,height:previous.height,nodes:Object.fromEntries(ids.map(id=>[id,previous.nodes[id]])),edges:Object.fromEntries(localEdges.map(e=>[e.id,previous.edges[e.id]]))} as RoutedLayout};
    }
    const key=JSON.stringify([localNodes,localEdges.map(e=>[e.id,edgeKey(e)]),vertical]);
    let layout=cache.get(key);
    if(!layout){layout=await layoutDependencyGraph(engine,localNodes,localEdges,vertical);cache.set(key,layout);if(cache.size>80)cache.delete(cache.keys().next().value!);}
    return {ids,layout,retained:false};
  }));
  components.sort((a,b)=>Number(b.retained)-Number(a.retained)||(previous?Number(b.ids.includes(anchorId||''))-Number(a.ids.includes(anchorId||'')):0));
  type Bounds={left:number;top:number;right:number;bottom:number};
  const placed:Bounds[]=[];let bottom=24;
  for(const {ids,layout,retained} of components){
    const anchor=!arrange&&previous&&(anchorId&&ids.includes(anchorId)&&previous.nodes[anchorId]?anchorId:ids.find(id=>previous.nodes[id]));
    const offset=retained?{x:0,y:0}:anchor&&previous?{x:previous.nodes[anchor].x-layout.nodes[anchor].x,y:previous.nodes[anchor].y-layout.nodes[anchor].y}:{x:0,y:bottom};
    const bounds:Bounds={left:Infinity,top:Infinity,right:-Infinity,bottom:-Infinity};
    for(const [id,p] of Object.entries(layout.nodes)){const n=nodeMap.get(id)!;bounds.left=Math.min(bounds.left,p.x);bounds.top=Math.min(bounds.top,p.y);bounds.right=Math.max(bounds.right,p.x+n.width);bounds.bottom=Math.max(bounds.bottom,p.y+n.height);}
    for(const e of Object.values(layout.edges))for(const p of e.points){bounds.left=Math.min(bounds.left,p.x);bounds.top=Math.min(bounds.top,p.y);bounds.right=Math.max(bounds.right,p.x);bounds.bottom=Math.max(bounds.bottom,p.y);}
    if(!retained) {
      let conflict:Bounds|undefined;
      do {conflict=placed.find(b=>bounds.left+offset.x<b.right+38&&bounds.right+offset.x>b.left-38&&bounds.top+offset.y<b.bottom+38&&bounds.bottom+offset.y>b.top-38);
        if(conflict)offset.y=conflict.bottom+39-bounds.top;
      } while(conflict);
    }
    for(const [id,p] of Object.entries(layout.nodes))result.nodes[id]={x:p.x+offset.x,y:p.y+offset.y};
    for(const [id,e] of Object.entries(layout.edges))result.edges[id]={points:e.points.map(p=>({x:p.x+offset.x,y:p.y+offset.y})),label:e.label?{...e.label,x:e.label.x+offset.x,y:e.label.y+offset.y}:null};
    const box={left:bounds.left+offset.x,top:bounds.top+offset.y,right:bounds.right+offset.x,bottom:bounds.bottom+offset.y};
    placed.push(box);bottom=Math.max(bottom,box.bottom+62);
    result.width=Math.max(result.width,box.right+24);result.height=Math.max(result.height,box.bottom+24);
  }
  snapshots.set(result,{nodes:new Map(nodes.map(n=>[n.id,JSON.stringify([n.width,n.height])])),edges:new Map(edges.map(e=>[e.id,edgeKey(e)])),vertical});
  return result;
}
