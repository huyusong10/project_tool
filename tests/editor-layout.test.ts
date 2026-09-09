import {expect,it} from 'vitest';
import {arrangeLate} from '../src/shared/late-schedule';
import {routeFixedGraph,vacantPosition} from '../src/client/fixed-routing';
import {resolveTemplateOffsets} from '../src/shared/path-template';
it('第5日后置并行不推迟交付；已开始工作不后移，后续更早时受其限制',()=>{
 const entries=[{id:'a',start:0,finish:2,duration:2},{id:'b',start:2,finish:3,duration:1,arrangement:'late' as const},{id:'c',start:2,finish:5,duration:3},{id:'m',start:5,finish:5,duration:0}].map(n=>({...n,movable:true,reliable:true}));
 const edges=[{source:'a',target:'b'},{source:'a',target:'c'},{source:'b',target:'m'},{source:'c',target:'m'}],order=['a','b','c','m'];
 const result=arrangeLate(order,entries,edges);expect(result.get('b')).toEqual({start:4,finish:5,buffer:0});expect(result.get('m')?.finish).toBe(5);
 entries[1].movable=false;expect(arrangeLate(order,entries,edges).get('b')?.start).toBe(2);entries[1].movable=true;entries[1].reliable=false;expect(arrangeLate(order,entries,edges).get('b')).toEqual({start:2,finish:3,buffer:null});
});
it('固定位置路由避开中间卡片，移动与增删连线不改变其他节点',()=>{
 const nodes=[{id:'a',x:0,y:0,width:244,height:154},{id:'b',x:700,y:0,width:244,height:154},{id:'obstacle',x:340,y:-10,width:244,height:154}];
 const result=routeFixedGraph(nodes,[{id:'ab',source:'a',target:'b',label:'完成后开始',labelWidth:80}]);expect(result.nodes).toEqual(Object.fromEntries(nodes.map(n=>[n.id,{x:n.x,y:n.y}])));
 const points=result.edges.ab.points;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];expect(a.x===b.x||a.y===b.y).toBe(true);for(const n of nodes.filter(n=>n.id==='obstacle'))expect(a.x===b.x?(a.x>n.x&&a.x<n.x+n.width&&Math.max(a.y,b.y)>n.y&&Math.min(a.y,b.y)<n.y+n.height):(a.y>n.y&&a.y<n.y+n.height&&Math.max(a.x,b.x)>n.x&&Math.min(a.x,b.x)<n.x+n.width)).toBe(false);}
 expect(result.edges.ab.label).not.toBeNull();const vacant=vacantPosition(nodes,'new',{x:0,y:0});expect(vacant).not.toEqual({x:0,y:0});
});
it('模板零工期里程碑可以汇合多个前置，晚排工作与文档收尾并行',()=>{
 const items=[{clientKey:'a',title:'接口实现',durationDays:2,startOffsetDays:0,predecessorKeys:[]},{clientKey:'b',title:'接口交付',durationDays:1,startOffsetDays:0,predecessorKeys:['a'],arrangement:'late' as const},{clientKey:'c',title:'文档整理',durationDays:3,startOffsetDays:0,predecessorKeys:['a']},{clientKey:'m',title:'交付',kind:'milestone' as const,durationDays:0,startOffsetDays:0,predecessorKeys:['b','c']}];
 const result=resolveTemplateOffsets(items);expect(result.find(i=>i.clientKey==='b')?.startOffsetDays).toBe(4);expect(result.find(i=>i.clientKey==='m')?.startOffsetDays).toBe(5);
});

it('字段冲突逐项选择，未冲突字段保留；布局冲突独立检查版本',async()=>{
 const {rebaseEditor}=await import('../src/client/editor-rebase'),{pathFixture}=await import('./fixtures/path-network'),{analysePaths}=await import('../src/shared/paths');
 const input=pathFixture();input.workItems[0].version=1;const base=analysePaths(input),server=structuredClone(base);server.nodes[0].title='其他值';const work=server.nodes.find(n=>n.id==='A1')!;work.title='服务端标题';work.version=2;
 const changes={add:[],remove:[],estimates:[],entities:[{entity:'work' as const,op:'update' as const,id:'A1',expectedVersion:1,data:{title:'草稿标题',durationDays:6}}]};
 const result=rebaseEditor(base,server,changes);expect(result.pending.map(c=>c.key)).toContain('A1:title');const merged=rebaseEditor(base,server,changes,{'A1:title':'server'});expect(merged.pending).toHaveLength(0);expect(merged.changes.entities?.[0].data).toEqual({durationDays:6});expect(merged.changes.entities?.[0].expectedVersion).toBe(2);
});

it('交付点失效时即使预测未知也拒绝保存，避免后续恢复后整张分析失效',()=>{
 expect(()=>arrangeLate(['a','m'],[{id:'a',start:0,finish:1,duration:1,arrangement:'late',anchor:'missing',reliable:false,movable:true},{id:'m',start:1,finish:1,duration:0,reliable:false,movable:false}],[{source:'a',target:'m'}])).toThrow('下游');
});

it('恢复草稿时已经删除的关系端点必须核对，不静默保留或提交',async()=>{
 const {rebaseEditor}=await import('../src/client/editor-rebase'),{pathFixture}=await import('./fixtures/path-network'),{analysePaths}=await import('../src/shared/paths');
 const base=analysePaths(pathFixture()),server=structuredClone(base);server.nodes=server.nodes.filter(n=>n.id!=='A1');
 const changes={remove:[],estimates:[],add:[{clientId:'edge',sourceRequirementId:'A',sourceWorkItemId:'A1',targetRequirementId:'B',targetWorkItemId:'B1'}]};
 const result=rebaseEditor(base,server,changes);expect(result.pending[0]).toMatchObject({key:'relation:edge',canKeep:false});
 expect(rebaseEditor(base,server,changes,{'relation:edge':'server'}).changes.add).toEqual([]);
});
