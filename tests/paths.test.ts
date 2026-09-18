import { describe, expect, it } from 'vitest';
import { analysePaths } from '../src/shared/paths';
import { pathFixture,date,req,work } from './fixtures/path-network';
import type { PathInput } from '../src/shared/paths';

for(const mode of ['direct','work_items'] as const)it.each([
  ['2026-09-19','2026-09-19','2026-09-20'],['2026-09-18','2026-09-20','2026-09-21'],['2026-09-24','2026-09-25','2026-09-28'],
])(`${mode} 已完成对象保留实际起止日期，后续工作仍按工作日排期：%s→%s`,(actualStart,actualEnd,nextStart)=>{
  const done={...work('A1','A',1),status:'completed',progress:100,actualStart,actualEnd};
  const input:PathInput={projectId:'p',projectName:'实际日期',revision:1,projectEnd:null,asOfDate:actualEnd,
    requirements:[{...req('A'),executionMode:mode,status:'completed',progress:100,actualStart,actualEnd},req('B')],
    workItems:[...(mode==='work_items'?[done]:[]),work('B1','B',1)],
    milestones:[{id:'milestone',projectId:'p',requirementId:null,title:'现场交付',targetDate:null,confirmationMode:'manual',achievedAt:actualEnd,version:1}],
    dependencies:[{id:'after-done',projectId:'p',sourceRequirementId:'A',sourceWorkItemId:null,targetRequirementId:'B',targetWorkItemId:'B1',origin:'manual'}]};
  const before=structuredClone(input),analysis=analysePaths(input),completed=analysis.nodes.find(n=>n.id===(mode==='direct'?'execute:A':'A1'))!;
  expect.soft(completed).toMatchObject({forecastStart:actualStart,forecastEnd:actualEnd,scheduledStart:actualStart,scheduledEnd:actualEnd,remainingDays:0,complete:true});
  for(const id of ['acceptance:A','milestone'])expect.soft(analysis.nodes.find(n=>n.id===id)).toMatchObject({forecastStart:actualEnd,forecastEnd:actualEnd,scheduledStart:actualEnd,scheduledEnd:actualEnd,complete:true});
  expect(analysis.nodes.find(n=>n.id==='B1')).toMatchObject({forecastStart:nextStart,forecastEnd:nextStart});expect(input).toEqual(before);
});

describe('交付网络', () => {
  it('部分排期不构成整个需求截止日，真实下游截止日仍可向未排期前置传播风险', () => {
    const input = {
      projectId: 'p', projectName: '部分排期', revision: 1, projectEnd: date(30), asOfDate: date(0),
      requirements: [{ ...req('up'), plannedStart: null, plannedEnd: null }, { ...req('partial'), plannedEnd: date(1) }, req('unknown')],
      workItems: [
        { ...work('up-1', 'up', 5), plannedStart: null, plannedEnd: null },
        work('partial-1', 'partial', 2),
        { ...work('partial-2', 'partial', 3), plannedStart: null, plannedEnd: null },
      ],
      dependencies: [{ id: 'edge', projectId: 'p', sourceRequirementId: 'up', sourceWorkItemId: 'up-1', targetRequirementId: 'partial', targetWorkItemId: 'partial-2', origin: 'manual' }],
    };
    const partial = analysePaths(input, 'acceptance:partial');
    expect(partial).toMatchObject({ targetDate: null, deadlineSlack: null, complete: true });
    expect(partial.forecastEnd).not.toBeNull();
    for (const id of ['up', 'partial']) expect(partial.risks[id]).toMatchObject({ highRisk: false, riskEvaluated: false, drivesLateTarget: false });
    expect(partial.nodes.find(n => n.id === 'acceptance:partial')!.plannedEnd).toBeNull();
    Object.assign(input.workItems[2], { plannedStart: date(0), plannedEnd: date(1) });
    const planned = analysePaths(input, 'acceptance:partial');
    expect(planned.targetDate).toBe(date(1));
    expect(planned.deadlineSlack).toBeLessThan(0);
    for (const id of ['up', 'partial']) expect(planned.risks[id]).toMatchObject({ highRisk: true, riskEvaluated: true, drivesLateTarget: true });
  });
  it('部分交付不等待整个需求；余量、工作日边界可复算', () => {
    const a = analysePaths(pathFixture());
    expect(a.forecastEnd).toBe(date(8)); expect(a.deadlineSlack).toBe(-2);
    expect(a.nodes.filter(n => n.kind === 'work' && n.critical).map(n => n.id).sort()).toEqual(['A1','A2','B2','C1','C2']);
    expect(a.nodes.find(n => n.id === 'A3')?.floatDays).toBe(2);
    expect(a.nodes.find(n => n.id === 'B1')?.floatDays).toBe(2);
  });
  it('切换需求目标不改变项目风险，局部关键分支不同', () => {
    const input = pathFixture(), global = analysePaths(input), local = analysePaths(input,'acceptance:A');
    expect(local.forecastEnd).toBe(date(6)); expect(local.risks).toEqual(global.risks);
    expect(local.nodes.filter(n => n.kind === 'work' && n.critical).map(n => n.id)).toEqual(['A1','A3']);
  });
  it('未知工期向下游传播，不虚构日期和余量', () => {
    const input = pathFixture(); Object.assign(input.workItems[0], {status:'in_progress', actualStart:date(-1), durationDays:null, plannedEnd:null});
    const a = analysePaths(input); expect(a.forecastEnd).toBeNull(); expect(a.complete).toBe(false);
    expect(a.nodes.find(n => n.id === 'B2')?.floatDays).toBeNull(); expect(a.blockers.some(b => b.nodeId==='A1')).toBe(true);
  });
  it('需求级A↔B合法，真实工作循环拒绝', () => {
    const input = pathFixture(); input.dependencies.push({id:'back',projectId:'p',sourceRequirementId:'B',sourceWorkItemId:'B2',targetRequirementId:'A',targetWorkItemId:'A3',origin:'manual'});
    expect(() => analysePaths(input)).not.toThrow();
    input.dependencies.push({id:'cycle',projectId:'p',sourceRequirementId:'A',sourceWorkItemId:'A3',targetRequirementId:'A',targetWorkItemId:'A1',origin:'manual'});
    expect(() => analysePaths(input)).toThrow('循环');
  });
  it('所有并列关键分支都保留', () => {
    const input = pathFixture(); input.workItems.find(w=>w.id==='A3')!.durationDays=5;
    const a=analysePaths(input); expect(a.nodes.find(n=>n.id==='A3')!.critical).toBe(true); expect(a.nodes.find(n=>n.id==='C2')!.critical).toBe(true);
  });
  it('已开始的根工作不会因今天变化被误判为依赖冲突', () => {
    const input=pathFixture(); Object.assign(input.workItems[3],{status:'in_progress',actualStart:date(-2),progress:30});
    expect(analysePaths(input).nodes.find(n=>n.id==='B1')!.unknownReasons).toEqual([]);
  });
});

