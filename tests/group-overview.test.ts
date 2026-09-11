import { afterAll, beforeAll, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, scryptSync } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { emptyGroupOverview, type RequirementGroup, type IntakeCatalog } from '../src/shared/intake';
import { summarizeGroupOverview, type GroupOverviewReport } from '../src/shared/group-overview';
import { mcpRequest } from './mcp-request';

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pm-group-overview-')),password='overview-isolated-test';
Object.assign(process.env,{DB_PATH:path.join(directory,'test.db'),BACKUP_DIR:path.join(directory,'backups'),WEB_DIST_DIR:path.join(directory,'web'),SEED_DEMO:'0',NODE_ENV:'test',APP_PASSWORD_HASH:'scrypt$overview$'+scryptSync(password,'overview',64).toString('hex'),SESSION_SECRET:'group-overview-isolated-secret-more-than-thirty-two-characters'});
let app:FastifyInstance,cookie='';
const request=(method:'POST'|'GET'|'PATCH'|'DELETE'|'PUT',url:string,payload?:unknown,auth=cookie)=>app.inject({method,url,headers:{cookie:auth},payload:payload as Record<string,unknown>});
const read=async(projectId:string)=>(await request('GET','/api/projects/'+projectId+'/group-overview')).json<GroupOverviewReport>();
const save=(projectId:string,payload:unknown,auth=cookie)=>request('POST','/api/projects/'+projectId+'/requirement-groups',payload,auth);
beforeAll(async()=>{app=await(await import('../src/server/app')).buildApp();await app.ready();const login=await request('POST','/api/login',{username:'admin',password},'');expect(login.statusCode).toBe(200);cookie=String(login.headers['set-cookie']).split(';')[0];});
afterAll(async()=>{await app.close();const{sqlite}=await import('../src/server/database');sqlite.close();expect(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep)).toBe(true);fs.rmSync(directory,{recursive:true,force:true});});
async function fixture(){
  const project=(await request('POST','/api/projects',{name:'总体进展 '+randomUUID()})).json<{id:string}>();
  const saved=await save(project.id,{name:'权限管理',sortOrder:0});expect(saved.statusCode,saved.body).toBe(200);
  return {projectId:project.id,group:saved.json<IntakeCatalog>().groups[0]};
}
const overview={expectation:'本季度具备试用条件',progressSummary:'基础授权已完成',assessment:'on_track' as const,note:'复杂权限场景稍慢，暂不影响试用'};
const update=(group:RequirementGroup,extra:Record<string,unknown>={})=>({id:group.id,name:group.name,sortOrder:group.sortOrder,expectedVersion:group.version,...extra});

