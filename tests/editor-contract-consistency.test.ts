import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,scryptSync} from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import type {FastifyInstance} from 'fastify';
import type {Requirement} from '../src/client/types';
import type {DependencyChanges,DependencyChangePreview} from '../src/shared/path-contracts';
import type {PathAnalysis} from '../src/shared/paths';
import {todayIso,addBusinessDays} from '../src/shared/domain';
import {mcpRequest} from './mcp-request';

import {draftNetwork} from '../src/client/dependency-draft';
import {copyEntities,deleteEntities} from '../src/client/editor-commands';
import {rebaseEditor} from '../src/client/editor-rebase';

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pm-editor-contract-'));
const password='isolated-editor-contract-password';
Object.assign(process.env,{DB_PATH:path.join(directory,'test.db'),BACKUP_DIR:path.join(directory,'backups'),WEB_DIST_DIR:path.join(directory,'web'),SEED_DEMO:'0',NODE_ENV:'test',APP_PASSWORD_HASH:`scrypt$contract$${scryptSync(password,'contract',64).toString('hex')}`,SESSION_SECRET:'isolated-editor-contract-secret-at-least-32'});
let app:FastifyInstance,cookie='',origin='',token='';
const request=(method:'GET'|'POST'|'PATCH',url:string,payload?:unknown)=>app.inject({method,url,headers:{cookie},payload:payload as Record<string,unknown>});
const get=async<T>(url:string)=>(await request('GET',url)).json<T>();
beforeAll(async()=>{
 app=await(await import('../src/server/app')).buildApp();await app.ready();
 const login=await request('POST','/api/login',{username:'admin',password});
 cookie=String(login.headers['set-cookie']).split(';')[0];
 origin=await app.listen({host:'127.0.0.1',port:0});
 token=(await request('POST','/api/tokens',{name:'契约回归'})).json().token;
});
afterAll(async()=>{await app.close();(await import('../src/server/database')).sqlite.close();fs.rmSync(directory,{recursive:true,force:true});});

async function fixture(_executionMode:'direct'|'work_items'){
 const project=(await request('POST','/api/projects',{name:'契约'+randomUUID()})).json();
 const person=await request('POST','/api/people',{projectId:project.id,name:'负责人'+randomUUID()});
 expect(person.statusCode,person.body).toBe(200);const owner=person.json();
 const response=await request('POST','/api/requirements',{projectId:project.id,title:'原需求',ownerId:owner.id});
 expect(response.statusCode,response.body).toBe(200);
 return {projectId:project.id as string,requirement:response.json<Requirement>(),ownerId:owner.id as string};
}
async function snapshot(){
 const {sqlite}=await import('../src/server/database');
 return ['requirements','work_items','milestones','diagram_layouts','delivery_commitments','dependency_edges','audit_logs','progress_updates','dependency_change_receipts'].map(table=>sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all());
}

