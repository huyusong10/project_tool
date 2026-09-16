import {expect,it} from 'vitest';
import {requirementScheduleSummary} from '../src/client/requirement-presentation';
import type {Requirement} from '../src/client/types';

it('拆分需求的基线有日期时，仍指出工作项缺失的具体日期，并排除取消项',()=>{
  const r={id:'r',title:'统一日志',status:'in_progress',executionMode:'work_items',plannedStart:'2026-09-11',plannedEnd:'2026-09-15',workItems:[
    {id:'dev',title:'开发',status:'in_progress',plannedStart:'2026-09-14',plannedEnd:'2026-09-18'},
    {id:'test',title:'测试',status:'not_started',plannedStart:null,plannedEnd:null},
    {id:'old',title:'已取消验证',status:'cancelled',plannedStart:null,plannedEnd:null},
  ]} as Requirement;
  expect(requirementScheduleSummary(r)).toEqual({label:'1 项待排期',title:'测试：缺少计划开始、计划完成',gaps:[{id:'test',title:'测试',missing:['计划开始','计划完成']}]});
  expect(r.plannedEnd).toBe('2026-09-15');
  expect(requirementScheduleSummary({...r,status:'completed'}).label).toBe('1 项缺计划');
});

it('直接执行需求列出单个缺项，完整排期与取消需求没有待补项',()=>{
  const r={id:'r',title:'联调',status:'in_progress',executionMode:'direct',plannedStart:'2026-09-14',plannedEnd:null} as Requirement;
  expect(requirementScheduleSummary(r).title).toBe('联调：缺少计划完成');
  expect(requirementScheduleSummary({...r,plannedEnd:'2026-09-18'}).gaps).toEqual([]);
  expect(requirementScheduleSummary({...r,status:'cancelled'}).gaps).toEqual([]);
  expect(requirementScheduleSummary({...r,status:'completed'}).label).toBe('未记录计划');
});
