

import { randomUUID } from 'node:crypto';

import { getDatabaseContext } from '../database-context';

import type { Actor } from '../auth';

import { assertRequirementOwnerOrManager, requireAuthorizationActor } from '../authorization';

import { getRequirement } from './requirements';

import { requireActiveProject, nowIso, row } from './support';

type RequirementEventEntry = {
  eventType: string;
  content: string;
  workItemId?: string | null;
  workItemPercent?: number | null;
  supersedesId?: string | null;
};

export function appendRequirementEvents(requirementId: string, entries: RequirementEventEntry[], actor: Actor, createdAt = nowIso(), knownProgress?: number) {
  const percent = knownProgress ?? row<{ progress: number }>('SELECT progress FROM requirements WHERE id=?', requirementId)?.progress ?? 0;
  const insert = getDatabaseContext().sqlite.prepare(`INSERT INTO progress_updates
    (id, requirement_id, work_item_id, percent, work_item_percent, content, event_type, supersedes_id, created_by_account_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  return entries.map((entry) => {
    const id = randomUUID();
    insert.run(id, requirementId, entry.workItemId || null, percent, entry.workItemPercent ?? null,
      entry.content, entry.eventType, entry.supersedesId || null, actor.accountId || null, createdAt, createdAt);
    return id;
  });
}

export function appendRequirementEvent(requirementId: string, eventType: string, content: string, actor: Actor, workItemId: string | null = null, workItemPercent: number | null = null, supersedesId: string | null = null, createdAt = nowIso()) {
  return appendRequirementEvents(requirementId, [{ eventType, content, workItemId, workItemPercent, supersedesId }], actor, createdAt)[0];
}

export function reopenRequirementForMilestone(id:string,title:string,actor:Actor){
  const r=getRequirement(id);requireActiveProject(r.projectId,true);assertRequirementOwnerOrManager(requireAuthorizationActor(actor),id);
  appendRequirementEvent(id,'note','重新打开里程碑：'+title,actor);
}
