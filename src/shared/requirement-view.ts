import {compareProcessingPriority,type ProcessingResult} from './delivery';
export const unfinishedStatuses = ['planning','not_started','in_progress','blocked','pending_acceptance'];
export type RequirementViewItem = Partial<ProcessingResult> & import('./intake').Organization & {
  id?:string;deliveryScope?:'committed'|'candidate';
  title:string; status:string; priority?:string; ownerId?:string|null; assigneeIds?:string[];
  riskLevel:string; riskEvaluated:boolean; delayed?:boolean; scheduleComplete?:boolean; unknown?:boolean;
  plannedEnd?:string|null; pathRisk?:{processingPriority?:string|null;blockedCritical?:boolean;critical?:boolean;minFloat?:number|null};
};
export type RequirementFilters = {groups?:string[];tags?:string[];deliveryScopes?:string[];statuses:string[];risks:string[];owners:string[];participants:string[];priorities:string[];schedule:string[];critical:boolean;attention:boolean};
export const emptyRequirementFilters = ():RequirementFilters=>({groups:[],tags:[],deliveryScopes:[],statuses:[],risks:[],owners:[],participants:[],priorities:[],schedule:[],critical:false,attention:false});
export function matchesRequirementFilters(item:RequirementViewItem,f:RequirementFilters){
  const risk=item.riskEvaluated?item.riskLevel:'pending';
  return (!f.groups?.length||f.groups.includes(item.groupId||'ungrouped'))&&(!f.tags?.length||f.tags.some(t=>item.tags?.includes(t)))&&(!f.deliveryScopes?.length||f.deliveryScopes.includes(item.deliveryScope||'committed'))&&(!f.statuses.length||f.statuses.includes(item.status))&&(!f.risks.length||f.risks.includes(risk))
    &&(!f.owners.length||f.owners.includes(item.ownerId||''))&&(!f.participants.length||f.participants.some(id=>item.assigneeIds?.includes(id)))
    &&(!f.priorities.length||f.priorities.includes(item.processingPriority??item.pathRisk?.processingPriority??''))
    &&(!f.schedule.length||f.schedule.some(s=>s==='delayed'?item.delayed:s==='unplanned'?!item.scheduleComplete:item.scheduleComplete&&!item.delayed))
    &&(!f.critical||!!item.pathRisk?.critical)&&(!f.attention||!!item.pathRisk?.critical||risk==='high'||risk==='pending'||!!item.unknown);
}
export function compareRiskRequirements(a:RequirementViewItem,b:RequirementViewItem){
  const closed=(r:RequirementViewItem)=>['completed','cancelled'].includes(r.status);
  const rank:Record<string,number>={high:0,medium:1,pending:2,low:3};
  const group=(r:RequirementViewItem)=>r.pathRisk?.blockedCritical?0:r.pathRisk?.critical?1:r.pathRisk?.minFloat!=null&&r.pathRisk.minFloat<=2?2:3;
  const number=(r:RequirementViewItem)=>/-(\d+)(?=\D|$)/.exec(r.title)?.[1];
  return Number(closed(a))-Number(closed(b))||(rank[a.riskEvaluated?a.riskLevel:'pending']??2)-(rank[b.riskEvaluated?b.riskLevel:'pending']??2)
    ||((a.processingPriority||b.processingPriority)?compareProcessingPriority({...a,currentBlocked:a.currentBlocked??a.pathRisk?.blockedCritical,id:a.id||a.title,minFloat:a.pathRisk?.minFloat},{...b,currentBlocked:b.currentBlocked??b.pathRisk?.blockedCritical,id:b.id||b.title,minFloat:b.pathRisk?.minFloat}):0)||group(a)-group(b)||(a.pathRisk?.minFloat??Infinity)-(b.pathRisk?.minFloat??Infinity)
    ||(a.plannedEnd||'9999').localeCompare(b.plannedEnd||'9999')
    ||(number(a)&&number(b)?Number(number(a))-Number(number(b)):0)||a.title.localeCompare(b.title,'zh-CN');
}
