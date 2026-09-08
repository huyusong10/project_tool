import {expect,it} from 'vitest';
import ELK from 'elkjs/lib/elk.bundled.js';
import {routeFixedGraph} from '../src/client/fixed-routing';
import {layoutDependencyGraph,roundedRoutePath,type LayoutEdge,type Point} from '../src/client/path-layout';

type Node={id:string;x:number;y:number;width:number;height:number};
function validate(nodes:Node[],edges:LayoutEdge[],routes:ReturnType<typeof routeFixedGraph>){
  expect(Object.keys(routes.edges).sort()).toEqual(edges.map(e=>e.id).sort());
  for(const e of edges){const route=routes.edges[e.id];
    for(let i=1;i<route.points.length;i++){
      const a=route.points[i-1],b=route.points[i];expect(a.x===b.x||a.y===b.y).toBe(true);
      for(const n of nodes){const crossing=a.x===b.x?a.x>n.x+.1&&a.x<n.x+n.width-.1&&Math.max(a.y,b.y)>n.y+.1&&Math.min(a.y,b.y)<n.y+n.height-.1:a.y>n.y+.1&&a.y<n.y+n.height-.1&&Math.max(a.x,b.x)>n.x+.1&&Math.min(a.x,b.x)<n.x+n.width-.1;
        expect(crossing,e.id+' crosses '+n.id).toBe(false);
      }
    }
    if(route.label){const l=route.label;
      for(const n of nodes)expect(l.x<n.x+n.width&&l.x+l.width>n.x&&l.y<n.y+n.height&&l.y+20>n.y).toBe(false);
      for(const other of Object.values(routes.edges)){
        if(other!==route&&other.label){const r=other.label;expect(l.x<r.x+r.width&&l.x+l.width>r.x&&l.y<r.y+20&&l.y+20>r.y).toBe(false);}
        for(let i=1;i<other.points.length;i++){const a=other.points[i-1],b=other.points[i];
          expect(a.y===b.y?a.y>l.y&&a.y<l.y+20&&Math.max(a.x,b.x)>l.x&&Math.min(a.x,b.x)<l.x+l.width:a.x>l.x&&a.x<l.x+l.width&&Math.max(a.y,b.y)>l.y&&Math.min(a.y,b.y)<l.y+20).toBe(false);
        }
      }
    }
  }
}
it('汇合线分开接入，转角与箭头留有距离；无假汇合与反向折返',()=>{
  const nodes=[{id:'merge-a',x:0,y:0,width:244,height:154},{id:'merge-b',x:0,y:260,width:244,height:154},{id:'merge-c',x:600,y:100,width:244,height:154}];
  const edges=[{id:'merge-ac',source:nodes[0].id,target:nodes[2].id,label:'完成后开始',labelWidth:72},{id:'merge-bc',source:nodes[1].id,target:nodes[2].id,label:'部分交付',labelWidth:48}];
  const routes=routeFixedGraph(nodes,edges);validate(nodes,edges,routes);
  expect(routes.edges['merge-ac'].points.at(-1)!.y).not.toBe(routes.edges['merge-bc'].points.at(-1)!.y);
  for(const route of Object.values(routes.edges)){const a=route.points.at(-2)!,b=route.points.at(-1)!;expect(Math.hypot(a.x-b.x,a.y-b.y)).toBeGreaterThanOrEqual(28);}
});
it('新增障碍使缓存直线重新寻路，其他节点坐标不变',()=>{
  const nodes=[{id:'cache-a',x:0,y:0,width:244,height:154},{id:'cache-b',x:850,y:0,width:244,height:154}],edges=[{id:'cache-ab',source:'cache-a',target:'cache-b'}];
  const original=routeFixedGraph(nodes,edges);expect(original.edges['cache-ab'].points).toHaveLength(2);
  nodes.push({id:'cache-obstacle',x:390,y:-5,width:244,height:154});const changed=routeFixedGraph(nodes,edges);validate(nodes,edges,changed);
  expect(changed.edges['cache-ab'].points.length).toBeGreaterThan(2);expect(changed.nodes['cache-a']).toEqual(original.nodes['cache-a']);
});
it('合法往返使用可辨认的回向通道，圆角不改变端点',()=>{
  const nodes=[{id:'return-a',x:0,y:0,width:244,height:154},{id:'return-b',x:560,y:180,width:244,height:154}];
  const edges=[{id:'return-ab',source:'return-a',target:'return-b'},{id:'return-ba',source:'return-b',target:'return-a'}];
  const routes=routeFixedGraph(nodes,edges);validate(nodes,edges,routes);
  for(const edge of edges){const points=routes.edges[edge.id].points;expect(points[0].x).toBe(nodes.find(n=>n.id===edge.source)!.x+244);expect(points.at(-1)!.x).toBe(nodes.find(n=>n.id===edge.target)!.x);expect(roundedRoutePath(points)).toContain(' Q ');}
  const points:Point[]=[{x:0,y:0},{x:10,y:0},{x:10,y:20}];expect(roundedRoutePath(points)).toBe('M 0 0 L 5 0 Q 10 0 10 5 L 10 20');
});
for(const count of [20,80,200])it(`${count} 节点的首次与固定位置路由：每条关系有路径，线路与标签不穿卡`,async()=>{
  const nodes=Array.from({length:count},(_,i)=>({id:'dense-'+count+'-'+i,width:244,height:154}));const edges:LayoutEdge[]=[];
  for(let i=1;i<count;i++)for(const d of [1,3,7])if(i>=d)edges.push({id:`dense-${count}-${i}-${d}`,source:nodes[i-d].id,target:nodes[i].id,label:i%11===0?'部分交付':undefined,labelWidth:56});
  const layout=await layoutDependencyGraph(new ELK(),nodes,edges),positioned=nodes.map(n=>({...n,...layout.nodes[n.id]}));
  const routes=routeFixedGraph(positioned,edges);validate(positioned,edges,routes);
  expect(routeFixedGraph(positioned,[...edges].reverse())).toEqual(routes);
},20000);
