import { readWorkspaceViewPreference } from '../features/workspace/preferences';
import * as reportingApi from "../features/reporting/api";
import * as planningApi from "../features/planning/api";
import { isGuestWorkspace } from "../permissions";

import { Button } from "../components/Button";

import { useEffect } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';

import { useProjects, useSession } from "../app-context";
import { useResourceQuery } from "../use-resource-query";
import { keys } from "../query-keys";
import { ApiError } from "../api";
import type { Dashboard } from "../types";
import type { PathAnalysis } from "../../shared/paths";

import { progressEntryParams } from "../project-workspace-navigation";
import { readWorkspaceLocation, workspaceParams, workspacePreferenceKey } from "../workspace-location";

import { clearProjectGraphDrafts } from "../use-graph-draft";

import { PageHeader } from "../components/PageHeader";

import "../project-workspace.css";

import { ProjectWorkspace } from '../features/workspace/ProjectWorkspace';

export function ProjectWorkspacePage(){
  const {selectedProjectId,projects}=useProjects(),{session}=useSession(),[params]=useSearchParams(),url=useLocation(),account=session.accountId||'guest';
  const guest=isGuestWorkspace(session,projects.find(p=>p.id===selectedProjectId));
  const report=useResourceQuery<Dashboard>([...keys.dashboard,selectedProjectId],signal => reportingApi.dashboardQuery<Dashboard>(selectedProjectId, { signal }),!!selectedProjectId);
  const graph=useResourceQuery<{analysis:PathAnalysis}>([...keys.featureGraph,selectedProjectId,session.accountId,'features'],signal => planningApi.projectsPathGraphQuery<{analysis:PathAnalysis}>(selectedProjectId, { signal }),!!selectedProjectId);
  useEffect(()=>{if([report.error,graph.error].some(e=>e instanceof ApiError&&[401,403].includes(e.status)))clearProjectGraphDrafts(account,selectedProjectId);},[report.error,graph.error,account,selectedProjectId]);
  if(!report.data||!graph.data||report.unavailable||graph.unavailable)return <><PageHeader title="项目空间"/><div className="page-content"><p>{report.error?.message||graph.error?.message||(!selectedProjectId?'请选择项目':'正在读取项目工作区…')}</p>{(report.error||graph.error)&&<Button variant="secondary" className="ghost-button" onClick={()=>{void report.refetch();void graph.refetch();}}>重新读取</Button>}</div></>;
  if(guest&&(params.has('intake')||params.has('draftProject'))){const safe=new URLSearchParams(params);for(const key of ['intake','intakeView','draftProject'])safe.delete(key);return <Navigate replace to={'/?'+safe}/>;}
  if(url.pathname!=='/'||!params.has('workspaceView')||params.get('projectId')!==selectedProjectId){
    const entryParams=url.pathname==='/execution'?progressEntryParams(account,selectedProjectId,params):new URLSearchParams(params);let location=readWorkspaceLocation(entryParams,selectedProjectId,url.pathname);
    if(url.pathname==='/'&&(!params.size||params.size===1&&params.has('projectId')||params.get('projectId')&&params.get('projectId')!==selectedProjectId)){
      location={projectId:selectedProjectId,scope:{kind:'project',id:selectedProjectId},view:guest?'progress':'list'};
      try{const view=readWorkspaceViewPreference(localStorage.getItem(workspacePreferenceKey(account,selectedProjectId)),selectedProjectId);if(view)location={...location,view};}catch{/* Use the project list on first entry. */}
    }
    return <Navigate replace to={'/?'+workspaceParams(location,graph.data.analysis,entryParams)} state={url.state}/>;
  }
  return <ProjectWorkspace key={account+':'+selectedProjectId} report={report.data} data={graph.data.analysis}/>;
}
