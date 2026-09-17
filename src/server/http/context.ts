

import type { FastifyReply, FastifyRequest } from 'fastify';
import { z, type ZodType } from 'zod';

import { getDatabaseContext } from "../database-context";

import { createSessionToken } from "../auth";
import { actorFromRequest, assertAdmin, isAdmin, managedProjectIds, sessionActor } from "../authorization";

import { idParamsSchema } from "../../shared/contracts";
export const recordSchema = z.record(z.string(), z.unknown());

export const auditSearchQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  actorType: z.string().trim().max(50).optional(),
  action: z.string().trim().max(100).optional(),
  entityType: z.string().trim().max(100).optional(),
  projectId: z.string().trim().min(1).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(20).max(100).default(50),
  snapshot: z.coerce.number().int().nonnegative().optional(),
}).strict().refine((input) => !input.from || !input.to || input.from <= input.to, { message: '开始日期不能晚于结束日期', path: ['to'] });

export function parse<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value ?? {});
}

export function params<T>(request: FastifyRequest, schema: ZodType<T>) {
  return parse(schema, request.params);
}

export function idOf(request: FastifyRequest) {
  return params(request, idParamsSchema).id;
}

export function sessionOf(request: FastifyRequest) {
  return sessionActor(request.cookies[getDatabaseContext().config.sessionCookieName]);
}

export function body(request: FastifyRequest) {
  return parse(recordSchema, request.body);
}

export function parsedBody<T>(request: FastifyRequest, schema: ZodType<T>) {
  return parse(schema, request.body);
}

export function parsedQuery<T>(request: FastifyRequest, schema: ZodType<T>) {
  return parse(schema, request.query);
}

export async function requireAuthenticated(request: FastifyRequest, reply: FastifyReply) {
  request.actor = sessionOf(request);
  if (!request.actor) return reply.code(401).send({ error: '请先登录' });
}

export async function requireReady(request: FastifyRequest, reply: FastifyReply) {
  await requireAuthenticated(request, reply);
  if (reply.sent) return;
  if (request.actor?.mustChangePassword) return reply.code(403).send({ error: '请先修改初始密码', code: 'PASSWORD_CHANGE_REQUIRED' });
  if (/\/(?:accept|submit-acceptance|block|unblock|dependency-review|start-conditions)(?:\?|$)|\/requirement-source|\/delivery-commitments/.test(request.url)) return reply.code(410).send({error:'此工作流已移除。请使用需求、工作项、计划和进展操作。',code:'WORKFLOW_RETIRED'});
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  await requireReady(request, reply);
  if (reply.sent) return;
  assertAdmin(actorFromRequest(request));
}

export function sessionPayload(actor: ReturnType<typeof sessionOf>) {
  if (!actor) return { authenticated: false, username: null, httpWarning: true, role: 'guest', globalRole: 'guest', personId: null, mustChangePassword: false, managedProjectIds: [] };
  const projects = managedProjectIds(actor);
  return {
    authenticated: true, accountId: actor.accountId, username: actor.label, httpWarning: true,
    globalRole: actor.globalRole, role: isAdmin(actor) ? 'admin' : projects.length ? 'project_manager' : 'user',
    personId: actor.personId, mustChangePassword: actor.mustChangePassword, managedProjectIds: projects,
  };
}

export function setSessionCookie(reply: FastifyReply, accountId: string, sessionVersion: number) {
  const {config}=getDatabaseContext();
  reply.setCookie(config.sessionCookieName, createSessionToken(accountId, sessionVersion), {
    httpOnly: true, sameSite: 'strict', secure: false, path: '/', maxAge: config.sessionHours * 60 * 60,
  });
}
