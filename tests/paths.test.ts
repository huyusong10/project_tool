import { describe, expect, it } from 'vitest';
import { analysePaths } from '../src/shared/paths';
import { pathFixture,date } from './fixtures/path-network';
describe('交付网络', () => {
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
  it('未知解阻向下游传播，不虚构日期和余量', () => {
    const input = pathFixture(); Object.assign(input.workItems[0], {status:'blocked', actualStart:date(-1), blockedAt:date(-1)});
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
it('待验收及过期预测必须重新确认；空项目不能承诺日期',()=>{
 const input=pathFixture();input.requirements[2].status='pending_acceptance';expect(analysePaths(input).forecastEnd).toBeNull();
 input.requirements[2].forecastAcceptance=date(12);expect(analysePaths(input).forecastEnd).toBe(date(12));
 input.requirements[2].forecastAcceptance=date(-1);expect(analysePaths(input).forecastEnd).toBeNull();
 input.requirements.forEach(r=>{r.status='planning';r.deliveryScope='candidate';});expect(analysePaths(input)).toMatchObject({forecastEnd:null,deadlineSlack:null});
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

it('等待前置和阻塞期间不消耗人工预计的剩余工作量',()=>{
 const input=pathFixture();Object.assign(input.workItems[4],{forecastEnd:date(12),forecastDuration:3,forecastReadyAt:date(0)});input.asOfDate=date(2);
 expect(analysePaths(input).nodes.find(n=>n.id==='B2')!.remainingDays).toBe(3);
 Object.assign(input.workItems[4],{status:'blocked',actualStart:date(0),blockedAt:date(0)});expect(analysePaths(input).nodes.find(n=>n.id==='B2')!.remainingDays).toBe(3);
});
