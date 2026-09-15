import {requirementStatuses,requirementStatusLabels,type RequirementStatus} from '../shared/domain';

export const progressStatePresets=[
  {value:'',label:'全部状态',description:'查看全部工作'},
  {value:'in_progress,completed,cancelled',label:'排除未开始',description:'进行中、已完成、已取消'},
  {value:'not_started,in_progress',label:'尚未结束',description:'排除已完成、已取消'},
  {value:'in_progress',label:'只看进行中',description:'排除未开始、已完成、已取消'},
];
export function selectedProgressStates(value:string):RequirementStatus[]{
  if(!value)return [...requirementStatuses];
  if(value==='unfinished')return ['not_started','in_progress'];
  return requirementStatuses.filter(status=>value.split(',').includes(status));
}
export function progressStatesValue(states:readonly string[]){
  const selected=requirementStatuses.filter(status=>states.includes(status));
  return selected.length===requirementStatuses.length?'':selected.join(',')||'none';
}
export function progressStatesLabel(value:string){
  const selected=selectedProgressStates(value),preset=progressStatePresets.find(p=>p.value===progressStatesValue(selected));
  return preset?.label||selected.map(status=>requirementStatusLabels[status]).join('、')||'未选择状态';
}
export const progressFilterFields=['q','featureId','phaseId','progressState','progressStage','progressStatus','progressRisk','progressPerson','progressSchedule','progressScope'] as const;
