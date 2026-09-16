import type {Dashboard, Requirement, WorkItem} from './types';
import type {FeatureOverview} from '../shared/feature-overview';
import type {FeaturePhase} from '../shared/feature-phases';
import type {PathAnalysis} from '../shared/paths';
import {todayIso} from '../shared/domain';
import {matchesSearch} from '../shared/search';
import {dashboardWindow,matchesDashboardScope,type DashboardScope} from '../shared/dashboard';
import {selectedProgressStates,matchesProgressStatus,matchesProgressStage,compareProgressNames,compareProgressTitles} from '../shared/progress-query';
import {deriveExecutionStage} from '../shared/execution-stage';

export type WorkspaceRow = {
  id:string; kind:'feature'|'phase'|'requirement'|'work'; title:string; featureId:string;
  phaseId?:string; requirementId?:string; children:WorkspaceRow[]; archived?:boolean; temporary?:boolean; filterContext?:boolean; virtual?:boolean;
  formalRequirement?:Requirement; formalWork?:WorkItem;
  feature?:FeatureOverview; phase?:FeaturePhase; requirement?:Requirement; work?:WorkItem;
};

/** Formal delivery facts remain intact when structural drafts change the visible scope. */
export function workspaceRows(report:Dashboard, projection?:PathAnalysis,sort='name'):WorkspaceRow[] {
  const formal=new Map(report.requirements.map(r=>[r.id,r]));
  const requirements:Requirement[]=projection?projection.requirements.filter(r=>!r.deletedAt).map(r=>{
    const saved=formal.get(r.id);
    const savedOrder=new Map(saved?.workItems.map((w,index)=>[w.id,w.sortOrder??index]));
    const savedRank=new Map(saved?.workItems.map((w,index)=>[w.id,index]));
    const nextOrder=Math.max(-1,...savedOrder.values())+1;
    const works=projection.nodes.filter(n=>n.requirementId===r.id&&n.kind==='work').map((n,index)=>{
      const old=saved?.workItems.find(w=>w.id===n.id);
      return {...old,id:n.id,requirementId:r.id,title:n.title,workStage:n.workStage,ownerId:n.ownerId,ownerName:n.ownerName,
        plannedStart:n.plannedStart,plannedEnd:n.plannedEnd,status:old?.status||'not_started',progress:old?.progress||0,
        actualStart:old?.actualStart||null,actualEnd:old?.actualEnd||null,sortOrder:savedOrder.get(n.id)??nextOrder+index} as WorkItem;
    });
    // The dependency graph omits cancelled work; the progress table still shows its execution history.
    works.push(...(saved?.workItems||[]).filter(w=>w.status==='cancelled'&&!works.some(n=>n.id===w.id)));
    works.sort((a,b)=>a.sortOrder-b.sortOrder||(savedRank.get(a.id)??Number.MAX_SAFE_INTEGER)-(savedRank.get(b.id)??Number.MAX_SAFE_INTEGER));
    return {...saved,id:r.id,projectId:r.projectId,title:r.title,sortOrder:r.sortOrder,featureId:r.featureId,phaseId:r.phaseId,
      background:r.background,acceptanceCriteria:r.acceptanceCriteria,ownerId:r.ownerId,ownerName:r.ownerName,
      plannedStart:r.plannedStart,plannedEnd:r.plannedEnd,workItems:works,status:saved?.status||'not_started',progress:saved?.progress||0,
      executionStage:saved?.executionStage,actualStart:saved?.actualStart||null,actualEnd:saved?.actualEnd||null} as Requirement;
  }):report.requirements;
  const features=report.featureOverview?.features||[];
  const requirementRow=(r:Requirement,featureId:string,phaseId?:string):WorkspaceRow=>({
    id:r.id,kind:'requirement',title:r.title,featureId,phaseId,requirementId:r.id,requirement:r,formalRequirement:formal.get(r.id),
    archived:!!r.deletedAt,temporary:!formal.has(r.id)&&!r.deletedAt,
    children:r.deletedAt?[]:[...r.workItems].sort((a,b)=>(a.sortOrder??0)-(b.sortOrder??0)).map(w=>({id:w.id,kind:'work',title:w.title,featureId,phaseId,requirementId:r.id,requirement:r,work:w,formalRequirement:formal.get(r.id),formalWork:formal.get(r.id)?.workItems.find(old=>old.id===w.id),
      temporary:!formal.get(r.id)?.workItems.some(old=>old.id===w.id),children:[]})),
  });
  const byTitle=(a:Parameters<typeof compareProgressTitles>[0]&{sortOrder?:number;requirement?:Requirement},b:Parameters<typeof compareProgressTitles>[0]&{sortOrder?:number;requirement?:Requirement})=>sort==='manual'?((a.sortOrder??a.requirement?.sortOrder??0)-(b.sortOrder??b.requirement?.sortOrder??0))||compareProgressTitles(a,b):compareProgressTitles(a,b);
  const firstName=(id:string)=>requirements.filter(r=>r.featureId===id).sort(byTitle)[0]?.title;
  const featureOrder=new Map(features.map(f=>[f.id,firstName(f.id)]));
  return [...features].sort((a,b)=>{
    if((a.kind==='other')!==(b.kind==='other'))return a.kind==='other'?1:-1;
    if(sort==='manual')return a.sortOrder-b.sortOrder||compareProgressNames(a.name,b.name);
    if(sort==='feature')return compareProgressNames(a.name,b.name)||a.id.localeCompare(b.id);
    const first=featureOrder.get(a.id),second=featureOrder.get(b.id);
    return first&&second?compareProgressNames(first,second)||compareProgressNames(a.name,b.name):first?-1:second?1:compareProgressNames(a.name,b.name);
  }).map(f=>{
    const own=requirements.filter(r=>r.featureId===f.id).sort(byTitle);
    const phases:WorkspaceRow[]=[...(f.phases||[])].sort((a,b)=>a.sortOrder-b.sortOrder).map(p=>({id:'phase:'+p.id,kind:'phase',title:p.name,featureId:f.id,phaseId:p.id,phase:p,feature:f,children:[
      ...own.filter(r=>r.phaseId===p.id).map(r=>requirementRow(r,f.id,p.id)),
      ...p.requirements.filter(r=>r.deletedAt).map(r=>requirementRow({...r,projectId:f.projectId,projectName:f.name,templateId:null,templateName:null,ownerId:null,ownerName:null,plannedStart:null,plannedEnd:null,progress:100,plannedProgress:null,progressGap:0,acceptedAt:null,acceptedByAccountId:null,riskLevel:"low",riskEvaluated:false,riskReason:"",priority:"P2",createdAt:"",updatedAt:"",delayed:false,highRisk:false,finishVariance:0,durationVariance:0,effectiveEnd:null,workItems:[]},f.id,p.id)),
    ].sort(byTitle)}));
    const unassigned=own.filter(r=>!r.phaseId);
    if(unassigned.length||f.kind!=='other')phases.push({id:'unphased:'+f.id,kind:'phase',title:'未分派阶段',featureId:f.id,phaseId:'unassigned',feature:f,virtual:true,children:unassigned.map(r=>requirementRow(r,f.id,'unassigned'))});
    return {id:'feature:'+f.id,kind:'feature',title:f.kind==='other'?'其他需求':f.name,featureId:f.id,feature:f,archived:!!f.archivedAt,children:phases};
  });
}

