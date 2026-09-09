import {mcpRequest} from './mcp-request';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,scryptSync} from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import type {FastifyInstance} from 'fastify';
import type {PathAnalysis} from '../src/shared/paths';
import type {Requirement} from '../src/client/types';
import type {DeliveryCommitment} from '../src/shared/commitments';
import {requirementCommitments} from '../src/shared/commitments';
import {todayIso,addBusinessDays} from '../src/shared/domain';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pm-commitment-')),password='commitment-test-password';
Object.assign(process.env,{DB_PATH:path.join(directory,'test.db'),BACKUP_DIR:path.join(directory,'backups'),WEB_DIST_DIR:path.join(directory,'web'),SEED_DEMO:'0',NODE_ENV:'test',APP_PASSWORD_HASH:`scrypt$commitment$${scryptSync(password,'commitment',64).toString('hex')}`,SESSION_SECRET:'commitment-isolated-secret-at-least-thirty-two-characters'});
let app:FastifyInstance,cookie='';
const request=(method:'GET'|'POST'|'PATCH',url:string,payload?:unknown)=>app.inject({method,url,headers:{cookie},payload:payload as Record<string,unknown>});
const post=(url:string,payload:unknown)=>request('POST',url,payload);
const get=async<T>(url:string)=>(await request('GET',url)).json<T>();
beforeAll(async()=>{app=await(await import('../src/server/app')).buildApp();await app.ready();const response=await post('/api/login',{username:'admin',password});cookie=String(response.headers['set-cookie']).split(';')[0];});
afterAll(async()=>{await app.close();(await import('../src/server/database')).sqlite.close();fs.rmSync(directory,{recursive:true,force:true});});
async function fixture(){
  const project=(await post('/api/projects',{name:'承诺'+randomUUID()})).json();
  const owner=(await post('/api/people',{projectId:project.id,name:'负责人'+randomUUID()})).json();
  const r=(await post('/api/requirements',{projectId:project.id,ownerId:owner.id,title:'交付接口',executionMode:'direct',plannedStart:todayIso(),durationDays:3})).json<Requirement>();
  return {projectId:project.id as string,r,owner};
}
async function batch(projectId:string,changes:Record<string,unknown>){
  const a=await get<PathAnalysis>('/api/projects/'+projectId+'/path-analysis');
  const input={expectedRevision:a.revision,target:'project',changes:{add:[],remove:[],estimates:[],...changes}};
  const preview=await post('/api/projects/'+projectId+'/dependency-changes/preview',input);
  return {input,preview,body:{...input,batchId:randomUUID(),previewToken:preview.json().previewToken}};
}
it('承诺预览不写库，整批保存包含修改后标准，重复请求只产生一个快照',async()=>{
  const {projectId,r}=await fixture();
  const {preview,body}=await batch(projectId,{commitment:{reason:''},entities:[{entity:'requirement',op:'update',id:r.id,expectedVersion:r.version,data:{acceptanceCriteria:'接口验证通过'}}]});
  expect(preview.statusCode,preview.body).toBe(200);
  expect(await get('/api/projects/'+projectId+'/delivery-commitments')).toEqual([]);
  expect((await get<Requirement>('/api/requirements/'+r.id)).acceptanceCriteria).not.toBe('接口验证通过');
  const saved=await post('/api/projects/'+projectId+'/dependency-changes/apply',body);expect(saved.statusCode,saved.body).toBe(200);
  expect((await post('/api/projects/'+projectId+'/dependency-changes/apply',body)).json()).toEqual(saved.json());
  const history=await get<DeliveryCommitment[]>('/api/projects/'+projectId+'/delivery-commitments');expect(history).toHaveLength(1);
  expect(history[0].items[0]).toMatchObject({id:r.id,targetDate:r.plannedEnd,acceptanceCriteria:'接口验证通过'});
  expect((await get<Requirement>('/api/requirements/'+r.id)).commitment?.first?.targetDate).toBe(r.plannedEnd);
});
it('再次确认要求说明，过期批次失败不留下快照',async()=>{
  const {projectId,r}=await fixture();let b=await batch(projectId,{commitment:{reason:''}});
  expect((await post('/api/projects/'+projectId+'/dependency-changes/apply',b.body)).statusCode).toBe(200);
  expect((await batch(projectId,{commitment:{reason:''}})).preview.statusCode).toBe(400);
  b=await batch(projectId,{commitment:{reason:'补充交付'}});
  await request('PATCH','/api/requirements/'+r.id,{expectedVersion:r.version,title:'修改版本'});
  expect((await post('/api/projects/'+projectId+'/dependency-changes/apply',b.body)).statusCode).toBe(409);
  expect(await get<DeliveryCommitment[]>('/api/projects/'+projectId+'/delivery-commitments')).toHaveLength(1);
});
it('历史不补造，首次缺日期不从后续补齐，最近记录不取验收之后的确认',()=>{
  const c=(date:string,targetDate:string|null):DeliveryCommitment=>({id:date,projectId:'p',projectName:'项目',targetDate:null,milestoneId:null,milestoneTitle:null,reason:'',confirmedAt:date+'T00:00:00Z',confirmedBy:'a',items:[{id:'r',kind:'requirement',title:'需求',targetDate,acceptanceCriteria:null}]});
  expect(requirementCommitments([],'r').first).toBeNull();
  const selected=requirementCommitments([c('2026-09-01',null),c('2026-09-03','2026-09-10'),c('2026-09-11','2026-09-30')],'r','2026-09-10');
  expect(selected.first?.targetDate).toBeNull();expect(selected.latest?.targetDate).toBe('2026-09-10');
  const timed=[c('2026-09-01','2026-09-02'),{...c('2026-09-01','2026-09-30'),id:'later',confirmedAt:'2026-09-01T10:00:00Z'}];expect(requirementCommitments(timed,'r','2026-09-01T08:00:00Z').latest?.targetDate).toBe('2026-09-02');
});
it('核对剩余工期不改变完成度、实际日期和确认计划',async()=>{
  const {projectId,r}=await fixture();await post('/api/requirements/'+r.id+'/start',{expectedVersion:r.version});
  let before=await get<Requirement>('/api/requirements/'+r.id);await post('/api/requirements/'+r.id+'/progress',{expectedVersion:before.version,requirementPercent:70,content:'完成七成'});
  before=await get<Requirement>('/api/requirements/'+r.id);
  const b=await batch(projectId,{entities:[{entity:'requirement',op:'update',id:r.id,expectedVersion:before.version,data:{reviewForecast:{remainingDays:5}}}]});
  expect(b.preview.statusCode,b.preview.body).toBe(200);
  expect((await get<Requirement>('/api/requirements/'+r.id)).forecastReview).toBeNull();
  const saved=await post('/api/projects/'+projectId+'/dependency-changes/apply',b.body);expect(saved.statusCode,saved.body).toBe(200);
  const after=await get<Requirement>('/api/requirements/'+r.id);
  expect(after.forecastReview?.remainingDays).toBe(5);expect(after.forecastEnd).toBe(addBusinessDays(todayIso(),4));
  expect(after.progress).toBe(70);expect(after.plannedEnd).toBe(before.plannedEnd);expect(after.actualStart).toBe(before.actualStart);
  expect(after.executionCompletedAt).toBeNull();expect(after.observationEnd).toBe(todayIso());
});

