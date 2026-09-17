import {outlineRows,scopeOutline} from '../src/client/outline-model';
import {expect,it} from 'vitest';
import {workspaceRows,scopeWorkspaceRows,filterWorkspaceRows,flattenWorkspaceRows} from '../src/client/workspace-rows';
import type {Dashboard} from '../src/client/types';
import {deriveExecutionStage} from '../src/shared/execution-stage';
import {selectedProgressStates,progressStatesValue,progressStatesLabel} from '../src/client/progress-filters';

const stage=deriveExecutionStage({status:'in_progress'},[{title:'测试',status:'in_progress',workStage:'testing',progress:70,progressWeight:1}]);
function fixture(){return {asOfDate:'2026-09-14',requirements:[{id:'r',title:'资产导入',featureId:'f',phaseId:'p',status:'in_progress',executionStage:stage,workItems:[{id:'w',title:'测试',status:'in_progress',progress:70}]}],featureOverview:{features:[{id:'f',name:'资产管理',phases:[{id:'p',name:'Phase 1',status:'in_progress',requirements:[{id:'r',title:'资产导入',status:'in_progress',executionStage:stage},{id:'archived',title:'归档交付',status:'completed',deletedAt:'2026-09-13',executionStage:deriveExecutionStage({status:'completed'})}]},{id:'empty',name:'探索',status:'planning',requirements:[]}]},{id:'empty-feature',name:'告警管理',phases:[]}]}} as unknown as Dashboard;}
const filters={query:'',featureId:'',phaseId:'',state:'active',stage:''};
it('切换项目和特性范围保留空特性、空 Phase；执行筛选仍排除空对象',()=>{
  const tree=workspaceRows(fixture()),all=filterWorkspaceRows(tree,filters);
  expect(scopeWorkspaceRows(all,{kind:'project',id:'project'}).map(r=>r.id)).toContain('feature:empty-feature');
  expect(scopeWorkspaceRows(all,{kind:'feature',id:'f'}).map(r=>r.id)).toContain('phase:empty');
  expect(scopeWorkspaceRows(all,{kind:'phase',id:'empty'})).toEqual([]);
  const active=filterWorkspaceRows(tree,{...filters,status:'in_progress'});
  expect(scopeWorkspaceRows(active,{kind:'project',id:'project'}).map(r=>r.id)).not.toContain('feature:empty-feature');
  expect(scopeWorkspaceRows(active,{kind:'feature',id:'f'}).map(r=>r.id)).not.toContain('phase:empty');
});
it('未分派阶段固定在特性末尾，默认折叠；筛选保留分组和正式归属',()=>{
  const report=fixture(),r=report.requirements[0];report.requirements.push({...r,id:'flat',phaseId:null,title:'待分派'});
  const rows=workspaceRows(report),group=rows[0].children.at(-1)!;
  expect(group).toMatchObject({id:'unphased:f',kind:'phase',virtual:true,title:'未分派阶段',phaseId:'unassigned'});
  expect(group.phase).toBeUndefined();expect(group.children.map(row=>row.id)).toEqual(['flat']);expect(group.children[0].requirement?.phaseId).toBeNull();
  expect(flattenWorkspaceRows(rows,{}).map(r=>r.row.id)).not.toContain('flat');
  expect(flattenWorkspaceRows(rows,{'unphased:f':true}).find(r=>r.row.id==='flat')?.depth).toBe(2);
  expect(filterWorkspaceRows(rows,{...filters,phaseId:'p'})[0].children.map(r=>r.id)).not.toContain('unphased:f');
  expect(filterWorkspaceRows(rows,{...filters,phaseId:'unassigned',featureId:'f'})[0].children.map(r=>r.id)).toEqual(['unphased:f']);
});
it('初始展开到需求，工作项折叠，空分组隐藏，正式空 Phase 与归档贡献保留',()=>{
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
  const outline=scopeOutline(outlineRows(report,projection),{kind:'requirement',id:r.id});
  expect(outline[0]).toMatchObject({title:'草稿 工作 0',version:2,work:{progress:70},formalWork:r.workItems[0]});
  expect(outline[3]).toMatchObject({title:'新增',temporary:true});
  expect(r.workItems[0].title).toBe('工作 0');
  r.workItems.forEach(w=>w.sortOrder=0);expect(children().map(row=>row.id)).toEqual(['z','a','m','new']);
  r.workItems[0].progress=99;r.workItems[0].updatedAt='2099-01-01';expect(children().map(row=>row.id)).toEqual(['z','a','m','new']);
});
it('需求自然编号排序不受最新修改时间影响',()=>{
  const report=fixture(),r=report.requirements[0];report.requirements=[12,2,1].map(n=>({...r,id:'r'+n,title:'DCIM-'+n,updatedAt:'2026-09-'+n}));
  expect(workspaceRows(report)[0].children[0].children.filter(row=>!row.archived).map(row=>row.title)).toEqual(['DCIM-1','DCIM-2','DCIM-12']);
});
it('默认特性跟随首条需求的自然编号顺序，批次和工作流程不随标题重排',()=>{
  const report=fixture(),r=report.requirements[0],f=report.featureOverview!.features[0];
  report.featureOverview!.features=[{...f,id:'b',name:'日志',sortOrder:0},{...f,id:'a',name:'权限',sortOrder:9}];
  report.requirements=[39,34,120,119,36,38].map(n=>({...r,id:'r'+n,title:'DCIM-'+n,featureId:n<100?'a':'b',phaseId:null}));
  const tree=workspaceRows(report);
  expect(tree.map(row=>row.title)).toEqual(['权限','日志']);
  expect(tree[0].children.find(row=>row.virtual)!.children.map(row=>row.title)).toEqual(['DCIM-34','DCIM-36','DCIM-38','DCIM-39']);
  expect(filterWorkspaceRows(tree,{...filters,query:'120'}).map(row=>row.title)).toEqual(['日志']);
  expect(workspaceRows(report,undefined,'feature').map(row=>row.title)).toEqual(['权限','日志']);
});
it('执行状态和人员按工作项自身筛选，祖先仅作定位，原始 Phase 不变',()=>{
  const report=fixture(),r=report.requirements[0],w=r.workItems[0];
  r.ownerId='pm';r.workItems=[{...w,id:'done',status:'completed',ownerId:'a'},{...w,id:'running',status:'in_progress',ownerId:'b'},{...w,id:'new',status:'not_started',ownerId:'a'},{...w,id:'cancelled',status:'cancelled',ownerId:null}];
  const tree=workspaceRows(report),ids=(status:string,person='')=>flattenWorkspaceRows(filterWorkspaceRows(tree,{...filters,status,person}),{},true).filter(({row})=>row.kind==='work').map(({row})=>row.id);
  expect(ids('not_started,in_progress')).toEqual(['running','new']);
  expect(ids('in_progress,completed,cancelled')).toEqual(['done','running','cancelled']);
  expect(ids('in_progress')).toEqual(['running']);expect(ids('none')).toEqual([]);
  expect(ids('','a')).toEqual(['done','new']);expect(ids('','unassigned')).toEqual(['cancelled']);
  const matching=filterWorkspaceRows(tree,{...filters,status:'completed'}),parent=matching[0].children[0].children.find(row=>row.id===r.id)!;
  expect(parent.filterContext).toBe(true);expect(matching[0].children[0].phase).toBe(tree[0].children[0].phase);
  expect(flattenWorkspaceRows(matching,{r:false}).some(({row})=>row.id==='done')).toBe(false);
});
it('旧筛选链接保留，任意多选与全不选能够往返',()=>{
  expect(selectedProgressStates('unfinished')).toEqual(['not_started','in_progress']);
  expect(selectedProgressStates('completed')).toEqual(['completed']);
  expect(progressStatesValue(selectedProgressStates(''))).toBe('');
  expect(progressStatesValue([])).toBe('none');
  expect(progressStatesLabel('not_started,in_progress')).toBe('尚未结束');
  expect(selectedProgressStates(progressStatesValue(['completed','not_started']))).toEqual(['not_started','completed']);
});

