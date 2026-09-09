import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,scryptSync} from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import type {FastifyInstance} from 'fastify';
import type {Requirement} from '../src/client/types';
import type {PathAnalysis} from '../src/shared/paths';
import {processingPriority} from '../src/shared/delivery';
import {deriveRequirementMetrics,addBusinessDays,todayIso} from '../src/shared/domain';
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
 const r=await post('/api/requirements',{projectId:project.id,title:'直接需求',ownerId:owner.id,executionMode:'direct',...extra});expect(r.statusCode,r.body).toBe(200);
 return {projectId:project.id as string,owner,r:r.json<Requirement>()};
}
async function command(id:string,action:string,data:Record<string,unknown>={}){const current=await detail(id);return post('/api/requirements/'+id+'/'+action,{expectedVersion:current.version,...data});}
it('风险只读取执行事实，自动优先级覆盖关键阻塞、缓冲及候选',()=>{
 const fact={id:'a',status:'in_progress',riskLevel:'low',riskEvaluated:true,complete:true,minFloat:5};
 expect(processingPriority(fact,'2026-09-09').processingPriority).toBe('P3');
 expect(processingPriority({...fact,minFloat:2},'2026-09-09').processingPriority).toBe('P1');
 expect(processingPriority({...fact,blockedCritical:true},'2026-09-09').processingPriority).toBe('P0');
 expect(processingPriority({...fact,riskEvaluated:false,complete:false},'2026-09-09').processingPriority).toBe('P2');
 expect(processingPriority({...fact,deliveryScope:'candidate'},'2026-09-09').processingPriority).toBeNull();
 const base={executionMode:'direct' as const,status:'in_progress',progress:60,plannedStart:'2026-09-01',plannedEnd:'2026-09-10',actualStart:'2026-09-01'};
 expect(deriveRequirementMetrics({...base,priority:'P0'},[],'2026-09-08')).toEqual(deriveRequirementMetrics({...base,priority:'P3'},[],'2026-09-08'));
});
it('不生成隐藏工作项，无日期可开始、记录、解阻、提交验收与返工',async()=>{
 const {r,projectId}=await fixture();expect(r.workItems).toHaveLength(0);expect(r.status).toBe('not_started');
 expect((await analysis(projectId)).nodes.some(n=>n.kind==='execution')).toBe(true);
 expect((await command(r.id,'start')).statusCode).toBe(200);
 expect((await command(r.id,'progress',{content:'完成接口',requirementPercent:30})).statusCode).toBe(200);
 expect((await command(r.id,'block',{reason:'等待环境'})).statusCode).toBe(200);
 expect((await detail(r.id)).riskLevel).toBe('high');
 expect((await command(r.id,'unblock')).statusCode).toBe(200);
 expect((await command(r.id,'submit-acceptance',{content:'交付接口'})).statusCode).toBe(200);
 expect((await detail(r.id)).status).toBe('pending_acceptance');
 expect((await command(r.id,'accept',{content:'验证通过'})).statusCode).toBe(200);
 expect((await detail(r.id)).acceptedAt).toBeTruthy();
 expect((await command(r.id,'rework',{reason:'新增验证',progress:80})).statusCode).toBe(200);
 const after=await detail(r.id);expect(after.progress).toBe(80);expect(after.workItems).toHaveLength(0);expect(after.progressUpdates?.some(e=>e.eventType==='accept')).toBe(true);
});
it('候选不能开始，撤出已执行需求保留事实并要求理由',async()=>{
 const {r}=await fixture({deliveryScope:'candidate'});expect((await command(r.id,'start')).statusCode).toBe(400);
 expect((await req('PATCH','/api/requirements/'+r.id,{expectedVersion:r.version,deliveryScope:'committed'})).statusCode).toBe(200);
 expect((await command(r.id,'start')).statusCode).toBe(200);const started=await detail(r.id);
 expect((await req('PATCH','/api/requirements/'+r.id,{expectedVersion:started.version,deliveryScope:'candidate'})).statusCode).toBe(400);
 const saved=await req('PATCH','/api/requirements/'+r.id,{expectedVersion:started.version,deliveryScope:'candidate',reason:'本期暂不交付'});expect(saved.statusCode,saved.body).toBe(200);expect(saved.json().status).toBe('in_progress');expect(saved.json().readinessIssues).toContain('范围外执行');
});
it('拆分预览不写库，原子保存后保留30%基线并计算到65%',async()=>{
 const {r,projectId,owner}=await fixture();await command(r.id,'start');await command(r.id,'progress',{content:'前期工作完成',requirementPercent:30});
 const current=await detail(r.id),before=await analysis(projectId),a=randomUUID(),b=randomUUID();
 const input={expectedRevision:before.revision,target:'project',changes:{add:[],remove:[],estimates:[],entities:[{entity:'requirement',op:'update',id:r.id,expectedVersion:current.version,data:{executionMode:'work_items',reason:'拆分剩余工作'}},{entity:'work',op:'create',id:a,requirementId:r.id,data:{title:'剩余一',ownerId:owner.id,durationDays:1}},{entity:'work',op:'create',id:b,requirementId:r.id,data:{title:'剩余二',ownerId:owner.id,durationDays:1}}]}};
 const p=await post('/api/projects/'+projectId+'/dependency-changes/preview',input);expect(p.statusCode,p.body).toBe(200);expect((await detail(r.id)).workItems).toHaveLength(0);expect((await analysis(projectId)).revision).toBe(before.revision);
 const body={...input,batchId:randomUUID(),previewToken:p.json().previewToken};const saved=await post('/api/projects/'+projectId+'/dependency-changes/apply',body);expect(saved.statusCode,saved.body).toBe(200);
 expect((await post('/api/projects/'+projectId+'/dependency-changes/apply',body)).json()).toEqual(saved.json());
 const split=await detail(r.id);expect(split.progress).toBe(30);expect(split.actualStart).toBe(current.actualStart);
 let w=split.workItems[0];expect((await post('/api/work-items/'+w.id+'/start',{expectedVersion:w.version})).statusCode).toBe(200);w=(await detail(r.id)).workItems[0];expect((await post('/api/work-items/'+w.id+'/complete',{expectedVersion:w.version,content:'完成剩余一'})).statusCode).toBe(200);expect((await detail(r.id)).progress).toBe(65);
});
it('范围外前置依然影响交付；人工提前开始保留原依赖',async()=>{
 const {r,projectId,owner}=await fixture();const other=await post('/api/requirements',{projectId,ownerId:owner.id,title:'前置',executionMode:'direct',deliveryScope:'candidate'});const source=other.json<Requirement>();
 const a=await analysis(projectId);expect((await post('/api/projects/'+projectId+'/dependencies',{expectedRevision:a.revision,sourceRequirementId:source.id,sourceWorkItemId:null,targetRequirementId:r.id,targetWorkItemId:null})).statusCode).toBe(200);
 const before=await analysis(projectId);expect(before.risks[source.id].inDeliveryNetwork).toBe(true);
 const blocked=await command(r.id,'start');expect(blocked.statusCode).toBe(409);
 const ok=await command(r.id,'start',{expectedDependencyRevision:before.revision});expect(ok.statusCode,ok.body).toBe(200);expect((await analysis(projectId)).dependencies).toHaveLength(1);expect((await detail(r.id)).progressUpdates?.some(e=>e.content.includes('未满足前置'))).toBe(true);
});

