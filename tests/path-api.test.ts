import {listenTestApp} from './support/listen';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {scryptSync,randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import type {FastifyInstance} from 'fastify';
import type {PathAnalysis} from '../src/shared/paths';
import type {Requirement,WorkItem,WorkItemTemplate} from '../src/client/types';
import {addBusinessDays,todayIso} from '../src/shared/domain';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pm-path-api-'));
import type {DependencyChanges,DependencyChangePreview,DependencyChangeReceipt} from '../src/shared/path-contracts';

it('提交中审计失败时关系、估算、版本和回执全部回滚，同批次可安全重试',async()=>{
 const {projectId,a,b}=await fixture(),before=await analysis(projectId),changes:DependencyChanges={add:[{clientId:randomUUID(),sourceRequirementId:a.id,sourceWorkItemId:a.workItems[0].id,targetRequirementId:b.id,targetWorkItemId:b.workItems[1].id}],remove:[before.dependencies[0].id],estimates:[{workItemId:a.workItems[0].id,durationDays:7}]};
 const {input,preview,response}=await batchPreview(projectId,changes);expect(response.statusCode,response.body).toBe(200);
 const {sqlite}=await import('./support/database'),batchId=randomUUID(),body={...input,batchId,previewToken:preview.previewToken};
 sqlite.exec("CREATE TEMP TRIGGER reject_path_batch BEFORE INSERT ON audit_logs WHEN NEW.action='apply_dependency_changes' BEGIN SELECT RAISE(ABORT,'batch audit unavailable'); END");
 try{const rejected=await post('/api/projects/'+projectId+'/dependency-changes/apply',body);expect(rejected.statusCode).toBe(500);}
 finally{sqlite.exec('DROP TRIGGER reject_path_batch');}
 expect(await analysis(projectId)).toEqual(before);
 expect((await request('GET','/api/projects/'+projectId+'/dependency-changes/'+batchId)).json().status).toBe('not_found');
 const saved=await post('/api/projects/'+projectId+'/dependency-changes/apply',body);expect(saved.statusCode,saved.body).toBe(200);
 expect((await analysis(projectId)).nodes.find(n=>n.id===a.workItems[0].id)?.estimate.durationDays).toBe(7);
});

async function batchPreview(projectId:string,changes:DependencyChanges,revision?:number) {
  const input={expectedRevision:revision??(await analysis(projectId)).revision,target:'project',changes};
  const response=await post('/api/projects/'+projectId+'/dependency-changes/preview',input);
  return {input,response,preview:response.json<DependencyChangePreview>()};
}
it('批次按最终网络校验：移除旧前置再反向连接；预览无副作用，原子保存估算',async()=>{
  const {projectId,a}=await fixture(),before=await analysis(projectId),old=before.dependencies.find(d=>d.sourceWorkItemId===a.workItems[0].id)!;
  const edge={clientId:randomUUID(),sourceRequirementId:a.id,sourceWorkItemId:a.workItems[1].id,targetRequirementId:a.id,targetWorkItemId:a.workItems[0].id};
  // Adding the reverse alone is cyclic, while the complete replacement is valid.
  const invalid=await batchPreview(projectId,{add:[edge],remove:[],estimates:[]});
  expect(invalid.response.statusCode).toBe(409);expect(invalid.response.json().details.nodeIds).toContain(a.workItems[0].id);
  const {input,response,preview}=await batchPreview(projectId,{add:[edge],remove:[old.id],estimates:[{workItemId:a.workItems[0].id,durationDays:4}]});
  expect(response.statusCode,response.body).toBe(200);expect((await analysis(projectId)).revision).toBe(before.revision);
  expect(preview.analysis.nodes.find(n=>n.id===a.workItems[0].id)?.estimate.durationDays).toBe(4);
  const actual=(await detail(a.id)).workItems.map(w=>[w.plannedStart,w.plannedEnd,w.actualStart,w.actualEnd]);
  const batchId=randomUUID(),body={...input,batchId,previewToken:preview.previewToken};
  const applied=await post('/api/projects/'+projectId+'/dependency-changes/apply',body);expect(applied.statusCode,applied.body).toBe(200);
  const receipt=applied.json<DependencyChangeReceipt>(),after=await analysis(projectId);
  expect(after.dependencies.some(d=>d.id===old.id)).toBe(false);expect(after.dependencies.some(d=>d.id===receipt.addedIds[edge.clientId])).toBe(true);
  expect((await detail(a.id)).workItems.map(w=>[w.plannedStart,w.plannedEnd,w.actualStart,w.actualEnd])).toEqual(actual);
  const duplicate=await post('/api/projects/'+projectId+'/dependency-changes/apply',body);expect(duplicate.json()).toEqual(receipt);
  expect((await analysis(projectId)).revision).toBe(after.revision);
  expect((await request('GET','/api/projects/'+projectId+'/dependency-changes/'+batchId)).json()).toEqual({status:'applied',...receipt});
  const reused=await post('/api/projects/'+projectId+'/dependency-changes/apply',{...body,changes:{...input.changes,estimates:[]}});
  expect(reused.statusCode).toBe(409);expect((await analysis(projectId)).revision).toBe(after.revision);
});
it('失效端点、循环、过期版本及跨日批次全部拒绝，正式数据不变',async()=>{
  const {projectId,a,b}=await fixture(),before=await analysis(projectId);
  const changes:DependencyChanges={add:[{clientId:randomUUID(),sourceRequirementId:a.id,sourceWorkItemId:a.workItems[0].id,targetRequirementId:b.id,targetWorkItemId:b.workItems[1].id}],remove:[],estimates:[{workItemId:b.workItems[0].id,durationDays:5}]};
  const {input,preview}=await batchPreview(projectId,changes);
  const badEndpoint=await batchPreview(projectId,{...changes,estimates:[...changes.estimates,{workItemId:randomUUID(),durationDays:8}]});
  expect(badEndpoint.response.statusCode).not.toBe(200);
  const invalidToken=await post('/api/projects/'+projectId+'/dependency-changes/apply',{...input,batchId:randomUUID(),previewToken:'invalid'});
  expect(invalidToken.statusCode).toBe(409);expect((await analysis(projectId)).revision).toBe(before.revision);
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date(Date.now()+86400000));
  const originalCookie=cookie;const login=await request('POST','/api/login',{username:'admin',password},'');cookie=String(login.headers['set-cookie']).split(';')[0];
  const tomorrow=await post('/api/projects/'+projectId+'/dependency-changes/apply',{...input,batchId:randomUUID(),previewToken:preview.previewToken});
  vi.useRealTimers();cookie=originalCookie;expect(tomorrow.statusCode).toBe(409);
  await request('PATCH','/api/work-items/'+a.workItems[0].id+'/path-estimate',{expectedRevision:before.revision,durationDays:3});
  const now=await analysis(projectId);
  const stale=await post('/api/projects/'+projectId+'/dependency-changes/apply',{...input,batchId:randomUUID(),previewToken:preview.previewToken});
  expect(stale.statusCode).toBe(409);expect((await analysis(projectId)).dependencies).toEqual(now.dependencies);
  expect((await analysis(projectId)).nodes.find(n=>n.id===b.workItems[0].id)?.estimate.durationDays).toBe(2);
});
it('批次权限、MCP 与回执共用服务；包含越权关系时整批拒绝',async()=>{
  const {projectId,a,b,owner}=await fixture(),before=await analysis(projectId);
  const changes:DependencyChanges={add:[{clientId:randomUUID(),sourceRequirementId:a.id,sourceWorkItemId:a.workItems[0].id,targetRequirementId:b.id,targetWorkItemId:b.workItems[1].id}],remove:[],estimates:[{workItemId:a.workItems[0].id,durationDays:4}]};
  const login=await request('POST','/api/login',{username:owner.name,password:'888888'},'');let ownerCookie=String(login.headers['set-cookie']).split(';')[0];
  const passwordResponse=await request('POST','/api/account/change-password',{currentPassword:'888888',newPassword:'batch-owner-test-123'},ownerCookie);ownerCookie=String(passwordResponse.headers['set-cookie']).split(';')[0];
  const input={expectedRevision:before.revision,target:'project',changes};
  const rejected=await request('POST','/api/projects/'+projectId+'/dependency-changes/preview',input,ownerCookie);
  expect(rejected.statusCode).toBe(403);expect((await analysis(projectId)).revision).toBe(before.revision);
  const result=await mcp('preview_dependency_changes',{projectId,...input});expect(result.result?.previewToken,JSON.stringify(result)).toBeTruthy();
  const batchId=randomUUID();const applied=await mcp('apply_dependency_changes',{projectId,...input,batchId,previewToken:result.result.previewToken});
  expect(applied.result?.batchId,JSON.stringify(applied)).toBe(batchId);
  const receipt=await mcp('get_dependency_change_receipt',{projectId,batchId});expect(receipt.result.status).toBe('applied');
  const none=await request('GET','/api/projects/'+projectId+'/dependency-changes/'+randomUUID());expect(none.json().status).toBe('not_found');
  const otherActor=await request('GET','/api/projects/'+projectId+'/dependency-changes/'+batchId,undefined,ownerCookie);expect(otherActor.statusCode).toBe(404);
});

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
beforeAll(async()=>{app=await(await import('../src/server/app')).buildApp();origin=await listenTestApp(app);const login=await request('POST','/api/login',{username:'admin',password},'');cookie=String(login.headers['set-cookie']).split(';')[0];token=(await post('/api/tokens',{name:'路径验证'})).json().token;});
afterAll(async()=>{vi.useRealTimers();await app.close();const{sqlite}=await import('./support/database');if(sqlite.open)sqlite.close();fs.rmSync(directory,{recursive:true,force:true});});
it('排期编辑贯通存储、进度、拓扑和查询；估算单独修改且不重写实际历史', async () => {
 const {projectId,a,owner}=await fixture();
 let w=(await detail(a.id)).workItems[0];
 const assigned=await request('PATCH',`/api/work-items/${w.id}`,{expectedVersion:w.version,ownerId:owner.id});expect(assigned.statusCode,assigned.body).toBe(200);
 w=(await detail(a.id)).workItems[0];
 const start=await post(`/api/work-items/${w.id}/start`,{expectedVersion:w.version});expect(start.statusCode,start.body).toBe(200);
 w=(await detail(a.id)).workItems[0];
 const complete=await post(`/api/work-items/${w.id}/complete`,{expectedVersion:w.version,content:'开发完成'});expect(complete.statusCode,complete.body).toBe(200);
 const baseline=await detail(a.id),baselineAnalysis=await analysis(projectId),build=baseline.workItems[1];
 expect(baseline.progress).toBe(40);
 const {sqlite}=await import('./support/database');
 const facts=()=>sqlite.prepare('SELECT id,status,progress,actual_start,actual_end FROM work_items WHERE requirement_id=? ORDER BY id').all(a.id);
 const logs=()=>sqlite.prepare('SELECT * FROM progress_updates WHERE requirement_id=? ORDER BY rowid').all(a.id);
 const originalFacts=facts(),originalLogs=logs();
 const unchangedHistory=()=>expect(logs().slice(0,originalLogs.length)).toEqual(originalLogs);
 for(const patch of [{plannedEnd:addBusinessDays(todayIso(),12)},{plannedStart:null,plannedEnd:null},{plannedStart:todayIso(),plannedEnd:addBusinessDays(todayIso(),14)}]) {
   const current=(await detail(a.id)).workItems[1];
   const changed=await request('PATCH',`/api/work-items/${current.id}`,{expectedVersion:current.version,...patch});expect(changed.statusCode,changed.body).toBe(200);
   const r=await detail(a.id),snapshot=await analysis(projectId),node=snapshot.nodes.find(n=>n.id===current.id)!;
   expect(r.progress).toBe(40);expect(r.workItems[1]).toMatchObject({progressWeight:2,durationDays:2});
   expect(r.workItems[1].deliveryForecast).toMatchObject({revision:snapshot.revision,asOfDate:snapshot.asOfDate,start:node.forecastStart,end:node.forecastEnd});
   expect(node.forecastEnd).toBe(baselineAnalysis.nodes.find(n=>n.id===current.id)!.forecastEnd);
   expect(r.deliveryForecast?.revision).toBe(snapshot.revision);
   expect(facts()).toEqual(originalFacts);unchangedHistory();
 }
 const estimated=await request('PATCH',`/api/work-items/${build.id}/path-estimate`,{expectedRevision:(await analysis(projectId)).revision,durationDays:6});expect(estimated.statusCode,estimated.body).toBe(200);
 const r=await detail(a.id),snapshot=await analysis(projectId),node=snapshot.nodes.find(n=>n.id===build.id)!;
 expect(r.progress).toBe(40);expect(r.workItems[1]).toMatchObject({progressWeight:2,durationDays:6});
 expect(node.forecastEnd! > baselineAnalysis.nodes.find(n=>n.id===build.id)!.forecastEnd!).toBe(true);
 const single=(await request('GET',`/api/work-items/${build.id}`)).json();expect(single.deliveryForecast).toEqual(r.workItems[1].deliveryForecast);
 const done=snapshot.nodes.find(n=>n.id===w.id)!;expect(done.forecastStart!<=done.forecastEnd!).toBe(true);expect(done.scheduledStart).toBe(done.forecastStart);
 expect(facts()).toEqual(originalFacts);unchangedHistory();
});
it('模板复制和实例化保留前置；旧模板不推断关系或改写历史日期',async()=>{
 const f=await fixture();const initial=await analysis(f.projectId);expect(initial.dependencies).toHaveLength(4);expect(initial.coverage.reviewed).toBe(2);
 const copy=await post(`/api/projects/${f.projectId}/templates/${f.template.id}/copy`,{});expect(copy.statusCode,copy.body).toBe(200);
 const copied=copy.json<WorkItemTemplate>();expect(copied.dependencyMode).toBe('dependencies');expect(copied.items[1].predecessorIds).toEqual([copied.items[0].id]);
 const old=await fixture(true),before=(await detail(old.a.id)).workItems;expect((await analysis(old.projectId)).dependencies).toEqual([]);expect((await analysis(old.projectId)).coverage.reviewed).toBe(2);const {sqlite}=await import('./support/database');sqlite.prepare('UPDATE requirements SET dependencies_reviewed_at=NULL WHERE id=?').run(old.a.id);expect((await analysis(old.projectId)).forecastEnd).toBeTruthy();
 expect((await post(`/api/requirements/${old.a.id}/dependency-review`,{expectedRevision:(await analysis(old.projectId)).revision,reviewed:true})).statusCode).toBe(410);const stripDerived=(items:WorkItem[])=>items.map(({forecastBasis:_basis,deliveryForecast:_forecast,...w})=>w);expect(stripDerived((await detail(old.a.id)).workItems)).toEqual(stripDerived(before));
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
it('前置未完成时允许记录真实开始，并保留说明和依赖',async()=>{
 const {projectId,a,owner}=await fixture(),w=a.workItems[1];
 const assigned=await request('PATCH',`/api/work-items/${w.id}`,{expectedVersion:w.version,ownerId:owner.id});expect(assigned.statusCode).toBe(200);
 const item=(await detail(a.id)).workItems[1],before=await analysis(projectId);expect(item.unmetPredecessors).toHaveLength(1);
 const started=await post(`/api/work-items/${w.id}/start`,{expectedVersion:item.version,reason:'先验证独立部分'});expect(started.statusCode,started.body).toBe(200);
 expect((await detail(a.id)).progressUpdates!.some(u=>u.eventType==='start'&&u.content==='先验证独立部分')).toBe(true);
 expect((await analysis(projectId)).dependencies).toEqual(before.dependencies);
 expect((await post(`/api/work-items/${w.id}/start`,{expectedVersion:item.version})).statusCode).toBe(409);
});

it('未登录、跨项目、普通成员和需求负责人权限由服务端裁决',async()=>{
 const f=await fixture();expect((await request('GET',`/api/projects/${f.projectId}/path-analysis`,undefined,'')).statusCode).toBe(404);
 const outsider=(await post('/api/projects',{name:`外部项目${++sequence}`})).json();expect((await add(f.projectId,f.a.id,f.a.workItems[0].id,outsider.id,null)).statusCode).toBe(400);
 const login=await request('POST','/api/login',{username:f.owner.name,password:'888888'},'');let ownerCookie=String(login.headers['set-cookie']).split(';')[0];
 const changed=await request('POST','/api/account/change-password',{currentPassword:'888888',newPassword:'paths-owner-test-123'},ownerCookie);ownerCookie=String(changed.headers['set-cookie']).split(';')[0];
 expect((await request('GET',`/api/projects/${outsider.id}/path-analysis`,undefined,ownerCookie)).statusCode).toBe(404);
 const body={sourceRequirementId:f.a.id,sourceWorkItemId:f.a.workItems[0].id,targetRequirementId:f.b.id,targetWorkItemId:f.b.workItems[2].id,expectedRevision:(await analysis(f.projectId)).revision};
 expect((await request('POST',`/api/projects/${f.projectId}/dependencies`,body,ownerCookie)).statusCode).toBe(403);
 const internal=await request('POST',`/api/projects/${f.projectId}/dependencies`,{...body,targetRequirementId:f.a.id,targetWorkItemId:f.a.workItems[2].id},ownerCookie);expect(internal.statusCode,internal.body).toBe(200);
});
it('重新启动不会重复迁移或关系，历史日期不变',async()=>{
 const f=await fixture();const before=await analysis(f.projectId),workBefore=(await detail(f.a.id)).workItems;await app.close();app=await(await import('../src/server/app')).buildApp();origin=await listenTestApp(app);
 expect((await analysis(f.projectId)).dependencies).toEqual(before.dependencies);expect((await detail(f.a.id)).workItems).toEqual(workBefore);
});

it('人工预计工作量在阻塞及解阻时暂停计时，历史预测日期仍保留',async()=>{
 const {a,owner,projectId}=await fixture();const w=a.workItems[0];await request('PATCH',`/api/work-items/${w.id}`,{expectedVersion:w.version,ownerId:owner.id});let item=(await detail(a.id)).workItems[0];await post(`/api/work-items/${w.id}/start`,{expectedVersion:item.version});
 await request('PATCH',`/api/work-items/${w.id}/path-estimate`,{expectedRevision:(await analysis(projectId)).revision,forecastEnd:addBusinessDays(todayIso(),5)});
 const {sqlite}=await import('./support/database');const {adjustForecastClock}=await import('../src/server/services/paths');const before=sqlite.prepare('SELECT forecast_duration AS duration FROM work_items WHERE id=?').get(w.id) as {duration:number};
 adjustForecastClock(w.id,'block',addBusinessDays(todayIso(),1));adjustForecastClock(w.id,'unblock',addBusinessDays(todayIso(),4));const clock=sqlite.prepare('SELECT forecast_duration AS duration,forecast_ready_at AS ready FROM work_items WHERE id=?').get(w.id) as {duration:number;ready:string};expect(clock.duration).toBe(before.duration-1);expect(clock.ready).toBe(addBusinessDays(todayIso(),4));
 item=(await detail(a.id)).workItems[0];expect(item.forecastEnd).toBe(addBusinessDays(todayIso(),5));
});

it('图形批次：创建需求、工作项、独立里程碑与共享位置，预览不写库，重复提交只创建一次',async()=>{
 const {projectId,owner}=await fixture(),{sqlite}=await import('./support/database');
 const r=randomUUID(),w=randomUUID(),m=randomUUID(),edge=randomUUID();
 const counts=()=>['requirements','work_items','milestones','diagram_layouts','audit_logs'].map(t=>sqlite.prepare('SELECT COUNT(*) AS n FROM '+t).get());
 const before=counts(),changes:DependencyChanges={add:[{clientId:edge,sourceRequirementId:r,sourceWorkItemId:w,targetRequirementId:r,targetMilestoneId:m,targetWorkItemId:null}],remove:[],estimates:[],entities:[
 {entity:'requirement',op:'create',id:r,data:{title:'画布新增',ownerId:owner.id}},
 {entity:'work',op:'create',id:w,requirementId:r,data:{title:'新增工作',durationDays:1,ownerId:owner.id}},
 {entity:'milestone',op:'create',id:m,requirementId:r,data:{title:'独立交付',confirmationMode:'auto'}}],layouts:[{scope:'requirement:'+r,direction:'right',expectedVersion:0,positions:{[w]:{x:20,y:30},[m]:{x:400,y:30}}}]};
 const {input,response,preview}=await batchPreview(projectId,changes);expect(response.statusCode,response.body).toBe(200);expect(counts()).toEqual(before);
 const body={...input,batchId:randomUUID(),previewToken:preview.previewToken};const saved=await post('/api/projects/'+projectId+'/dependency-changes/apply',body);expect(saved.statusCode,saved.body).toBe(200);
 const receipt=saved.json<DependencyChangeReceipt>(),actual=await detail(receipt.addedIds[r]);expect(actual.workItems).toHaveLength(1);expect(actual.workItems[0].id).toBe(receipt.addedIds[w]);
 const graph=await analysis(projectId);expect(graph.milestones?.find(n=>n.id===receipt.addedIds[m])?.requirementId).toBe(actual.id);expect(graph.layouts?.find(l=>l.scope==='requirement:'+actual.id)?.positions[receipt.addedIds[w]]).toEqual({x:20,y:30});
 const after=counts();expect((await post('/api/projects/'+projectId+'/dependency-changes/apply',body)).json()).toEqual(receipt);expect(counts()).toEqual(after);
 const layoutOnly=await batchPreview(projectId,{add:[],remove:[],estimates:[],layouts:[{scope:'global',direction:'right',expectedVersion:0,positions:{[actual.id]:{x:120,y:50}}}]});expect(layoutOnly.response.statusCode,layoutOnly.response.body).toBe(200);
 expect((await post('/api/projects/'+projectId+'/dependency-changes/apply',{...layoutOnly.input,batchId:randomUUID(),previewToken:layoutOnly.preview.previewToken})).statusCode).toBe(200);expect((await analysis(projectId)).revision).toBe(graph.revision);
});
it('里程碑流程保存与实例化不生成零工期工作项，模板批次有幂等回执',async()=>{
 const {projectId,owner}=await fixture(),a=randomUUID(),m=randomUUID(),batchId=randomUUID();
 const body={projectId,batchId,name:'里程碑流程',dependencyMode:'dependencies',items:[{clientKey:a,title:'工作',durationDays:1,startOffsetDays:0,sortOrder:0,predecessorKeys:[],kind:'work'},{clientKey:m,title:'交付',durationDays:0,startOffsetDays:1,sortOrder:1,predecessorKeys:[a],kind:'milestone'}],layout:{direction:'right',expectedVersion:0,positions:{[a]:{x:0,y:0},[m]:{x:320,y:0}}}};
 const saved=await post('/api/templates',body);expect(saved.statusCode,saved.body).toBe(200);const template=saved.json<WorkItemTemplate>();expect((await post('/api/templates',body)).json()).toEqual(template);
 const receipt=(await request('GET','/api/projects/'+projectId+'/dependency-changes/'+batchId)).json();expect(receipt.addedIds.$template).toBe(template.id);
 const req=await post('/api/requirements',{projectId,title:'里程碑需求',templateId:template.id,ownerId:owner.id,plannedStart:addBusinessDays(todayIso(),0)});expect(req.statusCode,req.body).toBe(200);const r=req.json<Requirement>();expect(r.workItems).toHaveLength(1);
 const graph=await analysis(projectId),mile=graph.milestones?.find(n=>n.requirementId===r.id);expect(mile?.title).toBe('交付');expect(graph.nodes.find(n=>n.id===mile?.id)?.remainingDays).toBe(0);
});

it('独立里程碑自动达成与人工确认、返工和验收后重新交付均保留历史',async()=>{
 const {projectId,a,owner}=await fixture(),m=randomUUID(),manual=randomUUID();
 const changes:DependencyChanges={add:[{clientId:randomUUID(),sourceRequirementId:a.id,sourceWorkItemId:a.workItems[0].id,targetRequirementId:a.id,targetWorkItemId:null,targetMilestoneId:m}],remove:[],estimates:[],entities:[{entity:'milestone',op:'create',id:m,requirementId:a.id,data:{title:'阶段交付'}},{entity:'milestone',op:'create',id:manual,requirementId:a.id,data:{title:'人工确认',confirmationMode:'manual'}}]};
 const preview=await batchPreview(projectId,changes);expect(preview.response.statusCode,preview.response.body).toBe(200);expect((await post('/api/projects/'+projectId+'/dependency-changes/apply',{...preview.input,batchId:randomUUID(),previewToken:preview.preview.previewToken})).statusCode).toBe(200);
 const mile=async(id:string)=>(await analysis(projectId)).milestones!.find(n=>n.id===id)!;
 expect((await mile(manual)).achievedAt).toBeNull();
 expect((await post('/api/milestones/'+m+'/achieve',{expectedVersion:1})).statusCode).toBe(400);
 const work=a.workItems[0];await request('PATCH','/api/work-items/'+work.id,{expectedVersion:work.version,ownerId:owner.id});let w=(await detail(a.id)).workItems[0];expect((await post('/api/work-items/'+w.id+'/start',{expectedVersion:w.version})).statusCode).toBe(200);w=(await detail(a.id)).workItems[0];expect((await post('/api/work-items/'+w.id+'/complete',{expectedVersion:w.version,content:'完成前置'})).statusCode).toBe(200);
 expect((await mile(m)).achievedAt).toBe(todayIso());expect((await mile(manual)).achievedAt).toBeNull();
 w=(await detail(a.id)).workItems[0];expect((await post('/api/work-items/'+w.id+'/reopen',{expectedVersion:w.version,reason:'补充验证'})).statusCode).toBe(200);expect((await mile(m)).achievedAt).toBe(todayIso());
 expect((await post('/api/milestones/'+manual+'/achieve',{expectedVersion:1})).statusCode).toBe(200);
 const {sqlite}=await import('./support/database');sqlite.prepare("UPDATE work_items SET status='completed',progress=100,actual_start=?,actual_end=? WHERE requirement_id=?").run(todayIso(),todayIso(),a.id);sqlite.prepare("UPDATE requirements SET status='completed',progress=100,accepted_at=? WHERE id=?").run(todayIso(),a.id);
 const opened=await post('/api/milestones/'+m+'/reopen',{expectedVersion:(await mile(m)).version});expect(opened.statusCode,opened.body).toBe(200);expect((await mile(m)).achievedAt).toBeNull();expect((await mile(m)).confirmationMode).toBe('manual');expect((await detail(a.id)).status).toBe('completed');expect((await detail(a.id)).acceptedAt).toBe(todayIso());
 const deletion=await batchPreview(projectId,{add:[],remove:[],estimates:[],entities:[{entity:'milestone',op:'delete',id:m,requirementId:a.id,expectedVersion:(await mile(m)).version,data:{}}]});expect(deletion.response.statusCode).toBe(400);expect(await mile(m)).toBeDefined();
 expect((await post('/api/requirements/'+a.id+'/accept',{expectedVersion:(await detail(a.id)).version,content:'验收'})).statusCode).not.toBe(200);
});
it('实体与布局批次失败整批回滚；工期安排 REST 与 MCP 保持一致',async()=>{
 const {projectId,a}=await fixture(),{sqlite}=await import('./support/database'),id=randomUUID();
 const p=await batchPreview(projectId,{add:[],remove:[],estimates:[],entities:[{entity:'milestone',op:'create',id,data:{title:'回滚里程碑'}}],layouts:[{scope:'global',direction:'right',expectedVersion:0,positions:{[id]:{x:0,y:0}}}]});expect(p.response.statusCode,p.response.body).toBe(200);
 sqlite.exec("CREATE TRIGGER editor_reject_audit BEFORE INSERT ON audit_logs WHEN NEW.action='apply_dependency_changes' BEGIN SELECT RAISE(ABORT,'editor audit failure'); END");
 const batchId=randomUUID();try{expect((await post('/api/projects/'+projectId+'/dependency-changes/apply',{...p.input,batchId,previewToken:p.preview.previewToken})).statusCode).toBe(500);}finally{sqlite.exec('DROP TRIGGER editor_reject_audit');}
 expect(sqlite.prepare('SELECT id FROM milestones WHERE id=?').get(id)).toBeUndefined();expect(sqlite.prepare("SELECT 1 FROM diagram_layouts WHERE project_id=? AND scope='global'").get(projectId)).toBeUndefined();expect((await request('GET','/api/projects/'+projectId+'/dependency-changes/'+batchId)).json().status).toBe('not_found');
 const changed=await request('PATCH','/api/work-items/'+a.workItems[1].id+'/path-estimate',{expectedRevision:(await analysis(projectId)).revision,arrangement:'late'});expect(changed.statusCode,changed.body).toBe(200);expect((await analysis(projectId)).nodes.find(n=>n.id===a.workItems[1].id)?.arrangement).toBe('late');expect((await mcp('get_path_analysis',{projectId})).result.nodes.find((n:{id:string})=>n.id===a.workItems[1].id).arrangement).toBe('late');
});

it('只有里程碑的流程也能实例化，不制造工作项；截止日批次预览与实际日期一致',async()=>{
 const {projectId,owner}=await fixture();
 const saved=await post('/api/templates',{projectId,name:'纯里程碑流程',dependencyMode:'dependencies',items:[{clientKey:'m',title:'启动确认',kind:'milestone',durationDays:0,startOffsetDays:0,sortOrder:0,predecessorKeys:[],confirmationMode:'manual'}]});expect(saved.statusCode,saved.body).toBe(200);
 const template=saved.json<WorkItemTemplate>(),id=randomUUID(),date=addBusinessDays(todayIso(),5);
 const p=await batchPreview(projectId,{add:[],remove:[],estimates:[],entities:[{entity:'requirement',op:'create',id,data:{title:'里程碑实例',ownerId:owner.id,templateId:template.id,plannedEnd:date}}]});expect(p.response.statusCode,p.response.body).toBe(200);
 const submitted=await post('/api/projects/'+projectId+'/dependency-changes/apply',{...p.input,batchId:randomUUID(),previewToken:p.preview.previewToken});expect(submitted.statusCode,submitted.body).toBe(200);
 const actual=await detail(submitted.json<DependencyChangeReceipt>().addedIds[id]);expect(actual.workItems).toHaveLength(0);expect(actual.plannedStart).toBe(date);
 const graph=await analysis(projectId);expect(graph.milestones?.filter(m=>m.requirementId===actual.id)).toHaveLength(1);expect(graph.requirements.find(r=>r.id===actual.id)?.status).toBe(p.preview.analysis.requirements.find(r=>r.id===id)?.status);
});
