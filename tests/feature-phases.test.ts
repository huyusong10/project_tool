import { afterAll, beforeAll, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, scryptSync } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { deriveExecutionStage } from '../src/shared/execution-stage';
import { phaseStatus, phaseDistribution, type FeaturePhase } from '../src/shared/feature-phases';
import { mcpRequest } from './mcp-request';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-phases-')), password = 'phases-isolated-test';
Object.assign(process.env, { DB_PATH: path.join(directory, 'test.db'), BACKUP_DIR: path.join(directory, 'backups'), WEB_DIST_DIR: path.join(directory, 'web'), SEED_DEMO: '0', NODE_ENV: 'test', APP_PASSWORD_HASH: 'scrypt$phases$' + scryptSync(password, 'phases', 64).toString('hex'), SESSION_SECRET: 'phases-isolated-secret-more-than-thirty-two-characters' });
let app: FastifyInstance, cookie = '', address = '';
const req = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown, auth = cookie) => app.inject({ method, url, headers: { cookie: auth }, payload: payload as Record<string, unknown> });
beforeAll(async () => { app = await (await import('../src/server/app')).buildApp(); await app.ready(); const login = await req('POST', '/api/login', { username: 'admin', password }, ''); cookie = String(login.headers['set-cookie']).split(';')[0]; address = await app.listen({ host: '127.0.0.1', port: 0 }); });
afterAll(async () => { await app.close(); (await import('../src/server/database')).sqlite.close(); fs.rmSync(directory, { recursive: true, force: true }); });
async function fixture() {
  const p = (await req('POST', '/api/projects', { name: 'Phase 验证 ' + randomUUID() })).json();
  const base = '/api/projects/' + p.id, f = (await req('POST', base + '/features', { name: '资产管理' })).json().features[0];
  const create = async (name: string) => { const result = await req('POST', base + '/features/' + f.id + '/phases', { name }); expect(result.statusCode, result.body).toBe(200); return result.json<FeaturePhase>(); };
  const phase = async (id: string) => (await req('GET', base + '/feature-phases')).json<FeaturePhase[]>().find(p => p.id === id)!;
  const command = async (id: string, action: string, extra = {}) => req(action === 'delete' ? 'DELETE' : 'POST', base + '/feature-phases/' + id + (action === 'delete' ? '' : '/' + action), { expectedVersion: (await phase(id)).version, ...extra });
  const requirement = async (phaseId: string | null, status = 'not_started', archived = false) => {
    const { sqlite } = await import('../src/server/database'), id = randomUUID(), now = new Date().toISOString();
    sqlite.prepare("INSERT INTO requirements(id,project_id,feature_id,phase_id,title,status,execution_mode,progress,actual_start,actual_end,deleted_at,created_at,updated_at) VALUES(?,?,?,?,?,?,'direct',?,?,?,?,?,?)").run(id, p.id, f.id, phaseId, 'DCIM-' + id, status, status === 'completed' ? 100 : status === 'in_progress' ? 30 : 0, ['in_progress', 'completed'].includes(status) ? '2026-09-10' : null, status === 'completed' ? '2026-09-11' : null, archived ? now : null, now, now);
    return (await req('GET', '/api/requirements/' + id)).json();
  };
  return { base, projectId: p.id as string, f, create, phase, command, requirement };
}

