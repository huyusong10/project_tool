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
import type {DeliveryCommitment} from '../src/shared/commitments';
import {draftNetwork} from '../src/client/dependency-draft';
import {copyEntities} from '../src/client/editor-commands';

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

async function fixture(executionMode:'direct'|'work_items'){
 const project=(await request('POST','/api/projects',{name:'契约'+randomUUID()})).json();
 const person=await request('POST','/api/people',{projectId:project.id,name:'负责人'+randomUUID()});
 expect(person.statusCode,person.body).toBe(200);const owner=person.json();
 const response=await request('POST','/api/requirements',{projectId:project.id,title:'原需求',ownerId:owner.id,executionMode});
 expect(response.statusCode,response.body).toBe(200);
 return {projectId:project.id as string,requirement:response.json<Requirement>(),ownerId:owner.id as string};
}
async function snapshot(){
 const {sqlite}=await import('../src/server/database');
 return ['requirements','work_items','dependency_edges','audit_logs','progress_updates','dependency_change_receipts'].map(table=>sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all());
}
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
  {entity:'requirement',op:'update',id:r.id,expectedVersion:current.version,data:{title:'新名称',deliveryScope:'committed'}},
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
it('现有需求中新建工作项并核对预计工期可以一次预览保存，回执映射真实对象',async()=>{
 const {projectId,requirement:r,ownerId}=await fixture('work_items'),id=randomUUID(),before=await snapshot();
 const {input,response}=await preview(projectId,{entities:[{entity:'work',op:'create',id,requirementId:r.id,data:{title:'新增并核对',ownerId,durationDays:3}}],estimates:[{workItemId:id,reviewForecast:{remainingDays:2}}]});
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
 expect(formal.forecastBasis?.review?.remainingDays).toBe(2);
 expect(formal.forecastBasis?.reasons).not.toContain('前置交付条件已变化，请重新核对');
 const stored=await snapshot();
 expect((await request('POST','/api/projects/'+projectId+'/dependency-changes/apply',payload)).json()).toEqual(result.json());
 expect(await snapshot()).toEqual(stored);
});
it('新增独立工作项保留已核对关系；历史未核对范围不会被自动确认',async()=>{
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
  expect(after.nodes.find(n=>n.kind==='work')!.unknownReasons.includes('依赖尚未核对')).toBe(legacy);
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
 const {input}=await preview(projectId,{entities:[{entity:'work',op:'create',id,requirementId:r.id,data:{title:'待保存工作',ownerId:member.id,durationDays:2}}],estimates:[{workItemId:id,reviewForecast:{remainingDays:2}}]});
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
 it(`${mode} 验收文字 ${JSON.stringify(acceptanceCriteria)} 在预览、承诺和正式需求中一致`,async()=>{
  const {projectId,requirement:r}=await fixture(mode);
  const {input,response}=await preview(projectId,{entities:[{entity:'requirement',op:'update',id:r.id,expectedVersion:r.version,data:{acceptanceCriteria,background:'  新背景  ',referenceUrl:' https://example.com/spec '} }],commitment:{reason:''}});
  expect(response.statusCode,response.body).toBe(200);const p=response.json<DependencyChangePreview>();
  const saved=await request('POST','/api/projects/'+projectId+'/dependency-changes/apply',{...input,batchId:randomUUID(),previewToken:p.previewToken});
  expect(saved.statusCode,saved.body).toBe(200);
  const actual=await get<Requirement>('/api/requirements/'+r.id);
  const history=await get<DeliveryCommitment[]>('/api/projects/'+projectId+'/delivery-commitments');
  const projected=p.analysis.requirements.find(n=>n.id===r.id)!;
  expect.soft(history[0].items.find(n=>n.id===r.id)!.acceptanceCriteria).toBe(actual.acceptanceCriteria);
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
for(const mode of ['direct','work_items'] as const)it(`${mode} 修改负责人和验收人，预览责任信息与保存后相同`,async()=>{
 const {projectId,requirement:r}=await fixture(mode);
 const person=(await request('POST','/api/people',{projectId,name:'接手人'+randomUUID()})).json();
 const before=await snapshot(),{input,response}=await preview(projectId,{entities:[{entity:'requirement',op:'update',id:r.id,expectedVersion:r.version,data:{ownerId:person.id,acceptanceOwnerId:person.id}}]});
 expect(response.statusCode,response.body).toBe(200);expect(await snapshot()).toEqual(before);const p=response.json<DependencyChangePreview>();
 const saved=await request('POST','/api/projects/'+projectId+'/dependency-changes/apply',{...input,batchId:randomUUID(),previewToken:p.previewToken});expect(saved.statusCode,saved.body).toBe(200);
 const formal=(await get<PathAnalysis>('/api/projects/'+projectId+'/path-analysis')).requirements.find(n=>n.id===r.id)!,projected=p.analysis.requirements.find(n=>n.id===r.id)!;
 for(const key of ['ownerId','ownerName','ownerValid','acceptanceOwnerId','acceptanceOwnerName','acceptanceOwnerValid'] as const)expect.soft(projected[key],key).toEqual(formal[key]);
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
for(const entity of ['requirement','work'] as const)it(`阻塞${entity}交接负责人后，预览协调人与正式行动一致`,async()=>{
 const {projectId,requirement:r,ownerId}=await fixture(entity==='work'?'work_items':'direct');
 const base=entity==='work'?(await request('POST','/api/requirements/'+r.id+'/work-items',{expectedVersion:r.version,title:'待交接工作',ownerId})).json():r;
 const path=(entity==='work'?'/api/work-items/':'/api/requirements/')+base.id;
 const started=await request('POST',path+'/start',{expectedVersion:base.version});expect(started.statusCode,started.body).toBe(200);
 const detail=await get<Requirement>('/api/requirements/'+r.id),current=entity==='work'?detail.workItems.find(w=>w.id===base.id)!:detail;
 const blocked=await request('POST',path+'/block',{expectedVersion:current.version,reason:'环境未就绪'});expect(blocked.statusCode,blocked.body).toBe(200);
 const afterBlock=await get<Requirement>('/api/requirements/'+r.id),work=entity==='work'?afterBlock.workItems.find(w=>w.id===base.id)!:afterBlock;
 const person=(await request('POST','/api/people',{projectId,name:'交接协调'+randomUUID()})).json();
 const {input,response}=await preview(projectId,{entities:[{entity,op:'update',id:base.id,requirementId:entity==='work'?r.id:undefined,expectedVersion:work.version,data:{ownerId:person.id,reason:'负责人交接'}}]});expect(response.statusCode,response.body).toBe(200);
 const p=response.json<DependencyChangePreview>(),nodeId=entity==='work'?base.id:'execute:'+r.id;
 expect(p.analysis.nodes.find(n=>n.id===nodeId)?.blockerCoordination?.coordinatorId).toBe(person.id);
 const saved=await request('POST','/api/projects/'+projectId+'/dependency-changes/apply',{...input,batchId:randomUUID(),previewToken:p.previewToken});expect(saved.statusCode,saved.body).toBe(200);
 const formal=await get<PathAnalysis>('/api/projects/'+projectId+'/path-analysis');expect(formal.nodes.find(n=>n.id===nodeId)?.blockerCoordination).toEqual(p.analysis.nodes.find(n=>n.id===nodeId)?.blockerCoordination);
 const actions=await get<{items:Array<{sourceId:string;ownerId:string|null}>}>('/api/action-items?projectId='+projectId);expect(actions.items.find(i=>i.sourceId===base.id)?.ownerId).toBe(person.id);
});
