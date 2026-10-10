import {listenTestApp} from './support/listen';
import {mcpRequest} from './mcp-request';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scryptSync } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Requirement } from '../src/shared/api/requirements';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'project-manage-deletion-'));
const password = 'temporary-deletion-password-123';
process.env.DB_PATH = path.join(directory, 'test.db');
process.env.BACKUP_DIR = path.join(directory, 'backups');
process.env.WEB_DIST_DIR = path.join(directory, 'web');
process.env.SEED_DEMO = '0';
process.env.NODE_ENV = 'test';
process.env.APP_PASSWORD_HASH = `scrypt$deletion$${scryptSync(password, 'deletion', 64).toString('hex')}`;
process.env.SESSION_SECRET = 'deletion-temporary-test-secret-123456789';
let app: FastifyInstance;
let cookie = '';
let token = '';
let origin = '';
let projectId = '';
let templateId = '';
let ownerId = '';
let sequence = 0;
const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url, headers: { cookie }, payload });
const detail = async (id: string) => (await app.inject({ url: `/api/requirements/${id}`, headers: { cookie } })).json<Requirement>();
async function createRequirement() {
  const created = await post('/api/requirements', { projectId, ownerId, templateId, title: `删除场景${++sequence}`, plannedStart: '2020-01-02' });
  expect(created.statusCode, created.body).toBe(200);
  return created.json<Requirement>();
}
async function remove(protocol: 'REST' | 'MCP', id: string, expectedVersion: number) {
  if (protocol === 'REST') {
    const response = await app.inject({ method: 'DELETE', url: `/api/work-items/${id}`, headers: { cookie }, payload: { expectedVersion } });
    return { statusCode: response.statusCode, body: response.json() };
  }
  const response=await mcpRequest(origin,token,'delete_work_item',{id,expectedVersion});
  expect(response.statusCode).toBe(200);
  const payload=JSON.parse(response.body) as { result: { structuredContent: { statusCode?: number; result: unknown } } };
  return { statusCode: payload.result.structuredContent.statusCode || 200, body: payload.result.structuredContent.result };
}
beforeAll(async () => {
  app = await (await import('../src/server/app')).buildApp();
  origin = await listenTestApp(app);
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password } });
  expect(login.statusCode, login.body).toBe(200);
  cookie = String(login.headers['set-cookie']).split(';')[0];
  token = (await post('/api/tokens', { name: '删除验证' })).json().token;
  projectId = (await post('/api/projects', { name: '删除验证' })).json().id;
  ownerId = (await post('/api/people', { projectId, name: '删除测试负责人' })).json().id;
  templateId = (await post('/api/templates', { projectId, name: '分段计划', items: [
    { title: '实现', startOffsetDays: 0, durationDays: 1, sortOrder: 0 },
    { title: '验收准备', startOffsetDays: 3, durationDays: 2, sortOrder: 1 },
  ] })).json().id;
});
afterAll(async () => {
  await app?.close();
  const { sqlite } = await import('./support/database');
  if (sqlite.open) sqlite.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

it('工作项排序审计保留所属项目', async () => {
  const requirement = await createRequirement();
  const response = await post(`/api/requirements/${requirement.id}/reorder-work-items`, {
    ids: requirement.workItems!.map((item) => item.id).reverse(), expectedVersion: requirement.version,
  });
  expect(response.statusCode, response.body).toBe(200);
  const { sqlite } = await import('./support/database');
  expect(sqlite.prepare("SELECT project_id AS projectId FROM audit_logs WHERE action='reorder' AND entity_id=? ORDER BY rowid DESC LIMIT 1").get(requirement.id)).toEqual({ projectId });
});

it('两个日志接口区分当前与已删除对象，不修改历史记录或未知类型', async () => {
  const requirement=await createRequirement(),{sqlite}=await import('./support/database');
  const actor=sqlite.prepare("SELECT id FROM accounts WHERE username='admin'").get() as {id:string};
  const marker='对象生命周期复查',insert=sqlite.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,entity_type,entity_id,project_id,summary,created_at) VALUES(?,'user',?,'create',?,?,?,?,?)");
  const current=[['project',projectId],['requirement',requirement.id],['work_item',requirement.workItems![0].id]];
  const removed=['project','feature','feature_phase','requirement','work_item','issue'].map(type=>[type,'removed-'+type]);
  for(const [type,id] of [...current,...removed,['backup','old-file']])insert.run('audit-'+id,actor.id,type,id,projectId,marker+' '+id,new Date().toISOString());
  const original=sqlite.prepare('SELECT * FROM audit_logs WHERE summary LIKE ? ORDER BY id').all(marker+'%');
  for(const url of ['/api/audit?limit=500','/api/audit/search?q='+encodeURIComponent(marker)]){
    const response=await app.inject({url,headers:{cookie}});expect(response.statusCode,response.body).toBe(200);
    const entries=(Array.isArray(response.json())?response.json():response.json().items).filter((entry:{summary:string})=>entry.summary.startsWith(marker));
    expect(entries).toHaveLength(10);
    for(const [type,id] of current)expect(entries.find((entry:{entityType:string;entityId:string})=>entry.entityType===type&&entry.entityId===id)).toMatchObject({objectDeleted:false});
    for(const [type,id] of removed)expect(entries.find((entry:{entityType:string;entityId:string})=>entry.entityType===type&&entry.entityId===id)).toMatchObject({objectDeleted:true});
    expect(entries.find((entry:{entityType:string})=>entry.entityType==='backup').objectDeleted).toBeUndefined();
  }
  expect(sqlite.prepare('SELECT * FROM audit_logs WHERE summary LIKE ? ORDER BY id').all(marker+'%')).toEqual(original);
});

for (const protocol of ['REST', 'MCP'] as const) {
  it(`${protocol}删除安全工作项后同步需求计划，只生成一次删除记录`, async () => {
    const before = await createRequirement();
    const item = before.workItems!.at(-1)!;
    const deleted = await remove(protocol, item.id, item.version);
    expect(deleted).toEqual({ statusCode: 200, body: { ok: true } });
    const after = await detail(before.id);
    expect(after.version).toBe(before.version + 1);
    expect(after.workItems!.map(withoutForecastRevision)).toEqual([withoutForecastRevision(before.workItems![0])]);
    expect(after.plannedEnd).toBe(before.workItems![0].plannedEnd);
    expect((await remove(protocol, item.id, item.version)).statusCode).toBe(404);
    const { sqlite } = await import('./support/database');
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='delete' AND entity_id=?").get(item.id)).toEqual({ n: 1 });
    expect(sqlite.prepare("SELECT project_id AS projectId FROM audit_logs WHERE action='delete' AND entity_id=?").get(item.id)).toEqual({ projectId });
    const audit=(await app.inject({url:'/api/audit/search?'+new URLSearchParams({projectId,q:item.id}),headers:{cookie}})).json();
    expect(audit.items.find((entry:{entityId:string})=>entry.entityId===item.id)).toMatchObject({workItemDeleted:true,workItemRequirementId:null});
  });

  it(`${protocol}其他工作项的说明不阻止安全删除，旧版本提交不能删除`, async () => {
    const before = await createRequirement();
    const item = before.workItems!.at(-1)!;
    expect((await post(`/api/requirements/${before.id}/progress`, { workItemId: before.workItems![0].id, content: '保留其他工作项说明' })).statusCode).toBe(200);
    const updated = await app.inject({ method: 'PATCH', url: `/api/work-items/${item.id}`, headers: { cookie }, payload: { title: '变更后的验收准备', expectedVersion: item.version } });
    expect(updated.statusCode, updated.body).toBe(200);
    const current = await detail(before.id);
    expect((await remove(protocol, item.id, item.version)).statusCode).toBe(409);
    expect(await detail(before.id)).toEqual(current);
    expect((await remove(protocol, item.id, updated.json().version)).statusCode).toBe(200);
    const after = await detail(before.id);
    expect(after.workItems!.map(withoutForecastRevision)).toEqual([withoutForecastRevision(before.workItems![0])]);
    expect(after.progressUpdates).toEqual(current.progressUpdates);
  });

  it.each(['note', 'blocked_reason', 'cancelled_requirement'])(`${protocol}保留%s历史，不允许删除且不产生部分写入`, async (scenario) => {
    const requirement = await createRequirement();
    const item = requirement.workItems!.at(-1)!;
    const { sqlite } = await import('./support/database');
    if (scenario === 'note') {
      const response = await post(`/api/requirements/${requirement.id}/progress`, { workItemId: item.id, content: '尚未开始时的工作说明' });
      expect(response.statusCode, response.body).toBe(200);
    } else if (scenario === 'cancelled_requirement') {
      sqlite.prepare("UPDATE requirements SET status='cancelled' WHERE id=?").run(requirement.id);
    } else {
      // 数据库允许保留阻塞原因，但这类历史记录不能物理删除。
      sqlite.prepare('UPDATE work_items SET blocked_reason=? WHERE id=?').run('等待外部确认', item.id);
    }
    const before = await detail(requirement.id);
    const deleted = await remove(protocol, item.id, item.version);
    expect(deleted.statusCode, JSON.stringify(deleted.body)).toBe(409);
    expect(await detail(requirement.id)).toEqual(before);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='delete' AND entity_id=?").get(item.id)).toEqual({ n: 0 });
  });
}
import { withoutForecastRevision } from './fixtures/forecast-snapshot';

async function cancelWork(protocol: 'REST' | 'MCP', id: string, input: Record<string, unknown>) {
  if (protocol === 'REST') {
    const response = await post(`/api/work-items/${id}/cancel`,input);
    return {statusCode:response.statusCode,body:response.json()};
  }
  const response=await mcpRequest(origin,token,'cancel_work_item',{id,...input});
  const result=JSON.parse(response.body).result.structuredContent;
  return {statusCode:result.statusCode || 200,body:result.result};
}
const workDetail = async(id:string)=>(await app.inject({url:`/api/work-items/${id}`,headers:{cookie}})).json();

for (const protocol of ['REST','MCP'] as const) {
  it(`${protocol}取消执行中的工作后移除实体，保留原历史、Jira来源和记录查询；重新添加不继承执行`,async()=>{
    let r=await createRequirement();let work=r.workItems![0];
    work=(await app.inject({method:'PATCH',url:`/api/work-items/${work.id}`,headers:{cookie},payload:{expectedVersion:work.version,ownerId}})).json();
    work=(await post(`/api/work-items/${work.id}/start`,{expectedVersion:work.version})).json();
    expect((await post(`/api/requirements/${r.id}/progress`,{workItemId:work.id,expectedVersion:work.version,workItemPercent:40,content:'取消前已完成调查'})).statusCode).toBe(200);
    r=await detail(r.id);work=r.workItems![0];const history=r.progressUpdates || [];
    const impact=(await workDetail(work.id)).cancellationImpact;
    expect((await cancelWork(protocol,work.id,{expectedVersion:work.version,expectedDependencyRevision:impact.revision,reason:'范围缩减'})).statusCode).toBe(200);
    const after=await detail(r.id),{sqlite}=await import('./support/database');
    expect(after.workItems!.some(w=>w.id===work.id)).toBe(false);
    expect(after.progressUpdates).toEqual(expect.arrayContaining(history));
    expect(after.progressUpdates).toEqual(expect.arrayContaining([expect.objectContaining({eventType:'cancel',workItemId:work.id,workItemTitle:work.title,workItemPercent:40})]));
    expect(sqlite.prepare('SELECT id FROM work_items WHERE id=?').get(work.id)).toBeUndefined();
    expect(sqlite.prepare('SELECT work_item_id AS active,deleted_work_item_id AS oldId,deleted_work_item_title AS title FROM progress_updates WHERE deleted_work_item_id=?').all(work.id)).toEqual(expect.arrayContaining([{active:null,oldId:work.id,title:work.title}]));
    const audit=(await app.inject({url:'/api/audit/search?'+new URLSearchParams({projectId,q:work.id}),headers:{cookie}})).json();
    expect(audit.items.length).toBeGreaterThan(1);
    expect(audit.items.filter((entry:{entityType:string})=>entry.entityType==='work_item')).toEqual(expect.arrayContaining([expect.objectContaining({entityId:work.id,workItemDeleted:true,workItemRequirementId:r.id})]));
    const foreign=(await post('/api/projects',{name:'不同范围审计'+protocol})).json();
    sqlite.prepare("INSERT INTO audit_logs(id,actor_type,action,entity_type,entity_id,project_id,summary,created_at) VALUES(?,'system','delete','work_item',?,?,?,?)")
      .run('foreign-audit-'+work.id,work.id,foreign.id,'范围不一致的旧记录',new Date().toISOString());
    const foreignAudit=(await app.inject({url:'/api/audit/search?'+new URLSearchParams({projectId:foreign.id}),headers:{cookie}})).json();
    expect(foreignAudit.items[0]).toMatchObject({workItemDeleted:true,workItemRequirementId:null});
    const response=await mcpRequest(origin,token,'list_progress_updates',{projectId,workItemId:work.id});
    const records=JSON.parse(response.body).result.structuredContent.result.items;
    expect(records.length).toBeGreaterThan(1);
    expect(records.every((entry:{workItemTitle:string})=>entry.workItemTitle===work.title)).toBe(true);
    expect((await post(`/api/work-items/${work.id}/reopen`,{expectedVersion:work.version+1})).statusCode).toBe(404);
    const added=(await post(`/api/requirements/${r.id}/work-items`,{expectedVersion:after.version,title:work.title})).json();
    expect(added).toMatchObject({status:'not_started',progress:0,actualStart:null,ownerId:null});expect(added.id).not.toBe(work.id);
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  });
}

it('取消依赖链中间工作需确认最新影响，不自动接线或达成里程碑',async()=>{
  const r=await createRequirement(),external=await createRequirement(),work=r.workItems![0],peer=r.workItems![1],upstream=external.workItems![0];
  const {sqlite}=await import('./support/database');const now=new Date().toISOString();
  const insert=sqlite.prepare("INSERT INTO dependency_edges(id,project_id,source_requirement_id,target_requirement_id,source_work_item_id,target_work_item_id,origin,created_at,updated_at) VALUES(?,?,?,?,?,?,'manual',?,?)");
  insert.run(work.id+'in',projectId,external.id,r.id,upstream.id,work.id,now,now);
  insert.run(work.id+'out',projectId,r.id,r.id,work.id,peer.id,now,now);
  sqlite.prepare("INSERT INTO milestones(id,project_id,title,confirmation_mode,created_at,updated_at) VALUES(?,?,?,'auto',?,?)").run(work.id+'mile',projectId,'待核对交付',now,now);
  sqlite.prepare("INSERT INTO dependency_edges(id,project_id,source_requirement_id,source_work_item_id,target_milestone_id,origin,created_at,updated_at) VALUES(?,?,?,?,?,'manual',?,?)").run(work.id+'delivery',projectId,r.id,work.id,work.id+'mile',now,now);
  const before=await detail(r.id),preview=(await workDetail(work.id)).cancellationImpact;
  expect(preview.dependencies).toEqual(expect.arrayContaining([expect.objectContaining({sourceTitle:work.title,targetTitle:peer.title})]));
  expect((await cancelWork('REST',work.id,{expectedVersion:work.version})).statusCode).toBe(409);
  expect(await detail(r.id)).toEqual(before);
  sqlite.prepare('UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=?').run(projectId);
  expect((await cancelWork('REST',work.id,{expectedVersion:work.version,expectedDependencyRevision:preview.revision})).statusCode).toBe(409);
  const impact=(await workDetail(work.id)).cancellationImpact;
  expect((await cancelWork('REST',work.id,{expectedVersion:work.version,expectedDependencyRevision:impact.revision})).statusCode).toBe(200);
  expect(sqlite.prepare('SELECT id FROM dependency_edges WHERE source_work_item_id=? OR target_work_item_id=?').all(work.id,work.id)).toEqual([]);
  expect(sqlite.prepare('SELECT id FROM dependency_edges WHERE source_work_item_id=? AND target_work_item_id=?').get(upstream.id,peer.id)).toBeUndefined();
  expect(sqlite.prepare('SELECT achieved_at AS achievedAt,confirmation_mode AS mode FROM milestones WHERE id=?').get(work.id+'mile')).toEqual({achievedAt:null,mode:'manual'});
});

it('取消最后一项工作保持需求未完成，旧版本与写入故障均不部分删除',async()=>{
  const r=await createRequirement(),first=r.workItems![0],last=r.workItems![1],{sqlite}=await import('./support/database');
  expect((await cancelWork('REST',first.id,{expectedVersion:first.version+1})).statusCode).toBe(409);
  sqlite.exec("CREATE TEMP TRIGGER fail_cancel_audit BEFORE INSERT ON audit_logs WHEN NEW.action='cancel' BEGIN SELECT RAISE(ABORT,'simulated cancellation failure'); END;");
  const preview=(await workDetail(first.id)).cancellationImpact;
  try {expect((await cancelWork('REST',first.id,{expectedVersion:first.version,expectedDependencyRevision:preview.revision})).statusCode).not.toBe(200);}
  finally {sqlite.exec('DROP TRIGGER fail_cancel_audit');}
  expect(await detail(r.id)).toEqual(r);
  for(const work of [first,last]){
    const impact=(await workDetail(work.id)).cancellationImpact;
    expect((await cancelWork('REST',work.id,{expectedVersion:work.version,expectedDependencyRevision:impact.revision})).statusCode).toBe(200);
  }
  const after=await detail(r.id);expect(after).toMatchObject({executionMode:'direct',status:'not_started',progress:0,workItems:[]});
  expect(after.progressUpdates!.filter(u=>u.eventType==='cancel'&&u.workItemId)).toHaveLength(2);
  expect(after.progressUpdates!.some(u=>u.eventType==='complete')).toBe(false);
});

for(const protocol of ['REST','MCP'] as const){
 it(`${protocol} 删除工作项自动清理双向及跨需求依赖，保留其他工作和关联`,async()=>{
  const r=await createRequirement(),other=await createRequirement(),work=r.workItems![0],peer=r.workItems![1],external=other.workItems![0];
  const {sqlite}=await import('./support/database');
  const insert=sqlite.prepare("INSERT INTO dependency_edges(id,project_id,source_requirement_id,target_requirement_id,source_work_item_id,target_work_item_id,origin,created_at,updated_at) VALUES(?,?,?,?,?,?,'manual',?,?)");
  const now=new Date().toISOString(),ids=['incoming','outgoing','keep'].map(label=>work.id+label);
  insert.run(ids[0],projectId,other.id,r.id,external.id,work.id,now,now);
  insert.run(ids[1],projectId,r.id,r.id,work.id,peer.id,now,now);
  insert.run(ids[2],projectId,other.id,r.id,external.id,peer.id,now,now);
  const beforeRevision=(sqlite.prepare('SELECT analysis_revision AS revision FROM projects WHERE id=?').get(projectId) as {revision:number}).revision;
  expect((await remove(protocol,work.id,work.version+1)).statusCode).toBe(409);
  expect(sqlite.prepare('SELECT id FROM dependency_edges WHERE id IN (?,?,?)').all(...ids)).toHaveLength(3);
  const result=await remove(protocol,work.id,work.version);expect(result.statusCode,JSON.stringify(result.body)).toBe(200);
  expect(sqlite.prepare('SELECT id FROM dependency_edges WHERE id IN (?,?,?)').all(...ids)).toEqual([{id:ids[2]}]);
  expect((await detail(r.id)).workItems!.map(w=>w.id)).toEqual([peer.id]);expect((await detail(other.id)).workItems!.map(w=>w.id)).toContain(external.id);
  const log=sqlite.prepare("SELECT summary FROM audit_logs WHERE action='delete' AND entity_id=?").get(work.id) as {summary:string};expect(JSON.parse(log.summary).removedDependencies).toHaveLength(2);
  expect((sqlite.prepare('SELECT analysis_revision AS revision FROM projects WHERE id=?').get(projectId) as {revision:number}).revision).toBeGreaterThan(beforeRevision);
  expect(sqlite.pragma('foreign_key_check')).toEqual([]);
 });
}

it('删除中途失败时同时回滚工作项、依赖、需求汇总与审计',async()=>{
 const r=await createRequirement(),work=r.workItems![0],peer=r.workItems![1],{sqlite}=await import('./support/database');
 sqlite.prepare("INSERT INTO dependency_edges(id,project_id,source_requirement_id,target_requirement_id,source_work_item_id,target_work_item_id,origin,created_at,updated_at) VALUES(?,?,?,?,?,?,'manual',?,?)").run(work.id+'edge',projectId,r.id,r.id,work.id,peer.id,new Date().toISOString(),new Date().toISOString());
 const before=await detail(r.id),edge=sqlite.prepare('SELECT * FROM dependency_edges WHERE id=?').get(work.id+'edge');
 sqlite.exec("CREATE TEMP TRIGGER fail_delete_audit BEFORE INSERT ON audit_logs WHEN NEW.action='delete' AND NEW.entity_type='work_item' BEGIN SELECT RAISE(ABORT,'simulated audit failure'); END;");
 try{expect((await remove('REST',work.id,work.version)).statusCode).not.toBe(200);}finally{sqlite.exec('DROP TRIGGER fail_delete_audit');}
 expect(await detail(r.id)).toEqual(before);expect(sqlite.prepare('SELECT * FROM dependency_edges WHERE id=?').get(work.id+'edge')).toEqual(edge);
 expect(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='delete' AND entity_id=?").get(work.id)).toEqual({n:0});
});
