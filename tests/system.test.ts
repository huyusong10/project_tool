import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const dbPath = path.join(process.cwd(), 'data', `system-${randomUUID()}.db`);
const backupDir = path.join(process.cwd(), 'data', `system-backups-${randomUUID()}`);
process.env.DB_PATH = dbPath;
process.env.BACKUP_DIR = backupDir;
process.env.BACKUP_MAX_COUNT = '10';
process.env.SEED_DEMO = '0';
process.env.APP_PASSWORD_HASH = 'scrypt$4c63a6f93ff4f94b031b7e7583592177$b598dbddaf9dd06678ff8756923d9e0a7f2d68eaa45bc644fbf4a73c9298970c7489671dfcfc8be282022c26a3370fb040f3f086a45faa1e1abde04bbe4a51ef';
process.env.SESSION_SECRET = 'system-test-session-secret-with-more-than-thirty-two-characters';
process.env.NODE_ENV = 'test';

let app: FastifyInstance;
let cookie = '';

beforeAll(async () => {
  const module = await import('../src/server/app');
  app = await module.buildApp();
  await app.ready();
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: '41_xc7q0qOjo4Inw!' } });
  const setCookie = login.headers['set-cookie'];
  cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie!).split(';')[0];
});

afterAll(async () => {
  await app.close();
  const { sqlite } = await import('../src/server/database');
  if (sqlite.open) sqlite.close();
  for (const suffix of ['', '-wal', '-shm', '.restore']) fs.rmSync(`${dbPath}${suffix}`, { force: true });
  fs.rmSync(backupDir, { recursive: true, force: true });
});