it('取消前置不放行，返工后重新等待，已验收交付保留完成边界',()=>{
 const input=pathFixture();input.workItems[0].status='cancelled';expect(analysePaths(input).forecastEnd).toBeNull();
 Object.assign(input.workItems[0],{status:'completed',actualStart:date(-2),actualEnd:date(-1),progress:100});expect(analysePaths(input).forecastEnd).not.toBeNull();
 input.workItems[0].status='in_progress';input.workItems[0].actualEnd=null;input.workItems[0].progress=50;expect(analysePaths(input).nodes.find(n=>n.id==='A1')!.remainingDays).toBe(1);
 input.requirements[0].status='completed';input.requirements[0].acceptedAt=date(-1);expect(analysePaths(input).nodes.find(n=>n.id==='acceptance:A')!.complete).toBe(true);
});
it('完成日期使用有效工作项，空项目不虚构日期',()=>{
 const input=pathFixture();input.requirements[2].status='completed';input.requirements[2].acceptedAt=date(12);
 input.workItems.filter(w=>w.requirementId==='C').forEach(w=>Object.assign(w,{status:'completed',progress:100,actualStart:date(-2),actualEnd:date(-1)}));
 const node=analysePaths(input).nodes.find(n=>n.id==='acceptance:C')!;expect(node.complete).toBe(true);expect(node.forecastEnd).toBe(date(-1));
 input.requirements=[];input.workItems=[];input.dependencies=[];expect(analysePaths(input)).toMatchObject({forecastEnd:null,deadlineSlack:null});
});

it('人工预测保留剩余工期，不能在前置推迟后压缩交付；未知日期不当零工期',()=>{
 const input=pathFixture();Object.assign(input.workItems[4],{forecastEnd:date(8),forecastDuration:3,forecastReadyAt:date(6)});
 const initial=analysePaths(input).nodes.find(n=>n.id==='B2')!;input.workItems[0].earliestStart=date(5);const delayed=analysePaths(input).nodes.find(n=>n.id==='B2')!;expect(delayed.remainingDays).toBe(initial.remainingDays);expect(delayed.earliestFinish).toBeGreaterThan(initial.earliestFinish);
 input.workItems[0].durationDays=null;input.workItems[0].plannedEnd=null;expect(analysePaths(input).forecastEnd).toBeNull();
});

it('同日完成前置后实际开始的后续工作不误报执行冲突',()=>{
 const input=pathFixture();Object.assign(input.workItems[0],{status:'completed',actualStart:date(-1),actualEnd:date(0),progress:100});Object.assign(input.workItems[1],{status:'in_progress',actualStart:date(0),progress:10});
 const node=analysePaths(input).nodes.find(n=>n.id==='A2')!;expect(node.unknownReasons).toEqual([]);expect(node.earliestStart).toBe(0);
});

it('等待前置期间不消耗人工预计的剩余工作量',()=>{
 const input=pathFixture();Object.assign(input.workItems[4],{forecastEnd:date(12),forecastDuration:3,forecastReadyAt:date(0)});input.asOfDate=date(2);
 expect(analysePaths(input).nodes.find(n=>n.id==='B2')!.remainingDays).toBe(3);

});
