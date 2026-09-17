import { recordLogReason, updateLogContext } from "../log-context";

import type { FastifyInstance } from 'fastify';

import { config } from "../config";
import { getDatabaseContext } from "../database-context";

import { createSessionToken, verifyPassword } from "../auth";
import { actorFromRequest, sessionActor } from "../authorization";
import { changeOwnPassword, deleteAccount, findAccountForLogin, getMyWork, listAccounts, markLogin, resetAccountPassword, updateAccount } from "../accounts";

import { accountCommandSchema, accountInputSchema, changePasswordInputSchema, emptyCommandInputSchema, loginInputSchema } from "../../shared/contracts";
import { idOf, sessionOf, parsedBody, requireAuthenticated, requireReady, requireAdmin, sessionPayload, setSessionCookie } from './context';

export function registerAccountsRoutes(app: FastifyInstance) {
  app.get('/api/session', async (request, reply) => {
    const actor=sessionOf(request);
    const {sessionCookieName}=getDatabaseContext().config;
    if(!actor&&request.cookies[sessionCookieName])reply.clearCookie(sessionCookieName,{path:'/'});
    return sessionPayload(actor);
  });

  app.post('/api/login', { config: { rateLimit: { max: config.nodeEnv === 'test' ? 100 : 8, timeWindow: '1 minute' } } }, async (request, reply) => {
    const input = parsedBody(request, loginInputSchema); const account = findAccountForLogin(input.username);
    updateLogContext({ attemptedUser: input.username.slice(0, 120), authMethod: 'password' });
    if (!account || !verifyPassword(input.password, account.passwordHash)) {
      recordLogReason('LOGIN_CREDENTIALS_INVALID', '用户名或密码错误'); return reply.code(401).send({ error: '用户名或密码错误' });
    }
    if (account.status !== 'active') { recordLogReason('ACCOUNT_DISABLED', '账号已停用，请联系管理员'); return reply.code(403).send({ error: '账号已停用，请联系管理员' }); }
    if (!account.personAvailable) { recordLogReason('PERSON_UNAVAILABLE', '人员已停用或归档，请联系管理员恢复人员'); return reply.code(403).send({ error: '人员已停用或归档，请联系管理员恢复人员' }); }
    if (!markLogin(account.id, account.sessionVersion, account.passwordHash)) {
      return reply.code(409).send({ error: '账号状态已变化，请重新登录', code: 'STALE_WRITE' });
    }
    const token = createSessionToken(account.id, account.sessionVersion);
    const actor = sessionActor(token);
    if (!actor) return reply.code(409).send({ error: '账号状态已变化，请重新登录', code: 'STALE_WRITE' });
    updateLogContext({ authMethod: 'password', attemptedUser: undefined });
    setSessionCookie(reply, account.id, account.sessionVersion);
    return sessionPayload(actor);
  });

  app.post('/api/logout', async (request, reply) => {
    parsedBody(request, emptyCommandInputSchema);
    sessionOf(request);
    reply.clearCookie(getDatabaseContext().config.sessionCookieName, { path: '/' });
    return { ok: true };
  });

  app.post('/api/account/change-password', { preHandler: requireAuthenticated }, async (request, reply) => {
    const actor = actorFromRequest(request); const input = parsedBody(request, changePasswordInputSchema);
    const result = changeOwnPassword(actor.accountId, input.currentPassword, input.newPassword, actor);
    setSessionCookie(reply, actor.accountId, result.sessionVersion);
    return { ...result, session: sessionPayload(sessionActor(createSessionToken(actor.accountId, result.sessionVersion))) };
  });

  app.get('/api/accounts', { preHandler: requireAdmin }, async () => listAccounts());

  app.patch('/api/accounts/:id', { preHandler: requireAdmin }, async (request) => updateAccount(idOf(request), parsedBody(request, accountInputSchema), actorFromRequest(request)));

  app.post('/api/accounts/:id/reset-password', { preHandler: requireAdmin }, async (request) => resetAccountPassword(idOf(request), parsedBody(request, accountCommandSchema), actorFromRequest(request)));

  app.delete('/api/accounts/:id', { preHandler: requireAdmin }, async (request) => deleteAccount(idOf(request), parsedBody(request, accountCommandSchema), actorFromRequest(request)));

  app.get('/api/my-work', { preHandler: requireReady }, async (request) => getMyWork(actorFromRequest(request).accountId));
}
