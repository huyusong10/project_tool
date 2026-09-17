import { afterEach, expect, it, vi } from 'vitest';
import { projectTaskUrl } from '../src/client/project-workspace-navigation';
afterEach(()=>vi.unstubAllGlobals());
import { readWorkspaceViewPreference, workspaceViewPreference } from '../src/client/features/workspace/preferences';

it('stores only view preference, leaving range and detail to the URL', () => {
  const stored = workspaceViewPreference('p', 'graph');
  expect(JSON.parse(stored)).toEqual({ projectId: 'p', view: 'graph' });
  expect(readWorkspaceViewPreference(stored, 'p')).toBe('graph');
  expect(readWorkspaceViewPreference(stored, 'other')).toBeNull();
});
it('reads old preferences without restoring stale scope or inspector', () => {
  expect(readWorkspaceViewPreference(JSON.stringify({ projectId: 'p', view: 'progress', scope: { kind: 'requirement', id: 'deleted' }, inspector: 'deleted' }), 'p')).toBe('progress');
  for (const value of [null, '{', '[]', '{"projectId":"p","view":"unknown"}']) expect(readWorkspaceViewPreference(value, 'p')).toBeNull();
});
it('navigation accepts view-only preferences and takes scope from the current URL', () => {
  vi.stubGlobal('localStorage',{getItem:()=>workspaceViewPreference('p','graph')});
  const params=new URL(projectTaskUrl('a','p','progress',new URLSearchParams('workspaceView=list&scopeType=requirement&scopeId=r')),'http://test').searchParams;
  expect(params.get('scopeId')).toBe('r');
  expect(params.get('workspaceView')).toBe('progress');
  expect(new URL(projectTaskUrl('a','p','scope'),'http://test').searchParams.get('scopeId')).toBe('p');
});
