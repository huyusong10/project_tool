import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'versioned-write-integrity-'));
process.env.DB_PATH = path.join(directory, 'test.db');
process.env.BACKUP_DIR = path.join(directory, 'backups');
process.env.SEED_DEMO = '0';
process.env.APP_PASSWORD_HASH = 'scrypt$4c63a6f93ff4f94b031b7e7583592177$b598dbddaf9dd06678ff8756923d9e0a7f2d68eaa45bc644fbf4a73c9298970c7489671dfcfc8be282022c26a3370fb040f3f086a45faa1e1abde04bbe4a51ef';
process.env.SESSION_SECRET = 'versioned-write-integrity-test-secret-123456789';

let app: FastifyInstance;
let cookie = '';
let projectId = '';

const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url, headers: { cookie }, payload });
const patch = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'PATCH', url, headers: { cookie }, payload });
const put = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'PUT', url, headers: { cookie }, payload });
const remove = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'DELETE', url, headers: { cookie }, payload });

beforeAll(async () => {
  app = await (await import('../src/server/app')).buildApp();
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: '41_xc7q0qOjo4Inw!' } });
  cookie = String(login.headers['set-cookie']).split(';')[0];
  projectId = (await post('/api/projects', { name: '版本写入完整性测试' })).json().id;
});

afterAll(async () => {
  await app?.close();
  const { sqlite } = await import('./support/database');
  if (sqlite.open) sqlite.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

it('数据库拒绝主记录更新时返回冲突，并回滚随后追加的历史', async () => {
  const { sqlite } = await import('./support/database');
  const requirement = (await post('/api/requirements', {templateId: await defaultTemplate(projectId),
    projectId, title: '受控写入需求', plannedStart: '2020-01-02',
  })).json();

  sqlite.exec('CREATE TEMP TRIGGER reject_requirement_write BEFORE UPDATE ON requirements BEGIN SELECT RAISE(IGNORE); END');
  const requirementResult = await patch(`/api/requirements/${requirement.id}`, {
    title: '不应保存的标题', expectedVersion: requirement.version,
  });
  expect(requirementResult.statusCode).toBe(409);
  expect(requirementResult.json()).toMatchObject({ code: 'STALE_WRITE' });
  expect(sqlite.prepare('SELECT title, version FROM requirements WHERE id=?').get(requirement.id)).toEqual({
    title: '受控写入需求', version: requirement.version,
  });
  const itemCount = sqlite.prepare('SELECT COUNT(*) AS count FROM work_items WHERE requirement_id=?').get(requirement.id) as { count: number };
  const createItemResult = await post(`/api/requirements/${requirement.id}/work-items`, {
    title: '不应插入的工作项', expectedVersion: requirement.version,
  });
  expect(createItemResult.statusCode).toBe(409);
  expect(createItemResult.json()).toMatchObject({ code: 'STALE_WRITE' });
  expect(sqlite.prepare('SELECT COUNT(*) AS count FROM work_items WHERE requirement_id=?').get(requirement.id)).toEqual(itemCount);
  sqlite.exec('DROP TRIGGER reject_requirement_write');

  const item = requirement.workItems[0];
  const progressBefore = sqlite.prepare('SELECT COUNT(*) AS count FROM progress_updates WHERE requirement_id=?').get(requirement.id) as { count: number };
  sqlite.exec('CREATE TEMP TRIGGER reject_work_item_write BEFORE UPDATE ON work_items BEGIN SELECT RAISE(IGNORE); END');
  const completionResult = await post(`/api/work-items/${item.id}/complete-as-planned`, {
    expectedVersion: item.version,
  });
  expect(completionResult.statusCode).toBe(409);
  expect(completionResult.json()).toMatchObject({ code: 'STALE_WRITE' });
  expect(sqlite.prepare('SELECT status, progress, version FROM work_items WHERE id=?').get(item.id)).toEqual({
    status: 'not_started', progress: 0, version: item.version,
  });
  expect((sqlite.prepare('SELECT COUNT(*) AS count FROM progress_updates WHERE requirement_id=?').get(requirement.id) as { count: number }).count).toBe(progressBefore.count);
  sqlite.exec('DROP TRIGGER reject_work_item_write');

  const issue = (await post('/api/issues', { projectId, title: '受控写入问题' })).json();
  sqlite.exec('CREATE TEMP TRIGGER reject_issue_write BEFORE UPDATE ON issues BEGIN SELECT RAISE(IGNORE); END');
  const resolveResult = await post(`/api/issues/${issue.id}/resolve`, {
    content: '不应产生的解决记录', expectedVersion: issue.version,
  });
  expect(resolveResult.statusCode).toBe(409);
  expect(resolveResult.json()).toMatchObject({ code: 'STALE_WRITE' });
  expect(sqlite.prepare('SELECT status, progress, version FROM issues WHERE id=?').get(issue.id)).toEqual({
    status: 'in_progress', progress: 0, version: issue.version,
  });
  expect(sqlite.prepare('SELECT COUNT(*) AS count FROM issue_updates WHERE issue_id=?').get(issue.id)).toEqual({ count: 0 });
  sqlite.exec('DROP TRIGGER reject_issue_write');
});

it('历史补录在父需求归档或版本变化时整体回滚', async () => {
  const { sqlite } = await import('./support/database');
  const single = (await post('/api/requirements', {templateId: await defaultTemplate(projectId),
    projectId, title: '补录归档竞争需求', plannedStart: '2020-01-02',
  })).json();
  const singleItem = single.workItems[0];
  const singleProgress = sqlite.prepare('SELECT COUNT(*) AS count FROM progress_updates WHERE requirement_id=?').get(single.id);
  sqlite.exec(`CREATE TEMP TRIGGER archive_requirement_during_planned_completion BEFORE UPDATE OF status ON work_items
    WHEN OLD.id='${singleItem.id}' BEGIN
      UPDATE requirements SET deleted_at='2099-01-01T00:00:00.000Z', version=version+1 WHERE id=OLD.requirement_id;
    END`);
  const archived = await post(`/api/work-items/${singleItem.id}/complete-as-planned`, { expectedVersion: singleItem.version });
  expect(archived.statusCode).toBe(409);
  expect(archived.json()).toMatchObject({ code: 'STALE_WRITE' });
  expect(sqlite.prepare('SELECT deleted_at AS deletedAt, version FROM requirements WHERE id=?').get(single.id)).toEqual({
    deletedAt: null, version: single.version,
  });
  expect(sqlite.prepare('SELECT status, progress, version FROM work_items WHERE id=?').get(singleItem.id)).toEqual({
    status: 'not_started', progress: 0, version: singleItem.version,
  });
  expect(sqlite.prepare('SELECT COUNT(*) AS count FROM progress_updates WHERE requirement_id=?').get(single.id)).toEqual(singleProgress);
  sqlite.exec('DROP TRIGGER archive_requirement_during_planned_completion');

  const whole = (await post('/api/requirements', {templateId: await defaultTemplate(projectId),
    projectId, title: '补录版本竞争需求', plannedStart: '2020-02-03',
  })).json();
  sqlite.exec(`CREATE TEMP TRIGGER change_requirement_during_planned_completion BEFORE UPDATE OF status ON work_items
    WHEN OLD.requirement_id='${whole.id}' BEGIN
      UPDATE requirements SET title='竞争标题', version=version+1 WHERE id=OLD.requirement_id;
    END`);
  const changed = await post(`/api/requirements/${whole.id}/complete-as-planned`, { expectedVersion: whole.version });
  expect(changed.statusCode).toBe(409);
  expect(changed.json()).toMatchObject({ code: 'STALE_WRITE' });
  expect(sqlite.prepare('SELECT title, status, version FROM requirements WHERE id=?').get(whole.id)).toEqual({
    title: '补录版本竞争需求', status: whole.status, version: whole.version,
  });
  expect(sqlite.prepare('SELECT COUNT(*) AS count FROM work_items WHERE requirement_id=? AND status<>\'not_started\'').get(whole.id)).toEqual({ count: 0 });
  expect(sqlite.prepare('SELECT COUNT(*) AS count FROM progress_updates WHERE requirement_id=?').get(whole.id)).toEqual({ count: 0 });
  sqlite.exec('DROP TRIGGER change_requirement_during_planned_completion');
});

it('工作项编辑与进度写入会锁定父需求版本', async () => {
  const { sqlite } = await import('./support/database');
  const requirement = (await post('/api/requirements', {templateId: await defaultTemplate(projectId),
    projectId, title: '工作项父版本竞争需求', plannedStart: '2020-03-02',
  })).json();
  const item = requirement.workItems[0];

  sqlite.exec(`CREATE TEMP TRIGGER change_parent_during_work_item_edit BEFORE UPDATE OF title ON work_items
    WHEN OLD.id='${item.id}' BEGIN
      UPDATE requirements SET title='竞争标题', version=version+1 WHERE id=OLD.requirement_id;
    END`);
  const edited = await patch(`/api/work-items/${item.id}`, { title: '不应保存的工作项标题', expectedVersion: item.version });
  expect(edited.statusCode).toBe(409);
  expect(edited.json()).toMatchObject({ code: 'STALE_WRITE' });
  expect(sqlite.prepare('SELECT title, version FROM requirements WHERE id=?').get(requirement.id)).toEqual({
    title: '工作项父版本竞争需求', version: requirement.version,
  });
  expect(sqlite.prepare('SELECT title, status, version FROM work_items WHERE id=?').get(item.id)).toEqual({
    title: item.title, status: 'not_started', version: item.version,
  });
  sqlite.exec('DROP TRIGGER change_parent_during_work_item_edit');

  sqlite.prepare("UPDATE work_items SET status='in_progress', actual_start=planned_start WHERE id=?").run(item.id);
  sqlite.prepare("UPDATE requirements SET status='in_progress' WHERE id=?").run(requirement.id);
  sqlite.exec(`CREATE TEMP TRIGGER change_parent_during_progress BEFORE UPDATE OF progress ON work_items
    WHEN OLD.id='${item.id}' BEGIN
      UPDATE requirements SET title='进度竞争标题', version=version+1 WHERE id=OLD.requirement_id;
    END`);
  const progress = await post(`/api/requirements/${requirement.id}/progress`, {
    workItemId: item.id, workItemPercent: 30, content: '不应留下的进度', expectedVersion: item.version,
  });
  expect(progress.statusCode).toBe(409);
  expect(progress.json()).toMatchObject({ code: 'STALE_WRITE' });
  expect(sqlite.prepare('SELECT title FROM requirements WHERE id=?').get(requirement.id)).toEqual({ title: '工作项父版本竞争需求' });
  expect(sqlite.prepare('SELECT progress, version FROM work_items WHERE id=?').get(item.id)).toEqual({
    progress: 0, version: item.version,
  });
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM progress_updates WHERE requirement_id=? AND content='不应留下的进度'").get(requirement.id)).toEqual({ count: 0 });
  sqlite.exec('DROP TRIGGER change_parent_during_progress');
});

it('成员在工作项写入期间失权时业务修改一起回滚', async () => {
  const { sqlite } = await import('./support/database');
  const owner = (await post('/api/people', { projectId, name: '并发失权需求负责人' })).json();
  const requirement = (await post('/api/requirements', {templateId: await defaultTemplate(projectId),
    projectId, ownerId: owner.id, title: '并发失权需求', plannedStart: '2020-04-01',
  })).json();
  const item = requirement.workItems[0];
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: owner.username || owner.name, password: '888888' } });
  let ownerCookie = String(login.headers['set-cookie']).split(';')[0];
  const changedPassword = await app.inject({ method: 'POST', url: '/api/account/change-password', headers: { cookie: ownerCookie }, payload: {
    currentPassword: '888888', newPassword: 'concurrent-permission-owner-123',
  } });
  ownerCookie = String(changedPassword.headers['set-cookie']).split(';')[0];

  sqlite.exec(`CREATE TEMP TRIGGER remove_member_during_work_item_edit BEFORE UPDATE OF title ON work_items
    WHEN OLD.id='${item.id}' BEGIN
      DELETE FROM project_people WHERE project_id='${projectId}' AND person_id='${owner.id}';
    END`);
  const edited = await app.inject({ method: 'PATCH', url: `/api/work-items/${item.id}`, headers: { cookie: ownerCookie }, payload: {
    title: '不应由失权请求保存', expectedVersion: item.version,
  } });
  expect(edited.statusCode).toBe(404);
  expect(sqlite.prepare('SELECT title, version FROM work_items WHERE id=?').get(item.id)).toEqual({ title: item.title, version: item.version });
  expect(sqlite.prepare('SELECT project_role AS projectRole FROM project_people WHERE project_id=? AND person_id=?').get(projectId, owner.id)).toEqual({ projectRole: 'member' });
  expect(sqlite.prepare('SELECT version FROM requirements WHERE id=?').get(requirement.id)).toEqual({ version: requirement.version });
  sqlite.exec('DROP TRIGGER remove_member_during_work_item_edit');
});

