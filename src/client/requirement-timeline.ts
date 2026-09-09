import type { Requirement, WorkItem } from './types';

/** 仅将需求执行事实适配到时间轴，不创建工作项，也不用于工作项写入。 */
export function directRequirementTimelineItem(r: Requirement): WorkItem {
  return {
    id: r.id, requirementId: r.id, templateItemId: null, title: r.title,
    ownerId: r.ownerId, ownerName: r.ownerName, collaborators: [],
    assigneeIds: r.ownerId ? [r.ownerId] : [], assigneeNames: r.ownerName ? [r.ownerName] : [],
    status: r.status === 'pending_acceptance' ? 'completed' : r.status === 'planning' ? 'not_started' : r.status,
    progress: r.progress, plannedStart: r.plannedStart, plannedEnd: r.plannedEnd,
    actualStart: r.actualStart || null, actualEnd: r.actualEnd || null,
    cancelledAt: r.status === 'cancelled' ? r.actualEnd : null,
    forecastEnd: r.forecastEnd || null, durationDays: r.durationDays,
    blockedAt: r.blockedAt || null, blockedReason: r.blockedReason || null,
    milestoneLabel: null, sortOrder: 0, version: r.version || 1,
    createdAt: r.createdAt || r.updatedAt, updatedAt: r.updatedAt,
  };
}