it('Phase 不预建；空、全部取消不能交付，归档完成仍算交付成果', async () => {
  const f = await fixture(); expect((await req('GET', f.base + '/feature-phases')).json()).toEqual([]);
  const a = await f.create('Phase 1'), b = await f.create('Phase 2');
  expect((await f.command(a.id, 'deliver')).statusCode).toBe(400);
  await f.requirement(a.id, 'cancelled'); expect((await f.phase(a.id)).status).toBe('planning'); expect((await f.command(a.id, 'deliver')).statusCode).toBe(400);
  await f.requirement(b.id, 'completed', true); expect((await f.phase(b.id)).status).toBe('ready');
  const result = await f.command(b.id, 'deliver', { deliveredAt: '2026-09-11' }); expect(result.statusCode, result.body).toBe(200); expect(result.json().deliveries[0].snapshot.requirements).toHaveLength(1);
  expect((await f.command(a.id, 'delete')).statusCode).toBe(400); const empty = await f.create('远期探索'); expect((await f.command(empty.id, 'delete')).statusCode).toBe(200);
});
it('推进后范围、日期和移入移出需要原因；批量版本冲突回滚整个安排', async () => {
  const f = await fixture(), a = await f.create('Phase 1'), b = await f.create('Phase 2');
  const completed = await f.requirement(a.id, 'completed'), active = await f.requirement(a.id, 'in_progress');
  expect((await f.command(a.id, 'deliver')).statusCode).toBe(400);
  let result = await req('POST', f.base + '/features/' + f.f.id + '/phases', { id: a.id, expectedVersion: a.version, name: a.name, scope: '新范围' }); expect(result.statusCode).toBe(400);
  result = await req('POST', f.base + '/features/' + f.f.id + '/phases', { id: a.id, expectedVersion: a.version, name: a.name, scope: '新范围', reason: '先交付可用版本' }); expect(result.statusCode, result.body).toBe(200);
  const placement = { featureId: f.f.id, phaseId: b.id, requirements: [{ id: active.id, expectedVersion: active.version }] };
  expect((await req('POST', f.base + '/requirement-placement', placement)).statusCode).toBe(400);
  const stale = await req('POST', f.base + '/requirement-placement', { ...placement, reason: '深水区放到后续批次', requirements: [...placement.requirements, { id: completed.id, expectedVersion: 999 }] }); expect(stale.statusCode).toBe(409); expect((await f.phase(a.id)).requirements).toHaveLength(2);
  result = await req('POST', f.base + '/requirement-placement', { ...placement, reason: '深水区放到后续批次' }); expect(result.statusCode, result.body).toBe(200);
  expect((await f.phase(a.id)).status).toBe('ready'); expect((await f.phase(b.id)).status).toBe('in_progress');
  expect((await req('POST', f.base + '/feature-phases/' + a.id + '/deliver', { expectedVersion: a.version })).statusCode).toBe(409);
  expect((await f.command(a.id, 'deliver')).statusCode).toBe(200);
});
it('交付快照不随新批次变化；先重新打开再返工，历史保留并可再次交付', async () => {
  const f = await fixture(), a = await f.create('Phase 1'), r = await f.requirement(a.id, 'completed');
  expect((await f.command(a.id, 'deliver')).statusCode).toBe(200); const snapshot = (await f.phase(a.id)).deliveries[0];
  await f.create('Phase 2'); expect((await f.phase(a.id)).deliveries[0]).toEqual(snapshot);
  expect((await req('POST', '/api/requirements/' + r.id + '/rework', { expectedVersion: r.version, progress: 50, reason: '补充边界场景' })).statusCode).toBe(409);
  expect((await f.command(a.id, 'reopen')).statusCode).toBe(400); expect((await f.command(a.id, 'reopen', { reason: '客户反馈需要补充' })).statusCode).toBe(200);
  const rework = await req('POST', '/api/requirements/' + r.id + '/rework', { expectedVersion: r.version, progress: 50, reason: '补充边界场景' }); expect(rework.statusCode, rework.body).toBe(200);
  expect((await f.phase(a.id)).status).toBe('in_progress'); expect(rework.json().executionStage.key).toBe('in_progress');
  const complete = await req('POST', '/api/requirements/' + r.id + '/complete', { expectedVersion: rework.json().version, content: '已完成补充' }); expect(complete.statusCode, complete.body).toBe(200);
  expect((await f.command(a.id, 'deliver')).statusCode).toBe(200); const deliveries = (await f.phase(a.id)).deliveries; expect(deliveries).toHaveLength(2); expect(deliveries[1].snapshot).toEqual(snapshot.snapshot); expect(deliveries[1].reopenReason).toBe('客户反馈需要补充');
});
it('归属不可跨特性；权限和旧接口停用；REST/MCP 状态一致', async () => {
  const f = await fixture(), a = await f.create('Phase 1'), r = await f.requirement(null), other = (await req('POST', f.base + '/features', { name: '日志' })).json().features.find((g: { name: string }) => g.name === '日志');
  expect((await req('POST', f.base + '/requirement-placement', { requirements: [{ id: r.id, expectedVersion: r.version }], featureId: other.id, phaseId: a.id })).statusCode).toBe(400);
  expect((await req('POST', f.base + '/features/' + f.f.id + '/phases', { name: '未授权' }, '')).statusCode).toBe(401);
  expect((await req('GET', f.base + '/requirement-groups')).statusCode).toBe(404);
  const token = (await req('POST', '/api/tokens', { name: 'Phase MCP', expiresInDays: 1 })).json().token;
  const response = await mcpRequest(address, token, 'list_feature_phases', { projectId: f.projectId }); const body = JSON.parse(response.body.startsWith('event:') ? response.body.split('\n').find(line => line.startsWith('data: '))!.slice(6) : response.body); expect(body.result?.isError, JSON.stringify(body)).not.toBe(true); expect(JSON.parse(body.result.content[0].text)).toEqual((await req('GET', f.base + '/feature-phases')).json());
});
it('记录提测是人工事实，重复记录受保护，路径、列表和 Phase 使用同一摘要', async () => {
  const f = await fixture(), a = await f.create('Phase 1'), r = await f.requirement(a.id, 'in_progress');
  const result = await req('POST', f.base + '/requirements/' + r.id + '/test-submission', { expectedVersion: r.version, actualDate: '2026-09-12' }); expect(result.statusCode, result.body).toBe(200); expect(result.json().executionStage).toMatchObject({ key: 'test_submitted', label: '已提测' });
  expect((await req('POST', f.base + '/requirements/' + r.id + '/test-submission', { expectedVersion: result.json().version, actualDate: '2026-09-12' })).statusCode).toBe(400);
  const stage = result.json().executionStage, list = (await req('GET', '/api/requirements?projectId=' + f.projectId)).json().find((v: { id: string }) => v.id === r.id), graph = (await req('GET', f.base + '/path-graph')).json().cards.find((v: { id: string }) => v.id === r.id);
  expect(list.executionStage).toEqual(stage); expect(graph.executionStage).toEqual(stage); expect((await f.phase(a.id)).requirements[0].executionStage).toEqual(stage);
});

