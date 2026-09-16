import type {PathAnalysis,PathBlocker,PathRequirement} from '../shared/paths';
import {scopeRequirementIds,workspaceAncestors,type WorkspaceLocation} from './workspace-location';
import {dashboardWindow,matchesDashboardScope} from '../shared/dashboard';

export function workspaceSummary(location:WorkspaceLocation,data:PathAnalysis){
  const ids=scopeRequirementIds(location.scope,data),features=data.featureContext?.overview.features||[];
  const featureId=workspaceAncestors(location,data).find(t=>t.scope.kind==='feature')?.scope.id;
  const hasPhases=['project','feature','phase'].includes(location.scope.kind);
  const phases=hasPhases?features.filter(f=>!f.archivedAt&&(!featureId||f.id===featureId)).flatMap(f=>(f.phases||[]).filter(p=>location.scope.kind!=='phase'||p.id===location.scope.id).map(p=>({...p,featureName:f.name}))):[];
  const contributions=new Map(data.requirements.filter(r=>ids.has(r.id)&&(!r.deletedAt||r.status==='completed')&&r.status!=='cancelled').map(r=>[r.id,r]));
  for(const p of phases)for(const r of p.requirements)if(r.deletedAt&&r.status==='completed'&&!contributions.has(r.id))contributions.set(r.id,{...r,projectId:location.projectId} as PathRequirement);
  const merged=new Map<string,PathBlocker>();
  for(const blocker of data.blockers){
    if(!ids.has(blocker.requirementId)&&!blocker.affectedRequirementIds.some(id=>ids.has(id)))continue;
    const old=merged.get(blocker.nodeId);
    merged.set(blocker.nodeId,old?{...old,critical:old.critical||blocker.critical,reasons:[...new Set([...old.reasons,...blocker.reasons])],affectedRequirementIds:[...new Set([...old.affectedRequirementIds,...blocker.affectedRequirementIds])]}:{...blocker});
  }
  const requirements=[...contributions.values()],active=new Set(requirements.filter(r=>!['completed','cancelled'].includes(r.status)).map(r=>r.id)),blockers=[...merged.values()];
  const blockedIds=new Set(blockers.flatMap(b=>[b.requirementId,...b.affectedRequirementIds].filter(id=>active.has(id))));
  const window=dashboardWindow(data.asOfDate);
  const recentCompleted=requirements.filter(r=>matchesDashboardScope(r,'recent_completed',window));
  const inProgress=requirements.filter(r=>!r.deletedAt&&r.status==='in_progress');
  return {ids,requirements,phases,hasPhases,blockers,blockedIds,recentCompleted,inProgress,recentFrom:window.recentFrom,unphased:requirements.filter(r=>!r.phaseId&&!r.deletedAt)};
}