it('新建需求与承诺同批保存，ID 映射正确；审计失败全部回滚',async()=>{
 const {projectId}=await fixture(),id=randomUUID(),changes={entities:[{entity:'requirement',op:'create',id,data:{title:'新范围',executionMode:'direct',acceptanceCriteria:'完成检查'}}],commitment:{reason:''}};
 const b=await batch(projectId,changes);expect(b.preview.statusCode,b.preview.body).toBe(200);const {sqlite}=await import('../src/server/database');
 sqlite.exec("CREATE TEMP TRIGGER fail_commitment BEFORE INSERT ON audit_logs WHEN NEW.action='confirm_delivery_commitment' BEGIN SELECT RAISE(ABORT,'commitment audit test'); END");
 try{expect((await post('/api/projects/'+projectId+'/dependency-changes/apply',b.body)).statusCode).toBe(500);}finally{sqlite.exec('DROP TRIGGER fail_commitment');}
 expect(await get('/api/projects/'+projectId+'/delivery-commitments')).toEqual([]);expect(await get<Requirement[]>('/api/requirements?projectId='+projectId)).toHaveLength(1);
 const saved=await post('/api/projects/'+projectId+'/dependency-changes/apply',b.body);expect(saved.statusCode,saved.body).toBe(200);const history=await get<DeliveryCommitment[]>('/api/projects/'+projectId+'/delivery-commitments');expect(history[0].items.find(i=>i.title==='新范围')?.id).toBe(saved.json().addedIds[id]);
 expect((await post('/api/projects/'+projectId+'/dependency-changes/apply',{...b.body,changes:{...b.body.changes,commitment:{reason:'different'}}})).statusCode).toBe(409);
});
it('工作排期修改与承诺快照使用同一批次后的日期',async()=>{
 const {projectId,owner}=await fixture();let r=(await post('/api/requirements',{projectId,ownerId:owner.id,title:'分解需求',executionMode:'work_items'})).json<Requirement>();
 const created=await post('/api/requirements/'+r.id+'/work-items',{title:'唯一工作',expectedVersion:r.version,plannedStart:todayIso(),plannedEnd:addBusinessDays(todayIso(),1),ownerId:owner.id});expect(created.statusCode,created.body).toBe(200);r=await get('/api/requirements/'+r.id);
 const end=addBusinessDays(todayIso(),7),b=await batch(projectId,{entities:[{entity:'work',op:'update',id:r.workItems[0].id,requirementId:r.id,expectedVersion:r.workItems[0].version,data:{plannedEnd:end}}],commitment:{reason:''}});
 expect(b.preview.statusCode,b.preview.body).toBe(200);expect(b.preview.json().differences.commitment.value.items.find((i:{id:string})=>i.id===r.id).targetDate).toBe(end);
 const saved=await post('/api/projects/'+projectId+'/dependency-changes/apply',b.body);expect(saved.statusCode,saved.body).toBe(200);expect((await get<Requirement>('/api/requirements/'+r.id)).plannedEnd).toBe(end);expect((await get<DeliveryCommitment[]>('/api/projects/'+projectId+'/delivery-commitments'))[0].items.find(i=>i.id===r.id)?.targetDate).toBe(end);
});
it('直接需求与下游工作核对按最终网络顺序计算，保存后确认不会因客户端 ID 失效',async()=>{
 const {projectId,r,owner}=await fixture();const downstream=(await post('/api/requirements',{projectId,ownerId:owner.id,title:'后续',executionMode:'work_items'})).json<Requirement>();
 const created=await post('/api/requirements/'+downstream.id+'/work-items',{title:'下游工作',expectedVersion:downstream.version,ownerId:owner.id});expect(created.statusCode,created.body).toBe(200);const w=created.json();
 const {sqlite}=await import('../src/server/database');sqlite.prepare('UPDATE requirements SET dependencies_reviewed_at=? WHERE project_id=?').run(new Date().toISOString(),projectId);
 const b=await batch(projectId,{add:[{clientId:randomUUID(),sourceRequirementId:r.id,sourceWorkItemId:null,targetRequirementId:downstream.id,targetWorkItemId:w.id}],entities:[{entity:'requirement',op:'update',id:r.id,expectedVersion:r.version,data:{reviewForecast:{remainingDays:5}}}],estimates:[{workItemId:w.id,durationDays:2,reviewForecast:{remainingDays:2}}]});
 expect(b.preview.statusCode,b.preview.body).toBe(200);const node=b.preview.json().analysis.nodes.find((n:{id:string})=>n.id===w.id);expect(node.forecastEnd).toBe(addBusinessDays(todayIso(),6));
 const saved=await post('/api/projects/'+projectId+'/dependency-changes/apply',b.body);expect(saved.statusCode,saved.body).toBe(200);const final=await get<PathAnalysis>('/api/projects/'+projectId+'/path-analysis');expect(final.nodes.find(n=>n.id===w.id)?.forecastEnd).toBe(node.forecastEnd);expect(final.nodes.find(n=>n.id===w.id)?.forecastBasis?.reasons.join('')).not.toContain('变化');
});
it('阻塞关联同项目问题，协调信息只读一次；问题解决不自动解阻',async()=>{
 const {projectId,r,owner}=await fixture(),{projectId:other}=await fixture();
 const makeIssue=async(project:string)=>(await post('/api/issues',{projectId:project,title:'环境未就绪',discoveredAt:todayIso(),nextReviewAt:todayIso(),...(project===projectId?{ownerId:owner.id}:{})})).json();
 const issue=await makeIssue(projectId),foreign=await makeIssue(other);expect(issue.id).toBeTruthy();
 await post('/api/requirements/'+r.id+'/start',{expectedVersion:r.version});let current=await get<Requirement>('/api/requirements/'+r.id);
 expect((await post('/api/requirements/'+r.id+'/block',{expectedVersion:current.version,reason:'环境',blockedIssueId:foreign.id})).statusCode).toBe(400);expect((await get<Requirement>('/api/requirements/'+r.id)).status).toBe('in_progress');
 const blocked=await post('/api/requirements/'+r.id+'/block',{expectedVersion:current.version,reason:'环境',blockedIssueId:issue.id,blockedCoordinatorId:owner.id,blockedNextReviewAt:addBusinessDays(todayIso(),3)});expect(blocked.statusCode,blocked.body).toBe(200);
 current=await get('/api/requirements/'+r.id);expect(current.blockedCoordinatorId).toBeNull();expect(current.blockerCoordination).toMatchObject({issueId:issue.id,coordinatorId:owner.id,nextReviewAt:todayIso(),issueResolved:false});
 const actions=await get<{items:Array<{sourceId:string;sourceType:string;reasonCodes:string[]}>}>('/api/action-items?projectId='+projectId);expect(actions.items.filter(i=>i.sourceType==='issue'&&i.sourceId===issue.id)).toHaveLength(1);expect(actions.items.find(i=>i.sourceId===issue.id)?.reasonCodes).toContain('follow_up');
 const changed=await request('PATCH','/api/issues/'+issue.id,{expectedVersion:issue.version,nextReviewAt:addBusinessDays(todayIso(),2)});expect(changed.statusCode,changed.body).toBe(200);
 expect((await get<Requirement>('/api/requirements/'+r.id)).blockerCoordination?.nextReviewAt).toBe(addBusinessDays(todayIso(),2));
 const resolved=await post('/api/issues/'+issue.id+'/resolve',{expectedVersion:changed.json().version,content:'环境恢复'});expect(resolved.statusCode,resolved.body).toBe(200);current=await get('/api/requirements/'+r.id);expect(current.status).toBe('blocked');expect(current.blockerCoordination?.issueResolved).toBe(true);
 expect((await get<{items:Array<{sourceId:string;reasonCodes:string[]}>}>('/api/action-items?projectId='+projectId)).items.find(i=>i.sourceId===r.id)?.reasonCodes).toContain('blocker_resolved');
});
it('成员不能确认项目承诺，协调人不获得需求执行权限',async()=>{
 const {projectId,r}=await fixture();const person=(await post('/api/people',{projectId,name:'协调测试'+randomUUID()})).json();
 const login=await app.inject({method:'POST',url:'/api/login',payload:{username:person.name,password:'888888'}}),first=String(login.headers['set-cookie']).split(';')[0];expect(login.statusCode,login.body).toBe(200);
 const changed=await app.inject({method:'POST',url:'/api/account/change-password',headers:{cookie:first},payload:{currentPassword:'888888',newPassword:'Member-new-password!23'}});expect(changed.statusCode,changed.body).toBe(200);const member=String(changed.headers['set-cookie']).split(';')[0];
 const b=await batch(projectId,{commitment:{reason:''}});const denied=await app.inject({method:'POST',url:'/api/projects/'+projectId+'/dependency-changes/preview',headers:{cookie:member},payload:b.input});expect(denied.statusCode,denied.body).toBe(403);
 await post('/api/requirements/'+r.id+'/start',{expectedVersion:r.version});let current=await get<Requirement>('/api/requirements/'+r.id);await post('/api/requirements/'+r.id+'/block',{expectedVersion:current.version,reason:'等待',blockedCoordinatorId:person.id});current=await get('/api/requirements/'+r.id);
 expect((await app.inject({method:'POST',url:'/api/requirements/'+r.id+'/unblock',headers:{cookie:member},payload:{expectedVersion:current.version}})).statusCode).toBe(403);
 const actions=await app.inject({method:'GET',url:'/api/action-items?projectId='+projectId,headers:{cookie:member}});expect(actions.statusCode).toBe(200);expect(actions.json().items.some((i:{sourceId:string})=>i.sourceId===r.id)).toBe(true);
});
it('承诺统计采用验收期间样本，首次与最近日期独立，历史无日期不填零',async()=>{
 const {projectId,r}=await fixture(),{sqlite}=await import('../src/server/database'),{persistCommitment}=await import('../src/server/services/commitments');
 const value:DeliveryCommitment={id:'',projectId,projectName:'测试',targetDate:'2026-09-30',milestoneId:null,milestoneTitle:null,reason:'',confirmedAt:'',confirmedBy:'admin',items:[{kind:'requirement',id:r.id,title:r.title,targetDate:'2026-09-05',acceptanceCriteria:null}]};
 persistCommitment(value,randomUUID(),{},'2026-09-01T00:00:00.000Z');persistCommitment({...value,items:[{...value.items[0],targetDate:'2026-09-15'}]},randomUUID(),{},'2026-09-06T00:00:00.000Z');
 sqlite.prepare("UPDATE requirements SET status='completed',progress=100,accepted_at='2026-09-09' WHERE id=?").run(r.id);
 const summary=await get<{first:{rate:number|null;sampleCount:number};latest:{rate:number|null;sampleCount:number}}>('/api/projects/'+projectId+'/delivery-commitments/summary?from=2026-09-01&to=2026-09-30');expect(summary.first).toMatchObject({rate:0,sampleCount:1});expect(summary.latest).toMatchObject({rate:100,sampleCount:1});
 const empty=await get<typeof summary>('/api/projects/'+projectId+'/delivery-commitments/summary?from=2026-10-01&to=2026-10-31');expect(empty.first).toMatchObject({rate:null,sampleCount:0});
 sqlite.prepare("UPDATE requirements SET delivery_scope='candidate' WHERE id=?").run(r.id);const withdrawn=await get<{first:{sampleCount:number};withdrawnOrCancelled:number}>('/api/projects/'+projectId+'/delivery-commitments/summary');expect(withdrawn.first.sampleCount).toBe(0);expect(withdrawn.withdrawnOrCancelled).toBe(1);
 expect((await request('GET','/api/projects/'+projectId+'/delivery-commitments/summary?from=2026-10-01&to=2026-09-01')).statusCode).toBe(400);
});

