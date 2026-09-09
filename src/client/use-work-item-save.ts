import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, jsonBody } from "./api";
import { invalidateRequirementViews, keys } from "./query-keys";
import type { Person, Requirement, WorkItem } from "./types";
import { useOptimisticMutation } from "./use-optimistic-mutation";
import { useSession } from "./app-context";
import { assertCleanRequirementDraft } from "./use-graph-draft";

const correctsActualDates = (input: Record<string, unknown>) =>
  Object.prototype.hasOwnProperty.call(input, "actualStart") || Object.prototype.hasOwnProperty.call(input, "actualEnd");

export function useWorkItemSave(requirementId: string, people: Person[]) {
  const client = useQueryClient();
  const { session } = useSession();
  const run = useOptimisticMutation<{ item: WorkItem; input: Record<string, unknown>; expectedVersion?: number }, WorkItem>({
    snapshotKeys: () => [keys.requirement(requirementId), [...keys.requirements]],
    apply: (queryClient, { item, input }) => {
      const applyInput = (current: WorkItem) => {
        if (current.version > item.version) return current;
        const optimistic = { ...current, ...input } as WorkItem;
        if (Object.prototype.hasOwnProperty.call(input, "ownerId")) {
          optimistic.ownerId = typeof input.ownerId === "string" && input.ownerId ? input.ownerId : null;
          optimistic.ownerName = people.find((person) => person.id === optimistic.ownerId)?.name || null;
        }
        if (Array.isArray(input.assigneeIds)) {
          optimistic.assigneeIds = input.assigneeIds.map(String);
          optimistic.assigneeNames = people.filter((person) => optimistic.assigneeIds.includes(person.id)).map((person) => person.name);
          optimistic.collaborators = people
            .filter((person) => optimistic.assigneeIds.includes(person.id) && person.id !== optimistic.ownerId)
            .map((person) => ({ id: person.id, name: person.name, jobTitle: person.jobTitle }));
        }
        return optimistic;
      };
      queryClient.setQueryData<Requirement>(keys.requirement(requirementId), (current) => current ? {
        ...current,
        workItems: current.workItems.map((entry) => entry.id === item.id ? applyInput(entry) : entry),
      } : current);
    },
    request: ({ item, input, expectedVersion = item.version }) => {
      const isCorrection = correctsActualDates(input);
      return api<WorkItem>(`/api/work-items/${item.id}${isCorrection ? "/correct" : ""}`, {
        method: isCorrection ? "POST" : "PATCH",
        body: jsonBody({ ...input, expectedVersion }),
      });
    },
    commit: (queryClient, saved) => {
      queryClient.setQueryData<Requirement>(keys.requirement(requirementId), (current) => current ? {
        ...current,
        workItems: current.workItems.map((entry) => entry.id === saved.id && entry.version <= saved.version ? saved : entry),
      } : current);
    },
  });

  return useCallback(async (item: WorkItem, input: Record<string, unknown>, expectedVersion?: number) => {
    if (correctsActualDates(input)) await assertCleanRequirementDraft(session.accountId || 'guest', requirementId,{workItemId:item.id,action:'structure'});
    await run({ item, input, expectedVersion });
    invalidateRequirementViews(client, requirementId);
  }, [client, requirementId, run, session.accountId]);
}
