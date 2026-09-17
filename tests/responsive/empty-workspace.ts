import { analysePaths } from '../../src/shared/paths';
import type { Dashboard, Project } from '../../src/client/types';

/** A valid empty workspace, shared by isolated UI tests that mock other domains. */
export function emptyWorkspace(project: Pick<Project, 'id' | 'name'>) {
  const asOfDate = '2026-09-17';
  const analysis = analysePaths({ projectId: project.id, projectName: project.name, revision: 0, projectEnd: null, asOfDate,
    requirements: [], workItems: [], dependencies: [] });
  const report: Dashboard = {
    asOfDate, summary: { total: 0, active: 0, completed: 0, delayed: 0, highRisk: 0, completionRate: 0 }, requirements: [],
    issues: { summary: { total: 0, inProgress: 0, deferred: 0, resolved: 0, active: 0, highPriority: 0, overdue: 0, unassigned: 0, closureRate: 0 }, attention: [] },
    charts: { statuses: [], risks: [], weeks: [], varianceTop: [] },
  };
  return { analysis, report };
}
