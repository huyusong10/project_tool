import { expect, test, type Page, type Route } from '@playwright/test';
import type { Project } from '../../src/client/types';

const project: Project = {
  id: 'p1', name: '活跃项目', status: 'active', plannedStart: '2026-09-01', plannedEnd: '2026-09-30',
  defaultTemplateId: null, isSample: false, createdAt: '2026-09-01', updatedAt: '2026-09-01',
};

async function mockProjectArchive(page: Page, deleteBodies: Array<Record<string, unknown>>, impactChanges = false) {
  let archived = false;
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (pathname === '/api/branding') return json({ systemName: '项目管理', shortName: 'PM', logoUrl: null, updatedAt: null });
    if (pathname === '/api/session') return json({ authenticated: true, accountId: 'admin', username: 'admin', httpWarning: true, role: 'admin', globalRole: 'admin', personId: null, mustChangePassword: false, managedProjectIds: [] });
    if (pathname === '/api/projects' && request.method() === 'GET') return json(archived ? [] : [project]);
    if (pathname === '/api/projects/p1' && request.method() === 'DELETE') {
      const body = (request.postDataJSON?.() || {}) as Record<string, unknown>;
      deleteBodies.push(body);
      if (!body.force) return json({ error: '项目仍有活跃内容', code: 'DEPENDENCY_CONFLICT', details: { requirements: 3, issues: 2 } }, 409);
      if (impactChanges && body.expectedRequirements === 3) {
        return json({ error: '项目活跃内容已变化', code: 'DEPENDENCY_CONFLICT', details: { requirements: 4, issues: 3 } }, 409);
      }
      archived = true;
      return json({ ok: true, forced: true, dependencies: impactChanges ? { requirements: 4, issues: 3 } : { requirements: 3, issues: 2 } });
    }
    return json({});
  });
}

async function mockProjectCreate(page: Page, createBodies: Array<Record<string, unknown>>) {
  let projects: Project[] = [];
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (pathname === '/api/branding') return json({ systemName: '项目管理', shortName: 'PM', logoUrl: null, updatedAt: null });
    if (pathname === '/api/session') return json({ authenticated: true, accountId: 'admin', username: 'admin', httpWarning: true, role: 'admin', globalRole: 'admin', personId: null, mustChangePassword: false, managedProjectIds: [] });
    if (pathname === '/api/projects' && request.method() === 'GET') return json(projects);
    if (pathname === '/api/projects' && request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      createBodies.push(body);
      projects = [{ ...project, id: 'new-project', name: String(body.name) }];
      return json(projects[0]);
    }
    return json({});
  });
}

test('活跃项目通过明确二次确认归档且登录态保持不变', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1080p', '交互流程只需在一个桌面视口执行');
  const deleteBodies: Array<Record<string, unknown>> = [];
  await mockProjectArchive(page, deleteBodies);
  await page.goto('/projects');

  await page.getByRole('button', { name: '归档', exact: true }).click();
  const archiveConfirmation = page.getByRole('dialog', { name: '归档项目' });
  await expect(archiveConfirmation).toBeVisible();
  await archiveConfirmation.getByRole('button', { name: '确认归档' }).click();

  const confirmation = page.getByRole('dialog', { name: '确认强制归档' });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText('3条活跃需求');
  await expect(confirmation).toContainText('2条未解决问题');
  expect(deleteBodies).toEqual([{ expectedUpdatedAt: project.updatedAt }]);

  await confirmation.getByRole('button', { name: '仍然归档' }).click();
  await expect(page.getByText('还没有项目', { exact: true })).toBeVisible();
  await expect(page.locator('.session-badge')).toContainText('admin');
  await expect(page).toHaveURL(/\/projects$/);
  expect(deleteBodies).toEqual([
    { expectedUpdatedAt: project.updatedAt },
    { expectedUpdatedAt: project.updatedAt, force: true, expectedRequirements: 3, expectedIssues: 2 },
  ]);
});

test('强制归档前影响数量变化时展示最新范围并再次确认', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1080p', '交互流程只需在一个桌面视口执行');
  const deleteBodies: Array<Record<string, unknown>> = [];
  await mockProjectArchive(page, deleteBodies, true);
  await page.goto('/projects');

  await page.getByRole('button', { name: '归档', exact: true }).click();
  await page.getByRole('dialog', { name: '归档项目' }).getByRole('button', { name: '确认归档' }).click();
  const confirmation = page.getByRole('dialog', { name: '确认强制归档' });
  await confirmation.getByRole('button', { name: '仍然归档' }).click();

  await expect(confirmation).toContainText('4条活跃需求');
  await expect(confirmation).toContainText('3条未解决问题');
  await expect(confirmation.getByRole('alert')).toContainText('请核对更新后的影响范围并再次确认');
  await confirmation.getByRole('button', { name: '仍然归档' }).click();
  await expect(page.getByText('还没有项目', { exact: true })).toBeVisible();
  expect(deleteBodies).toEqual([
    { expectedUpdatedAt: project.updatedAt },
    { expectedUpdatedAt: project.updatedAt, force: true, expectedRequirements: 3, expectedIssues: 2 },
    { expectedUpdatedAt: project.updatedAt, force: true, expectedRequirements: 4, expectedIssues: 3 },
  ]);
});

test('新建项目始终显示并提交项目名称', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1080p', '表单流程只需在一个桌面视口执行');
  const createBodies: Array<Record<string, unknown>> = [];
  await mockProjectCreate(page, createBodies);
  await page.goto('/projects');
  await page.getByRole('button', { name: '新建项目' }).click();

  const dialog = page.getByRole('dialog', { name: '新建项目' });
  const nameInput = dialog.getByLabel('项目名称');
  await expect(nameInput).toBeVisible();
  await nameInput.fill('新项目名称');
  await dialog.getByRole('button', { name: '创建项目' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.locator('.project-name-line strong').filter({ hasText: '新项目名称' })).toBeVisible();
  expect(createBodies).toHaveLength(1);
  expect(createBodies[0]).toMatchObject({ name: '新项目名称' });
});
