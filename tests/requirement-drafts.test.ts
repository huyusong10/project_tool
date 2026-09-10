import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,scryptSync} from 'node:crypto';
import {beforeAll,afterAll,it,expect} from 'vitest';
import type {FastifyInstance} from 'fastify';
import {emptyDraftContent,requirementDraftContent,type RequirementDraft,type DraftPreview,type DraftReceipt} from '../src/shared/requirement-drafts';
import {mcpRequest} from './mcp-request';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pm-personal-drafts-')),password=randomUUID();
const passwordHash=`scrypt$draft$${scryptSync(password,'draft',64).toString('hex')}`;
Object.assign(process.env,{DB_PATH:path.join(directory,'test.db'),BACKUP_DIR:path.join(directory,'backups'),WEB_DIST_DIR:path.join(directory,'web'),SEED_DEMO:'0',NODE_ENV:'test',APP_PASSWORD_HASH:passwordHash,SESSION_SECRET:randomUUID()+randomUUID()});
let app:FastifyInstance,cookie:string,memberCookie:string,origin:string,memberId:string,personId:string;
let db:typeof import('../src/server/database').sqlite;
const base='/api/my/requirement-drafts';
const request=(method:'POST'|'GET'|'PUT',url:string,payload?:unknown,auth=cookie)=>app.inject({method,url,headers:{cookie:auth},payload:payload as Record<string,unknown>});
beforeAll(async()=>{
  app=await(await import('../src/server/app')).buildApp();origin=await app.listen({host:'127.0.0.1',port:0});db=(await import('../src/server/database')).sqlite;
  cookie=String((await request('POST','/api/login',{username:'admin',password},'')).headers['set-cookie']).split(';')[0];
  memberId=randomUUID();personId=randomUUID();const now=new Date().toISOString();
  db.prepare('INSERT INTO people(id,name,created_at,updated_at) VALUES(?,?,?,?)').run(personId,'草稿成员',now,now);
  db.prepare("INSERT INTO accounts(id,username,normalized_username,password_hash,person_id,global_role,must_change_password,created_at,updated_at) VALUES(?,?,?,?,?,'user',0,?,?)").run(memberId,'draft-member','draft-member',passwordHash,personId,now,now);
  memberCookie=String((await request('POST','/api/login',{username:'draft-member',password},'')).headers['set-cookie']).split(';')[0];
});
afterAll(async()=>{await app.close();db.close();fs.rmSync(directory,{recursive:true,force:true});});
async function project(){const r=await request('POST','/api/projects',{name:'草稿验证 '+randomUUID().slice(0,6)});expect(r.statusCode,r.body).toBe(200);const p=r.json<{id:string}>();db.prepare("INSERT INTO project_people(project_id,person_id,project_role,created_at) VALUES(?,?,'member',?)").run(p.id,personId,new Date().toISOString());return p.id;}
function content(){const c=emptyDraftContent();c.entities=[{id:randomUUID(),entity:'requirement',group:'功能',data:{title:'可验证成果',acceptanceCriteria:'按条件检索后，结果与样本一致',tags:['建议拆分']}}];c.documents=[{key:'doc',title:'选摘',url:'',version:'',complete:false,clauses:[{key:'a',title:'检索',content:'按条件检索',externalId:'1',section:'',priority:''},{key:'b',title:'详情',content:'显示详情',externalId:'1',section:'',priority:''}]}];c.links=[{requirementId:c.entities[0].id,document:'doc',clause:'a',scope:'检索与样本比对'},{requirementId:c.entities[0].id,document:'doc',clause:'b',scope:'展示详情'}];return c;}
async function create(projectId:string,c=content(),auth=cookie){const r=await request('POST',base,{requestId:randomUUID(),projectId,title:'审核方案',content:c},auth);expect(r.statusCode,r.body).toBe(200);return r.json<RequirementDraft>();}
const preview=async(d:RequirementDraft,auth=cookie)=>{const r=await request('POST',base+'/'+d.id+'/preview',{expectedVersion:d.version},auth);expect(r.statusCode,r.body).toBe(200);return r.json<DraftPreview>();};
const publishInput=(d:RequirementDraft,p:DraftPreview)=>({expectedVersion:d.version,projectRevision:p.projectRevision,previewToken:p.previewToken,batchId:randomUUID()});
const formal=()=>Object.fromEntries(['projects','requirements','work_items','source_documents','source_clauses','source_revisions','source_links','requirement_groups','dependency_edges','milestones','diagram_layouts','delivery_commitments','progress_updates','audit_logs'].map(t=>[t,db.prepare('SELECT * FROM '+t).all()]));

