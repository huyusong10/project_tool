export type DeliveryScope = 'committed' | 'candidate';
export type ExecutionMode = 'direct' | 'work_items';
export type ProcessingPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type DeliveryFields = import('./forecast-basis').ExecutionMetadata & {
  executionCompletedAt?:string|null; observationEnd?:string|null;
  executionForecastEnd?:string|null;acceptanceForecastEnd?:string|null;acceptanceAssumed?:boolean;
  commitment?:ReturnType<typeof import('./commitments').requirementCommitments>;
  ownerValid?:boolean; deliveryScope?: DeliveryScope; executionMode?: ExecutionMode; acceptanceOwnerId?: string | null;
  acceptanceOwnerName?: string | null; acceptanceOwnerValid?: boolean;
  actualStart?: string | null; actualEnd?: string | null; progress?: number;
  blockedAt?: string | null; blockedReason?: string | null;
  forecastDuration?: number | null; forecastReadyAt?: string | null;
  durationDays?: number | null; forecastEnd?: string | null; unblockEstimate?: string | null;
  splitBaseProgress?: number; splitAt?: string | null;
};
export type ProcessingResult = {
  processingPriority: ProcessingPriority | null; priorityReasons: string[];
  affectedRequirementIds: string[]; priorityAsOfDate: string;
  currentBlocked: boolean; prioritySince: string | null;
};
export type PriorityFacts = DeliveryFields & {
  id: string; status: string; anomalySince?:string|null; riskLevel?: string; riskEvaluated?: boolean; critical?: boolean;
  blockedCritical?: boolean; drivesLateTarget?: boolean; minFloat?: number | null;
  complete?: boolean; affectedRequirementIds?: string[]; inDeliveryNetwork?: boolean;
  updatedAt?: string; createdAt?: string; plannedEnd?: string | null;
};
export const processingPriorityLabels = {P0:'P0 · 紧急',P1:'P1 · 高',P2:'P2 · 正常',P3:'P3 · 较低'};
export function processingPriority(f: PriorityFacts, asOfDate: string): ProcessingResult {
  const result: ProcessingResult = {processingPriority:null,priorityReasons:[],affectedRequirementIds:[...new Set(f.affectedRequirementIds||[])].sort(),priorityAsOfDate:asOfDate,currentBlocked:f.status==='blocked'||!!f.blockedCritical,prioritySince:f.anomalySince||f.blockedAt||null};
  if(['completed','cancelled'].includes(f.status)) return result;
  if(f.deliveryScope==='candidate'&&!f.inDeliveryNetwork){result.priorityReasons=['候选，未影响当前交付'];return result;}
  if(f.blockedCritical||f.drivesLateTarget){result.processingPriority='P0';result.priorityReasons=[f.blockedCritical?'关键交付路径受阻':'正在驱动交付目标延期'];}
  else if(f.riskLevel==='high'||f.critical||(f.complete&&f.minFloat!=null&&f.minFloat<=2)){
    result.processingPriority='P1';result.priorityReasons=[f.riskLevel==='high'?'当前交付风险高':f.critical?'位于交付关键路径':'可用缓冲不超过两个工作日'];
  }else if(f.riskEvaluated&&f.riskLevel==='low'&&!f.critical&&f.complete&&f.minFloat!=null&&f.minFloat>2){result.processingPriority='P3';result.priorityReasons=['低风险，非关键且缓冲充足'];}
  else{result.processingPriority='P2';result.priorityReasons=[!f.riskEvaluated||!f.complete?'交付信息待评估':'按计划推进'];}
  return result;
}
export function compareProcessingPriority(a: Partial<ProcessingResult>&PriorityFacts,b: Partial<ProcessingResult>&PriorityFacts) {
  const ranks:Record<string,number>={high:0,medium:1,low:3};
  const risk=(x:typeof a)=>x.riskEvaluated===false?2:ranks[x.riskLevel||'']??2;
  return (a.processingPriority||'P9').localeCompare(b.processingPriority||'P9')
    ||Number(!!b.currentBlocked)-Number(!!a.currentBlocked)
    ||(b.affectedRequirementIds?.length||0)-(a.affectedRequirementIds?.length||0)
    ||risk(a)-risk(b)||(a.minFloat??Infinity)-(b.minFloat??Infinity)
    ||(a.plannedEnd||'9999').localeCompare(b.plannedEnd||'9999')
    ||(a.prioritySince||'9999').localeCompare(b.prioritySince||'9999')||a.id.localeCompare(b.id);
}
export function deliveryReadiness(r:DeliveryFields&{ownerId?:string|null;status:string},items:Array<{status:string;ownerId?:string|null;plannedStart?:string|null;plannedEnd?:string|null;durationDays?:number|null}>,scheduleComplete:boolean){
  if(['completed','cancelled'].includes(r.status))return [];
  const result:string[]=[];
  if(!r.ownerId)result.push('缺少需求负责人');else if(r.ownerValid!==undefined&&!r.ownerValid)result.push('需求负责人已失效，请项目经理重新指定');
  if(r.executionMode!=='direct'&&!items.some(w=>w.status!=='cancelled'))result.push('尚未建立有效工作项');
  if(!scheduleComplete)result.push('排期不完整');
  if(r.executionMode==='direct'&&!r.durationDays&&!scheduleComplete)result.push('工期待确认');
  return result;
}
