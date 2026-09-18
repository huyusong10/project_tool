import type {DependencyChanges} from '../shared/path-contracts';
import type {PathAnalysis} from '../shared/paths';
import {isDraftTemplateId} from '../shared/template-instance';
/** Multiple workspace views share one draft but may refresh at different times. */
export function currentEditorAnalysis(incoming:PathAnalysis,shared?:PathAnalysis):PathAnalysis{
 return shared?.projectId===incoming.projectId&&shared.revision>incoming.revision?shared:incoming;
}
export type EditorConflict={key:string;title:string;field:string;before:unknown;server:unknown;draft:unknown;canKeep:boolean};
const equal=(a:unknown,b:unknown)=>JSON.stringify(a??null)===JSON.stringify(b??null);
const entity=(d:PathAnalysis,id:string)=>d.requirements.find(r=>r.id===id)||d.milestones?.find(m=>m.id===id)||(()=>{const n=d.nodes.find(n=>n.id===id);return n?{...n,...n.estimate}:undefined;})();
export function rebaseEditor(base:PathAnalysis|undefined,server:PathAnalysis,input:DependencyChanges,choices:Record<string,'draft'|'server'>={}){
 const changes=structuredClone(input),conflicts:EditorConflict[]=[];
 const resolve=(key:string,title:string,field:string,before:unknown,current:unknown,draft:unknown,canKeep=true)=>{conflicts.push({key,title,field,before,server:current,draft,canKeep});return choices[key]||null;};
 changes.entities=(changes.entities||[]).filter(c=>{
  if(c.op==='create'||isDraftTemplateId(c.id,input.entities||[]))return true;const old=base&&entity(base,c.id),now=entity(server,c.id);
  if(!now)return resolve(c.id,c.data.title||old?.title||'已不可用的'+{requirement:'需求',work:'工作项',milestone:'里程碑'}[c.entity],'对象状态',old,now,'继续编辑',false)!=='server';
  if(c.op==='delete'&&now.version!==c.expectedVersion){const keep=resolve(c.id,String(now.title),'删除对象',old,now,'删除')!=='server';c.expectedVersion=now.version;return keep;}
  for(const [field,value] of Object.entries(c.data)){
   if(field==='reason')continue;const read=(value:typeof old)=>field==='reviewForecast'?value&&('forecastReview' in value?value.forecastReview:'forecastBasis' in value?value.forecastBasis?.review:undefined):value?.[field as keyof typeof value];const a=read(old),b=read(now);
   if(!equal(a,b)&&!equal(b,value)&&resolve(c.id+':'+field,String(now.title),field,a,b,value)==='server')delete c.data[field as keyof typeof c.data];
  }
  c.expectedVersion=now.version;return c.op==='delete'||Object.keys(c.data).some(k=>k!=='reason');
 });
 const created=new Set(changes.entities?.filter(c=>c.op==='create').map(c=>c.id));
 changes.estimates=changes.estimates.filter(c=>{if(created.has(c.workItemId)||isDraftTemplateId(c.workItemId,input.entities||[]))return true;const old=base?.nodes.find(n=>n.id===c.workItemId),now=server.nodes.find(n=>n.id===c.workItemId);if(!now)return resolve(c.workItemId,old?.title||'已不可用的工作项','工作项已失效',old,null,c,false)!=='server';
  for(const [field,value] of Object.entries(c)){if(field==='workItemId')continue;const a=field==='reviewForecast'?old?.forecastBasis?.review:old?.estimate[field as keyof typeof old.estimate],b=field==='reviewForecast'?now.forecastBasis?.review:now.estimate[field as keyof typeof now.estimate];if(!equal(a,b)&&!equal(b,value)&&resolve(c.workItemId+':'+field,now.title,field,a,b,value)==='server')delete c[field as keyof typeof c];}return Object.keys(c).length>1;});
 changes.layouts=(changes.layouts||[]).filter(l=>{const current=server.layouts?.find(n=>n.scope===l.scope&&n.direction===l.direction);if((current?.version||0)!==l.expectedVersion){const result=resolve('layout:'+l.scope,l.scope,'共享布局',base?.layouts?.find(n=>n.scope===l.scope)?.positions,current?.positions,l.positions);if(result==='server')return false;l.expectedVersion=current?.version||0;}return true;});
 const endpointExists=(id:string)=>created.has(id)||isDraftTemplateId(id,input.entities||[])||!!entity(server,id);
 changes.add=changes.add.filter(e=>{
  const ids=[e.sourceMilestoneId||e.sourceWorkItemId||e.sourceRequirementId,e.targetMilestoneId||e.targetWorkItemId||e.targetRequirementId];
  const missing=ids.filter(id=>!endpointExists(id));
  if(!missing.length)return true;
  return resolve('relation:'+e.clientId,'新增依赖','关系端点已失效',base?.dependencies.find(d=>d.id===e.clientId),missing,e,false)!=='server';
 });
 changes.remove=changes.remove.filter(id=>server.dependencies.some(e=>e.id===id)||isDraftTemplateId(id,input.entities||[]));
 if(changes.featureRelations)changes.featureRelations=changes.featureRelations.filter(c=>{
  const old=base?.featureContext?.relations.find(r=>r.id===c.id),now=server.featureContext?.relations.find(r=>r.id===c.id);
  const endpoints=c.op==='create'?[c.sourceFeatureId,c.targetFeatureId]:now?[now.sourceFeatureId,now.targetFeatureId]:[];
  const invalid=c.op!=='delete'&&endpoints.some(id=>!server.featureContext?.overview.features.some(g=>g.id===id&&!g.archivedAt));
  if(invalid)return resolve('feature-relation:'+c.id,'规划关系','端点已归档或删除',old,now,c,false)!=='server';
  if(c.op==='create'){
   const duplicate=server.featureContext?.relations.find(r=>r.sourceFeatureId===c.sourceFeatureId&&r.targetFeatureId===c.targetFeatureId);
   return !duplicate||resolve('feature-relation:'+c.id,'规划关系','相同规划关系已存在',null,duplicate,c,false)!=='server';
  }
  if(!now){if(c.op==='delete')return false;return resolve('feature-relation:'+c.id,'规划关系','关系已删除',old,null,c,false)!=='server';}
  if(c.expectedVersion!==now.version){
   if(c.op==='update'&&c.note===now.note)return false;
   if(resolve('feature-relation:'+c.id,'规划关系',c.op==='delete'?'删除关系':'关系说明',old,now,c)==='server')return false;
   c.expectedVersion=now.version;
  }
  return true;
 });
 return {changes,conflicts,pending:conflicts.filter(c=>!choices[c.key])};
}

/** Rebase every undo step; conflicts from an older step remain reviewable. */
export function rebaseEditorHistory(base:PathAnalysis|undefined,server:PathAnalysis,values:DependencyChanges[],index:number,choices:Record<string,'draft'|'server'>={}){
 const results=values.map((value,i)=>{
  const prefix=i===index?'':'history:'+i+':';
  const local=Object.fromEntries(Object.entries(choices).filter(([k])=>!prefix||k.startsWith(prefix)).map(([k,v])=>[prefix?k.slice(prefix.length):k,v]));
  const result=rebaseEditor(base,server,value,local);
  const decorate=(c:EditorConflict)=>({...c,key:prefix+c.key,title:(prefix?'撤销步骤 '+i+' · ':'')+c.title});
  return {...result,conflicts:result.conflicts.map(decorate),pending:result.pending.map(decorate)};
 });
 return {values:results.map(r=>r.changes),current:results[index].changes,conflicts:results.flatMap(r=>r.conflicts),pending:results.flatMap(r=>r.pending)};
}