for(const operation of ['work','milestone','delete-work','delete-milestone','reconnect'] as const){
 it(`模板生成元素在首次保存前可以 ${operation}，预览不写库且只实例化一次`,async()=>{
  const {projectId,ownerId}=await fixture('work_items');
  const t=await request('POST','/api/templates',{projectId,name:'首次保存流程',dependencyMode:'dependencies',items:[
   {clientKey:'a',title:'设计',durationDays:2,startOffsetDays:0,sortOrder:0,predecessorKeys:[]},
   {clientKey:'b',title:'开发',durationDays:3,startOffsetDays:2,sortOrder:1,predecessorKeys:['a']},
   {clientKey:'m',title:'交付',kind:'milestone',durationDays:0,startOffsetDays:5,sortOrder:2,predecessorKeys:['b']},
  ]});expect(t.statusCode,t.body).toBe(200);
  const id=randomUUID(),creation:DependencyChanges['entities']=[{entity:'requirement',op:'create',id,data:{title:'新模板需求',ownerId,templateId:t.json().id}}];
  const base=await preview(projectId,{entities:creation});expect(base.response.statusCode,base.response.body).toBe(200);
  const original=base.response.json<DependencyChangePreview>().analysis,a=original.nodes.find(n=>n.requirementId===id&&n.title==='设计')!,b=original.nodes.find(n=>n.requirementId===id&&n.title==='开发')!,m=original.nodes.find(n=>n.requirementId===id&&n.kind==='milestone')!;
  const changes:DependencyChanges={entities:[...creation],add:[],remove:[],estimates:[]};
  if(operation==='work')changes.entities!.push({entity:'work',op:'update',id:b.id,requirementId:id,expectedVersion:1,data:{title:'修改后的开发',ownerId,durationDays:4}});
  if(operation==='milestone')changes.entities!.push({entity:'milestone',op:'update',id:m.id,requirementId:id,expectedVersion:1,data:{title:'人工确认交付',confirmationMode:'manual'}});
  if(operation.startsWith('delete')){
   const node=operation==='delete-work'?b:m;
   changes.entities!.push({entity:node.kind==='work'?'work':'milestone',op:'delete',id:node.id,requirementId:id,expectedVersion:1,data:{}});
   changes.remove=original.dependencies.filter(d=>[d.sourceWorkItemId,d.targetWorkItemId,d.sourceMilestoneId,d.targetMilestoneId].includes(node.id)).map(d=>d.id);
  }
  if(operation==='reconnect'){
   changes.remove=[original.dependencies.find(d=>d.sourceWorkItemId===a.id&&d.targetWorkItemId===b.id)!.id];
   changes.add=[{clientId:randomUUID(),sourceRequirementId:id,sourceMilestoneId:m.id,sourceWorkItemId:null,targetRequirementId:id,targetWorkItemId:a.id}];
  }
  const before=await snapshot(),p=await preview(projectId,changes);expect(p.response.statusCode,p.response.body).toBe(200);expect(await snapshot()).toEqual(before);
  const formal=await get<PathAnalysis>('/api/projects/'+projectId+'/path-analysis'),instances=base.response.json<DependencyChangePreview>().templateInstances;
  const local=draftNetwork(formal,changes,instances),server=p.response.json<DependencyChangePreview>().analysis;
  const elements=(d:PathAnalysis)=>d.nodes.filter(n=>n.requirementId===id&&['work','milestone'].includes(n.kind)).map(n=>[n.id,n.title,n.estimate.durationDays]).sort();
  expect(elements(local)).toEqual(elements(server));
  expect(elements(draftNetwork(formal,{add:[],remove:[],estimates:[],entities:creation},instances))).toEqual(elements(original));
  const rebased=rebaseEditor(formal,{...formal,revision:formal.revision+1},changes);expect(rebased.pending).toEqual([]);expect(rebased.changes.remove).toEqual(changes.remove);
  const dropped=deleteEntities(local,{...changes,layouts:[{scope:'requirement:'+id,direction:'right',expectedVersion:0,positions:{[a.id]:{x:0,y:0}}}]},[id]);
  expect(dropped.entities).toEqual([]);expect(dropped.remove).toEqual([]);expect(dropped.layouts).toEqual([]);
  const body={...p.input,batchId:randomUUID(),previewToken:p.response.json().previewToken},saved=await request('POST','/api/projects/'+projectId+'/dependency-changes/apply',body);expect(saved.statusCode,saved.body).toBe(200);
  const mapped=saved.json().addedIds,r=await get<Requirement>('/api/requirements/'+mapped[id]),graph=await get<PathAnalysis>('/api/projects/'+projectId+'/path-analysis');
  expect(r.workItems).toHaveLength(operation==='delete-work'?1:2);
  expect(graph.milestones?.filter(x=>x.requirementId===r.id)).toHaveLength(operation==='delete-milestone'?0:1);
  if(operation==='work'){expect(r.workItems.find(w=>w.id===mapped[b.id])?.title).toBe('修改后的开发');expect(graph.nodes.find(n=>n.id===mapped[b.id])?.estimate.durationDays).toBe(4);}
  if(operation==='milestone')expect(graph.milestones?.find(x=>x.id===mapped[m.id])?.confirmationMode).toBe('manual');
  for(const edge of changes.remove)expect(graph.dependencies.some(d=>d.id===mapped[edge])).toBe(false);
  const after=await snapshot();expect((await request('POST','/api/projects/'+projectId+'/dependency-changes/apply',body)).json()).toEqual(saved.json());expect(await snapshot()).toEqual(after);
 });
}

it('模板修改不会改变已有需求版本，但必须使新实例的旧预览失效',async()=>{
 const {projectId,ownerId}=await fixture('work_items');
 const item={clientKey:'a',title:'模板工作',durationDays:2,startOffsetDays:0,sortOrder:0,predecessorKeys:[]};
 const t=(await request('POST','/api/templates',{projectId,name:'版本核对流程',dependencyMode:'dependencies',items:[item]})).json();
 const id=randomUUID(),entities:DependencyChanges['entities']=[{entity:'requirement',op:'create',id,data:{title:'待创建实例',ownerId,templateId:t.id}}],p=await preview(projectId,{entities});
 expect(p.response.statusCode,p.response.body).toBe(200);
 const changed=await request('PATCH','/api/templates/'+t.id,{expectedUpdatedAt:t.updatedAt,items:[{...item,durationDays:4}]});expect(changed.statusCode,changed.body).toBe(200);
 expect((await get<PathAnalysis>('/api/projects/'+projectId+'/path-analysis')).revision).toBe(p.input.expectedRevision);
 const before=await snapshot(),stale=await request('POST','/api/projects/'+projectId+'/dependency-changes/apply',{...p.input,batchId:randomUUID(),previewToken:p.response.json().previewToken});
 expect(stale.statusCode,stale.body).toBe(409);expect(stale.json().code).toBe('STALE_WRITE');expect(await snapshot()).toEqual(before);
 const fresh=await preview(projectId,{entities});expect(fresh.response.statusCode,fresh.response.body).toBe(200);
 expect(fresh.response.json<DependencyChangePreview>().analysis.nodes.find(n=>n.requirementId===id&&n.kind==='work')?.estimate.durationDays).toBe(4);
 const saved=await request('POST','/api/projects/'+projectId+'/dependency-changes/apply',{...fresh.input,batchId:randomUUID(),previewToken:fresh.response.json().previewToken});expect(saved.statusCode,saved.body).toBe(200);
});

