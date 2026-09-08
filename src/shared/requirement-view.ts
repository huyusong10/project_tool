export const unfinishedStatuses = ['planning','not_started','in_progress','blocked','pending_acceptance'];
export type RequirementViewItem = {
  title:string; status:string; priority?:string; ownerId?:string|null; assigneeIds?:string[];
  riskLevel:string; riskEvaluated:boolean; delayed?:boolean; scheduleComplete?:boolean; unknown?:boolean;
  plannedEnd?:string|null; pathRisk?:{blockedCritical?:boolean;critical?:boolean;minFloat?:number|null};
};
export type RequirementFilters = {statuses:string[];risks:string[];owners:string[];participants:string[];priorities:string[];schedule:string[];critical:boolean;attention:boolean};
export const emptyRequirementFilters = ():RequirementFilters=>({statuses:[],risks:[],owners:[],participants:[],priorities:[],schedule:[],critical:false,attention:false});
export function matchesRequirementFilters(item:RequirementViewItem,f:RequirementFilters){
  const risk=item.riskEvaluated?item.riskLevel:'pending';
  return (!f.statuses.length||f.statuses.includes(item.status))&&(!f.risks.length||f.risks.includes(risk))
    &&(!f.owners.length||f.owners.includes(item.ownerId||''))&&(!f.participants.length||f.participants.some(id=>item.assigneeIds?.includes(id)))
    &&(!f.priorities.length||f.priorities.includes(item.priority||''))
    &&(!f.schedule.length||f.schedule.some(s=>s==='delayed'?item.delayed:s==='unplanned'?!item.scheduleComplete:item.scheduleComplete&&!item.delayed))
    &&(!f.critical||!!item.pathRisk?.critical)&&(!f.attention||!!item.pathRisk?.critical||risk==='high'||risk==='pending'||!!item.unknown);
}
export function compareRiskRequirements(a:RequirementViewItem,b:RequirementViewItem){
  const closed=(r:RequirementViewItem)=>['completed','cancelled'].includes(r.status);
  const rank:Record<string,number>={high:0,medium:1,pending:2,low:3};
  const group=(r:RequirementViewItem)=>r.pathRisk?.blockedCritical?0:r.pathRisk?.critical?1:r.pathRisk?.minFloat!=null&&r.pathRisk.minFloat<=2?2:3;
  const number=(r:RequirementViewItem)=>/-(\d+)(?=\D|$)/.exec(r.title)?.[1];
  return Number(closed(a))-Number(closed(b))||(rank[a.riskEvaluated?a.riskLevel:'pending']??2)-(rank[b.riskEvaluated?b.riskLevel:'pending']??2)
    ||group(a)-group(b)||(a.pathRisk?.minFloat??Infinity)-(b.pathRisk?.minFloat??Infinity)
    ||(a.plannedEnd||'9999').localeCompare(b.plannedEnd||'9999')||(a.priority||'P2').localeCompare(b.priority||'P2')
    ||(number(a)&&number(b)?Number(number(a))-Number(number(b)):0)||a.title.localeCompare(b.title,'zh-CN');
}