it('返工明确使原核对失效，保留确认记录；进度高于核对时也不能复用旧预测',async()=>{
 const {projectId,r}=await fixture();await post('/api/requirements/'+r.id+'/start',{expectedVersion:r.version});let current=await get<Requirement>('/api/requirements/'+r.id);
 let b=await batch(projectId,{entities:[{entity:'requirement',op:'update',id:r.id,expectedVersion:current.version,data:{reviewForecast:{remainingDays:3}}}]});expect((await post('/api/projects/'+projectId+'/dependency-changes/apply',b.body)).statusCode).toBe(200);
 current=await get('/api/requirements/'+r.id);const original=current.forecastReview;expect((await post('/api/requirements/'+r.id+'/submit-acceptance',{expectedVersion:current.version,content:'完成'})).statusCode).toBe(200);
 current=await get('/api/requirements/'+r.id);expect((await post('/api/requirements/'+r.id+'/rework',{expectedVersion:current.version,progress:99,reason:'补充交付'})).statusCode).toBe(200);
 current=await get('/api/requirements/'+r.id);expect(current.progress).toBe(99);expect(current.forecastReview?.confirmedAt).toBe(original?.confirmedAt);expect(current.forecastReview?.invalidatedAt).toBeTruthy();expect(current.forecastBasis?.reasons.join('')).toContain('返工');
 expect((await get<PathAnalysis>('/api/projects/'+projectId+'/path-analysis')).nodes.find(n=>n.id==='execute:'+r.id)?.forecastEnd).toBeNull();
 b=await batch(projectId,{entities:[{entity:'requirement',op:'update',id:r.id,expectedVersion:current.version,data:{reviewForecast:{remainingDays:1}}}]});expect((await post('/api/projects/'+projectId+'/dependency-changes/apply',b.body)).statusCode).toBe(200);expect((await get<Requirement>('/api/requirements/'+r.id)).forecastReview?.invalidatedAt).toBeUndefined();
});

