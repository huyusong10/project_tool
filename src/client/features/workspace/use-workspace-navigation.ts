import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../../app-context';
import { useAppNavigate } from '../../use-app-navigation';
import { readWorkspaceLocation, workspaceAncestors, workspaceParams, workspacePreferenceKey, type WorkspaceScope, type WorkspaceView } from '../../workspace-location';
import type { PathAnalysis } from '../../../shared/paths';
import type { Dashboard } from '../../types';
import { workspaceViewPreference } from './preferences';
import { writePathFilters } from '../../path-view';
import { emptyRequirementFilters } from '../../../shared/requirement-view';
export const viewFields=['state','phaseStatus','from','through','workStage','pathBranch','progressFeatureId','progressPhaseId','q','status','stage','pathSearch','pathScope','pathRelation','planning','actual','tableSort','progressSort','progressState','progressStage','progressStatus','progressRisk','progressPerson','progressSchedule','progressScope','pathEdge','pathPanel','outlineSort','outlineState'];
export function useWorkspaceNavigation(data: PathAnalysis, navigationData: PathAnalysis, report: Dashboard) {
  const {session}=useSession(),account=session.accountId||'guest',projectId=data.projectId,client=useQueryClient();
  const [params,setParams]=useSearchParams(),go=useAppNavigate(),location=readWorkspaceLocation(params,projectId);
  const [detailTrail,setDetailTrail]=useState<Array<{id:string;tab?:string;title:string}>>([]);
  const selected=location.inspector,features=data.featureContext?.overview.features||[];
  const selectedPhase=selected?.startsWith('phase:')?features.flatMap(f=>f.phases||[]).find(p=>p.id===selected.slice(6)):undefined;
  const selectedFeature=features.find(f=>f.id===(selectedPhase?.featureId||(selected?.startsWith('feature:')?selected.slice(8):'')));
  // Cancelled work may be absent from the execution graph but still has readable history.
  const selectedWork=data.nodes.find(n=>n.id===selected)||report.requirements.find(r=>r.projectId===projectId&&r.workItems?.some(w=>w.id===selected))?.workItems.find(w=>w.id===selected);
  const selectedRequirement=data.requirements.find(r=>r.id===selected)||data.requirements.find(r=>r.id===selectedWork?.requirementId);
  const archivedRequirement=features.flatMap(f=>f.phases||[]).flatMap(p=>p.requirements).find(r=>r.id===selected&&r.deletedAt);
  const title=selectedPhase?.name||selectedFeature?.name||selectedWork?.title||selectedRequirement?.title||archivedRequirement?.title;

  const memoryKey=workspacePreferenceKey(account,projectId),trail=workspaceAncestors(location,navigationData),last=trail.at(-1)!;
  const viewKey=memoryKey+':'+location.view;
  useEffect(()=>{const canonical=workspaceParams(location,navigationData,params);if([...canonical].some(([k,v])=>params.get(k)!==v)||[...params.keys()].some(k=>!canonical.has(k)))setParams(canonical,{replace:true});},[location,navigationData,params,setParams]);
  useEffect(()=>{try{localStorage.setItem(memoryKey,workspaceViewPreference(projectId,location.view));const stored=new URLSearchParams();for(const key of viewFields)if(params.has(key))stored.set(key,params.get(key)!);sessionStorage.setItem(viewKey,stored.toString());}catch{/* The URL remains shareable if storage is unavailable. */}},[memoryKey,viewKey,params,location,projectId]);
  const enter=(scope:WorkspaceScope)=>{setDetailTrail([]);const next=workspaceParams({...location,scope,inspector:undefined,detailTab:undefined},navigationData,params);next.delete('intake');for(const key of ['pathRelation','pathEdge','workspaceLocate','intakeView','draftProject'])next.delete(key);if(scope.kind==='requirement'&&!data.requirements.some(r=>r.id===scope.id)&&navigationData.requirements.some(r=>r.id===scope.id))next.set('draftProject',projectId);go('/?'+next);};
  const inspect=(id?:string,tab?:string)=>{
    if(client.isMutating())return;
    if(id&&location.inspector&&id!==location.inspector)setDetailTrail(trail=>[...trail,{id:location.inspector!,tab:location.detailTab,title:title||'上个对象'}]);
    else if(!id)setDetailTrail([]);
    const next=workspaceParams({...location,inspector:id,detailTab:tab},navigationData,params);next.set('pathInspector','closed');
    if(id){
      // Keep formal details and the graph selection in the same navigation update.
      next.set('graphInspector','closed');next.delete('pathEdge');next.delete('pathRelation');
      if(location.view==='graph')next.set('pathNode',id);
    }
    setParams(next);
  };
  const detailBack=()=>{const previous=detailTrail.at(-1);if(!previous)return;setDetailTrail(trail=>trail.slice(0,-1));setParams(workspaceParams({...location,inspector:previous.id,detailTab:previous.tab},navigationData,params),{replace:true});};
  const switchView=(view:WorkspaceView,locateId?:string,scope:WorkspaceScope=location.scope)=>{
    if(locateId)setDetailTrail([]);
    let next=workspaceParams({...location,scope,view,...(locateId?{inspector:undefined,detailTab:undefined}:{})},navigationData,params);
    for(const field of viewFields)next.delete(field);next.delete('intake');next.delete('intakeView');next.delete('workspaceLocate');
    try{const saved=new URLSearchParams(sessionStorage.getItem(memoryKey+':'+view)||'');for(const [k,v] of saved)if(viewFields.includes(k))next.set(k,v);}catch{/* No saved filters. */}
    if(locateId){
      next=writePathFilters(next,emptyRequirementFilters());
      next.set('pathScope','all');next.set('pathSearch','');
      for(const key of ['q','workStage','stage','pathBranch','pathFloat','pathEdge','pathRelation'])next.delete(key);
      const r=data.requirements.find(r=>r.id===locateId)||data.requirements.find(r=>r.id===data.nodes.find(n=>n.id===locateId)?.requirementId);
      next.set('workspaceLocate',scope.kind==='project'&&r?.featureId?'feature:'+r.featureId:scope.kind!=='requirement'&&r?r.id:locateId);
    }
    if(locateId&&scope.kind==='requirement'){next.delete('workItemId');next.set('pathNode',locateId===scope.id?'':locateId);next.set('graphInspector','closed');next.set('pathInspector','closed');}
    go('/?'+next);
  };

  return { params, setParams, go, location, detailTrail, trail, last, enter, inspect, detailBack, switchView, selected, features, selectedPhase, selectedFeature, selectedWork, selectedRequirement, archivedRequirement, title };
}
