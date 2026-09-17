import {listenTestApp} from './support/listen';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {scryptSync} from 'node:crypto';
import {afterAll, beforeAll, expect, it} from 'vitest';
import type {FastifyInstance} from 'fastify';
import {mcpRequest} from './mcp-request';

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pm-guest-access-'));
const password='temporary-guest-test-password';
Object.assign(process.env, {
  DB_PATH:path.join(directory,'test.db'), BACKUP_DIR:path.join(directory,'backups'),
  WEB_DIST_DIR:path.join(directory,'web'), SEED_DEMO:'0', NODE_ENV:'test',
  APP_PASSWORD_HASH:`scrypt$guest-test$${scryptSync(password,'guest-test',64).toString('hex')}`,
  SESSION_SECRET:'guest-access-isolated-test-session-secret-12345678',
});
let app:FastifyInstance, cookie='', outsider='', outsiderToken='', origin='';
let projectId='', privateId='', requirementId='', privateRequirement='', workId='';
const post=async(url:string,payload:object,auth=cookie)=>{
  const response=await app.inject({method:'POST',url,payload,headers:{cookie:auth}});
  expect(response.statusCode,response.body).toBe(200);return response.json();
};
const read=(url:string,auth='')=>app.inject({url,headers:{cookie:auth}});
async function setPublic(value:boolean,auth=cookie){
  const project=(await read('/api/projects',cookie)).json().find((p:{id:string})=>p.id===projectId);
  return app.inject({method:'PATCH',url:'/api/projects/'+projectId,headers:{cookie:auth},payload:{guestVisible:value,expectedUpdatedAt:project.updatedAt}});
}
beforeAll(async()=>{
  app=await(await import('../src/server/app')).buildApp();origin=await listenTestApp(app);
  const login=await app.inject({method:'POST',url:'/api/login',payload:{username:'admin',password}});
  cookie=String(login.headers['set-cookie']).split(';')[0];
  const project=await post('/api/projects',{name:'开放项目'});projectId=project.id;
  expect(project.guestVisible).toBe(false);
  privateId=(await post('/api/projects',{name:'内部项目'})).id;
  const owner=await post('/api/people',{name:'公开项目负责人',projectId});
  const template=await post('/api/templates',{projectId,name:'交付步骤',items:[{title:'实现',durationDays:1,startOffsetDays:0,sortOrder:0}]});
  const r=await post('/api/requirements',{projectId,ownerId:owner.id,templateId:template.id,title:'游客可以查看的需求',background:'业务简介',referenceLinks:[{title:'MDS',url:'https://example.com/mds'},{title:'Jira',url:'https://example.com/task'}]});
  requirementId=r.id;workId=r.workItems[0].id;
  privateRequirement=(await post('/api/requirements',{projectId:privateId,title:'内部需求'})).id;
  await post('/api/people',{name:'其他项目成员',projectId:privateId});
  const initial=await app.inject({method:'POST',url:'/api/login',payload:{username:'其他项目成员',password:'888888'}});
  const changed=await app.inject({method:'POST',url:'/api/account/change-password',headers:{cookie:String(initial.headers['set-cookie']).split(';')[0]},payload:{currentPassword:'888888',newPassword:password}});
  expect(changed.statusCode,changed.body).toBe(200);outsider=String(changed.headers['set-cookie']).split(';')[0];
  outsiderToken=(await post('/api/tokens',{name:'非成员'},outsider)).token;
});
afterAll(async()=>{await app?.close();const {sqlite}=await import('./support/database');if(sqlite.open)sqlite.close();fs.rmSync(directory,{recursive:true,force:true});});

it('已有及新建项目默认不开放，游客无法通过 ID 读取',async()=>{
  expect((await read('/api/projects')).json()).toEqual([]);
  for(const url of ['/api/dashboard?projectId='+projectId,'/api/requirements/'+requirementId,'/api/work-items/'+workId])expect((await read(url)).statusCode,url).toBe(404);
  const {sqlite}=await import('./support/database');
  expect(()=>sqlite.prepare('UPDATE projects SET guest_visible=2 WHERE id=?').run(projectId)).toThrow();
});

