import {listenTestApp} from './support/listen';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,scryptSync} from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import type {FastifyInstance} from 'fastify';
import type {Feature,ImportPreview,ImportReceipt} from '../src/shared/intake';
import type {FeaturePhase} from '../src/shared/feature-phases';
import type {Requirement} from '../src/client/types';
import {mcpRequest,mcpRpcRequest} from './mcp-request';

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pm-mcp-partial-')),password='partial-update-test';
Object.assign(process.env,{DB_PATH:path.join(directory,'test.db'),BACKUP_DIR:path.join(directory,'backups'),WEB_DIST_DIR:path.join(directory,'web'),SEED_DEMO:'0',NODE_ENV:'test',
  APP_PASSWORD_HASH:'scrypt$partial$'+scryptSync(password,'partial',64).toString('hex'),SESSION_SECRET:'partial-update-test-secret-more-than-thirty-two-characters'});
let app:FastifyInstance,origin:string,cookie:string,token:string;
beforeAll(async()=>{
  app=await(await import('../src/server/app')).buildApp();
  origin=await listenTestApp(app);
  const login=await app.inject({method:'POST',url:'/api/login',payload:{username:'admin',password}});
  cookie=String(login.headers['set-cookie']).split(';')[0];
  token=(await post('/api/tokens',{name:'partial updates'})).token;
});
afterAll(async()=>{await app?.close();const {sqlite}=await import('./support/database');if(sqlite.open)sqlite.close();fs.rmSync(directory,{recursive:true,force:true});});
async function post(url:string,payload:Record<string,unknown>){
  const response=await app.inject({method:'POST',url,headers:{cookie},payload});
  expect(response.statusCode,response.body).toBe(200);return response.json();
}
async function raw(name:string,args:Record<string,unknown>){
  const response=await mcpRequest(origin,token,name,args);
  expect(response.statusCode,response.body).toBe(200);
  const body=JSON.parse(response.body);expect(body.error,JSON.stringify(body)).toBeUndefined();return body.result;
}
async function call<T>(name:string,args:Record<string,unknown>):Promise<T>{
  const result=await raw(name,args);expect(result.isError,JSON.stringify(result)).not.toBe(true);return result.structuredContent.result;
}
async function project(){return (await post('/api/projects',{name:'局部更新 '+randomUUID()})).id as string;}
async function features(projectId:string){return call<Feature[]>('list_features',{projectId});}
async function saveFeature(projectId:string,name:string,extra:Record<string,unknown>={}){
  await call('save_feature',{projectId,name,...extra});return (await features(projectId)).find(f=>f.name===name)!;
}
async function detail(id:string){return call<Requirement>('get_requirement',{id});}

