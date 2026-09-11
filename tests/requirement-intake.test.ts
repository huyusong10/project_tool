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
async function imported(){const p=await project(),v=await preview(p.id);expect(v.errors).toEqual([]);const result=await apply(p.id,v);expect(result.statusCode,result.body).toBe(200);const receipt=result.json<Extract<ImportReceipt,{status:'applied'}>>();return {id:p.id,requirementId:receipt.requirementIds['query'],receipt};}
it('批次重试和回执查询不重复写入，批次不能换内容',async()=>{
  const p=await project(),v=await preview(p.id),batchId=randomUUID();const first=await apply(p.id,v,batchId);expect(first.statusCode,first.body).toBe(200);
  const c=await catalog(p.id);expect((await apply(p.id,v,batchId)).json()).toEqual(first.json());expect(await catalog(p.id)).toEqual(c);
  expect((await request('GET',`/api/projects/${p.id}/requirement-import/receipts/${batchId}`)).json()).toEqual(first.json());
  const changed=structuredClone(v);changed.package.requirements[0].title='另一份内容';expect((await apply(p.id,changed,batchId)).statusCode).toBe(409);
});
it('分组调整和删除不影响需求执行',async()=>{
  const p=await imported(),c=await catalog(p.id),before=(await request('GET','/api/requirements/'+p.requirementId)).json();
  const updated=await request('PATCH','/api/requirements/'+p.requirementId,{expectedVersion:before.version,groupId:c.groups[0].id});expect(updated.statusCode,updated.body).toBe(200);expect(updated.json().groupId).toBe(c.groups[0].id);expect(updated.json()).not.toHaveProperty('tags');
  const removed=await request('DELETE',`/api/projects/${p.id}/requirement-groups/${c.groups[0].id}`,{expectedVersion:c.groups[0].version});expect(removed.statusCode,removed.body).toBe(200);
  const after=(await request('GET','/api/requirements/'+p.requirementId)).json();expect(after.workItems.map(({dependencyRevision:_revision,...w}:Record<string,unknown>)=>withoutForecastRevision(w))).toEqual(before.workItems.map(({dependencyRevision:_revision,...w}:Record<string,unknown>)=>withoutForecastRevision(w)));expect(after.progress).toBe(before.progress);expect(after.groupId).toBeNull();
});
it('旧标签不再返回，接口拒绝标签写入与筛选，分组仍正常工作',async()=>{
  const p=await imported(),{sqlite}=await import('../src/server/database');
  sqlite.prepare('UPDATE requirements SET tags=? WHERE id=?').run('["旧标签"]',p.requirementId);
  const before=(await request('GET','/api/requirements/'+p.requirementId)).json();
  expect(before).not.toHaveProperty('tags');expect(await catalog(p.id)).not.toHaveProperty('tags');
  const graph=(await request('GET',`/api/projects/${p.id}/path-analysis`)).json();
  expect(graph.requirements.find((r:{id:string})=>r.id===p.requirementId)).not.toHaveProperty('tags');
  expect((await request('PATCH','/api/requirements/'+p.requirementId,{expectedVersion:before.version,tags:['新标签']})).statusCode).toBe(400);
  expect((await request('GET',`/api/requirements/query?projectId=${p.id}&tag=legacy`)).statusCode).toBe(400);
  expect((await post(`/api/projects/${p.id}/requirement-organization`,{requirements:[{id:p.requirementId,expectedVersion:before.version}],tags:['新标签']})).statusCode).toBe(400);
  const pkg=structuredClone(intakeExample);const tagged={...pkg,requirements:pkg.requirements.map(r=>({...r,tags:['新标签']}))};
  expect((await post(`/api/projects/${p.id}/requirement-import/preview`,{package:tagged})).statusCode).toBe(400);
  const move=await post(`/api/projects/${p.id}/requirement-organization`,{requirements:[{id:p.requirementId,expectedVersion:before.version}],groupId:null});expect(move.statusCode,move.body).toBe(200);
  const after=(await request('GET','/api/requirements/'+p.requirementId)).json();
  expect(after.groupId).toBeNull();expect(after.status).toBe(before.status);expect(after.progress).toBe(before.progress);
  expect(after.workItems.map((w:{id:string})=>w.id)).toEqual(before.workItems.map((w:{id:string})=>w.id));
});
it('最终事务失败时导入的需求、条款、依赖和回执全部回滚',async()=>{
  const p=await project(),v=await preview(p.id),{sqlite}=await import('../src/server/database');
  sqlite.exec("CREATE TRIGGER fail_intake_receipt BEFORE INSERT ON requirement_import_receipts BEGIN SELECT RAISE(ABORT,'test rollback'); END;");
  try{const r=await apply(p.id,v);expect(r.statusCode).toBeGreaterThanOrEqual(400);expect((await request('GET','/api/requirements?projectId='+p.id)).json()).toEqual([]);expect(sqlite.prepare('SELECT count(*) n FROM dependency_change_receipts WHERE project_id=?').get(p.id)).toEqual({n:0});}finally{sqlite.exec('DROP TRIGGER fail_intake_receipt');}
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
  const groups=await call('list_requirement_groups',{projectId:p.id});expect(groups[0].name).toBe('示例模块');
  const query={projectId:p.id,groupId:groups[0].id,includeWorkItems:true};
  const page=await call('query_requirements',query);expect(page.total).toBe(1);
  expect(page.items[0]).toMatchObject({id:saved.requirementIds['query'],groupId:groups[0].id});
  expect((await request('GET',`/api/requirements/query?projectId=${p.id}&groupId=${groups[0].id}&includeWorkItems=true`)).json()).toEqual(page);
  expect((await call('query_requirements',{...query,groupId:'ungrouped'})).items).toEqual([]);
  expect((await call('get_work_item',{id:page.items[0].workItems[0].id})).requirementId).toBe(page.items[0].id);
  expect((await call('get_path_graph',{projectId:p.id,view:'requirement',requirementId:page.items[0].id})).cards.map((card:{id:string})=>card.id)).toEqual(expect.arrayContaining(page.items[0].workItems.map((work:{id:string})=>work.id)));
});
it('原始需求直接导入；预览无写入、人员日期不补造、条款字段不进入接口',async()=>{
 const p=await project(),before=await catalog(p.id),v=await preview(p.id);expect(v.errors).toEqual([]);expect(await catalog(p.id)).toEqual(before);
 const response=await apply(p.id,v);expect(response.statusCode,response.body).toBe(200);
 const detail=(await request('GET','/api/requirements/'+response.json().requirementIds.query)).json();
 expect(detail).toMatchObject({title:'查询与详情',status:'not_started',background:intakeExample.requirements[0].background,referenceUrl:'https://example.com/requirements',ownerId:null,plannedStart:null,plannedEnd:null});
 expect(detail.workItems).toHaveLength(2);for(const w of detail.workItems)expect(w).toMatchObject({status:'not_started',ownerId:null,plannedStart:null,plannedEnd:null,durationDays:null});
 expect(await catalog(p.id)).not.toHaveProperty('documents');
 expect((await post(`/api/projects/${p.id}/requirement-import/preview`,{package:{formatVersion:1,documents:[],requirements:[],links:[]}})).statusCode).toBe(400);
});
it('重复需求提醒，显式更新只修改核对过的字段并保留工作项和状态',async()=>{
 const p=await imported(),duplicate=await preview(p.id);expect(duplicate.errors.some(x=>x.includes('同名需求'))).toBe(true);
 const before=(await request('GET','/api/requirements/'+p.requirementId)).json(),pkg=structuredClone(intakeExample);
 pkg.requirements=[{key:'query',action:'update',existingId:before.id,expectedVersion:before.version,confirmAdditional:false,title:before.title,background:'补充后的原始需求',workItems:[]}];pkg.dependencies=[];
 const v=await preview(p.id,pkg);expect(v.errors).toEqual([]);expect((await apply(p.id,v)).statusCode).toBe(200);
 const after=(await request('GET','/api/requirements/'+before.id)).json();expect(after.background).toBe('补充后的原始需求');expect(after.status).toBe(before.status);expect(after.workItems.map((w:{id:string})=>w.id)).toEqual(before.workItems.map((w:{id:string})=>w.id));
 expect((await preview(p.id,pkg)).errors.some(x=>x.includes('版本变化'))).toBe(true);
});
it('并发修改、无效依赖和跨项目分组不能部分写入',async()=>{
 const p=await project(),v=await preview(p.id);await post(`/api/projects/${p.id}/requirement-groups`,{name:'并发修改'});expect((await apply(p.id,v)).statusCode).toBe(409);
 const cyclic=structuredClone(intakeExample);cyclic.dependencies.push({source:{requirement:'query',workItem:'ui'},target:{requirement:'query',workItem:'api'}});const invalid=await preview(p.id,cyclic);expect(invalid.errors.length).toBeGreaterThan(0);expect((await apply(p.id,invalid)).statusCode).toBe(400);
 expect((await request('GET','/api/requirements?projectId='+p.id)).json()).toEqual([]);
 const other=await imported(),created=await post('/api/requirements',{projectId:p.id,title:'不带工作项的需求'});expect(created.statusCode,created.body).toBe(200);
 expect((await request('PATCH','/api/requirements/'+created.json().id,{expectedVersion:created.json().version,groupId:(await catalog(other.id)).groups[0].id})).statusCode).toBe(400);
});
it('直接执行后添加第一个工作项自动汇总，保留已记录的进度基线',async()=>{
 const p=await project(),owner=(await post('/api/people',{projectId:p.id,name:'负责人'+sequence})).json().id;
 let r=(await post('/api/requirements',{projectId:p.id,title:'逐步分解',ownerId:owner})).json();
 r=(await post('/api/requirements/'+r.id+'/start',{expectedVersion:r.version})).json();
 expect((await post('/api/requirements/'+r.id+'/progress',{expectedVersion:r.version,content:'前期工作完成',requirementPercent:30})).statusCode).toBe(200);
 r=(await request('GET','/api/requirements/'+r.id)).json();
 const created=await post('/api/requirements/'+r.id+'/work-items',{expectedVersion:r.version,title:'剩余工作',ownerId:owner});expect(created.statusCode,created.body).toBe(200);
 const after=(await request('GET','/api/requirements/'+r.id)).json();expect(after).toMatchObject({executionMode:'work_items',progress:30,actualStart:r.actualStart});expect(after.workItems).toHaveLength(1);
});
import { withoutForecastRevision } from './fixtures/forecast-snapshot';
