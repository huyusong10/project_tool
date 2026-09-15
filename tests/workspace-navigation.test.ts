import {describe,it,expect} from 'vitest';
import {readWorkspaceLocation,workspaceAncestors,workspaceParams,type WorkspaceLocation} from '../src/client/workspace-location';
import {workspaceSummary} from '../src/client/workspace-summary';
import {reorderSelection} from '../src/client/outline-model';
import type {PathAnalysis} from '../src/shared/paths';

const data={projectId:'p',projectName:'项目',requirements:[
  {id:'a',title:'需求 A',featureId:'f',phaseId:'one',status:'in_progress'},
  {id:'b',title:'需求 B',featureId:'f',phaseId:null,status:'not_started'},
  {id:'c',title:'取消需求',featureId:'f',phaseId:'one',status:'cancelled'},
  {id:'d',title:'其他需求',featureId:'other',phaseId:null,status:'completed'},
],nodes:[],blockers:[{nodeId:'external',requirementId:'external-r',affectedRequirementIds:['a'],reasons:['环境未就绪']},{nodeId:'external',requirementId:'external-r',affectedRequirementIds:['b','c'],reasons:['环境未就绪','需要协调']}],featureContext:{overview:{features:[
  {id:'f',name:'特性',phases:[{id:'one',name:'第一批',featureId:'f',requirements:[{id:'done',status:'completed',deletedAt:'2026-01-01'},{id:'cancelled',status:'cancelled',deletedAt:'2026-01-01'}]},{id:'two',featureId:'f',requirements:[{id:'done',status:'completed',deletedAt:'2026-01-01'}]}]},
  {id:'other',kind:'other',name:'旧名称',phases:[]},
]}}} as unknown as PathAnalysis;
const location=(kind:WorkspaceLocation['scope']['kind'],id:string):WorkspaceLocation=>({projectId:'p',view:'list',scope:{kind,id}});
describe('公共范围与旧网址',()=>{
  it('默认清单，旧进展链接的选中需求不会被当作范围',()=>{
    expect(readWorkspaceLocation(new URLSearchParams(),'p').view).toBe('list');
    const old=readWorkspaceLocation(new URLSearchParams('featureId=f&phaseId=one&requirementId=b&pathNode=b'),'p','/execution');
    expect(old).toMatchObject({view:'progress',scope:{kind:'phase',id:'one'},inspector:'b'});
  });
  it('需求归属决定面包屑，未安排 Phase 省略该层；详情保持独立',()=>{
    expect(workspaceAncestors(location('requirement','a'),data).map(t=>t.label)).toEqual(['项目','特性','第一批','需求 A']);
    expect(workspaceAncestors(location('requirement','b'),data).map(t=>t.scope.kind)).toEqual(['project','feature','requirement']);
    const current={...location('phase','one'),inspector:'b'},next=workspaceParams({...current,view:'progress'},data);
    expect(readWorkspaceLocation(next,'p')).toEqual({...current,view:'progress'});
    expect(next.get('requirementId')).toBeNull();
  });
  it('旧特性选择与旧 Phase 选择只打开资料',()=>{
    expect(readWorkspaceLocation(new URLSearchParams('feature=f'),'p','/features')).toMatchObject({scope:{kind:'project',id:'p'},inspector:'feature:f'});
    expect(readWorkspaceLocation(new URLSearchParams('view=features&phaseId=one&pathNode=feature:f'),'p')).toMatchObject({scope:{kind:'project',id:'p'},inspector:'phase:one'});
  });
});
describe('范围概览',()=>{
  it('取消项不计成果，归档完成项保留贡献且去重；并行批次分别统计',()=>{
    const summary=workspaceSummary(location('project','p'),data);
    expect(summary.requirements.map(r=>r.id)).toEqual(['a','b','d','done']);expect(summary.phases).toHaveLength(2);expect(summary.unphased.map(r=>r.id)).toEqual(['b','d']);
    expect(summary.blockers).toHaveLength(1);expect(summary.blockers[0].affectedRequirementIds).toEqual(['a','b','c']);expect([...summary.blockedIds]).toEqual(['a','b']);
  });
  it('Phase、需求和未安排集合只统计自己的内容，外部前置仍保留',()=>{
    expect(workspaceSummary(location('phase','one'),data).requirements.map(r=>r.id)).toEqual(['a','done']);
    const req=workspaceSummary(location('requirement','b'),data);expect(req.requirements.map(r=>r.id)).toEqual(['b']);expect(req.phases).toEqual([]);expect([...req.blockedIds]).toEqual(['b']);
    expect(workspaceSummary(location('unphased','f'),data).requirements.map(r=>r.id)).toEqual(['b']);
  });
});
it('多选拖拽保留来源顺序，不使用勾选顺序',()=>{
  expect(reorderSelection(['a','b','c','d','e'],['d','b'],'a')).toEqual(['b','d','a','c','e']);
  expect(reorderSelection(['a','b','c','d','e'],['b','a'],'e',true)).toEqual(['c','d','e','a','b']);
});
