import type { FastifyInstance } from 'fastify';
import { registerIntakeRoutes } from './intake-api';
import { requireReady } from './http/context';
export { requireReady } from './http/context';
import { registerSystemRoutes } from './http/system';
import { registerAccountsRoutes } from './http/accounts';
import { registerPeopleRoutes } from './http/people';
import { registerProjectsRoutes } from './http/projects';
import { registerReportingRoutes } from './http/reporting';
import { registerRequirementsRoutes } from './http/requirements';
import { registerWorkItemsRoutes } from './http/work-items';
import { registerProgressRoutes } from './http/progress';
import { registerIssuesRoutes } from './http/issues';
import { registerTemplatesRoutes } from './http/templates';
import { registerArchivesRoutes } from './http/archives';
import { registerTokensRoutes } from './http/tokens';
import { registerAdminRoutes } from './http/admin';
import { registerAuditRoutes } from './http/audit';
import { registerJiraRoutes } from './http/jira';

export function registerApiRoutes(app: FastifyInstance) {
  registerIntakeRoutes(app,requireReady);
  app.decorateRequest('actor', null);
  registerSystemRoutes(app);
  registerAccountsRoutes(app);
  registerPeopleRoutes(app);
  registerProjectsRoutes(app);
  registerReportingRoutes(app);
  registerRequirementsRoutes(app);
  registerWorkItemsRoutes(app);
  registerProgressRoutes(app);
  registerIssuesRoutes(app);
  registerTemplatesRoutes(app);
  registerArchivesRoutes(app);
  registerTokensRoutes(app);
  registerAdminRoutes(app);
  registerAuditRoutes(app);
  registerJiraRoutes(app);
}
