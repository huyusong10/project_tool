import type {DependencyChanges} from '../shared/path-contracts';
import type {PathAnalysis} from '../shared/paths';
export type EditorConflict={key:string;title:string;field:string;before:unknown;server:unknown;draft:unknown;canKeep:boolean};
const equal=(a:unknown,b:unknown)=>JSON.stringify(a??null)===JSON.stringify(b??null);
const entity=(d:PathAnalysis,id:string)=>d.requirements.find(r=>r.id===id)||d.milestones?.find(m=>m.id===id)||(()=>{const n=d.nodes.find(n=>n.id===id);return n?{...n,...n.estimate}:undefined;})();
export function rebaseEditor(base:PathAnalysis|undefined,server:PathAnalysis,input:DependencyChanges,choices:Record<string,'draft'|'server'>={}){
 const changes=structuredClone(input),conflicts:EditorConflict[]=[];
 const resolve=(key:string,title:string,field:string,before:unknown,current:unknown,draft:unknown,canKeep=true)=>{conflicts.push({key,title,field,before,server:current,draft,canKeep});return choices[key]||null;};
 changes.entities=(changes.entities||[]).filter(c=>{
  if(c.op==='create')return true;const old=base&&entity(base,c.id),now=entity(server,c.id);
  if(!now||('status' in now&&['completed','cancelled'].includes(String(now.status))&&c.op!=='delete'))return resolve(c.id,c.data.title||c.id,'对象状态',old,now,'继续编辑',false)!=='server';
  if(c.op==='delete'&&now.version!==c.expectedVersion){const keep=resolve(c.id,String(now.title),'删除对象',old,now,'删除')!=='server';c.expectedVersion=now.version;return keep;}
  for(const [field,value] of Object.entries(c.data)){
   if(field==='reason')continue;const a=old?.[field as keyof typeof old],b=now[field as keyof typeof now];
   if(!equal(a,b)&&!equal(b,value)&&resolve(c.id+':'+field,String(now.title),field,a,b,value)==='server')delete c.data[field as keyof typeof c.data];
  }
  c.expectedVersion=now.version;return c.op==='delete'||Object.keys(c.data).some(k=>k!=='reason');
 });
 const created=new Set(changes.entities?.filter(c=>c.op==='create').map(c=>c.id));
 changes.estimates=changes.estimates.filter(c=>{if(created.has(c.workItemId))return true;const old=base?.nodes.find(n=>n.id===c.workItemId),now=server.nodes.find(n=>n.id===c.workItemId);if(!now)return resolve(c.workItemId,c.workItemId,'工作项已失效',old,null,c,false)!=='server';
  for(const [field,value] of Object.entries(c)){if(field==='workItemId')continue;const a=old?.estimate[field as keyof typeof old.estimate],b=now.estimate[field as keyof typeof now.estimate];if(!equal(a,b)&&!equal(b,value)&&resolve(c.workItemId+':'+field,now.title,field,a,b,value)==='server')delete c[field as keyof typeof c];}return Object.keys(c).length>1;});
 changes.layouts=(changes.layouts||[]).filter(l=>{const current=server.layouts?.find(n=>n.scope===l.scope&&n.direction===l.direction);if((current?.version||0)!==l.expectedVersion){const result=resolve('layout:'+l.scope,l.scope,'共享布局',base?.layouts?.find(n=>n.scope===l.scope)?.positions,current?.positions,l.positions);if(result==='server')return false;l.expectedVersion=current?.version||0;}return true;});
 const endpointExists=(id:string)=>created.has(id)||!!entity(server,id);
 changes.add=changes.add.filter(e=>{
  const ids=[e.sourceMilestoneId||e.sourceWorkItemId||e.sourceRequirementId,e.targetMilestoneId||e.targetWorkItemId||e.targetRequirementId];
  const missing=ids.filter(id=>!endpointExists(id));
  if(!missing.length)return true;
  return resolve('relation:'+e.clientId,'新增依赖','关系端点已失效',base?.dependencies.find(d=>d.id===e.clientId),missing,e,false)!=='server';
 });
 changes.remove=changes.remove.filter(id=>server.dependencies.some(e=>e.id===id));
 return {changes,conflicts,pending:conflicts.filter(c=>!choices[c.key])};
}
