import { addBusinessDays } from '../../src/shared/domain';
import type { PathInput, PathRequirement, PathWork } from '../../src/shared/paths';
export const date = (n: number) => addBusinessDays('2026-09-07', n);
export const req = (id: string): PathRequirement => ({ id, projectId: 'p', title: id, status: 'not_started', priority: 'P2', ownerName: '负责人', plannedStart: date(0), plannedEnd: date(20), acceptedAt: null, dependenciesReviewedAt: date(0), scheduleAnchor: null, forecastAcceptance: null, deletedAt: null });
export const work = (id: string, r: string, durationDays: number): PathWork => ({ id, requirementId: r, title: id, status: 'not_started', progress: 0, durationDays, plannedStart: date(0), plannedEnd: date(durationDays - 1), actualStart: null, actualEnd: null, earliestStart: null, unblockEstimate: null, forecastEnd: null, forecastDuration: null, forecastReadyAt: null, blockedAt: null, blockedReason: null, milestoneLabel: null, ownerName: '负责人' });
export function pathFixture(): PathInput {
  const requirements = ['A','B','C'].map(req);
  const workItems = [work('A1','A',2),work('A2','A',1),work('A3','A',3),work('B1','B',3),work('B2','B',2),work('C1','C',1),work('C2','C',1)];
  workItems[0].earliestStart = date(2);
  const refs: Array<[string,string,string,string|null]> = [['A1','A','A2','A'],['A1','A','A3','A'],['A2','A','B2','B'],['B1','B','B2','B'],['','B','','C'],['C1','C','C2','C']];
  return { projectId: 'p', projectName: '交付', projectEnd: date(6), revision: 1, asOfDate: date(0), requirements, workItems,
    dependencies: refs.map(([s,sr,t,tr],i) => ({ id:`e${i}`,projectId:'p',sourceRequirementId:sr,sourceWorkItemId:s||null,targetRequirementId:tr!,targetWorkItemId:t||null,origin:'manual' })) };
}
