import { beforeAll, afterAll, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, scryptSync } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { intakeExample, type IntakeCatalog, type ImportPreview, type ImportReceipt } from '../src/shared/intake';
import { mcpRequest } from './mcp-request';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pm-intake-')),password='intake-isolated-test';
Object.assign(process.env,{DB_PATH:path.join(directory,'test.db'),BACKUP_DIR:path.join(directory,'backups'),WEB_DIST_DIR:path.join(directory,'web'),SEED_DEMO:'0',NODE_ENV:'test',APP_PASSWORD_HASH:`scrypt$intake$${scryptSync(password,'intake',64).toString('hex')}`,SESSION_SECRET:'intake-test-secret-more-than-thirty-two-characters'});
let app:FastifyInstance,cookie='',sequence=0;
const request=(method:'POST'|'GET'|'PATCH'|'DELETE',url:string,payload?:unknown,auth=cookie)=>app.inject({method,url,headers:{cookie:auth},payload:payload as Record<string,unknown>});
const post=(url:string,payload:unknown)=>request('POST',url,payload);
const catalog=async(id:string)=>(await request('GET',`/api/projects/${id}/requirement-intake`)).json<IntakeCatalog>();
beforeAll(async()=>{app=await(await import('../src/server/app')).buildApp();await app.ready();const r=await request('POST','/api/login',{username:'admin',password},'');cookie=String(r.headers['set-cookie']).split(';')[0];});
afterAll(async()=>{await app.close();const{sqlite}=await import('../src/server/database');sqlite.close();fs.rmSync(directory,{recursive:true,force:true});});
async function project(){return (await post('/api/projects',{name:'导入验证'+(++sequence)})).json<{id:string}>();}
async function preview(id:string,pkg=structuredClone(intakeExample)){
  const result=await post(`/api/projects/${id}/requirement-import/preview`,{package:pkg});expect(result.statusCode,result.body).toBe(200);return result.json<ImportPreview>();
}
async function apply(id:string,p:ImportPreview,batchId=randomUUID()){
  return post(`/api/projects/${id}/requirement-import/apply`,{package:p.package,previewToken:p.previewToken,expectedRevision:p.expectedRevision,batchId});
}
async function imported(){const p=await project(),v=await preview(p.id);expect(v.errors).toEqual([]);const result=await apply(p.id,v);expect(result.statusCode,result.body).toBe(200);const receipt=result.json<Extract<ImportReceipt,{status:'applied'}>>();return {id:p.id,requirementId:receipt.requirementIds['query-delivery'],receipt};}
it('预览不写入，重复编号可并存，多条来源对应同一交付，工作项不补造日期或工期',async()=>{
  const p=await project(),before=await catalog(p.id),v=await preview(p.id);
  expect(v.errors).toEqual([]);expect(v.warnings.some(w=>w.includes('原编号 EX-001 重复'))).toBe(true);expect(await catalog(p.id)).toEqual(before);
  const result=await apply(p.id,v);expect(result.statusCode,result.body).toBe(200);
  const c=await catalog(p.id);expect(c.documents[0].complete).toBe(false);expect(c.documents[0].clauses).toHaveLength(2);expect(c.groups[0].name).toBe('示例模块');
  const id=result.json().requirementIds['query-delivery'];const detail=(await request('GET','/api/requirements/'+id)).json();
  expect(detail).toMatchObject({deliveryScope:'candidate',executionMode:'work_items',tags:['中心'],groupId:c.groups[0].id,acceptedAt:null});
  expect(detail.workItems).toHaveLength(2);for(const w of detail.workItems)expect(w).toMatchObject({ownerId:null,plannedStart:null,plannedEnd:null,durationDays:null});
  expect(c.documents[0].clauses.every(x=>x.links[0].requirementId===id)).toBe(true);
});
it('批次重试和回执查询不重复写入，批次不能换内容',async()=>{
  const p=await project(),v=await preview(p.id),batchId=randomUUID();const first=await apply(p.id,v,batchId);expect(first.statusCode,first.body).toBe(200);
  const c=await catalog(p.id);expect((await apply(p.id,v,batchId)).json()).toEqual(first.json());expect(await catalog(p.id)).toEqual(c);
  expect((await request('GET',`/api/projects/${p.id}/requirement-import/receipts/${batchId}`)).json()).toEqual(first.json());
  const changed=structuredClone(v);changed.package.requirements[0].title='另一份内容';expect((await apply(p.id,changed,batchId)).statusCode).toBe(409);
});
it('条款可以对应多份交付，重复导入须明确选择新增或关联已有',async()=>{
  const p=await imported(),v=await preview(p.id);expect(v.existingMatches).toHaveLength(1);expect(v.errors.some(x=>x.includes('来源已关联交付'))).toBe(true);
  const pkg=structuredClone(intakeExample);pkg.requirements[0].confirmAdditional=true;pkg.requirements[0].title='后续交付';const next=await preview(p.id,pkg);expect(next.errors).toEqual([]);expect((await apply(p.id,next)).statusCode).toBe(200);
  expect((await catalog(p.id)).documents[0].clauses[0].links).toHaveLength(2);
  pkg.requirements[0].action='link';pkg.requirements[0].existingId=p.requirementId;pkg.requirements[0].workItems=[];pkg.dependencies=[];
  const linked=await preview(p.id,pkg);expect(linked.errors).toEqual([]);expect((await apply(p.id,linked)).statusCode).toBe(200);
  expect((await catalog(p.id)).documents[0].clauses[0].links).toHaveLength(2);
});
it('源版本变化保留旧落实范围和执行事实，未包含的旧条款保留',async()=>{
  const p=await imported(),before=(await request('GET','/api/requirements/'+p.requirementId)).json(),c=await catalog(p.id);
  const document=structuredClone(intakeExample.documents[0]);document.version='2';document.clauses=[{...document.clauses[0],content:'支持新增筛选及详情。'}];
  const saved=await post(`/api/projects/${p.id}/requirement-sources`,{expectedRevision:c.revision,documents:[document]});expect(saved.statusCode,saved.body).toBe(200);
  const next=await catalog(p.id);expect(next.documents[0].clauses).toHaveLength(2);const clause=next.documents[0].clauses.find(c=>c.key==='query')!;
  expect(clause.links[0].needsReview).toBe(true);expect(clause.links[0].reviewed.content).toBe('支持筛选和查看详情。');
  const after=(await request('GET','/api/requirements/'+p.requirementId)).json();for(const field of ['progress','status','acceptedAt','plannedStart','plannedEnd'])expect(after[field]).toEqual(before[field]);
  const reviewed=await post(`/api/projects/${p.id}/requirement-source-links`,{requirementId:p.requirementId,clauseId:clause.id,scope:clause.links[0].scope,expectedVersion:after.version,reviewedRevisionId:clause.current.id});expect(reviewed.statusCode,reviewed.body).toBe(200);
  expect((await catalog(p.id)).documents[0].clauses.find(c=>c.key==='query')!.links[0].needsReview).toBe(false);
});
it('分组调整和删除不影响需求执行，草稿支持分组标签',async()=>{
  const p=await imported(),c=await catalog(p.id),before=(await request('GET','/api/requirements/'+p.requirementId)).json();
  const updated=await request('PATCH','/api/requirements/'+p.requirementId,{expectedVersion:before.version,tags:['边缘','边缘'],groupId:c.groups[0].id});expect(updated.statusCode,updated.body).toBe(200);expect(updated.json().tags).toEqual(['边缘']);
  const removed=await request('DELETE',`/api/projects/${p.id}/requirement-groups/${c.groups[0].id}`,{expectedVersion:c.groups[0].version});expect(removed.statusCode,removed.body).toBe(200);
  const after=(await request('GET','/api/requirements/'+p.requirementId)).json();expect(after.workItems.map(({dependencyRevision:_revision,...w}:Record<string,unknown>)=>w)).toEqual(before.workItems.map(({dependencyRevision:_revision,...w}:Record<string,unknown>)=>w));expect(after.progress).toBe(before.progress);expect(after.groupId).toBeNull();
});
it('项目版本变化、越项目来源和依赖成环均不能部分落库',async()=>{
  const p=await project(),v=await preview(p.id);await post(`/api/projects/${p.id}/requirement-groups`,{name:'并发修改'});
  expect((await apply(p.id,v)).statusCode).toBe(409);expect((await catalog(p.id)).documents).toHaveLength(0);
  const cyclic=structuredClone(intakeExample);cyclic.dependencies.push({source:{requirement:'query-delivery',workItem:'ui'},target:{requirement:'query-delivery',workItem:'api'}});
  const invalid=await preview(p.id,cyclic);expect(invalid.errors.length).toBeGreaterThan(0);expect((await apply(p.id,invalid)).statusCode).toBe(400);expect((await catalog(p.id)).documents).toHaveLength(0);
  const other=await imported(),direct=(await post('/api/requirements',{projectId:p.id,title:'直接执行',executionMode:'direct'})).json();
  const clause=(await catalog(other.id)).documents[0].clauses[0];
  expect((await post(`/api/projects/${p.id}/requirement-source-links`,{requirementId:direct.id,clauseId:clause.id,scope:'跨项目',expectedVersion:direct.version})).statusCode).toBe(400);
  expect((await request('PATCH','/api/requirements/'+direct.id,{expectedVersion:direct.version,groupId:(await catalog(other.id)).groups[0].id})).statusCode).toBe(400);
});
it('最终事务失败时导入的需求、条款、依赖和回执全部回滚',async()=>{
  const p=await project(),v=await preview(p.id),{sqlite}=await import('../src/server/database');
  sqlite.exec("CREATE TRIGGER fail_intake_receipt BEFORE INSERT ON requirement_import_receipts BEGIN SELECT RAISE(ABORT,'test rollback'); END;");
  try{const r=await apply(p.id,v);expect(r.statusCode).toBeGreaterThanOrEqual(400);expect((await catalog(p.id)).documents).toHaveLength(0);expect((await request('GET','/api/requirements?projectId='+p.id)).json()).toEqual([]);expect(sqlite.prepare('SELECT count(*) n FROM dependency_change_receipts WHERE project_id=?').get(p.id)).toEqual({n:0});}finally{sqlite.exec('DROP TRIGGER fail_intake_receipt');}
});
it('选摘更新保留暂缓原因，预览展示原文差异，明确清空才恢复安排',async()=>{
  const p=await imported(),c=await catalog(p.id),clause=c.documents[0].clauses.find(x=>x.key==='query')!;
  expect((await post(`/api/projects/${p.id}/requirement-sources/clauses/${clause.id}/defer`,{expectedRevision:c.revision,reason:'等待业务口径'})).statusCode).toBe(200);
  const pkg=structuredClone(intakeExample);pkg.requirements=[];pkg.links=[];pkg.dependencies=[];pkg.documents[0].version='2';pkg.documents[0].clauses=[{...pkg.documents[0].clauses[0],content:'新查询规则'}];
  const v=await preview(p.id,pkg);expect(v.sourceChanges[0]).toMatchObject({before:{documentVersion:'1',content:'支持筛选和查看详情。'},after:{documentVersion:'2',content:'新查询规则'}});
  expect((await apply(p.id,v)).statusCode).toBe(200);expect((await catalog(p.id)).documents[0].clauses.find(x=>x.id===clause.id)?.deferredReason).toBe('等待业务口径');
  pkg.documents[0].clauses[0].deferredReason='';expect((await apply(p.id,await preview(p.id,pkg))).statusCode).toBe(200);expect((await catalog(p.id)).documents[0].clauses.find(x=>x.id===clause.id)?.deferredReason).toBe('');
});
it('直接执行后拆分沿用来源，共享草稿可修改分组标签且保留执行基线',async()=>{
  const p=await project(),pkg=structuredClone(intakeExample);pkg.requirements[0].ownerId=(await post('/api/people',{projectId:p.id,name:'拆分负责人'+sequence})).json().id;pkg.requirements[0].workItems=[];pkg.requirements[0].deliveryScope='committed';pkg.dependencies=[];
  const saved=await apply(p.id,await preview(p.id,pkg)),id=saved.json().requirementIds['query-delivery'];
  const detail=async()=>(await request('GET','/api/requirements/'+id)).json();let current=await detail();
  expect((await post('/api/requirements/'+id+'/start',{expectedVersion:current.version})).statusCode).toBe(200);current=await detail();
  expect((await post('/api/requirements/'+id+'/progress',{expectedVersion:current.version,content:'前期完成',requirementPercent:30})).statusCode).toBe(200);current=await detail();
  const before=await catalog(p.id),body={expectedRevision:Number(before.revision),target:'project',changes:{add:[],remove:[],estimates:[],entities:[{entity:'requirement',op:'update',id,expectedVersion:current.version,data:{executionMode:'work_items',reason:'拆分剩余工作',groupId:null,tags:['继续实施']}},{entity:'work',op:'create',id:randomUUID(),requirementId:id,data:{title:'剩余实现'}}]}};
  const previewed=await post(`/api/projects/${p.id}/dependency-changes/preview`,body);expect(previewed.statusCode,previewed.body).toBe(200);expect((await detail()).workItems).toHaveLength(0);
  const result=await post(`/api/projects/${p.id}/dependency-changes/apply`,{...body,batchId:randomUUID(),previewToken:previewed.json().previewToken});expect(result.statusCode,result.body).toBe(200);
  const after=await detail();expect(after).toMatchObject({progress:30,executionMode:'work_items',groupId:null,tags:['继续实施'],actualStart:current.actualStart});expect(after.workItems).toHaveLength(1);
  expect((await catalog(p.id)).documents[0].clauses.map(c=>c.links.map(l=>l.id))).toEqual(before.documents[0].clauses.map(c=>c.links.map(l=>l.id)));
});
it('普通成员可维护自己的落实范围，不能导入或修改他人范围',async()=>{
  const p=await imported(),name='来源负责人'+sequence,person=(await post('/api/people',{projectId:p.id,name})).json();
  const login=await request('POST','/api/login',{username:name,password:'888888'},'');
  const changed=await request('POST','/api/account/change-password',{currentPassword:'888888',newPassword:'intake-member-password'},String(login.headers['set-cookie']).split(';')[0]);
  const member=String(changed.headers['set-cookie']).split(';')[0],before=(await request('GET','/api/requirements/'+p.requirementId)).json();
  const own=await request('PATCH','/api/requirements/'+p.requirementId,{expectedVersion:before.version,ownerId:person.id});expect(own.statusCode,own.body).toBe(200);
  const c=await catalog(p.id),clause=c.documents[0].clauses[0];
  expect((await request('POST',`/api/projects/${p.id}/requirement-import/preview`,{package:intakeExample},member)).statusCode).toBe(403);
  expect((await request('POST',`/api/projects/${p.id}/requirement-groups`,{name:'越权分组'},member)).statusCode).toBe(403);
  const saved=await request('POST',`/api/projects/${p.id}/requirement-source-links`,{requirementId:p.requirementId,clauseId:clause.id,scope:'负责人明确范围',expectedVersion:own.json().version,reviewedRevisionId:clause.current.id},member);expect(saved.statusCode,saved.body).toBe(200);
  const other=(await post('/api/requirements',{projectId:p.id,title:'其他人的交付',executionMode:'direct'})).json();
  expect((await request('POST',`/api/projects/${p.id}/requirement-source-links`,{requirementId:other.id,clauseId:clause.id,scope:'越权范围',expectedVersion:other.version},member)).statusCode).toBe(403);
});
it('终态元数据纠错保留验收事实，来源修改需纠错原因',async()=>{
  const p=await imported(),direct=(await post('/api/requirements',{projectId:p.id,title:'已取消交付',executionMode:'direct'})).json();
  const cancelled=(await post('/api/requirements/'+direct.id+'/cancel',{expectedVersion:direct.version,reason:'测试取消'})).json();
  const corrected=await post('/api/requirements/'+direct.id+'/correct',{expectedVersion:cancelled.version,reason:'补充分组',groupId:(await catalog(p.id)).groups[0].id,tags:['历史']});expect(corrected.statusCode,corrected.body).toBe(200);expect(corrected.json()).toMatchObject({status:'cancelled',progress:0,acceptedAt:null,tags:['历史']});
  const clause=(await catalog(p.id)).documents[0].clauses[0],input={requirementId:direct.id,clauseId:clause.id,scope:'历史范围',expectedVersion:corrected.json().version};
  expect((await post(`/api/projects/${p.id}/requirement-source-links`,input)).statusCode).toBe(400);
  expect((await post(`/api/projects/${p.id}/requirement-source-links`,{...input,reason:'补记原来源'})).statusCode).toBe(200);
});
it('MCP 与 REST 使用同一导入契约、预览结果及回执',async()=>{
  const p=await project(),token=(await post('/api/tokens',{name:'导入测试',expiresInDays:1})).json().token;
  const address=await app.listen({host:'127.0.0.1',port:0});
  const call=async(name:string,args:Record<string,unknown>)=>{
    const r=await mcpRequest(address,token,name,args);expect(r.statusCode,r.body).toBe(200);
    const body=JSON.parse(r.body.startsWith('event:')?r.body.split('\n').find(l=>l.startsWith('data: '))!.slice(6):r.body);
    expect(body.result?.isError,JSON.stringify(body)).not.toBe(true);return JSON.parse(body.result.content[0].text);
  };
  const v=await call('preview_requirement_import',{projectId:p.id,package:intakeExample});expect(v.errors).toEqual([]);
  expect(v.previewToken).toBe((await preview(p.id)).previewToken);
  const batchId=randomUUID(),saved=await call('apply_requirement_import',{projectId:p.id,package:v.package,expectedRevision:v.expectedRevision,previewToken:v.previewToken,batchId});
  expect(saved.status).toBe('applied');expect((await request('GET',`/api/projects/${p.id}/requirement-import/receipts/${batchId}`)).json()).toEqual(saved);
  expect((await call('list_requirement_groups',{projectId:p.id}))[0].name).toBe('示例模块');
});