it('保存、校验及计划预览不改正式数据；发布来源缺省、候选和回执原子生效',async()=>{
  const projectId=await project(),before=formal(),d=await create(projectId),p=await preview(d);
  expect(p.errors).toEqual([]);expect(p.warnings.join()).toContain('重复原编号');
  expect((await request('POST',base+'/'+d.id+'/plan-preview',{expectedVersion:d.version})).statusCode).toBe(200);
  expect(formal()).toEqual(before);
  const input=publishInput(d,p),r=await request('POST',base+'/'+d.id+'/publish',input);expect(r.statusCode,r.body).toBe(200);
  const receipt=r.json<DraftReceipt>();expect((await request('POST',base+'/'+d.id+'/publish',input)).json()).toEqual(receipt);
  expect((await request('GET',base+'/'+d.id+'/receipts/'+input.batchId)).json()).toEqual(receipt);
  const req=db.prepare('SELECT * FROM requirements WHERE id=?').get(receipt.ids[d.content.entities[0].id]) as Record<string,unknown>;
  expect(req).toMatchObject({delivery_scope:'candidate',execution_mode:'direct',owner_id:null,planned_start:null,planned_end:null,progress:0});
  expect((await request('POST',base+'/'+d.id+'/publish',{...input,batchId:randomUUID()})).statusCode).toBe(409);
  expect((await request('PUT',base+'/'+d.id,{requestId:randomUUID(),expectedVersion:2,title:'不能改',content:d.content})).statusCode).toBe(409);
});
it('本人、管理员与同账号不同 Token 的可见性；MCP 没有发布工具',async()=>{
  const projectId=await project(),d=await create(projectId,content(),memberCookie);
  expect((await request('GET',base+'/'+d.id)).statusCode).toBe(404);
  expect((await request('GET',base)).json().items.some((r:RequirementDraft)=>r.id===d.id)).toBe(false);
  expect((await request('POST',base+'/'+d.id+'/publish',publishInput(d,await preview(d,memberCookie)),memberCookie)).statusCode).toBe(403);
  const tokens:string[]=[];for(let i=0;i<2;i++)tokens.push((await request('POST','/api/tokens',{name:'draft token '+i},memberCookie)).json().token);
  for(const token of tokens){const r=JSON.parse((await mcpRequest(origin,token,'get_requirement_draft',{draftId:d.id})).body);expect(r.result.structuredContent.result.accountId).toBe(memberId);}
  const denied=JSON.parse((await mcpRequest(origin,tokens[0],'publish_requirement_draft',{draftId:d.id})).body);expect(denied.error||denied.result?.isError).toBeTruthy();
  db.prepare('DELETE FROM project_people WHERE project_id=? AND person_id=?').run(projectId,personId);
  expect((await request('GET',base+'/'+d.id,undefined,memberCookie)).json()).toMatchObject({projectAccessible:false,content:d.content});
  for(const suffix of ['/preview','/plan-preview'])expect((await request('POST',base+'/'+d.id+suffix,{expectedVersion:d.version},memberCookie)).statusCode).toBe(403);
  expect((await request('GET',base+'/'+d.id+'/context',undefined,memberCookie)).statusCode).toBe(403);
});
it('创建和保存请求防重，版本冲突保留服务端方案',async()=>{
  const input={requestId:randomUUID(),projectId:await project(),title:'第一版',content:content()};
  const d=(await request('POST',base,input)).json<RequirementDraft>();expect((await request('POST',base,input)).json().id).toBe(d.id);
  const save={requestId:randomUUID(),expectedVersion:1,title:'第二版',content:d.content};
  expect((await request('PUT',base+'/'+d.id,save)).json().version).toBe(2);expect((await request('PUT',base+'/'+d.id,save)).json().version).toBe(2);
  expect((await request('PUT',base+'/'+d.id,{...save,requestId:randomUUID(),title:'冲突'})).statusCode).toBe(409);
  expect((await request('PUT',base+'/'+d.id,{...save,title:'请求ID冲突'})).statusCode).toBe(409);
  expect((await request('GET',base+'/'+d.id)).json().title).toBe('第二版');
});
it('跨项目引用与结构错误拒绝保存，缺验收和执行环路可保存但不能发布',async()=>{
  const projectId=await project(),other=await project();const official=(await request('POST','/api/requirements',{projectId:other,title:'外部',executionMode:'direct'})).json();
  const c=content();c.references=[{entity:'requirement',id:official.id}];expect((await request('POST',base,{requestId:randomUUID(),projectId,content:c})).statusCode).toBe(400);
  c.references=[];const first=c.entities[0].id,second=randomUUID();c.entities.push({id:second,entity:'requirement',data:{title:'共享成果'}});
  c.dependencies=[{clientId:randomUUID(),sourceRequirementId:first,targetRequirementId:second,sourceWorkItemId:null,targetWorkItemId:null},{clientId:randomUUID(),sourceRequirementId:second,targetRequirementId:first,sourceWorkItemId:null,targetWorkItemId:null}];
  const d=await create(projectId,c),p=await preview(d);expect(p.errors.join()).toContain('验收条件');expect(p.errors.join()).toContain('循环');
  const before=formal();expect((await request('POST',base+'/'+d.id+'/publish',publishInput(d,p))).statusCode).toBe(400);expect(formal()).toEqual(before);
});
it('发布时异常整批回滚，过期项目预览不生效',async()=>{
  const d=await create(await project()),p=await preview(d),before=formal(),input=publishInput(d,p);
  db.exec("CREATE TEMP TRIGGER test_draft_rollback BEFORE INSERT ON source_links BEGIN SELECT RAISE(ABORT,'test rollback'); END");
  expect((await request('POST',base+'/'+d.id+'/publish',input)).statusCode).toBe(500);db.exec('DROP TRIGGER test_draft_rollback');
  expect(formal()).toEqual(before);expect((await request('GET',base+'/'+d.id+'/receipts/'+input.batchId)).json().status).toBe('not_found');
  db.prepare('UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=?').run(d.projectId);
  expect((await request('POST',base+'/'+d.id+'/publish',input)).statusCode).toBe(409);
  const p2=await preview(d);expect((await request('POST',base+'/'+d.id+'/publish',publishInput(d,p2))).statusCode).toBe(200);
});
it('工作项与里程碑依赖使用具体端点，未知人员与工期不阻断发布',async()=>{
  const c=content(),req=c.entities[0].id,w1=randomUUID(),w2=randomUUID(),m=randomUUID();
  c.entities.push({id:w1,entity:'work',requirementId:req,data:{title:'采集'}},{id:w2,entity:'work',requirementId:req,data:{title:'查询'}},{id:m,entity:'milestone',data:{title:'联合检查',confirmationMode:'manual'}});
  c.dependencies=[{clientId:randomUUID(),sourceRequirementId:req,sourceWorkItemId:w1,targetRequirementId:req,targetWorkItemId:w2},{clientId:randomUUID(),sourceRequirementId:req,sourceWorkItemId:w2,targetRequirementId:'',targetWorkItemId:null,targetMilestoneId:m}];
  const d=await create(await project(),c),p=await preview(d);expect(p.errors).toEqual([]);
  const r=await request('POST',base+'/'+d.id+'/publish',publishInput(d,p));expect(r.statusCode,r.body).toBe(200);
  const receipt=r.json<DraftReceipt>();expect(db.prepare('SELECT duration_days FROM work_items WHERE id=?').get(receipt.ids[w1])).toEqual({duration_days:null});
});

