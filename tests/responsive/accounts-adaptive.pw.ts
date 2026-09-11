import { expect, test, type Page, type Route } from '@playwright/test';
import type { Account, Archives, Person, Project } from '../../src/client/types';

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
const membershipUpdatedAt = '2026-09-01T00:00:00.000Z';

async function mockAccounts(page: Page) {
  await page.route('**/api/**', async (route: Route) => {
    const pathname = new URL(route.request().url()).pathname;
    const json = (value: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
    if (pathname === '/api/branding') return json({ systemName: '项目管理', shortName: 'PM', logoUrl: null, updatedAt: null });
    if (pathname === '/api/session') return json({ authenticated: true, accountId: 'admin', username: 'admin', httpWarning: true, role: 'admin', globalRole: 'admin', personId: null, mustChangePassword: false, managedProjectIds: [] });
    if (pathname === '/api/projects') return json(projects);
    if (pathname === '/api/accounts') return json(accounts);
    if (pathname === '/api/people') return json(people);
    if (pathname === '/api/projects/p1/members') return json(people.slice(0, 2).map((person, index) => ({ ...person, projectRole: index ? 'manager' : 'member', membershipUpdatedAt })));
    if (pathname === '/api/archives') return json({ projects: [], requirements: [], people: [], templates: [] });
    return json({});
  });
}

for (const filter of ['all', 'user'] as const) {
  test(`平台权限冲突后保留编辑器并强制重读，${filter}筛选下重试期间锁定操作`, async ({ page }) => {
    await mockAccounts(page);
    let saved = { ...accounts[1] };
    const requests: Array<{ role: string }> = [];
    let releaseFailure!: () => void;
    let releaseSuccess!: () => void;
    const pendingFailure = new Promise<void>((resolve) => { releaseFailure = resolve; });
    const pendingSuccess = new Promise<void>((resolve) => { releaseSuccess = resolve; });
    await page.route('**/api/accounts', (route) => route.fulfill({ json: accounts.map((account) => account.id === saved.id ? saved : account) }));
    await page.route('**/api/accounts/member', async (route) => {
      const body = route.request().postDataJSON() as { role: Account['globalRole'] };
      requests.push(body);
      if (requests.length === 1) {
        await pendingFailure;
        return route.fulfill({ status: 409, json: { error: '权限暂时无法保存，请重试' } });
      }
      await pendingSuccess;
      saved = { ...saved, globalRole: body.role, role: body.role };
      return route.fulfill({ json: saved });
    });
    try {
      await page.goto('/resources');
      await page.getByLabel('按平台权限筛选').selectOption(filter);
      const row = page.locator('.people-access-row').filter({ hasText: '侯文驰' });
      await row.getByRole('button', { name: /平台权限/ }).click();
      const editor = page.locator('.account-permission-popover');
      const role = editor.getByLabel('平台角色');
      await role.selectOption('admin');
      await editor.getByRole('button', { name: '保存权限' }).click();
      await expect.poll(() => requests.length).toBe(1);
      await expect(row).toBeVisible();
      releaseFailure();
      await expect(editor.getByText('权限暂时无法保存，请重试', { exact: true })).toBeVisible();
      await expect(role).toHaveValue('admin');
      await expect(editor.getByRole('button', { name: '保存权限' })).toBeDisabled();
      await editor.getByRole('button', { name: '重新读取账号' }).click();
      await expect(role).toHaveValue('user');
      await role.selectOption('admin');
      await editor.getByRole('button', { name: '保存权限' }).click();
      await expect.poll(() => requests.length).toBe(2);
      await expect(row).toBeVisible();
      await expect(role).toBeDisabled();
      await expect(editor.getByRole('button', { name: '取消', exact: true })).toBeDisabled();
      await expect(row.getByRole('button', { name: /平台权限/ })).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(editor).toBeVisible();
      releaseSuccess();
      await expect(editor).toHaveCount(0);
      if (filter === 'user') await expect(row).toHaveCount(0);
      await page.getByLabel('按平台权限筛选').selectOption('admin');
      await expect(row).toBeVisible();
      expect(requests).toEqual([
        { role: 'admin', expectedUpdatedAt: accounts[1].updatedAt },
        { role: 'admin', expectedUpdatedAt: accounts[1].updatedAt },
      ]);
    } finally { releaseFailure(); releaseSuccess(); }
  });
}

async function reconnect(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
}

test('批量添加成员提交中保持窗口与选择，部分失败只重试失败成员', async ({ page }) => {
  await mockAccounts(page);
  const candidates = [people[2], { ...people[2], id: 'u4', name: '额外成员' }];
  const added = new Set<string>();
  const requests: Array<{ id: string; role: string; expectedMembershipUpdatedAt: string | null }> = [];
  let failedOnce = false;
  let releaseFirst!: () => void;
  const firstPending = new Promise<void>((resolve) => { releaseFirst = resolve; });
  await page.route('**/api/people/candidates?*', (route) => route.fulfill({ json: candidates.map((person) => ({
    ...person, canAdd: !added.has(person.id), unavailableReason: added.has(person.id) ? 'already_member' : null,
    existingProjectRole: added.has(person.id) ? 'manager' : null,
  })) }));
  await page.route('**/api/projects/p1/members', (route) => route.fulfill({ json: [
    ...people.slice(0, 2).map((person) => ({ ...person, projectRole: person.id === 'u2' ? 'manager' : 'member', membershipUpdatedAt })),
    ...candidates.filter((person) => added.has(person.id)).map((person) => ({ ...person, projectRole: 'manager', membershipUpdatedAt })),
  ] }));
  await page.route('**/api/projects/p1/members/*', async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1)!;
    requests.push({ id, ...route.request().postDataJSON() });
    if (requests.length === 1) await firstPending;
    if (id === 'u4' && !failedOnce) {
      failedOnce = true;
      return route.fulfill({ status: 409, json: { error: '人员状态已变化，请重试' } });
    }
    added.add(id);
    return route.fulfill({ json: { ok: true } });
  });
  try {
    await page.goto('/project-settings');
    await page.getByRole('button', { name: '添加成员', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '添加项目成员' });
    await dialog.locator('.member-candidate-option').filter({ hasText: '新成员' }).click();
    await dialog.locator('.member-candidate-option').filter({ hasText: '额外成员' }).click();
    const role = dialog.getByLabel('加入后的项目角色');
    await role.selectOption('manager');
    await dialog.getByRole('button', { name: '添加 2 人到项目' }).click();
    await expect.poll(() => requests.length).toBe(1);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: '清空选择' })).toBeDisabled();
    await expect(role).toBeDisabled();
    await expect(dialog.getByRole('searchbox')).toBeDisabled();
    await expect(dialog.locator('.member-picker-selection')).toContainText('2');
    releaseFirst();
    await expect(dialog.getByText(/部分成员添加失败：额外成员：人员状态已变化/)).toBeVisible();
    await expect(dialog.locator('.member-picker-selection')).toContainText('1');
    await expect(dialog.locator('.member-candidate-option').filter({ hasText: '新成员' })).toBeDisabled();
    await expect(role).toHaveValue('manager');
    await dialog.getByRole('button', { name: '添加 1 人到项目' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.project-member-row')).toHaveCount(4);
    expect(requests).toEqual([
      { id: 'u3', role: 'manager', expectedMembershipUpdatedAt: null },
      { id: 'u4', role: 'manager', expectedMembershipUpdatedAt: null },
      { id: 'u4', role: 'manager', expectedMembershipUpdatedAt: null },
    ]);
  } finally { releaseFirst(); }
});