const relatedLinks=[{title:'MPS 总体目标',url:'https://docs.example.com/mps',kind:'document'},{title:'自定义接口设计',url:'https://docs.example.com/mds',kind:'document'},{title:'实现任务',url:'https://jira.example.com/browse/DEV-33',kind:'task'}];
it('MCP 握手发布新版版本，客户端可发现各对象的多链接输入',async()=>{
  const hello=await mcpRpcRequest(origin,token,'initialize',{protocolVersion:'2026-07-28',capabilities:{},clientInfo:{name:'links-contract-test',version:'1.0.0'}});
  expect(hello.statusCode,hello.body).toBe(200);
  expect(JSON.parse(hello.body).result.serverInfo).toMatchObject({name:'project-manage',version:'1.5.0'});
  const response=await mcpRpcRequest(origin,token,'tools/list',{});
  expect(response.statusCode,response.body).toBe(200);
  const catalog=JSON.parse(response.body).result.tools as Array<{name:string;inputSchema:{properties:Record<string,unknown>}}>;
  for(const name of ['save_feature','save_feature_phase','create_requirement','update_requirement','correct_requirement','create_work_item','update_work_item','correct_work_item']){
    expect(catalog.find(tool=>tool.name===name)?.inputSchema.properties.referenceLinks,name).toMatchObject({type:'array',maxItems:20,items:{properties:{title:{type:'string'},url:{type:'string'},kind:{enum:['document','task','other']}}}});
  }
});
it('REST / MCP 多链接保留顺序，兼容单链接修改、删除，过期或非法保存整批回滚',async()=>{
  const projectId=await project();
  let r=await call<Requirement>('create_requirement',{projectId,title:'多种材料',referenceLinks:relatedLinks});
  expect(r.referenceLinks).toEqual(relatedLinks);expect(r.referenceUrl).toBe(relatedLinks[0].url);
  r=await call<Requirement>('update_requirement',{id:r.id,expectedVersion:r.version,referenceUrl:'https://example.com/new'});
  expect(r.referenceLinks?.slice(1)).toEqual(relatedLinks.slice(1));expect(r.referenceLinks?.[0].url).toBe('https://example.com/new');
  r=await call<Requirement>('update_requirement',{id:r.id,expectedVersion:r.version,referenceUrl:null});
  expect(r.referenceLinks).toEqual(relatedLinks.slice(1));
  for(const [expectedVersion,links] of [[r.version-1,[]],[r.version,[{title:'非法',url:'javascript:alert(1)'}]],[r.version,[relatedLinks[0],relatedLinks[0]]]] as const){
    const response=await app.inject({method:'PATCH',url:'/api/requirements/'+r.id,headers:{cookie},payload:{expectedVersion,referenceLinks:links}});
    expect(response.statusCode).toBeGreaterThanOrEqual(400);expect(await detail(r.id)).toEqual(r);
  }
  r=await call<Requirement>('update_requirement',{id:r.id,expectedVersion:r.version,referenceLinks:[relatedLinks[2],relatedLinks[1]]});
  expect(r.referenceLinks).toEqual([relatedLinks[2],relatedLinks[1]]);
  r=await call<Requirement>('update_requirement',{id:r.id,expectedVersion:r.version,referenceLinks:[]});
  expect(r.referenceLinks).toEqual([]);expect(r.referenceUrl).toBeNull();
});
it('特性和 Phase 接受开放名称，其他字段更新不清空链接',async()=>{
  const projectId=await project(),f=await saveFeature(projectId,'多链接特性',{referenceLinks:relatedLinks});expect(f.referenceLinks).toEqual(relatedLinks);
  let phase=await call<FeaturePhase>('save_feature_phase',{projectId,featureId:f.id,name:'交付范围',referenceLinks:relatedLinks});
  expect(phase.referenceLinks).toEqual(relatedLinks);
  phase=await call<FeaturePhase>('save_feature_phase',{projectId,featureId:f.id,id:phase.id,expectedVersion:phase.version,name:'调整名称'});
  expect(phase.referenceLinks).toEqual(relatedLinks);
  phase=await call<FeaturePhase>('save_feature_phase',{projectId,featureId:f.id,id:phase.id,expectedVersion:phase.version,name:phase.name,referenceLinks:[]});expect(phase.referenceLinks).toEqual([]);
});
it('工作项创建、更新、完成后纠错都保留链接与执行状态',async()=>{
  const projectId=await project(),owner=await post('/api/people',{projectId,name:'链接负责人 '+randomUUID()});
  let r=await call<Requirement>('create_requirement',{projectId,title:'工作项资料',ownerId:owner.id});
  await call('create_work_item',{requirementId:r.id,expectedVersion:r.version,title:'接口开发',ownerId:owner.id,referenceLinks:relatedLinks});r=await detail(r.id);
  let work=r.workItems[0];expect(work.referenceLinks).toEqual(relatedLinks);
  await call('update_work_item',{id:work.id,expectedVersion:work.version,title:'接口设计与开发'});r=await detail(r.id);work=r.workItems[0];expect(work.referenceLinks).toEqual(relatedLinks);
  await call('start_work_item',{id:work.id,expectedVersion:work.version,expectedRequirementVersion:r.version});work=(await detail(r.id)).workItems[0];
  await call('complete_work_item',{id:work.id,expectedVersion:work.version});work=(await detail(r.id)).workItems[0];
  await call('correct_work_item',{id:work.id,expectedVersion:work.version,referenceLinks:[relatedLinks[1]],reason:'补充材料'});
  const after=(await detail(r.id)).workItems[0];expect(after).toMatchObject({status:work.status,actualStart:work.actualStart,actualEnd:work.actualEnd,progress:100,referenceLinks:[relatedLinks[1]]});
});
it('导入多链接经过预览整批落库，图形草稿读取完整列表',async()=>{
  const projectId=await project(),pkg={formatVersion:3,requirements:[{key:'new',action:'create',title:'导入多链接',referenceLinks:relatedLinks,workItems:[{key:'w',title:'实现',referenceLinks:[relatedLinks[2]]}]}]};
  const preview=await call<ImportPreview>('preview_requirement_import',{projectId,package:pkg});expect(preview.errors).toEqual([]);
  await call('apply_requirement_import',{projectId,package:preview.package,expectedRevision:preview.expectedRevision,previewToken:preview.previewToken,batchId:randomUUID()});
  const response=await app.inject({url:'/api/requirements?projectId='+projectId,headers:{cookie}});const r=response.json()[0];expect(r.referenceLinks).toEqual(relatedLinks);expect(r.workItems[0].referenceLinks).toEqual([relatedLinks[2]]);
  const {loadPathInput}=await import('../src/server/services/paths');expect(loadPathInput(projectId).requirements[0].referenceLinks).toEqual(relatedLinks);
});