it('指定验收人只能验收本需求，失效后仍可由项目经理代验',async()=>{
 const {r,projectId}=await fixture();
 const name='验收员'+sequence,person=(await post('/api/people',{projectId,name})).json();
 const login=await req('POST','/api/login',{username:name,password:'888888'},'');
 const changed=await req('POST','/api/account/change-password',{currentPassword:'888888',newPassword:'acceptor-test-password'},String(login.headers['set-cookie']).split(';')[0]);
 const memberCookie=String(changed.headers['set-cookie']).split(';')[0];
 let current=await detail(r.id);
 const assigned=await req('PATCH','/api/requirements/'+r.id,{expectedVersion:current.version,acceptanceOwnerId:person.id});expect(assigned.statusCode,assigned.body).toBe(200);
 current=await detail(r.id);expect(current.acceptanceOwnerValid).toBeTruthy();
 expect((await req('PATCH','/api/requirements/'+r.id,{expectedVersion:current.version,deliveryScope:'candidate'},memberCookie)).statusCode).toBe(403);
 await command(r.id,'start');await command(r.id,'submit-acceptance',{content:'工作已完成'});current=await detail(r.id);
 const accepted=await req('POST','/api/requirements/'+r.id+'/accept',{expectedVersion:current.version,content:'指定人检查通过'},memberCookie);expect(accepted.statusCode,accepted.body).toBe(200);
 expect((await req('POST','/api/requirements/'+r.id+'/accept',{expectedVersion:current.version,content:'重复'},memberCookie)).statusCode).toBe(409);
 await command(r.id,'rework',{reason:'补验一项'});await command(r.id,'submit-acceptance',{content:'补验完成'});
 const {sqlite}=await import('../src/server/database');sqlite.prepare('UPDATE people SET active=0 WHERE id=?').run(person.id);
 current=await detail(r.id);expect(current.acceptanceOwnerValid).toBeFalsy();expect(current.readinessIssues?.join('')).toContain('失效');
 const manager=await command(r.id,'accept',{content:'经理核对交付并代验'});expect(manager.statusCode,manager.body).toBe(200);expect(manager.json().progressUpdates.some((e:{content:string})=>e.content.includes('代验'))).toBe(true);
});