it.each(['log','org'])('%s 案例经 MCP 保存个人空间，来源、工作和完整拓扑经本人发布后生效',async name=>{
  const c=requirementDraftContent.parse(JSON.parse(fs.readFileSync(new URL(`../skills/project-manage-intake/assets/${name}-draft.json`,import.meta.url),'utf8'))),projectId=await project();
  const token=(await request('POST','/api/tokens',{name:'案例 '+name})).json().token;
  const call=async(tool:string,args:Record<string,unknown>)=>{const r=JSON.parse((await mcpRequest(origin,token,tool,args)).body);expect(r.result?.isError,JSON.stringify(r)).not.toBe(true);return r.result.structuredContent.result;};
  const before=formal(),d=await call('create_requirement_draft',{projectId,title:name+' 建议拆分',requestId:randomUUID(),content:c}) as RequirementDraft;
  expect(d.source).toBe('mcp');expect((await call('list_requirement_drafts',{projectId})).items).toHaveLength(1);
  const update=await call('update_requirement_draft',{draftId:d.id,expectedVersion:d.version,requestId:randomUUID(),title:d.title,content:c});
  const p=await call('preview_requirement_draft',{draftId:d.id,expectedVersion:update.version}) as DraftPreview;expect(p.errors).toEqual([]);
  expect((await call('preview_requirement_draft_plan',{draftId:d.id,expectedVersion:update.version})).errors).toEqual([]);expect(formal()).toEqual(before);
  const published=await request('POST',base+'/'+d.id+'/publish',publishInput(update,p));expect(published.statusCode,published.body).toBe(200);
  const receipt=published.json<DraftReceipt>();expect(await call('get_requirement_draft_publish_receipt',{draftId:d.id,batchId:receipt.batchId})).toEqual(receipt);
  const documents=db.prepare('SELECT * FROM source_documents WHERE project_id=?').all(projectId) as Array<{url:string}>;expect(documents.every(d=>d.url==='')).toBe(true);
  expect(db.prepare('SELECT count(*) AS n FROM requirements WHERE project_id=?').get(projectId)).toEqual({n:c.entities.filter(e=>e.entity==='requirement').length});
  expect(db.prepare('SELECT count(*) AS n FROM work_items WHERE requirement_id IN (SELECT id FROM requirements WHERE project_id=?)').get(projectId)).toEqual({n:c.entities.filter(e=>e.entity==='work').length});
});
it('工作流以成员读取权限展开，保存版本与结果；模板变化需重新预览，人工修改保留',async()=>{
  const projectId=await project(),template=(await request('POST','/api/templates',{projectId,name:'阶段工作流',dependencyMode:'dependencies',items:[{clientKey:'a',title:'前置成果',durationDays:2,startOffsetDays:0,sortOrder:0,predecessorKeys:[]},{clientKey:'b',title:'依赖验证',durationDays:1,startOffsetDays:2,sortOrder:1,predecessorKeys:['a']}]})).json();
  const d=await create(projectId,content(),memberCookie);
  const token=(await request('POST','/api/tokens',{name:'展开工作流'},memberCookie)).json().token;
  const before=formal();
  const expanded=JSON.parse((await mcpRequest(origin,token,'preview_requirement_draft_template',{draftId:d.id,expectedVersion:1,requirementId:d.content.entities[0].id,templateId:template.id})).body).result;
  expect(expanded.isError,JSON.stringify(expanded)).not.toBe(true);const result=expanded.structuredContent.result;expect(result.entities).toHaveLength(2);expect(result.dependencies).toHaveLength(1);expect(formal()).toEqual(before);
  const c=structuredClone(d.content);c.entities.push(...result.entities);c.dependencies.push(...result.dependencies);c.templates.push(result.template);c.entities[1].data.title='人工保留的前置成果';
  const updated=(await request('PUT',base+'/'+d.id,{requestId:randomUUID(),expectedVersion:1,title:d.title,content:c},memberCookie)).json<RequirementDraft>();
  const p=await preview(updated,memberCookie);expect(p.errors).toEqual([]);
  db.prepare('UPDATE work_item_templates SET updated_at=? WHERE id=?').run(new Date(Date.now()+1000).toISOString(),template.id);
  const latest=await preview(updated,memberCookie);expect(latest.previewToken).not.toBe(p.previewToken);expect(latest.warnings.join()).toContain('模板已变化');expect((await request('GET',base+'/'+d.id,undefined,memberCookie)).json().content.entities[1].data.title).toBe('人工保留的前置成果');
  const closed=JSON.parse((await mcpRequest(origin,token,'close_requirement_draft',{draftId:d.id,expectedVersion:updated.version,requestId:randomUUID()})).body).result;expect(closed.structuredContent.result.status).toBe('closed');
});
it('来源修订显示差异并保留旧验收，既有成果引用不会复制工作量',async()=>{
  const projectId=await project(),d=await create(projectId),p=await preview(d),receipt=(await request('POST',base+'/'+d.id+'/publish',publishInput(d,p))).json<DraftReceipt>(),req=receipt.ids[d.content.entities[0].id];
  const before=db.prepare('SELECT progress,status,accepted_at FROM requirements WHERE id=?').get(req);
  const c=emptyDraftContent();c.documents=structuredClone(d.content.documents);c.documents[0].version='v2';c.documents[0].clauses=c.documents[0].clauses.slice(0,1);c.documents[0].clauses[0].content='更新后的检索正文';c.references=[{entity:'requirement',id:req}];
  const next=await create(projectId,c),changed=await preview(next);expect(changed.sourceChanges).toHaveLength(1);
  expect((await request('POST',base+'/'+next.id+'/publish',publishInput(next,changed))).statusCode).toBe(200);
  const catalog=(await request('GET',`/api/projects/${projectId}/requirement-intake`)).json();expect(catalog.documents[0].clauses).toHaveLength(2);expect(catalog.documents[0].clauses.find((c:{key:string})=>c.key==='a').links[0].needsReview).toBe(true);
  expect(db.prepare('SELECT progress,status,accepted_at FROM requirements WHERE id=?').get(req)).toEqual(before);expect(db.prepare('SELECT count(*) AS n FROM requirements WHERE project_id=?').get(projectId)).toEqual({n:1});
});
