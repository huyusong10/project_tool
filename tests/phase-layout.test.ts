import ELK from 'elkjs/lib/elk.bundled.js';
import {requirementCanvasUrl} from '../src/client/canvas-navigation';
import {expect,it} from 'vitest';
import {featurePhaseLayout,arrangePhaseRegions,phaseLayoutChanges,constrainPhasePosition} from '../src/client/phase-layout';
import type {PathAnalysis} from '../src/shared/paths';
import type {FeatureOverview} from '../src/shared/feature-overview';
import {projectPhaseOverview} from '../src/shared/phase-projection';
import {executionDraftConflicts} from '../src/shared/execution-draft';
import {routeFixedGraph} from '../src/client/fixed-routing';
const empty={add:[],remove:[],estimates:[]};
it('连线避开 Phase 标题区域，布局不增加业务节点或执行依赖',()=>{
  const nodes=[{id:'a',x:0,y:160,width:244,height:168},{id:'b',x:620,y:160,width:244,height:168}],edges=[{id:'a>b',source:'a',target:'b'}];
  const reserved={left:300,right:560,top:130,bottom:310},result=routeFixedGraph(nodes,edges,[reserved]);
  expect(Object.keys(result.nodes)).toEqual(['a','b']);expect(Object.keys(result.edges)).toEqual(['a>b']);
  const points=result.edges['a>b'].points;
  for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];const crosses=a.y===b.y?a.y>reserved.top&&a.y<reserved.bottom&&Math.max(a.x,b.x)>reserved.left&&Math.min(a.x,b.x)<reserved.right:a.x>reserved.left&&a.x<reserved.right&&Math.max(a.y,b.y)>reserved.top&&Math.min(a.y,b.y)<reserved.bottom;expect(crosses).toBe(false);}
});
it('外框按内容伸展，拖动只限制标题和左边留白，不截断横向坐标',async()=>{
  const {data,feature,ids}=fixture(),layout=await measured(data,feature,ids),empty=layout.regions.find(r=>r.id==='p3')!,active=layout.regions.find(r=>r.id==='p2')!;
  expect(empty.height).toBeLessThan(active.height);
  const p=constrainPhasePosition(layout.regions,'b',{x:10000,y:-100});expect(p.x).toBe(10000);expect(p.y).toBe(active.y+148);
});
async function measured(data:PathAnalysis,feature:FeatureOverview,ids:string[],edges:Array<{id:string;source:string;target:string}>=[]){
  const base=featurePhaseLayout(data,feature,'f',ids);
  return arrangePhaseRegions(new ELK(),ids.map(id=>({id,width:244,height:212})),edges,base.regions,base.positions);
}
it('长依赖链、并行分支按拓扑展开，Phase 外框包含所有卡片',async()=>{
  const {data,feature}=fixture();data.requirements=Array.from({length:12},(_,i)=>({id:'n'+i,featureId:'f',phaseId:'p2'})) as PathAnalysis['requirements'];
  const ids=data.requirements.map(r=>r.id),edges=ids.slice(1,8).map((id,i)=>({id:'e'+i,source:ids[i],target:id})).concat(ids.slice(8).map(id=>({id:'fork'+id,source:'n3',target:id})));
  const result=await measured(data,feature,ids,edges),region=result.regions.find(r=>r.id==='p2')!;
  expect(region.width).toBeGreaterThan(2000);
  for(const e of edges)expect(result.positions[e.target].x).toBeGreaterThan(result.positions[e.source].x+244);
  for(const id of ids){const p=result.positions[id];expect(p.x).toBeGreaterThanOrEqual(region.x+24);expect(p.x+244).toBeLessThanOrEqual(region.x+region.width-24);expect(p.y+212).toBeLessThanOrEqual(region.y+region.height-24);}
  for(const [i,a] of ids.entries())for(const b of ids.slice(i+1)){const p=result.positions[a],q=result.positions[b];expect(p.x+244<=q.x||q.x+244<=p.x||p.y+212<=q.y||q.y+212<=p.y).toBe(true);}
});
function fixture(){
  const feature={id:'f',phases:[{id:'p1',featureId:'f',sortOrder:0,name:'第一期',requirements:[],deliveries:[],deliveredAt:null},{id:'p2',featureId:'f',sortOrder:1,name:'第二期',requirements:[],deliveries:[],deliveredAt:null},{id:'p3',featureId:'f',sortOrder:2,name:'远期',requirements:[],deliveries:[],deliveredAt:null}]} as unknown as FeatureOverview;
  const data={requirements:[{id:'a',featureId:'f',phaseId:'p1',status:'completed'},{id:'b',featureId:'f',phaseId:'p2',status:'in_progress'},{id:'c',featureId:'f',phaseId:'p2',status:'not_started'},{id:'u',featureId:'f',phaseId:null,status:'not_started'},{id:'outside',featureId:'g',phaseId:null,status:'not_started'}],layouts:[{scope:'feature:f',direction:'right',version:1,positions:{c:{x:10,y:10},b:{x:20,y:10}}}],nodes:[],edges:[],dependencies:[]} as unknown as PathAnalysis;
  return {feature,data,ids:data.requirements.map(r=>r.id)};
}
it('Phase 按序显示，空 Phase 和未安排区域保留，旧布局仅用于初始顺序',async()=>{
  const {feature,data,ids}=fixture(),before=structuredClone(data),layout=await measured(data,feature,ids);
  expect(layout.regions.map(r=>r.id)).toEqual(['p1','p2','p3','unassigned','external']);expect(layout.regions[2].nodeIds).toEqual([]);expect(layout.regions[1].nodeIds).toEqual(['c','b']);expect(data).toEqual(before);
});
it('区域内位置持久化，拖动越界不会更换 Phase 或改变其他相对位置',async()=>{
  const {feature,data,ids}=fixture(),layout=await measured(data,feature,ids),p=constrainPhasePosition(layout.regions,'b',{x:99999,y:-50});
  const changes=phaseLayoutChanges(empty,data.layouts||[],layout.regions,{...layout.positions,b:p});expect(changes.entities).toBeUndefined();expect(changes.add).toEqual([]);expect(changes.layouts?.every(l=>l.scope.startsWith('feature-phase:'))).toBe(true);
  const restored=await measured({...data,layouts:changes.layouts!.map(l=>({...l,version:1}))},feature,ids);expect(restored.positions.b).toEqual(p);expect(restored.positions.c).toEqual(layout.positions.c);expect(data.requirements.find(r=>r.id==='b')?.phaseId).toBe('p2');
});
it('需求移入目标区域空位，已保存节点相对位置保持，筛选不删除隐藏坐标',async()=>{
  const {feature,data,ids}=fixture(),first=await measured(data,feature,ids),saved=phaseLayoutChanges(empty,[],first.regions,first.positions);
  data.layouts=saved.layouts!.map(l=>({...l,version:2}));data.requirements.find(r=>r.id==='u')!.phaseId='p2';
  const moved=await measured(data,feature,ids);expect(moved.positions.b).toEqual(first.positions.b);expect(moved.positions.c).toEqual(first.positions.c);expect(moved.positions.u).not.toEqual(moved.positions.b);
  const partial=phaseLayoutChanges(empty,data.layouts,moved.regions,{b:moved.positions.b});expect(partial.layouts?.find(l=>l.scope==='feature-phase:f:p2')?.positions.c).toEqual(data.layouts.find(l=>l.scope==='feature-phase:f:p2')?.positions.c);
});
it('草稿归属投影刷新 Phase 分布，交付历史不被重新计算',()=>{
  const {feature,data}=fixture();feature.phases![0].deliveries=[{id:'receipt',snapshot:{name:'一期',requirements:[]}}] as never;
  const report={features:[feature],asOfDate:'2026-09-14',recentFrom:'2026-09-07',unassignedCount:0},snapshot=structuredClone(feature.phases![0].deliveries);
  data.requirements[0].phaseId='p2';const result=projectPhaseOverview(report,data.requirements);expect(result.features[0].phases![0].status).toBe('planning');expect(result.features[0].phases![1].requirements).toHaveLength(3);expect(result.features[0].phases![0].deliveries).toEqual(snapshot);
});
it('Phase 操作检查归属及前置草稿，纯布局不阻塞交付',()=>{
  const {data}=fixture();expect(executionDraftConflicts({...empty,layouts:[{scope:'feature-phase:f:p2',direction:'right',expectedVersion:0,positions:{b:{x:0,y:0}}}]},data,{requirementId:'b',action:'phase'})).toEqual([]);
  expect(executionDraftConflicts({...empty,entities:[{op:'update',entity:'requirement',id:'b',data:{featureId:'g'}}]},data,{requirementId:'b',action:'phase'})).not.toEqual([]);
});

it('Phase 操作覆盖临时新增需求及本 Phase 的未保存字段关联',()=>{const {data}=fixture();expect(executionDraftConflicts({...empty,entities:[{op:'create',entity:'requirement',id:'temp:new',data:{title:'新增交付范围',featureId:'f',phaseId:'p2'}}]},data,{requirementId:'',phaseId:'p2',action:'phase'})).toEqual(['新增交付范围']);expect(executionDraftConflicts({...empty,entities:[{op:'update',entity:'requirement',id:'b',data:{title:'范围修改'}}]},data,{requirementId:'',phaseId:'p2',action:'phase'})).toEqual(['范围修改']);});

it('追查跨 Phase 需求时不携带其他需求的 Phase 筛选',()=>{const {data}=fixture(),params=new URLSearchParams({view:'feature',featureId:'f',phaseId:'p2',mode:'table'});expect(new URL(requirementCanvasUrl('a',params,data),'http://local').searchParams.has('phaseId')).toBe(false);expect(new URL(requirementCanvasUrl('b',params,data),'http://local').searchParams.get('phaseId')).toBe('p2');});
