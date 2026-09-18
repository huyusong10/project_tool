import type {PathAnalysis} from '../shared/paths';
export type WorkspaceView='list'|'graph'|'progress';
export type WorkspaceScope={kind:'project'|'feature'|'phase'|'requirement'|'unphased';id:string};
export type WorkspaceLocation={projectId:string;view:WorkspaceView;scope:WorkspaceScope;inspector?:string;detailTab?:string};
export const workspaceEntryPaths=['/','/features','/paths','/requirements','/execution'];
const scopeKinds=['project','feature','phase','requirement','unphased'];
export function readWorkspaceLocation(params:URLSearchParams,projectId:string,pathname='/'):WorkspaceLocation{
  const explicit=params.get('workspaceView');
  const view:WorkspaceView=explicit==='graph'||explicit==='progress'||explicit==='list'?explicit:pathname==='/execution'?'progress':pathname==='/features'||pathname==='/requirements'||params.get('mode')==='table'?'list':pathname==='/paths'||params.has('view')?'graph':'list';
  const kind=params.get('scopeType'),id=params.get('scopeId')||projectId;
  let scope:WorkspaceScope={kind:'project',id:projectId};
  if(kind&&scopeKinds.includes(kind))scope={kind:kind as WorkspaceScope['kind'],id};
  else if(params.get('view')==='requirement'&&params.get('requirementId'))scope={kind:'requirement',id:params.get('requirementId')!};
  else if(params.get('view')!=='features'){
    const feature=params.get('featureId')||params.get('feature'),phase=params.get('phaseId')||params.get('phase');
    if(feature)scope=phase?{kind:phase==='unassigned'?'unphased':'phase',id:phase==='unassigned'?feature:phase}:{kind:'feature',id:feature};
  }
  let inspector=params.get('detailId')||(!params.has('workspaceView')&&params.get('pathInspector')!=='closed'||params.get('pathInspector')==='open'?params.get('pathNode')||undefined:undefined);
  if(!kind&&params.get('view')==='features'&&params.get('phaseId')&&inspector?.startsWith('feature:'))inspector='phase:'+params.get('phaseId');
  if(!kind&&pathname==='/features'&&params.has('feature')&&!params.has('view')){scope={kind:'project',id:projectId};inspector='feature:'+params.get('feature');}
  return {projectId,view,scope,inspector,detailTab:params.get('detailTab')||undefined};
}
export function workspaceAncestors(location:WorkspaceLocation,data:PathAnalysis):Array<{scope:WorkspaceScope;label:string}>{
  const features=data.featureContext?.overview.features||[],requirements=data.requirements;
  const result:Array<{scope:WorkspaceScope;label:string}>=[{scope:{kind:'project',id:location.projectId},label:data.projectName}];
  const scope=location.scope;if(scope.kind==='project')return result;
  const requirement=scope.kind==='requirement'?requirements.find(r=>r.id===scope.id):undefined;
  const phase=scope.kind==='phase'?features.flatMap(f=>f.phases||[]).find(p=>p.id===scope.id):requirement?.phaseId?features.flatMap(f=>f.phases||[]).find(p=>p.id===requirement.phaseId):undefined;
  const feature=features.find(f=>f.id===(requirement?.featureId||phase?.featureId||scope.id));
  if(!feature)return result;
  result.push({scope:{kind:'feature',id:feature.id},label:feature.kind==='other'?'其他需求':feature.name});
  if(phase)result.push({scope:{kind:'phase',id:phase.id},label:phase.name});
  if(scope.kind==='unphased')result.push({scope,label:'未分派阶段'});
  if(requirement)result.push({scope,label:requirement.title});
  return result;
}
export function workspaceParams(location:WorkspaceLocation,data?:PathAnalysis,current=new URLSearchParams()){
  const next=new URLSearchParams(current);
  if(next.get('intakeView')==='import')next.set('intake','1');
  for(const name of ['view','mode','feature','phase','featureId','phaseId','requirementId','root','scopeType','scopeId','workspaceView','detailId','detailTab'])next.delete(name);
  const {scope}=location;
  next.set('projectId',location.projectId);next.set('workspaceView',location.view);next.set('scopeType',scope.kind);next.set('scopeId',scope.id);
  next.set('mode','graph');
  const trail=data?workspaceAncestors(location,data):[],feature=trail.find(t=>t.scope.kind==='feature')?.scope.id,phase=trail.find(t=>t.scope.kind==='phase')?.scope.id;
  next.set('view',scope.kind==='project'?'features':scope.kind==='requirement'?'requirement':'feature');
  if(feature)next.set('featureId',feature);else if(scope.kind==='feature'||scope.kind==='unphased')next.set('featureId',scope.id);
  if(scope.kind==='requirement'){next.set('requirementId',scope.id);next.set('root','features');}
  if(phase)next.set('phaseId',phase);else if(scope.kind==='phase')next.set('phaseId',scope.id);else if(scope.kind==='unphased')next.set('phaseId','unassigned');
  if(location.inspector){next.set('detailId',location.inspector);if(location.detailTab)next.set('detailTab',location.detailTab);}
  if(current.get('pathInspector')==='open'&&current.get('pathNode')===location.inspector)next.set('pathInspector','closed');
  // Navigation owns these constraints. Stale view filters must not exclude the current scope.
  if(scope.kind!=='project')next.delete('progressFeatureId');
  if(['phase','unphased','requirement'].includes(scope.kind))next.delete('progressPhaseId');
  else if(scope.kind==='feature'&&data){
    const phaseFilter=next.get('progressPhaseId');
    if(phaseFilter&&phaseFilter!=='unassigned'&&!data.featureContext?.overview.features.find(f=>f.id===scope.id)?.phases?.some(p=>p.id===phaseFilter))next.delete('progressPhaseId');
  }
  return next;
}
export function scopeRequirementIds(scope:WorkspaceScope,data:PathAnalysis){
  return new Set(data.requirements.filter(r=>scope.kind==='project'||scope.kind==='requirement'&&r.id===scope.id||scope.kind==='feature'&&r.featureId===scope.id||scope.kind==='phase'&&r.phaseId===scope.id||scope.kind==='unphased'&&r.featureId===scope.id&&!r.phaseId).map(r=>r.id));
}
export function scopeFromObject(id:string,data:PathAnalysis):WorkspaceScope|undefined{
  if(id.startsWith('feature:'))return {kind:'feature',id:id.slice(8)};
  if(id.startsWith('unphased:'))return {kind:'unphased',id:id.slice(9)};
  if(id.startsWith('phase:'))return {kind:'phase',id:id.slice(6)};
  if(data.requirements.some(r=>r.id===id))return {kind:'requirement',id};
  return undefined;
}
export function workspacePreferenceKey(account:string,project:string){return 'pm-workspace-location:'+account+':'+project;}

