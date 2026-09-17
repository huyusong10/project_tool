
import { requireWorkspaceRead } from "../workspace-access";

import type { FastifyInstance } from 'fastify';

import { todayIso } from "../../shared/domain";

import { actorFromRequest, assertAdmin, assertProjectReadable, canManageProject } from "../authorization";

import { getDashboard, getPeopleConcurrency } from "../services/reporting";

import { listActionItems } from "../services/actions";

import { getAnalyticsCatalog, getAnalyticsLayout, queryAnalytics, resetAnalyticsLayout, saveAnalyticsLayout } from "../analytics";
import { analyticsQueryInputSchema, actionItemsInputSchema, peopleConcurrencyInputSchema, projectScopeInputSchema } from "../../shared/contracts";
import { body, parsedBody, parsedQuery, requireReady } from './context';

export function registerReportingRoutes(app: FastifyInstance) {
  app.get('/api/dashboard', { preHandler: requireWorkspaceRead }, async (request) => {
    const { projectId } = parsedQuery(request, projectScopeInputSchema); const actor = actorFromRequest(request); assertProjectReadable(actor, projectId);
    const asOfDate = todayIso();
    const dashboard = getDashboard(projectId, asOfDate);
    if (actor.type === 'guest') {
      const { issues: _issues, ...publicDashboard } = dashboard;
      return { ...publicDashboard, requirements: dashboard.requirements.map(({issueSummary: _summary, ...requirement}) => requirement) };
    }
    return { ...dashboard, actions: listActionItems({ projectId, page: 1, pageSize: 5 }, actor, dashboard.requirements, asOfDate) };
  });

  app.get('/api/action-items', { preHandler: requireReady }, async (request) => {
    const input = parsedQuery(request, actionItemsInputSchema); const actor = actorFromRequest(request);
    assertProjectReadable(actor, input.projectId);
    return listActionItems(input, actor);
  });

  app.get('/api/analytics/catalog', async () => getAnalyticsCatalog());

  app.post('/api/analytics/query', { preHandler: requireReady }, async (request) => {
    const input = parsedBody(request, analyticsQueryInputSchema); assertProjectReadable(actorFromRequest(request), input.projectId);
    return queryAnalytics(input);
  });

  app.get('/api/analytics/layout', { preHandler: requireReady }, async (request) => {
    const actor = actorFromRequest(request);
    return getAnalyticsLayout(actor.accountId, true);
  });

  app.put('/api/analytics/layout', { preHandler: requireReady }, async (request) => {
    const actor = actorFromRequest(request);
    return saveAnalyticsLayout(actor.accountId, body(request), actor);
  });

  app.delete('/api/analytics/layout', { preHandler: requireReady }, async (request) => {
    const actor = actorFromRequest(request);
    return resetAnalyticsLayout(actor.accountId, body(request), actor);
  });

  app.get('/api/analytics/people-concurrency', { preHandler: requireReady }, async (request) => {
    const input = parsedQuery(request, peopleConcurrencyInputSchema); const actor = actorFromRequest(request); const projectId = input.projectId || '';
    if (projectId) assertProjectReadable(actor, projectId); else assertAdmin(actor);
    return getPeopleConcurrency({ ...input, projectId: projectId || undefined, includeExternalAggregate: Boolean(projectId && canManageProject(actor, projectId)) });
  });
}
