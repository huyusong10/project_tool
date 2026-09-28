import type { JiraWorkflow, PrRemote, PrStep } from './jira-pr';

// Only propose a unique shortest path. Equal alternatives require a human choice.
export function workflowPath(workflow: JiraWorkflow | null | undefined, from: string, to: string) {
  const routes = workflowRoutes(workflow, from, to);
  return routes.length === 1 ? routes[0] : [];
}

export function workflowRoutes(workflow: JiraWorkflow | null | undefined, from: string, to: string) {
  if (!workflow || from === to) return [];
  let paths: JiraWorkflow['edges'][] = [[]];
  for (let depth = 0; depth < 30 && paths.length; depth++) {
    const next: JiraWorkflow['edges'][] = [], found: JiraWorkflow['edges'][] = [];
    for (const path of paths) {
      const current = path.at(-1)?.to.id || from;
      for (const edge of workflow.edges.filter(e => e.from.id === current)) {
        if (edge.to.id === from || path.some(e => e.to.id === edge.to.id)) continue;
        const candidate = [...path, edge];
        if (edge.to.id === to) found.push(candidate); else next.push(candidate);
      }
    }
    if (found.length) return found.length <= 30 ? found : [];
    if (next.length > 500) return [];
    paths = next;
  }
  return [];
}

// The first edge must be available to this account now, not merely present in the workflow.
export function targetRoutes(remote: PrRemote, targetId: string) {
  const from = remote.issue.status;
  const edges = [...(remote.workflow?.edges || []).filter(e => e.from.id !== from.id),
    ...remote.transitions.map(t => ({ id: t.id, name: t.name, from, to: t.to }))];
  return workflowRoutes({ name: remote.workflow?.name || '', edges }, from.id, targetId);
}

export function stepChoices(remote: PrRemote, steps: PrStep[], index: number) {
  let from = remote.issue.status;
  let plannedTransition = false;
  for (const step of steps.slice(0, index)) {
    if (step.kind !== 'transition' || step.transition.state === 'success') continue;
    if (!step.target || !step.transitionId) return { from: null, options: [], future: true };
    from = step.target; plannedTransition = true;
  }
  const options = plannedTransition
    ? (remote.workflow?.edges.filter(e => e.from.id === from.id) || []).map(e => ({ ...e, requiredFields: [] as string[] }))
    : remote.transitions;
  return { from, options, future: plannedTransition };
}