export type RowFilters={query:string; featureId:string; phaseId:string; state:string; stage:string;status?:string;risk?:string;person?:string;schedule?:string;scope?:string;asOfDate?:string};
export function filterWorkspaceRows(rows:WorkspaceRow[],filter:RowFilters):WorkspaceRow[] {
  const states=selectedProgressStates(filter.status||'');
  const itemFilters=!!(filter.stage||filter.status||filter.risk||filter.person||filter.schedule||filter.scope);
  const matches=(row:WorkspaceRow)=>matchesSearch([{text:row.title,weight:100},{text:row.phase?.scope||row.feature?.description||''}],filter.query);
  const visit=(row:WorkspaceRow,inherited=false):WorkspaceRow|null=>{
    if(row.kind==='feature'&&(filter.featureId&&row.featureId!==filter.featureId||(filter.state==='archived'?!row.archived:row.archived)))return null;
    if(row.kind!=='feature'&&filter.phaseId&&row.phaseId!==filter.phaseId)return null;
    const textMatch=inherited||!filter.query||matches(row);
    const children=row.children.map(child=>visit(child,textMatch)).filter((child):child is WorkspaceRow=>!!child);
    const r=row.requirement,w=row.work,item=w||r;
    const stage=r?(r.executionStage||deriveExecutionStage(r,r.workItems,r.milestones)):null;
    const planned=!!item?.plannedStart&&!!item.plannedEnd&&(!!w||r?.scheduleComplete!==false);
    const stageMatch=matchesProgressStage(item?.status||'',stage,filter.stage,w?(w.workStage??null):undefined)
      &&(!filter.status||!!item&&matchesProgressStatus(item.status,states))
      &&(!filter.risk||(r?.riskEvaluated?r.riskLevel:'pending')===filter.risk)
      &&(!filter.person||!!item&&(filter.person==='unassigned'?!item.ownerId:item.ownerId===filter.person||w?.assigneeIds?.includes(filter.person)))
      &&(!filter.schedule||!!item&&(filter.schedule==='delayed'?(w?!!w.plannedEnd&&!['completed','cancelled'].includes(w.status)&&w.plannedEnd<(filter.asOfDate||todayIso()):r?.delayed):filter.schedule==='unplanned'?!planned:planned))
      &&(!filter.scope||!!r&&matchesDashboardScope(r,filter.scope as DashboardScope,dashboardWindow(filter.asOfDate||todayIso())));
    const ownMatch=textMatch&&stageMatch&&(!itemFilters||!!item);
    if(children.length||ownMatch)return {...row,children,filterContext:!!item&&!ownMatch};
    return null;
  };
  return rows.map(row=>visit(row)).filter((row):row is WorkspaceRow=>!!row);
}

export function flattenWorkspaceRows(rows:WorkspaceRow[],expanded:Record<string,boolean>,revealAll=false,depth=0):Array<{row:WorkspaceRow;depth:number}> {
  return rows.flatMap(row=>[{row,depth},...(revealAll||(expanded[row.id]??(!row.virtual&&['feature','phase'].includes(row.kind)))?flattenWorkspaceRows(row.children,expanded,revealAll,depth+1):[])]);
}