it('阶段百分比只计算阶段内工作；并行、缺失节点和返工不产生虚假阶段', () => {
  const r = { status: 'in_progress' }, done = { status: 'completed', progress: 100, workStage: 'development' as const, progressWeight: 99 }, test = { status: 'in_progress', progress: 70, workStage: 'testing' as const, progressWeight: 1 };
  expect(deriveExecutionStage(r, [done, test])).toMatchObject({ key: 'testing', label: '测试中', stages: [{ stage: 'testing', progress: 70 }] });
  const parallel = deriveExecutionStage(r, [{ ...done, status: 'in_progress', progress: 99 }, test]); expect(parallel).toMatchObject({ key: 'parallel', label: '开发中 · 部分测试' });
  expect(phaseDistribution([{ status: 'in_progress', executionStage: parallel } as never])).toMatchObject([{ key: 'parallel', label: '并行推进', count: 1 }]);
  expect(deriveExecutionStage(r, [], [{ milestoneKind: 'test_ready', achievedAt: '2026-09-11' }]).label).toBe('提测就绪');
  expect(deriveExecutionStage(r, [{ status: 'in_progress', progress: 1, title: '自定义工作' }])).toMatchObject({ key: 'in_progress', currentWork: ['自定义工作'] });
  expect(deriveExecutionStage({ ...r, stageResetAt: '2026-09-12T00:00:00Z' }, [], [{ milestoneKind: 'test_submitted', achievedAt: '2026-09-11' }]).key).toBe('in_progress');
  expect(deriveExecutionStage({ status: 'completed' }, [test]).key).toBe('completed'); expect(deriveExecutionStage({ status: 'not_started' }).label).toBe('未开始');
  expect(phaseStatus([], null)).toBe('planning'); expect(phaseStatus([{ status: 'cancelled' }], null)).toBe('planning');
});

