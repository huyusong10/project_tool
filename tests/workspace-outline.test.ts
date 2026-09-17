import {beforeAll,afterAll,it,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {scryptSync,randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import Database from 'better-sqlite3';
import {initializeWorkspaceOrder} from '../src/server/workspace-migration';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pm-outline-')),password='outline-isolated-test';
Object.assign(process.env,{DB_PATH:path.join(directory,'test.db'),BACKUP_DIR:path.join(directory,'backups'),WEB_DIST_DIR:path.join(directory,'web'),SEED_DEMO:'0',NODE_ENV:'test',ADMIN_PASSWORD:'',APP_PASSWORD_HASH:'scrypt$outline$'+scryptSync(password,'outline',64).toString('hex'),SESSION_SECRET:'outline-isolated-secret-more-than-thirty-two-characters'});
let app:FastifyInstance,cookie='';
const request=(method:'GET'|'POST'|'DELETE',url:string,payload?:unknown)=>app.inject({method,url,headers:{cookie},payload:payload as Record<string,unknown>});
beforeAll(async()=>{app=await(await import('../src/server/app')).buildApp();await app.ready();cookie=String((await request('POST','/api/login',{username:'admin',password})).headers['set-cookie']).split(';')[0];});
afterAll(async()=>{await app.close();(await import('./support/database')).sqlite.close();fs.rmSync(directory,{recursive:true,force:true});});
async function fixture(){
  const p=(await request('POST','/api/projects',{name:'Outline '+randomUUID()})).json(),base='/api/projects/'+p.id;
  const f=(await request('POST',base+'/features',{name:'资产管理'})).json().features[0];
  const create=async(title:string,featureId?:string)=>{const result=await request('POST','/api/requirements',{projectId:p.id,title,...(featureId?{featureId}:{})});expect(result.statusCode,result.body).toBe(200);return result.json();};
  return {p,base,f,create};
}
it('系统归类稳定且受保护，其需求正常创建和排序',async()=>{
  const f=await fixture();await f.create('补充需求');
  const features=(await request('GET',f.base+'/features')).json(),other=features.find((g:{kind:string})=>g.kind==='other');
  expect(other.name).toBe('其他需求');expect(features.at(-1).id).toBe(other.id);
  for(const [url,body] of [[f.base+'/features',{id:other.id,name:'改名',expectedVersion:other.version}],[f.base+'/features/'+other.id+'/archive',{expectedVersion:other.version}],[f.base+'/features/'+other.id+'/phases',{name:'Phase 1'}],[f.base+'/feature-relations',{sourceFeatureId:other.id,targetFeatureId:f.f.id}]] as const)expect((await request('POST',url,body)).statusCode).toBe(400);
  expect((await request('POST',f.base+'/features',{id:f.f.id,name:'其他需求',expectedVersion:f.f.version})).statusCode).toBe(400);
  await f.create('另一个补充需求');expect((await request('GET',f.base+'/features')).json().filter((g:{kind:string})=>g.kind==='other')).toHaveLength(1);
});
it('完整同级排序，过期版本和漏项均整批回滚；新需求追加末尾',async()=>{
  const f=await fixture(),a=await f.create('需求 2',f.f.id),b=await f.create('需求 10',f.f.id);
  const body={kind:'requirement',parentId:f.f.id,items:[{id:b.id,expectedVersion:b.version},{id:a.id,expectedVersion:a.version}]};
  const sorted=await request('POST',f.base+'/outline-order',body);expect(sorted.statusCode,sorted.body).toBe(200);expect(sorted.json().items.map((r:{id:string})=>r.id)).toEqual([b.id,a.id]);
  expect((await request('POST',f.base+'/outline-order',body)).statusCode).toBe(409);
  expect((await request('POST',f.base+'/outline-order',{...body,items:sorted.json().items.slice(0,1).map((r:{id:string;version:number})=>({id:r.id,expectedVersion:r.version}))})).statusCode).toBe(409);
  const c=await f.create('需求 1',f.f.id);
  const queried=(await request('GET','/api/requirements/query?projectId='+f.p.id+'&sort=manual')).json();
  // The service is also shared by the MCP query tool.
  expect(queried.items.map((r:{id:string})=>r.id)).toEqual([b.id,a.id,c.id]);
  const {sqlite}=await import('./support/database');expect((sqlite.prepare('SELECT id FROM requirements WHERE feature_id=? ORDER BY sort_order').all(f.f.id) as Array<{id:string}>).map(r=>r.id)).toEqual([b.id,a.id,c.id]);
});
it('批量归档在一个特性不符合条件时回滚全部',async()=>{
  const f=await fixture();await f.create('未完成',f.f.id);
  await request('POST',f.base+'/features',{name:'空特性'});
  const features=(await request('GET',f.base+'/features')).json();
  const result=await request('POST',f.base+'/features/archive-batch',{items:features.map((g:{id:string;version:number})=>({id:g.id,expectedVersion:g.version}))});
  expect(result.statusCode).toBe(409);expect((await request('GET',f.base+'/features')).json()).toHaveLength(2);
});
it('旧需求自然排序，初始化可重复运行',()=>{
  const db=new Database(':memory:');
  db.exec("CREATE TABLE requirements(id TEXT, title TEXT,feature_id TEXT,phase_id TEXT,sort_order INTEGER); INSERT INTO requirements VALUES('ten','需求 10','f',NULL,-1),('two','需求 2','f',NULL,-1),('one','需求 1','f','p',-1)");
  initializeWorkspaceOrder(db);initializeWorkspaceOrder(db);
  expect(db.prepare('SELECT id,sort_order AS n FROM requirements ORDER BY phase_id,sort_order').all()).toEqual([{id:'two',n:0},{id:'ten',n:1},{id:'one',n:0}]);db.close();
});

it('移动追加到目标，撤销还原来源顺序；后续编辑使撤销整批失败',async()=>{
  const f=await fixture(),a=await f.create('A',f.f.id),b=await f.create('B',f.f.id),c=await f.create('C',f.f.id);
  const phase=(await request('POST',f.base+'/features/'+f.f.id+'/phases',{name:'下一批'})).json();
  const move=await request('POST',f.base+'/requirement-placement',{requirements:[a,c].map(r=>({id:r.id,expectedVersion:r.version})),phaseId:phase.id,featureId:f.f.id});expect(move.statusCode,move.body).toBe(200);
  const {sqlite}=await import('./support/database');
  expect((sqlite.prepare('SELECT id FROM requirements WHERE phase_id=? ORDER BY sort_order').all(phase.id) as Array<{id:string}>).map(r=>r.id)).toEqual([a.id,c.id]);
  const undone=await request('POST',f.base+'/outline-restore',move.json().undo);expect(undone.statusCode,undone.body).toBe(200);
  expect((sqlite.prepare('SELECT id FROM requirements WHERE feature_id=? AND phase_id IS NULL ORDER BY sort_order').all(f.f.id) as Array<{id:string}>).map(r=>r.id)).toEqual([a.id,b.id,c.id]);
  const versions=(sqlite.prepare('SELECT id,version AS expectedVersion FROM requirements WHERE feature_id=? ORDER BY sort_order DESC').all(f.f.id));
  const order=await request('POST',f.base+'/outline-order',{kind:'requirement',parentId:f.f.id,items:versions});expect(order.statusCode,order.body).toBe(200);
  sqlite.prepare('UPDATE requirements SET version=version+1 WHERE id=?').run(b.id);
  const before=sqlite.prepare('SELECT * FROM requirements WHERE feature_id=? ORDER BY id').all(f.f.id);
  expect((await request('POST',f.base+'/outline-restore',order.json().undo)).statusCode).toBe(409);
  expect(sqlite.prepare('SELECT * FROM requirements WHERE feature_id=? ORDER BY id').all(f.f.id)).toEqual(before);
});

it('人工排序排除系统归类，管理员可排序已完成需求，取消时间保持不变',async()=>{
  const f=await fixture(),r=await f.create('直接需求');
  const response=await request('POST',f.base+'/outline-order',{kind:'feature',parentId:f.p.id,items:[{id:r.featureId,expectedVersion:1}]});expect(response.statusCode).toBe(409);
  const a=(await request('POST','/api/requirements/'+r.id+'/work-items',{title:'工作 A',expectedVersion:r.version})).json();
  const b=(await request('POST','/api/requirements/'+r.id+'/work-items',{title:'工作 B',expectedVersion:(await request('GET','/api/requirements/'+r.id)).json().version})).json();
  const {sqlite}=await import('./support/database');
  sqlite.prepare("UPDATE requirements SET status='completed',progress=100 WHERE id=?").run(r.id);
  sqlite.prepare("UPDATE work_items SET status='completed',progress=100,actual_start='2020-01-01',actual_end='2020-01-01' WHERE id=?").run(a.id);
  sqlite.prepare("UPDATE work_items SET status='cancelled',updated_at='2020-01-01T08:00:00.000Z' WHERE id=?").run(b.id);
  const result=await request('POST',f.base+'/outline-order',{kind:'work',parentId:r.id,items:[{id:b.id,expectedVersion:b.version},{id:a.id,expectedVersion:a.version}]});
  expect(result.statusCode,result.body).toBe(200);expect(result.json().items.map((w:{id:string})=>w.id)).toEqual([b.id,a.id]);
  expect(sqlite.prepare('SELECT status,updated_at FROM work_items WHERE id=?').get(b.id)).toEqual({status:'cancelled',updated_at:'2020-01-01T08:00:00.000Z'});
  expect((await request('POST',f.base+'/outline-restore',result.json().undo)).statusCode).toBe(200);
  expect(sqlite.prepare('SELECT updated_at FROM work_items WHERE id=?').get(b.id)).toEqual({updated_at:'2020-01-01T08:00:00.000Z'});
  expect(sqlite.prepare('SELECT status,progress FROM requirements WHERE id=?').get(r.id)).toEqual({status:'completed',progress:100});
});