for(const anchorKind of ['forward-work','acceptance','milestone'] as const)for(const estimatePatch of [false,true]){
 it(`同批次新对象的 ${anchorKind} 排期锚点在${estimatePatch?'估算':'属性'}保存后仍指向正式对象`,async()=>{
  const {projectId,ownerId}=await fixture('work_items');
  const r=randomUUID(),w=randomUUID(),next=randomUUID(),m=randomUUID();
  const anchor=anchorKind==='acceptance'?'acceptance:'+r:anchorKind==='milestone'?m:next;
  const fields={arrangement:'late' as const,arrangementAnchor:anchor};
  const changes:Partial<DependencyChanges>={entities:[
   {entity:'requirement',op:'create',id:r,data:{title:'新交付',ownerId}},
   {entity:'work',op:'create',id:w,requirementId:r,data:{title:'接口交付',ownerId,durationDays:1,...estimatePatch?{}:fields}},
   {entity:'work',op:'create',id:next,requirementId:r,data:{title:'文档整理',ownerId,durationDays:5}},
   {entity:'milestone',op:'create',id:m,requirementId:r,data:{title:'共同交付'}},
  ],add:[
   {clientId:randomUUID(),sourceRequirementId:r,sourceWorkItemId:w,targetRequirementId:r,...anchorKind==='forward-work'?{targetWorkItemId:next}:{targetWorkItemId:null,targetMilestoneId:m}},
   {clientId:randomUUID(),sourceRequirementId:r,sourceWorkItemId:next,targetRequirementId:r,targetWorkItemId:null,targetMilestoneId:m},
  ],estimates:estimatePatch?[{workItemId:w,...fields}]:[],layouts:[{scope:'requirement:'+r,direction:'right',expectedVersion:0,positions:{[w]:{x:20,y:30},['acceptance:'+r]:{x:400,y:30}}}]};
  const before=await snapshot(),{input,response}=await preview(projectId,changes);
  expect(response.statusCode,response.body).toBe(200);expect(await snapshot()).toEqual(before);
  const projected=response.json<DependencyChangePreview>(),body={...input,batchId:randomUUID(),previewToken:projected.previewToken};
  const saved=await request('POST','/api/projects/'+projectId+'/dependency-changes/apply',body);
  expect(saved.statusCode,saved.body).toBe(200);const ids=saved.json().addedIds;
  const formal=await request('GET','/api/projects/'+projectId+'/path-analysis');
  expect(formal.statusCode,formal.body).toBe(200);
  const graph=formal.json<PathAnalysis>(),node=graph.nodes.find(n=>n.id===ids[w])!,p=projected.analysis.nodes.find(n=>n.id===w)!;
  expect(node.arrangementAnchor).toBe(anchorKind==='acceptance'?'acceptance:'+ids[r]:ids[anchor]);
  expect([node.scheduledStart,node.scheduledEnd,node.scheduleBuffer]).toEqual([p.scheduledStart,p.scheduledEnd,p.scheduleBuffer]);
  expect(graph.layouts?.find(l=>l.scope==='requirement:'+ids[r])?.positions).toEqual({[ids[w]]:{x:20,y:30},['acceptance:'+ids[r]]:{x:400,y:30}});
  const persisted=await snapshot(),repeat=await request('POST','/api/projects/'+projectId+'/dependency-changes/apply',body);
  expect(repeat.json()).toEqual(saved.json());expect(await snapshot()).toEqual(persisted);
 });
}

