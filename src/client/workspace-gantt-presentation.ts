import type {WorkspaceRow} from './workspace-rows';
import {workStageLabels,deriveExecutionStage} from '../shared/execution-stage';
import type {WorkItem} from './types';

export type ProgressPart = {label:string; percent?:number};
export function workProgressParts(work:Pick<WorkItem,'status'|'workStage'|'progress'>):ProgressPart[] {
  if(['not_started','cancelled'].includes(work.status))return [];
  if(work.status==='completed')return [{label:'',percent:100}];
  return [{label:work.workStage?workStageLabels[work.workStage].replace('分析设计','设计'):'',percent:work.progress}];
}
export function shortPhaseName(name:string) {
  return name.match(/^Phase\s*\d+(?:\.\d+)?\b/i)?.[0].replace(/^phase\s*/i,'Phase ') || name;
}
export function progressParts(row:WorkspaceRow):ProgressPart[] {
  const r=row.requirement,w=row.work,item=w||r;
  if(!item||['not_started','cancelled'].includes(item.status))return [];
  if(item.status==='completed')return [{label:'',percent:100}];
  if(w)return workProgressParts(w);
  if(r?.executionMode==='direct')return [{label:'',percent:r.progress}];
  const stage=r!.executionStage||deriveExecutionStage(r!,r!.workItems,r!.milestones);
  if(stage.stages.length)return [...stage.stages.map(s=>({label:s.label.replace('分析设计','设计'),percent:s.progress})),...(stage.key==='parallel'&&stage.stages.length===1?[{label:'部分已提测'}]:[])];
  return [{label:stage.label}];
}
