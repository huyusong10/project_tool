import * as reportingApi from "../features/reporting/api";
import * as planningApi from "../features/planning/api";

import { Button } from "../components/Button";

import { ApiError } from "../api";

import { progressEntryParams } from "../project-workspace-navigation";
import { useState, useRef, useEffect } from 'react';

import { Navigate, useSearchParams } from 'react-router-dom';
import { useProjects, useSession } from "../app-context";
import { useResourceQuery } from "../use-resource-query";
import { keys } from "../query-keys";
import type { Dashboard } from "../types";
import type { PathAnalysis } from "../../shared/paths";
import { clearProjectGraphDrafts } from "../use-graph-draft";

import { PageHeader } from "../components/PageHeader";

import { ProgressWorkspace } from '../features/workspace/ProgressWorkspace';

export function ProgressWorkspacePage(){
  const {selectedProjectId}=useProjects(),{session}=useSession(),[params]=useSearchParams();
  const [entry]=useState(()=>progressEntryParams(session.accountId||'guest',selectedProjectId,params)),migrated=useRef(false);
  const report=useResourceQuery<Dashboard>([...keys.dashboard,selectedProjectId],signal => reportingApi.dashboardQuery<Dashboard>(selectedProjectId, { signal }),!!selectedProjectId);
  const graph=useResourceQuery<{analysis:PathAnalysis}>([...keys.featureGraph,selectedProjectId,session.accountId,'features'],signal => planningApi.projectsPathGraphQuery<{analysis:PathAnalysis}>(selectedProjectId, { signal }),!!selectedProjectId);
  useEffect(()=>{if([report.error,graph.error].some(e=>e instanceof ApiError&&[401,403].includes(e.status)))clearProjectGraphDrafts(session.accountId||'guest',selectedProjectId);},[report.error,graph.error,session.accountId,selectedProjectId]);
  if(!migrated.current){migrated.current=true;if(entry.toString()!==params.toString())return <Navigate to={'/execution?'+entry} replace/>;}
  if(!report.data||!graph.data||report.unavailable||graph.unavailable)return <><PageHeader title="项目空间"/><div className="page-content"><p>{report.error?.message||graph.error?.message||(!selectedProjectId?'请选择项目':'正在读取进展表…')}</p>{(report.error||graph.error)&&<Button variant="secondary" className="ghost-button" onClick={()=>{void report.refetch();void graph.refetch();}}>重新读取</Button>}</div></>;
  return <ProgressWorkspace key={(session.accountId||'guest')+selectedProjectId} report={report.data} formal={graph.data.analysis}/>;
}

export { ProgressWorkspace } from '../features/workspace/ProgressWorkspace';