it('已有后置工作改接交付点，同时修改需求、创建模板需求和直接需求，只分析最终网络',async()=>{
 const {projectId,requirement:r,ownerId}=await fixture('work_items');
 const w=randomUUID(),m=randomUUID(),edge=randomUUID();
 const initial=await preview(projectId,{entities:[
  {entity:'work',op:'create',id:w,requirementId:r.id,data:{title:'接口',ownerId,arrangement:'late',arrangementAnchor:m}},
  {entity:'milestone',op:'create',id:m,requirementId:r.id,data:{title:'旧交付点'}},
 ],add:[{clientId:edge,sourceRequirementId:r.id,sourceWorkItemId:w,targetRequirementId:r.id,targetWorkItemId:null,targetMilestoneId:m}]});
 expect(initial.response.statusCode,initial.response.body).toBe(200);
 const saved=await request('POST','/api/projects/'+projectId+'/dependency-changes/apply',{...initial.input,batchId:randomUUID(),previewToken:initial.response.json().previewToken});
 expect(saved.statusCode,saved.body).toBe(200);const ids=saved.json().addedIds;
 const templateResult=await request('POST','/api/templates',{projectId,name:'带里程碑的流程',dependencyMode:'dependencies',items:[
  {clientKey:'work',title:'流程工作',kind:'work',durationDays:2,startOffsetDays:0,sortOrder:0,predecessorKeys:[],arrangement:'late',arrangementAnchor:'milestone'},
  {clientKey:'milestone',title:'流程交付',kind:'milestone',durationDays:0,startOffsetDays:2,sortOrder:1,predecessorKeys:['work']},
 ]});expect(templateResult.statusCode,templateResult.body).toBe(200);const template=templateResult.json();
 const current=await get<Requirement>('/api/requirements/'+r.id),work=current.workItems[0],replacement=randomUUID(),direct=randomUUID(),fromTemplate=randomUUID();
 const before=await snapshot(),next=await preview(projectId,{remove:[ids[edge]],add:[{clientId:randomUUID(),sourceRequirementId:r.id,sourceWorkItemId:work.id,targetRequirementId:r.id,targetWorkItemId:null,targetMilestoneId:replacement}],entities:[
  {entity:'requirement',op:'update',id:r.id,expectedVersion:current.version,data:{background:'调整后的交付说明'}},
  {entity:'requirement',op:'create',id:direct,data:{title:'直接交付',ownerId,durationDays:2}},
  {entity:'requirement',op:'create',id:fromTemplate,data:{title:'流程交付需求',ownerId,templateId:template.id}},
  {entity:'work',op:'update',id:work.id,requirementId:r.id,expectedVersion:work.version,data:{title:'更新接口',arrangementAnchor:replacement}},
  {entity:'milestone',op:'delete',id:m,requirementId:r.id,expectedVersion:1,data:{}},
  {entity:'milestone',op:'create',id:replacement,requirementId:r.id,data:{title:'新交付点'}},
 ]});
 expect(next.response.statusCode,next.response.body).toBe(200);expect(await snapshot()).toEqual(before);
 const committed=await request('POST','/api/projects/'+projectId+'/dependency-changes/apply',{...next.input,batchId:randomUUID(),previewToken:next.response.json().previewToken});
 expect(committed.statusCode,committed.body).toBe(200);const mapped=committed.json().addedIds;
 const formal=await request('GET','/api/projects/'+projectId+'/path-analysis');expect(formal.statusCode,formal.body).toBe(200);const graph=formal.json<PathAnalysis>();
 expect(graph.nodes.find(n=>n.id===work.id)?.arrangementAnchor).toBe(replacement);expect(graph.nodes.some(n=>n.id===m)).toBe(false);
 const templateWorkId=fromTemplate+':template:'+template.items.find((i:{kind:string})=>i.kind==='work').id;
 const templateMilestoneId=fromTemplate+':template:'+template.items.find((i:{kind:string})=>i.kind==='milestone').id;
 expect(graph.nodes.find(n=>n.id===mapped[templateWorkId])?.arrangementAnchor).toBe(mapped[templateMilestoneId]);
 expect(graph.requirements.find(n=>n.id===mapped[direct])?.executionMode).toBe('direct');
 expect((await get<Requirement>('/api/requirements/'+r.id)).background).toBe('调整后的交付说明');
});

it('批次写入后的最终网络校验失败时，实体、估算、审计与回执全部回滚',async()=>{
 const {projectId,requirement:r,ownerId}=await fixture('work_items'),w=randomUUID(),m=randomUUID();
 const before=await snapshot(),p=await preview(projectId,{entities:[
  {entity:'work',op:'create',id:w,requirementId:r.id,data:{title:'待校验工作',ownerId,arrangement:'late',arrangementAnchor:m}},
  {entity:'milestone',op:'create',id:m,requirementId:r.id,data:{title:'交付点'}},
 ],add:[{clientId:randomUUID(),sourceRequirementId:r.id,sourceWorkItemId:w,targetRequirementId:r.id,targetWorkItemId:null,targetMilestoneId:m}]});
 expect(p.response.statusCode,p.response.body).toBe(200);
 const {sqlite}=await import('../src/server/database');
 // Simulate a persistence defect after relation insertion; success must not be acknowledged.
 sqlite.exec("CREATE TEMP TRIGGER corrupt_saved_anchor AFTER INSERT ON dependency_edges BEGIN UPDATE work_items SET arrangement_anchor='invalid-saved-anchor' WHERE id=NEW.source_work_item_id; END");
 try{
  const result=await request('POST','/api/projects/'+projectId+'/dependency-changes/apply',{...p.input,batchId:randomUUID(),previewToken:p.response.json().previewToken});
  expect(result.statusCode,result.body).toBe(409);expect(result.json().code).toBe('DEPENDENCY_CONFLICT');
  expect(await snapshot()).toEqual(before);
 }finally{sqlite.exec('DROP TRIGGER corrupt_saved_anchor');}
});

it('预览后创建对象的负责人失效，不能绕过成员校验写入部分批次',async()=>{
 const {projectId,requirement:r,ownerId}=await fixture('work_items'),id=randomUUID();
 const p=await preview(projectId,{entities:[{entity:'work',op:'create',id,requirementId:r.id,data:{title:'等待保存',ownerId,durationDays:2}}]});
 expect(p.response.statusCode,p.response.body).toBe(200);
 const {sqlite}=await import('../src/server/database');sqlite.prepare('UPDATE people SET active=0 WHERE id=?').run(ownerId);
 const before=await snapshot(),result=await request('POST','/api/projects/'+projectId+'/dependency-changes/apply',{...p.input,batchId:randomUUID(),previewToken:p.response.json().previewToken});
 expect(result.statusCode,result.body).not.toBe(200);expect(await snapshot()).toEqual(before);
});
async function preview(projectId:string,changes:Partial<DependencyChanges>){
 const analysis=await get<PathAnalysis>('/api/projects/'+projectId+'/path-analysis');
 const input={expectedRevision:analysis.revision,target:'project',changes:{add:[],remove:[],estimates:[],...changes}};
 return {input,response:await request('POST','/api/projects/'+projectId+'/dependency-changes/preview',input)};
}

