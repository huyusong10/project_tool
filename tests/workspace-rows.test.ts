import {expect,it} from 'vitest';
import {workspaceRows,filterWorkspaceRows,flattenWorkspaceRows} from '../src/client/workspace-rows';
import type {Dashboard} from '../src/client/types';
import {deriveExecutionStage} from '../src/shared/execution-stage';

const stage=deriveExecutionStage({status:'in_progress'},[{title:'测试',status:'in_progress',workStage:'testing',progress:70,progressWeight:1}]);
function fixture(){return {asOfDate:'2026-09-14',requirements:[{id:'r',title:'资产导入',featureId:'f',phaseId:'p',status:'in_progress',executionStage:stage,workItems:[{id:'w',title:'测试',status:'in_progress',progress:70}]}],featureOverview:{features:[{id:'f',name:'资产管理',phases:[{id:'p',name:'Phase 1',status:'in_progress',requirements:[{id:'r',title:'资产导入',status:'in_progress',executionStage:stage},{id:'archived',title:'归档交付',status:'completed',deletedAt:'2026-09-13',executionStage:deriveExecutionStage({status:'completed'})}]},{id:'empty',name:'探索',status:'planning',requirements:[]}]},{id:'empty-feature',name:'告警管理',phases:[]}]}} as unknown as Dashboard;}
const filters={query:'',featureId:'',phaseId:'',state:'active',stage:''};
it('初始展开到需求，工作项折叠，空范围与归档贡献保留',()=>{
  const tree=workspaceRows(fixture());expect(flattenWorkspaceRows(tree,{}).map(r=>r.row.title)).toEqual(['资产管理','Phase 1','归档交付','资产导入','探索','告警管理']);
  expect(flattenWorkspaceRows(tree,{p:true,'phase:p':true,r:true}).map(r=>r.row.title)).toContain('测试');
  expect(tree[0].children[1].children).toEqual([]);expect(tree[1].children).toEqual([]);
  expect(tree[0].children[0].children.find(r=>r.id==='r')!.requirement?.executionStage?.stages[0].progress).toBe(70);
});
it('搜索工作保留祖先，完整 Phase 状态和归档贡献不被筛选重算',()=>{
  const tree=workspaceRows(fixture()),phase=tree[0].children[0].phase;
  const filtered=filterWorkspaceRows(tree,{...filters,query:'测试'});
  expect(flattenWorkspaceRows(filtered,{},true).map(r=>r.row.title)).toEqual(['资产管理','Phase 1','资产导入','测试']);
  expect(filtered[0].children[0].phase).toBe(phase);expect(phase?.requirements).toHaveLength(2);
  const archived=tree[0].children[0].children.find(r=>r.id==='archived')!;expect(archived.archived).toBe(true);expect(archived.temporary).toBe(false);expect(archived.children).toEqual([]);
});
it('特性与 Phase 条件保留空批次，归档特性只在显式筛选下出现',()=>{
  const report=fixture();report.featureOverview!.features[1].archivedAt='2026-09-10';
  expect(filterWorkspaceRows(workspaceRows(report),filters).map(r=>r.id)).toEqual(['feature:f']);
  expect(filterWorkspaceRows(workspaceRows(report),{...filters,state:'archived'}).map(r=>r.id)).toEqual(['feature:empty-feature']);
  expect(filterWorkspaceRows(workspaceRows(report),{...filters,featureId:'f',phaseId:'empty'})[0].children.map(r=>r.title)).toEqual(['探索']);
});

it('正式工作顺序覆盖路径的 ID 顺序；临时工作追加，执行操作保留正式版本',()=>{
  const report=fixture(),r=report.requirements[0],sample=r.workItems[0];
  r.version=9;r.ownerId='owner';r.workItems=['z','a','m'].map((id,i)=>({...sample,id,title:'工作 '+i,sortOrder:i,version:i+2}));
  const projection={requirements:[{...r,ownerId:'draft-owner'}],nodes:[...r.workItems].reverse().map(w=>({...w,kind:'work',requirementId:r.id,title:'草稿 '+w.title})).concat([{...sample,id:'new',kind:'work',requirementId:r.id,title:'新增',sortOrder:0,version:0}])} as unknown as import('../src/shared/paths').PathAnalysis;
  const children=()=>workspaceRows(report,projection)[0].children[0].children.find(row=>row.id==='r')!.children;
  expect(children().map(row=>row.id)).toEqual(['z','a','m','new']);
  expect(children()[0].formalWork).toBe(r.workItems[0]);expect(children()[0].formalRequirement).toBe(r);
  expect(children()[0].requirement?.ownerId).toBe('draft-owner');expect(children()[0].formalRequirement?.ownerId).toBe('owner');
  expect(children()[3].temporary).toBe(true);expect(children()[3].formalWork).toBeUndefined();
  r.workItems.forEach(w=>w.sortOrder=0);expect(children().map(row=>row.id)).toEqual(['z','a','m','new']);
  r.workItems[0].progress=99;r.workItems[0].updatedAt='2099-01-01';expect(children().map(row=>row.id)).toEqual(['z','a','m','new']);
});
it('需求自然编号排序不受最新修改时间影响',()=>{
  const report=fixture(),r=report.requirements[0];report.requirements=[12,2,1].map(n=>({...r,id:'r'+n,title:'DCIM-'+n,updatedAt:'2026-09-'+n}));
  expect(workspaceRows(report)[0].children[0].children.filter(row=>!row.archived).map(row=>row.title)).toEqual(['DCIM-1','DCIM-2','DCIM-12']);
});
