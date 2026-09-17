

import { workspaceParams } from "../workspace-location";

import "../components/object-inspector.css";
import "../workspace-gantt.css";
import { useAppNavigate, useAppSearchParams } from "../use-app-navigation";
import { usePageResources } from "../page-context";

import { useEffect, useState } from "react";

import { Navigate, useParams, useLocation } from "react-router-dom";
import { remapSavedEditorUrl } from "../path-view";

import { useGuestWorkspace, useProjects, useSession } from "../app-context";

import { EmptyState, LoadingState } from "../components/Feedback";
import { PageHeader } from "../components/PageHeader";

import { readDraftRecord } from "../graph-draft-storage";
import type { DependencyChanges } from "../../shared/path-contracts";
import { type PathRequirementContext } from "../components/PathAnalysisPanel";

import { RequirementObjectContent } from '../features/requirements/RequirementDetails';

export function RequirementPage(){
 const [params]=useAppSearchParams(),location=useLocation(),{session}=useSession(),{selectedProjectId}=useProjects();
 const guest=useGuestWorkspace();
 const resource=usePageResources().requirement;
 const url=location.pathname+location.search,projectId=params.get('draftProject')||selectedProjectId;
 if(guest&&params.has('draftProject'))return <Navigate replace to={'/?projectId='+encodeURIComponent(projectId)}/>;
 const savedUrl=remapSavedEditorUrl(url,(session.accountId||'guest')+':'+projectId);
 if(params.has('draftProject')&&savedUrl!==url)return <Navigate to={savedUrl} replace state={location.state}/>;
 if(!params.has('draftProject')&&resource.data){const r=resource.data;return <Navigate replace state={location.state} to={'/?'+workspaceParams({projectId:r.projectId,view:params.get('view')==='path'?'graph':'list',scope:{kind:'requirement',id:r.id},inspector:params.get('detailId')||params.get('workItemId')||r.id,detailTab:params.get('detailTab')||undefined},undefined,params)}/>;}
 return params.get('draftProject')?<DraftRequirementPage projectId={params.get('draftProject')!}/>:<RequirementObjectContent/>;
}

export function DraftRequirementPage({projectId}:{projectId:string}){
 const {id=''}=useParams(),{session}=useSession(),navigate=useAppNavigate();
 const [item,setItem]=useState<PathRequirementContext|null|undefined>(undefined);
 useEffect(()=>{let cancelled=false;void readDraftRecord<{values:DependencyChanges[];index:number}>('pm-graph-draft:'+(session.accountId||'guest')+':'+projectId).then(h=>{const c=h?.values[h.index].entities?.find(c=>c.id===id&&c.entity==='requirement'&&c.op==='create');if(!cancelled)setItem(c?{id,projectId,title:c.data.title||'新需求',ownerId:c.data.ownerId||null,workItems:[],status:'not_started'}:null);}).catch(()=>{if(!cancelled)setItem(null);});return()=>{cancelled=true;};},[id,projectId,session.accountId]);
 if(item===undefined)return <LoadingState label="正在恢复需求草稿…"/>;
 if(!item)return <><PageHeader title="本机需求草稿不存在" onBack={()=>navigate('/?view=features')} backLabel="返回项目特性"/><EmptyState title="本机需求草稿不存在" detail="请返回项目特性检查草稿。"/></>;
 return <Navigate to={'/paths?'+new URLSearchParams({view:'requirement',requirementId:id,draftProject:projectId,root:'project'})} replace/>;
}

export { RequirementObjectDetails } from '../features/requirements/RequirementDetails';
