import { afterEach, expect, it, vi } from 'vitest';
import { requirementsForProject } from '../src/client/features/requirements/api';
import { projectsPathGraphQuery } from '../src/client/features/planning/api';
import { InvalidResponseError } from '../src/client/api';

afterEach(() => vi.unstubAllGlobals());
it('domain reads preserve endpoint and abort signal', async () => {
  const fetch = vi.fn(async () => new Response('[]', { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetch);
  const controller = new AbortController();
  expect(await requirementsForProject('project-a', { signal: controller.signal })).toEqual([]);
  expect(fetch).toHaveBeenCalledWith('/api/requirements?projectId=project-a', expect.objectContaining({ signal: controller.signal }));
});
it('rejects malformed workspace responses before rendering', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { headers: { 'Content-Type': 'application/json' } })));
  await expect(projectsPathGraphQuery('p')).rejects.toBeInstanceOf(InvalidResponseError);
});