it('拆分保存失败全批回滚，旧版本拒绝提交，末项删除不切回直接执行',async()=>{
 const {r,projectId,owner}=await fixture();await command(r.id,'start');await command(r.id,'progress',{content:'前期完成',requirementPercent:30});
 const current=await detail(r.id),before=await analysis(projectId),wid=randomUUID();
 const input={expectedRevision:before.revision,target:'project',changes:{add:[],remove:[],estimates:[],entities:[{entity:'requirement',op:'update',id:r.id,expectedVersion:current.version,data:{executionMode:'work_items'}},{entity:'work',op:'create',id:wid,requirementId:r.id,data:{title:'仅剩工作',ownerId:owner.id,durationDays:1}}]}};
 const p=await post('/api/projects/'+projectId+'/dependency-changes/preview',input);expect(p.statusCode,p.body).toBe(200);
 const {sqlite}=await import('../src/server/database');
 const baseline=sqlite.prepare('SELECT count(*) AS n FROM audit_logs').get();
 sqlite.exec("CREATE TRIGGER delivery_test_fail BEFORE INSERT ON work_items WHEN NEW.title='仅剩工作' BEGIN SELECT RAISE(ABORT,'simulated disk failure');END");
 const body={...input,batchId:randomUUID(),previewToken:p.json().previewToken};expect((await post('/api/projects/'+projectId+'/dependency-changes/apply',body)).statusCode).toBe(500);sqlite.exec('DROP TRIGGER delivery_test_fail');
 expect((await detail(r.id)).executionMode).toBe('direct');expect((await detail(r.id)).workItems).toHaveLength(0);expect(sqlite.prepare('SELECT count(*) AS n FROM audit_logs').get()).toEqual(baseline);
 const save=await post('/api/projects/'+projectId+'/dependency-changes/apply',body);expect(save.statusCode,save.body).toBe(200);
 const split=await detail(r.id),w=split.workItems[0];const removed=await app.inject({method:'DELETE',url:'/api/work-items/'+w.id,headers:{cookie},payload:{expectedVersion:w.version}});expect(removed.statusCode,removed.body).toBe(200);
 const empty=await detail(r.id);expect(empty.executionMode).toBe('work_items');expect(empty.status).not.toBe('pending_acceptance');expect(empty.progress).toBe(30);
 expect((await req('PATCH','/api/requirements/'+r.id,{expectedVersion:empty.version,executionMode:'direct'})).statusCode).toBe(400);
});

it('画布直接需求与无日期模板的预览和保存一致，预测变未知给出原因',async()=>{
 const {projectId,owner}=await fixture(),clientId=randomUUID(),day=addBusinessDays(todayIso(),1),end=addBusinessDays(day,2);
 const graph=await analysis(projectId),input={expectedRevision:graph.revision,target:'project',changes:{add:[],remove:[],estimates:[],entities:[{entity:'requirement',id:clientId,op:'create',data:{title:'带日期直接执行',executionMode:'direct',plannedStart:day,durationDays:3,ownerId:owner.id,forecastEnd:end}}]}};
 const p=await post('/api/projects/'+projectId+'/dependency-changes/preview',input);expect(p.statusCode,p.body).toBe(200);expect(p.json().analysis.nodes.find((n:{id:string})=>n.id==='execute:'+clientId).forecastEnd).toBe(end);
 const saved=await post('/api/projects/'+projectId+'/dependency-changes/apply',{...input,batchId:randomUUID(),previewToken:p.json().previewToken});expect(saved.statusCode,saved.body).toBe(200);
 const created=await detail(saved.json().addedIds[clientId]);expect(created.plannedEnd).toBe(end);expect(created.workItems).toHaveLength(0);
 const formal=await analysis(projectId);expect(formal.nodes.find(n=>n.id==='execute:'+created.id)?.forecastEnd).toBe(end);
 const unknown={expectedRevision:formal.revision,target:'project',changes:{add:[],remove:[],estimates:[],entities:[{entity:'requirement',id:created.id,op:'update',expectedVersion:created.version,data:{durationDays:null,forecastEnd:null,unblockEstimate:null}}]}};
 // Planned duration remains a reliable input; explicitly removing it is a separate plan operation.
 expect((await post('/api/projects/'+projectId+'/dependency-changes/preview',unknown)).statusCode).toBe(200);
 const templateResponse=await post('/api/templates',{projectId,name:'不排期流程',dependencyMode:'dependencies',items:[{clientKey:'a',predecessorKeys:[],title:'实施',durationDays:2,startOffsetDays:0,sortOrder:0}]});expect(templateResponse.statusCode,templateResponse.body).toBe(200);const t=templateResponse.json();
 const cid=randomUUID(),g=await analysis(projectId),withTemplate={expectedRevision:g.revision,target:'project',changes:{add:[],remove:[],estimates:[],entities:[{entity:'requirement',id:cid,op:'create',data:{title:'未排期分解',executionMode:'work_items',templateId:t.id}}]}};
 const pre=await post('/api/projects/'+projectId+'/dependency-changes/preview',withTemplate);expect(pre.statusCode,pre.body).toBe(200);expect(pre.json().analysis.nodes.filter((n:{requirementId:string;kind:string})=>n.requirementId===cid&&n.kind==='work')).toHaveLength(1);
 const apply=await post('/api/projects/'+projectId+'/dependency-changes/apply',{...withTemplate,batchId:randomUUID(),previewToken:pre.json().previewToken});expect(apply.statusCode,apply.body).toBe(200);const reqAfter=await detail(apply.json().addedIds[cid]);expect(reqAfter.workItems).toHaveLength(1);expect(reqAfter.workItems[0].plannedStart).toBeNull();
});