for(const mode of ['direct','work_items'] as const){
 it(`${mode} 普通修改拒绝排期和执行字段，不能静默忽略后保存其他字段`,async()=>{
  const {requirement:r}=await fixture(mode);
  for(const field of [{plannedStart:addBusinessDays(todayIso(),3)},{progress:75},{status:'completed'},{templateId:randomUUID()},{unknownField:'ignored'}]){
   const before=await snapshot();
   const result=await request('PATCH','/api/requirements/'+r.id,{expectedVersion:r.version,title:'不应保存',deliveryScope:'committed',...field});
   expect.soft(result.statusCode,result.body).toBe(400);
   expect.soft(await snapshot()).toEqual(before);
  }
 });
 it(`${mode} 批量预览拒绝普通编辑中的排期字段，正式数据与回执均不变化`,async()=>{
  const {projectId,requirement:r}=await fixture(mode),before=await snapshot();
  const {response}=await preview(projectId,{entities:[{entity:'requirement',op:'update',id:r.id,expectedVersion:r.version,data:{title:'不应通过预览',deliveryScope:'committed',plannedEnd:addBusinessDays(todayIso(),4)}}]});
  expect(response.statusCode,response.body).toBe(400);expect(await snapshot()).toEqual(before);
 });
}
it('工作项预览拒绝只属于需求的属性，不把保存阶段才失败的批次交给用户',async()=>{
 const {projectId,requirement:r,ownerId}=await fixture('work_items');
 const result=await request('POST','/api/requirements/'+r.id+'/work-items',{expectedVersion:r.version,title:'执行',ownerId});
 expect(result.statusCode,result.body).toBe(200);
 const w=(await get<Requirement>('/api/requirements/'+r.id)).workItems[0],before=await snapshot();
 const {response}=await preview(projectId,{entities:[{entity:'work',op:'update',id:w.id,requirementId:r.id,expectedVersion:w.version,data:{title:'不应通过',priority:'P0'}}]});
 expect(response.statusCode,response.body).toBe(400);expect(await snapshot()).toEqual(before);
});
it('合法的需求与工作项混合修改仍整批保存，预览与正式结果一致',async()=>{
 const {projectId,requirement:r,ownerId}=await fixture('work_items');
 await request('POST','/api/requirements/'+r.id+'/work-items',{expectedVersion:r.version,title:'执行',ownerId});
 const current=await get<Requirement>('/api/requirements/'+r.id),w=current.workItems[0];
 const {input,response}=await preview(projectId,{entities:[
  {entity:'requirement',op:'update',id:r.id,expectedVersion:current.version,data:{title:'新名称',background:'原始需求说明'}},
  {entity:'work',op:'update',id:w.id,requirementId:r.id,expectedVersion:w.version,data:{title:'新工作项',durationDays:3}},
 ]});
 expect(response.statusCode,response.body).toBe(200);
 const p=response.json<DependencyChangePreview>();
 const saved=await request('POST','/api/projects/'+projectId+'/dependency-changes/apply',{...input,batchId:randomUUID(),previewToken:p.previewToken});
 expect(saved.statusCode,saved.body).toBe(200);
 const after=await get<Requirement>('/api/requirements/'+r.id);
 expect(after.title).toBe(p.analysis.requirements.find(n=>n.id===r.id)!.title);
 expect(after.workItems[0].title).toBe(p.analysis.nodes.find(n=>n.id===w.id)!.title);
 expect(after.workItems[0].durationDays).toBe(3);
});
it('MCP 与 REST 一样拒绝普通编辑夹带执行字段，整个请求不写入',async()=>{
 const {requirement:r}=await fixture('direct'),before=await snapshot();
 const response=await mcpRequest(origin,token,'update_requirement',{id:r.id,expectedVersion:r.version,title:'不应保存',progress:99});
 expect(response.statusCode).toBe(200);
 const body=JSON.parse(response.body);
 expect(body.result?.isError||!!body.error).toBe(true);
 expect(await snapshot()).toEqual(before);
});
it('现有需求中新建工作项并修改预计工期可以一次预览保存，回执映射真实对象',async()=>{
 const {projectId,requirement:r,ownerId}=await fixture('work_items'),id=randomUUID(),before=await snapshot();
 const {input,response}=await preview(projectId,{entities:[{entity:'work',op:'create',id,requirementId:r.id,data:{title:'新增并核对',ownerId,durationDays:3}}],estimates:[{workItemId:id,durationDays:2}]});
 expect(response.statusCode,response.body).toBe(200);expect(await snapshot()).toEqual(before);
 const p=response.json<DependencyChangePreview>(),batchId=randomUUID();
 const payload={...input,batchId,previewToken:p.previewToken};
 const result=await request('POST','/api/projects/'+projectId+'/dependency-changes/apply',payload);
 expect(result.statusCode,result.body).toBe(200);
 const createdId=result.json().addedIds[id],after=await get<Requirement>('/api/requirements/'+r.id);
 expect(after.workItems).toHaveLength(1);expect(after.workItems[0].id).toBe(createdId);
 const formal=(await get<PathAnalysis>('/api/projects/'+projectId+'/path-analysis')).nodes.find(n=>n.id===createdId)!;
 const predicted=p.analysis.nodes.find(n=>n.id===id)!;
 expect(formal.forecastEnd,JSON.stringify({reasons:formal.unknownReasons,basis:formal.forecastBasis})).toBe(predicted.forecastEnd);
 expect(formal.estimate.durationDays).toBe(2);
 expect(formal.forecastBasis?.reasons).not.toContain('前置交付条件已变化，请重新核对');
 const stored=await snapshot();
 expect((await request('POST','/api/projects/'+projectId+'/dependency-changes/apply',payload)).json()).toEqual(result.json());
 expect(await snapshot()).toEqual(stored);
});
it('新增独立工作项保留已核对关系；历史核对记录不增加操作门槛',async()=>{
 const {sqlite}=await import('../src/server/database');
 for(const legacy of [false,true]){
  const {projectId,requirement:r,ownerId}=await fixture('work_items');
  if(legacy)sqlite.prepare('UPDATE requirements SET dependencies_reviewed_at=NULL WHERE id=?').run(r.id);
  const before=await get<PathAnalysis>('/api/projects/'+projectId+'/path-analysis');
  const reviewed=before.requirements.find(n=>n.id===r.id)!.dependenciesReviewedAt;
  const response=await request('POST','/api/requirements/'+r.id+'/work-items',{expectedVersion:r.version,title:'独立工作',ownerId});
  expect(response.statusCode,response.body).toBe(200);
  const after=await get<PathAnalysis>('/api/projects/'+projectId+'/path-analysis');
  expect(after.requirements.find(n=>n.id===r.id)!.dependenciesReviewedAt).toBe(reviewed);
  expect(after.dependencies).toEqual(before.dependencies);
  expect(after.nodes.find(n=>n.kind==='work')!.unknownReasons.includes('依赖尚未核对')).toBe(false);
 }
});
it('新对象估算沿用需求负责人的创建权限，普通成员不能靠给自己分配工作项越权',async()=>{
 const {projectId,requirement:r,ownerId}=await fixture('work_items');
 const member=(await request('POST','/api/people',{projectId,name:'普通成员'+randomUUID()})).json();
 const accounts=await get<Array<{personId:string;username:string}>>('/api/accounts');
 const loginAs=async(personId:string)=>{
  const login=await app.inject({method:'POST',url:'/api/login',payload:{username:accounts.find(a=>a.personId===personId)!.username,password:'888888'}});
  expect(login.statusCode,login.body).toBe(200);
  const reset=await app.inject({method:'POST',url:'/api/account/change-password',headers:{cookie:String(login.headers['set-cookie']).split(';')[0]},payload:{currentPassword:'888888',newPassword:'Contract-access-password!42'}});
  expect(reset.statusCode,reset.body).toBe(200);return String(reset.headers['set-cookie']).split(';')[0];
 };
 const ownerCookie=await loginAs(ownerId),memberCookie=await loginAs(member.id),id=randomUUID();
 const {input}=await preview(projectId,{entities:[{entity:'work',op:'create',id,requirementId:r.id,data:{title:'待保存工作',ownerId:member.id,durationDays:2}}],estimates:[{workItemId:id,durationDays:2}]});
 const before=await snapshot();
 const denied=await app.inject({method:'POST',url:'/api/projects/'+projectId+'/dependency-changes/preview',headers:{cookie:memberCookie},payload:input});
 expect(denied.statusCode,denied.body).toBe(403);expect(await snapshot()).toEqual(before);
 const allowed=await app.inject({method:'POST',url:'/api/projects/'+projectId+'/dependency-changes/preview',headers:{cookie:ownerCookie},payload:input});
 expect(allowed.statusCode,allowed.body).toBe(200);expect(await snapshot()).toEqual(before);
 const saved=await app.inject({method:'POST',url:'/api/projects/'+projectId+'/dependency-changes/apply',headers:{cookie:ownerCookie},payload:{...input,batchId:randomUUID(),previewToken:allowed.json().previewToken}});
 expect(saved.statusCode,saved.body).toBe(200);
 expect((await get<Requirement>('/api/requirements/'+r.id)).workItems[0].ownerId).toBe(member.id);
});
for(const durationDays of [undefined,null,4]){
 it(`画布新工作项工期 ${String(durationDays)} 在预览、保存和重读后相同`,async()=>{
  const {projectId,requirement:r,ownerId}=await fixture('work_items'),id=randomUUID();
  const {input,response}=await preview(projectId,{entities:[{entity:'work',op:'create',id,requirementId:r.id,data:{title:'默认工期',ownerId,...durationDays===undefined?{}:{durationDays}}}]});
  expect(response.statusCode,response.body).toBe(200);const p=response.json<DependencyChangePreview>();
  const projected=p.analysis.nodes.find(n=>n.id===id)!;
  const local=draftNetwork(await get<PathAnalysis>('/api/projects/'+projectId+'/path-analysis'),input.changes);
  expect.soft(local.nodes.find(n=>n.id===id)!.estimate.durationDays).toBe(projected.estimate.durationDays);
  expect(projected.estimate.durationDays).toBe(durationDays===undefined?1:durationDays);
  const result=await request('POST','/api/projects/'+projectId+'/dependency-changes/apply',{...input,batchId:randomUUID(),previewToken:p.previewToken});
  expect(result.statusCode,result.body).toBe(200);const realId=result.json().addedIds[id];
  const after=await get<Requirement>('/api/requirements/'+r.id);
  const formal=(await get<PathAnalysis>('/api/projects/'+projectId+'/path-analysis')).nodes.find(n=>n.id===realId)!;
  expect(after.workItems[0].durationDays).toBe(projected.estimate.durationDays);
  expect(formal.estimate).toEqual(projected.estimate);expect(formal.forecastEnd).toBe(projected.forecastEnd);
  expect(formal.unknownReasons).toEqual(projected.unknownReasons);
 });
}
for(const mode of ['direct','work_items'] as const)for(const acceptanceCriteria of ['  验证通过  ','   ','第一行\r\n第二行']){
 it(`${mode} 完成标准 ${JSON.stringify(acceptanceCriteria)} 在预览和正式需求中一致`,async()=>{
  const {projectId,requirement:r}=await fixture(mode);
  const {input,response}=await preview(projectId,{entities:[{entity:'requirement',op:'update',id:r.id,expectedVersion:r.version,data:{acceptanceCriteria,background:'  新背景  ',referenceUrl:' https://example.com/spec '} }]});
  expect(response.statusCode,response.body).toBe(200);const p=response.json<DependencyChangePreview>();
  const saved=await request('POST','/api/projects/'+projectId+'/dependency-changes/apply',{...input,batchId:randomUUID(),previewToken:p.previewToken});
  expect(saved.statusCode,saved.body).toBe(200);
  const actual=await get<Requirement>('/api/requirements/'+r.id);
  const projected=p.analysis.requirements.find(n=>n.id===r.id)!;
  expect.soft(projected.acceptanceCriteria).toBe(actual.acceptanceCriteria);
  expect.soft(projected.background).toBe(actual.background);expect.soft(projected.referenceUrl).toBe(actual.referenceUrl);
 });
}
it('同一工作项的结构和估算修改按最终快照保存，不回退新工期',async()=>{
 const {projectId,requirement:r,ownerId}=await fixture('work_items'),id=randomUUID();
 const {input,response}=await preview(projectId,{entities:[{entity:'work',op:'create',id,requirementId:r.id,data:{title:'多次编辑',ownerId,durationDays:2}}],estimates:[{workItemId:id,durationDays:4}]});
 expect(response.statusCode,response.body).toBe(200);const p=response.json<DependencyChangePreview>();
 expect(p.analysis.nodes.find(n=>n.id===id)!.estimate.durationDays).toBe(4);
 const local=draftNetwork(await get<PathAnalysis>('/api/projects/'+projectId+'/path-analysis'),input.changes);
 expect.soft(local.nodes.find(n=>n.id===id)!.estimate.durationDays).toBe(4);
 const saved=await request('POST','/api/projects/'+projectId+'/dependency-changes/apply',{...input,batchId:randomUUID(),previewToken:p.previewToken});
 expect(saved.statusCode,saved.body).toBe(200);expect((await get<Requirement>('/api/requirements/'+r.id)).workItems[0].durationDays).toBe(4);
});
it('复制工期未确认的工作项保留未知工期，不凭空生成一天的承诺',async()=>{
 const {projectId,requirement:r,ownerId}=await fixture('work_items');
 await request('POST','/api/requirements/'+r.id+'/work-items',{expectedVersion:r.version,title:'工期待确认',ownerId});
 const analysis=await get<PathAnalysis>('/api/projects/'+projectId+'/path-analysis'),work=analysis.nodes.find(n=>n.kind==='work')!;
 expect(work.estimate.durationDays).toBeNull();
 const copied=copyEntities(analysis,{add:[],remove:[],estimates:[]},[work.id],r.id);
 expect(copied.changes.entities!.find(c=>c.id===copied.mapping[work.id])!.data.durationDays).toBeNull();
});
it('本地草稿修改直接执行需求时，不改写正式分析基线，放弃后可恢复原节点',async()=>{
 const {projectId,requirement:r}=await fixture('direct');
 const analysis=await get<PathAnalysis>('/api/projects/'+projectId+'/path-analysis'),baseline=structuredClone(analysis);
 const changed=draftNetwork(analysis,{add:[],remove:[],estimates:[],entities:[{entity:'requirement',op:'update',id:r.id,expectedVersion:r.version,data:{title:'仅草稿名称'}}]});
 expect(changed.nodes.find(n=>n.id==='execute:'+r.id)!.title).toBe('仅草稿名称');
 expect(analysis).toEqual(baseline);
 expect(draftNetwork(analysis,{add:[],remove:[],estimates:[]}).nodes.find(n=>n.id==='execute:'+r.id)!.title).toBe(r.title);
});
for(const durationDays of [null,4])it(`直接执行需求工期 ${durationDays} 同步到本地执行节点`,async()=>{
 const {projectId,requirement:r}=await fixture('direct');
 const analysis=await get<PathAnalysis>('/api/projects/'+projectId+'/path-analysis');
 const {input,response}=await preview(projectId,{entities:[{entity:'requirement',op:'update',id:r.id,expectedVersion:r.version,data:{durationDays}}]});
 expect(response.statusCode,response.body).toBe(200);
 const local=draftNetwork(analysis,input.changes),server=response.json<DependencyChangePreview>().analysis;
 expect(local.nodes.find(n=>n.id==='execute:'+r.id)!.estimate).toEqual(server.nodes.find(n=>n.id==='execute:'+r.id)!.estimate);
});
for(const mode of ['direct','work_items'] as const)it(`${mode} 修改负责人，预览责任信息与保存后相同`,async()=>{
 const {projectId,requirement:r}=await fixture(mode);
 const person=(await request('POST','/api/people',{projectId,name:'接手人'+randomUUID()})).json();
 const before=await snapshot(),{input,response}=await preview(projectId,{entities:[{entity:'requirement',op:'update',id:r.id,expectedVersion:r.version,data:{ownerId:person.id}}]});
 expect(response.statusCode,response.body).toBe(200);expect(await snapshot()).toEqual(before);const p=response.json<DependencyChangePreview>();
 const saved=await request('POST','/api/projects/'+projectId+'/dependency-changes/apply',{...input,batchId:randomUUID(),previewToken:p.previewToken});expect(saved.statusCode,saved.body).toBe(200);
 const formal=(await get<PathAnalysis>('/api/projects/'+projectId+'/path-analysis')).requirements.find(n=>n.id===r.id)!,projected=p.analysis.requirements.find(n=>n.id===r.id)!;
 for(const key of ['ownerId','ownerName','ownerValid'] as const)expect.soft(projected[key],key).toEqual(formal[key]);
 expect(p.differences.impact?.find(i=>i.requirementId===r.id)?.ownerName).toBe(person.name);
});
for(const operation of ['change-owner','replace-assignees','clear-assignees','create'] as const)it(`工作项 ${operation} 的参与人、需求汇总与保存后相同`,async()=>{
 const {projectId,requirement:r,ownerId}=await fixture('work_items');
 const person=(await request('POST','/api/people',{projectId,name:'参与人'+randomUUID()})).json();
 const work=(await request('POST','/api/requirements/'+r.id+'/work-items',{expectedVersion:r.version,title:'参与人验证',ownerId,assigneeIds:[person.id]})).json();
 const id=operation==='create'?randomUUID():work.id;
 const data=operation==='change-owner'?{ownerId:person.id}:operation==='clear-assignees'?{assigneeIds:[]}:operation==='replace-assignees'?{assigneeIds:[person.id,ownerId,person.id]}:{title:'新增参与人',ownerId,assigneeIds:[person.id]};
 const {input,response}=await preview(projectId,{entities:[{entity:'work',op:operation==='create'?'create':'update',id,requirementId:r.id,expectedVersion:operation==='create'?undefined:work.version,data}]});
 expect(response.statusCode,response.body).toBe(200);const p=response.json<DependencyChangePreview>();
 const saved=await request('POST','/api/projects/'+projectId+'/dependency-changes/apply',{...input,batchId:randomUUID(),previewToken:p.previewToken});expect(saved.statusCode,saved.body).toBe(200);
 const formal=await get<PathAnalysis>('/api/projects/'+projectId+'/path-analysis'),realId=saved.json().addedIds[id]||id;
 const assigned=(n:{assigneeIds?:string[];assigneeNames?:string[]})=>n.assigneeIds?.map((id,i)=>[id,n.assigneeNames?.[i]]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
 const pn=p.analysis.nodes.find(n=>n.id===id)!,fn=formal.nodes.find(n=>n.id===realId)!;
 expect.soft(pn.ownerName).toBe(fn.ownerName);expect.soft(assigned(pn)).toEqual(assigned(fn));
 expect(assigned(p.analysis.requirements.find(n=>n.id===r.id)!)).toEqual(assigned(formal.requirements.find(n=>n.id===r.id)!));
});
for(const entity of ['requirement','work'] as const)it(`进行中${entity}交接负责人后，预览与正式数据一致`,async()=>{
 const {projectId,requirement:r,ownerId}=await fixture(entity==='work'?'work_items':'direct');
 const base=entity==='work'?(await request('POST','/api/requirements/'+r.id+'/work-items',{expectedVersion:r.version,title:'待交接工作',ownerId})).json():r;
 const path=(entity==='work'?'/api/work-items/':'/api/requirements/')+base.id;
 const started=await request('POST',path+'/start',{expectedVersion:base.version});expect(started.statusCode,started.body).toBe(200);

 const afterBlock=await get<Requirement>('/api/requirements/'+r.id),work=entity==='work'?afterBlock.workItems.find(w=>w.id===base.id)!:afterBlock;
 const person=(await request('POST','/api/people',{projectId,name:'交接协调'+randomUUID()})).json();
 const {input,response}=await preview(projectId,{entities:[{entity,op:'update',id:base.id,requirementId:entity==='work'?r.id:undefined,expectedVersion:work.version,data:{ownerId:person.id,reason:'负责人交接'}}]});expect(response.statusCode,response.body).toBe(200);
 const p=response.json<DependencyChangePreview>(),nodeId=entity==='work'?base.id:'execute:'+r.id;
 expect(p.analysis.nodes.find(n=>n.id===nodeId)?.ownerId).toBe(person.id);
 const saved=await request('POST','/api/projects/'+projectId+'/dependency-changes/apply',{...input,batchId:randomUUID(),previewToken:p.previewToken});expect(saved.statusCode,saved.body).toBe(200);
 const formal=await get<PathAnalysis>('/api/projects/'+projectId+'/path-analysis');expect(formal.nodes.find(n=>n.id===nodeId)?.blockerCoordination).toEqual(p.analysis.nodes.find(n=>n.id===nodeId)?.blockerCoordination);
 expect(formal.nodes.find(n=>n.id===nodeId)).toMatchObject({ownerId:person.id,status:'in_progress'});
});