it('普通成员可查看但不能维护 Phase；提测限负责人或项目经理',async()=>{
  const f=await fixture(),phase=await f.create('Phase 1'),r=await f.requirement(phase.id,'in_progress');
  const member=(await req('POST','/api/people',{projectId:f.projectId,name:'Phase普通成员'+randomUUID()})).json();
  const login=await req('POST','/api/login',{username:member.name,password:'888888'},'');let memberCookie=String(login.headers['set-cookie']).split(';')[0];
  const changed=await req('POST','/api/account/change-password',{currentPassword:'888888',newPassword:'phase-member-password'},memberCookie);expect(changed.statusCode,changed.body).toBe(200);memberCookie=String(changed.headers['set-cookie']).split(';')[0];
  expect((await req('GET',f.base+'/feature-phases',undefined,memberCookie)).statusCode).toBe(200);
  expect((await req('POST',f.base+'/features/'+f.f.id+'/phases',{name:'不允许'},memberCookie)).statusCode).toBe(403);
  expect((await req('POST',f.base+'/requirements/'+r.id+'/test-submission',{expectedVersion:r.version,actualDate:'2026-09-12'},memberCookie)).statusCode).toBe(403);
});
it('模板复制和实例保留分类；仅修改分类也会保存，提测节点保持人工确认',async()=>{
  const f=await fixture();let response=await req('POST','/api/templates',{projectId:f.projectId,name:'阶段模板',dependencyMode:'dependencies',items:[{clientKey:'w',title:'自定义验证',workStage:'testing',durationDays:1,startOffsetDays:0,sortOrder:0,predecessorKeys:[]},{clientKey:'m',kind:'milestone',title:'交给测试',milestoneKind:'test_submitted',confirmationMode:'auto',durationDays:0,startOffsetDays:0,sortOrder:1,predecessorKeys:['w']}]});expect(response.statusCode,response.body).toBe(200);const template=response.json();expect(template.items[0].workStage).toBe('testing');expect(template.items[1]).toMatchObject({milestoneKind:'test_submitted',confirmationMode:'manual'});
  const other=await fixture(),copied=await req('POST',other.base+'/templates/'+template.id+'/copy',{});expect(copied.statusCode,copied.body).toBe(200);expect(copied.json().items[0].workStage).toBe('testing');expect(copied.json().items[1].milestoneKind).toBe('test_submitted');
  response=await req('POST','/api/requirements',{projectId:f.projectId,title:'阶段实例',templateId:template.id});expect(response.statusCode,response.body).toBe(200);expect(response.json().workItems[0].workStage).toBe('testing');expect(response.json().milestones[0]).toMatchObject({milestoneKind:'test_submitted',confirmationMode:'manual',achievedAt:null});
  const instanceId=response.json().id;
  const changed=await req('PATCH','/api/templates/'+template.id,{expectedUpdatedAt:template.updatedAt,items:template.items.map((item:{id:string;title:string;kind:string;sortOrder:number;durationDays:number;startOffsetDays:number;predecessorIds:string[];confirmationMode:string;milestoneKind:string})=>({id:item.id,clientKey:item.id,title:item.title,kind:item.kind,sortOrder:item.sortOrder,durationDays:item.durationDays,startOffsetDays:item.startOffsetDays,predecessorKeys:item.predecessorIds,confirmationMode:item.confirmationMode,milestoneKind:item.milestoneKind,workStage:item.kind==='work'?'integration':null}))});expect(changed.statusCode,changed.body).toBe(200);expect(changed.json().items[0].workStage).toBe('integration');expect(changed.json().updatedAt).not.toBe(template.updatedAt);expect((await req('GET','/api/requirements/'+instanceId)).json().workItems[0].workStage).toBe('testing');
});

