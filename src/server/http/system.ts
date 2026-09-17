

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { config } from "../config";
import { fail } from "../errors";

import { actorFromRequest, assertAdmin, requireAuthorizationActor } from "../authorization";

import { recordAudit } from "../services/audit";
import { createBackup, deleteBackup, importBackup, openBackupDownload, listRestorableBackups, recordRestoreAudit, scheduleRestore } from "../backups";
import { Readable } from 'node:stream';

import { checkDatabaseIntegrity, getSystemOverview } from "../system";
import { getBranding, getBrandingLogo, updateBranding } from "../branding";

import { backupDeleteInputSchema, backupRestoreInputSchema, brandingInputSchema, emptyCommandInputSchema } from "../../shared/contracts";
import { params, parsedBody, parsedQuery, requireAdmin } from './context';

export function registerSystemRoutes(app: FastifyInstance) {
  app.get('/api/branding', async () => getBranding());

  app.get('/api/branding/logo', async (_request, reply) => {
    const logo = getBrandingLogo();
    if (!logo) return reply.code(404).send({ error: '尚未配置系统Logo' });
    return reply
      .type(logo.mimeType)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(logo.content);
  });

  app.get('/api/system/overview', { preHandler: requireAdmin }, async () => getSystemOverview());

  app.post('/api/system/database-check', { preHandler: requireAdmin }, async (request) => {
    parsedBody(request, emptyCommandInputSchema);
    return checkDatabaseIntegrity();
  });

  app.put('/api/system/branding', { preHandler: requireAdmin }, async (request) => {
    const actor = actorFromRequest(request);
    return updateBranding(parsedBody(request, brandingInputSchema), actor);
  });

  app.get('/api/backups', { preHandler: requireAdmin }, async () => listRestorableBackups());

  app.get('/api/backups/:name/download', { preHandler: requireAdmin }, async (request, reply) => {
    const { name } = params(request, z.object({ name: z.string().min(1) }).strict());
    const { expectedFingerprint } = parsedQuery(request, z.object({ expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict());
    const download = openBackupDownload(name, expectedFingerprint);
    try {
      recordAudit(actorFromRequest(request), 'download', 'backup', name, `下载数据库备份：${name}`);
      return reply.type('application/vnd.sqlite3')
        .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name).replace(/'/g, '%27')}`)
        .header('Content-Length', download.size).header('Cache-Control', 'no-store')
        .header('X-Content-Type-Options', 'nosniff').send(download.stream);
    } catch (error) { download.stream.destroy(); throw error; }
  });

  app.register((uploads, _options, done) => {
    uploads.addContentTypeParser('application/octet-stream', (_request, payload, parsed) => parsed(null, payload));
    uploads.post('/api/backups/import', { onRequest: requireAdmin }, async (request, reply) => {
      const { filename } = parsedQuery(request, z.object({ filename: z.string().min(1).max(255) }).strict());
      if (!(request.body instanceof Readable)) fail('请上传二进制数据库文件');
      if (Number(request.headers['content-length']) > config.databaseImportMaxBytes) {
        fail(`数据库文件不能超过 ${config.databaseImportMaxBytes / 1024 / 1024} MB`, 'VALIDATION_ERROR', 413);
      }
      const actor = actorFromRequest(request);
      const backup = await importBackup(request.body, filename, (result) => {
        assertAdmin(requireAuthorizationActor(actor));
        recordAudit(actor, 'upload', 'backup', result.name, `上传数据库备份：${filename}`);
      });
      return reply.header('Cache-Control', 'no-store').send(backup);
    });
    done();
  });

  app.post('/api/backups/import/restore', { preHandler: requireAdmin }, async (request) => {
    const input = parsedBody(request, backupRestoreInputSchema.extend({ expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/) }));
    const actor = actorFromRequest(request);
    return scheduleRestore(input.name, input.expectedFingerprint, (safetyBackup, replacement) => {
      assertAdmin(requireAuthorizationActor(actor));
      recordRestoreAudit(replacement, {
        actorType: 'user', actorId: actor.id, entityId: input.name,
        summary: `导入数据库：${input.name}；导入前备份：${safetyBackup.name}；admin 使用本机配置密码`,
      });
    }, { importDatabase: true });
  });

  app.post('/api/backups', { preHandler: requireAdmin }, async (request) => {
    parsedBody(request, emptyCommandInputSchema);
    const actor = actorFromRequest(request);
    return createBackup({ beforeCommit: (backup) => {
      assertAdmin(requireAuthorizationActor(actor));
      recordAudit(actor, 'create', 'backup', backup.name, `创建数据库备份：${backup.name}`);
    } });
  });

  app.delete('/api/backups/:name', { preHandler: requireAdmin }, async (request) => {
    const { name } = params(request, z.object({ name: z.string().min(1) }).strict()); const actor = actorFromRequest(request);
    const input = parsedBody(request, backupDeleteInputSchema);
    return deleteBackup(name, input.expectedFingerprint, () => {
      assertAdmin(requireAuthorizationActor(actor));
      recordAudit(actor, 'delete', 'backup', name, `删除数据库备份：${name}`);
    });
  });

  app.post('/api/backups/restore', { preHandler: requireAdmin }, async (request) => {
    const input = parsedBody(request, backupRestoreInputSchema); const actor = actorFromRequest(request);
    return scheduleRestore(input.name, input.expectedFingerprint, (safetyBackup, replacement) => {
      assertAdmin(requireAuthorizationActor(actor));
      recordRestoreAudit(replacement, {
        actorType: 'user',
        actorId: actor.id,
        entityId: input.name,
        summary: `恢复数据库备份：${input.name}；恢复前备份：${safetyBackup.name}`,
      });
    });
  });
}