it('旧分组默认待评估，空分组和空项目不制造进展',async()=>{
  const {projectId,group}=await fixture();expect(group.overview).toEqual(emptyGroupOverview);expect(group.assessedAt).toBeNull();expect(group.assessedBy).toBeNull();
  const report=await read(projectId);expect(report.groups[0].counts).toEqual({total:0,completed:0,inProgress:0,delayed:0,unscheduled:0,recentCompleted:0});expect(report.ungroupedCount).toBe(0);
  await request('DELETE','/api/projects/'+projectId+'/requirement-groups/'+group.id,{expectedVersion:group.version});expect((await read(projectId)).groups).toEqual([]);
});
it('评估保存后旧接口改名和排序保留评估，审计记录修改前后内容',async()=>{
  const {projectId,group}=await fixture();
  const saved=(await save(projectId,update(group,{overview}))).json<IntakeCatalog>().groups[0];
  expect(saved.overview).toEqual(overview);expect(saved.assessedAt).toBeTruthy();expect(saved.assessedByName).toBe('admin');
  await save(projectId,{name:'空特性',sortOrder:1});
  const renamed=(await save(projectId,update(saved,{name:'权限能力',sortOrder:1}))).json<IntakeCatalog>().groups.find(g=>g.id===group.id)!;
  expect(renamed.overview).toEqual(overview);expect(renamed.assessedAt).toBe(saved.assessedAt);expect(renamed.assessedBy).toBe(saved.assessedBy);
  expect((await save(projectId,update(group,{overview}))).statusCode).toBe(409);
  const {sqlite}=await import('../src/server/database');const audit=sqlite.prepare('SELECT summary FROM audit_logs WHERE project_id=? AND summary LIKE ?').all(projectId,'更新分组总体进展%') as {summary:string}[];
  expect(audit).toHaveLength(1);expect(audit[0].summary).toContain('修改前');expect(audit[0].summary).toContain('本季度具备试用条件');
  const versionBefore=renamed.version;
  expect((await save(projectId,update(renamed,{overview:{...overview,assessment:'automatic'}}))).statusCode).toBe(400);
  expect((await save(projectId,update(renamed,{overview:{...overview,note:'字'.repeat(2001)}}))).statusCode).toBe(400);
  expect((await read(projectId)).groups.find(g=>g.id===group.id)?.version).toBe(versionBefore);
});
it('汇总按当前分组和实际完成日期计算，排除取消归档及未来完成日期',()=>{
  const group:RequirementGroup={id:'g',projectId:'p',name:'大特性',sortOrder:0,version:1,overview,assessedAt:'2026-09-09T01:00:00Z',assessedBy:'a',assessedByName:'经理'};
  const facts=[
    {id:'1',title:'临界完成',groupId:'g',status:'completed',executionCompletedAt:'2026-09-04T16:00:00Z'},
    {id:'2',title:'更早完成',groupId:'g',status:'completed',actualEnd:'2026-09-04'},
    {id:'3',title:'未来完成',groupId:'g',status:'completed',actualEnd:'2026-09-12'},
    {id:'4',title:'没有完成日期',groupId:'g',status:'completed'},
    {id:'5',title:'延期中',groupId:'g',status:'in_progress',delayed:true,scheduleComplete:true},
    {id:'6',title:'未排期',groupId:'g',status:'not_started'},
    {id:'7',title:'取消',groupId:'g',status:'cancelled',delayed:true},
    {id:'8',title:'归档',groupId:'g',status:'completed',actualEnd:'2026-09-11',deletedAt:'2026-09-11'},
    {id:'9',title:'未分组',status:'not_started'},
  ];
  const report=summarizeGroupOverview([group],facts,'2026-09-11');
  expect(report.recentFrom).toBe('2026-09-05');expect(report.groups[0].counts).toEqual({total:6,completed:4,inProgress:1,delayed:1,unscheduled:1,recentCompleted:1});expect(report.ungroupedCount).toBe(1);
  expect(report.groups[0].overview).toEqual(overview);expect(report.groups[0].assessedAt).toBe(group.assessedAt);
  const done=summarizeGroupOverview([group],facts.slice(0,1),'2026-09-11');expect(done.groups[0].overview.assessment).toBe('on_track');
});
it('服务读取最新三条进展，需求移动和删除分组后重新归集，人工评估不随事实变化',async()=>{
  const {projectId,group}=await fixture();await save(projectId,update(group,{overview}));
  const {sqlite}=await import('../src/server/database');const now='2026-09-11T01:00:00.000Z';
  const add=(title:string,status='not_started',groupId:string|null=group.id,deletedAt:string|null=null)=>{
    const id=randomUUID();sqlite.prepare('INSERT INTO requirements(id,project_id,group_id,title,status,progress,execution_mode,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,0,\'direct\',?,?,?)').run(id,projectId,groupId,title,status,now,now,deletedAt);return id;
  };
  const first=add('授权'),second=add('审计'),cancelled=add('取消','cancelled'),archived=add('归档','not_started',group.id,now);add('未分组','not_started',null);
  for(const [index,id] of [first,second,first,second,cancelled,archived].entries())sqlite.prepare('INSERT INTO progress_updates(id,requirement_id,percent,content,created_at,updated_at) VALUES(?,?,0,?,?,?)').run(randomUUID(),id,'进展 '+index,'2026-09-11T01:00:0'+index+'.000Z',now);
  const report=await read(projectId),before=report.groups[0];expect(before.counts.total).toBe(2);expect(before.recentUpdates.map(u=>u.content)).toEqual(['进展 3','进展 2','进展 1']);expect(report.ungroupedCount).toBe(1);
  const secondGroup=(await save(projectId,{name:'第二特性',sortOrder:1})).json<IntakeCatalog>().groups[1];
  const version=(await request('GET','/api/requirements/'+first)).json().version;
  expect((await request('POST','/api/projects/'+projectId+'/requirement-organization',{requirements:[{id:first,expectedVersion:version}],groupId:secondGroup.id})).statusCode).toBe(200);
  const moved=await read(projectId);expect(moved.groups[0].counts.total).toBe(1);expect(moved.groups[1].counts.total).toBe(1);expect(moved.groups[1].recentUpdates.map(u=>u.content)).toEqual(['进展 2','进展 0']);expect(moved.groups[0].overview).toEqual(before.overview);expect(moved.groups[0].assessedAt).toBe(before.assessedAt);
  expect((await request('DELETE','/api/projects/'+projectId+'/requirement-groups/'+group.id,{expectedVersion:moved.groups[0].version})).statusCode).toBe(200);
  const removed=await read(projectId);expect(removed.groups).toHaveLength(1);expect(removed.ungroupedCount).toBe(2);expect((await request('GET','/api/requirements/'+second)).json().title).toBe('审计');
});
it('项目成员只读、经理可编辑，跨项目和失效账号被拒绝',async()=>{
  const {projectId,group}=await fixture();const personName='成员 '+randomUUID();
  const person=(await request('POST','/api/people',{projectId,name:personName})).json<{id:string}>();
  let login=await request('POST','/api/login',{username:personName,password:'888888'},'');let auth=String(login.headers['set-cookie']).split(';')[0];
  login=await request('POST','/api/account/change-password',{currentPassword:'888888',newPassword:'group-overview-member'},auth);auth=String(login.headers['set-cookie']).split(';')[0];
  expect((await request('GET','/api/projects/'+projectId+'/group-overview',undefined,auth)).statusCode).toBe(200);
  expect((await save(projectId,update(group,{overview}),auth)).statusCode).toBe(403);
  const other=await fixture();expect((await request('GET','/api/projects/'+other.projectId+'/group-overview',undefined,auth)).statusCode).toBe(403);
  expect((await request('PUT','/api/projects/'+projectId+'/members/'+person.id,{role:'manager'})).statusCode).toBe(200);
  const result=await save(projectId,update(group,{overview}),auth);expect(result.statusCode,result.body).toBe(200);expect(result.json<IntakeCatalog>().groups[0].assessedByName).toBe(personName);
  const {sqlite}=await import('../src/server/database');sqlite.prepare("UPDATE accounts SET status='disabled' WHERE person_id=?").run(person.id);
  expect((await request('GET','/api/projects/'+projectId+'/group-overview',undefined,auth)).statusCode).toBe(401);
});
it('MCP 和 REST 共用总体进展读写与校验，项目刷新版本随评估变更',async()=>{
  const {projectId,group}=await fixture();const token=(await request('POST','/api/tokens',{name:'总体进展测试',expiresInDays:1})).json().token;
  const address=await app.listen({host:'127.0.0.1',port:0});
  const call=async(name:string,args:Record<string,unknown>)=>{
    const response=await mcpRequest(address,token,name,args);expect(response.statusCode,response.body).toBe(200);
    const body=JSON.parse(response.body.startsWith('event:')?response.body.split('\n').find(line=>line.startsWith('data: '))!.slice(6):response.body);
    expect(body.result?.isError,JSON.stringify(body)).not.toBe(true);return JSON.parse(body.result.content[0].text);
  };
  const before=(await request('GET','/api/projects/'+projectId+'/change-version')).json().version;
  await call('save_requirement_group',{projectId,...update(group,{overview})});
  expect(await call('get_group_overview',{projectId})).toEqual(await read(projectId));
  expect((await call('list_requirement_groups',{projectId}))[0].overview).toEqual(overview);
  expect((await request('GET','/api/projects/'+projectId+'/change-version')).json().version).not.toBe(before);
});