it('REST 与 MCP 复用承诺、核对及批次回执，日期参数按相同规则校验',async()=>{
 const {projectId,r}=await fixture(),origin=await app.listen({host:'127.0.0.1',port:0}),token=(await post('/api/tokens',{name:'承诺契约'})).json().token;
 const call=async(name:string,args:Record<string,unknown>)=>{const response=await mcpRequest(origin,token,name,args);expect(response.statusCode).toBe(200);return JSON.parse(response.body).result.structuredContent;};
 const a=await get<PathAnalysis>('/api/projects/'+projectId+'/path-analysis'),input={projectId,expectedRevision:a.revision,target:'project',changes:{add:[],remove:[],estimates:[],entities:[{entity:'requirement',op:'update',id:r.id,expectedVersion:r.version,data:{reviewForecast:{remainingDays:4}}}],commitment:{reason:''}}};
 const preview=await call('preview_dependency_changes',input);expect(preview.statusCode||200,JSON.stringify(preview)).toBe(200);
 expect(await get('/api/projects/'+projectId+'/delivery-commitments')).toEqual([]);
 const body={...input,batchId:randomUUID(),previewToken:preview.result.previewToken};const saved=await call('apply_dependency_changes',body);expect(saved.statusCode||200,JSON.stringify(saved)).toBe(200);
 expect(await call('apply_dependency_changes',body)).toEqual(saved);
 const history=await get<DeliveryCommitment[]>('/api/projects/'+projectId+'/delivery-commitments');expect((await call('list_delivery_commitments',{projectId})).result).toEqual(history);
 expect((await call('get_delivery_commitment',{projectId,commitmentId:history[0].id})).result).toEqual(await get('/api/projects/'+projectId+'/delivery-commitments/'+history[0].id));
 expect((await call('get_delivery_commitment_summary',{projectId})).result).toEqual(await get('/api/projects/'+projectId+'/delivery-commitments/summary'));
 expect((await call('get_delivery_commitment_summary',{projectId,from:'invalid'})).statusCode).toBe(400);
 expect((await get<Requirement>('/api/requirements/'+r.id)).forecastReview?.remainingDays).toBe(4);
});
