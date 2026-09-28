import { describe, expect, it } from 'vitest';
import { workflowPath, stepChoices } from '../src/shared/jira-workflow';
import type { JiraWorkflow, PrRemote, PrStep } from '../src/shared/jira-pr';

const status = (id: string) => ({ id, name: id });
const edge = (from: string, to: string, id = from + to) => ({ id, name: id, from: status(from), to: status(to) });
describe('real workflow paths', () => {
  it('follows the graph rather than a fixed testing/acceptance order', () => {
    const workflow: JiraWorkflow = { name: 'real', edges: [edge('planning', 'design'), edge('design', 'development'), edge('development', 'acceptance'), edge('acceptance', 'testing'), edge('testing', 'done')] };
    expect(workflowPath(workflow, 'planning', 'done').map(e => e.to.id)).toEqual(['design', 'development', 'acceptance', 'testing', 'done']);
    expect(workflowPath(workflow, 'done', 'planning')).toEqual([]);
  });
  it('does not guess equal routes, same-target operations, inaccessible paths or loops', () => {
    expect(workflowPath({ name: 'x', edges: [edge('a', 'b'), edge('a', 'b', 'other')] }, 'a', 'b')).toEqual([]);
    expect(workflowPath({ name: 'x', edges: [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')] }, 'a', 'd')).toEqual([]);
    expect(workflowPath({ name: 'x', edges: [edge('a', 'b'), edge('b', 'a')] }, 'a', 'd')).toEqual([]);
    expect(workflowPath(null, 'a', 'b')).toEqual([]);
  });
  it('only lists successor operations for the immediately preceding planned state', () => {
    const remote = { issue: { status: status('a') }, transitions: [{ ...edge('a', 'b'), requiredFields: [] }], workflow: { name: 'x', edges: [edge('a', 'b'), edge('b', 'c')] } } as unknown as PrRemote;
    const steps = [{ kind: 'transition', target: status('b'), transitionId: 'ab', transition: { state: 'pending' } }] as PrStep[];
    expect(stepChoices(remote, steps, 1).options.map(t => t.to.id)).toEqual(['c']);
    steps[0].transitionId = null;
    expect(stepChoices(remote, steps, 1).options).toEqual([]);
  });
});
