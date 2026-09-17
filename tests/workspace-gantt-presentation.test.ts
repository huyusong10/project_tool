import {expect,it} from 'vitest';
import {progressParts,shortPhaseName} from '../src/client/workspace-gantt-presentation';
import {latestAchievedMilestone,type GanttMilestone} from '../src/client/gantt-milestones';
import type {WorkspaceRow} from '../src/client/workspace-rows';
import type {Requirement,WorkItem} from '../src/client/types';

it('特性保留实际编号，Phase 0不改成Phase 1，自定义名称不编造编号',()=>{
  expect(shortPhaseName('Phase 0 需求与软件设计')).toBe('Phase 0');
  expect(shortPhaseName('Phase 12 基础交付')).toBe('Phase 12');
  expect(shortPhaseName('试点推广')).toBe('试点推广');
});
it('需求保留并行阶段的各自百分比，完成终态优先，工作项仍用自身进度',()=>{
  const requirement={status:'in_progress',workItems:[{status:'in_progress',workStage:'analysis',progress:80},{status:'in_progress',workStage:'development',progress:17}]} as Requirement;
  expect(progressParts({requirement} as WorkspaceRow)).toEqual([{label:'设计',percent:80},{label:'开发',percent:17}]);
  expect(progressParts({requirement:{...requirement,status:'completed'}} as WorkspaceRow)).toEqual([{label:'',percent:100}]);
  expect(progressParts({work:{status:'in_progress',workStage:'testing',progress:70} as WorkItem} as WorkspaceRow)).toEqual([{label:'测试',percent:70}]);
  expect(progressParts({work:{status:'not_started',progress:0} as WorkItem} as WorkspaceRow)).toEqual([]);
});
it('缺少分类不编造阶段进度，部分提测保留并行提示',()=>{
  expect(progressParts({requirement:{status:'in_progress',workItems:[]} as unknown as Requirement} as WorkspaceRow)).toEqual([{label:'进行中'}]);
  const requirement={status:'in_progress',executionStage:{key:'parallel',label:'开发中 · 部分已提测',stages:[{stage:'development',label:'开发',progress:30}]}} as Requirement;
  expect(progressParts({requirement} as WorkspaceRow)).toEqual([{label:'开发',percent:30},{label:'部分已提测'}]);
});
it('最新节点按实际达成时间挑选，取消、未来计划和未来实际记录不占位',()=>{
  const facts=[{id:'old',actualDate:'2026-09-01',targetDate:'2030-01-01'},{id:'new',actualDate:'2026-09-05'},
    {id:'future',targetDate:'2026-10-01'},{id:'future-actual',actualDate:'2026-10-01'},
    {id:'cancelled',actualDate:'2026-09-06',cancelled:true}] as GanttMilestone[];
  expect(latestAchievedMilestone(facts,null,'2026-09-17')?.id).toBe('new');
  expect(facts).toHaveLength(5);
  expect(latestAchievedMilestone(facts,'2026-09-07T00:00:00Z','2026-09-17')).toBeNull();
});
it('返工后补录新的达成事实可以展示，旧节点保留为历史',()=>{
  const facts=[{id:'old',actualDate:'2026-09-05',actualRecordedAt:'2026-09-05T10:00:00Z'},
    {id:'new',actualDate:'2026-09-08',actualRecordedAt:'2026-09-09T10:00:00Z'}] as GanttMilestone[];
  expect(latestAchievedMilestone(facts,'2026-09-08T00:00:00Z','2026-09-17')?.id).toBe('new');
});
