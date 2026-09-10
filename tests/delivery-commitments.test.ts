
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,scryptSync} from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type {FastifyInstance} from 'fastify';
import type {PathAnalysis} from '../src/shared/paths';
import type {Requirement} from '../src/client/types';


import { todayIso } from '../src/shared/domain';
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
  const r=(await post('/api/requirements',{projectId:project.id,ownerId:owner.id,title:'交付接口',plannedStart:todayIso(),durationDays:3})).json<Requirement>();
  return {projectId:project.id as string,r,owner};
}
async function batch(projectId:string,changes:Record<string,unknown>){
  const a=await get<PathAnalysis>('/api/projects/'+projectId+'/path-analysis');
  const input={expectedRevision:a.revision,target:'project',changes:{add:[],remove:[],estimates:[],...changes}};
  const preview=await post('/api/projects/'+projectId+'/dependency-changes/preview',input);
  return {input,preview,body:{...input,batchId:randomUUID(),previewToken:preview.json().previewToken}};
}
it('新批次拒绝承诺确认、预测核对和阻塞字段，保留原计划',async()=>{
 const {projectId,r}=await fixture();const before=await get<Requirement>('/api/requirements/'+r.id);
 for(const changes of [{commitment:{reason:'旧流程'}},{estimates:[{workItemId:'missing',reviewForecast:{remainingDays:2}}]},{entities:[{entity:'requirement',op:'update',id:r.id,expectedVersion:r.version,data:{blockedCoordinatorId:'legacy'}}]}]){
  expect((await batch(projectId,changes)).preview.statusCode).toBe(400);
 }
 expect(await get('/api/requirements/'+r.id)).toEqual(before);
 expect((await request('GET','/api/projects/'+projectId+'/delivery-commitments')).statusCode).toBe(410);
});
it('统计目录仅保留当前计划按期率，旧保存面板自动使用工作完成日期',async()=>{
 const {projectId}=await fixture(),catalog=await get<{datasets:Array<{id:string;measures:Array<{id:string}>}>}>('/api/analytics/catalog');
 const measures=catalog.datasets.find(d=>d.id==='requirements')!.measures.map(m=>m.id);expect(measures).toContain('on_time_rate');expect(measures).not.toContain('commitment_on_time_rate');expect(measures).not.toContain('latest_commitment_on_time_rate');
 const {queryAnalytics}=await import('../src/server/analytics');
 const result=queryAnalytics({projectId,range:{from:'2026-01-01',to:'2026-12-31'},panels:[{id:'history-panel',title:'按首次承诺交付率',dataset:'requirements',measure:'commitment_on_time_rate',visualization:'kpi',size:'small',timeScope:'range'}]});
 expect(result).toBeDefined();
});