test('添加成员已落库但响应异常时批量核对并避免重复提交', async ({ page }) => {
  await mockAccounts(page);
  let added = false;
  let writes = 0;
  await page.route('**/api/people/candidates?*', (route) => route.fulfill({ json: [{
    ...people[2], canAdd: !added, unavailableReason: added ? 'already_member' : null,
    existingProjectRole: added ? 'manager' : null,
  }] }));
  await page.route('**/api/projects/p1/members', (route) => route.fulfill({ json: [
    ...people.slice(0, 2).map((person) => ({ ...person, projectRole: person.id === 'u2' ? 'manager' : 'member', membershipUpdatedAt })),
    ...(added ? [{ ...people[2], projectRole: 'manager', membershipUpdatedAt: '2026-09-01T00:00:00.001Z' }] : []),
  ] }));
  await page.route('**/api/projects/p1/members/u3', (route) => {
    writes += 1;
    added = true;
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/project-settings');
  await page.getByRole('button', { name: '添加成员', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加项目成员', exact: true });
  await dialog.locator('.member-candidate-option').filter({ hasText: '新成员' }).click();
  await dialog.getByLabel('加入后的项目角色').selectOption('manager');
  await dialog.getByRole('button', { name: '添加 1 人到项目', exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('已核对最新状态：1 位成员已加入', { exact: true })).toBeVisible();
  await expect(page.locator('.project-member-row')).toHaveCount(3);
  expect(writes).toBe(1);
});

test('添加成员响应未知且成员回读失败时锁定原批次', async ({ page }) => {
  await mockAccounts(page);
  let reads = 0;
  let writes = 0;
  let added = false;
  let failReads = true;
  await page.route('**/api/people/candidates?*', (route) => route.fulfill({ json: [{
    ...people[2], canAdd: !added, unavailableReason: added ? 'already_member' : null, existingProjectRole: added ? 'member' : null,
  }] }));
  await page.route('**/api/projects/p1/members', (route) => {
    reads += 1;
    if (reads > 1 && failReads) return route.fulfill({ status: 503, json: { error: '成员核对读取失败' } });
    return route.fulfill({ json: [
      ...people.slice(0, 2).map((person) => ({ ...person, projectRole: person.id === 'u2' ? 'manager' : 'member', membershipUpdatedAt })),
      ...(added ? [{ ...people[2], projectRole: 'member', membershipUpdatedAt: '2026-09-01T00:00:00.001Z' }] : []),
    ] });
  });
  await page.route('**/api/projects/p1/members/u3', (route) => {
    writes += 1;
    added = true;
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/project-settings');
  await page.getByRole('button', { name: '添加成员', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加项目成员', exact: true });
  await dialog.locator('.member-candidate-option').filter({ hasText: '新成员' }).click();
  await dialog.getByRole('button', { name: '添加 1 人到项目', exact: true }).click();

  await expect(dialog.getByRole('alert')).toContainText('成员添加结果待核对');
  await expect(dialog.getByRole('button', { name: '关闭并核对', exact: true })).toBeEnabled();
  await expect(dialog.getByLabel('加入后的项目角色')).toBeDisabled();
  await dialog.locator('form').evaluate((form) => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(100);
  expect(writes).toBe(1);

  await dialog.getByRole('button', { name: '关闭并核对', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('成员操作结果待核对');
  await expect(page.getByRole('button', { name: '添加成员', exact: true })).toBeDisabled();

  await page.getByRole('link', { name: '人员与权限', exact: true }).click();
  await page.getByRole('link', { name: '项目设置', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('成员操作结果待核对');
  expect(writes).toBe(1);

  failReads = false;
  await page.getByRole('button', { name: '重新读取成员', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.project-member-row')).toHaveCount(3);
  await expect(page.getByRole('button', { name: '添加成员', exact: true })).toBeEnabled();
});

test('项目角色变更单航提交，失败回退并可重试', async ({ page }) => {
  await mockAccounts(page);
  let members = people.slice(0, 2).map((person, index) => ({ ...person, projectRole: index ? 'manager' : 'member', membershipUpdatedAt }));
  let releaseFailure!: () => void;
  const waitingFailure = new Promise<void>((resolve) => { releaseFailure = resolve; });
  const requests: Array<{ role: string; expectedMembershipUpdatedAt: string | null }> = [];
  await page.route('**/api/projects/p1/members', (route) => route.fulfill({ json: members }));
  await page.route('**/api/projects/p1/members/u1', async (route) => {
    const body = route.request().postDataJSON() as { role: string; expectedMembershipUpdatedAt: string | null };
    const role = String(body.role);
    requests.push(body);
    const attempt = requests.length;
    if (attempt === 1) {
      await waitingFailure;
      return route.fulfill({ status: 409, json: { error: '角色暂时无法保存' } });
    }
    members = members.map((person) => person.id === 'u1' ? { ...person, projectRole: role, membershipUpdatedAt: '2026-09-01T00:00:00.001Z' } : person);
    return route.fulfill({ json: members.find((person) => person.id === 'u1') });
  });

  try {
    await page.goto('/project-settings');
    const role = page.getByLabel('侯文驰的项目角色', { exact: true });
    await role.evaluate((select) => {
      (select as HTMLSelectElement).value = 'manager';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      (select as HTMLSelectElement).value = 'viewer';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect.poll(() => requests).toEqual([{ role: 'manager', expectedMembershipUpdatedAt: membershipUpdatedAt }]);
    await expect(role).toBeDisabled();
    await expect(role).toHaveValue('manager');
    releaseFailure();
    await expect(page.getByText('角色暂时无法保存', { exact: true })).toBeVisible();
    await expect(role).toBeEnabled();
    await expect(role).toHaveValue('member');
    await role.selectOption('manager');
    await expect.poll(() => requests).toEqual([
      { role: 'manager', expectedMembershipUpdatedAt: membershipUpdatedAt },
      { role: 'manager', expectedMembershipUpdatedAt: membershipUpdatedAt },
    ]);
    await expect(role).toHaveValue('manager');
  } finally { releaseFailure(); }
});

test('项目角色迟到成功响应不覆盖后台重读的新成员关系', async ({ page }) => {
  await mockAccounts(page);
  let members: Person[] = people.slice(0, 2).map((person, index) => ({ ...person, projectRole: index ? 'manager' : 'member', membershipUpdatedAt }));
  let memberReads = 0;
  let requestStarted = false;
  let releaseSave!: () => void;
  const waitingSave = new Promise<void>((resolve) => { releaseSave = resolve; });
  await page.route('**/api/templates?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/projects/p1/members', (route) => {
    memberReads++;
    return route.fulfill({ json: members });
  });
  await page.route('**/api/projects/p1/members/u1', async (route) => {
    requestStarted = true;
    await waitingSave;
    return route.fulfill({ json: { ...people[0], projectRole: 'manager', membershipUpdatedAt: '2026-09-01T00:00:00.001Z' } });
  });
  try {
    await page.goto('/project-settings');
    const role = page.getByLabel('侯文驰的项目角色', { exact: true });
    await role.selectOption('manager');
    await expect.poll(() => requestStarted).toBe(true);

    members = members.map((person) => person.id === 'u1'
      ? { ...person, projectRole: 'viewer' as const, membershipUpdatedAt: '2026-09-01T00:00:00.002Z' }
      : person);
    await page.getByRole('button', { name: '编辑项目', exact: true }).click();
    await page.getByRole('dialog', { name: '编辑项目' }).getByRole('button', { name: '保存修改', exact: true }).click();
    await expect.poll(() => memberReads).toBeGreaterThan(1);

    releaseSave();
    await expect(role).toBeEnabled();
    await expect(role).toHaveValue('viewer');
  } finally { releaseSave(); }
});

test('项目成员权限写入已落库但响应异常时核对角色和移除结果', async ({ page }) => {
  await mockAccounts(page);
  let members: Person[] = people.slice(0, 2).map((person, index) => ({ ...person, projectRole: index ? 'manager' : 'member', membershipUpdatedAt }));
  let roleWrites = 0;
  let removeWrites = 0;
  await page.route('**/api/projects/p1/members', (route) => route.fulfill({ json: members }));
  await page.route('**/api/projects/p1/members/u1', (route) => {
    if (route.request().method() === 'PUT') {
      roleWrites += 1;
      members = members.map((person) => person.id === 'u1'
        ? { ...person, projectRole: 'manager' as const, membershipUpdatedAt: '2026-09-01T00:00:00.001Z' }
        : person);
    } else {
      removeWrites += 1;
      members = members.filter((person) => person.id !== 'u1');
    }
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/project-settings');
  const role = page.getByLabel('侯文驰的项目角色', { exact: true });
  await role.selectOption('manager');
  await expect(page.getByText('已核对最新状态：项目角色已更新', { exact: true })).toBeVisible();
  await expect(role).toHaveValue('manager');
  expect(roleWrites).toBe(1);

  const row = page.locator('.project-member-row').filter({ hasText: '侯文驰' });
  await row.getByRole('button', { name: '移除', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '移出项目成员', exact: true });
  await confirmation.getByRole('button', { name: '确认移出', exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.getByText('已核对最新状态：项目成员已移除', { exact: true })).toBeVisible();
  await expect(row).toHaveCount(0);
  expect(removeWrites).toBe(1);
});

test('项目角色响应未知且成员回读失败时锁定旧权限', async ({ page }) => {
  await mockAccounts(page);
  let members: Person[] = people.slice(0, 2).map((person, index) => ({ ...person, projectRole: index ? 'manager' : 'member', membershipUpdatedAt }));
  let reads = 0;
  let failReads = true;
  const requests: Array<{ role: string; expectedMembershipUpdatedAt: string | null }> = [];
  await page.route('**/api/projects/p1/members', (route) => {
    reads += 1;
    return reads === 1 || !failReads ? route.fulfill({ json: members }) : route.fulfill({ status: 503, json: { error: '成员核对读取失败' } });
  });
  await page.route('**/api/projects/p1/members/u1', (route) => {
    const body = route.request().postDataJSON() as { role: 'manager' | 'member' | 'viewer'; expectedMembershipUpdatedAt: string | null };
    requests.push(body);
    members = members.map((person) => person.id === 'u1' ? {
      ...person,
      projectRole: body.role,
      membershipUpdatedAt: requests.length === 1 ? '2026-09-01T00:00:00.001Z' : '2026-09-01T00:00:00.002Z',
    } : person);
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/project-settings');
  const role = page.getByLabel('侯文驰的项目角色', { exact: true });
  await role.selectOption('manager');
  await expect(page.getByRole('alert')).toContainText('成员操作结果待核对');
  await expect(role).toBeDisabled();
  await role.evaluate((select) => { (select as HTMLSelectElement).value = 'viewer'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(100);
  expect(requests).toHaveLength(1);
  expect(members.find((person) => person.id === 'u1')?.projectRole).toBe('manager');
  failReads = false;
  await page.getByRole('button', { name: '重新读取成员', exact: true }).click();
  await expect(role).toBeEnabled();
  await expect(role).toHaveValue('manager');
  await role.selectOption('viewer');
  await expect(page.getByText('已核对最新状态：项目角色已更新', { exact: true })).toBeVisible();
  expect(requests).toEqual([
    { role: 'manager', expectedMembershipUpdatedAt: membershipUpdatedAt },
    { role: 'viewer', expectedMembershipUpdatedAt: '2026-09-01T00:00:00.001Z' },
  ]);
});

test('开通账号连点只提交一次并保留成功凭据', async ({ page }) => {
  await mockAccounts(page);
  let releaseOpen!: () => void;
  const waitingOpen = new Promise<void>((resolve) => { releaseOpen = resolve; });
  let requests = 0;
  const payloads: Array<Record<string, unknown>> = [];
  await page.route('**/api/people/u3/account', async (route) => {
    requests++;
    payloads.push(route.request().postDataJSON());
    await waitingOpen;
    return route.fulfill({ json: {
      account: { ...baseAccount, id: 'opened', username: '新成员', personId: 'u3', personName: '新成员', jobTitle: '测试工程师', role: 'user', managedProjects: [] },
      temporaryPassword: '888888',
    } });
  });

  try {
    await page.goto('/resources');
    const row = page.locator('.people-access-row').filter({ hasText: '新成员' });
    const trigger = row.getByRole('button', { name: '打开新成员操作', exact: true });
    await trigger.click();
    await page.getByRole('menuitem', { name: '开通账号', exact: true }).evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect.poll(() => requests).toBe(1);
    expect(payloads).toEqual([{ expectedAccountDeletedAt: null }]);
    await expect(trigger).toBeDisabled();
  } finally { releaseOpen(); }
  const result = page.getByRole('dialog', { name: '账号已开通', exact: true });
  await expect(result).toBeVisible();
  await expect(result).toContainText('888888');
});

test('开通账号已落库但响应异常时核对最新账号并显示凭据', async ({ page }) => {
  await mockAccounts(page);
  let currentAccounts = structuredClone(accounts);
  let requests = 0;
  await page.route('**/api/accounts', (route) => route.fulfill({ json: currentAccounts }));
  await page.route('**/api/people/u3/account', (route) => {
    requests++;
    currentAccounts = [...currentAccounts, {
      ...baseAccount,
      id: 'opened-after-invalid-response',
      username: '新成员',
      personId: 'u3',
      personName: '新成员',
      jobTitle: '测试工程师',
      role: 'user' as const,
      mustChangePassword: true,
      managedProjects: [],
      updatedAt: '2026-09-05T00:00:00.000Z',
    }];
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/resources');
  const row = page.locator('.people-access-row').filter({ hasText: '新成员' });
  await row.getByRole('button', { name: '打开新成员操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '开通账号', exact: true }).click();

  const result = page.getByRole('dialog', { name: '账号已开通', exact: true });
  await expect(result).toContainText('已核对最新状态');
  await expect(result).toContainText('888888');
  await expect(row.getByRole('button', { name: /登录名：新成员/ })).toBeVisible();
  expect(requests).toBe(1);
});

test('开通账号响应未知且账号回读失败时跨导航锁定旧入口', async ({ page }) => {
  await mockAccounts(page);
  let currentAccounts = structuredClone(accounts);
  let failReads = false;
  let requests = 0;
  await page.route('**/api/accounts', (route) => failReads
    ? route.fulfill({ status: 503, json: { error: '账号列表读取失败' } })
    : route.fulfill({ json: currentAccounts }));
  await page.route('**/api/people/u3/account', (route) => {
    requests += 1;
    currentAccounts = [...currentAccounts, {
      ...baseAccount,
      id: 'opened-needs-recheck',
      username: '新成员',
      personId: 'u3',
      personName: '新成员',
      jobTitle: '测试工程师',
      role: 'user' as const,
      mustChangePassword: true,
      managedProjects: [],
      updatedAt: '2026-09-05T00:00:00.000Z',
    }];
    failReads = true;
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/resources');
  const row = page.locator('.people-access-row').filter({ hasText: '新成员' });
  const trigger = row.getByRole('button', { name: '打开新成员操作', exact: true });
  await trigger.click();
  await page.getByRole('menuitem', { name: '开通账号', exact: true }).click();
  const result = page.getByRole('dialog', { name: '开通账号结果待核对', exact: true });
  await expect(result).toBeVisible();
  await result.getByRole('button', { name: '知道了', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('开通账号结果待核对');
  await expect(trigger).toBeDisabled();
  await trigger.evaluate((button) => {
    (button as HTMLButtonElement).disabled = false;
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole('menuitem', { name: '开通账号', exact: true })).toHaveCount(0);
  await page.waitForTimeout(100);
  expect(requests).toBe(1);

  await page.getByRole('link', { name: '项目中心', exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/resources$/);
  await expect(page.getByRole('alert')).toContainText('开通账号结果待核对');
  await expect(trigger).toBeDisabled();
  await trigger.evaluate((button) => {
    (button as HTMLButtonElement).disabled = false;
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole('menuitem', { name: '开通账号', exact: true })).toHaveCount(0);
  expect(requests).toBe(1);

  failReads = false;
  await page.getByRole('button', { name: '重新读取账号', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '账号已开通', exact: true })).toContainText('已核对最新状态');
  await expect(row.getByRole('button', { name: /登录名：新成员/ })).toBeVisible();
});

test('开通账号冲突后刷新为服务端最新账号，不能继续显示旧入口', async ({ page }) => {
  await mockAccounts(page);
  let currentAccounts = structuredClone(accounts);
  let requests = 0;
  await page.route('**/api/accounts', (route) => route.fulfill({ json: currentAccounts }));
  await page.route('**/api/people/u3/account', (route) => {
    requests++;
    currentAccounts = [...currentAccounts, {
      ...baseAccount,
      id: 'opened-elsewhere',
      username: '新成员',
      personId: 'u3',
      personName: '新成员',
      jobTitle: '测试工程师',
      role: 'user' as const,
      managedProjects: [],
    }];
    return route.fulfill({ status: 409, json: { error: '该人员已有可用账号', code: 'STALE_WRITE' } });
  });

  await page.goto('/resources');
  const row = page.locator('.people-access-row').filter({ hasText: '新成员' });
  await row.getByRole('button', { name: '打开新成员操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '开通账号', exact: true }).click();
  const result = page.getByRole('dialog', { name: '开通账号失败', exact: true });
  await expect(result).toContainText('该人员已有可用账号');
  await expect(row.getByRole('button', { name: /登录名：新成员/ })).toBeVisible();
  await result.getByRole('button', { name: '知道了', exact: true }).click();
  await row.getByRole('button', { name: '打开新成员操作', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '开通账号', exact: true })).toHaveCount(0);
  expect(requests).toBe(1);
});

test('账号状态保存期间锁定同一账号的其他操作', async ({ page }) => {
  await mockAccounts(page);
  let saved: Account = { ...accounts[1], status: 'disabled' };
  let releaseSave!: () => void;
  const waitingSave = new Promise<void>((resolve) => { releaseSave = resolve; });
  const requests: string[] = [];
  await page.route('**/api/accounts', (route) => route.fulfill({ json: accounts.map((account) => account.id === saved.id ? saved : account) }));
  await page.route('**/api/accounts/member', async (route) => {
    const status = String(route.request().postDataJSON().status);
    requests.push(status);
    await waitingSave;
    saved = { ...saved, status: status as Account['status'] };
    return route.fulfill({ json: saved });
  });

  try {
    await page.goto('/resources');
    const row = page.locator('.people-access-row').filter({ hasText: '侯文驰' });
    const trigger = row.getByRole('button', { name: '打开侯文驰操作', exact: true });
    await trigger.click();
    await page.getByRole('menuitem', { name: '允许登录', exact: true }).evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect.poll(() => requests).toEqual(['active']);
    await expect(trigger).toBeDisabled();
    await expect(row.getByRole('button', { name: /登录状态/ })).toBeDisabled();
    await expect(row.getByRole('button', { name: /平台权限/ })).toBeDisabled();
  } finally { releaseSave(); }
  await expect.poll(() => saved.status).toBe('active');
  await expect(page.getByRole('dialog', { name: '更新登录状态失败' })).toHaveCount(0);
});

test('登录状态已落库但响应异常时核对账号版本并消除失败提示', async ({ page }) => {
  await mockAccounts(page);
  let saved: Account = { ...accounts[1], status: 'disabled' };
  let requests = 0;
  await page.route('**/api/accounts', (route) => route.fulfill({ json: accounts.map((account) => account.id === saved.id ? saved : account) }));
  await page.route('**/api/accounts/member', (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    requests++;
    saved = { ...saved, status: 'active', updatedAt: '2026-09-05T00:00:00.000Z' };
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/resources');
  const row = page.locator('.people-access-row').filter({ hasText: '侯文驰' });
  await row.getByRole('button', { name: '打开侯文驰操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '允许登录', exact: true }).click();

  await expect(row.getByText('允许登录', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '更新登录状态失败' })).toHaveCount(0);
  expect(requests).toBe(1);
});

test('禁止登录响应未知且账号回读失败时关闭确认并跨导航锁定旧状态', async ({ page }) => {
  await mockAccounts(page);
  let currentAccounts = accounts.map((account) => account.id === 'member' ? {
    ...account,
    activeAssignments: { requirements: 1, workItems: 0, issues: 0 },
  } : account);
  let failReads = false;
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/api/accounts', (route) => failReads
    ? route.fulfill({ status: 503, json: { error: '账号列表读取失败' } })
    : route.fulfill({ json: currentAccounts }));
  await page.route('**/api/accounts/member', (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    requests.push(route.request().postDataJSON());
    currentAccounts = currentAccounts.map((account) => account.id === 'member' ? {
      ...account,
      status: 'disabled',
      updatedAt: '2026-09-05T00:00:00.000Z',
    } : account);
    failReads = true;
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/resources');
  const row = page.locator('.people-access-row').filter({ hasText: '侯文驰' });
  await row.getByRole('button', { name: '打开侯文驰操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '禁止登录', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '禁止账号登录', exact: true });
  await confirmation.getByRole('button', { name: '禁止登录', exact: true }).click();
  await expect(confirmation.getByRole('alert')).toContainText('请关闭窗口后从最新列表重新选择操作');
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();

  await expect(page.getByRole('alert')).toContainText('登录状态结果待核对');
  const actionButton = row.getByRole('button', { name: '打开侯文驰操作', exact: true });
  await expect(actionButton).toBeDisabled();
  await actionButton.evaluate((button) => {
    (button as HTMLButtonElement).disabled = false;
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole('menuitem', { name: '禁止登录', exact: true })).toHaveCount(0);
  expect(requests).toEqual([{ status: 'disabled', expectedUpdatedAt: accounts[1].updatedAt }]);

  const otherActionButton = page.locator('.people-access-row').filter({ hasText: '安少帅' }).getByRole('button', { name: '打开安少帅操作', exact: true });
  await expect(otherActionButton).toBeDisabled();
  await otherActionButton.evaluate((button) => {
    (button as HTMLButtonElement).disabled = false;
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole('menuitem', { name: '禁止登录', exact: true })).toHaveCount(0);
  expect(requests).toHaveLength(1);

  await page.getByRole('link', { name: '项目中心', exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/resources$/);
  await expect(page.getByRole('alert')).toContainText('登录状态结果待核对');
  await expect(actionButton).toBeDisabled();
  await actionButton.evaluate((button) => {
    (button as HTMLButtonElement).disabled = false;
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole('menuitem', { name: '禁止登录', exact: true })).toHaveCount(0);
  expect(requests).toHaveLength(1);

  failReads = false;
  await page.getByRole('button', { name: '重新读取登录状态', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(row.getByText('禁止登录', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);
});

test('允许登录响应未知且账号回读失败时关闭结果仍锁定旧状态', async ({ page }) => {
  await mockAccounts(page);
  let currentAccounts = accounts.map((account) => account.id === 'member'
    ? { ...account, status: 'disabled' as const }
    : account);
  let failReads = false;
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/api/accounts', (route) => failReads
    ? route.fulfill({ status: 503, json: { error: '账号列表读取失败' } })
    : route.fulfill({ json: currentAccounts }));
  await page.route('**/api/accounts/member', (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    requests.push(route.request().postDataJSON());
    currentAccounts = currentAccounts.map((account) => account.id === 'member' ? {
      ...account,
      status: 'active',
      updatedAt: '2026-09-05T00:00:00.000Z',
    } : account);
    failReads = true;
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/resources');
  const row = page.locator('.people-access-row').filter({ hasText: '侯文驰' });
  await row.getByRole('button', { name: '打开侯文驰操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '允许登录', exact: true }).click();
  const result = page.getByRole('dialog', { name: '更新登录状态失败', exact: true });
  await expect(result).toContainText('操作结果暂时无法确认');
  await result.getByRole('button', { name: '知道了', exact: true }).click();

  await expect(page.getByRole('alert')).toContainText('登录状态结果待核对');
  const actionButton = row.getByRole('button', { name: '打开侯文驰操作', exact: true });
  await expect(actionButton).toBeDisabled();
  await actionButton.evaluate((button) => {
    (button as HTMLButtonElement).disabled = false;
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole('menuitem', { name: '允许登录', exact: true })).toHaveCount(0);
  expect(requests).toEqual([{ status: 'active', expectedUpdatedAt: accounts[1].updatedAt }]);

  failReads = false;
  await page.getByRole('button', { name: '重新读取登录状态', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(row.getByText('允许登录', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);
});

test('登录名和平台权限已落库但响应异常时核对目标字段', async ({ page }) => {
  await mockAccounts(page);
  let saved: Account = { ...accounts[1] };
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/api/accounts', (route) => route.fulfill({ json: accounts.map((account) => account.id === saved.id ? saved : account) }));
  await page.route('**/api/accounts/member', (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    if (typeof body.username === 'string') {
      saved = { ...saved, username: body.username, updatedAt: '2026-09-05T00:00:00.000Z' };
    } else if (body.role === 'admin') {
      saved = { ...saved, globalRole: 'admin', role: 'admin', updatedAt: '2026-09-05T00:00:00.001Z' };
    }
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/resources');
  const row = page.locator('.people-access-row').filter({ hasText: '侯文驰' });
  await row.getByRole('button', { name: /登录名：侯文驰/ }).click();
  const username = page.getByRole('dialog').getByLabel('登录名', { exact: true });
  await username.fill('新登录名');
  await username.press('Enter');
  await expect(row.getByText('新登录名', { exact: true })).toBeVisible();

  await row.getByRole('button', { name: /平台权限/ }).click();
  const permission = page.locator('.account-permission-popover');
  await permission.getByLabel('平台角色').selectOption('admin');
  await permission.getByRole('button', { name: '保存权限', exact: true }).click();
  await expect(permission).toHaveCount(0);
  await expect(row.getByText('管理员', { exact: true })).toBeVisible();
  expect(requests).toEqual([
    { username: '新登录名', expectedUpdatedAt: accounts[1].updatedAt },
    { role: 'admin', expectedUpdatedAt: '2026-09-05T00:00:00.000Z' },
  ]);
});

test('登录名响应未知且账号回读失败时关闭编辑器并跨导航锁定旧资料', async ({ page }) => {
  await mockAccounts(page);
  let currentAccounts = structuredClone(accounts);
  let failReads = false;
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/api/accounts', (route) => failReads
    ? route.fulfill({ status: 503, json: { error: '账号列表读取失败' } })
    : route.fulfill({ json: currentAccounts }));
  await page.route('**/api/accounts/member', (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    currentAccounts = currentAccounts.map((account) => account.id === 'member' ? {
      ...account,
      username: String(body.username),
      updatedAt: '2026-09-05T00:00:00.000Z',
    } : account);
    failReads = true;
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/resources');
  const row = page.locator('.people-access-row').filter({ hasText: '侯文驰' });
  const trigger = row.getByRole('button', { name: /登录名：侯文驰/ });
  await trigger.click();
  const input = page.getByRole('textbox', { name: '登录名', exact: true });
  await input.fill('新的登录名');
  await input.press('Enter');
  await expect(input).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(page.getByRole('alert')).toContainText('账号资料结果待核对');
  await expect(trigger).toBeDisabled();
  await trigger.evaluate((button) => {
    (button as HTMLButtonElement).disabled = false;
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole('textbox', { name: '登录名', exact: true })).toHaveCount(0);
  expect(requests).toEqual([{ username: '新的登录名', expectedUpdatedAt: accounts[1].updatedAt }]);

  const otherTrigger = page.locator('.people-access-row').filter({ hasText: '安少帅' }).getByRole('button', { name: /登录名：安少帅/ });
  await expect(otherTrigger).toBeDisabled();
  await otherTrigger.evaluate((button) => {
    (button as HTMLButtonElement).disabled = false;
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole('textbox', { name: '登录名', exact: true })).toHaveCount(0);
  expect(requests).toHaveLength(1);

  await page.getByRole('link', { name: '项目中心', exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/resources$/);
  await expect(page.getByRole('alert')).toContainText('账号资料结果待核对');
  await expect(trigger).toBeDisabled();
  await trigger.evaluate((button) => {
    (button as HTMLButtonElement).disabled = false;
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole('textbox', { name: '登录名', exact: true })).toHaveCount(0);
  expect(requests).toHaveLength(1);

  failReads = false;
  await page.getByRole('button', { name: '重新读取账号资料', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(row.getByText('新的登录名', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);
});

test('平台权限响应未知且账号回读失败时关闭编辑器仍锁定旧资料', async ({ page }) => {
  await mockAccounts(page);
  let currentAccounts = structuredClone(accounts);
  let failReads = false;
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/api/accounts', (route) => failReads
    ? route.fulfill({ status: 503, json: { error: '账号列表读取失败' } })
    : route.fulfill({ json: currentAccounts }));
  await page.route('**/api/accounts/member', (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    currentAccounts = currentAccounts.map((account) => account.id === 'member' ? {
      ...account,
      globalRole: 'admin',
      role: 'admin',
      updatedAt: '2026-09-05T00:00:00.000Z',
    } : account);
    failReads = true;
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/resources');
  const row = page.locator('.people-access-row').filter({ hasText: '侯文驰' });
  const trigger = row.getByRole('button', { name: /平台权限/ });
  await trigger.click();
  const editor = page.locator('.account-permission-popover');
  await editor.getByLabel('平台角色').selectOption('admin');
  await editor.getByRole('button', { name: '保存权限', exact: true }).click();
  await expect(editor).toContainText('操作结果暂时无法确认');
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);

  await expect(page.getByRole('alert')).toContainText('账号资料结果待核对');
  await expect(trigger).toBeDisabled();
  expect(requests).toEqual([{ role: 'admin', expectedUpdatedAt: accounts[1].updatedAt }]);

  failReads = false;
  await page.getByRole('button', { name: '重新读取账号资料', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(row.getByText('管理员', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);
});

test('重置和删除账号确认携带打开时的账号版本', async ({ page }) => {
  await mockAccounts(page);
  const requests: Array<{ action: string; body: Record<string, unknown> }> = [];
  await page.route('**/api/accounts/member/reset-password', (route) => {
    requests.push({ action: 'reset', body: route.request().postDataJSON() });
    return route.fulfill({ json: { ok: true, temporaryPassword: '888888' } });
  });
  await page.route('**/api/accounts/member', (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    requests.push({ action: 'delete', body: route.request().postDataJSON() });
    return route.fulfill({ json: { ok: true } });
  });

  await page.goto('/resources');
  const row = page.locator('.people-access-row').filter({ hasText: '侯文驰' });
  await row.getByRole('button', { name: '打开侯文驰操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '重置密码', exact: true }).click();
  await page.getByRole('button', { name: '确认重置', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '密码已重置', exact: true })).toBeVisible();
  await page.getByRole('dialog', { name: '密码已重置', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
  await row.getByRole('button', { name: '打开侯文驰操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '删除账号', exact: true }).click();
  await page.getByRole('button', { name: '删除账号', exact: true }).click();
  await expect.poll(() => requests).toEqual([
    { action: 'reset', body: { expectedUpdatedAt: accounts[1].updatedAt } },
    { action: 'delete', body: { expectedUpdatedAt: accounts[1].updatedAt } },
  ]);
});

test('重置密码已落库但响应异常时核对账号版本并显示凭据', async ({ page }) => {
  await mockAccounts(page);
  let currentAccounts = structuredClone(accounts);
  let requests = 0;
  await page.route('**/api/accounts', (route) => route.fulfill({ json: currentAccounts }));
  await page.route('**/api/accounts/member/reset-password', (route) => {
    requests++;
    currentAccounts = currentAccounts.map((account) => account.id === 'member' ? {
      ...account,
      mustChangePassword: true,
      updatedAt: '2026-09-05T00:00:00.000Z',
    } : account);
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/resources');
  const row = page.locator('.people-access-row').filter({ hasText: '侯文驰' });
  await row.getByRole('button', { name: '打开侯文驰操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '重置密码', exact: true }).click();
  await page.getByRole('dialog', { name: '重置账号密码', exact: true }).getByRole('button', { name: '确认重置', exact: true }).click();

  const result = page.getByRole('dialog', { name: '密码已重置', exact: true });
  await expect(result).toContainText('已核对最新状态');
  await expect(result).toContainText('888888');
  await expect(page.getByRole('dialog', { name: '重置账号密码', exact: true })).toHaveCount(0);
  await expect(row.getByText('待修改初始密码', { exact: true })).toBeVisible();
  expect(requests).toBe(1);
});

test('重置密码响应未知且账号回读失败时关闭确认并跨导航锁定旧版本', async ({ page }) => {
  await mockAccounts(page);
  let currentAccounts = structuredClone(accounts);
  let failReads = false;
  let requests = 0;
  await page.route('**/api/accounts', (route) => failReads
    ? route.fulfill({ status: 503, json: { error: '账号列表读取失败' } })
    : route.fulfill({ json: currentAccounts }));
  await page.route('**/api/accounts/member/reset-password', (route) => {
    requests += 1;
    currentAccounts = currentAccounts.map((account) => account.id === 'member' ? {
      ...account,
      mustChangePassword: true,
      updatedAt: '2026-09-05T00:00:00.000Z',
    } : account);
    failReads = true;
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/resources');
  const row = page.locator('.people-access-row').filter({ hasText: '侯文驰' });
  const trigger = row.getByRole('button', { name: '打开侯文驰操作', exact: true });
  await trigger.click();
  await page.getByRole('menuitem', { name: '重置密码', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '重置账号密码', exact: true });
  await confirmation.getByRole('button', { name: '确认重置', exact: true }).click();
  await expect(confirmation.getByRole('button', { name: '确认重置', exact: true })).toBeDisabled();
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();

  await expect(page.getByRole('alert')).toContainText('密码重置结果待核对');
  await expect(trigger).toBeDisabled();
  await trigger.evaluate((button) => {
    (button as HTMLButtonElement).disabled = false;
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole('menuitem', { name: '重置密码', exact: true })).toHaveCount(0);
  expect(requests).toBe(1);

  await page.getByRole('link', { name: '项目中心', exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/resources$/);
  await expect(page.getByRole('alert')).toContainText('密码重置结果待核对');
  await expect(trigger).toBeDisabled();
  await trigger.evaluate((button) => {
    (button as HTMLButtonElement).disabled = false;
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole('menuitem', { name: '重置密码', exact: true })).toHaveCount(0);
  expect(requests).toBe(1);

  failReads = false;
  await page.getByRole('button', { name: '重新读取账号', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '密码已重置', exact: true })).toContainText('已核对最新状态');
  await expect(row.getByText('待修改初始密码', { exact: true })).toBeVisible();
});

test('删除账号已落库但响应异常时核对账号消失并关闭确认', async ({ page }) => {
  await mockAccounts(page);
  let currentAccounts = structuredClone(accounts);
  let requests = 0;
  await page.route('**/api/accounts', (route) => route.fulfill({ json: currentAccounts }));
  await page.route('**/api/accounts/member', (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    requests++;
    currentAccounts = currentAccounts.filter((account) => account.id !== 'member');
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'deleted' });
  });

  await page.goto('/resources');
  const row = page.locator('.people-access-row').filter({ hasText: '侯文驰' });
  await row.getByRole('button', { name: '打开侯文驰操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '删除账号', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '删除登录账号', exact: true });
  await confirmation.getByRole('button', { name: '删除账号', exact: true }).click();

  await expect(confirmation).toHaveCount(0);
  await expect(row.getByText('未开通账号', { exact: true })).toBeVisible();
  expect(requests).toBe(1);
});

test('删除账号响应未知且账号回读失败时关闭确认并跨导航锁定旧版本', async ({ page }) => {
  await mockAccounts(page);
  let currentAccounts = structuredClone(accounts);
  let failReads = false;
  let requests = 0;
  await page.route('**/api/accounts', (route) => failReads
    ? route.fulfill({ status: 503, json: { error: '账号列表读取失败' } })
    : route.fulfill({ json: currentAccounts }));
  await page.route('**/api/accounts/member', (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    requests += 1;
    currentAccounts = currentAccounts.filter((account) => account.id !== 'member');
    failReads = true;
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'deleted' });
  });

  await page.goto('/resources');
  const row = page.locator('.people-access-row').filter({ hasText: '侯文驰' });
  await row.getByRole('button', { name: '打开侯文驰操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '删除账号', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '删除登录账号', exact: true });
  await confirmation.getByRole('button', { name: '删除账号', exact: true }).click();
  await expect(confirmation.getByRole('alert')).toContainText('请关闭窗口后从最新列表重新选择操作');
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();

  await expect(page.getByRole('alert')).toContainText('删除账号结果待核对');
  const actionButton = row.getByRole('button', { name: '打开侯文驰操作', exact: true });
  await expect(actionButton).toBeDisabled();
  await actionButton.evaluate((button) => {
    (button as HTMLButtonElement).disabled = false;
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole('menuitem', { name: '删除账号', exact: true })).toHaveCount(0);
  expect(requests).toBe(1);

  await page.getByRole('link', { name: '项目中心', exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/resources$/);
  await expect(page.getByRole('alert')).toContainText('删除账号结果待核对');
  await expect(actionButton).toBeDisabled();
  await actionButton.evaluate((button) => {
    (button as HTMLButtonElement).disabled = false;
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole('menuitem', { name: '删除账号', exact: true })).toHaveCount(0);
  expect(requests).toBe(1);

  failReads = false;
  await page.getByRole('button', { name: '重新读取账号', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(row.getByText('未开通账号', { exact: true })).toBeVisible();
  expect(requests).toBe(1);
});

test('账号确认期间后台更新后锁定旧版本并要求重新选择', async ({ page }) => {
  await mockAccounts(page);
  let currentAccounts = structuredClone(accounts);
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/api/accounts', (route) => route.fulfill({ json: currentAccounts }));
  await page.route('**/api/accounts/member/reset-password', (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true, temporaryPassword: '888888' } });
  });

  await page.goto('/resources');
  const row = page.locator('.people-access-row').filter({ hasText: '侯文驰' });
  await row.getByRole('button', { name: '打开侯文驰操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '重置密码', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '重置账号密码', exact: true });
  currentAccounts = currentAccounts.map((account) => account.id === 'member'
    ? { ...account, username: '后台更新的登录名', updatedAt: '2026-09-02' }
    : account);
  await reconnect(page);

  await expect(row.getByText('后台更新的登录名', { exact: true })).toBeVisible();
  await expect(dialog).toContainText('将“侯文驰”的密码重置');
  await expect(dialog.getByRole('alert')).toContainText('账号已更新');
  await expect(dialog.getByRole('button', { name: '确认重置', exact: true })).toBeDisabled();
  expect(requests).toHaveLength(0);

  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await row.getByRole('button', { name: '打开后台更新的登录名操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '重置密码', exact: true }).click();
  await page.getByRole('dialog', { name: '重置账号密码', exact: true }).getByRole('button', { name: '确认重置', exact: true }).click();
  await expect.poll(() => requests).toEqual([{ expectedUpdatedAt: '2026-09-02' }]);
});

test('账号确认返回版本冲突后不能重复提交旧操作', async ({ page }) => {
  await mockAccounts(page);
  let currentAccounts = structuredClone(accounts);
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/api/accounts', (route) => route.fulfill({ json: currentAccounts }));
  await page.route('**/api/accounts/member/reset-password', (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) {
      currentAccounts = currentAccounts.map((account) => account.id === 'member' ? { ...account, updatedAt: '2026-09-02' } : account);
      return route.fulfill({ status: 409, json: { error: '账号已被其他用户修改', code: 'STALE_WRITE' } });
    }
    return route.fulfill({ json: { ok: true, temporaryPassword: '888888' } });
  });

  await page.goto('/resources');
  const row = page.locator('.people-access-row').filter({ hasText: '侯文驰' });
  await row.getByRole('button', { name: '打开侯文驰操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '重置密码', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '重置账号密码', exact: true });
  await dialog.getByRole('button', { name: '确认重置', exact: true }).click();

  await expect(dialog.getByRole('alert')).toContainText('请关闭窗口后从最新列表重新选择操作');
  await expect(dialog.getByRole('button', { name: '确认重置', exact: true })).toBeDisabled();
  await dialog.locator('.form-actions button').last().evaluate((button) => (button as HTMLButtonElement).click());
  expect(requests).toEqual([{ expectedUpdatedAt: accounts[1].updatedAt }]);

  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await row.getByRole('button', { name: '打开侯文驰操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '重置密码', exact: true }).click();
  await page.getByRole('dialog', { name: '重置账号密码', exact: true }).getByRole('button', { name: '确认重置', exact: true }).click();
  await expect.poll(() => requests).toEqual([
    { expectedUpdatedAt: accounts[1].updatedAt },
    { expectedUpdatedAt: '2026-09-02' },
  ]);
});

test('禁止登录确认期间在办任务变化后重新核对影响数量', async ({ page }) => {
  await mockAccounts(page);
  let currentAccounts = structuredClone(accounts);
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/api/accounts', (route) => route.fulfill({ json: currentAccounts }));
  await page.route('**/api/accounts/member', (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    requests.push(route.request().postDataJSON());
    currentAccounts = currentAccounts.map((account) => account.id === 'member' ? { ...account, status: 'disabled' as const } : account);
    return route.fulfill({ json: currentAccounts.find((account) => account.id === 'member') });
  });

  await page.goto('/resources');
  const row = page.locator('.people-access-row').filter({ hasText: '侯文驰' });
  await row.getByRole('button', { name: '打开侯文驰操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '禁止登录', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '禁止账号登录', exact: true });
  currentAccounts = currentAccounts.map((account) => account.id === 'member'
    ? { ...account, activeAssignments: { requirements: 1, workItems: 2, issues: 1 } }
    : account);
  await reconnect(page);

  await expect(dialog.getByRole('alert')).toContainText('在办任务已变化');
  await expect(dialog.getByRole('button', { name: '禁止登录', exact: true })).toBeDisabled();
  expect(requests).toHaveLength(0);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();

  await row.getByRole('button', { name: '打开侯文驰操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '禁止登录', exact: true }).click();
  const latestDialog = page.getByRole('dialog', { name: '禁止账号登录', exact: true });
  await expect(latestDialog).toContainText('当前关联需求 1 项、工作项 2 项、问题 1 项');
  await latestDialog.getByRole('button', { name: '禁止登录', exact: true }).click();
  await expect.poll(() => requests).toEqual([{ status: 'disabled', expectedUpdatedAt: accounts[1].updatedAt }]);
});

test('人员归档确认期间项目经理范围变化后锁定旧确认', async ({ page }) => {
  await mockAccounts(page);
  let currentAccounts = structuredClone(accounts);
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/api/accounts', (route) => route.fulfill({ json: currentAccounts }));
  await page.route('**/api/people/u1', (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });

  await page.goto('/resources');
  const row = page.locator('.people-access-row').filter({ hasText: '侯文驰' });
  await row.getByRole('button', { name: '打开侯文驰操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '归档人员', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '归档人员', exact: true });
  currentAccounts = currentAccounts.map((account) => account.id === 'member'
    ? { ...account, role: 'project_manager' as const, managedProjects: [{ id: 'p1', name: 'DCIM' }] }
    : account);
  await reconnect(page);

  await expect(dialog.getByRole('alert')).toContainText('项目角色已变化');
  await expect(dialog.getByRole('button', { name: '确认归档', exact: true })).toBeDisabled();
  expect(requests).toHaveLength(0);
});

test('归档人员已落库但响应异常时同时核对活动与归档列表', async ({ page }) => {
  await mockAccounts(page);
  let currentPeople = structuredClone(people);
  let currentArchives: Archives = { projects: [], requirements: [], people: [], templates: [] };
  let requests = 0;
  await page.route('**/api/people', (route) => route.fulfill({ json: currentPeople }));
  await page.route('**/api/archives', (route) => route.fulfill({ json: currentArchives }));
  await page.route('**/api/people/u1', (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    requests++;
    currentPeople = currentPeople.filter((person) => person.id !== 'u1');
    currentArchives = {
      ...currentArchives,
      people: [{ id: 'u1', title: '侯文驰', jobTitle: '后端工程师', deletedAt: '2026-09-05T00:00:00.000Z' }],
    };
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'archived' });
  });

  await page.goto('/resources');
  const row = page.locator('.people-access-row').filter({ hasText: '侯文驰' });
  await row.getByRole('button', { name: '打开侯文驰操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '归档人员', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '归档人员', exact: true });
  await dialog.getByRole('button', { name: '确认归档', exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(row).toHaveCount(0);
  expect(requests).toBe(1);
});

test('归档人员响应未知且双列表回读失败时关闭确认并跨导航锁定旧人员', async ({ page }) => {
  await mockAccounts(page);
  let currentPeople = structuredClone(people);
  let currentArchives: Archives = { projects: [], requirements: [], people: [], templates: [] };
  let failReads = false;
  let requests = 0;
  await page.route('**/api/people', (route) => failReads
    ? route.fulfill({ status: 503, json: { error: '活动人员读取失败' } })
    : route.fulfill({ json: currentPeople }));
  await page.route('**/api/archives', (route) => failReads
    ? route.fulfill({ status: 503, json: { error: '归档列表读取失败' } })
    : route.fulfill({ json: currentArchives }));
  await page.route('**/api/people/u1', (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    requests += 1;
    currentPeople = currentPeople.filter((person) => person.id !== 'u1');
    currentArchives = {
      ...currentArchives,
      people: [{ id: 'u1', title: '侯文驰', jobTitle: '后端工程师', deletedAt: '2026-09-05T00:00:00.000Z' }],
    };
    failReads = true;
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'archived' });
  });

  await page.goto('/resources');
  const row = page.locator('.people-access-row').filter({ hasText: '侯文驰' });
  await row.getByRole('button', { name: '打开侯文驰操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '归档人员', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '归档人员', exact: true });
  await confirmation.getByRole('button', { name: '确认归档', exact: true }).click();
  await expect(confirmation.getByRole('alert')).toContainText('请关闭窗口后从最新列表重新选择操作');
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();

  await expect(page.getByRole('alert')).toContainText('人员归档结果待核对');
  const actionButton = row.getByRole('button', { name: '打开侯文驰操作', exact: true });
  await expect(actionButton).toBeDisabled();
  await actionButton.evaluate((button) => {
    (button as HTMLButtonElement).disabled = false;
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole('menuitem', { name: '归档人员', exact: true })).toHaveCount(0);
  expect(requests).toBe(1);

  await page.getByRole('link', { name: '项目中心', exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/resources$/);
  await expect(page.getByRole('alert')).toContainText('人员归档结果待核对');
  await expect(actionButton).toBeDisabled();
  await actionButton.evaluate((button) => {
    (button as HTMLButtonElement).disabled = false;
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole('menuitem', { name: '归档人员', exact: true })).toHaveCount(0);
  expect(requests).toBe(1);

  failReads = false;
  await page.getByRole('button', { name: '重新读取归档状态', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(row).toHaveCount(0);
  expect(requests).toBe(1);
});

test('人员资料保存期间锁定同一行的其他字段和账号操作', async ({ page }) => {
  await mockAccounts(page);
  let saved = { ...people[0] };
  let releaseSave!: () => void;
  const waitingSave = new Promise<void>((resolve) => { releaseSave = resolve; });
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/api/people', (route) => route.fulfill({ json: people.map((person) => person.id === saved.id ? saved : person) }));
  await page.route('**/api/people/u1', async (route) => {
    const input = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(input);
    await waitingSave;
    saved = { ...saved, ...input };
    return route.fulfill({ json: saved });
  });

  try {
    await page.goto('/resources');
    const row = page.locator('.people-access-row').filter({ hasText: '侯文驰' });
    const name = row.getByRole('button', { name: /人员姓名/ });
    const jobTitle = row.getByRole('button', { name: /岗位：/ });
    await name.click();
    await page.getByRole('textbox', { name: '人员姓名', exact: true }).fill('侯文驰（新）');
    await page.getByRole('textbox', { name: '人员姓名', exact: true }).press('Enter');
    await expect.poll(() => requests).toEqual([{ name: '侯文驰（新）', expectedUpdatedAt: people[0].updatedAt }]);
    await expect(jobTitle).toBeDisabled();
    await expect(row.getByRole('button', { name: /登录名/ })).toBeDisabled();
    await expect(row.getByRole('button', { name: /平台权限/ })).toBeDisabled();
    await expect(row.getByRole('button', { name: '打开侯文驰操作', exact: true })).toBeDisabled();
    await jobTitle.evaluate((button) => (button as HTMLButtonElement).click());
    await expect(page.getByRole('textbox', { name: '岗位', exact: true })).toHaveCount(0);
    expect(requests).toHaveLength(1);
  } finally { releaseSave(); }
  const savedRow = page.locator('.people-access-row').filter({ hasText: '侯文驰（新）' });
  await expect(savedRow.getByText('侯文驰（新）', { exact: true })).toBeVisible();
  await expect(savedRow.getByRole('button', { name: /岗位：/ })).toBeEnabled();
});

test('人员姓名和岗位已落库但响应异常时核对目标字段', async ({ page }) => {
  await mockAccounts(page);
  let saved: Person = { ...people[0] };
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/api/people', (route) => route.fulfill({ json: people.map((person) => person.id === saved.id ? saved : person) }));
  await page.route('**/api/people/u1', (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    if (typeof body.name === 'string') saved = { ...saved, name: body.name, updatedAt: '2026-09-05T00:00:00.000Z' };
    if (typeof body.jobTitle === 'string') saved = { ...saved, jobTitle: body.jobTitle, updatedAt: '2026-09-05T00:00:00.001Z' };
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/resources');
  const row = page.locator('.people-access-row').filter({ hasText: '侯文驰' });
  await row.getByRole('button', { name: /人员姓名：侯文驰/ }).click();
  const name = page.getByRole('textbox', { name: '人员姓名', exact: true });
  await name.fill('侯文驰（新）');
  await name.press('Enter');
  await expect(row.getByText('侯文驰（新）', { exact: true })).toBeVisible();

  await row.getByRole('button', { name: /岗位：后端工程师/ }).click();
  const jobTitle = page.getByRole('textbox', { name: '岗位', exact: true });
  await jobTitle.fill('架构师');
  await jobTitle.press('Enter');
  await expect(row.getByText('架构师', { exact: true })).toBeVisible();
  expect(requests).toEqual([
    { name: '侯文驰（新）', expectedUpdatedAt: people[0].updatedAt },
    { jobTitle: '架构师', expectedUpdatedAt: '2026-09-05T00:00:00.000Z' },
  ]);
});

test('人员姓名响应未知且人员回读失败时关闭编辑器并跨导航锁定旧资料', async ({ page }) => {
  await mockAccounts(page);
  let currentPeople = structuredClone(people);
  let failReads = false;
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/api/people', (route) => failReads
    ? route.fulfill({ status: 503, json: { error: '人员列表读取失败' } })
    : route.fulfill({ json: currentPeople }));
  await page.route('**/api/people/u1', (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    currentPeople = currentPeople.map((person) => person.id === 'u1' ? {
      ...person,
      name: String(body.name),
      updatedAt: '2026-09-05T00:00:00.000Z',
    } : person);
    failReads = true;
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/resources');
  const row = page.locator('.people-access-row').filter({ hasText: '侯文驰' });
  const trigger = row.getByRole('button', { name: /人员姓名：侯文驰/ });
  await trigger.click();
  const input = page.getByRole('textbox', { name: '人员姓名', exact: true });
  await input.fill('新的人员姓名');
  await input.press('Enter');
  await expect(input).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(page.getByRole('alert')).toContainText('人员资料结果待核对');
  await expect(trigger).toBeDisabled();
  await trigger.evaluate((button) => {
    (button as HTMLButtonElement).disabled = false;
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole('textbox', { name: '人员姓名', exact: true })).toHaveCount(0);
  expect(requests).toEqual([{ name: '新的人员姓名', expectedUpdatedAt: people[0].updatedAt }]);

  const otherTrigger = page.locator('.people-access-row').filter({ hasText: '安少帅' }).getByRole('button', { name: /人员姓名：安少帅/ });
  await expect(otherTrigger).toBeDisabled();
  await otherTrigger.evaluate((button) => {
    (button as HTMLButtonElement).disabled = false;
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole('textbox', { name: '人员姓名', exact: true })).toHaveCount(0);
  expect(requests).toHaveLength(1);

  await page.getByRole('link', { name: '项目中心', exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/resources$/);
  await expect(page.getByRole('alert')).toContainText('人员资料结果待核对');
  await expect(trigger).toBeDisabled();
  await trigger.evaluate((button) => {
    (button as HTMLButtonElement).disabled = false;
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole('textbox', { name: '人员姓名', exact: true })).toHaveCount(0);
  expect(requests).toHaveLength(1);

  failReads = false;
  await page.getByRole('button', { name: '重新读取人员资料', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(row.getByText('新的人员姓名', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);
});

test('人员姓名草稿遇到后台更新时保留旧版本，重读后才可保存', async ({ page }) => {
  await mockAccounts(page);
  let currentPeople = structuredClone(people);
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/api/people', (route) => route.fulfill({ json: currentPeople }));
  await page.route('**/api/people/u1', (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    const saved = { ...currentPeople[0], ...body, updatedAt: '2026-09-03' };
    currentPeople = currentPeople.map((person) => person.id === 'u1' ? saved : person);
    return route.fulfill({ json: saved });
  });

  await page.goto('/resources');
  const row = page.locator('.people-access-row').filter({ hasText: '侯文驰' });
  await row.getByRole('button', { name: /人员姓名/ }).click();
  const input = page.getByRole('textbox', { name: '人员姓名', exact: true });
  await input.fill('本地人员姓名草稿');
  currentPeople = currentPeople.map((person) => person.id === 'u1'
    ? { ...person, name: '后台更新的人员姓名', updatedAt: '2026-09-02' }
    : person);
  await reconnect(page);

  await expect(input).toHaveValue('本地人员姓名草稿');
  await input.press('Enter');
  await expect(page.getByRole('alert')).toContainText('人员已更新');
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: '重新读取人员', exact: true }).click();
  await expect(input).toHaveValue('本地人员姓名草稿');
  await input.press('Enter');
  await expect.poll(() => requests).toEqual([{ name: '本地人员姓名草稿', expectedUpdatedAt: '2026-09-02' }]);
});

test('登录名草稿遇到后台更新时使用打开时账号版本', async ({ page }) => {
  await mockAccounts(page);
  let currentAccounts = structuredClone(accounts);
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/api/accounts', (route) => route.fulfill({ json: currentAccounts }));
  await page.route('**/api/accounts/member', (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    const saved = { ...currentAccounts[1], ...body, updatedAt: '2026-09-03' };
    currentAccounts = currentAccounts.map((account) => account.id === 'member' ? saved : account);
    return route.fulfill({ json: saved });
  });

  await page.goto('/resources');
  const row = page.locator('.people-access-row').filter({ hasText: '侯文驰' });
  await row.getByRole('button', { name: /登录名/ }).click();
  const input = page.getByRole('textbox', { name: '登录名', exact: true });
  await input.fill('本地登录名草稿');
  currentAccounts = currentAccounts.map((account) => account.id === 'member'
    ? { ...account, username: '后台更新的登录名', updatedAt: '2026-09-02' }
    : account);
  await reconnect(page);

  await expect(input).toHaveValue('本地登录名草稿');
  await input.press('Enter');
  await expect(page.getByRole('alert')).toContainText('账号已更新');
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: '重新读取账号', exact: true }).click();
  await expect(input).toHaveValue('本地登录名草稿');
  await input.press('Enter');
  await expect.poll(() => requests).toEqual([{ username: '本地登录名草稿', expectedUpdatedAt: '2026-09-02' }]);
});

test('平台权限选择遇到后台更新时必须重新读取并重新选择', async ({ page }) => {
  await mockAccounts(page);
  let currentAccounts = structuredClone(accounts);
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/api/accounts', (route) => route.fulfill({ json: currentAccounts }));
  await page.route('**/api/accounts/member', (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    const saved = { ...currentAccounts[1], ...body, globalRole: body.role, updatedAt: '2026-09-03' } as Account;
    currentAccounts = currentAccounts.map((account) => account.id === 'member' ? saved : account);
    return route.fulfill({ json: saved });
  });

  await page.goto('/resources');
  const row = page.locator('.people-access-row').filter({ hasText: '侯文驰' });
  await row.getByRole('button', { name: /平台权限/ }).click();
  const editor = page.locator('.account-permission-popover');
  const select = editor.getByLabel('平台角色');
  await select.selectOption('admin');
  currentAccounts = currentAccounts.map((account) => account.id === 'member'
    ? { ...account, username: '后台更新但仍为普通用户', updatedAt: '2026-09-02' }
    : account);
  await reconnect(page);

  await expect(editor.locator('.warning-banner')).toContainText('账号权限已更新');
  await expect(editor.getByRole('button', { name: '保存权限', exact: true })).toBeDisabled();
  expect(requests).toHaveLength(0);
  await editor.getByRole('button', { name: '重新读取账号', exact: true }).click();
  await expect(select).toHaveValue('user');
  await select.selectOption('admin');
  await editor.getByRole('button', { name: '保存权限', exact: true }).click();
  await expect.poll(() => requests).toEqual([{ role: 'admin', expectedUpdatedAt: '2026-09-02' }]);
});

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
    await expect(page.locator('.account-actions-trigger')).toHaveCount(3);

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

test('移除项目成员失败保留原因，重试成功关闭确认框并更新列表', async ({ page }) => {
  await mockAccounts(page);
  let attempts = 0;
  let removed = false;
  const payloads: Array<Record<string, unknown>> = [];
  await page.route(/\/api\/projects\/p1\/members(?:\/u1)?$/, async (route) => {
    if (route.request().method() === 'DELETE') {
      attempts += 1;
      payloads.push(route.request().postDataJSON());
      if (attempts === 1) return route.fulfill({ status: 409, json: { error: '仍有未完成任务，请先重新分配' } });
      removed = true;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: people.slice(removed ? 1 : 0, 2).map((person) => ({ ...person, projectRole: person.id === 'u2' ? 'manager' : 'member', membershipUpdatedAt })) });
  });
  await page.goto('/project-settings');
  await page.locator('.project-member-row').filter({ hasText: '侯文驰' }).getByRole('button', { name: '移除', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '移出项目成员' });
  await confirmation.getByRole('button', { name: '确认移出' }).click();
  await expect(confirmation.getByRole('alert')).toHaveText('仍有未完成任务，请先重新分配');
  await expect(page.locator('.project-member-row')).toHaveCount(2);
  await confirmation.getByRole('button', { name: '确认移出' }).click();
  await expect(page.locator('.project-member-row')).toHaveCount(1);
  await expect(confirmation).toHaveCount(0);
  expect(attempts).toBe(2);
  expect(payloads).toEqual([
    { expectedMembershipUpdatedAt: membershipUpdatedAt },
    { expectedMembershipUpdatedAt: membershipUpdatedAt },
  ]);
});