it('项目经理在需求写入期间被降级时业务修改一起回滚', async () => {
  const { sqlite } = await import('./support/database');
  const manager = (await post('/api/people', { projectId, name: '并发降级项目经理' })).json();
  expect((await put(`/api/projects/${projectId}/members/${manager.id}`, { role: 'manager' })).statusCode).toBe(200);
  const requirement = (await post('/api/requirements', { projectId, title: '经理并发降级需求' })).json();
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: manager.username || manager.name, password: '888888' } });
  let managerCookie = String(login.headers['set-cookie']).split(';')[0];
  const changedPassword = await app.inject({ method: 'POST', url: '/api/account/change-password', headers: { cookie: managerCookie }, payload: {
    currentPassword: '888888', newPassword: 'concurrent-project-manager-123',
  } });
  managerCookie = String(changedPassword.headers['set-cookie']).split(';')[0];

  sqlite.exec(`CREATE TEMP TRIGGER demote_manager_during_requirement_edit BEFORE UPDATE OF title ON requirements
    WHEN OLD.id='${requirement.id}' BEGIN
      UPDATE project_people SET project_role='member' WHERE project_id='${projectId}' AND person_id='${manager.id}';
    END`);
  const edited = await app.inject({ method: 'PATCH', url: `/api/requirements/${requirement.id}`, headers: { cookie: managerCookie }, payload: {
    title: '不应由降级经理保存', expectedVersion: requirement.version,
  } });
  expect(edited.statusCode).toBe(403);
  expect(sqlite.prepare('SELECT title, version FROM requirements WHERE id=?').get(requirement.id)).toEqual({
    title: '经理并发降级需求', version: requirement.version,
  });
  expect(sqlite.prepare('SELECT project_role AS projectRole FROM project_people WHERE project_id=? AND person_id=?').get(projectId, manager.id)).toEqual({ projectRole: 'manager' });
  sqlite.exec('DROP TRIGGER demote_manager_during_requirement_edit');

  const issue = (await post('/api/issues', { projectId, title: '经理并发降级问题' })).json();
  sqlite.exec(`CREATE TEMP TRIGGER demote_manager_during_issue_edit BEFORE UPDATE OF title ON issues
    WHEN OLD.id='${issue.id}' BEGIN
      UPDATE project_people SET project_role='member' WHERE project_id='${projectId}' AND person_id='${manager.id}';
    END`);
  const issueEdit = await app.inject({ method: 'PATCH', url: `/api/issues/${issue.id}`, headers: { cookie: managerCookie }, payload: {
    title: '不应由降级经理修改的问题', expectedVersion: issue.version,
  } });
  expect(issueEdit.statusCode).toBe(403);
  expect(sqlite.prepare('SELECT title, version FROM issues WHERE id=?').get(issue.id)).toEqual({
    title: '经理并发降级问题', version: issue.version,
  });
  expect(sqlite.prepare('SELECT project_role AS projectRole FROM project_people WHERE project_id=? AND person_id=?').get(projectId, manager.id)).toEqual({ projectRole: 'manager' });
  sqlite.exec('DROP TRIGGER demote_manager_during_issue_edit');

  const candidate = (await post('/api/people', { name: '并发添加成员候选人' })).json();
  sqlite.exec(`CREATE TEMP TRIGGER demote_manager_during_member_add BEFORE INSERT ON project_people
    WHEN NEW.project_id='${projectId}' AND NEW.person_id='${candidate.id}' BEGIN
      UPDATE project_people SET project_role='member' WHERE project_id='${projectId}' AND person_id='${manager.id}';
    END`);
  const memberAdd = await app.inject({ method: 'PUT', url: `/api/projects/${projectId}/members/${candidate.id}`, headers: { cookie: managerCookie }, payload: { role: 'member' } });
  expect(memberAdd.statusCode).toBe(403);
  expect(sqlite.prepare('SELECT COUNT(*) AS count FROM project_people WHERE project_id=? AND person_id=?').get(projectId, candidate.id)).toEqual({ count: 0 });
  expect(sqlite.prepare('SELECT project_role AS projectRole FROM project_people WHERE project_id=? AND person_id=?').get(projectId, manager.id)).toEqual({ projectRole: 'manager' });
  sqlite.exec('DROP TRIGGER demote_manager_during_member_add');
});

it('平台管理员在领域写入期间失权时业务修改一起回滚', async () => {
  const { sqlite } = await import('./support/database');
  const requirement = (await post('/api/requirements', { projectId, title: '管理员并发失权需求' })).json();
  const admin = sqlite.prepare("SELECT id FROM accounts WHERE normalized_username='admin'").get() as { id: string };
  sqlite.exec(`CREATE TEMP TRIGGER demote_admin_during_requirement_edit BEFORE UPDATE OF title ON requirements
    WHEN OLD.id='${requirement.id}' BEGIN
      UPDATE accounts SET global_role='user', session_version=session_version+1 WHERE id='${admin.id}';
    END`);
  const edited = await patch(`/api/requirements/${requirement.id}`, {
    title: '不应由失权管理员保存', expectedVersion: requirement.version,
  });
  expect(edited.statusCode).toBe(403);
  expect(sqlite.prepare('SELECT title, version FROM requirements WHERE id=?').get(requirement.id)).toEqual({
    title: '管理员并发失权需求', version: requirement.version,
  });
  expect(sqlite.prepare('SELECT global_role AS globalRole, session_version AS sessionVersion FROM accounts WHERE id=?').get(admin.id)).toEqual({
    globalRole: 'admin', sessionVersion: 0,
  });
  sqlite.exec('DROP TRIGGER demote_admin_during_requirement_edit');

  const disposableProject = (await post('/api/projects', { name: '管理员失权归档项目' })).json();
  sqlite.exec(`CREATE TEMP TRIGGER demote_admin_during_project_archive BEFORE UPDATE OF deleted_at ON projects
    WHEN OLD.id='${disposableProject.id}' AND NEW.deleted_at IS NOT NULL BEGIN
      UPDATE accounts SET global_role='user', session_version=session_version+1 WHERE id='${admin.id}';
    END`);
  const archived = await remove(`/api/projects/${disposableProject.id}`, {});
  expect(archived.statusCode).toBe(403);
  expect(sqlite.prepare('SELECT deleted_at AS deletedAt FROM projects WHERE id=?').get(disposableProject.id)).toEqual({ deletedAt: null });
  expect(sqlite.prepare('SELECT global_role AS globalRole, session_version AS sessionVersion FROM accounts WHERE id=?').get(admin.id)).toEqual({
    globalRole: 'admin', sessionVersion: 0,
  });
  sqlite.exec('DROP TRIGGER demote_admin_during_project_archive');
});

