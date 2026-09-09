export type CommitmentItem = {
  id: string; kind: 'requirement' | 'milestone'; title: string;
  targetDate: string | null; acceptanceCriteria: string | null;
};
export type DeliveryCommitment = {
  id: string; projectId: string; projectName: string; targetDate: string | null;
  milestoneId: string | null; milestoneTitle: string | null; reason: string;
  confirmedAt: string; confirmedBy: string; confirmedName?:string; items: CommitmentItem[];
};
export type CommitmentDifference = {
  id: string; title: string; kind: CommitmentItem['kind'];
  change: 'added' | 'removed' | 'changed';
  before: CommitmentItem | null; after: CommitmentItem | null;
};
export function compareCommitments(before: DeliveryCommitment | null, after: DeliveryCommitment): CommitmentDifference[] {
  const previous = new Map(before?.items.map(i => [i.id, i]) || []);
  const current = new Map(after.items.map(i => [i.id, i]));
  return [...new Set([...previous.keys(), ...current.keys()])].flatMap(id => {
    const a = previous.get(id) || null, b = current.get(id) || null;
    if (a && b && a.targetDate === b.targetDate && a.acceptanceCriteria === b.acceptanceCriteria && a.title === b.title) return [];
    return [{id, title: (b || a)!.title, kind: (b || a)!.kind, change: !a ? 'added' as const : !b ? 'removed' as const : 'changed' as const, before:a, after:b}];
  });
}
/** Selection is chronological; a missing date in the first commitment is not backfilled. */
export function requirementCommitments(history: DeliveryCommitment[], id: string, acceptedAt?: string | null) {
  const entries = history.filter(c => (!acceptedAt || c.confirmedAt.slice(0, 10) <= acceptedAt.slice(0, 10)) && c.items.some(i => i.kind === 'requirement' && i.id === id))
    .sort((a,b) => a.confirmedAt.localeCompare(b.confirmedAt) || a.id.localeCompare(b.id));
  const first = entries[0], latest = entries.at(-1);
  return {first: first?.items.find(i => i.id === id) || null, latest: latest?.items.find(i => i.id === id) || null,
    firstConfirmedAt:first?.confirmedAt || null, latestConfirmedAt:latest?.confirmedAt || null};
}
