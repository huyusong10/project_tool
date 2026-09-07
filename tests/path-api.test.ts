import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {scryptSync} from 'node:crypto';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import type {FastifyInstance} from 'fastify';
import type {PathAnalysis} from '../src/shared/paths';
import type {Requirement,WorkItemTemplate} from '../src/client/types';
import {addBusinessDays,todayIso} from '../src/shared/domain';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pm-path-api-'));
const password='path-api-private-test-password';
Object.assign(process.env,{DB_PATH:path.join(directory,'test.db'),BACKUP_DIR:path.join(directory,'backups'),WEB_DIST_DIR:path.join(directory,'web'),SEED_DEMO:'0',NODE_ENV:'test',APP_PASSWORD_HASH:`scrypt$paths$${scryptSync(password,'paths',64).toString('hex')}`,SESSION_SECRET:'path-api-test-secret-more-than-thirty-two-characters'});
let app:FastifyInstance,cookie='',origin='',token='',sequence=0;
const request=(method:'POST'|'PATCH'|'GET'|'DELETE',url:string,payload?:Record<string,unknown>,auth=cookie)=>app.inject({method,url,headers:{cookie:auth},payload});
const post=(url:string,payload:Record<string,unknown>)=>request('POST',url,payload);
const detail=async(id:string)=>(await request('GET',`/api/requirements/${id}`)).json<Requirement>();
const analysis=async(id:string)=>(await request('GET',`/api/projects/${id}/path-analysis`)).json<PathAnalysis>();
async function fixture(legacy=false){
 const project=(await post('/api/projects',{name:`路径验证${++sequence}`,plannedEnd:addBusinessDays(todayIso(),15)})).json();
 const owner=(await post('/api/people',{projectId:project.id,name:`路径负责人${sequence}`})).json();
 const templateResponse=await post('/api/templates',{projectId:project.id,name:'实施流程',dependencyMode:legacy?'legacy':'dependencies',items:[
  {clientKey:'design',title:'设计',durationDays:2,startOffsetDays:0,sortOrder:0,predecessorKeys:[]},
  {clientKey:'build',title:'开发',durationDays:2,startOffsetDays:2,sortOrder:1,predecessorKeys:legacy?[]:['design']},
  {clientKey:'verify',title:'联调',durationDays:1,startOffsetDays:4,sortOrder:2,predecessorKeys:legacy?[]:['build']}]});
 expect(templateResponse.statusCode,templateResponse.body).toBe(200);const template=templateResponse.json<WorkItemTemplate>();
 const create=async(title:string)=>{const r=await post('/api/requirements',{projectId:project.id,ownerId:owner.id,templateId:template.id,title,plannedStart:addBusinessDays(todayIso(),0)});expect(r.statusCode,r.body).toBe(200);return r.json<Requirement>();};
 const a=await create('需求 A'),b=await create('需求 B');
 return {projectId:project.id as string,owner,template,a,b};
}
async function add(projectId:string,sourceRequirementId:string,sourceWorkItemId:string|null,targetRequirementId:string,targetWorkItemId:string|null,revision?:number){return post(`/api/projects/${projectId}/dependencies`,{sourceRequirementId,sourceWorkItemId,targetRequirementId,targetWorkItemId,expectedRevision:revision??(await analysis(projectId)).revision});}
async function mcp(name:string,args:Record<string,unknown>){const result=await fetch(`${origin}/mcp`,{method:'POST',headers:{authorization:`Bearer ${token}`,accept:'application/json, text/event-stream','content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});const body=await result.json();return body.result.structuredContent;}
beforeAll(async()=>{app=await(await import('../src/server/app')).buildApp();origin=await app.listen({host:'127.0.0.1',port:0});const login=await request('POST','/api/login',{username:'admin',password},'');cookie=String(login.headers['set-cookie']).split(';')[0];token=(await post('/api/tokens',{name:'路径验证'})).json().token;});
afterAll(async()=>{vi.useRealTimers();await app.close();const{sqlite}=await import('../src/server/database');if(sqlite.open)sqlite.close();fs.rmSync(directory,{recursive:true,force:true});});
it('模板复制和实例化保留前置；旧模板不推断关系或改写历史日期',async()=>{
 const f=await fixture();const initial=await analysis(f.projectId);expect(initial.dependencies).toHaveLength(4);expect(initial.coverage.reviewed).toBe(2);
 const copy=await post(`/api/projects/${f.projectId}/templates/${f.template.id}/copy`,{});expect(copy.statusCode,copy.body).toBe(200);
 const copied=copy.json<WorkItemTemplate>();expect(copied.dependencyMode).toBe('dependencies');expect(copied.items[1].predecessorIds).toEqual([copied.items[0].id]);
 const old=await fixture(true),before=(await detail(old.a.id)).workItems;expect((await analysis(old.projectId)).dependencies).toEqual([]);expect((await analysis(old.projectId)).forecastEnd).toBeNull();
 await post(`/api/requirements/${old.a.id}/dependency-review`,{expectedRevision:(await analysis(old.projectId)).revision,reviewed:true});expect((await detail(old.a.id)).workItems).toEqual(before);
});
it('部分交付允许 A设计→B开发→A联调；执行循环拒绝且版本不变',async()=>{
 const {projectId,a,b}=await fixture();expect((await add(projectId,a.id,a.workItems[0].id,b.id,b.workItems[1].id)).statusCode).toBe(200);
 expect((await add(projectId,b.id,b.workItems[1].id,a.id,a.workItems[2].id)).statusCode).toBe(200);
 const before=await analysis(projectId);const rejected=await add(projectId,a.id,a.workItems[2].id,a.id,a.workItems[0].id);expect(rejected.statusCode).toBe(409);expect(rejected.json().error).toContain('循环');
 const after=await analysis(projectId);expect(after.revision).toBe(before.revision);expect(after.dependencies).toEqual(before.dependencies);
});
it('并发反向关系仅一次成功；REST和MCP共用关系、版本及循环校验',async()=>{
 const {projectId,a,b}=await fixture();const revision=(await analysis(projectId)).revision;
 const outcomes=await Promise.all([add(projectId,a.id,null,b.id,null,revision),add(projectId,b.id,null,a.id,null,revision)]);expect(outcomes.map(r=>r.statusCode).sort()).toEqual([200,409]);
 const accepted=outcomes[0].statusCode===200?{sourceRequirementId:b.id,targetRequirementId:a.id}:{sourceRequirementId:a.id,targetRequirementId:b.id};
 const failed=await mcp('add_dependency',{projectId,...accepted,expectedRevision:(await analysis(projectId)).revision});expect(failed.statusCode).toBe(409);
 const result=await mcp('get_path_analysis',{projectId});expect(result.result.revision).toBe((await analysis(projectId)).revision);
});
it('排期预览因工期、关系和跨日变化失效；应用保留实际记录',async()=>{
 const {projectId,a}=await fixture();let before=await analysis(projectId);let input={expectedRevision:before.revision,baseStart:addBusinessDays(todayIso(),3)};
 const preview=(await post(`/api/requirements/${a.id}/dependency-plan/preview`,input)).json();expect(preview.applicable).toBe(true);
 await request('PATCH',`/api/work-items/${a.workItems[0].id}/path-estimate`,{expectedRevision:before.revision,durationDays:3});
 expect((await post(`/api/requirements/${a.id}/dependency-plan/apply`,{...input,previewToken:preview.previewToken})).statusCode).toBe(409);
 before=await analysis(projectId);input={...input,expectedRevision:before.revision};const fresh=(await post(`/api/requirements/${a.id}/dependency-plan/preview`,input)).json();
 const actual=(await detail(a.id)).workItems.map(w=>[w.actualStart,w.actualEnd]);const applied=await post(`/api/requirements/${a.id}/dependency-plan/apply`,{...input,previewToken:fresh.previewToken});expect(applied.statusCode,applied.body).toBe(200);expect((await detail(a.id)).workItems.map(w=>[w.actualStart,w.actualEnd])).toEqual(actual);
 const next={...input,expectedRevision:(await analysis(projectId)).revision};const nextPreview=(await post(`/api/requirements/${a.id}/dependency-plan/preview`,next)).json();
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(Date.now()+86400000));const savedCookie=cookie;const nextLogin=await request('POST','/api/login',{username:'admin',password},'');cookie=String(nextLogin.headers['set-cookie']).split(';')[0];const stale=await post(`/api/requirements/${a.id}/dependency-plan/apply`,{...next,previewToken:nextPreview.previewToken});vi.useRealTimers();cookie=savedCookie;expect(stale.json().code).toBe('STALE_WRITE');
});
it('旧补全计划预览也绑定依赖版本，不能绕过新关系变动',async()=>{
 const {projectId,a,b,template}=await fixture();const input={templateId:template.id,baseStart:addBusinessDays(todayIso(),0)};const preview=(await post(`/api/requirements/${a.id}/plan-preview`,input)).json();
 await add(projectId,a.id,a.workItems[0].id,b.id,b.workItems[1].id);
 const applied=await post(`/api/requirements/${a.id}/apply-plan`,{...input,expectedVersion:a.version,previewToken:preview.previewToken});expect(applied.statusCode).toBe(409);
});
it('开始复核全部前置；执行例外记录原因且旧依赖版本不能确认',async()=>{
 const {projectId,a,owner}=await fixture();const w=a.workItems[1];const updated=await request('PATCH',`/api/work-items/${w.id}`,{expectedVersion:w.version,ownerId:owner.id});expect(updated.statusCode,updated.body).toBe(200);
 const item=(await detail(a.id)).workItems[1];expect(item.unmetPredecessors).toHaveLength(1);
 expect((await post(`/api/work-items/${w.id}/start`,{expectedVersion:item.version})).statusCode).toBe(409);
 expect((await post(`/api/work-items/${w.id}/start`,{expectedVersion:item.version,reason:'先验证独立部分',expectedDependencyRevision:0})).statusCode).toBe(409);
 const started=await post(`/api/work-items/${w.id}/start`,{expectedVersion:item.version,reason:'先验证独立部分',expectedDependencyRevision:item.dependencyRevision});expect(started.statusCode,started.body).toBe(200);
 expect((await detail(a.id)).progressUpdates!.some(u=>u.eventType==='start'&&u.content==='先验证独立部分')).toBe(true);expect((await analysis(projectId)).forecastEnd).toBeNull();
});
it('未登录、跨项目、普通成员和需求负责人权限由服务端裁决',async()=>{
 const f=await fixture();expect((await request('GET',`/api/projects/${f.projectId}/path-analysis`,undefined,'')).statusCode).toBe(401);
 const outsider=(await post('/api/projects',{name:`外部项目${++sequence}`})).json();expect((await add(f.projectId,f.a.id,f.a.workItems[0].id,outsider.id,null)).statusCode).toBe(400);
 const login=await request('POST','/api/login',{username:f.owner.name,password:'888888'},'');let ownerCookie=String(login.headers['set-cookie']).split(';')[0];
 const changed=await request('POST','/api/account/change-password',{currentPassword:'888888',newPassword:'paths-owner-test-123'},ownerCookie);ownerCookie=String(changed.headers['set-cookie']).split(';')[0];
 expect((await request('GET',`/api/projects/${outsider.id}/path-analysis`,undefined,ownerCookie)).statusCode).toBe(403);
 const body={sourceRequirementId:f.a.id,sourceWorkItemId:f.a.workItems[0].id,targetRequirementId:f.b.id,targetWorkItemId:f.b.workItems[2].id,expectedRevision:(await analysis(f.projectId)).revision};
 expect((await request('POST',`/api/projects/${f.projectId}/dependencies`,body,ownerCookie)).statusCode).toBe(403);
 const internal=await request('POST',`/api/projects/${f.projectId}/dependencies`,{...body,targetRequirementId:f.a.id,targetWorkItemId:f.a.workItems[2].id},ownerCookie);expect(internal.statusCode,internal.body).toBe(200);
});
it('重新启动不会重复迁移或关系，历史日期不变',async()=>{
 const f=await fixture();const before=await analysis(f.projectId),workBefore=(await detail(f.a.id)).workItems;await app.close();app=await(await import('../src/server/app')).buildApp();origin=await app.listen({host:'127.0.0.1',port:0});
 expect((await analysis(f.projectId)).dependencies).toEqual(before.dependencies);expect((await detail(f.a.id)).workItems).toEqual(workBefore);
});

it('人工预计工作量在阻塞及解阻时暂停计时，历史预测日期仍保留',async()=>{
 const {a,owner,projectId}=await fixture();const w=a.workItems[0];await request('PATCH',`/api/work-items/${w.id}`,{expectedVersion:w.version,ownerId:owner.id});let item=(await detail(a.id)).workItems[0];await post(`/api/work-items/${w.id}/start`,{expectedVersion:item.version});
 await request('PATCH',`/api/work-items/${w.id}/path-estimate`,{expectedRevision:(await analysis(projectId)).revision,forecastEnd:addBusinessDays(todayIso(),5)});
 const {sqlite}=await import('../src/server/database');const {adjustForecastClock}=await import('../src/server/services/paths');const before=sqlite.prepare('SELECT forecast_duration AS duration FROM work_items WHERE id=?').get(w.id) as {duration:number};
 adjustForecastClock(w.id,'block',addBusinessDays(todayIso(),1));adjustForecastClock(w.id,'unblock',addBusinessDays(todayIso(),4));const clock=sqlite.prepare('SELECT forecast_duration AS duration,forecast_ready_at AS ready FROM work_items WHERE id=?').get(w.id) as {duration:number;ready:string};expect(clock.duration).toBe(before.duration-1);expect(clock.ready).toBe(addBusinessDays(todayIso(),4));
 item=(await detail(a.id)).workItems[0];expect(item.forecastEnd).toBe(addBusinessDays(todayIso(),5));
});