it('平台管理员在账号写入期间失权时账号与审计一起回滚', async () => {
  const { sqlite } = await import('./support/database');
  const person = (await post('/api/people', { name: '账号并发失权目标' })).json();
  const target = (await app.inject({ url: '/api/accounts', headers: { cookie } })).json()
    .find((account: { personId: string }) => account.personId === person.id);
  const admin = sqlite.prepare("SELECT id FROM accounts WHERE normalized_username='admin'").get() as { id: string };

  sqlite.exec(`CREATE TEMP TRIGGER demote_admin_during_account_edit BEFORE UPDATE OF username ON accounts
    WHEN OLD.id='${target.id}' BEGIN
      UPDATE accounts SET global_role='user', session_version=session_version+1 WHERE id='${admin.id}';
    END`);
  const edited = await patch(`/api/accounts/${target.id}`, {
    username: '不应由失权管理员保存', expectedUpdatedAt: target.updatedAt,
  });
  expect(edited.statusCode).toBe(403);
  expect(sqlite.prepare('SELECT username, updated_at AS updatedAt FROM accounts WHERE id=?').get(target.id)).toEqual({
    username: target.username, updatedAt: target.updatedAt,
  });
  expect(sqlite.prepare('SELECT global_role AS globalRole, session_version AS sessionVersion FROM accounts WHERE id=?').get(admin.id)).toEqual({
    globalRole: 'admin', sessionVersion: 0,
  });
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE entity_type='account' AND entity_id=? AND action='update'").get(target.id)).toEqual({ count: 0 });
  sqlite.exec('DROP TRIGGER demote_admin_during_account_edit');

  sqlite.exec(`CREATE TEMP TRIGGER reject_account_audit BEFORE INSERT ON audit_logs
    WHEN NEW.entity_type='account' AND NEW.entity_id='${target.id}' AND NEW.action='update' BEGIN
      SELECT RAISE(ABORT, 'reject account audit');
    END`);
  const rejectedAudit = await patch(`/api/accounts/${target.id}`, {
    username: '不应脱离审计保存', expectedUpdatedAt: target.updatedAt,
  });
  expect(rejectedAudit.statusCode).toBe(500);
  expect(sqlite.prepare('SELECT username, updated_at AS updatedAt FROM accounts WHERE id=?').get(target.id)).toEqual({
    username: target.username, updatedAt: target.updatedAt,
  });
  sqlite.exec('DROP TRIGGER reject_account_audit');
});

it('项目与人员平台写入会在同一事务内复核权限并记录审计', async () => {
  const { sqlite } = await import('./support/database');
  const admin = sqlite.prepare("SELECT id FROM accounts WHERE normalized_username='admin'").get() as { id: string };
  sqlite.exec(`CREATE TEMP TRIGGER demote_admin_during_project_create BEFORE INSERT ON projects
    WHEN NEW.name='不应由失权管理员创建的项目' BEGIN
      UPDATE accounts SET global_role='user', session_version=session_version+1 WHERE id='${admin.id}';
    END`);
  const project = await post('/api/projects', { name: '不应由失权管理员创建的项目' });
  expect(project.statusCode).toBe(403);
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM projects WHERE name='不应由失权管理员创建的项目'").get()).toEqual({ count: 0 });
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM work_item_templates WHERE project_id IN (SELECT id FROM projects WHERE name='不应由失权管理员创建的项目')").get()).toEqual({ count: 0 });
  expect(sqlite.prepare('SELECT global_role AS globalRole, session_version AS sessionVersion FROM accounts WHERE id=?').get(admin.id)).toEqual({
    globalRole: 'admin', sessionVersion: 0,
  });
  sqlite.exec('DROP TRIGGER demote_admin_during_project_create');

  sqlite.exec(`CREATE TEMP TRIGGER reject_person_create_audit BEFORE INSERT ON audit_logs
    WHEN NEW.entity_type='person' AND NEW.action='create' AND NEW.summary='新增人员：不应脱离审计创建的人员' BEGIN
      SELECT RAISE(ABORT, 'reject person create audit');
    END`);
  const person = await post('/api/people', { name: '不应脱离审计创建的人员' });
  expect(person.statusCode).toBe(500);
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM people WHERE name='不应脱离审计创建的人员'").get()).toEqual({ count: 0 });
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM accounts WHERE username='不应脱离审计创建的人员'").get()).toEqual({ count: 0 });
  sqlite.exec('DROP TRIGGER reject_person_create_audit');
});

