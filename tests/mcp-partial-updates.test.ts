import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,scryptSync} from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import type {FastifyInstance} from 'fastify';
import type {Feature,ImportPreview,ImportReceipt} from '../src/shared/intake';
import type {FeaturePhase} from '../src/shared/feature-phases';
import type {Requirement} from '../src/client/types';
import {mcpRequest} from './mcp-request';

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pm-mcp-partial-')),password='partial-update-test';
Object.assign(process.env,{DB_PATH:path.join(directory,'test.db'),BACKUP_DIR:path.join(directory,'backups'),WEB_DIST_DIR:path.join(directory,'web'),SEED_DEMO:'0',NODE_ENV:'test',
  APP_PASSWORD_HASH:'scrypt$partial$'+scryptSync(password,'partial',64).toString('hex'),SESSION_SECRET:'partial-update-test-secret-more-than-thirty-two-characters'});
let app:FastifyInstance,origin:string,cookie:string,token:string;
beforeAll(async()=>{
  app=await(await import('../src/server/app')).buildApp();
  origin=await app.listen({host:'127.0.0.1',port:0});
  const login=await app.inject({method:'POST',url:'/api/login',payload:{username:'admin',password}});
  cookie=String(login.headers['set-cookie']).split(';')[0];
  token=(await post('/api/tokens',{name:'partial updates'})).token;
});
afterAll(async()=>{await app?.close();const {sqlite}=await import('../src/server/database');if(sqlite.open)sqlite.close();fs.rmSync(directory,{recursive:true,force:true});});
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
