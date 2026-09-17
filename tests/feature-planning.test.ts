import { afterAll,beforeAll,expect,it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,scryptSync} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import type {Feature,IntakeCatalog} from '../src/shared/intake';
import type {FeatureRelation} from '../src/shared/features';
import {mcpRequest} from './mcp-request';

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pm-features-')),password='feature-test-password';
Object.assign(process.env,{DB_PATH:path.join(directory,'test.db'),BACKUP_DIR:path.join(directory,'backups'),WEB_DIST_DIR:path.join(directory,'web'),SEED_DEMO:'0',NODE_ENV:'test',APP_PASSWORD_HASH:'scrypt$features$'+scryptSync(password,'features',64).toString('hex'),SESSION_SECRET:'feature-planning-isolated-test-secret-123456789'});
let app:FastifyInstance,cookie='',address='';
const request=(method:'GET'|'POST'|'DELETE'|'PUT',url:string,payload?:unknown,auth=cookie)=>app.inject({method,url,headers:{cookie:auth},payload:payload as Record<string,unknown>});
beforeAll(async()=>{app=await(await import('../src/server/app')).buildApp();await app.ready();const login=await request('POST','/api/login',{username:'admin',password},'');cookie=String(login.headers['set-cookie']).split(';')[0];address=await app.listen({host:'127.0.0.1',port:0});});
afterAll(async()=>{await app.close();(await import('../src/server/database')).sqlite.close();expect(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep)).toBe(true);fs.rmSync(directory,{recursive:true,force:true});});
async function fixture(){const p=(await request('POST','/api/projects',{name:'特性规划 '+randomUUID()})).json<{id:string}>();const base='/api/projects/'+p.id;const create=async(name:string)=>(await request('POST',base+'/features',{name,sortOrder:999})).json<IntakeCatalog>().features.find(g=>g.name===name)!;return {id:p.id,base,a:await create('基础授权'),b:await create('协作权限'),create};}
async function features(base:string){return (await request('GET',base+'/features?state=all')).json<Feature[]>();}
async function addRequirement(projectId:string,featureId:string|null,status='not_started',archived=false){const {sqlite}=await import('../src/server/database');const id=randomUUID(),now=new Date().toISOString();sqlite.prepare("INSERT INTO requirements(id,project_id,feature_id,title,status,execution_mode,progress,actual_end,deleted_at,created_at,updated_at) VALUES(?,?,?,?,?,'direct',?,?,?,?,?)").run(id,projectId,featureId,'需求 '+id,status,status==='completed'?100:0,status==='completed'?'2026-09-10':null,archived?now:null,now,now);return id;}
const versioned=(feature:Feature,extra:Record<string,unknown>)=>({id:feature.id,name:feature.name,sortOrder:feature.sortOrder,expectedVersion:feature.version,...extra});

