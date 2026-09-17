import {expect,it} from 'vitest';
import {deriveRequirementMetrics,requirementProgressWeight} from '../src/shared/domain';
import {phaseCompletion,phaseProgress} from '../src/shared/feature-phases';
import {workspaceRows,filterWorkspaceRows} from '../src/client/workspace-rows';
import type {Dashboard} from '../src/client/types';
import {summaryTimeline} from '../src/client/phase-gantt';
import type {WorkspaceRow} from '../src/client/workspace-rows';
import {ganttInterval} from '../src/client/gantt-geometry';
import type {FeaturePhase} from '../src/shared/feature-phases';

it('完成比例汇总实际进度，取消不计入，归档完成仍计入',()=>{
  const requirements=[{status:'completed',deletedAt:'2026-09-15'},{status:'in_progress',progress:99},{status:'not_started'},{status:'cancelled'}];
  expect(phaseCompletion(requirements)).toEqual({total:3,completed:1,inProgress:1,notStarted:1,percent:66,weight:3});
  expect(phaseProgress(requirements,null,'2026-09-16').completion).toEqual(phaseCompletion(requirements));
});
it('空和全取消不产生百分比，未全部完成时不舍入成100%',()=>{
  expect(phaseCompletion([]).percent).toBeNull();
  expect(phaseCompletion([{status:'cancelled'}]).percent).toBeNull();
  expect(phaseCompletion([{status:'not_started'}]).percent).toBe(0);
  const requirements=[...Array.from({length:200},()=>({status:'completed'})),{status:'in_progress'}];
  expect(phaseCompletion(requirements).percent).toBe(99);
  expect(phaseCompletion([{status:'completed'}]).percent).toBe(100);
});
it('增加范围和返工后比例下降，进行中的成果计入完成度',()=>{
  const almostDone=[{status:'in_progress',progress:99}];
  expect(phaseCompletion(almostDone).percent).toBe(99);
  expect(phaseCompletion([{status:'completed'},{status:'not_started'}]).percent).toBe(50);
  expect(phaseCompletion([{status:'in_progress'},{status:'not_started'}]).percent).toBe(0);
});
it('筛选需求和展开不改变特性及Phase的完整完成比例',()=>{
  const requirements=[{id:'done',title:'已完成内容',status:'completed',featureId:'f',phaseId:'p',workItems:[]},{id:'active',title:'正在开发',status:'in_progress',featureId:'f',phaseId:'p',workItems:[]}];
  const phase={id:'p',name:'Phase 1',sortOrder:0,status:'in_progress',requirements};
  const report={requirements,featureOverview:{features:[{id:'f',name:'资产管理',phases:[phase]}]}} as unknown as Dashboard;
  const filtered=filterWorkspaceRows(workspaceRows(report),{query:'正在开发',featureId:'',phaseId:'',state:'active',stage:''});
  expect(filtered[0].children[0].children).toHaveLength(1);
  expect(phaseCompletion(filtered[0].children[0].phase!.requirements).percent).toBe(50);
  expect(phaseCompletion(filtered[0].feature!.phases![0].requirements).percent).toBe(50);
});
it('实际区间取有效需求执行日期，取消项不扩展区间，进行中到统计日为止',()=>{
  const requirements=[{status:'completed',actualStart:'2026-09-03',actualEnd:'2026-09-07'},{status:'in_progress',actualStart:'2026-09-10'},{status:'cancelled',actualStart:'2026-08-01',actualEnd:'2026-10-10'}];
  expect(phaseProgress(requirements,'2026-10-01','2026-09-16')).toMatchObject({actualStart:'2026-09-03',observationEnd:'2026-09-16',completedAt:null,completion:{percent:50}});
  requirements[1]={status:'completed',actualStart:'2026-09-10',actualEnd:'2026-09-14'};
  expect(phaseProgress(requirements,'2026-10-01','2026-09-16')).toMatchObject({actualStart:'2026-09-03',observationEnd:'2026-09-14',completedAt:'2026-09-14'});
});
it('缺少实际日期、空Phase和未开始的Phase不借用目标或审计日期',()=>{
  expect(phaseProgress([{status:'in_progress'}],'2026-09-10','2026-09-16')).toMatchObject({actualStart:null,observationEnd:null,completedAt:null});
  expect(phaseProgress([{status:'completed',actualStart:'2026-09-10'}],null,'2026-09-16')).toMatchObject({actualStart:'2026-09-10',observationEnd:null,completedAt:null});
  expect(phaseProgress([{status:'completed',actualEnd:'2026-09-10'},{status:'completed'}],null,'2026-09-16').completedAt).toBeNull();
  expect(phaseProgress([{status:'not_started',actualStart:'2026-09-01'}],null,'2026-09-16')).toMatchObject({actualStart:null,observationEnd:null});
  expect(phaseProgress([],'2026-09-01','2026-09-16')).toMatchObject({actualStart:null,observationEnd:null,overdue:false});
});
const phase=(id:string,requirements:unknown[],targetDate:string|null=null)=>({id,name:id,sortOrder:0,requirements,targetDate,startedAt:'2026-08-01',...phaseProgress(requirements as FeaturePhase['requirements'],targetDate,'2026-09-16')}) as FeaturePhase;
const featureRow=(phases:FeaturePhase[],requirements:unknown[]=[])=>({kind:'feature',feature:{phases,requirements},children:[]}) as unknown as WorkspaceRow;
const dates=['2026-09-01','2026-09-02','2026-09-03','2026-09-04','2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-14','2026-09-15','2026-09-16'].map(d=>new Date(d+'T00:00:00'));
it('多个并行Phase只汇总实际区间，目标与需求计划不变成Phase计划',()=>{
  const phases=[phase('P1',[{id:'a',status:'in_progress',plannedStart:'2026-09-01',plannedEnd:'2026-09-11',actualStart:'2026-09-03'}]),phase('P2',[{id:'b',status:'in_progress',plannedStart:'2026-09-04',plannedEnd:'2026-09-15',actualStart:'2026-09-07'}]),phase('P3',[],'2027-09-16')];
  const summary=summaryTimeline(featureRow(phases),'2026-09-16');
  expect(summary).toMatchObject({actualStart:'2026-09-03',actualEnd:'2026-09-16',completion:{percent:0,weight:2},caption:'P1',percent:0,parallelCount:1});
  expect(summary).not.toHaveProperty('plannedStart');expect(summary).not.toHaveProperty('plannedEnd');
  expect(ganttInterval(summary.actualStart,summary.actualEnd,dates,40)).toMatchObject({left:80,width:400});
  expect(ganttInterval(summary.actualStart,summary.actualEnd,dates,6)).toMatchObject({left:12,width:60});
});
it('未排期需求仍计入Phase分母，过期目标不产生汇总延期或计划条',()=>{
  const p=phase('P1',[{id:'a',status:'completed',actualStart:'2026-09-03',actualEnd:'2026-09-04'},{id:'b',status:'not_started'},{id:'x',status:'cancelled',plannedStart:'2025-01-01',plannedEnd:'2027-01-01'}],'2026-09-01');
  const summary=summaryTimeline({kind:'phase',phase:p,children:[]} as unknown as WorkspaceRow,'2026-09-16');
  expect(summary).toMatchObject({actualStart:'2026-09-03',actualEnd:'2026-09-16',label:'50%',completion:{percent:50,total:2}});
  expect(summary).not.toHaveProperty('plannedEnd');expect(summary).not.toHaveProperty('overdue');
});
it('只有完成日期时保留已知事实，空Phase不借用目标或审计日期画条',()=>{
  const p={...phase('P1',[{id:'done',status:'completed',actualEnd:'2026-09-10'}],'2026-09-11'),status:'completed',completedAt:'2026-09-10'} as FeaturePhase;
  expect(summaryTimeline({kind:'phase',phase:p} as WorkspaceRow,'2026-09-16')).toMatchObject({actualStart:null,actualEnd:'2026-09-10',label:'100%'});
  expect(summaryTimeline(featureRow([phase('empty',[],'2026-09-11')]),'2026-09-16')).toMatchObject({actualStart:null,actualEnd:null,percent:null});
});
it('未安排Phase的需求参与特性实际区间，归档完成与Phase资料按ID去重',()=>{
  const done={id:'done',status:'completed',actualStart:'2026-09-01',actualEnd:'2026-09-07'};
  const row=featureRow([phase('P1',[done])],[done,{id:'unphased',status:'in_progress',actualStart:'2026-09-09'}]);
  expect(summaryTimeline(row,'2026-09-16')).toMatchObject({actualStart:'2026-09-01',actualEnd:'2026-09-16',completion:{percent:50,weight:2}});
});
it('特性按Phase工作量汇总，后续空Phase不伪造权重',()=>{
  const done=phase('Phase 1',[{id:'done',status:'completed',actualStart:'2026-09-01',actualEnd:'2026-09-07'}]);
  const current=phase('Phase 2',[{id:'a',status:'completed',actualStart:'2026-09-08',actualEnd:'2026-09-09'},{id:'b',status:'not_started'}]);
  expect(summaryTimeline(featureRow([done,current]),'2026-09-16')).toMatchObject({completion:{percent:67,weight:3},label:'Phase 2 · 67%'});
  expect(summaryTimeline(featureRow([done,current,phase('Phase 3',[]),phase('Phase 4',[])]),'2026-09-16')).toMatchObject({completion:{percent:67,weight:3},label:'Phase 2 · 67%'});
  expect(summaryTimeline(featureRow([done,phase('Phase 2',[])]),'2026-09-16')).toMatchObject({completion:{percent:100,weight:1},label:'Phase 1 · 100%'});
});
it('已列需求保留0%统计但不显示徽标，实际区间为空；空范围没有百分比',()=>{
  const p=phase('P1',[{id:'a',status:'not_started'},{id:'b',status:'not_started'}]);
  expect(summaryTimeline({kind:'phase',phase:p} as WorkspaceRow,'2026-09-16')).toMatchObject({actualStart:null,actualEnd:null,label:'',completion:{total:2,percent:0}});
  expect(summaryTimeline({kind:'phase',phase:phase('empty',[])} as WorkspaceRow,'2026-09-16')).toMatchObject({percent:null,label:''});
});