it('MCP 特性省略排序时保留位置、其他特性版本及人工评估',async()=>{
  const projectId=await project();
  await saveFeature(projectId,'甲',{sortOrder:0});
  await saveFeature(projectId,'乙',{sortOrder:1});
  const third=await saveFeature(projectId,'丙',{sortOrder:2,description:'原范围',referenceLinks:[{title:'文档',url:'https://example.com/source'}],
    overview:{expectation:'按期交付',progressSummary:'已设计',assessment:'on_track',note:'人工判断'}});
  const before=await features(projectId);
  await call('save_feature',{projectId,id:third.id,expectedVersion:third.version,name:'丙（C）',description:'新范围'});
  const after=await features(projectId),saved=after.find(f=>f.id===third.id)!;
  expect(after.map(f=>[f.id,f.sortOrder])).toEqual(before.map(f=>[f.id,f.sortOrder]));
  expect(after.filter(f=>f.id!==third.id)).toEqual(before.filter(f=>f.id!==third.id));
  expect(saved).toMatchObject({name:'丙（C）',description:'新范围',referenceLinks:third.referenceLinks,overview:third.overview,assessedAt:third.assessedAt});
  expect(saved.version).toBe(third.version+1);
  const stale=await raw('save_feature',{projectId,id:third.id,expectedVersion:third.version,name:'过期名称'});
  expect(stale.isError).toBe(true);
});

it('特性新建默认追加，显式排序和清空资料仍然有效',async()=>{
  const projectId=await project(),a=await saveFeature(projectId,'甲'),b=await saveFeature(projectId,'乙');
  expect((await features(projectId)).filter(f=>f.kind!=='other').map(f=>f.id)).toEqual([a.id,b.id]);
  await call('save_feature',{projectId,id:b.id,expectedVersion:b.version,name:b.name,sortOrder:0,description:'',referenceLinks:[]});
  expect((await features(projectId)).filter(f=>f.kind!=='other').map(f=>f.id)).toEqual([b.id,a.id]);
});

it('MCP 已启动 Phase 仅改名不清空范围、日期、备注或要求无关原因',async()=>{
  const projectId=await project(),f=await saveFeature(projectId,'权限管理');
  const phase=await call<FeaturePhase>('save_feature_phase',{projectId,featureId:f.id,name:'Phase 1',scope:'原范围',targetDate:'2026-10-30',note:'原备注',sortOrder:3});
  const owner=await post('/api/people',{projectId,name:'阶段负责人 '+randomUUID()});
  const requirement=await call<Requirement>('create_requirement',{projectId,featureId:f.id,phaseId:phase.id,title:'阶段内需求',ownerId:owner.id});
  await call('start_requirement',{id:requirement.id,expectedVersion:requirement.version});
  const latest=(await call<FeaturePhase[]>('list_feature_phases',{projectId}))[0];
  const renamed=await call<FeaturePhase>('save_feature_phase',{projectId,featureId:f.id,id:phase.id,expectedVersion:latest.version,name:'Phase 1 基础交付'});
  expect(renamed).toMatchObject({scope:'原范围',targetDate:'2026-10-30',note:'原备注',sortOrder:3,status:'in_progress'});
  const rejected=await raw('save_feature_phase',{projectId,featureId:f.id,id:phase.id,expectedVersion:renamed.version,name:renamed.name,targetDate:null});
  expect(rejected.isError).toBe(true);
  const cleared=await call<FeaturePhase>('save_feature_phase',{projectId,featureId:f.id,id:phase.id,expectedVersion:renamed.version,name:renamed.name,scope:'',targetDate:null,note:'',reason:'清空未确定资料'});
  expect(cleared).toMatchObject({scope:'',targetDate:null,note:'',sortOrder:3});
  expect((await raw('save_feature_phase',{projectId,featureId:f.id,id:phase.id,expectedVersion:renamed.version,name:'过期名称'})).isError).toBe(true);
  const next=await call<FeaturePhase>('save_feature_phase',{projectId,featureId:f.id,name:'Phase 2'});
  expect(next).toMatchObject({scope:'',targetDate:null,note:''});
});

