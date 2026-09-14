import {expect,it} from 'vitest';
import {workspaceRows,filterWorkspaceRows,flattenWorkspaceRows} from '../src/client/workspace-rows';
import type {Dashboard} from '../src/client/types';
import {deriveExecutionStage} from '../src/shared/execution-stage';

const stage=deriveExecutionStage({status:'in_progress'},[{title:'测试',status:'in_progress',workStage:'testing',progress:70,progressWeight:1}]);
function fixture(){return {asOfDate:'2026-09-14',requirements:[{id:'r',title:'资产导入',featureId:'f',phaseId:'p',status:'in_progress',executionStage:stage,workItems:[{id:'w',title:'测试',status:'in_progress',progress:70}]}],featureOverview:{features:[{id:'f',name:'资产管理',phases:[{id:'p',name:'Phase 1',status:'in_progress',requirements:[{id:'r',title:'资产导入',status:'in_progress',executionStage:stage},{id:'archived',title:'归档交付',status:'completed',deletedAt:'2026-09-13',executionStage:deriveExecutionStage({status:'completed'})}]},{id:'empty',name:'探索',status:'planning',requirements:[]}]},{id:'empty-feature',name:'告警管理',phases:[]}]}} as unknown as Dashboard;}
const filters={query:'',featureId:'',phaseId:'',state:'active',stage:'',attention:false};
it('初始只展开特性，空 Phase 与空特性没有子行，阶段保留 70%',()=>{
  const tree=workspaceRows(fixture());expect(flattenWorkspaceRows(tree,{}).map(r=>r.row.title)).toEqual(['资产管理','Phase 1','探索','告警管理']);
  expect(flattenWorkspaceRows(tree,{p:true,'phase:p':true,r:true}).map(r=>r.row.title)).toContain('测试');
  expect(tree[0].children[1].children).toEqual([]);expect(tree[1].children).toEqual([]);
  expect(tree[0].children[0].children[0].requirement?.executionStage?.stages[0].progress).toBe(70);
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