it('旧接口保留新资料和评估时间；改动日志使用稳定特性 ID',async()=>{
  const {base,a}=await fixture();const overview={expectation:'先支持试用',progressSummary:'基础已可用',assessment:'on_track',note:'等待业务反馈'};
  let r=await request('POST',base+'/features',versioned(a,{description:'长期覆盖协作中的授权与审计',overview}));expect(r.statusCode,r.body).toBe(200);
  const saved=r.json<IntakeCatalog>().features.find(g=>g.id===a.id)!;
  r=await request('POST',base+'/features',versioned(saved,{name:'授权平台'}));const after=r.json<IntakeCatalog>().features.find(g=>g.id===a.id)!;
  expect(after.description).toBe('长期覆盖协作中的授权与审计');expect(after.overview).toEqual(overview);expect(after.assessedAt).toBe(saved.assessedAt);
  expect((await request('POST',base+'/features',versioned(saved,{description:'覆盖别人'}))).statusCode).toBe(409);
  const {sqlite}=await import('../src/server/database');const log=sqlite.prepare("SELECT summary FROM audit_logs WHERE entity_type='feature' AND entity_id=? ORDER BY rowid DESC LIMIT 1").get(a.id) as {summary:string};expect(log.summary).toContain('授权平台');expect(log.summary).toContain('长期覆盖');
});
it('归档前处理未完成需求，保留终态与历史归属，恢复不改变人工判断',async()=>{
  const {base,id,a,b}=await fixture(),r=await addRequirement(id,a.id);
  expect((await request('POST',base+'/features/'+a.id+'/archive',{expectedVersion:a.version})).statusCode).toBe(409);
  expect((await request('DELETE',base+'/features/'+a.id,{expectedVersion:a.version})).statusCode).toBe(409);
  const {sqlite}=await import('../src/server/database');sqlite.prepare("UPDATE requirements SET status='completed',progress=100 WHERE id=?").run(r);
  const history=await addRequirement(id,a.id,'completed',true);
  let archived=await request('POST',base+'/features/'+a.id+'/archive',{expectedVersion:a.version});expect(archived.statusCode,archived.body).toBe(200);
  const archivedGroup=archived.json<Feature>();expect((await request('GET',base+'/features')).json<Feature[]>().some(g=>g.id===a.id)).toBe(false);
  const historyRead=(await request('GET',base+'/features/'+a.id+'/requirements?state=archived&pageSize=1')).json();expect(historyRead.total).toBe(1);expect(historyRead.items[0].id).toBe(history);
  expect(()=>sqlite.prepare("UPDATE requirements SET status='in_progress',progress=0 WHERE id=?").run(r)).toThrow('FEATURE_ARCHIVED');
  const other=await addRequirement(id,b.id);const moved=await request('POST',base+'/requirement-placement',{requirements:[{id:other,expectedVersion:1}],featureId:a.id});expect(moved.statusCode).toBe(409);expect(moved.json().error).toContain('特性已归档');
  const terminalMove=await request('POST',base+'/requirement-placement',{requirements:[{id:r,expectedVersion:1}],featureId:b.id});expect(terminalMove.statusCode,terminalMove.body).toBe(200);expect(sqlite.prepare('SELECT status,feature_id FROM requirements WHERE id=?').get(r)).toEqual({status:'completed',feature_id:b.id});
  archived=await request('POST',base+'/features/'+a.id+'/restore',{expectedVersion:archivedGroup.version});expect(archived.statusCode).toBe(200);expect(archived.json().overview).toEqual(a.overview);expect((await features(base)).find(g=>g.id===a.id)?.archivedAt).toBeNull();
});
it('空特性可连接规划关系，禁止自连接、重复、跨项目及包括归档边的规划循环',async()=>{
  const {base,a,b,create}=await fixture(),c=await create('远期探索');
  const save=(source:string,target:string)=>request('POST',base+'/feature-relations',{sourceFeatureId:source,targetFeatureId:target,note:'先完成基础'});
  const edge=await save(a.id,b.id);expect(edge.statusCode,edge.body).toBe(200);const relation=edge.json<FeatureRelation>();
  expect((await save(a.id,b.id)).statusCode).toBe(409);expect((await save(a.id,a.id)).statusCode).toBe(409);expect((await save(b.id,a.id)).statusCode).toBe(409);
  expect((await save(b.id,c.id)).statusCode).toBe(200);
  const current=(await features(base)).find(g=>g.id===b.id)!;expect((await request('POST',base+'/features/'+b.id+'/archive',{expectedVersion:current.version})).statusCode).toBe(200);
  expect((await save(c.id,a.id)).statusCode).toBe(409);
  expect((await request('POST',base+'/feature-relations',{...relation,projectId:undefined,expectedVersion:999})).statusCode).toBe(400);
  expect((await request('DELETE',base+'/feature-relations/'+relation.id,{expectedVersion:999})).statusCode).toBe(409);
  const other=await fixture();expect((await save(a.id,other.a.id)).statusCode).toBe(404);
  expect((await request('DELETE',base+'/features/'+a.id,{expectedVersion:(await features(base)).find(g=>g.id===a.id)!.version})).statusCode).toBe(409);
});
it('网页与 MCP 特性图一致；规划和资料修改不改变执行分析结果',async()=>{
  const {base,id,a,b}=await fixture();await addRequirement(id,a.id);
  const before=(await request('GET',base+'/path-graph')).json().cards;
  const relation=await request('POST',base+'/feature-relations',{sourceFeatureId:a.id,targetFeatureId:b.id,note:'先做基础'});expect(relation.statusCode).toBe(200);
  await request('POST',base+'/features',versioned(a,{description:'长期范围'}));
  const legacy=await request('GET',base+'/path-graph');expect(legacy.json().cards).toEqual(before);
  const rest=await request('GET',base+'/path-graph?view=features');expect(rest.statusCode,rest.body).toBe(200);expect(rest.json().cards).toHaveLength(2);expect(rest.json().links[0]).toMatchObject({planningOnly:true,dependencyIds:[]});
  const token=(await request('POST','/api/tokens',{name:'特性图测试',expiresInDays:1})).json().token;
  const response=await mcpRequest(address,token,'get_path_graph',{projectId:id,view:'features'});const body=JSON.parse(response.body.startsWith('event:')?response.body.split('\n').find(line=>line.startsWith('data: '))!.slice(6):response.body);expect(body.result?.isError,JSON.stringify(body)).not.toBe(true);expect(JSON.parse(body.result.content[0].text)).toEqual(rest.json());
  const call=async(name:string,args:Record<string,unknown>)=>{const response=await mcpRequest(address,token,name,{projectId:id,...args});const body=JSON.parse(response.body.startsWith('event:')?response.body.split('\n').find(line=>line.startsWith('data: '))!.slice(6):response.body);expect(body.result?.isError,JSON.stringify(body)).not.toBe(true);return JSON.parse(body.result.content[0].text);};
  expect(await call('list_feature_relations',{})).toEqual((await request('GET',base+'/feature-relations')).json());
  expect(await call('get_feature_requirements',{featureId:a.id,state:'archived'})).toEqual((await request('GET',base+'/features/'+a.id+'/requirements?state=archived')).json());
  const edge=relation.json<FeatureRelation>();const updated=await call('save_feature_relation',{id:edge.id,expectedVersion:edge.version,sourceFeatureId:a.id,targetFeatureId:b.id,note:'MCP 更新说明'});
  expect((await request('GET',base+'/feature-relations')).json()[0]).toEqual(updated);
  const changes={add:[],remove:[],estimates:[],featureRelations:[{op:'update',id:updated.id,expectedVersion:updated.version,note:'统一批次说明'}],layouts:[{scope:'features',direction:'right',expectedVersion:0,positions:{['feature:'+a.id]:{x:80,y:120}}}]};
  const input={expectedRevision:(await request('GET',base+'/path-analysis')).json().revision,target:'project',changes};
  const preview=await call('preview_dependency_changes',input),httpPreview=await request('POST',base+'/dependency-changes/preview',input);expect(preview).toEqual(httpPreview.json());
  const batch={...input,previewToken:preview.previewToken,batchId:randomUUID()},receipt=await call('apply_dependency_changes',batch);expect(await call('apply_dependency_changes',batch)).toEqual(receipt);expect((await request('POST',base+'/dependency-changes/apply',batch)).statusCode).toBe(404);
  expect(await call('get_dependency_change_receipt',{batchId:batch.batchId})).toMatchObject({status:'applied',...receipt});
  const archived=await call('archive_feature',{featureId:b.id,expectedVersion:b.version});expect((await features(base)).find(g=>g.id===b.id)).toEqual(archived);
  const restored=await call('restore_feature',{featureId:b.id,expectedVersion:archived.version});expect((await features(base)).find(g=>g.id===b.id)).toEqual(restored);
  const exported=await request('GET',base+'/path-graph?view=features&format=svg');expect(exported.statusCode,exported.body).toBe(200);expect(exported.json().svg).toContain('stroke-dasharray="6 4"');
});
it('实际依赖双向聚合不误报循环，两类关系共存且按需求当前归属变化',async()=>{
  const {base,id,a,b}=await fixture(),a1=await addRequirement(id,a.id),a2=await addRequirement(id,a.id),b1=await addRequirement(id,b.id),b2=await addRequirement(id,b.id);
  const {sqlite}=await import('../src/server/database');const add=(source:string,target:string)=>sqlite.prepare('INSERT INTO dependency_edges(id,project_id,source_requirement_id,target_requirement_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),id,source,target,new Date().toISOString(),new Date().toISOString());add(a1,b1);add(b2,a2);
  await request('POST',base+'/feature-relations',{sourceFeatureId:a.id,targetFeatureId:b.id});
  const result=await request('GET',base+'/path-graph?view=features');expect(result.statusCode,result.body).toBe(200);expect(result.json().links).toHaveLength(2);expect(result.json().links.find((e:{source:string})=>e.source==='feature:'+a.id).label).toBe('规划 · 1 条实际依赖');
  expect((await request('GET',base+'/path-graph?view=features&planning=false')).json().links.every((e:{planningRelationIds:string[]})=>e.planningRelationIds.length===0)).toBe(true);
  const detail=await request('GET',base+'/path-graph?view=feature&featureId='+a.id);expect(detail.statusCode,detail.body).toBe(200);expect(detail.json().cards).toHaveLength(4);expect(detail.json().savedLayout.scope).toBe('feature:'+a.id);
  await request('POST',base+'/requirement-placement',{requirements:[{id:a1,expectedVersion:1}],featureId:b.id});expect((await request('GET',base+'/path-graph?view=features')).json().links.find((e:{source:string})=>e.source==='feature:'+a.id).dependencyIds).toEqual([]);
});
it('历史交付保留归档特性节点，未关联特性与里程碑独立显示',async()=>{
  const {base,id,a,b}=await fixture(),old=await addRequirement(id,a.id,'completed',true),current=await addRequirement(id,b.id),unassigned=await addRequirement(id,null);
  const {sqlite}=await import('../src/server/database');sqlite.prepare('INSERT INTO dependency_edges(id,project_id,source_requirement_id,target_requirement_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),id,old,current,new Date().toISOString(),new Date().toISOString());
  expect((await request('POST',base+'/features/'+a.id+'/archive',{expectedVersion:a.version})).statusCode).toBe(200);
  const predecessor=(await request('POST',base+'/features',{name:'更早交付',sortOrder:999})).json<IntakeCatalog>().features.find(g=>g.name==='更早交付')!;
  const predecessorRequirement=await addRequirement(id,predecessor.id,'completed',true);
  sqlite.prepare('INSERT INTO dependency_edges(id,project_id,source_requirement_id,target_requirement_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),id,predecessorRequirement,old,new Date().toISOString(),new Date().toISOString());
  expect((await request('POST',base+'/features/'+predecessor.id+'/archive',{expectedVersion:predecessor.version})).statusCode).toBe(200);
  const m=randomUUID();sqlite.prepare('INSERT INTO milestones(id,project_id,title,created_at,updated_at) VALUES(?,?,?,?,?)').run(m,id,'项目里程碑',new Date().toISOString(),new Date().toISOString());
  const result=await request('GET',base+'/path-graph?view=features');expect(result.statusCode,result.body).toBe(200);expect(result.json().cards.find((c:{featureId:string})=>c.featureId===a.id)).toMatchObject({archived:true});expect(result.json().cards.find((c:{featureId:string})=>c.featureId===predecessor.id)).toMatchObject({archived:true});expect(result.json().links.some((e:{source:string;target:string})=>e.source==='feature:'+predecessor.id&&e.target==='feature:'+a.id)).toBe(true);expect(result.json().cards.find((c:{id:string})=>c.id===m)).toBeTruthy();expect(result.json().cards.find((c:{featureId:string})=>c.featureId==='unassigned')).toBeTruthy();
  const detail=await request('GET',base+'/path-graph?view=feature&featureId=unassigned');expect(detail.statusCode).toBe(200);expect(detail.json().cards.map((c:{id:string})=>c.id)).toContain(unassigned);
});
it('成员只读；跨项目特性、关系和历史不能越权读取或写入',async()=>{
  const {base,id,a,b}=await fixture(),name='特性只读 '+randomUUID();await request('POST','/api/people',{projectId:id,name});let login=await request('POST','/api/login',{username:name,password:'888888'},'');let auth=String(login.headers['set-cookie']).split(';')[0];login=await request('POST','/api/account/change-password',{currentPassword:'888888',newPassword:'feature-reader-pass'},auth);auth=String(login.headers['set-cookie']).split(';')[0];
  for(const url of ['/path-graph?view=features','/feature-relations','/features/'+a.id+'/requirements?state=archived'])expect((await request('GET',base+url,undefined,auth)).statusCode).toBe(200);
  expect((await request('POST',base+'/feature-relations',{sourceFeatureId:a.id,targetFeatureId:b.id},auth)).statusCode).toBe(403);expect((await request('POST',base+'/features/'+a.id+'/archive',{expectedVersion:a.version},auth)).statusCode).toBe(403);
  const revision=(await request('GET',base+'/path-analysis')).json().revision;
  expect((await request('POST',base+'/dependency-changes/preview',{expectedRevision:revision,changes:{featureRelations:[{op:'create',id:'reader-attempt',sourceFeatureId:a.id,targetFeatureId:b.id,note:''}]}},auth)).statusCode).toBe(403);
  const other=await fixture();for(const url of ['/path-graph?view=features','/feature-relations','/features/'+other.a.id+'/requirements?state=archived'])expect((await request('GET',other.base+url,undefined,auth)).statusCode).toBe(404);
});
it('特性共享布局沿用批次与版本检查，不接受外项目节点且不影响需求布局',async()=>{
  const {base,a}=await fixture();const graph=(await request('GET',base+'/path-graph?view=features')).json();
  const input={expectedRevision:graph.revision,changes:{add:[],remove:[],estimates:[],layouts:[{scope:'features',direction:'right',expectedVersion:0,positions:{['feature:'+a.id]:{x:120,y:80}}}]}};
  const preview=await request('POST',base+'/dependency-changes/preview',input);expect(preview.statusCode,preview.body).toBe(200);
  const apply=await request('POST',base+'/dependency-changes/apply',{...input,previewToken:preview.json().previewToken,batchId:randomUUID()});expect(apply.statusCode,apply.body).toBe(200);
  const after=(await request('GET',base+'/path-graph?view=features')).json();expect(after.savedLayout.version).toBe(1);expect(after.savedLayout.positions).toEqual(input.changes.layouts[0].positions);
  expect((await request('GET',base+'/path-graph')).json().savedLayout.version).toBe(0);
  expect((await request('POST',base+'/dependency-changes/preview',{...input,expectedRevision:after.revision})).statusCode).toBe(409);
  expect((await request('DELETE',base+'/features/'+a.id,{expectedVersion:a.version})).statusCode).toBe(200);
  const removed=(await request('GET',base+'/path-graph?view=features')).json();expect(removed.savedLayout.version).toBe(2);expect(removed.savedLayout.positions).toEqual({});
  input.changes.layouts[0].expectedVersion=2;input.changes.layouts[0].positions={['feature:'+randomUUID()]:{x:0,y:0}};
  expect((await request('POST',base+'/dependency-changes/preview',{...input,expectedRevision:removed.revision})).statusCode).toBe(400);
});