it('取消工作保留执行记录，图形草稿移除的其他工作不重新出现',()=>{
  const report=fixture(),r=report.requirements[0];r.workItems.push({...r.workItems[0],id:'cancelled',title:'取消的工作',status:'cancelled',sortOrder:1});
  const projection={requirements:[r],nodes:[]} as unknown as import('../src/shared/paths').PathAnalysis;
  const rows=workspaceRows(report,projection),works=flattenWorkspaceRows(rows,{},true).filter(({row})=>row.kind==='work').map(({row})=>row);
  expect(works.map(w=>w.id)).toEqual(['cancelled']);expect(works[0].formalWork).toBe(r.workItems[1]);expect(works[0].work?.status).toBe('cancelled');
  expect(flattenWorkspaceRows(filterWorkspaceRows(rows,{...filters,status:'in_progress'}),{},true).some(({row})=>row.id==='cancelled')).toBe(false);
});

it('清单复用分组，同级排序仍以真实特性为父级，其他需求也保留分组',()=>{
 const report=fixture(),r=report.requirements[0];report.requirements=[{...r,id:'flat',phaseId:null}];report.featureOverview!.features[0].kind='other';
 const tree=outlineRows(report,{projectId:'project',requirements:report.requirements,nodes:[]} as unknown as import('../src/shared/paths').PathAnalysis);
 const group=tree.find(row=>row.featureId==='f')!.children.at(-1)!;expect(group).toMatchObject({id:'unphased:f',virtual:true,system:true,objectId:'f'});expect(group.children[0]).toMatchObject({id:'flat',parentId:'f',system:false});expect(scopeOutline(tree,{kind:'unphased',id:'f'}).map(row=>row.id)).toEqual(['flat']);
});
