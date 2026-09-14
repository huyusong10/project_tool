import type {Dashboard, Requirement, WorkItem} from './types';
import type {FeatureOverview} from '../shared/feature-overview';
import type {FeaturePhase} from '../shared/feature-phases';
import type {PathAnalysis} from '../shared/paths';
import {todayIso} from '../shared/domain';
import {matchesSearch} from '../shared/search';
import {dashboardWindow,matchesDashboardScope,type DashboardScope} from '../shared/dashboard';

export type WorkspaceRow = {
  id:string; kind:'feature'|'phase'|'requirement'|'work'; title:string; featureId:string;
  phaseId?:string; requirementId?:string; children:WorkspaceRow[]; archived?:boolean; temporary?:boolean; attentionCount?:number;
  feature?:FeatureOverview; phase?:FeaturePhase; requirement?:Requirement; work?:WorkItem;
};

/** Formal delivery facts remain intact when structural drafts change the visible scope. */
export function workspaceRows(report:Dashboard, projection?:PathAnalysis):WorkspaceRow[] {
  const formal=new Map(report.requirements.map(r=>[r.id,r]));
  const requirements:Requirement[]=projection?projection.requirements.filter(r=>!r.deletedAt).map(r=>{
    const saved=formal.get(r.id);
    const works=projection.nodes.filter(n=>n.requirementId===r.id&&n.kind==='work').map(n=>{
      const old=saved?.workItems.find(w=>w.id===n.id);
      return {...old,id:n.id,requirementId:r.id,title:n.title,workStage:n.workStage,ownerId:n.ownerId,ownerName:n.ownerName,
        plannedStart:n.plannedStart,plannedEnd:n.plannedEnd,status:old?.status||'not_started',progress:old?.progress||0,
        actualStart:old?.actualStart||null,actualEnd:old?.actualEnd||null} as WorkItem;
    });
    return {...saved,id:r.id,projectId:r.projectId,title:r.title,featureId:r.featureId,phaseId:r.phaseId,
      background:r.background,acceptanceCriteria:r.acceptanceCriteria,ownerId:r.ownerId,ownerName:r.ownerName,
      plannedStart:r.plannedStart,plannedEnd:r.plannedEnd,workItems:works,status:saved?.status||'not_started',progress:saved?.progress||0,
      executionStage:saved?.executionStage,actualStart:saved?.actualStart||null,actualEnd:saved?.actualEnd||null} as Requirement;
  }):report.requirements;
  const features=report.featureOverview?.features||[];
  const requirementRow=(r:Requirement,featureId:string,phaseId?:string):WorkspaceRow=>({
    id:r.id,kind:'requirement',title:r.title,featureId,phaseId,requirementId:r.id,requirement:r,
    archived:!!r.deletedAt,temporary:!formal.has(r.id)&&!r.deletedAt,
    children:r.deletedAt?[]:r.workItems.map(w=>({id:w.id,kind:'work',title:w.title,featureId,phaseId,requirementId:r.id,requirement:r,work:w,
      temporary:!formal.get(r.id)?.workItems.some(old=>old.id===w.id),children:[]})),
  });
  return features.map(f=>{
    const own=requirements.filter(r=>r.featureId===f.id);
    const phases:WorkspaceRow[]=(f.phases||[]).map(p=>({id:'phase:'+p.id,kind:'phase',title:p.name,featureId:f.id,phaseId:p.id,phase:p,feature:f,attentionCount:p.requirements.filter(r=>formal.get(r.id)?.highRisk||formal.get(r.id)?.delayed).length+Number(!!p.note||p.overdue),children:[
      ...own.filter(r=>r.phaseId===p.id).map(r=>requirementRow(r,f.id,p.id)),
      ...p.requirements.filter(r=>r.deletedAt).map(r=>requirementRow({...r,projectId:f.projectId,projectName:f.name,templateId:null,templateName:null,ownerId:null,ownerName:null,plannedStart:null,plannedEnd:null,progress:100,plannedProgress:null,progressGap:0,acceptedAt:null,acceptedByAccountId:null,riskLevel:"low",riskEvaluated:false,riskReason:"",priority:"P2",createdAt:"",updatedAt:"",delayed:false,highRisk:false,finishVariance:0,durationVariance:0,effectiveEnd:null,workItems:[]},f.id,p.id)),
    ]}));
    const unassigned=own.filter(r=>!r.phaseId);
    if(unassigned.length)phases.push({id:'phase:'+f.id+':unassigned',kind:'phase',title:'未安排 Phase',featureId:f.id,phaseId:'unassigned',feature:f,children:unassigned.map(r=>requirementRow(r,f.id,'unassigned'))});
    return {id:'feature:'+f.id,kind:'feature',title:f.name,featureId:f.id,feature:f,archived:!!f.archivedAt,children:phases};
  });
}

export type RowFilters={query:string; featureId:string; phaseId:string; state:string; stage:string; attention:boolean;status?:string;risk?:string;person?:string;schedule?:string;scope?:string;asOfDate?:string};
export function filterWorkspaceRows(rows:WorkspaceRow[],filter:RowFilters):WorkspaceRow[] {
  const matches=(row:WorkspaceRow)=>matchesSearch([{text:row.title,weight:100},{text:row.phase?.scope||row.feature?.description||''}],filter.query);
  const visit=(row:WorkspaceRow,inherited=false):WorkspaceRow|null=>{
    if(row.kind==='feature'&&(filter.featureId&&row.featureId!==filter.featureId||(filter.state==='archived'?!row.archived:row.archived)))return null;
    if(row.kind==='phase'&&filter.phaseId&&row.phaseId!==filter.phaseId)return null;
    const textMatch=inherited||!filter.query||matches(row);
    const children=row.children.map(child=>visit(child,textMatch)).filter((child):child is WorkspaceRow=>!!child);
    const r=row.requirement;
    const stageMatch=(!filter.stage||r?.executionStage?.key===filter.stage||r?.status===filter.stage)
      &&(!filter.status||filter.status==='unfinished'? !filter.status||!!r&&!['completed','cancelled'].includes(r.status):r?.status===filter.status)
      &&(!filter.risk||(r?.riskEvaluated?r.riskLevel:'pending')===filter.risk)
      &&(!filter.person||r?.ownerId===filter.person||r?.workItems.some(w=>w.ownerId===filter.person||w.assigneeIds?.includes(filter.person!)))
      &&(!filter.schedule||!!r&&(filter.schedule==='delayed'?r.delayed:filter.schedule==='unplanned'?!r.scheduleComplete:r.scheduleComplete&&!r.delayed))
      &&(!filter.scope||!!r&&matchesDashboardScope(r,filter.scope as DashboardScope,dashboardWindow(filter.asOfDate||todayIso())));
    const attentionMatch=!filter.attention||!!row.phase?.overdue||!!row.phase?.note||!!row.requirement?.delayed||!!row.requirement?.highRisk;
    if(children.length||textMatch&&stageMatch&&attentionMatch)return {...row,children};
    return null;
  };
  return rows.map(row=>visit(row)).filter((row):row is WorkspaceRow=>!!row);
}

export function flattenWorkspaceRows(rows:WorkspaceRow[],expanded:Record<string,boolean>,revealAll=false,depth=0):Array<{row:WorkspaceRow;depth:number}> {
  return rows.flatMap(row=>[{row,depth},...(revealAll||(expanded[row.id]??row.kind==='feature')?flattenWorkspaceRows(row.children,expanded,revealAll,depth+1):[])]);
}