async function importFixture(withWork:boolean){
  const projectId=await project(),owner=await post('/api/people',{projectId,name:'需求负责人 '+randomUUID()});
  const f=await saveFeature(projectId,'功能特性'),phase=await call<FeaturePhase>('save_feature_phase',{projectId,featureId:f.id,name:'Phase 1'});
  const created=await call<Requirement>('create_requirement',{projectId,title:'原需求',ownerId:owner.id,featureId:f.id,phaseId:phase.id,background:'原描述',
    acceptanceCriteria:'原验收条件',referenceUrl:'https://example.com/original',...withWork?{}:{plannedStart:'2026-10-12',plannedEnd:'2026-10-13',durationDays:2}});
  if(withWork)await call('create_work_item',{requirementId:created.id,expectedVersion:created.version,title:'已有开发',workStage:'development',ownerId:owner.id,plannedStart:'2026-10-12',plannedEnd:'2026-10-13'});
  return {projectId,before:await detail(created.id)};
}
for(const withWork of [false,true]){
  it('MCP 导入仅修改描述时保留'+(withWork?'工作项需求':'直接执行需求')+'的负责人、验收、链接和计划',async()=>{
    const {projectId,before}=await importFixture(withWork);
    const reason=withWork?{reason:'精简描述'}:{};
    const pkg={formatVersion:3,requirements:[{key:'existing',action:'update',existingId:before.id,expectedVersion:before.version,title:before.title,background:'简短描述',...reason}]};
    const preview=await call<ImportPreview>('preview_requirement_import',{projectId,package:pkg});
    expect(preview.errors).toEqual([]);
    const data=(preview.differences as {entities:Array<{data:Record<string,unknown>}>}).entities[0].data;
    expect(data).toEqual({title:before.title,background:'简短描述',...reason});
    expect(await detail(before.id)).toEqual(before);
    const input={projectId,package:pkg,expectedRevision:preview.expectedRevision,previewToken:preview.previewToken,batchId:randomUUID()};
    const receipt=await call<ImportReceipt>('apply_requirement_import',input);
    expect(await call('apply_requirement_import',input)).toEqual(receipt);
    const after=await detail(before.id);
    for(const key of ['title','ownerId','acceptanceCriteria','referenceUrl','plannedStart','plannedEnd','durationDays','phaseId','featureId','status'] as const)
      expect(after[key],key).toEqual(before[key]);
    expect(after.workItems?.map(w=>[w.id,w.version,w.ownerId,w.plannedStart,w.plannedEnd,w.status])).toEqual(before.workItems?.map(w=>[w.id,w.version,w.ownerId,w.plannedStart,w.plannedEnd,w.status]));
    expect(after.background).toBe('简短描述');
    expect((await call<ImportPreview>('preview_requirement_import',{projectId,package:pkg})).errors.some(e=>e.includes('版本变化'))).toBe(true);
  });
}
it('MCP 导入显式 null 和空字符串可以清空，省略的其他资料保留',async()=>{
  const {projectId,before}=await importFixture(false);
  const pkg={formatVersion:3,requirements:[{key:'existing',action:'update',existingId:before.id,expectedVersion:before.version,title:before.title,ownerId:null,acceptanceCriteria:'',referenceUrl:null}]};
  const preview=await call<ImportPreview>('preview_requirement_import',{projectId,package:pkg});expect(preview.errors).toEqual([]);
  await call('apply_requirement_import',{projectId,package:preview.package,expectedRevision:preview.expectedRevision,previewToken:preview.previewToken,batchId:randomUUID()});
  expect(await detail(before.id)).toMatchObject({ownerId:null,acceptanceCriteria:null,referenceUrl:null,background:before.background,plannedStart:before.plannedStart,plannedEnd:before.plannedEnd});
});
