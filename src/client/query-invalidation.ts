import type { QueryClient, QueryKey } from '@tanstack/react-query';

const requirementViewKeys: QueryKey[] = [
  ['requirements'],
  ['dashboard'],
  ['my-work'],
  ['action-items'],
  ['people-concurrency'],
  ['analytics-data'],
  ['analytics-preview'],
  ['audit-search'],
];

export function invalidateRequirementViews(client: QueryClient, requirementId?: string) {
  if (requirementId) void client.invalidateQueries({ queryKey: ['requirement', requirementId] });
  requirementViewKeys.forEach((queryKey) => void client.invalidateQueries({ queryKey }));
}