it('直接执行日期调整保留实际日期，人工预测遇到解阻未知不作确定交付承诺',async()=>{
 const {r,projectId}=await fixture({durationDays:3});await command(r.id,'start');const started=await detail(r.id),day=addBusinessDays(todayIso(),2);
 const rescheduled=await command(r.id,'reschedule',{scheduleMode:'deadline',plannedEnd:day,reason:'确认交付窗口'});expect(rescheduled.statusCode,rescheduled.body).toBe(200);expect((await detail(r.id)).actualStart).toBe(started.actualStart);
 await command(r.id,'block',{reason:'外部环境未开放'});const current=await detail(r.id),g=await analysis(projectId);
 expect(g.nodes.find(n=>n.id==='execute:'+r.id)?.forecastEnd).toBeNull();
 const input={expectedRevision:g.revision,target:'project',changes:{add:[],remove:[],estimates:[],entities:[{entity:'requirement',id:r.id,op:'update',expectedVersion:current.version,data:{forecastEnd:day}}]}};
 const preview=await post('/api/projects/'+projectId+'/dependency-changes/preview',input);expect(preview.statusCode,preview.body).toBe(200);expect(preview.json().analysis.forecastEnd).toBeNull();
 expect((await detail(r.id)).forecastEnd).toBeNull();
});

it('未排期拆分按工期加权；范围和预测变化在预览中可核对',async()=>{
 const {r,projectId,owner}=await fixture({durationDays:4});await command(r.id,'start');await command(r.id,'progress',{content:'已完成前期',requirementPercent:30});
 const current=await detail(r.id),g=await analysis(projectId),a=randomUUID(),b=randomUUID();
 const input={expectedRevision:g.revision,target:'project',changes:{add:[],remove:[],estimates:[],entities:[{entity:'requirement',op:'update',id:r.id,expectedVersion:current.version,data:{executionMode:'work_items'}},...[[a,1],[b,3]].map(([id,durationDays])=>({entity:'work',op:'create',id,requirementId:r.id,data:{title:String(id),ownerId:owner.id,durationDays}}))]}};
 const p=await post('/api/projects/'+projectId+'/dependency-changes/preview',input);expect(p.statusCode,p.body).toBe(200);expect(p.json().differences.target).toHaveProperty('before.forecast');
 const saved=await post('/api/projects/'+projectId+'/dependency-changes/apply',{...input,batchId:randomUUID(),previewToken:p.json().previewToken});expect(saved.statusCode,saved.body).toBe(200);
 let w=(await detail(r.id)).workItems.find(w=>w.title===a)!;await post('/api/work-items/'+w.id+'/start',{expectedVersion:w.version});w=(await detail(r.id)).workItems.find(w=>w.title===a)!;await post('/api/work-items/'+w.id+'/complete',{expectedVersion:w.version,content:'完成短项'});
 expect((await detail(r.id)).progress).toBe(48);
});

