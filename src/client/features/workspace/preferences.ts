import type { WorkspaceView } from '../../workspace-location';

export function readWorkspaceViewPreference(raw: string | null, projectId: string): WorkspaceView | null {
  try {
    const value = JSON.parse(raw || 'null');
    return value?.projectId === projectId && ['list', 'graph', 'progress'].includes(value.view) ? value.view : null;
  } catch { return null; }
}

/** Range and detail selection belong to the URL, never to a saved preference. */
export function workspaceViewPreference(projectId: string, view: WorkspaceView) {
  return JSON.stringify({ projectId, view });
}
