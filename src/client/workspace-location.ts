import type {PathAnalysis} from '../shared/paths';
export type WorkspaceView='list'|'graph'|'progress';
export type WorkspaceScope={kind:'project'|'feature'|'phase'|'requirement'|'unphased';id:string};
export type WorkspaceLocation={projectId:string;view:WorkspaceView;scope:WorkspaceScope;inspector?:string};
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
  let inspector=params.get('pathInspector')==='closed'?undefined:params.get('pathNode')||undefined;
  if(!kind&&params.get('view')==='features'&&params.get('phaseId')&&inspector?.startsWith('feature:'))inspector='phase:'+params.get('phaseId');
  if(!kind&&pathname==='/features'&&params.has('feature')&&!params.has('view')){scope={kind:'project',id:projectId};inspector='feature:'+params.get('feature');}
  return {projectId,view,scope,inspector};
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
  if(scope.kind==='unphased')result.push({scope,label:'未安排 Phase'});
  if(requirement)result.push({scope,label:requirement.title});
  return result;
}
export function workspaceParams(location:WorkspaceLocation,data?:PathAnalysis,current=new URLSearchParams()){
  const next=new URLSearchParams(current);
  if(next.get('intakeView')==='import')next.set('intake','1');
  for(const name of ['view','mode','feature','phase','featureId','phaseId','requirementId','root','scopeType','scopeId','workspaceView','pathNode','pathInspector'])next.delete(name);
  const {scope}=location;
  next.set('projectId',location.projectId);next.set('workspaceView',location.view);next.set('scopeType',scope.kind);next.set('scopeId',scope.id);
  next.set('mode','graph');
  const trail=data?workspaceAncestors(location,data):[],feature=trail.find(t=>t.scope.kind==='feature')?.scope.id,phase=trail.find(t=>t.scope.kind==='phase')?.scope.id;
  next.set('view',scope.kind==='project'?'features':scope.kind==='requirement'?'requirement':'feature');
  if(feature)next.set('featureId',feature);else if(scope.kind==='feature'||scope.kind==='unphased')next.set('featureId',scope.id);
  if(scope.kind==='requirement'){next.set('requirementId',scope.id);next.set('root','features');}
  if(phase)next.set('phaseId',phase);else if(scope.kind==='phase')next.set('phaseId',scope.id);else if(scope.kind==='unphased')next.set('phaseId','unassigned');
  if(location.inspector){next.set('pathNode',location.inspector);next.set('pathInspector','open');}else next.set('pathInspector','closed');
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
