import { expect, test, type Page, type Route } from '@playwright/test';
import type { Account, Person, Project } from '../../src/client/types';

const projects: Project[] = [
  { id: 'p1', name: 'DCIM', status: 'active', plannedStart: null, plannedEnd: null, defaultTemplateId: null, isSample: false, createdAt: '2026-09-01', updatedAt: '2026-09-01' },
  { id: 'p2', name: '基础设施平台', status: 'active', plannedStart: null, plannedEnd: null, defaultTemplateId: null, isSample: false, createdAt: '2026-09-01', updatedAt: '2026-09-01' },
  { id: 'p3', name: '研发协同系统', status: 'active', plannedStart: null, plannedEnd: null, defaultTemplateId: null, isSample: false, createdAt: '2026-09-01', updatedAt: '2026-09-01' },
];

const baseAccount = {
  globalRole: 'user' as const, status: 'active' as const, mustChangePassword: false, isBuiltin: false,
  lastLoginAt: null, createdAt: '2026-09-01', updatedAt: '2026-09-01',
  activeAssignments: { requirements: 0, workItems: 0, issues: 0 },
};

const accounts: Account[] = [
  { ...baseAccount, id: 'admin', username: 'admin', personId: null, personName: '内置管理员', jobTitle: null, globalRole: 'admin', role: 'admin', isBuiltin: true, managedProjects: [] },
  { ...baseAccount, id: 'member', username: '侯文驰', personId: 'u1', personName: '侯文驰', jobTitle: '后端工程师', role: 'user', managedProjects: [] },
  { ...baseAccount, id: 'manager', username: '安少帅', personId: 'u2', personName: '安少帅', jobTitle: '产品经理', role: 'project_manager', managedProjects: projects.map(({ id, name }) => ({ id, name })) },
];

const people: Person[] = [
  { id: 'u1', name: '侯文驰', jobTitle: '后端工程师', active: 1, username: '侯文驰', accountStatus: 'active', createdAt: '2026-09-01', updatedAt: '2026-09-01' },
  { id: 'u2', name: '安少帅', jobTitle: '产品经理', active: 1, username: '安少帅', accountStatus: 'active', createdAt: '2026-09-01', updatedAt: '2026-09-01' },
  { id: 'u3', name: '新成员', jobTitle: '测试工程师', active: 1, username: null, accountStatus: null, createdAt: '2026-09-01', updatedAt: '2026-09-01' },
];

async function mockAccounts(page: Page) {
  await page.route('**/api/**', async (route: Route) => {
    const pathname = new URL(route.request().url()).pathname;
    const json = (value: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
    if (pathname === '/api/branding') return json({ systemName: '项目管理', shortName: 'PM', logoUrl: null, updatedAt: null });
    if (pathname === '/api/session') return json({ authenticated: true, accountId: 'admin', username: 'admin', httpWarning: true, role: 'admin', globalRole: 'admin', personId: null, mustChangePassword: false, managedProjectIds: [] });
    if (pathname === '/api/projects') return json(projects);
    if (pathname === '/api/accounts') return json(accounts);
    if (pathname === '/api/people') return json(people);
    if (pathname === '/api/projects/p1/members') return json(people.slice(0, 2).map((person, index) => ({ ...person, projectRole: index ? 'manager' : 'member' })));
    if (pathname === '/api/archives') return json({ projects: [], requirements: [], people: [], templates: [] });
    return json({});
  });
}

test('人员与权限在宽、中、窄内容区完整展示并与项目角色分离', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1080p', '在一个浏览器内覆盖三种内容宽度');
  await mockAccounts(page);

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 1366, height: 768 },
    { width: 1536, height: 960 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
    { width: 900, height: 760 },
    { width: 620, height: 760 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/resources');
    const pageHeading = page.getByRole('heading', { name: '人员与权限' });
    if (viewport.width >= 900) await expect(pageHeading).toBeVisible();
    else await expect(pageHeading).toHaveCount(1);
    await expect(page.locator('.people-access-row')).toHaveCount(3);
    await expect(page.locator('.people-access-list').getByText('未开通账号', { exact: true })).toBeVisible();
    await expect(page.getByText('项目角色在各项目内配置', { exact: true })).toBeVisible();
    await expect(page.getByText(/项目经理：DCIM、基础设施平台 等 3 个项目/)).toBeVisible();
    await expect(page.getByText('从未登录', { exact: true }).first()).toBeVisible();
    await expect(page.locator('.account-actions-trigger')).toHaveCount(4);

    const layout = await page.locator('.account-data-list').evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clippedSummaries: [...element.querySelectorAll<HTMLElement>('.account-permission-summary')]
        .filter((summary) => summary.scrollHeight > summary.clientHeight + 1 || summary.scrollWidth > summary.clientWidth + 1).length,
      escapedActions: [...element.querySelectorAll<HTMLElement>('.account-actions-trigger')]
        .filter((button) => {
          const list = element.getBoundingClientRect();
          const rect = button.getBoundingClientRect();
          return rect.left < list.left - 1 || rect.right > list.right + 1;
        }).length,
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
    expect(layout.clippedSummaries).toBe(0);
    expect(layout.escapedActions).toBe(0);
  }

  await page.locator('.people-access-row .account-permission-editor').last().getByRole('button').click();
  const popover = page.locator('.account-permission-popover');
  await expect(popover).toBeVisible();
  await expect(popover.getByRole('option', { name: '项目经理' })).toHaveCount(0);
  await expect(popover.getByText(/项目经理在对应项目的“项目设置”中配置/)).toBeVisible();
  const rect = await popover.boundingBox();
  expect(rect).not.toBeNull();
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(620);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/project-settings');
  await expect(page.getByText(/在当前项目内配置项目经理/)).toBeVisible();
  await expect(page.getByRole('option', { name: '项目经理' }).first()).toBeAttached();
});
