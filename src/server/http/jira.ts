import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { jiraIssueKeySchema, jiraSettingsSchema, jiraTransitionInputSchema, jiraMetadataQuerySchema } from '../../shared/jira';
import { readJiraMetadata } from '../services/jira-metadata';
import { actorFromRequest, assertProjectReadable, requireAuthorizationActor } from '../authorization';
import { connectionStatus, verifyAndSaveJiraConnection, removeJiraConnection, testJiraConnection, jiraSession } from '../services/jira-connection';
import { bindJira, confirmJiraImport, ignoreJira, jiraSettings, latestScan, previewJiraImport, projectBindings, requirementFacts, requireJiraEnabled, saveJiraSettings, scanJira, unbindJira } from '../services/jira-scan';
import { executeJiraAction, listJiraActions, previewJiraAction, readJiraAction, recheckJiraAction, rejectLegacyJiraSync, jiraTransitionOptions } from '../services/jira-sync';
import { jiraProgress, refreshJiraProgress } from '../services/jira-progress';
import { parsedBody, parsedQuery, requireReady } from './context';
import { prEditSchema, prGenerateSchema, prRecheckSchema, prVersionSchema, prTargetSchema } from '../../shared/jira-pr';
import { previewPrTarget } from '../services/jira-pr-planning';
import { closePr, listPrs, prCandidates, readPr, setProgressSyncState } from '../services/jira-pr-store';
import { addPrRequirement, applyPrGeneration, previewPrGeneration, prComments, prRemote, regeneratePrComment, savePr } from '../services/jira-pr-drafts';
import { executePr, preparePr, readPrPreview, recheckPr, stopPr } from '../services/jira-pr-execution';
import { confirmManualSync, previewManualSync } from '../services/jira-pr-manual';

