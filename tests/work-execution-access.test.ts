import {expect,it} from 'vitest';
import {workExecutionAccess} from '../src/client/permissions';
import type {Session,Requirement,WorkItem,Person} from '../src/client/types';
const requirement={id:'r',projectId:'p',ownerId:'owner',status:'in_progress'} as Requirement;
const work={id:'w',status:'in_progress',assigneeIds:['assigned']} as WorkItem;
const session=(personId:string,managedProjectIds:string[]=[])=>({authenticated:true,globalRole:'user',personId,managedProjectIds} as Session);
const people=[{id:'owner',projectRole:'member'},{id:'assigned',projectRole:'member'},{id:'viewer',projectRole:'viewer'}] as Person[];
it('行内执行沿用项目经理、需求负责人、执行人的权限；移出项目后停止操作',()=>{
  for(const who of [session('manager',['p']),session('owner'),session('assigned')])expect(workExecutionAccess(who,requirement,work,people).progress).toBe(true);
  expect(workExecutionAccess(session('viewer'),requirement,work,people).operate).toBe(false);
  expect(workExecutionAccess(session('assigned'),requirement,work,[]).operate).toBe(false);
  expect(workExecutionAccess({...session('manager',['p']),authenticated:false},requirement,work,people).operate).toBe(false);
});
it('已结束或归档对象不更新百分比；取消需求只给经理保留纠错入口',()=>{
  for(const status of ['completed','cancelled','pending_acceptance'])expect(workExecutionAccess(session('manager',['p']),{...requirement,status} as Requirement,work,people).progress).toBe(false);
  expect(workExecutionAccess(session('manager',['p']),{...requirement,deletedAt:'2026-09-14'},work,people).operate).toBe(false);
  expect(workExecutionAccess(session('owner'),{...requirement,status:'cancelled'},work,people).operate).toBe(false);
  expect(workExecutionAccess(session('manager',['p']),{...requirement,status:'cancelled'},work,people).operate).toBe(true);
});
