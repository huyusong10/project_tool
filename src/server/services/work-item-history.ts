import { businessDateFromDateTime } from '../../shared/domain';
import { getDatabaseContext } from '../database-context';
import { chunkValues } from './support';

type CancelledItem = { id: string; requirementId: string; status: string; updatedAt: string };
type StateEvent = { requirementId: string; workItemId: string | null; eventType: string; createdAt: string };
type CancellationAudit = { workItemId: string; createdAt: string };

export function getCancellationHistory(
  items: CancelledItem[],
  knownRequirementStatuses?: ReadonlyMap<string, string>,
  includeRequirementIds: string[] = [],
) {
  const cancelled = [...new Map(items.filter((item) => item.status === 'cancelled').map((item) => [item.id, item])).values()];
  const requirementIds = [...new Set([...cancelled.map((item) => item.requirementId), ...includeRequirementIds])];
  if (!requirementIds.length) return {
    workItemDates: new Map<string, string>(), requirementDates: new Map<string, string>(), inferredWorkItemIds: new Set<string>(),
  };
  const requirementStatuses = knownRequirementStatuses || (cancelled.length
    ? new Map(chunkValues(requirementIds).flatMap((batch) => {
      const placeholders = batch.map(() => '?').join(',');
      return getDatabaseContext().sqlite.prepare(`SELECT id, status FROM requirements WHERE id IN (${placeholders})`)
        .all(...batch) as Array<{ id: string; status: string }>;
    }).map((item) => [item.id, item.status]))
    : new Map<string, string>());
  const events = chunkValues(requirementIds).flatMap((batch) => {
    const placeholders = batch.map(() => '?').join(',');
    return getDatabaseContext().sqlite.prepare(`SELECT u.requirement_id AS requirementId, COALESCE(u.work_item_id,u.deleted_work_item_id) AS workItemId,
      u.event_type AS eventType, u.created_at AS createdAt
      FROM progress_updates u
      WHERE u.requirement_id IN (${placeholders})
        AND u.event_type IN ('start','complete','cancel','reopen','block','unblock')
      ORDER BY u.created_at, u.rowid`).all(...batch) as StateEvent[];
  });
  const cancellationAudits = chunkValues(cancelled.map((item) => item.id)).flatMap((batch) => {
    const placeholders = batch.map(() => '?').join(',');
    return getDatabaseContext().sqlite.prepare(`SELECT entity_id AS workItemId, created_at AS createdAt
      FROM audit_logs WHERE entity_type='work_item' AND action='cancel' AND entity_id IN (${placeholders})
      ORDER BY created_at, rowid`).all(...batch) as CancellationAudit[];
  });
  const latestItemState = new Map<string, StateEvent>();
  const latestCancellationAudit = new Map(cancellationAudits.map((event) => [event.workItemId, event.createdAt]));
  const requirementCancelledAt = new Map<string, string>();
  for (const event of events) {
    if (event.workItemId) latestItemState.set(event.workItemId, event);
    else if (event.eventType === 'cancel') requirementCancelledAt.set(event.requirementId, event.createdAt);
  }
  const requirementDates = new Map([...requirementCancelledAt].map(([requirementId, cancelledAt]) => [
    requirementId, businessDateFromDateTime(cancelledAt),
  ]));
  const inferredWorkItemIds = new Set<string>();
  const workItemDates = new Map(cancelled.map((item) => {
    const latest = latestItemState.get(item.id);
    const auditCancelledAt = latestCancellationAudit.get(item.id);
    const auditStop = latest?.eventType !== 'cancel' && (!latest || !auditCancelledAt || auditCancelledAt >= latest.createdAt)
      ? auditCancelledAt : null;
    const recordedStops = [
      latest?.eventType === 'cancel' ? latest.createdAt : null,
      auditStop,
      requirementStatuses.get(item.requirementId) === 'cancelled' ? requirementCancelledAt.get(item.requirementId) : null,
    ].filter((value): value is string => Boolean(value)).sort();
    if (!recordedStops.length) inferredWorkItemIds.add(item.id);
    const stoppedAt = recordedStops[0] || item.updatedAt;
    return [item.id, businessDateFromDateTime(stoppedAt)];
  }));
  return { workItemDates, requirementDates, inferredWorkItemIds };
}

export function getWorkItemCancellationDates(items: CancelledItem[], knownRequirementStatuses?: ReadonlyMap<string, string>) {
  return getCancellationHistory(items, knownRequirementStatuses).workItemDates;
}
