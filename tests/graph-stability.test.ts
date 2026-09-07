import { expect,it } from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
import {stableGraphLayout} from '../src/client/graph-layout';
import type {LayoutNode,LayoutEdge,RoutedLayout} from '../src/client/path-layout';
const elk=new ELK();
function noOverlap(nodes:LayoutNode[],layout:RoutedLayout){
 for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
  const a={...nodes[i],...layout.nodes[nodes[i].id]},b={...nodes[j],...layout.nodes[nodes[j].id]};
  expect(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y).toBe(true);
 }
}
it('连通范围缓存、合并与拆分保留其他范围和操作锚点，扩展不碰撞',async()=>{
 const nodes:LayoutNode[]=Array.from({length:6},(_,i)=>({id:'stable'+i,width:244,height:154}));
 const edges:LayoutEdge[]=[{id:'s01',source:'stable0',target:'stable1'},{id:'s23',source:'stable2',target:'stable3'},{id:'s45',source:'stable4',target:'stable5'}];
 let calls=0;const engine={layout:(...args:Parameters<typeof elk.layout>)=>{calls++;return elk.layout(...args);}};
 const first=await stableGraphLayout(engine,nodes,edges,false,null);
 const cached=await stableGraphLayout(engine,nodes,edges,false,first,'stable2');expect(cached.nodes).toEqual(first.nodes);expect(calls).toBe(3);
 const added=[...edges,{id:'s12',source:'stable1',target:'stable2'}];
 const merged=await stableGraphLayout(engine,nodes,added,false,cached,'stable1');
 expect(merged.nodes.stable1).toEqual(first.nodes.stable1);expect(merged.nodes.stable4).toEqual(first.nodes.stable4);noOverlap(nodes,merged);
 const split=await stableGraphLayout(engine,nodes,edges,false,merged,'stable1');expect(split.nodes).toEqual(merged.nodes);expect(calls).toBe(4);
 const expanded=nodes.map(n=>n.id==='stable0'?{...n,height:900}:n);
 const grown=await stableGraphLayout(engine,expanded,edges,false,split,'stable0');noOverlap(expanded,grown);
 expect(grown.nodes.stable4).toEqual(split.nodes.stable4);
 const arranged=await stableGraphLayout(engine,expanded,edges,false,grown,undefined,true);noOverlap(expanded,arranged);
});
