
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,scryptSync} from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type {FastifyInstance} from 'fastify';
import type {PathAnalysis} from '../src/shared/paths';
import type {Requirement} from '../src/client/types';


import { addBusinessDays, todayIso } from '../src/shared/domain';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pm-commitment-')),password='commitment-test-password';
Object.assign(process.env,{DB_PATH:path.join(directory,'test.db'),BACKUP_DIR:path.join(directory,'backups'),WEB_DIST_DIR:path.join(directory,'web'),SEED_DEMO:'0',NODE_ENV:'test',APP_PASSWORD_HASH:`scrypt$commitment$${scryptSync(password,'commitment',64).toString('hex')}`,SESSION_SECRET:'commitment-isolated-secret-at-least-thirty-two-characters'});
let app:FastifyInstance,cookie='';
const request=(method:'GET'|'POST'|'PATCH'|'PUT',url:string,payload?:unknown)=>app.inject({method,url,headers:{cookie},payload:payload as Record<string,unknown>});
const post=(url:string,payload:unknown)=>request('POST',url,payload);
const get=async<T>(url:string)=>(await request('GET',url)).json<T>();
beforeAll(async()=>{app=await(await import('../src/server/app')).buildApp();await app.ready();const response=await post('/api/login',{username:'admin',password});cookie=String(response.headers['set-cookie']).split(';')[0];});
afterAll(async()=>{await app.close();(await import('./support/database')).sqlite.close();fs.rmSync(directory,{recursive:true,force:true});});
async function fixture(){
  const project=(await post('/api/projects',{name:'承诺'+randomUUID()})).json();
  const owner=(await post('/api/people',{projectId:project.id,name:'负责人'+randomUUID()})).json();
  const response=await post('/api/requirements',{projectId:project.id,ownerId:owner.id,title:'交付接口',plannedStart:addBusinessDays(todayIso(),0),durationDays:3});
  expect(response.statusCode,response.body).toBe(200);const r=response.json<Requirement>();
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
it('旧承诺对比指标合并后保留整份个人布局、当前完成样本和原始历史',async()=>{
 const {projectId,r}=await fixture(),{sqlite}=await import('./support/database');
 const account=(await get<{accountId:string}>('/api/session')).accountId,now='2026-09-01T00:00:00.000Z';
 expect(r.workItems).toHaveLength(0);
 sqlite.prepare("UPDATE requirements SET status='completed',execution_mode='direct',progress=100,planned_start='2026-09-01',planned_end='2026-09-10',actual_start='2026-09-01',actual_end='2026-09-09',accepted_at='2026-08-15' WHERE id=?").run(r.id);
 for(const [title,end,archived] of [['延期样本','2026-09-11',null],['归档样本','2026-09-09',now]])sqlite.prepare("INSERT INTO requirements(id,project_id,title,status,execution_mode,progress,planned_start,planned_end,actual_start,actual_end,accepted_at,created_at,updated_at,deleted_at) VALUES(?,?,?,'completed','direct',100,'2026-09-01','2026-09-10','2026-09-01',?,'2026-08-15',?,?,?)").run(randomUUID(),projectId,title,end,now,now,archived);
 const measures=['commitment_on_time_rate','latest_commitment_on_time_rate','on_time_rate'];
 const comparisons=measures.flatMap(measure=>measures.filter(secondary=>secondary!==measure).map(secondaryMeasure=>({id:'legacy-'+measures.indexOf(measure)+'-'+measures.indexOf(secondaryMeasure),title:'历史对比 '+measure+' '+secondaryMeasure,dataset:'requirements',measure,secondaryMeasure,visualization:'table',size:'medium',timeScope:'range',sort:'asc',limit:7,filters:{status:['completed'],deliveryScope:['committed']}})));
 const panels=[{id:'current',title:'保留自定义卡片',dataset:'requirements',measure:'count',visualization:'kpi',size:'small',timeScope:'snapshot'},...comparisons];
 const stored=JSON.stringify({version:1,panels});
 sqlite.prepare('INSERT INTO analytics_layouts(account_id,config_json,created_at,updated_at) VALUES(?,?,?,?)').run(account,stored,now,now);
 const history=()=>({layout:sqlite.prepare('SELECT * FROM analytics_layouts WHERE account_id=?').get(account),requirements:sqlite.prepare('SELECT * FROM requirements WHERE project_id=? ORDER BY id').all(projectId),audit:sqlite.prepare('SELECT * FROM audit_logs ORDER BY rowid').all()});
 const before=history(),layout=await get<{source:string;updatedAt:string;layout:{version:number;panels:Array<Record<string,unknown>>}}>('/api/analytics/layout');
 expect(layout.source).toBe('personal');expect(layout.updatedAt).toBe(now);
 expect(layout.layout.panels).toEqual([panels[0],...comparisons.map(({secondaryMeasure:_secondary,...panel})=>({...panel,measure:'on_time_rate',filters:{status:['completed']}}))]);
 const queried=await post('/api/analytics/query',{projectId,range:{from:'2026-09-01',to:'2026-09-30'},panels});
 expect(queried.statusCode,queried.body).toBe(200);
 for(const result of queried.json().results.slice(1))expect(result).toMatchObject({measureLabel:'按期完成率',unit:'percent',rows:[{value:50,sampleCount:2}]});
 expect(queried.json().results[0].rows).toMatchObject([{value:2}]);
 expect(history()).toEqual(before);
 const unchanged=await request('PUT','/api/analytics/layout',{...layout.layout,expectedUpdatedAt:now});
 expect(unchanged.statusCode,unchanged.body).toBe(200);expect(unchanged.json().updatedAt).toBe(now);expect(history()).toEqual(before);
 const invalid=await post('/api/analytics/query',{projectId,range:{from:'2026-09-01',to:'2026-09-30'},panels:[{...comparisons[0],measure:'on_time_rate',secondaryMeasure:'on_time_rate'}]});
 expect(invalid.statusCode).toBe(400);expect(history()).toEqual(before);
});