const id = z.string().min(1).max(200);
function project(request: FastifyRequest) { return z.object({ projectId: id }).parse(request.params).projectId; }
function operation(request: FastifyRequest) { return z.object({ id }).parse(request.params).id; }
export function registerJiraRoutes(app: FastifyInstance) {
  const options = { preHandler: requireReady, onSend: async (_r: FastifyRequest, reply: FastifyReply) => { reply.header('Cache-Control', 'private, no-store'); } };
  const personalOptions = { preHandler: requireReady, onSend: async (_r: FastifyRequest, reply: FastifyReply) => { reply.header('Cache-Control', 'private, no-store'); } };
  app.get('/api/me/jira-connection', personalOptions, async r => connectionStatus(actorFromRequest(r)));
  app.put('/api/me/jira-connection', personalOptions, async r => {
    const { token } = parsedBody(r, z.object({ token: z.string().trim().min(1).max(4096).regex(/^\S+$/) }).strict());
    const actor = actorFromRequest(r);
    await verifyAndSaveJiraConnection(actor, token);
    return connectionStatus(actor);
  });
  app.delete('/api/me/jira-connection', personalOptions, async r => removeJiraConnection(actorFromRequest(r)));
  app.post('/api/me/jira-connection/test', personalOptions, async r => testJiraConnection(actorFromRequest(r)));
  const root = '/api/projects/:projectId/jira';
  const prs = root + '/prs';
  app.get(prs, options, async r => listPrs(project(r), actorFromRequest(r)));
  app.get(prs + '/candidates', options, async r => prCandidates(project(r), actorFromRequest(r)));
  const manualScope = z.object({ ids: z.array(id).min(1).max(10000), restore: z.boolean().optional() });
  app.post(prs + '/manual-sync-preview', options, async r => { const i = parsedBody(r, manualScope.strict()); return previewManualSync(project(r), actorFromRequest(r), i.ids, i.restore); });
  app.post(prs + '/manual-sync', options, async r => confirmManualSync(project(r), actorFromRequest(r), parsedBody(r, manualScope.extend({ version: z.string().length(64), reason: z.string().trim().min(1).max(2000), url: z.string().max(2000).refine(s => !s || /^https?:\/\//i.test(s) && URL.canParse(s)).optional() }).strict())));
  app.put(prs + '/progress-state', options, async r => { const input = parsedBody(r, z.object({ ids: z.array(id).min(1), ignored: z.boolean() }).strict()); return setProgressSyncState(project(r), actorFromRequest(r), input.ids, input.ignored); });
  app.post(prs + '/generate-preview', options, async r => { const i = parsedBody(r, prGenerateSchema); return previewPrGeneration(project(r), actorFromRequest(r), i.scope, i.prId, i.version); });
  app.post(prs + '/generations/:id/apply', options, async r => applyPrGeneration(project(r), actorFromRequest(r), operation(r)));
  app.get(prs + '/remote/:id', options, async r => prRemote(project(r), actorFromRequest(r), operation(r)));
  app.get(prs + '/comments/:id', options, async r => prComments(project(r), actorFromRequest(r), operation(r), parsedQuery(r, z.object({ startAt: z.coerce.number().int().nonnegative().default(0) })).startAt));
  app.get(prs + '/receipts/:id', options, async r => readPrPreview(project(r), actorFromRequest(r), operation(r)));
  app.get(prs + '/:id', options, async r => readPr(project(r), actorFromRequest(r), operation(r)));
  app.put(prs + '/:id', options, async r => savePr(project(r), actorFromRequest(r), operation(r), parsedBody(r, prEditSchema)));
  app.post(prs + '/:id/items', options, async r => { const i = parsedBody(r, prVersionSchema.extend({ requirementId: id })); return addPrRequirement(project(r), actorFromRequest(r), operation(r), i.version, i.requirementId); });
  app.post(prs + '/:id/target-preview', options, async r => previewPrTarget(project(r), actorFromRequest(r), operation(r), parsedBody(r, prTargetSchema)));
  app.post(prs + '/:id/comment-preview', options, async r => { const i = parsedBody(r, z.object({ requirementId: id, sourceIds: z.array(id), target: z.object({ id, name: z.string() }).nullable().optional() }).strict()); return regeneratePrComment(project(r), actorFromRequest(r), operation(r), i.requirementId, i.sourceIds, i.target); });
  app.post(prs + '/:id/prepare', options, async r => preparePr(project(r), actorFromRequest(r), operation(r), parsedBody(r, prVersionSchema).version));
  app.post(prs + '/:id/execute', options, async r => executePr(project(r), actorFromRequest(r), operation(r), parsedBody(r, z.object({ previewId: id }).strict()).previewId));
  app.post(prs + '/:id/stop', options, async r => stopPr(project(r), actorFromRequest(r), operation(r)));
  app.post(prs + '/:id/recheck', options, async r => recheckPr(project(r), actorFromRequest(r), operation(r), parsedBody(r, prRecheckSchema)));
  app.post(prs + '/:id/close', options, async r => closePr(project(r), actorFromRequest(r), operation(r), parsedBody(r, prVersionSchema).version));
  app.get(root + '/metadata', options, async (r, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return readJiraMetadata(project(r), actorFromRequest(r), parsedQuery(r, jiraMetadataQuerySchema));
  });
  app.get(root + '/settings', options, async r => jiraSettings(project(r), actorFromRequest(r)));
  app.get(root + '/progress', options, async r => jiraProgress(project(r), actorFromRequest(r)));
  app.get(root + '/requirements/:id/link', options, async r => {
    const projectId = project(r), requirementId = operation(r);
    assertProjectReadable(requireAuthorizationActor(actorFromRequest(r)), projectId); requirementFacts(requirementId, projectId);
    const binding = projectBindings(projectId).find(b => b.requirement_id === requirementId);
    return binding ? { key: binding.issue_key, url: binding.site + '/browse/' + binding.issue_key } : null;
  });
  app.get(root + '/requirements/:id', options, async r => {
    const rows = jiraProgress(project(r), actorFromRequest(r)).rows;
    return rows.find(row => row.requirementId === operation(r)) || null;
  });
  app.post(root + '/progress/refresh', options, async r => refreshJiraProgress(project(r), actorFromRequest(r), parsedBody(r, z.object({ id: id.optional(), offset: z.number().int().nonnegative().optional(), requirementId: id.optional() }).strict())));
  app.get(root + '/requirements/:id/transitions', options, async r => jiraTransitionOptions(project(r), actorFromRequest(r), operation(r)));
  app.post(root + '/action-preview', options, async r => previewJiraAction(project(r), actorFromRequest(r), parsedBody(r, jiraTransitionInputSchema)));
  app.get(root + '/operations', options, async r => listJiraActions(project(r), actorFromRequest(r)));
  app.get(root + '/operations/:id', options, async r => readJiraAction(project(r), actorFromRequest(r), operation(r)));
  app.post(root + '/operations/:id/execute', options, async r => executeJiraAction(project(r), actorFromRequest(r), operation(r)));
  app.post(root + '/operations/:id/recheck', options, async r => recheckJiraAction(project(r), actorFromRequest(r), operation(r), parsedBody(r, z.object({ acknowledge: z.boolean().default(false) }).strict()).acknowledge));
  app.put(root + '/settings', options, async r => {
    const input = parsedBody(r, z.object({ expectedVersion: z.number().int().min(0), settings: jiraSettingsSchema }).strict());
    return saveJiraSettings(project(r), actorFromRequest(r), input.expectedVersion, input.settings);
  });
  app.post(root + '/scan', options, async r => { const input = parsedBody(r, z.object({ startAt: z.number().int().nonnegative().default(0), previousId: id.optional() }).strict()); return scanJira(project(r), actorFromRequest(r), input.startAt, input.previousId); });
  app.get(root + '/scan', options, async r => latestScan(project(r), actorFromRequest(r)));
  app.post(root + '/bindings', options, async r => { const i = parsedBody(r, z.object({ requirementId: id, key: jiraIssueKeySchema }).strict()); return bindJira(project(r), actorFromRequest(r), i.requirementId, i.key); });
  app.delete(root + '/bindings/:id', options, async r => unbindJira(project(r), actorFromRequest(r), operation(r)));
  app.put(root + '/ignored', options, async r => { const i = parsedBody(r, z.object({ key: jiraIssueKeySchema, ignored: z.boolean() }).strict()); return ignoreJira(project(r), actorFromRequest(r), i.key, i.ignored); });
  app.post(root + '/import-preview', options, async r => previewJiraImport(project(r), actorFromRequest(r), parsedBody(r, z.object({ key: jiraIssueKeySchema }).strict()).key));
  app.post(root + '/imports/:id', options, async r => confirmJiraImport(project(r), actorFromRequest(r), operation(r), r.body));
  app.get(root + '/transitions', options, async r => {
    const actor = actorFromRequest(r), key = parsedQuery(r, z.object({ key: jiraIssueKeySchema }).strict()).key;
    requireJiraEnabled(project(r), actor); const session = jiraSession(actor), transitions = await session.client.transitions(key); session.assertCurrent(); requireJiraEnabled(project(r), actor); return transitions;
  });
  app.post(root + '/sync-preview', options, async r => { jiraSettings(project(r), actorFromRequest(r)); return rejectLegacyJiraSync(); });
  app.get(root + '/sync', options, async r => listJiraActions(project(r), actorFromRequest(r))[0] || null);
  app.get(root + '/sync/:id', options, async r => readJiraAction(project(r), actorFromRequest(r), operation(r)));
  app.post(root + '/sync/:id/execute', options, async r => { jiraSettings(project(r), actorFromRequest(r)); return rejectLegacyJiraSync(); });
  app.post(root + '/sync/:id/recheck', options, async r => recheckJiraAction(project(r), actorFromRequest(r), operation(r)));
}