it('只有经理或管理员可以开放项目，版本冲突不会覆盖开关',async()=>{
  expect((await setPublic(true,outsider)).statusCode).toBe(403);
  const before=(await read('/api/projects',cookie)).json().find((p:{id:string})=>p.id===projectId);
  const opened=await setPublic(true);expect(opened.statusCode,opened.body).toBe(200);expect(opened.json().guestVisible).toBe(true);
  expect((await app.inject({method:'PATCH',url:'/api/projects/'+projectId,headers:{cookie},payload:{guestVisible:false,expectedUpdatedAt:before.updatedAt}})).statusCode).toBe(409);
});

it('游客及登录非成员都可以读取开放项目的三个视角、详情和依赖',async()=>{
  for(const auth of ['',outsider]){
    const projects=(await read('/api/projects',auth)).json();
    expect(projects.find((p:{id:string})=>p.id===projectId)).toMatchObject({guestVisible:true,publicReadOnly:true,canManage:false});
    for(const url of [
      '/api/dashboard?projectId='+projectId,'/api/requirements?projectId='+projectId,
      '/api/requirements/query?projectId='+projectId,'/api/work-items?projectId='+projectId,
      '/api/progress-updates?projectId='+projectId,'/api/requirements/'+requirementId,'/api/work-items/'+workId,
      ...['change-version','diagram-layouts','path-analysis','path-graph?view=features','path-graph?view=project','dependencies','feature-phases','feature-overview','requirement-intake','features','feature-relations'].map(p=>'/api/projects/'+projectId+'/'+p),
      '/api/requirements/'+requirementId+'/path-analysis',
    ]){const response=await read(url,auth);expect(response.statusCode,url+' '+response.body.slice(0,150)).toBe(200);}
    const dashboard=(await read('/api/dashboard?projectId='+projectId,auth)).json();
    expect(dashboard).not.toHaveProperty('actions');expect(dashboard).not.toHaveProperty('issues');
    const people=(await read('/api/people?projectId='+projectId,auth)).json();
    expect(people).toHaveLength(1);expect(Object.keys(people[0]).sort()).toEqual(['active','id','jobTitle','name']);
    const detail=(await read('/api/requirements/'+requirementId,auth)).json();
    expect(detail.background).toBe('业务简介');expect(detail.referenceLinks).toHaveLength(2);
  }
});

it('公共访问不开放其他项目、个人信息、问题、导出归档和所有写操作',async()=>{
  for(const url of ['/api/dashboard?projectId='+privateId,'/api/requirements/'+privateRequirement,'/api/projects/'+privateId+'/path-graph'])expect((await read(url)).statusCode,url).toBe(404);
  for(const auth of ['',outsider]){
    for(const url of ['/api/issues?projectId='+projectId,'/api/action-items?projectId='+projectId,'/api/templates?projectId='+projectId,'/api/projects/'+projectId+'/members','/api/requirements?projectId='+projectId+'&includeDeleted=true']){
      expect([401,403]).toContain((await read(url,auth)).statusCode);
    }
    for(const [method,url,payload] of [
      ['POST','/api/projects/'+projectId+'/features',{name:'非法特性'}],
      ['POST','/api/requirements',{projectId,title:'非法需求'}],
      ['POST','/api/projects/'+projectId+'/dependency-changes/preview',{}],
      ['POST','/api/projects/'+projectId+'/outline-order',{}],
      ['PATCH','/api/projects/'+projectId,{guestVisible:false}],
    ] as const){const result=await app.inject({method,url,payload,headers:{cookie:auth}});expect(result.statusCode).toBeGreaterThanOrEqual(400);}
  }
  for(const url of ['/api/my-work','/api/accounts','/api/audit','/api/backups','/api/tokens','/api/people'])expect([401,403]).toContain((await read(url)).statusCode);
  expect((await app.inject({method:'POST',url:'/mcp',payload:{jsonrpc:'2.0',id:1,method:'initialize',params:{}}})).statusCode).toBe(401);
  const result=await mcpRequest(origin,outsiderToken,'dashboard_summary',{projectId});
  expect(result.body).toMatch(/403|没有访问|权限/);
});

it('撤回开放后下一次请求立即拒绝，普通成员授权不受影响',async()=>{
  expect((await setPublic(false)).statusCode).toBe(200);
  expect((await read('/api/projects')).json()).toEqual([]);
  for(const auth of ['',outsider])for(const url of ['/api/requirements/'+requirementId,'/api/projects/'+projectId+'/change-version','/api/dashboard?projectId='+projectId])expect((await read(url,auth)).statusCode).toBe(404);
  expect((await read('/api/dashboard?projectId='+projectId,cookie)).statusCode).toBe(200);
});