describe('系统管理API', () => {
  it('仅管理员可查看概览并执行数据库完整性检查', async () => {
    const defaultBranding = await app.inject({ method: 'GET', url: '/api/branding' });
    expect(defaultBranding.statusCode).toBe(200);
    expect(defaultBranding.json()).toMatchObject({ systemName: '项目管理', shortName: 'PM', logoUrl: null });
    expect((await app.inject({ method: 'GET', url: '/api/system/overview' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/system/database-check' })).statusCode).toBe(401);

    expect((await app.inject({ method: 'POST', url: '/api/people', headers: { cookie }, payload: { name: '系统检查普通用户', jobTitle: '测试工程师' } })).statusCode).toBe(200);
    const memberLogin = await app.inject({ method: 'POST', url: '/api/login', payload: { username: '系统检查普通用户', password: '888888' } });
    const memberSetCookie = memberLogin.headers['set-cookie'];
    let memberCookie = (Array.isArray(memberSetCookie) ? memberSetCookie[0] : memberSetCookie!).split(';')[0];
    const changed = await app.inject({ method: 'POST', url: '/api/account/change-password', headers: { cookie: memberCookie }, payload: { currentPassword: '888888', newPassword: 'System-user-2026!' } });
    const changedSetCookie = changed.headers['set-cookie'];
    memberCookie = (Array.isArray(changedSetCookie) ? changedSetCookie[0] : changedSetCookie!).split(';')[0];
    expect((await app.inject({ method: 'GET', url: '/api/system/overview', headers: { cookie: memberCookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/system/database-check', headers: { cookie: memberCookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/api/system/branding', headers: { cookie: memberCookie }, payload: { systemName: '无权修改', shortName: 'NO' } })).statusCode).toBe(403);

    const logoDataUrl = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')}`;
    const updatedBranding = await app.inject({ method: 'PUT', url: '/api/system/branding', headers: { cookie }, payload: {
      systemName: '研发项目管理', shortName: 'RDM', logoDataUrl, expectedUpdatedAt: defaultBranding.json().updatedAt,
    } });
    expect(updatedBranding.statusCode).toBe(200);
    expect(updatedBranding.json()).toEqual(expect.objectContaining({ systemName: '研发项目管理', shortName: 'RDM', logoUrl: expect.stringContaining('/api/branding/logo?v=') }));
    const staleBranding = await app.inject({ method: 'PUT', url: '/api/system/branding', headers: { cookie }, payload: {
      systemName: '旧页面名称', shortName: 'OLD', expectedUpdatedAt: defaultBranding.json().updatedAt,
    } });
    expect(staleBranding.statusCode).toBe(409);
    expect(staleBranding.json()).toMatchObject({ code: 'STALE_WRITE', details: { currentUpdatedAt: updatedBranding.json().updatedAt } });
    expect((await app.inject({ method: 'GET', url: '/api/branding' })).json()).toMatchObject({ systemName: '研发项目管理', shortName: 'RDM' });
    const logo = await app.inject({ method: 'GET', url: '/api/branding/logo' });
    expect(logo.statusCode).toBe(200);
    expect(logo.headers['content-type']).toContain('image/png');
    expect((await app.inject({ method: 'PUT', url: '/api/system/branding', headers: { cookie }, payload: { systemName: '研发项目管理', shortName: 'RDM', logoDataUrl: 'data:image/png;base64,bm90LWltYWdl' } })).statusCode).toBe(400);
    const { sqlite } = await import('../src/server/database');
    const futureUpdatedAt = '2099-01-01T00:00:00.000Z';
    sqlite.prepare("UPDATE system_meta SET updated_at=? WHERE key='system-branding'").run(futureUpdatedAt);
    const removedLogo = await app.inject({ method: 'PUT', url: '/api/system/branding', headers: { cookie }, payload: {
      systemName: '项目管理', shortName: 'PM', logoDataUrl: null, expectedUpdatedAt: futureUpdatedAt,
    } });
    expect(removedLogo.statusCode).toBe(200);
    expect(removedLogo.json()).toMatchObject({ systemName: '项目管理', shortName: 'PM', logoUrl: null });
    expect(removedLogo.json().updatedAt > futureUpdatedAt).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/branding/logo' })).statusCode).toBe(404);

    const overview = await app.inject({ method: 'GET', url: '/api/system/overview', headers: { cookie } });
    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toMatchObject({
      status: 'ok',
      service: { version: '1.0.0', protocol: 'http' },
      database: { journalMode: 'WAL' },
      backups: { count: 0, restorableCount: 0, overdue: true, retentionDays: 30, maxCount: 10 },
    });

    const check = await app.inject({ method: 'POST', url: '/api/system/database-check', headers: { cookie } });
    expect(check.statusCode).toBe(200);
    expect(check.json()).toEqual(expect.objectContaining({ ok: true, checkedAt: expect.any(String), durationMs: expect.any(Number) }));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pragma = vi.spyOn(sqlite, 'pragma').mockImplementationOnce(() => { throw new Error('D:\\private\\database.db is unavailable'); });
    const failedCheck = await app.inject({ method: 'POST', url: '/api/system/database-check', headers: { cookie } });
    expect(failedCheck.statusCode).toBe(200);
    expect(failedCheck.json()).toEqual(expect.objectContaining({ ok: false, message: '数据库完整性检查失败' }));
    expect(failedCheck.body).not.toContain('D:\\private');
    expect(errorLog).toHaveBeenCalled();
    pragma.mockRestore();
    errorLog.mockRestore();
    const brandingAudit = await app.inject({ method: 'GET', url: '/api/audit/search?entityType=system_branding&action=update&pageSize=20', headers: { cookie } });
    expect(brandingAudit.json().items).toEqual(expect.arrayContaining([expect.objectContaining({ entityType: 'system_branding', action: 'update', summary: expect.not.stringContaining('base64') })]));
  });

  it('备份统计准确，恢复准备会校验目标并生成当前数据库安全备份', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/backups', headers: { cookie } });
    expect(created.statusCode).toBe(200);
    const firstBackup = created.json() as { name: string; size: number; createdAt: string; fingerprint: string };
    expect(firstBackup.fingerprint).toMatch(/^[a-f0-9]{64}$/);

    const overview = (await app.inject({ method: 'GET', url: '/api/system/overview', headers: { cookie } })).json();
    expect(overview.backups).toMatchObject({ count: 1, totalSizeBytes: firstBackup.size, lastCreatedAt: firstBackup.createdAt, overdue: false });

    const { prepareRestore, recordRestoreAudit } = await import('../src/server/backups');
    await expect(prepareRestore(firstBackup.name, '0'.repeat(64))).rejects.toMatchObject({ statusCode: 409, code: 'STALE_WRITE' });
    const prepared = await prepareRestore(firstBackup.name, firstBackup.fingerprint);
    expect(prepared.source).toBe(`${dbPath}.restore`);
    expect(fs.existsSync(prepared.source)).toBe(true);
    expect(prepared.safetyBackup.name).not.toBe(firstBackup.name);
    expect(fs.existsSync(path.join(backupDir, prepared.safetyBackup.name))).toBe(true);

    const DatabaseDriver = (await import('better-sqlite3')).default;
    const { sqlite } = await import('../src/server/database');
    const admin = sqlite.prepare("SELECT id FROM accounts WHERE normalized_username='admin'").get() as { id: string };
    const persistedAudit = recordRestoreAudit(prepared.source, {
      actorType: 'user', actorId: admin.id, entityId: 'restore-audit-persistence.db', summary: '恢复审计保留测试',
    });
    expect(sqlite.prepare('SELECT summary FROM audit_logs WHERE id=?').get(persistedAudit.id)).toEqual({ summary: '恢复审计保留测试' });
    const restoredDatabase = new DatabaseDriver(prepared.source);
    expect(restoredDatabase.prepare('SELECT summary FROM audit_logs WHERE id=?').get(persistedAudit.id)).toEqual({ summary: '恢复审计保留测试' });
    restoredDatabase.exec(`CREATE TRIGGER reject_restore_audit BEFORE INSERT ON audit_logs
      WHEN NEW.entity_id='restore-audit-rejected.db' BEGIN SELECT RAISE(ABORT, 'reject restored audit'); END`);
    restoredDatabase.close();
    expect(() => recordRestoreAudit(prepared.source, {
      actorType: 'user', actorId: admin.id, entityId: 'restore-audit-rejected.db', summary: '不应单边写入',
    })).toThrow('reject restored audit');
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE entity_id='restore-audit-rejected.db'").get()).toEqual({ count: 0 });

    const { scheduleRestore } = await import('../src/server/backups');
    const filesBeforeRejectedSchedule = new Set(fs.readdirSync(backupDir));
    await expect(scheduleRestore(firstBackup.name, firstBackup.fingerprint, () => {
      throw new Error('恢复提交前权限已变化');
    })).rejects.toThrow('恢复提交前权限已变化');
    expect(fs.existsSync(`${dbPath}.restore`)).toBe(false);
    expect(new Set(fs.readdirSync(backupDir))).toEqual(filesBeforeRejectedSchedule);

    let backupStarted!: () => void;
    let releaseBackup!: () => void;
    const started = new Promise<void>((resolve) => { backupStarted = resolve; });
    const paused = new Promise<void>((resolve) => { releaseBackup = resolve; });
    const backupSpy = vi.spyOn(sqlite, 'backup').mockImplementationOnce(async () => {
      backupStarted();
      await paused;
      throw new Error('模拟恢复准备失败');
    });
    const firstRestore = scheduleRestore(firstBackup.name);
    await started;
    await expect(scheduleRestore(firstBackup.name)).rejects.toMatchObject({ statusCode: 409, code: 'DEPENDENCY_CONFLICT' });
    releaseBackup();
    await expect(firstRestore).rejects.toThrow('模拟恢复准备失败');
    backupSpy.mockRestore();

    const audit = await app.inject({ method: 'GET', url: '/api/audit/search?entityType=backup&action=create&pageSize=20', headers: { cookie } });
    expect(audit.json().items).toEqual(expect.arrayContaining([expect.objectContaining({ entityId: firstBackup.name, action: 'create' })]));

    fs.writeFileSync(path.join(backupDir, 'project-manage-invalid.db'), 'not a sqlite database');
    const countBeforeInvalidRestore = fs.readdirSync(backupDir).length;
    const invalidRestore = await app.inject({ method: 'POST', url: '/api/backups/restore', headers: { cookie }, payload: { name: 'project-manage-invalid.db' } });
    expect(invalidRestore.statusCode).toBe(400);
    expect(fs.readdirSync(backupDir)).toHaveLength(countBeforeInvalidRestore);

    const EmptyDatabase = DatabaseDriver;
    const emptyName = 'project-manage-empty.db';
    new EmptyDatabase(path.join(backupDir, emptyName)).close();
    const emptyRestore = await app.inject({ method: 'POST', url: '/api/backups/restore', headers: { cookie }, payload: { name: emptyName } });
    expect(emptyRestore.statusCode).toBe(400);
    expect(emptyRestore.json()).toMatchObject({ error: '备份文件不是有效的项目管理数据库' });
    expect(fs.existsSync(`${dbPath}.restore`)).toBe(false);

    const newerName = 'project-manage-newer.db';
    const newerPath = path.join(backupDir, newerName);
    await sqlite.backup(newerPath);
    const newerDatabase = new EmptyDatabase(newerPath);
    newerDatabase.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
      .run('future-version', Number.MAX_SAFE_INTEGER);
    newerDatabase.close();
    const listedBackups = (await app.inject({ method: 'GET', url: '/api/backups', headers: { cookie } })).json() as Array<{
      name: string; createdAt: string; fingerprint: string; restorable: boolean; validationError: string | null;
    }>;
    const newerDescriptor = listedBackups.find((backup) => backup.name === newerName)!;
    expect(listedBackups.find((backup) => backup.name === 'project-manage-invalid.db')).toMatchObject({ restorable: false, validationError: '备份数据库文件无效' });
    expect(listedBackups.find((backup) => backup.name === emptyName)).toMatchObject({ restorable: false, validationError: '备份文件不是有效的项目管理数据库' });
    expect(newerDescriptor).toMatchObject({ restorable: false, validationError: '备份由更高版本系统创建，当前版本不能恢复' });
    const restorableBackups = listedBackups.filter((backup) => backup.restorable);
    const overviewWithInvalidFiles = (await app.inject({ method: 'GET', url: '/api/system/overview', headers: { cookie } })).json();
    expect(overviewWithInvalidFiles.backups).toMatchObject({
      count: listedBackups.length,
      restorableCount: restorableBackups.length,
      lastCreatedAt: restorableBackups[0].createdAt,
      overdue: false,
    });
    const newerRestore = await app.inject({ method: 'POST', url: '/api/backups/restore', headers: { cookie }, payload: {
      name: newerName, expectedFingerprint: newerDescriptor.fingerprint,
    } });
    expect(newerRestore.statusCode).toBe(409);
    expect(newerRestore.json()).toMatchObject({ error: '备份由更高版本系统创建，当前版本不能恢复' });
    expect(fs.existsSync(`${dbPath}.restore`)).toBe(false);
  });

  it('备份删除与恢复拒绝错拼指纹字段且不删除备份', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/backups', headers: { cookie } });
    expect(created.statusCode, created.body).toBe(200);
    const backup = created.json() as { name: string; fingerprint: string };
    const removed = await app.inject({ method: 'DELETE', url: `/api/backups/${encodeURIComponent(backup.name)}`, headers: { cookie }, payload: {
      expectedFingerprint: backup.fingerprint, expected_fingerprint: backup.fingerprint,
    } });
    expect(removed.statusCode, removed.body).toBe(400);
    const listed = (await app.inject({ method: 'GET', url: '/api/backups', headers: { cookie } })).json() as Array<{ name: string }>;
    expect(listed.some((item) => item.name === backup.name)).toBe(true);

    const { backupRestoreInputSchema } = await import('../src/shared/contracts');
    expect(backupRestoreInputSchema.safeParse({
      name: backup.name, expectedFingerprint: backup.fingerprint, expected_fingerprint: backup.fingerprint,
    }).success).toBe(false);
  });

  it('创建备份拒绝无效自定义字段且不生成文件', async () => {
    const before = (await app.inject({ method: 'GET', url: '/api/backups', headers: { cookie } })).json() as Array<{ name: string }>;
    const created = await app.inject({ method: 'POST', url: '/api/backups', headers: { cookie }, payload: {
      name: 'custom-backup.db',
    } });
    expect(created.statusCode, created.body).toBe(400);
    const after = (await app.inject({ method: 'GET', url: '/api/backups', headers: { cookie } })).json() as Array<{ name: string }>;
    expect(after).toEqual(before);
  });

  it('品牌设置拒绝错拼字段且不部分更新', async () => {
    const before = (await app.inject({ method: 'GET', url: '/api/branding' })).json();
    const updated = await app.inject({ method: 'PUT', url: '/api/system/branding', headers: { cookie }, payload: {
      systemName: '错误字段品牌', shortName: 'ERR', expectedUpdatedAt: before.updatedAt, system_name: '另一品牌',
    } });
    expect(updated.statusCode, updated.body).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/branding' })).json()).toEqual(before);
  });

  it('恢复前拒绝会导致服务启动失败的跨项目流程备份', async () => {
    const firstProject = (await app.inject({ method: 'POST', url: '/api/projects', headers: { cookie }, payload: { name: '恢复一致性项目一' } })).json();
    const secondProject = (await app.inject({ method: 'POST', url: '/api/projects', headers: { cookie }, payload: { name: '恢复一致性项目二' } })).json();
    const { sqlite } = await import('../src/server/database');
    const secondDefault = sqlite.prepare('SELECT default_template_id AS id FROM projects WHERE id=?').get(secondProject.id) as { id: string };
    const DatabaseDriver = (await import('better-sqlite3')).default;
    const inconsistentName = 'project-manage-cross-project-template.db';
    const inconsistentPath = path.join(backupDir, inconsistentName);
    await sqlite.backup(inconsistentPath);
    const inconsistent = new DatabaseDriver(inconsistentPath);
    inconsistent.prepare('UPDATE projects SET default_template_id=? WHERE id=?').run(secondDefault.id, firstProject.id);
    inconsistent.close();

    const filesBefore = new Set(fs.readdirSync(backupDir));
    const listed = (await app.inject({ method: 'GET', url: '/api/backups', headers: { cookie } })).json();
    expect(listed.find((backup: { name: string }) => backup.name === inconsistentName)).toMatchObject({
      restorable: false,
      validationError: expect.stringContaining('跨项目流程引用'),
    });
    expect(new Set(fs.readdirSync(backupDir))).toEqual(filesBefore);
    const { prepareRestore } = await import('../src/server/backups');
    await expect(prepareRestore(inconsistentName)).rejects.toMatchObject({
      statusCode: 409,
      code: 'DEPENDENCY_CONFLICT',
      message: expect.stringContaining('跨项目流程引用'),
    });
    expect(new Set(fs.readdirSync(backupDir))).toEqual(filesBefore);
    for (const suffix of ['', '-wal', '-shm', '-journal']) expect(fs.existsSync(`${dbPath}.restore${suffix}`)).toBe(false);
  });

  it('并发备份只执行一个任务，失败后允许重试', async () => {
    const { sqlite } = await import('../src/server/database');
    expect((await app.inject({ method: 'POST', url: '/api/backups', headers: { cookie } })).statusCode).toBe(200);
    let backupStarted!: () => void;
    let releaseBackup!: () => void;
    const started = new Promise<void>((resolve) => { backupStarted = resolve; });
    const paused = new Promise<void>((resolve) => { releaseBackup = resolve; });
    const filesBeforeFailure = new Set(fs.readdirSync(backupDir));
    const backupSpy = vi.spyOn(sqlite, 'backup').mockImplementationOnce(async (destination) => {
      fs.writeFileSync(destination, 'partial backup');
      backupStarted();
      await paused;
      throw new Error('模拟备份失败');
    });

    const first = app.inject({ method: 'POST', url: '/api/backups', headers: { cookie } });
    await started;
    let concurrent;
    let deleteDuringBackup;
    try {
      concurrent = await app.inject({ method: 'POST', url: '/api/backups', headers: { cookie } });
      const visibleDuringBackup = (await app.inject({ method: 'GET', url: '/api/backups', headers: { cookie } })).json();
      expect(new Set(visibleDuringBackup.map((backup: { name: string }) => backup.name)))
        .toEqual(new Set([...filesBeforeFailure].filter((name) => name.endsWith('.db'))));
      const existing = visibleDuringBackup[0];
      deleteDuringBackup = await app.inject({ method: 'DELETE', url: `/api/backups/${encodeURIComponent(existing.name)}`, headers: { cookie }, payload: {
        expectedFingerprint: existing.fingerprint,
      } });
    } finally { releaseBackup(); }
    expect(concurrent.statusCode).toBe(409);
    expect(concurrent.json()).toMatchObject({ code: 'DEPENDENCY_CONFLICT' });
    expect(deleteDuringBackup.statusCode).toBe(409);
    expect(deleteDuringBackup.json()).toMatchObject({ code: 'DEPENDENCY_CONFLICT' });
    expect((await first).statusCode).toBe(500);
    expect(new Set(fs.readdirSync(backupDir))).toEqual(filesBeforeFailure);
    backupSpy.mockRestore();

    const retry = await app.inject({ method: 'POST', url: '/api/backups', headers: { cookie } });
    expect(retry.statusCode, retry.body).toBe(200);
  });

  it('手动备份完成前管理员失权时清理新文件且不记录成功审计', async () => {
    const { sqlite } = await import('../src/server/database');
    const admin = sqlite.prepare("SELECT id FROM accounts WHERE normalized_username='admin'").get() as { id: string };
    const filesBefore = new Set(fs.readdirSync(backupDir));
    const auditsBefore = sqlite.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE entity_type='backup' AND action='create'").get() as { count: number };
    const backupSpy = vi.spyOn(sqlite, 'backup').mockImplementationOnce(async (destination) => {
      fs.writeFileSync(destination, 'temporary backup');
      sqlite.prepare("UPDATE accounts SET global_role='user' WHERE id=?").run(admin.id);
      return { totalPages: 1, remainingPages: 0 };
    });
    try {
      const rejected = await app.inject({ method: 'POST', url: '/api/backups', headers: { cookie } });
      expect(rejected.statusCode).toBe(403);
      expect(new Set(fs.readdirSync(backupDir))).toEqual(filesBefore);
      expect(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE entity_type='backup' AND action='create'").get()).toEqual(auditsBefore);
    } finally {
      sqlite.prepare("UPDATE accounts SET global_role='admin' WHERE id=?").run(admin.id);
      backupSpy.mockRestore();
    }
  });

  it('备份删除审计失败时保留原文件并回滚审计', async () => {
    const { sqlite } = await import('../src/server/database');
    const created = await app.inject({ method: 'POST', url: '/api/backups', headers: { cookie } });
    expect(created.statusCode).toBe(200);
    const backup = created.json() as { name: string; fingerprint: string };
    const target = path.join(backupDir, backup.name);
    expect(fs.existsSync(target)).toBe(true);
    sqlite.exec(`CREATE TEMP TRIGGER reject_backup_delete_audit BEFORE INSERT ON audit_logs
      WHEN NEW.entity_type='backup' AND NEW.entity_id='${backup.name}' AND NEW.action='delete' BEGIN
        SELECT RAISE(ABORT, 'reject backup delete audit');
      END`);
    const rejected = await app.inject({ method: 'DELETE', url: `/api/backups/${encodeURIComponent(backup.name)}`, headers: { cookie }, payload: {
      expectedFingerprint: backup.fingerprint,
    } });
    expect(rejected.statusCode).toBe(500);
    expect(fs.existsSync(target)).toBe(true);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE entity_type='backup' AND entity_id=? AND action='delete'").get(backup.name)).toEqual({ count: 0 });
    sqlite.exec('DROP TRIGGER reject_backup_delete_audit');

    const removed = await app.inject({ method: 'DELETE', url: `/api/backups/${encodeURIComponent(backup.name)}`, headers: { cookie }, payload: {
      expectedFingerprint: backup.fingerprint,
    } });
    expect(removed.statusCode).toBe(200);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('恢复复制或删除审计期间备份被替换时拒绝操作新文件', async () => {
    const createdForRestore = await app.inject({ method: 'POST', url: '/api/backups', headers: { cookie } });
    expect(createdForRestore.statusCode).toBe(200);
    const restoreBackup = createdForRestore.json() as { name: string; fingerprint: string };
    const restorePath = path.join(backupDir, restoreBackup.name);
    const originalCopy = fs.copyFileSync.bind(fs);
    const copySpy = vi.spyOn(fs, 'copyFileSync').mockImplementationOnce((source, destination, mode) => {
      originalCopy(source, destination, mode);
      fs.appendFileSync(restorePath, 'changed-during-copy');
    });
    try {
      const { deleteBackup, prepareRestore } = await import('../src/server/backups');
      await expect(prepareRestore(restoreBackup.name, restoreBackup.fingerprint)).rejects.toMatchObject({
        statusCode: 409, code: 'STALE_WRITE',
      });
      expect(fs.existsSync(`${dbPath}.restore`)).toBe(false);
      expect(fs.existsSync(restorePath)).toBe(true);

      const createdForDelete = await app.inject({ method: 'POST', url: '/api/backups', headers: { cookie } });
      expect(createdForDelete.statusCode).toBe(200);
      const deleteCandidate = createdForDelete.json() as { name: string; fingerprint: string };
      const deletePath = path.join(backupDir, deleteCandidate.name);
      expect(() => deleteBackup(deleteCandidate.name, deleteCandidate.fingerprint, () => {
        fs.appendFileSync(deletePath, 'changed-before-delete');
      })).toThrow(expect.objectContaining({ statusCode: 409, code: 'STALE_WRITE' }));
      expect(fs.existsSync(deletePath)).toBe(true);
      fs.rmSync(deletePath, { force: true });
    } finally {
      copySpy.mockRestore();
      fs.rmSync(restorePath, { force: true });
      for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(`${dbPath}.restore${suffix}`, { force: true });
    }
  });

  it('目录枚举后单个备份消失或变型时仍返回其他正常备份', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/backups', headers: { cookie } });
    expect(created.statusCode).toBe(200);
    const backup = created.json() as { name: string };
    const changedTypeName = `project-manage-became-directory-${randomUUID()}.db`;
    const changedTypePath = path.join(backupDir, changedTypeName);
    fs.mkdirSync(changedTypePath);
    const entries = fs.readdirSync(backupDir, { withFileTypes: true });
    const fakeFile = (name: string) => ({ name, isFile: () => true, isSymbolicLink: () => false }) as fs.Dirent;
    const readdirSpy = vi.spyOn(fs, 'readdirSync');
    readdirSpy.mockReturnValueOnce([
      ...entries,
      fakeFile(`project-manage-vanished-${randomUUID()}.db`),
      fakeFile(changedTypeName),
    ] as never);
    try {
      const { listBackups } = await import('../src/server/backups');
      const listed = listBackups();
      expect(listed.some((item) => item.name === backup.name)).toBe(true);
      expect(listed.some((item) => item.name === changedTypeName)).toBe(false);
    } finally {
      readdirSpy.mockRestore();
      fs.rmSync(changedTypePath, { recursive: true, force: true });
    }
  });

  it('保留策略清理过期的中断备份但保留新近临时文件', async () => {
    const { cleanupOldBackups } = await import('../src/server/backups');
    const oldName = `project-manage-2026-09-01T01-00-00-000.db.partial-${randomUUID()}`;
    const oldMigrationName = `project-manage-pre-migration-2026-09-01T01-00-00-000Z.db.partial-${randomUUID()}`;
    const recentName = `project-manage-2026-09-05T01-00-00-000.db.partial-${randomUUID()}`;
    const oldPath = path.join(backupDir, oldName);
    const oldMigrationPath = path.join(backupDir, oldMigrationName);
    const recentPath = path.join(backupDir, recentName);
    fs.writeFileSync(oldPath, 'orphaned-partial-backup');
    fs.writeFileSync(oldMigrationPath, 'orphaned-pre-migration-backup');
    fs.writeFileSync(recentPath, 'active-or-recent-partial-backup');
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000);
    fs.utimesSync(oldPath, oldTime, oldTime);
    fs.utimesSync(oldMigrationPath, oldTime, oldTime);
    try {
      cleanupOldBackups();
      expect(fs.existsSync(oldPath)).toBe(false);
      expect(fs.existsSync(oldMigrationPath)).toBe(false);
      expect(fs.existsSync(recentPath)).toBe(true);
    } finally {
      fs.rmSync(oldPath, { force: true });
      fs.rmSync(oldMigrationPath, { force: true });
      fs.rmSync(recentPath, { force: true });
    }
  });

  it('自动清理前同名备份发生变化时本轮保留并等待下次重新评估', async () => {
    const { sqlite } = await import('../src/server/database');
    const { cleanupOldBackups } = await import('../src/server/backups');
    const oldName = `project-manage-2000-01-01T00-00-00-${String(Date.now() % 1000).padStart(3, '0')}.db`;
    const oldPath = path.join(backupDir, oldName);
    await sqlite.backup(oldPath);
    let identityChecks = 0;
    const originalExists = fs.existsSync.bind(fs);
    const existsSpy = vi.spyOn(fs, 'existsSync').mockImplementation((candidate) => {
      if (path.resolve(String(candidate)) === path.resolve(oldPath) && ++identityChecks === 2) {
        fs.appendFileSync(oldPath, 'changed-before-retention-delete');
      }
      return originalExists(candidate);
    });
    try {
      cleanupOldBackups();
      expect(identityChecks).toBeGreaterThanOrEqual(2);
      expect(fs.existsSync(oldPath)).toBe(true);
    } finally {
      existsSpy.mockRestore();
    }

    cleanupOldBackups();
    expect(fs.existsSync(oldPath)).toBe(false);
  });

  it('每日自动备份首次失败后在调度窗口内重试且成功后不重复', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 6, 2, 0, 0));
    const { sqlite } = await import('../src/server/database');
    const { startBackupScheduler } = await import('../src/server/backups');
    let attempts = 0;
    const backupSpy = vi.spyOn(sqlite, 'backup').mockImplementation(async (destination) => {
      attempts++;
      if (attempts === 1) throw new Error('模拟首次自动备份失败');
      fs.writeFileSync(destination, 'scheduled-backup');
      return { totalPages: 1, remainingPages: 0 };
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const timer = startBackupScheduler();
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toBe(1);
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
      expect(attempts).toBe(2);
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      expect(attempts).toBe(2);
      expect(errorLog).toHaveBeenCalledWith('自动备份失败', expect.any(Error));
    } finally {
      clearInterval(timer);
      backupSpy.mockRestore();
      errorLog.mockRestore();
      vi.useRealTimers();
    }
  });

  it('服务晚于调度时间启动会补建当天备份，已有当天备份时不重复', async () => {
    const { sqlite } = await import('../src/server/database');
    const { startBackupScheduler } = await import('../src/server/backups');
    const existingName = 'project-manage-2026-09-08T02-10-00-000.db';
    await sqlite.backup(path.join(backupDir, existingName));
    vi.useFakeTimers();
    let attempts = 0;
    const backupSpy = vi.spyOn(sqlite, 'backup').mockImplementation(async (destination) => {
      attempts++;
      fs.writeFileSync(destination, 'scheduled-catch-up');
      return { totalPages: 1, remainingPages: 0 };
    });
    let firstTimer: ReturnType<typeof setInterval> | undefined;
    let secondTimer: ReturnType<typeof setInterval> | undefined;
    try {
      vi.setSystemTime(new Date(2026, 8, 8, 2, 30, 0));
      firstTimer = startBackupScheduler();
      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toBe(0);
      clearInterval(firstTimer);
      firstTimer = undefined;

      vi.setSystemTime(new Date(2026, 8, 9, 9, 0, 0));
      secondTimer = startBackupScheduler();
      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toBe(1);
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
      expect(attempts).toBe(1);
    } finally {
      if (firstTimer) clearInterval(firstTimer);
      if (secondTimer) clearInterval(secondTimer);
      backupSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('启动时旧备份清理失败不会阻止调度器后续创建备份', async () => {
    const { sqlite } = await import('../src/server/database');
    const { startBackupScheduler } = await import('../src/server/backups');
    const oldName = 'project-manage-2000-01-01T00-00-00-001.db';
    const oldPath = path.join(backupDir, oldName);
    await sqlite.backup(oldPath);
    const originalUnlink = fs.unlinkSync.bind(fs);
    let rejectOldCleanup = true;
    const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation((candidate) => {
      if (rejectOldCleanup && path.resolve(String(candidate)) === path.resolve(oldPath)) {
        throw Object.assign(new Error('模拟备份文件被占用'), { code: 'EPERM' });
      }
      return originalUnlink(candidate);
    });
    let attempts = 0;
    const backupSpy = vi.spyOn(sqlite, 'backup').mockImplementation(async (destination) => {
      attempts++;
      fs.writeFileSync(destination, 'scheduled-after-cleanup-error');
      return { totalPages: 1, remainingPages: 0 };
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 10, 1, 55, 0));
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      expect(() => { timer = startBackupScheduler(); }).not.toThrow();
      expect(errorLog).toHaveBeenCalledWith('启动时清理过期数据库备份失败', expect.any(Error));
      expect(attempts).toBe(0);
      rejectOldCleanup = false;
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
      expect(attempts).toBe(1);
    } finally {
      if (timer) clearInterval(timer);
      vi.useRealTimers();
      errorLog.mockRestore();
      backupSpy.mockRestore();
      unlinkSpy.mockRestore();
      fs.rmSync(oldPath, { force: true });
    }
  });

  it('手动备份写入中不会被当作当天成功，失败后调度器继续补偿', async () => {
    const { sqlite } = await import('../src/server/database');
    const { createBackup, startBackupScheduler, listBackups } = await import('../src/server/backups');
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 11, 2, 5, 0));
    let markManualStarted!: () => void;
    let releaseManual!: () => void;
    const manualStarted = new Promise<void>((resolve) => { markManualStarted = resolve; });
    const manualPaused = new Promise<void>((resolve) => { releaseManual = resolve; });
    let attempts = 0;
    const backupSpy = vi.spyOn(sqlite, 'backup').mockImplementation(async (destination) => {
      attempts++;
      fs.writeFileSync(destination, attempts === 1 ? 'partial-manual-backup' : 'scheduled-compensation');
      if (attempts === 1) {
        markManualStarted();
        await manualPaused;
        throw new Error('模拟手动备份失败');
      }
      return { totalPages: 1, remainingPages: 0 };
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let timer: ReturnType<typeof setInterval> | undefined;
    const manualBackup = createBackup({ cleanup: false });
    try {
      await manualStarted;
      timer = startBackupScheduler();
      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toBe(1);

      releaseManual();
      await expect(manualBackup).rejects.toThrow('模拟手动备份失败');
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
      expect(attempts).toBe(2);
      expect(listBackups().some((backup) => backup.name.startsWith('project-manage-2026-09-11T'))).toBe(true);

      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
      expect(attempts).toBe(2);
    } finally {
      releaseManual();
      await manualBackup.catch(() => undefined);
      if (timer) clearInterval(timer);
      errorLog.mockRestore();
      backupSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('服务重启后不会把当天遗留的无效备份文件当作成功', async () => {
    const invalidName = 'project-manage-2026-09-12T02-01-00-000.db';
    fs.writeFileSync(path.join(backupDir, invalidName), 'interrupted-backup');
    const { sqlite } = await import('../src/server/database');
    const { startBackupScheduler } = await import('../src/server/backups');
    let attempts = 0;
    const backupSpy = vi.spyOn(sqlite, 'backup').mockImplementation(async (destination) => {
      attempts++;
      fs.writeFileSync(destination, 'scheduled-after-invalid-backup');
      return { totalPages: 1, remainingPages: 0 };
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 12, 3, 0, 0));
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      timer = startBackupScheduler();
      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toBe(1);
    } finally {
      if (timer) clearInterval(timer);
      vi.useRealTimers();
      backupSpy.mockRestore();
      fs.rmSync(path.join(backupDir, invalidName), { force: true });
    }
  });
});
