export type ProjectTask='scope'|'progress';
export const workspacePaths=['/','/features','/paths','/requirements','/execution','/analytics','/actions'];
export const isProjectWorkspace=(pathname:string)=>workspacePaths.includes(pathname);
export const projectTask=(pathname:string):ProjectTask=>['/execution','/analytics','/actions'].includes(pathname)?'progress':'scope';
const key=(account:string,project:string,task:ProjectTask)=>`pm-project-task:${account}:${project}:${task}`;
export function initialScopeMode(account:string,project:string){
  try{
    const recent=new URLSearchParams(sessionStorage.getItem('pm-canvas-navigation:'+account+':'+project+':features')||'');
    return recent.get('mode')==='table'?'table':'graph';
  }catch{return 'graph';}
}
/** Only stored user choices migrate; the former implicit in-progress default does not. */
export function progressEntryParams(account:string,project:string,current:URLSearchParams){
  const next=new URLSearchParams(current);
  const aliases:Record<string,string>={feature:'featureId',phase:'phaseId',status:'progressStatus',risk:'progressRisk',personId:'progressPerson',schedule:'progressSchedule',scope:'progressScope'};
  for(const [old,name] of Object.entries(aliases))if(next.has(old)&&!next.has(name)){next.set(name,next.get(old)!);next.delete(old);}
  if([...current.keys()].some(k=>k!=='projectId'))return next;
  try{
    const saved=sessionStorage.getItem(key(account,project,'progress'));
    if(saved){const params=new URL(saved,'http://workspace.local').searchParams;for(const [name,value] of params)if(!next.has(name))next.set(name,value);return next;}
    const prefix='pm-path-view:'+account+':'+project+':dashboard-gantt:';
    const fields:Record<string,string>={search:'q','status-v2':'progressStatus',risk:'progressRisk',personId:'progressPerson',feature:'featureId',schedule:'progressSchedule','dashboard-scope':'progressScope'};
    for(const [old,name] of Object.entries(fields)){const value=JSON.parse(sessionStorage.getItem(prefix+old)||'null');if(typeof value==='string'&&value)next.set(name,value);}
  }catch{/* Invalid view preferences never alter submitted requests. */}
  return next;
}
export function rememberProjectTask(account:string,project:string,pathname:string,search:string){
  if(!['/','/execution','/requirements'].includes(pathname))return;
  try{sessionStorage.setItem(key(account,project,projectTask(pathname)),pathname+search);}catch{/* Current navigation remains usable. */}
}
export function projectTaskUrl(account:string,project:string,task:ProjectTask,current?:URLSearchParams){
  let saved='';try{saved=sessionStorage.getItem(key(account,project,task))||'';}catch{/* Use the explicit context. */}
  const target=new URL(saved|| (task==='scope'?'/?view=features&mode=graph':'/execution'),'http://workspace.local');
  if(current){
    for(const field of ['view','featureId','phaseId','requirementId','pathNode','pathEdge','q']){
      target.searchParams.delete(field);if(current.has(field))target.searchParams.set(field,current.get(field)!);
    }
    const node=current.get('pathNode');if(node?.startsWith('feature:'))target.searchParams.set('featureId',node.slice(8));
    if(task==='scope'){
      target.pathname='/';
      if(current.get('requirementId'))target.searchParams.set('view','requirement');
      if(node?.startsWith('phase:')){target.searchParams.set('phaseId',node.slice(6));target.searchParams.delete('pathNode');}
      if(current.get('requirementId')||node)target.searchParams.delete('intake');
      if(!target.searchParams.has('view'))target.searchParams.set('view',current.has('requirementId')?'requirement':current.has('featureId')?'feature':'features');
      if(!target.searchParams.has('mode'))target.searchParams.set('mode','graph');
    }else{target.pathname='/execution';target.searchParams.delete('mode');}
  }
  return target.pathname+target.search;
}
