import {describe,it,expect} from 'vitest';
import {dependencyWorkspaceLocation,editorFieldLocation,readWorkspaceLocation,workspaceAncestors,workspaceParams,type WorkspaceLocation} from '../src/client/workspace-location';
import {workspaceSummary} from '../src/client/workspace-summary';
import {reorderSelection} from '../src/client/outline-model';
import type {PathAnalysis} from '../src/shared/paths';

const data={asOfDate:'2026-09-16',projectId:'p',projectName:'项目',requirements:[
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
  it('实际依赖进入后续需求所属特性，并打开指定关系',()=>{
    const linked={...data,dependencies:[{id:'cross',sourceRequirementId:'a',targetRequirementId:'d'}]} as PathAnalysis;
    const params=new URL(dependencyWorkspaceLocation(linked,'cross')!,'http://local').searchParams;
    expect(readWorkspaceLocation(params,'p')).toMatchObject({view:'graph',scope:{kind:'feature',id:'other'},inspector:undefined});
    expect(params.get('pathRelation')).toBe('cross');expect(params.get('graphInspector')).toBe('open');
    expect(dependencyWorkspaceLocation(linked,'missing')).toBeUndefined();
  });
  it('错误草稿字段定位到所属范围，不打开正式资料或携带旧筛选',()=>{
    const workData={...data,nodes:[{id:'work-a',requirementId:'a'}]} as PathAnalysis;
    for(const [id,kind,scope] of [['work-a','requirement','a'],['a','feature','f'],['d','feature','other']]){
      const params=new URL(editorFieldLocation(workData,id)!,'http://local').searchParams;
      expect(readWorkspaceLocation(params,'p')).toMatchObject({view:'graph',scope:{kind,id:scope},inspector:undefined});
      expect(params.get('graphInspector')).toBe('open');expect(params.get('pathNode')).toBe(id);
      expect(params.has('detailId')).toBe(false);
    }
    expect(editorFieldLocation(workData,'missing')).toBeUndefined();
  });
  it('当前层级覆盖互斥特性和 Phase 筛选，但保留人员、状态等条件',()=>{
    const filters=new URLSearchParams('progressFeatureId=other&progressPhaseId=foreign&progressStatus=in_progress&progressPerson=person');
    const feature=workspaceParams(location('feature','f'),data,filters);
    expect(feature.has('progressFeatureId')).toBe(false);expect(feature.has('progressPhaseId')).toBe(false);
    expect(feature.get('progressStatus')).toBe('in_progress');expect(feature.get('progressPerson')).toBe('person');
    filters.set('progressPhaseId','one');
    expect(workspaceParams(location('feature','f'),data,filters).get('progressPhaseId')).toBe('one');
    expect(workspaceParams(location('phase','two'),data,filters).has('progressPhaseId')).toBe(false);
    expect(workspaceParams(location('requirement','a'),data,filters).has('progressPhaseId')).toBe(false);
    expect(workspaceParams(location('project','p'),data,filters).get('progressFeatureId')).toBe('other');
  });
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

it('近期完成按业务日期计算，排除取消、返工和窗口外记录，归档贡献仍去重',()=>{
  const copy=structuredClone(data);
  copy.requirements.push(
    {id:'boundary',status:'completed',featureId:'f',phaseId:'one',executionCompletedAt:'2026-09-10'} as never,
    {id:'old',status:'completed',featureId:'f',phaseId:'one',executionCompletedAt:'2026-09-09'} as never,
    {id:'future',status:'completed',featureId:'f',phaseId:'one',executionCompletedAt:'2026-09-17'} as never,
    {id:'reworked',status:'in_progress',featureId:'f',phaseId:'one',executionCompletedAt:'2026-09-16'} as never,
    {id:'cancelled-recent',status:'cancelled',featureId:'f',phaseId:'one',executionCompletedAt:'2026-09-16'} as never,
  );
  for(const phase of copy.featureContext!.overview.features[0].phases!)Object.assign(phase.requirements[0],{executionCompletedAt:'2026-09-16'});
  const summary=workspaceSummary(location('project','p'),copy);
  expect(summary.recentFrom).toBe('2026-09-10');
  expect(summary.recentCompleted.map(r=>r.id)).toEqual(['boundary','done']);
  expect(summary.inProgress.map(r=>r.id)).toEqual(['a','reworked']);
  expect(workspaceSummary(location('unphased','f'),copy).recentCompleted).toEqual([]);
});


describe('详情与关系图选中分离',()=>{
  it('只选中节点不会打开详情，详情切换不改选中节点或范围',()=>{
    const params=new URLSearchParams('workspaceView=graph&scopeType=feature&scopeId=f&pathNode=a&pathEdge=e');
    const selected=readWorkspaceLocation(params,'p');expect(selected.inspector).toBeUndefined();
    const open=workspaceParams({...selected,inspector:'b',detailTab:'work'},data,params);
    expect(open.get('pathNode')).toBe('a');expect(open.get('pathEdge')).toBe('e');
    expect(readWorkspaceLocation(open,'p')).toMatchObject({scope:{kind:'feature',id:'f'},inspector:'b',detailTab:'work'});
    const closed=workspaceParams({...selected,inspector:undefined,detailTab:undefined},data,open);
    expect(closed.get('pathNode')).toBe('a');expect(closed.has('detailId')).toBe(false);expect(closed.has('detailTab')).toBe(false);
  });
});
