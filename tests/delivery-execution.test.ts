import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scryptSync } from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import type {FastifyInstance} from 'fastify';
import type {Requirement} from '../src/client/types';
import type {PathAnalysis} from '../src/shared/paths';
import {addBusinessDays,todayIso} from '../src/shared/domain';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pm-delivery-')),password='delivery-isolated-test';
Object.assign(process.env,{DB_PATH:path.join(directory,'test.db'),BACKUP_DIR:path.join(directory,'backups'),WEB_DIST_DIR:path.join(directory,'web'),SEED_DEMO:'0',NODE_ENV:'test',APP_PASSWORD_HASH:`scrypt$delivery$${scryptSync(password,'delivery',64).toString('hex')}`,SESSION_SECRET:'delivery-api-test-secret-more-than-thirty-two-characters'});
let app:FastifyInstance,cookie='',sequence=0;
const req=(method:'POST'|'PATCH'|'GET',url:string,payload?:Record<string,unknown>,auth=cookie)=>app.inject({method,url,headers:{cookie:auth},payload});
const post=(url:string,data:Record<string,unknown>)=>req('POST',url,data);
const detail=async(id:string)=>(await req('GET','/api/requirements/'+id)).json<Requirement>();
const analysis=async(id:string)=>(await req('GET','/api/projects/'+id+'/path-analysis')).json<PathAnalysis>();
beforeAll(async()=>{app=await(await import('../src/server/app')).buildApp();await app.ready();const r=await req('POST','/api/login',{username:'admin',password},'');cookie=String(r.headers['set-cookie']).split(';')[0];});
afterAll(async()=>{await app.close();const{sqlite}=await import('../src/server/database');sqlite.close();fs.rmSync(directory,{recursive:true,force:true});});
async function fixture(extra:Record<string,unknown>={}){
 const project=(await post('/api/projects',{name:'交付测试'+(++sequence)})).json();
 const owner=(await post('/api/people',{projectId:project.id,name:'交付负责人'+sequence})).json();
 const r=await post('/api/requirements',{projectId:project.id,title:'直接需求',ownerId:owner.id,...extra});expect(r.statusCode,r.body).toBe(200);
 return {projectId:project.id as string,owner,r:r.json<Requirement>()};
}
async function command(id:string,action:string,data:Record<string,unknown>={}){const current=await detail(id);return post('/api/requirements/'+id+'/'+action,{expectedVersion:current.version,...data});}
it('标题即可录入，没有工作项时直接开始、更新、完成和返工',async()=>{
 const {r,projectId}=await fixture();expect(r.workItems).toEqual([]);expect(r.status).toBe('not_started');
 expect((await analysis(projectId)).nodes.some(n=>n.kind==='execution')).toBe(true);
 expect((await command(r.id,'start')).statusCode).toBe(200);
 expect((await command(r.id,'progress',{content:'接口已实现',requirementPercent:30})).statusCode).toBe(200);
 const completed=await command(r.id,'complete',{content:'验证通过'});expect(completed.statusCode,completed.body).toBe(200);
 expect(completed.json()).toMatchObject({status:'completed',progress:100,actualEnd:todayIso(),acceptedAt:null});
 expect((await command(r.id,'rework',{reason:'补充验证',progress:80})).statusCode).toBe(200);
 const after=await detail(r.id);expect(after).toMatchObject({status:'in_progress',progress:80,actualEnd:null});expect(after.progressUpdates?.some(e=>e.eventType==='complete')).toBe(true);
});
it('普通进展不能回退进度，过期写入不改变版本及历史',async()=>{
 const {r}=await fixture();await command(r.id,'start');await command(r.id,'progress',{content:'完成六成',requirementPercent:60});const before=await detail(r.id);
 expect((await command(r.id,'progress',{content:'误填',requirementPercent:20})).statusCode).toBe(400);
 expect((await post('/api/requirements/'+r.id+'/complete',{expectedVersion:r.version})).statusCode).toBe(409);expect(await detail(r.id)).toEqual(before);
});
it('完成采用实际日期，补录时间和历史验收时间不造成延期',async()=>{
 const end=addBusinessDays(todayIso(),-2),start=addBusinessDays(end,-2),{r}=await fixture({plannedStart:start,plannedEnd:end});
 await command(r.id,'start');const {sqlite}=await import('../src/server/database');sqlite.prepare('UPDATE requirements SET actual_start=? WHERE id=?').run(start,r.id);
 const response=await command(r.id,'complete',{actualEnd:end});expect(response.statusCode,response.body).toBe(200);
 expect(response.json()).toMatchObject({status:'completed',actualEnd:end,finishVariance:0,delayed:false});
 sqlite.prepare('UPDATE requirements SET accepted_at=? WHERE id=?').run(todayIso(),r.id);expect(await detail(r.id)).toMatchObject({finishVariance:0,delayed:false});
});
it('添加工作项后自动汇总，全部有效工作完成即完成需求',async()=>{
 const {r,owner}=await fixture();await command(r.id,'start');await command(r.id,'progress',{content:'已有成果',requirementPercent:30});
 let parent=await detail(r.id);let a=(await post('/api/requirements/'+r.id+'/work-items',{expectedVersion:parent.version,title:'工作一',ownerId:owner.id})).json();
 parent=await detail(r.id);let b=(await post('/api/requirements/'+r.id+'/work-items',{expectedVersion:parent.version,title:'工作二',ownerId:owner.id,reason:'继续分工'})).json();
 expect((await detail(r.id)).progress).toBe(30);
 a=(await post('/api/work-items/'+a.id+'/start',{expectedVersion:a.version})).json();expect((await post('/api/work-items/'+a.id+'/complete',{expectedVersion:a.version})).statusCode).toBe(200);expect((await detail(r.id)).progress).toBe(65);
 b=(await post('/api/work-items/'+b.id+'/start',{expectedVersion:b.version})).json();expect((await post('/api/work-items/'+b.id+'/complete',{expectedVersion:b.version})).statusCode).toBe(200);
 expect(await detail(r.id)).toMatchObject({status:'completed',progress:100,executionCompletedAt:todayIso(),acceptedAt:null});
});
it('依赖保留用于排期，不阻止记录真实开始',async()=>{
 const {r,projectId,owner}=await fixture({durationDays:2});const source=(await post('/api/requirements',{projectId,title:'前置工作',ownerId:owner.id,durationDays:3})).json();
 const a=await analysis(projectId);expect((await post('/api/projects/'+projectId+'/dependencies',{expectedRevision:a.revision,sourceRequirementId:source.id,sourceWorkItemId:null,targetRequirementId:r.id,targetWorkItemId:null})).statusCode).toBe(200);
 const before=await analysis(projectId);expect(before.forecastEnd).toBeTruthy();expect((await command(r.id,'start')).statusCode).toBe(200);expect((await analysis(projectId)).dependencies).toEqual(before.dependencies);
});
it('可以直接套用模板，没有日期时保留未排期',async()=>{
 const {r,projectId}=await fixture(),templates=(await req('GET','/api/templates?projectId='+projectId)).json();
 const response=await post('/api/requirements/'+r.id+'/apply-template',{expectedVersion:r.version,templateId:templates[0].id});expect(response.statusCode,response.body).toBe(200);
 expect(response.json().workItems.length).toBeGreaterThan(0);expect(response.json()).toMatchObject({status:'not_started',plannedStart:null,plannedEnd:null});
});
it.each(['deliveryScope','executionMode','acceptanceOwnerId','blockedCoordinatorId'])('旧字段 %s 被明确拒绝',async field=>{
 const {r}=await fixture();const before=await detail(r.id);const response=await req('PATCH','/api/requirements/'+r.id,{expectedVersion:r.version,[field]:'legacy'});expect(response.statusCode).toBe(400);expect(await detail(r.id)).toEqual(before);
});