it('流程与需求审计失败时业务数据整体回滚', async () => {
  const { sqlite } = await import('./support/database');
  sqlite.exec(`CREATE TEMP TRIGGER reject_template_create_audit BEFORE INSERT ON audit_logs
    WHEN NEW.entity_type='template' AND NEW.action='create' AND NEW.summary='创建流程：不应脱离审计创建的流程' BEGIN
      SELECT RAISE(ABORT, 'reject template create audit');
    END`);
  const template = await post('/api/templates', {
    projectId,
    name: '不应脱离审计创建的流程',
    items: [{ title: '不应残留的步骤', startOffsetDays: 0, durationDays: 1, sortOrder: 0 }],
  });
  expect(template.statusCode).toBe(500);
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM work_item_templates WHERE name='不应脱离审计创建的流程'").get()).toEqual({ count: 0 });
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM template_items WHERE title='不应残留的步骤'").get()).toEqual({ count: 0 });
  sqlite.exec('DROP TRIGGER reject_template_create_audit');

  sqlite.exec(`CREATE TEMP TRIGGER reject_requirement_create_audit BEFORE INSERT ON audit_logs
    WHEN NEW.entity_type='requirement' AND NEW.action='create' AND NEW.summary='创建需求并生成工作项：不应脱离审计创建的需求' BEGIN
      SELECT RAISE(ABORT, 'reject requirement create audit');
    END`);
  const requirement = await post('/api/requirements', {templateId: await defaultTemplate(projectId),
    projectId, title: '不应脱离审计创建的需求', plannedStart: '2020-05-06',
  });
  expect(requirement.statusCode).toBe(500);
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM requirements WHERE title='不应脱离审计创建的需求'").get()).toEqual({ count: 0 });
  expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM work_items w JOIN requirements r ON r.id=w.requirement_id
    WHERE r.title='不应脱离审计创建的需求'`).get()).toEqual({ count: 0 });
  sqlite.exec('DROP TRIGGER reject_requirement_create_audit');
});

it('工作项删除、排序和进展审计失败时业务数据整体回滚', async () => {
  const { sqlite } = await import('./support/database');

  const deletedRequirement = (await post('/api/requirements', {templateId: await defaultTemplate(projectId),
    projectId, title: '工作项删除审计回滚', plannedStart: '2020-06-01',
  })).json();
  const deletedItem = deletedRequirement.workItems[0];
  sqlite.exec(`CREATE TEMP TRIGGER reject_work_item_delete_audit BEFORE INSERT ON audit_logs
    WHEN NEW.entity_type='work_item' AND NEW.entity_id='${deletedItem.id}' AND NEW.action='delete' BEGIN
      SELECT RAISE(ABORT, 'reject work item delete audit');
    END`);
  const deletion = await remove(`/api/work-items/${deletedItem.id}`, { expectedVersion: deletedItem.version });
  expect(deletion.statusCode).toBe(500);
  expect(sqlite.prepare('SELECT COUNT(*) AS count FROM work_items WHERE id=?').get(deletedItem.id)).toEqual({ count: 1 });
  expect(sqlite.prepare('SELECT version FROM requirements WHERE id=?').get(deletedRequirement.id)).toEqual({ version: deletedRequirement.version });
  sqlite.exec('DROP TRIGGER reject_work_item_delete_audit');

  const reorderedRequirement = (await post('/api/requirements', {templateId: await defaultTemplate(projectId),
    projectId, title: '工作项排序审计回滚', plannedStart: '2020-07-01',
  })).json();
  const originalOrder = reorderedRequirement.workItems.map((item: { id: string }) => item.id);
  const reversedOrder = [...originalOrder].reverse();
  expect(reversedOrder).not.toEqual(originalOrder);
  sqlite.exec(`CREATE TEMP TRIGGER reject_work_item_reorder_audit BEFORE INSERT ON audit_logs
    WHEN NEW.entity_type='work_item' AND NEW.entity_id='${reorderedRequirement.id}' AND NEW.action='reorder' BEGIN
      SELECT RAISE(ABORT, 'reject work item reorder audit');
    END`);
  const reordering = await post(`/api/requirements/${reorderedRequirement.id}/reorder-work-items`, {
    ids: reversedOrder, expectedVersion: reorderedRequirement.version,
  });
  expect(reordering.statusCode).toBe(500);
  expect(sqlite.prepare('SELECT id FROM work_items WHERE requirement_id=? ORDER BY sort_order, created_at').all(reorderedRequirement.id)
    .map((item: any) => item.id)).toEqual(originalOrder);
  expect(sqlite.prepare('SELECT version FROM requirements WHERE id=?').get(reorderedRequirement.id)).toEqual({ version: reorderedRequirement.version });
  sqlite.exec('DROP TRIGGER reject_work_item_reorder_audit');

  const progressRequirement = (await post('/api/requirements', {
    projectId, title: '需求进展审计回滚',
  })).json();
  sqlite.exec(`CREATE TEMP TRIGGER reject_progress_create_audit BEFORE INSERT ON audit_logs
    WHEN NEW.entity_type='progress' AND NEW.action='create' BEGIN
      SELECT RAISE(ABORT, 'reject progress create audit');
    END`);
  const progress = await post(`/api/requirements/${progressRequirement.id}/progress`, { content: '不应脱离审计保存的进展' });
  expect(progress.statusCode).toBe(500);
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM progress_updates WHERE requirement_id=? AND content='不应脱离审计保存的进展'")
    .get(progressRequirement.id)).toEqual({ count: 0 });
  sqlite.exec('DROP TRIGGER reject_progress_create_audit');
});

it('问题创建和进展审计失败时业务数据整体回滚', async () => {
  const { sqlite } = await import('./support/database');
  sqlite.exec(`CREATE TEMP TRIGGER reject_issue_create_audit BEFORE INSERT ON audit_logs
    WHEN NEW.entity_type='issue' AND NEW.action='create' AND NEW.summary='创建问题：不应脱离审计创建的问题' BEGIN
      SELECT RAISE(ABORT, 'reject issue create audit');
    END`);
  const creation = await post('/api/issues', { projectId, title: '不应脱离审计创建的问题' });
  expect(creation.statusCode).toBe(500);
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM issues WHERE title='不应脱离审计创建的问题'").get()).toEqual({ count: 0 });
  sqlite.exec('DROP TRIGGER reject_issue_create_audit');

  const issue = (await post('/api/issues', { projectId, title: '问题进展审计回滚' })).json();
  sqlite.exec(`CREATE TEMP TRIGGER reject_issue_update_audit BEFORE INSERT ON audit_logs
    WHEN NEW.entity_type='issue_update' AND NEW.action='create' BEGIN
      SELECT RAISE(ABORT, 'reject issue update audit');
    END`);
  const update = await post(`/api/issues/${issue.id}/updates`, { content: '不应脱离审计保存的问题进展' });
  expect(update.statusCode).toBe(500);
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM issue_updates WHERE issue_id=? AND content='不应脱离审计保存的问题进展'")
    .get(issue.id)).toEqual({ count: 0 });
  sqlite.exec('DROP TRIGGER reject_issue_update_audit');
});

it('品牌和Token写入会在同一事务内复核管理员并记录审计', async () => {
  const { sqlite } = await import('./support/database');
  const admin = sqlite.prepare("SELECT id FROM accounts WHERE normalized_username='admin'").get() as { id: string };
  const initialBranding = await app.inject({ url: '/api/branding' });
  const established = await app.inject({ method: 'PUT', url: '/api/system/branding', headers: { cookie }, payload: {
    systemName: '并发品牌基线', shortName: '基线', expectedUpdatedAt: initialBranding.json().updatedAt,
  } });
  expect(established.statusCode).toBe(200);

  sqlite.exec(`CREATE TEMP TRIGGER demote_admin_during_branding BEFORE UPDATE OF value ON system_meta
    WHEN OLD.key='system-branding' BEGIN
      UPDATE accounts SET global_role='user', session_version=session_version+1 WHERE id='${admin.id}';
    END`);
  const branding = await app.inject({ method: 'PUT', url: '/api/system/branding', headers: { cookie }, payload: {
    systemName: '不应保存的品牌', shortName: '失权', expectedUpdatedAt: established.json().updatedAt,
  } });
  expect(branding.statusCode).toBe(403);
  expect((await app.inject({ url: '/api/branding' })).json()).toMatchObject({
    systemName: '并发品牌基线', shortName: '基线', updatedAt: established.json().updatedAt,
  });
  expect(sqlite.prepare('SELECT global_role AS globalRole, session_version AS sessionVersion FROM accounts WHERE id=?').get(admin.id)).toEqual({
    globalRole: 'admin', sessionVersion: 0,
  });
  sqlite.exec('DROP TRIGGER demote_admin_during_branding');

  const token = (await post('/api/tokens', { name: '并发撤销Token' })).json();
  sqlite.exec(`CREATE TEMP TRIGGER demote_admin_during_token_revoke BEFORE UPDATE OF revoked_at ON api_tokens
    WHEN OLD.id='${token.id}' BEGIN
      UPDATE accounts SET global_role='user', session_version=session_version+1 WHERE id='${admin.id}';
    END`);
  const revoked = await app.inject({ method: 'DELETE', url: `/api/admin/tokens/${token.id}`, headers: { cookie } });
  expect(revoked.statusCode).toBe(403);
  expect(sqlite.prepare('SELECT revoked_at AS revokedAt FROM api_tokens WHERE id=?').get(token.id)).toEqual({ revokedAt: null });
  expect(sqlite.prepare('SELECT global_role AS globalRole, session_version AS sessionVersion FROM accounts WHERE id=?').get(admin.id)).toEqual({
    globalRole: 'admin', sessionVersion: 0,
  });
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE entity_type='api_token' AND entity_id=? AND action='revoke'").get(token.id)).toEqual({ count: 0 });
  sqlite.exec('DROP TRIGGER demote_admin_during_token_revoke');

  sqlite.exec(`CREATE TEMP TRIGGER reject_token_revoke_audit BEFORE INSERT ON audit_logs
    WHEN NEW.entity_type='api_token' AND NEW.entity_id='${token.id}' AND NEW.action='revoke' BEGIN
      SELECT RAISE(ABORT, 'reject token audit');
    END`);
  const rejectedAudit = await app.inject({ method: 'DELETE', url: `/api/tokens/${token.id}`, headers: { cookie } });
  expect(rejectedAudit.statusCode).toBe(500);
  expect(sqlite.prepare('SELECT revoked_at AS revokedAt FROM api_tokens WHERE id=?').get(token.id)).toEqual({ revokedAt: null });
  sqlite.exec('DROP TRIGGER reject_token_revoke_audit');
});

it('个人分析布局写入期间账号失效时布局与审计一起回滚', async () => {
  const { sqlite } = await import('./support/database');
  const admin = sqlite.prepare("SELECT id FROM accounts WHERE normalized_username='admin'").get() as { id: string };
  const initial = (await app.inject({ url: '/api/analytics/layout', headers: { cookie } })).json();
  const established = await app.inject({ method: 'PUT', url: '/api/analytics/layout', headers: { cookie }, payload: {
    ...initial.layout, expectedUpdatedAt: initial.updatedAt,
  } });
  expect(established.statusCode).toBe(200);
  const auditCount = sqlite.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE entity_type='analytics_layout' AND entity_id=?").get(admin.id);

  sqlite.exec(`CREATE TEMP TRIGGER disable_account_during_layout_save BEFORE UPDATE OF config_json ON analytics_layouts
    WHEN OLD.account_id='${admin.id}' BEGIN
      UPDATE accounts SET status='disabled', session_version=session_version+1 WHERE id='${admin.id}';
    END`);
  const changedLayout = {
    ...established.json().layout,
    panels: established.json().layout.panels.slice(0, -1),
    expectedUpdatedAt: established.json().updatedAt,
  };
  const changed = await app.inject({ method: 'PUT', url: '/api/analytics/layout', headers: { cookie }, payload: changedLayout });
  expect(changed.statusCode).toBe(403);
  expect(sqlite.prepare('SELECT status, session_version AS sessionVersion FROM accounts WHERE id=?').get(admin.id)).toEqual({
    status: 'active', sessionVersion: 0,
  });
  expect((await app.inject({ url: '/api/analytics/layout', headers: { cookie } })).json()).toMatchObject({
    updatedAt: established.json().updatedAt,
    layout: established.json().layout,
  });
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE entity_type='analytics_layout' AND entity_id=?").get(admin.id)).toEqual(auditCount);
  sqlite.exec('DROP TRIGGER disable_account_during_layout_save');
});

it('无版本说明在获得写锁后重查终态，晚到记录不会越过取消或解决', async () => {
  const { sqlite } = await import('./support/database');
  const requirement = (await post('/api/requirements', { projectId, title: '并发取消说明测试' })).json();
  sqlite.exec(`CREATE TEMP TRIGGER cancel_before_note BEFORE INSERT ON progress_updates
    WHEN NEW.event_type='note' BEGIN
      UPDATE requirements SET status='cancelled', version=version+1 WHERE id=NEW.requirement_id;
    END`);
  const progressResult = await post(`/api/requirements/${requirement.id}/progress`, { content: '不应越过取消的说明' });
  expect(progressResult.statusCode).toBe(409);
  expect(progressResult.json()).toMatchObject({ code: 'TERMINAL_LOCKED' });
  expect(sqlite.prepare('SELECT status, version FROM requirements WHERE id=?').get(requirement.id)).toEqual({
    status: 'not_started', version: requirement.version,
  });
  expect(sqlite.prepare('SELECT COUNT(*) AS count FROM progress_updates WHERE requirement_id=?').get(requirement.id)).toEqual({ count: 0 });
  sqlite.exec('DROP TRIGGER cancel_before_note');

  const issue = (await post('/api/issues', { projectId, title: '并发解决说明测试' })).json();
  sqlite.exec(`CREATE TEMP TRIGGER resolve_before_note BEFORE INSERT ON issue_updates
    WHEN NEW.event_type='note' BEGIN
      UPDATE issues SET status='resolved', progress=100, resolved_at=discovered_at, version=version+1 WHERE id=NEW.issue_id;
    END`);
  const updateResult = await post(`/api/issues/${issue.id}/updates`, { content: '不应越过解决的说明' });
  expect(updateResult.statusCode).toBe(409);
  expect(updateResult.json()).toMatchObject({ code: 'TERMINAL_LOCKED' });
  expect(sqlite.prepare('SELECT status, progress, version FROM issues WHERE id=?').get(issue.id)).toEqual({
    status: 'in_progress', progress: 0, version: issue.version,
  });
  expect(sqlite.prepare('SELECT COUNT(*) AS count FROM issue_updates WHERE issue_id=?').get(issue.id)).toEqual({ count: 0 });
  sqlite.exec('DROP TRIGGER resolve_before_note');
});

it('归档与新建在同一写锁后复核父子状态，不会留下活跃孤儿', async () => {
  const { sqlite } = await import('./support/database');
  const emptyProject = (await post('/api/projects', { name: '并发归档空项目' })).json();
  sqlite.exec(`CREATE TEMP TRIGGER add_requirement_during_project_archive BEFORE UPDATE OF deleted_at ON projects
    WHEN OLD.id='${emptyProject.id}' AND NEW.deleted_at IS NOT NULL BEGIN
      INSERT INTO requirements (id, project_id, title, status, progress, risk_level, priority, created_at, updated_at)
      VALUES ('archive-race-requirement', OLD.id, '并发创建需求', 'not_started', 0, 'low', 'P2', OLD.updated_at, OLD.updated_at);
    END`);
  const projectArchive = await remove(`/api/projects/${emptyProject.id}`, { expectedUpdatedAt: emptyProject.updatedAt });
  expect(projectArchive.statusCode).toBe(409);
  expect(projectArchive.json()).toMatchObject({ code: 'DEPENDENCY_CONFLICT' });
  expect(sqlite.prepare('SELECT deleted_at AS deletedAt FROM projects WHERE id=?').get(emptyProject.id)).toEqual({ deletedAt: null });
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM requirements WHERE id='archive-race-requirement'").get()).toEqual({ count: 0 });
  sqlite.exec('DROP TRIGGER add_requirement_during_project_archive');

  const terminal = (await post('/api/requirements', { projectId, title: '并发归档终态需求' })).json();
  const cancelled = (await post(`/api/requirements/${terminal.id}/cancel`, {
    expectedVersion: terminal.version, reason: '准备归档',
  })).json();
  sqlite.exec(`CREATE TEMP TRIGGER add_issue_during_requirement_archive BEFORE UPDATE OF deleted_at ON requirements
    WHEN OLD.id='${terminal.id}' AND NEW.deleted_at IS NOT NULL BEGIN
      INSERT INTO issues (id, project_id, requirement_id, title, status, priority, progress, discovered_at, created_at, updated_at)
      VALUES ('archive-race-issue', OLD.project_id, OLD.id, '并发创建问题', 'in_progress', 'P2', 0, '2020-01-02', OLD.updated_at, OLD.updated_at);
    END`);
  const requirementArchive = await remove(`/api/requirements/${terminal.id}`, { expectedVersion: cancelled.version });
  expect(requirementArchive.statusCode).toBe(409);
  expect(requirementArchive.json()).toMatchObject({ code: 'DEPENDENCY_CONFLICT' });
  expect(sqlite.prepare('SELECT deleted_at AS deletedAt FROM requirements WHERE id=?').get(terminal.id)).toEqual({ deletedAt: null });
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM issues WHERE id='archive-race-issue'").get()).toEqual({ count: 0 });
  sqlite.exec('DROP TRIGGER add_issue_during_requirement_archive');

  const parent = (await post('/api/requirements', { projectId, title: '并发新建问题父需求' })).json();
  sqlite.exec(`CREATE TEMP TRIGGER archive_requirement_during_issue_create BEFORE INSERT ON issues
    WHEN NEW.requirement_id='${parent.id}' BEGIN
      UPDATE requirements SET deleted_at='2099-01-01T00:00:00.000Z', version=version+1 WHERE id=NEW.requirement_id;
    END`);
  const issueCreate = await post('/api/issues', { projectId, requirementId: parent.id, title: '不应写入归档需求的问题' });
  expect(issueCreate.statusCode).toBe(409);
  expect(issueCreate.json()).toMatchObject({ code: 'DEPENDENCY_CONFLICT' });
  expect(sqlite.prepare('SELECT deleted_at AS deletedAt, version FROM requirements WHERE id=?').get(parent.id)).toEqual({
    deletedAt: null, version: parent.version,
  });
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM issues WHERE title='不应写入归档需求的问题'").get()).toEqual({ count: 0 });
  sqlite.exec('DROP TRIGGER archive_requirement_during_issue_create');

  const createRaceProject = (await post('/api/projects', { name: '并发新建需求项目' })).json();
  sqlite.exec(`CREATE TEMP TRIGGER archive_project_during_requirement_create BEFORE INSERT ON requirements
    WHEN NEW.project_id='${createRaceProject.id}' BEGIN
      UPDATE projects SET deleted_at='2099-01-01T00:00:00.000Z' WHERE id=NEW.project_id;
    END`);
  const requirementCreate = await post('/api/requirements', { projectId: createRaceProject.id, title: '不应写入归档项目的需求' });
  expect(requirementCreate.statusCode).toBe(409);
  expect(requirementCreate.json()).toMatchObject({ code: 'DEPENDENCY_CONFLICT' });
  expect(sqlite.prepare('SELECT deleted_at AS deletedAt FROM projects WHERE id=?').get(createRaceProject.id)).toEqual({ deletedAt: null });
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM requirements WHERE title='不应写入归档项目的需求'").get()).toEqual({ count: 0 });
  sqlite.exec('DROP TRIGGER archive_project_during_requirement_create');
});

it('流程恢复归档和成员移除不会越过并发项目归档', async () => {
  const { sqlite } = await import('./support/database');
  const ownedProject = (await post('/api/projects', { name: '子资源归档竞争项目' })).json();
  const template = (await post('/api/templates', {
    projectId: ownedProject.id,
    name: '可归档流程',
    items: [{ title: '步骤', startOffsetDays: 0, durationDays: 1, sortOrder: 0 }],
  })).json();

  sqlite.exec(`CREATE TEMP TRIGGER archive_project_during_template_archive BEFORE UPDATE OF deleted_at ON work_item_templates
    WHEN OLD.id='${template.id}' AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL BEGIN
      UPDATE projects SET deleted_at='2099-01-01T00:00:00.000Z' WHERE id=OLD.project_id;
    END`);
  const templateArchive = await remove(`/api/templates/${template.id}`, { expectedUpdatedAt: template.updatedAt });
  expect(templateArchive.statusCode).toBe(409);
  expect(templateArchive.json()).toMatchObject({ code: 'DEPENDENCY_CONFLICT' });
  expect(sqlite.prepare('SELECT deleted_at AS deletedAt FROM projects WHERE id=?').get(ownedProject.id)).toEqual({ deletedAt: null });
  expect(sqlite.prepare('SELECT deleted_at AS deletedAt FROM work_item_templates WHERE id=?').get(template.id)).toEqual({ deletedAt: null });
  sqlite.exec('DROP TRIGGER archive_project_during_template_archive');

  expect((await remove(`/api/templates/${template.id}`, { expectedUpdatedAt: template.updatedAt })).statusCode).toBe(200);
  const archivedTemplate = sqlite.prepare('SELECT deleted_at AS deletedAt, updated_at AS updatedAt FROM work_item_templates WHERE id=?').get(template.id) as { deletedAt: string; updatedAt: string };
  sqlite.exec(`CREATE TEMP TRIGGER archive_project_during_template_restore BEFORE UPDATE OF deleted_at ON work_item_templates
    WHEN OLD.id='${template.id}' AND OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL BEGIN
      UPDATE projects SET deleted_at='2099-01-01T00:00:00.000Z' WHERE id=OLD.project_id;
    END`);
  const templateRestore = await post(`/api/templates/${template.id}/restore`, { expectedDeletedAt: archivedTemplate.deletedAt });
  expect(templateRestore.statusCode).toBe(409);
  expect(templateRestore.json()).toMatchObject({ code: 'DEPENDENCY_CONFLICT' });
  expect(sqlite.prepare('SELECT deleted_at AS deletedAt FROM projects WHERE id=?').get(ownedProject.id)).toEqual({ deletedAt: null });
  expect(sqlite.prepare('SELECT deleted_at AS deletedAt, updated_at AS updatedAt FROM work_item_templates WHERE id=?').get(template.id)).toEqual(archivedTemplate);
  sqlite.exec('DROP TRIGGER archive_project_during_template_restore');

  const person = (await post('/api/people', { projectId: ownedProject.id, name: '并发移除成员' })).json();
  const membership = sqlite.prepare('SELECT updated_at AS updatedAt FROM project_people WHERE project_id=? AND person_id=?').get(ownedProject.id, person.id) as { updatedAt: string };
  sqlite.exec(`CREATE TEMP TRIGGER archive_project_during_member_remove BEFORE DELETE ON project_people
    WHEN OLD.project_id='${ownedProject.id}' AND OLD.person_id='${person.id}' BEGIN
      UPDATE projects SET deleted_at='2099-01-01T00:00:00.000Z' WHERE id=OLD.project_id;
    END`);
  const memberRemove = await remove(`/api/projects/${ownedProject.id}/members/${person.id}`, { expectedMembershipUpdatedAt: membership.updatedAt });
  expect(memberRemove.statusCode).toBe(409);
  expect(memberRemove.json()).toMatchObject({ code: 'DEPENDENCY_CONFLICT' });
  expect(sqlite.prepare('SELECT deleted_at AS deletedAt FROM projects WHERE id=?').get(ownedProject.id)).toEqual({ deletedAt: null });
  expect(sqlite.prepare('SELECT COUNT(*) AS count FROM project_people WHERE project_id=? AND person_id=?').get(ownedProject.id, person.id)).toEqual({ count: 1 });
  sqlite.exec('DROP TRIGGER archive_project_during_member_remove');
});

it('需求、工作项和进展写入会在写锁后复核父项目', async () => {
  const { sqlite } = await import('./support/database');
  const ownedProject = (await post('/api/projects', { name: '业务写入归档竞争项目' })).json();
  const requirement = (await post('/api/requirements', {templateId: await defaultTemplate(ownedProject.id),
    projectId: ownedProject.id, title: '原需求标题', plannedStart: '2020-01-02',
  })).json();

  sqlite.exec(`CREATE TEMP TRIGGER archive_project_during_requirement_update BEFORE UPDATE OF title ON requirements
    WHEN OLD.id='${requirement.id}' AND NEW.title='迟到需求标题' BEGIN
      UPDATE projects SET deleted_at='2099-01-01T00:00:00.000Z' WHERE id=OLD.project_id;
    END`);
  const requirementUpdate = await patch(`/api/requirements/${requirement.id}`, {
    title: '迟到需求标题', expectedVersion: requirement.version,
  });
  expect(requirementUpdate.statusCode).toBe(409);
  expect(requirementUpdate.json()).toMatchObject({ code: 'DEPENDENCY_CONFLICT' });
  expect(sqlite.prepare('SELECT title, version FROM requirements WHERE id=?').get(requirement.id)).toEqual({
    title: '原需求标题', version: requirement.version,
  });
  expect(sqlite.prepare('SELECT deleted_at AS deletedAt FROM projects WHERE id=?').get(ownedProject.id)).toEqual({ deletedAt: null });
  sqlite.exec('DROP TRIGGER archive_project_during_requirement_update');

  const item = requirement.workItems[0];
  sqlite.exec(`CREATE TEMP TRIGGER archive_project_during_work_item_update BEFORE UPDATE OF title ON work_items
    WHEN OLD.id='${item.id}' AND NEW.title='迟到工作项标题' BEGIN
      UPDATE projects SET deleted_at='2099-01-01T00:00:00.000Z'
      WHERE id=(SELECT project_id FROM requirements WHERE id=OLD.requirement_id);
    END`);
  const itemUpdate = await patch(`/api/work-items/${item.id}`, {
    title: '迟到工作项标题', expectedVersion: item.version,
  });
  expect(itemUpdate.statusCode).toBe(409);
  expect(itemUpdate.json()).toMatchObject({ code: 'DEPENDENCY_CONFLICT' });
  expect(sqlite.prepare('SELECT title, version FROM work_items WHERE id=?').get(item.id)).toEqual({
    title: item.title, version: item.version,
  });
  expect(sqlite.prepare('SELECT deleted_at AS deletedAt FROM projects WHERE id=?').get(ownedProject.id)).toEqual({ deletedAt: null });
  sqlite.exec('DROP TRIGGER archive_project_during_work_item_update');

  sqlite.exec(`CREATE TEMP TRIGGER archive_project_during_progress_insert BEFORE INSERT ON progress_updates
    WHEN NEW.requirement_id='${requirement.id}' BEGIN
      UPDATE projects SET deleted_at='2099-01-01T00:00:00.000Z'
      WHERE id=(SELECT project_id FROM requirements WHERE id=NEW.requirement_id);
    END`);
  const progress = await post(`/api/requirements/${requirement.id}/progress`, { content: '不应写入归档项目的进展' });
  expect(progress.statusCode).toBe(409);
  expect(progress.json()).toMatchObject({ code: 'DEPENDENCY_CONFLICT' });
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM progress_updates WHERE content='不应写入归档项目的进展'").get()).toEqual({ count: 0 });
  expect(sqlite.prepare('SELECT deleted_at AS deletedAt FROM projects WHERE id=?').get(ownedProject.id)).toEqual({ deletedAt: null });
  sqlite.exec('DROP TRIGGER archive_project_during_progress_insert');
});

it('问题编辑、进展和状态命令会在写锁后复核项目与关联需求', async () => {
  const { sqlite } = await import('./support/database');
  const ownedProject = (await post('/api/projects', { name: '问题写入归档竞争项目' })).json();
  const requirement = (await post('/api/requirements', { projectId: ownedProject.id, title: '问题关联需求' })).json();
  const issue = (await post('/api/issues', { projectId: ownedProject.id, requirementId: requirement.id, title: '原问题标题' })).json();

  sqlite.exec(`CREATE TEMP TRIGGER archive_project_during_issue_update BEFORE UPDATE OF title ON issues
    WHEN OLD.id='${issue.id}' AND NEW.title='迟到问题标题' BEGIN
      UPDATE projects SET deleted_at='2099-01-01T00:00:00.000Z' WHERE id=OLD.project_id;
    END`);
  const issueUpdate = await patch(`/api/issues/${issue.id}`, { title: '迟到问题标题', expectedVersion: issue.version });
  expect(issueUpdate.statusCode).toBe(409);
  expect(issueUpdate.json()).toMatchObject({ code: 'DEPENDENCY_CONFLICT' });
  expect(sqlite.prepare('SELECT title, version FROM issues WHERE id=?').get(issue.id)).toEqual({ title: '原问题标题', version: issue.version });
  expect(sqlite.prepare('SELECT deleted_at AS deletedAt FROM projects WHERE id=?').get(ownedProject.id)).toEqual({ deletedAt: null });
  sqlite.exec('DROP TRIGGER archive_project_during_issue_update');

  sqlite.exec(`CREATE TEMP TRIGGER archive_project_during_issue_note BEFORE INSERT ON issue_updates
    WHEN NEW.issue_id='${issue.id}' BEGIN
      UPDATE projects SET deleted_at='2099-01-01T00:00:00.000Z'
      WHERE id=(SELECT project_id FROM issues WHERE id=NEW.issue_id);
    END`);
  const note = await post(`/api/issues/${issue.id}/updates`, { content: '不应写入归档项目的问题进展' });
  expect(note.statusCode).toBe(409);
  expect(note.json()).toMatchObject({ code: 'DEPENDENCY_CONFLICT' });
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM issue_updates WHERE content='不应写入归档项目的问题进展'").get()).toEqual({ count: 0 });
  expect(sqlite.prepare('SELECT deleted_at AS deletedAt FROM projects WHERE id=?').get(ownedProject.id)).toEqual({ deletedAt: null });
  sqlite.exec('DROP TRIGGER archive_project_during_issue_note');

  sqlite.exec(`CREATE TEMP TRIGGER archive_requirement_during_issue_resolve BEFORE UPDATE OF status ON issues
    WHEN OLD.id='${issue.id}' AND NEW.status='resolved' BEGIN
      UPDATE requirements SET deleted_at='2099-01-01T00:00:00.000Z', version=version+1 WHERE id=OLD.requirement_id;
    END`);
  const resolve = await post(`/api/issues/${issue.id}/resolve`, { content: '不应越过需求归档', expectedVersion: issue.version });
  expect(resolve.statusCode).toBe(409);
  expect(resolve.json()).toMatchObject({ code: 'DEPENDENCY_CONFLICT' });
  expect(sqlite.prepare('SELECT status, progress, version FROM issues WHERE id=?').get(issue.id)).toEqual({
    status: 'in_progress', progress: 0, version: issue.version,
  });
  expect(sqlite.prepare('SELECT deleted_at AS deletedAt, version FROM requirements WHERE id=?').get(requirement.id)).toEqual({
    deletedAt: null, version: requirement.version,
  });
  expect(sqlite.prepare('SELECT COUNT(*) AS count FROM issue_updates WHERE issue_id=?').get(issue.id)).toEqual({ count: 0 });
  sqlite.exec('DROP TRIGGER archive_requirement_during_issue_resolve');
});

it('人员停用与负责人分派双向复核，并阻止最后两名经理同时降级', async () => {
  const { sqlite } = await import('./support/database');
  const ownedProject = (await post('/api/projects', { name: '人员并发约束项目' })).json();
  const person = (await post('/api/people', { projectId: ownedProject.id, name: '并发负责人' })).json();
  const requirement = (await post('/api/requirements', { projectId: ownedProject.id, title: '并发分派需求' })).json();

  sqlite.exec(`CREATE TEMP TRIGGER deactivate_person_during_requirement_assign BEFORE UPDATE OF owner_id ON requirements
    WHEN OLD.id='${requirement.id}' AND NEW.owner_id='${person.id}' BEGIN
      UPDATE people SET active=0 WHERE id=NEW.owner_id;
    END`);
  const assignment = await patch(`/api/requirements/${requirement.id}`, { ownerId: person.id, expectedVersion: requirement.version });
  expect(assignment.statusCode).toBe(409);
  expect(assignment.json()).toMatchObject({ code: 'DEPENDENCY_CONFLICT' });
  expect(sqlite.prepare('SELECT owner_id AS ownerId, version FROM requirements WHERE id=?').get(requirement.id)).toEqual({
    ownerId: null, version: requirement.version,
  });
  expect(sqlite.prepare('SELECT active FROM people WHERE id=?').get(person.id)).toEqual({ active: 1 });
  sqlite.exec('DROP TRIGGER deactivate_person_during_requirement_assign');

  sqlite.exec(`CREATE TEMP TRIGGER assign_requirement_during_person_deactivate BEFORE UPDATE OF active ON people
    WHEN OLD.id='${person.id}' AND NEW.active=0 BEGIN
      UPDATE requirements SET owner_id=OLD.id WHERE id='${requirement.id}';
    END`);
  const deactivation = await patch(`/api/people/${person.id}`, { active: false, expectedUpdatedAt: person.updatedAt });
  expect(deactivation.statusCode).toBe(409);
  expect(deactivation.json()).toMatchObject({ code: 'DEPENDENCY_CONFLICT' });
  expect(sqlite.prepare('SELECT active, updated_at AS updatedAt FROM people WHERE id=?').get(person.id)).toEqual({
    active: 1, updatedAt: person.updatedAt,
  });
  expect(sqlite.prepare('SELECT owner_id AS ownerId FROM requirements WHERE id=?').get(requirement.id)).toEqual({ ownerId: null });
  sqlite.exec('DROP TRIGGER assign_requirement_during_person_deactivate');

  const managerOne = (await post('/api/people', { projectId: ownedProject.id, name: '并发经理甲' })).json();
  const managerTwo = (await post('/api/people', { projectId: ownedProject.id, name: '并发经理乙' })).json();
  for (const manager of [managerOne, managerTwo]) {
    const membership = sqlite.prepare('SELECT updated_at AS updatedAt FROM project_people WHERE project_id=? AND person_id=?')
      .get(ownedProject.id, manager.id) as { updatedAt: string };
    expect((await put(`/api/projects/${ownedProject.id}/members/${manager.id}`, {
      role: 'manager', expectedMembershipUpdatedAt: membership.updatedAt,
    })).statusCode).toBe(200);
  }
  const firstMembership = sqlite.prepare('SELECT updated_at AS updatedAt FROM project_people WHERE project_id=? AND person_id=?')
    .get(ownedProject.id, managerOne.id) as { updatedAt: string };
  sqlite.exec(`CREATE TEMP TRIGGER demote_other_manager_during_role_change BEFORE UPDATE OF project_role ON project_people
    WHEN OLD.project_id='${ownedProject.id}' AND OLD.person_id='${managerOne.id}' AND NEW.project_role='member' BEGIN
      UPDATE project_people SET project_role='member' WHERE project_id=OLD.project_id AND person_id='${managerTwo.id}';
    END`);
  const demotion = await put(`/api/projects/${ownedProject.id}/members/${managerOne.id}`, {
    role: 'member', expectedMembershipUpdatedAt: firstMembership.updatedAt,
  });
  expect(demotion.statusCode).toBe(409);
  expect(demotion.json()).toMatchObject({ code: 'DEPENDENCY_CONFLICT' });
  expect(sqlite.prepare(`SELECT person_id AS personId, project_role AS projectRole FROM project_people
    WHERE project_id=? AND person_id IN (?, ?) ORDER BY person_id`).all(ownedProject.id, managerOne.id, managerTwo.id))
    .toEqual([managerOne.id, managerTwo.id].sort().map((personId) => ({ personId, projectRole: 'manager' })));
  sqlite.exec('DROP TRIGGER demote_other_manager_during_role_change');
});

it('工作项负责人、协作者和问题负责人写入后复核人员有效性', async () => {
  const { sqlite } = await import('./support/database');
  const ownedProject = (await post('/api/projects', { name: '多入口人员分派竞争项目' })).json();
  const person = (await post('/api/people', { projectId: ownedProject.id, name: '多入口并发人员' })).json();
  const requirement = (await post('/api/requirements', {templateId: await defaultTemplate(ownedProject.id),
    projectId: ownedProject.id, title: '多入口并发需求', plannedStart: '2020-01-02',
  })).json();
  const item = requirement.workItems[0];

  sqlite.exec(`CREATE TEMP TRIGGER deactivate_person_during_work_item_assign BEFORE UPDATE OF owner_id ON work_items
    WHEN OLD.id='${item.id}' AND NEW.owner_id='${person.id}' BEGIN
      UPDATE people SET active=0 WHERE id=NEW.owner_id;
    END`);
  const ownerAssignment = await patch(`/api/work-items/${item.id}`, { ownerId: person.id, expectedVersion: item.version });
  expect(ownerAssignment.statusCode).toBe(409);
  expect(ownerAssignment.json()).toMatchObject({ code: 'DEPENDENCY_CONFLICT' });
  expect(sqlite.prepare('SELECT owner_id AS ownerId, version FROM work_items WHERE id=?').get(item.id)).toEqual({ ownerId: null, version: item.version });
  expect(sqlite.prepare('SELECT active FROM people WHERE id=?').get(person.id)).toEqual({ active: 1 });
  sqlite.exec('DROP TRIGGER deactivate_person_during_work_item_assign');

  sqlite.exec(`CREATE TEMP TRIGGER deactivate_person_during_collaborator_assign BEFORE INSERT ON work_item_collaborators
    WHEN NEW.work_item_id='${item.id}' AND NEW.person_id='${person.id}' BEGIN
      UPDATE people SET active=0 WHERE id=NEW.person_id;
    END`);
  const collaboratorAssignment = await patch(`/api/work-items/${item.id}`, { collaboratorIds: [person.id], expectedVersion: item.version });
  expect(collaboratorAssignment.statusCode).toBe(409);
  expect(collaboratorAssignment.json()).toMatchObject({ code: 'DEPENDENCY_CONFLICT' });
  expect(sqlite.prepare('SELECT version FROM work_items WHERE id=?').get(item.id)).toEqual({ version: item.version });
  expect(sqlite.prepare('SELECT COUNT(*) AS count FROM work_item_collaborators WHERE work_item_id=?').get(item.id)).toEqual({ count: 0 });
  expect(sqlite.prepare('SELECT active FROM people WHERE id=?').get(person.id)).toEqual({ active: 1 });
  sqlite.exec('DROP TRIGGER deactivate_person_during_collaborator_assign');

  const issue = (await post('/api/issues', { projectId: ownedProject.id, title: '多入口并发问题' })).json();
  sqlite.exec(`CREATE TEMP TRIGGER deactivate_person_during_issue_assign BEFORE UPDATE OF owner_id ON issues
    WHEN OLD.id='${issue.id}' AND NEW.owner_id='${person.id}' BEGIN
      UPDATE people SET active=0 WHERE id=NEW.owner_id;
    END`);
  const issueAssignment = await patch(`/api/issues/${issue.id}`, { ownerId: person.id, expectedVersion: issue.version });
  expect(issueAssignment.statusCode).toBe(409);
  expect(issueAssignment.json()).toMatchObject({ code: 'DEPENDENCY_CONFLICT' });
  expect(sqlite.prepare('SELECT owner_id AS ownerId, version FROM issues WHERE id=?').get(issue.id)).toEqual({ ownerId: null, version: issue.version });
  expect(sqlite.prepare('SELECT active FROM people WHERE id=?').get(person.id)).toEqual({ active: 1 });
  sqlite.exec('DROP TRIGGER deactivate_person_during_issue_assign');
});

it('设置默认流程与流程归档双向复核，并始终保留有效流程', async () => {
  const { sqlite } = await import('./support/database');
  const ownedProject = (await post('/api/projects', { name: '默认流程并发约束项目' })).json();
  const template = (await post('/api/templates', {
    projectId: ownedProject.id,
    name: '候选默认流程',
    items: [{ title: '步骤', startOffsetDays: 0, durationDays: 1, sortOrder: 0 }],
  })).json();

  sqlite.exec(`CREATE TEMP TRIGGER archive_template_during_default_change BEFORE UPDATE OF default_template_id ON projects
    WHEN OLD.id='${ownedProject.id}' AND NEW.default_template_id='${template.id}' BEGIN
      UPDATE work_item_templates SET deleted_at='2099-01-01T00:00:00.000Z' WHERE id=NEW.default_template_id;
    END`);
  const defaultChange = await patch(`/api/projects/${ownedProject.id}`, {
    defaultTemplateId: template.id, expectedUpdatedAt: ownedProject.updatedAt,
  });
  expect(defaultChange.statusCode).toBe(409);
  expect(defaultChange.json()).toMatchObject({ code: 'DEPENDENCY_CONFLICT' });
  expect(sqlite.prepare('SELECT default_template_id AS defaultTemplateId, updated_at AS updatedAt FROM projects WHERE id=?').get(ownedProject.id)).toEqual({
    defaultTemplateId: ownedProject.defaultTemplateId, updatedAt: ownedProject.updatedAt,
  });
  expect(sqlite.prepare('SELECT deleted_at AS deletedAt FROM work_item_templates WHERE id=?').get(template.id)).toEqual({ deletedAt: null });
  sqlite.exec('DROP TRIGGER archive_template_during_default_change');

  sqlite.exec(`CREATE TEMP TRIGGER select_template_during_archive BEFORE UPDATE OF deleted_at ON work_item_templates
    WHEN OLD.id='${template.id}' AND NEW.deleted_at IS NOT NULL BEGIN
      UPDATE projects SET default_template_id=OLD.id WHERE id=OLD.project_id;
    END`);
  const archiveSelected = await remove(`/api/templates/${template.id}`, { expectedUpdatedAt: template.updatedAt });
  expect(archiveSelected.statusCode).toBe(409);
  expect(archiveSelected.json()).toMatchObject({ code: 'DEPENDENCY_CONFLICT' });
  expect(sqlite.prepare('SELECT default_template_id AS defaultTemplateId FROM projects WHERE id=?').get(ownedProject.id)).toEqual({
    defaultTemplateId: ownedProject.defaultTemplateId,
  });
  expect(sqlite.prepare('SELECT deleted_at AS deletedAt FROM work_item_templates WHERE id=?').get(template.id)).toEqual({ deletedAt: null });
  sqlite.exec('DROP TRIGGER select_template_during_archive');

  sqlite.exec(`CREATE TEMP TRIGGER archive_last_other_template BEFORE UPDATE OF deleted_at ON work_item_templates
    WHEN OLD.id='${template.id}' AND NEW.deleted_at IS NOT NULL BEGIN
      UPDATE work_item_templates SET deleted_at='2099-01-01T00:00:00.000Z' WHERE id='${ownedProject.defaultTemplateId}';
    END`);
  const archiveLastPair = await remove(`/api/templates/${template.id}`, { expectedUpdatedAt: template.updatedAt });
  expect(archiveLastPair.statusCode).toBe(409);
  expect(archiveLastPair.json()).toMatchObject({ code: 'DEPENDENCY_CONFLICT' });
  expect(sqlite.prepare('SELECT id, deleted_at AS deletedAt FROM work_item_templates WHERE id IN (?, ?) ORDER BY id')
    .all(template.id, ownedProject.defaultTemplateId)).toEqual([
      { id: template.id, deletedAt: null }, { id: ownedProject.defaultTemplateId, deletedAt: null },
    ].sort((left, right) => left.id.localeCompare(right.id)));
  sqlite.exec('DROP TRIGGER archive_last_other_template');
});

it('复制流程时来源被归档会整体回滚', async () => {
  const { sqlite } = await import('./support/database');
  const targetProject = (await post('/api/projects', { name: '流程复制来源复核目标' })).json();
  const source = (await post('/api/templates', {
    projectId, name: '待复制来源流程', description: '复制期间必须保持有效',
    items: [{ title: '来源步骤', startOffsetDays: 0, durationDays: 1, sortOrder: 0 }],
  })).json();
  const before = sqlite.prepare('SELECT COUNT(*) AS count FROM work_item_templates WHERE project_id=?').get(targetProject.id);
  sqlite.exec(`CREATE TEMP TRIGGER archive_source_during_template_copy BEFORE INSERT ON work_item_templates
    WHEN NEW.project_id='${targetProject.id}' AND NEW.name='待复制来源流程（副本）' BEGIN
      UPDATE work_item_templates SET deleted_at='2099-01-01T00:00:00.000Z', updated_at='2099-01-01T00:00:00.000Z' WHERE id='${source.id}';
    END`);
  const copied = await post(`/api/projects/${targetProject.id}/templates/${source.id}/copy`, {});
  expect(copied.statusCode).toBe(409);
  expect(copied.json()).toMatchObject({ code: 'DEPENDENCY_CONFLICT' });
  expect(sqlite.prepare('SELECT deleted_at AS deletedAt, updated_at AS updatedAt FROM work_item_templates WHERE id=?').get(source.id)).toEqual({
    deletedAt: null, updatedAt: source.updatedAt,
  });
  expect(sqlite.prepare('SELECT COUNT(*) AS count FROM work_item_templates WHERE project_id=?').get(targetProject.id)).toEqual(before);
  sqlite.exec('DROP TRIGGER archive_source_during_template_copy');
});

it('账号激活和重新开通会在写锁后复核人员状态', async () => {
  const { sqlite } = await import('./support/database');
  const person = (await post('/api/people', { name: '账号并发状态人员' })).json();
  const account = sqlite.prepare(`SELECT id, status, updated_at AS updatedAt, deleted_at AS deletedAt
    FROM accounts WHERE person_id=?`).get(person.id) as { id: string; status: string; updatedAt: string; deletedAt: string | null };
  const disabled = await patch(`/api/accounts/${account.id}`, { status: 'disabled', expectedUpdatedAt: account.updatedAt });
  expect(disabled.statusCode).toBe(200);

  sqlite.exec(`CREATE TEMP TRIGGER deactivate_person_during_account_activation BEFORE UPDATE OF status ON accounts
    WHEN OLD.id='${account.id}' AND NEW.status='active' BEGIN
      UPDATE people SET active=0 WHERE id=OLD.person_id;
    END`);
  const activation = await patch(`/api/accounts/${account.id}`, {
    status: 'active', expectedUpdatedAt: disabled.json().updatedAt,
  });
  expect(activation.statusCode).toBe(409);
  expect(activation.json()).toMatchObject({ code: 'DEPENDENCY_CONFLICT' });
  expect(sqlite.prepare('SELECT status, updated_at AS updatedAt FROM accounts WHERE id=?').get(account.id)).toEqual({
    status: 'disabled', updatedAt: disabled.json().updatedAt,
  });
  expect(sqlite.prepare('SELECT active FROM people WHERE id=?').get(person.id)).toEqual({ active: 1 });
  sqlite.exec('DROP TRIGGER deactivate_person_during_account_activation');

  expect((await remove(`/api/accounts/${account.id}`, { expectedUpdatedAt: disabled.json().updatedAt })).statusCode).toBe(200);
  const archivedAccount = sqlite.prepare('SELECT deleted_at AS deletedAt, updated_at AS updatedAt FROM accounts WHERE id=?').get(account.id) as {
    deletedAt: string; updatedAt: string;
  };
  sqlite.exec(`CREATE TEMP TRIGGER deactivate_person_during_account_reopen BEFORE UPDATE OF deleted_at ON accounts
    WHEN OLD.id='${account.id}' AND NEW.deleted_at IS NULL BEGIN
      UPDATE people SET active=0 WHERE id=OLD.person_id;
    END`);
  const reopen = await post(`/api/people/${person.id}/account`, { expectedAccountDeletedAt: archivedAccount.deletedAt });
  expect(reopen.statusCode).toBe(409);
  expect(reopen.json()).toMatchObject({ code: 'DEPENDENCY_CONFLICT' });
  expect(sqlite.prepare('SELECT deleted_at AS deletedAt, updated_at AS updatedAt FROM accounts WHERE id=?').get(account.id)).toEqual(archivedAccount);
  expect(sqlite.prepare('SELECT active FROM people WHERE id=?').get(person.id)).toEqual({ active: 1 });
  sqlite.exec('DROP TRIGGER deactivate_person_during_account_reopen');
});

it('Token创建和认证会在写锁后复核账号及撤销状态', async () => {
  const { sqlite } = await import('./support/database');
  const admin = sqlite.prepare("SELECT id, status FROM accounts WHERE normalized_username='admin'").get() as { id: string; status: string };
  sqlite.exec(`CREATE TEMP TRIGGER disable_account_during_token_create BEFORE INSERT ON api_tokens
    WHEN NEW.account_id='${admin.id}' BEGIN
      UPDATE accounts SET status='disabled' WHERE id=NEW.account_id;
    END`);
  const rejected = await post('/api/tokens', { name: '不应创建的并发Token' });
  expect(rejected.statusCode).toBe(409);
  expect(rejected.json()).toMatchObject({ code: 'DEPENDENCY_CONFLICT' });
  expect(sqlite.prepare('SELECT status FROM accounts WHERE id=?').get(admin.id)).toEqual({ status: 'active' });
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM api_tokens WHERE name='不应创建的并发Token'").get()).toEqual({ count: 0 });
  sqlite.exec('DROP TRIGGER disable_account_during_token_create');

  const token = (await post('/api/tokens', { name: '并发认证Token' })).json();
  sqlite.exec(`CREATE TEMP TRIGGER revoke_token_during_authentication BEFORE UPDATE OF last_used_at ON api_tokens
    WHEN OLD.id='${token.id}' BEGIN
      UPDATE api_tokens SET revoked_at='2099-01-01T00:00:00.000Z' WHERE id=OLD.id;
    END`);
  const { authenticateApiToken } = await import('../src/server/services/tokens');
  expect(authenticateApiToken(token.token)).toBeNull();
  expect(sqlite.prepare('SELECT revoked_at AS revokedAt FROM api_tokens WHERE id=?').get(token.id)).toEqual({
    revokedAt: '2099-01-01T00:00:00.000Z',
  });
  sqlite.exec('DROP TRIGGER revoke_token_during_authentication');
});

it('登录落库前账号变化时返回冲突且不签发Cookie', async () => {
  const { sqlite } = await import('./support/database');
  const person = (await post('/api/people', { name: '登录并发状态人员' })).json();
  const account = sqlite.prepare('SELECT id, username FROM accounts WHERE person_id=?').get(person.id) as { id: string; username: string };
  sqlite.exec(`CREATE TEMP TRIGGER disable_account_during_login BEFORE UPDATE OF last_login_at ON accounts
    WHEN OLD.id='${account.id}' BEGIN
      UPDATE accounts SET status='disabled', session_version=session_version+1 WHERE id=OLD.id;
    END`);
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: account.username, password: '888888' } });
  expect(login.statusCode).toBe(409);
  expect(login.json()).toMatchObject({ code: 'STALE_WRITE' });
  expect(login.headers['set-cookie']).toBeUndefined();
  expect(sqlite.prepare('SELECT status, session_version AS sessionVersion FROM accounts WHERE id=?').get(account.id)).toEqual({
    status: 'disabled', sessionVersion: 1,
  });
  sqlite.exec('DROP TRIGGER disable_account_during_login');
});

async function defaultTemplate(projectId:string){const response=await app.inject({url:"/api/templates?projectId="+projectId,headers:{cookie}});return response.json<Array<{id:string}>>()[0].id;}