/** Open an actual dependency in the target's feature, where external predecessors remain visible. */
export function dependencyWorkspaceLocation(data:PathAnalysis,id:string):string|undefined{
  const dependency=data.dependencies.find(d=>d.id===id);if(!dependency)return;
  const requirement=data.requirements.find(r=>r.id===dependency.targetRequirementId);
  const featureId=requirement?.featureId||data.featureContext?.overview.features.find(f=>f.kind==='other')?.id;
  if(!featureId)return;
  const params=workspaceParams({projectId:data.projectId,view:'graph',scope:{kind:'feature',id:featureId}},data,new URLSearchParams({pathRelation:id,graphInspector:'open',pathScope:'all'}));
  return '/?'+params;
}

/** Invalid draft fields open the graph editor, never the formal object inspector. */
export function editorFieldLocation(data:PathAnalysis,id:string):string|undefined{
  const node=data.nodes.find(n=>n.id===id),requirement=data.requirements.find(r=>r.id===(node?.requirementId||id));
  const milestone=data.milestones?.find(m=>m.id===id);
  if(!requirement&&!milestone)return;
  const scope:WorkspaceScope=milestone&&!milestone.requirementId?{kind:'project',id:data.projectId}
    :requirement&&requirement.id!==id?{kind:'requirement',id:requirement.id}
    :{kind:'feature',id:requirement?.featureId||data.featureContext?.overview.features.find(f=>f.kind==='other')?.id||'unassigned'};
  const params=workspaceParams({projectId:data.projectId,view:'graph',scope},data,new URLSearchParams({pathNode:id,graphInspector:'open',pathInspector:'closed',pathScope:'all'}));
  return '/?'+params;
}
