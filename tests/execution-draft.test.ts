import {describe,it,expect} from 'vitest';
import {analysePaths} from '../src/shared/paths';
import {pathFixture,date} from './fixtures/path-network';
import {executionDraftConflicts} from '../src/shared/execution-draft';
import {rebaseEditorHistory} from '../src/client/editor-rebase';
import {newHistory,historyTransition} from '../src/client/editor-session';
import {predecessorBasis} from '../src/shared/forecast-basis';
import type {DependencyChanges} from '../src/shared/path-contracts';
const empty:DependencyChanges={add:[],remove:[],estimates:[]};
describe('执行、草稿和预测依据',()=>{
 it('名称和布局不阻止其他需求执行，修改开始条件的关系受检查',()=>{
  const graph=analysePaths(pathFixture()),descriptive:DependencyChanges={...empty,entities:[{entity:'requirement',op:'update',id:'A',data:{title:'新名称'},expectedVersion:1}],layouts:[{scope:'global',direction:'right',expectedVersion:0,positions:{A:{x:2,y:3}}}]};
  expect(executionDraftConflicts(descriptive,graph,{requirementId:'B',workItemId:'B2',action:'start'})).toEqual([]);
  expect(executionDraftConflicts({...empty,estimates:[{workItemId:'A1',durationDays:7}]},graph,{requirementId:'B',workItemId:'B2',action:'start'})).not.toEqual([]);
  expect(executionDraftConflicts({...empty,remove:['e2']},graph,{requirementId:'B',workItemId:'B2',action:'start'})).not.toEqual([]);
  expect(executionDraftConflicts({...empty,estimates:[{workItemId:'C1',durationDays:7}]},graph,{requirementId:'A',workItemId:'A1',action:'progress'})).toEqual([]);
 });
 it('无冲突执行变化合并后仍能撤销和重做，不回滚服务端状态',()=>{
  const input=pathFixture(),base=analysePaths(input),edit:DependencyChanges={...empty,entities:[{entity:'requirement',op:'update',id:'A',expectedVersion:1,data:{title:'草稿名称'}}]};
  let history=historyTransition(newHistory(empty,'1',base),{type:'change',value:edit});
  input.workItems.find(w=>w.id==='B1')!.status='in_progress';input.revision=2;const server=analysePaths(input);
  const rebased=rebaseEditorHistory(base,server,history.values,history.index);expect(rebased.pending).toEqual([]);
  history=historyTransition(history,{type:'rebase',version:'2',value:rebased.current,values:rebased.values,baseline:empty,server});
  expect(history.values).toHaveLength(2);history=historyTransition(history,{type:'undo'});expect(history.values[history.index].entities).toEqual([]);
  expect(history.server?.nodes.find(n=>n.id==='B1')?.status).toBe('in_progress');history=historyTransition(history,{type:'redo'});expect(history.values[history.index].entities?.[0].data.title).toBe('草稿名称');
 });
 it('旧撤销步骤独有的字段冲突可以逐项核对，不留下不可解锁状态',()=>{
  const input=pathFixture(),base=analysePaths(input),old:DependencyChanges={...empty,entities:[{entity:'requirement',op:'update',id:'A',expectedVersion:1,data:{title:'旧草稿'}}]};
  input.requirements[0].title='服务器名称';const server=analysePaths(input);const result=rebaseEditorHistory(base,server,[empty,old,empty],2);
  expect(result.pending).toHaveLength(1);expect(result.pending[0].key).toBe('history:1:A:title');
  const resolved=rebaseEditorHistory(base,server,[empty,old,empty],2,{[result.pending[0].key]:'server'});expect(resolved.pending).toEqual([]);expect(resolved.values[1].entities).toEqual([]);
 });
 it('前置变化自动重算预测，姓名修改不影响日期',()=>{
  const input=pathFixture(),a=analysePaths(input),w=input.workItems.find(w=>w.id==='B2')!;
  w.forecastReview={confirmedAt:date(0),confirmedBy:'a',remainingDays:2,forecastEnd:a.nodes.find(n=>n.id==='B2')!.forecastEnd,actualStart:null,progress:0,predecessorBasis:predecessorBasis(w.id,a)};
  expect(analysePaths(input).nodes.find(n=>n.id==='B2')!.forecastEnd).toBeTruthy();
  input.requirements[0].title='新名字';expect(analysePaths(input).nodes.find(n=>n.id==='B2')!.forecastEnd).toBeTruthy();
  input.workItems.find(w=>w.id==='A1')!.durationDays=8;const changed=analysePaths(input);expect(changed.nodes.find(n=>n.id==='B2')!.forecastEnd! > a.nodes.find(n=>n.id==='B2')!.forecastEnd!).toBe(true);expect(changed.forecastEnd).toBeTruthy();
 });
});
