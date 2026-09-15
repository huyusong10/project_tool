import type { ElkNode } from 'elkjs/lib/elk-api';
export type LayoutNode = { id: string; width: number; height: number };
export type LayoutEdge = { id: string; source: string; target: string; label?: string; labelWidth?:number };
export type Point = { x: number; y: number };
export function roundedRoutePath(points:Point[],radius=6):string{
  if(!points.length)return '';
  let path=`M ${points[0].x} ${points[0].y}`;
  for(let i=1;i<points.length-1;i++){
    const a=points[i-1],b=points[i],c=points[i+1],before=Math.hypot(b.x-a.x,b.y-a.y),after=Math.hypot(c.x-b.x,c.y-b.y),r=Math.min(radius,before/2,after/2);
    if(!r)continue;
    const p={x:b.x-(b.x-a.x)*r/before,y:b.y-(b.y-a.y)*r/before},q={x:b.x+(c.x-b.x)*r/after,y:b.y+(c.y-b.y)*r/after};
    path+=` L ${p.x} ${p.y} Q ${b.x} ${b.y} ${q.x} ${q.y}`;
  }
  const end=points.at(-1)!;return path+` L ${end.x} ${end.y}`;
}
export type RoutedLayout = { nodes: Record<string, Point>; edges: Record<string, { points: Point[]; label: (Point & {width:number}) | null }>; width: number; height: number };
export const inputPort = (edgeId: string) => `in:${edgeId}`;
export const outputPort = (edgeId: string) => `out:${edgeId}`;
export function portsFor(id: string, edges: LayoutEdge[]) {
  return { input: edges.filter(e=>e.target===id).sort((a,b)=>a.id.localeCompare(b.id)), output: edges.filter(e=>e.source===id).sort((a,b)=>a.id.localeCompare(b.id)) };
}
export async function layoutDependencyGraph(engine: {layout(graph: ElkNode): Promise<ElkNode>}, nodes: LayoutNode[], edges: LayoutEdge[], vertical = false): Promise<RoutedLayout> {
  const graph: ElkNode = { id: 'delivery', layoutOptions: {
    'elk.algorithm':'layered','elk.direction':vertical?'DOWN':'RIGHT','elk.edgeRouting':'ORTHOGONAL',
    // Separate components may gain cross-Phase edges later; leave room for their routing ports.
    'elk.spacing.nodeNode':'38','elk.spacing.componentComponent':'64','elk.layered.spacing.nodeNodeBetweenLayers':'96', 'elk.spacing.edgeNode':'22',
    'elk.layered.spacing.edgeNodeBetweenLayers':'22','elk.spacing.edgeEdge':'14', 'elk.layered.mergeEdges':'false',
    'elk.layered.considerModelOrder.strategy':'NODES_AND_EDGES','elk.randomSeed':'1', 'elk.padding':'[top=24,left=24,bottom=24,right=24]',
  }, children: nodes.map(n=> {
    const ports=portsFor(n.id,edges);
    return { ...n,layoutOptions:{'elk.portConstraints':'FIXED_POS'},ports:[
      ...ports.input.map((e,i)=>({id:inputPort(e.id),width:0,height:0,x:vertical?n.width*(i+1)/(ports.input.length+1):0,y:vertical?0:n.height*(i+1)/(ports.input.length+1),layoutOptions:{'elk.port.side':vertical?'NORTH':'WEST'}})),
      ...ports.output.map((e,i)=>({id:outputPort(e.id),width:0,height:0,x:vertical?n.width*(i+1)/(ports.output.length+1):n.width,y:vertical?n.height:n.height*(i+1)/(ports.output.length+1),layoutOptions:{'elk.port.side':vertical?'SOUTH':'EAST'}})),
    ]};
  }), edges: edges.map(e=>({id:e.id,sources:[outputPort(e.id)],targets:[inputPort(e.id)],...(e.label?{labels:[{text:e.label,width:e.labelWidth??Math.max(44,Array.from(e.label).length*12),height:20}]}:{})})) };
  const result=await engine.layout(graph);
  return { width:result.width||0,height:result.height||0,nodes:Object.fromEntries((result.children||[]).map(n=>[n.id,{x:n.x||0,y:n.y||0}])),
    edges:Object.fromEntries((result.edges||[]).map(e=>{
      const sections=e.sections||[];
      if(sections.length!==1) throw new Error('依赖连线未生成完整路径');
      const s=sections[0], label=e.labels?.[0];
      return [e.id,{points:[s.startPoint,...s.bendPoints||[],s.endPoint],label:label?{x:label.x||0,y:label.y||0,width:label.width||44}:null}];
    })) };
}