it('相同阻塞源归并，独立缺负责人保留；成员影响数量只计可见需求',async()=>{
 const {r,projectId,owner}=await fixture({durationDays:2});const second=(await post('/api/requirements',{projectId,title:'独立缺负责人',executionMode:'direct',durationDays:1})).json<Requirement>();
 const other=(await post('/api/people',{projectId,name:'另一负责人'+sequence})).json();const hidden=(await post('/api/requirements',{projectId,title:'他人交付',executionMode:'direct',ownerId:other.id,durationDays:1})).json<Requirement>();
 for(const target of [second,hidden]){const g=await analysis(projectId);const response=await post('/api/projects/'+projectId+'/dependencies',{expectedRevision:g.revision,sourceRequirementId:r.id,sourceWorkItemId:null,targetRequirementId:target.id,targetWorkItemId:null});expect(response.statusCode,response.body).toBe(200);}
 await command(r.id,'start');await command(r.id,'block',{reason:'共享环境阻塞'});
 const all=(await req('GET','/api/action-items?projectId='+projectId)).json();expect(all.items.filter((i:{sourceId:string})=>i.sourceId===r.id)).toHaveLength(1);expect(all.items.find((i:{sourceId:string})=>i.sourceId===second.id)?.reasonCodes).toContain('missing_owner');
 const login=await req('POST','/api/login',{username:owner.name,password:'888888'},'');const changed=await req('POST','/api/account/change-password',{currentPassword:'888888',newPassword:'delivery-member-password'},String(login.headers['set-cookie']).split(';')[0]);
 const mine=(await req('GET','/api/action-items?projectId='+projectId,undefined,String(changed.headers['set-cookie']).split(';')[0])).json();
 expect(mine.items.find((i:{sourceId:string})=>i.sourceId===r.id)?.affectedRequirementIds).toEqual([r.id]);expect(JSON.stringify(mine)).not.toContain(hidden.title);
});

it('历史待规划的直接需求在详情和路径统一为未开始，失效负责人交给经理',async()=>{
 const {r,projectId,owner}=await fixture();const {sqlite}=await import('../src/server/database');
 sqlite.prepare("UPDATE requirements SET status='planning' WHERE id=?").run(r.id);
 expect((await detail(r.id)).status).toBe('not_started');expect((await analysis(projectId)).requirements.find(x=>x.id===r.id)?.status).toBe('not_started');
 sqlite.prepare("UPDATE accounts SET status='disabled' WHERE person_id=?").run(owner.id);
 expect((await detail(r.id)).readinessIssues?.join('')).toContain('负责人已失效');expect((await command(r.id,'start')).statusCode).toBe(400);
 const action=(await req('GET','/api/action-items?projectId='+projectId)).json().items.find((i:{sourceId:string})=>i.sourceId===r.id);expect(action.ownerName).toBe('项目经理');expect(action.reasonCodes).toContain('missing_owner');
});

it('直接执行提交验收后释放未来负荷，取消日期使用业务日期及原记录',async()=>{
 const today=todayIso(),tomorrow=addBusinessDays(today,1),{r,projectId,owner}=await fixture({plannedStart:today,durationDays:3});
 await command(r.id,'start');await command(r.id,'submit-acceptance',{content:'工作已交付，等待验收'});
 const matrix=(await req('GET','/api/analytics/people-concurrency?projectId='+projectId+'&from='+today+'&to='+tomorrow)).json();expect(matrix.people.find((p:{id:string})=>p.id===owner.id).days.find((d:{date:string})=>d.date===tomorrow).count).toBe(0);
 await command(r.id,'rework',{reason:'返工核对',progress:90});await command(r.id,'cancel',{reason:'停止执行'});
 const {sqlite}=await import('../src/server/database');sqlite.prepare("UPDATE requirements SET updated_at='2030-01-01T00:00:00.000Z' WHERE id=?").run(r.id);
 expect((await detail(r.id)).actualEnd).toBe(today);
});

it('工作完成但验收日期未知时，非关键分支不显示为可靠低风险',async()=>{
 const {projectId,owner}=await fixture({durationDays:10,plannedStart:todayIso()});
 const r=(await post('/api/requirements',{projectId,title:'等待验收确认',ownerId:owner.id,executionMode:'direct',durationDays:1,plannedStart:todayIso()})).json<Requirement>();
 await command(r.id,'start');await command(r.id,'submit-acceptance',{content:'工作已完成'});
 const value=await detail(r.id);expect(value.pathRisk?.complete).toBe(false);expect(value.riskLevel).toBe('low');expect(value.riskEvaluated).toBe(false);expect(value.processingPriority).not.toBe('P3');
});