it('Phase 区域布局复用批次回执，校验归属、版本并保留原布局',async()=>{
  const f=await fixture(),a=await f.create('Phase 1'),b=await f.create('Phase 2'),r=await f.requirement(a.id);
  const scope='feature-phase:'+f.f.id+':'+a.id,empty={add:[],remove:[],estimates:[]};
  const preview=async(layouts:unknown[])=>{const analysis=(await req('GET',f.base+'/path-analysis')).json();const input={expectedRevision:analysis.revision,target:'project',changes:{...empty,layouts}};const response=await req('POST',f.base+'/dependency-changes/preview',input);return {input,response};};
  const {input,response}=await preview([{scope:'feature:'+f.f.id,direction:'right',expectedVersion:0,positions:{[r.id]:{x:900,y:700}}},{scope,direction:'right',expectedVersion:0,positions:{[r.id]:{x:20,y:40}}}]);expect(response.statusCode,response.body).toBe(200);
  const payload={...input,previewToken:response.json().previewToken,batchId:randomUUID()};const saved=await req('POST',f.base+'/dependency-changes/apply',payload);expect(saved.statusCode,saved.body).toBe(200);expect((await req('POST',f.base+'/dependency-changes/apply',payload)).json()).toEqual(saved.json());
  const layouts=(await req('GET',f.base+'/diagram-layouts')).json();expect(layouts.find((l:{scope:string})=>l.scope===scope).positions[r.id]).toEqual({x:20,y:40});expect(layouts.find((l:{scope:string})=>l.scope==='feature:'+f.f.id).positions[r.id]).toEqual({x:900,y:700});
  expect((await preview([{scope,direction:'right',expectedVersion:0,positions:{[r.id]:{x:30,y:40}}}])).response.statusCode).toBe(409);
  expect((await preview([{scope:'feature-phase:'+f.f.id+':'+b.id,direction:'right',expectedVersion:0,positions:{[r.id]:{x:0,y:0}}}])).response.statusCode).toBe(400);
  expect((await preview([{scope,direction:'right',expectedVersion:1,positions:{[r.id]:{x:-1,y:0}}}])).response.statusCode).toBe(400);
  expect((await f.phase(a.id)).requirements.map(r=>r.id)).toEqual([r.id]);
});
it('图形业务草稿的 Phase 分布使用最终归属，交付快照保持正式数据',async()=>{
  const f=await fixture(),a=await f.create('Phase 1'),b=await f.create('Phase 2'),r=await f.requirement(a.id);const analysis=(await req('GET',f.base+'/path-analysis')).json();
  const result=await req('POST',f.base+'/dependency-changes/preview',{expectedRevision:analysis.revision,target:'project',changes:{add:[],remove:[],estimates:[],entities:[{id:r.id,entity:'requirement',op:'update',expectedVersion:r.version,data:{phaseId:b.id,reason:'调整首版范围'}}]}});
  expect(result.statusCode,result.body).toBe(200);const phases=result.json().analysis.featureContext.overview.features.find((x:{id:string})=>x.id===f.f.id).phases;expect(phases.find((p:{id:string})=>p.id===a.id).requirements).toHaveLength(0);expect(phases.find((p:{id:string})=>p.id===b.id).requirements).toHaveLength(1);expect((await f.phase(a.id)).requirements).toHaveLength(1);
});

it('Phase 图查询保留直接外围依赖及完整分析，REST/MCP 使用同一阶段和区域',async()=>{
 const f=await fixture(),a=await f.create('Phase 1'),b=await f.create('Phase 2'),c=await f.create('尚未明确'),r=await f.requirement(a.id,'in_progress'),next=await f.requirement(b.id);
 const submitted=await req('POST',f.base+'/requirements/'+r.id+'/test-submission',{expectedVersion:r.version,actualDate:'2026-09-12'});expect(submitted.statusCode,submitted.body).toBe(200);
 const analysis=(await req('GET',f.base+'/path-analysis')).json();const dep=await req('POST',f.base+'/dependencies',{expectedRevision:analysis.revision,sourceRequirementId:r.id,targetRequirementId:next.id});expect(dep.statusCode,dep.body).toBe(200);
 const full=(await req('GET',f.base+'/path-graph?view=feature&featureId='+f.f.id)).json(),filtered=(await req('GET',f.base+'/path-graph?view=feature&featureId='+f.f.id+'&phaseId='+a.id)).json();expect(filtered.cards.map((c:{id:string})=>c.id).sort()).toEqual([r.id,next.id].sort());expect(filtered.analysis).toEqual(full.analysis);expect(filtered.phaseRegions.find((p:{id:string})=>p.id===c.id).nodeIds).toEqual([]);expect(filtered.cards.find((c:{id:string})=>c.id===r.id).executionStage).toEqual(submitted.json().executionStage);
 const token=(await req('POST','/api/tokens',{name:'Phase graph',expiresInDays:1})).json().token;const response=await mcpRequest(address,token,'get_path_graph',{projectId:f.projectId,view:'feature',featureId:f.f.id,phaseId:a.id});const body=JSON.parse(response.body.startsWith('event:')?response.body.split('\n').find(line=>line.startsWith('data: '))!.slice(6):response.body);expect(body.result?.isError,JSON.stringify(body)).not.toBe(true);const mcp=JSON.parse(body.result.content[0].text);expect(mcp.cards).toEqual(filtered.cards);expect(mcp.phaseRegions).toEqual(filtered.phaseRegions);
 expect((await req('GET',f.base+'/path-graph?view=project&phaseId='+a.id)).statusCode).toBe(400);
});
