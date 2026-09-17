
import { requireWorkspaceRead } from "../workspace-access";

import type { FastifyInstance } from 'fastify';

import { actorFromRequest, assertAdmin, assertProjectManager, assertProjectReadable } from "../authorization";
import { openAccountForPerson } from "../accounts";

import { archivePerson, createPerson, listPeople, listPeopleCandidates, restorePerson, updatePerson } from "../services/people";

import { archiveRestoreInputSchema, createPersonInputSchema, openAccountInputSchema, personCommandSchema, updatePersonInputSchema, peopleListInputSchema, personCandidatesInputSchema } from "../../shared/contracts";
import { idOf, parsedBody, parsedQuery, requireReady, requireAdmin } from './context';

export function registerPeopleRoutes(app: FastifyInstance) {
  app.post('/api/people/:id/account', { preHandler: requireAdmin }, async (request) => openAccountForPerson(idOf(request), parsedBody(request, openAccountInputSchema), actorFromRequest(request)));

  app.get('/api/people', { preHandler: requireWorkspaceRead }, async (request) => {
    const input = parsedQuery(request, peopleListInputSchema); const actor = actorFromRequest(request); const projectId = input.projectId || '';
    if (!projectId) assertAdmin(actor);
    else if (input.includeDeleted) assertProjectManager(actor, projectId);
    else assertProjectReadable(actor, projectId);
    const people = listPeople(input.includeDeleted, projectId || undefined);
    return actor.type === 'guest' ? people.map(({ id, name, active, jobTitle }) => ({ id, name, active, jobTitle })) : people;
  });

  app.get('/api/people/candidates', { preHandler: requireReady }, async (request) => {
    const input = parsedQuery(request, personCandidatesInputSchema); assertProjectManager(actorFromRequest(request), input.projectId);
    return listPeopleCandidates(input.projectId, input.q || '');
  });

  app.post('/api/people', { preHandler: requireAdmin }, async (request) => createPerson(parsedBody(request, createPersonInputSchema), actorFromRequest(request)));

  app.patch('/api/people/:id', { preHandler: requireAdmin }, async (request) => updatePerson(idOf(request), parsedBody(request, updatePersonInputSchema), actorFromRequest(request)));

  app.delete('/api/people/:id', { preHandler: requireAdmin }, async (request) => archivePerson(idOf(request), parsedBody(request, personCommandSchema), actorFromRequest(request)));

  app.post('/api/people/:id/restore', { preHandler: requireAdmin }, async (request) => restorePerson(idOf(request), actorFromRequest(request), parsedBody(request, archiveRestoreInputSchema)));
}