it('Phase按工作量计算进行中的需求；特性按Phase工作量加权而非等权平均',()=>{
  const first=phase('Phase 1',[{id:'a',status:'in_progress',progress:80,progressWeight:3},{id:'b',status:'in_progress',progress:20,progressWeight:1}]);
  const second=phase('Phase 2',[{id:'c',status:'in_progress',progress:20,progressWeight:6}]);
  expect(phaseCompletion(first.requirements)).toMatchObject({percent:65,weight:4,completed:0});
  expect(summaryTimeline(featureRow([first,second]),'2026-09-16')).toMatchObject({percent:38,caption:'Phase 1',parallelCount:1});
  expect(summaryTimeline(featureRow([first,second,phase('Phase 3',[])]),'2026-09-16').percent).toBe(38);
  const unassigned={id:'u',status:'completed',progressWeight:10,deletedAt:'2026-09-15'};
  expect(summaryTimeline(featureRow([first,second],[unassigned]),'2026-09-16').percent).toBe(69);
});
it('特性0%仍完整显示Phase和百分比，Phase行隐藏0%，空范围不编造数值',()=>{
  const p=phase('Phase 0 分析',[{id:'a',status:'in_progress',progress:0}]);
  expect(summaryTimeline(featureRow([p]),'2026-09-16').label).toBe('Phase 0 · 0%');
  expect(summaryTimeline({kind:'phase',phase:p} as WorkspaceRow,'2026-09-16').label).toBe('');
  expect(summaryTimeline(featureRow([phase('Phase 1',[])]),'2026-09-16').label).toBe('');
});
it('复用工作权重及拆分基准，不按当前阶段百分比或改期后的日期重算权重',()=>{
  const works=[{status:'in_progress',progress:80,progressWeight:3,plannedStart:'2026-09-01',plannedEnd:'2026-10-01'},
    {status:'in_progress',progress:20,progressWeight:1},{status:'cancelled',progressWeight:100,progress:90}];
  const r={executionMode:'work_items' as const,splitBaseProgress:20};
  const progress=deriveRequirementMetrics(r,works,'2026-09-16').progress;
  expect(progress).toBe(72);
  expect(requirementProgressWeight(r,works)).toBe(4);
  expect(phaseCompletion([{status:'in_progress',progress,progressWeight:requirementProgressWeight(r,works)}]).percent).toBe(72);
  expect(requirementProgressWeight({executionMode:'direct',durationDays:7},[])).toBe(7);
  expect(requirementProgressWeight({executionMode:'direct'},[])).toBe(1);
  expect(requirementProgressWeight({},[])).toBe(1);
});
