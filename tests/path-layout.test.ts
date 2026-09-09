import { describe, expect, it } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
import { layoutDependencyGraph, type LayoutNode, type LayoutEdge } from '../src/client/path-layout';
const engine=new ELK();
function graph(count:number):{nodes:LayoutNode[];edges:LayoutEdge[]} {
  const nodes=Array.from({length:count},(_,i)=>({id:`n${i}`,width:i%5===0?164:244,height:110+(i%3)*20})),edges:LayoutEdge[]=[];
  for(let i=1;i<count;i++)for(const delta of [1,3,7])if(i>=delta)edges.push({id:`e${i}-${delta}`,source:`n${i-delta}`,target:`n${i}`,label:i%11===0?'部分交付':undefined});
  return {nodes,edges};
}
describe('ELK 动态布局',()=>{
  for(const count of [20,80,200])it(`${count}个无坐标节点：节点不重叠、边不穿卡、端点正确`,async()=>{
    const {nodes,edges}=graph(count),layout=await layoutDependencyGraph(engine,nodes,edges);
    for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
      const a={...nodes[i],...layout.nodes[nodes[i].id]},b={...nodes[j],...layout.nodes[nodes[j].id]};
      expect(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y).toBe(true);
    }
    for(const e of edges){
      const points=layout.edges[e.id].points,source=nodes.find(n=>n.id===e.source)!;
      expect(points[0].x).toBeCloseTo(layout.nodes[e.source].x+source.width);expect(points.at(-1)!.x).toBeCloseTo(layout.nodes[e.target].x);
      for(let i=1;i<points.length;i++)for(const n of nodes){
        if(n.id===e.source||n.id===e.target)continue;
        const p=layout.nodes[n.id],a=points[i-1],b=points[i];
        const intersects=a.x===b.x ? a.x>p.x+.5&&a.x<p.x+n.width-.5&&Math.max(a.y,b.y)>p.y+.5&&Math.min(a.y,b.y)<p.y+n.height-.5
          : a.y>p.y+.5&&a.y<p.y+n.height-.5&&Math.max(a.x,b.x)>p.x+.5&&Math.min(a.x,b.x)<p.x+n.width-.5;
        expect(intersects,`${e.id}穿过${n.id}`).toBe(false);
      }
    }
  },15000);
  it('动态增删、纵向及需求级双向关系保持真实箭头端点',async()=>{
    const first=graph(12);const layouts=[await layoutDependencyGraph(engine,first.nodes,first.edges,true),await layoutDependencyGraph(engine,first.nodes.slice(0,10),first.edges.filter(e=>Number(e.target.slice(1))<10),true)];
    expect(Object.keys(layouts[0].nodes)).toHaveLength(12);expect(Object.keys(layouts[1].nodes)).toHaveLength(10);
    const cycle=await layoutDependencyGraph(engine,first.nodes.slice(0,2),[{id:'ab',source:'n0',target:'n1'},{id:'ba',source:'n1',target:'n0'}]);
    expect(cycle.edges.ab.points.at(-1)!.x).toBeCloseTo(cycle.nodes.n1.x);expect(cycle.edges.ba.points.at(-1)!.x).toBeCloseTo(cycle.nodes.n0.x);
  });
});
