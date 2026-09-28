import { expect, test, type Page } from '@playwright/test';
import { mockGanttData, ganttRequirements } from './gantt-fixture';
import { jiraConnectionMessages, jiraSetupMessages, jiraSettingsSchema, type JiraAction, type JiraConnection, type JiraProgressRow, type JiraScan } from '../../src/shared/jira';

async function fixture(page: Page, options: { configured?: boolean; rejectSave?: boolean; loseExecuteResponse?: boolean; required?: boolean; noActions?: boolean } = {}) {
  await mockGanttData(page);
  let writes = 0, scans = 0, refreshes = 0, credential = '', settingsVersion = 1;
  let connection: JiraConnection = { configured: true, available: true, baseUrl: 'https://jira.example.test', version: 'v1', verifiedAt: '2026-09-21T01:00:00Z', identity: '测试用户 (tester)', problem: null, setupIssue: null };
  if (options.configured === false) connection = { ...connection, configured: false, version: '', verifiedAt: null, identity: null };
  const local = { ...ganttRequirements[0], id: 'r1', title: '权限授权管理', status: 'completed' };
  let settings = jiraSettingsSchema.parse({ projects: ['DCIM'] });
  const issue = { id: '101', key: 'DCIM-39', title: '权限授权管理', type: 'Story', typeId: 'story', status: { id: 'testing', name: '测试' }, updated: '1', url: 'https://jira.example.test/browse/DCIM-39' };
  const rows: JiraProgressRow[] = Array.from({ length: 26 }, (_, i) => ({
    requirementId: i ? 'local-' + i : 'r1', title: i ? '需求 ' + String(i + 1).padStart(2, '0') : local.title,
    featureId: i % 2 ? 'f2' : 'f1', featureName: i % 2 ? '设备管理' : '权限管理', phaseId: i % 2 ? 'ph2' : 'ph1', phaseName: i % 2 ? 'Phase 2' : 'Phase 1',
    localStatus: i === 0 ? 'completed' : i === 25 ? 'cancelled' : 'in_progress',
    binding: i > 21 ? null : { issueId: i ? String(i + 101) : issue.id, key: i ? 'DCIM-' + (i + 39) : issue.key, url: 'https://jira.example.test/browse/DCIM-' + (i + 39) },
    issue: i > 20 ? null : { ...issue, status: { ...issue.status }, title: i ? '需求 ' + String(i + 1).padStart(2, '0') : local.title, id: String(i + 101), key: 'DCIM-' + (i + 39) },
    checkedAt: i > 20 ? null : '2026-09-21T02:00:00Z', readState: i > 20 ? 'unread' : 'success', problem: null, references: [],
  }));
  const scan: JiraScan = { id: 'scan1', checkedAt: '2026-09-21T02:00:00Z', complete: true, total: 1, nextStartAt: null, warnings: [], rows: [
    { association: 'none', key: 'DCIM-99', issue: { ...issue, id: '999', key: 'DCIM-99', title: '新的权限需求', url: 'https://jira.example.test/browse/DCIM-99' }, requirementId: null, requirementTitle: null, featureName: null, phaseName: null, localStatus: null, candidates: [], ignored: false, problem: null },
  ] };
  let preview: JiraAction | null = null;
  await page.route('**/api/tokens', route => route.fulfill({ json: [] }));
  await page.route('**/api/projects/p1/requirement-intake', route => route.fulfill({ json: { features: [] } }));
  await page.route('**/api/requirements?**', route => route.fulfill({ json: rows.map(r => ({ ...local, id: r.requirementId, title: r.title, status: r.localStatus })) }));
  await page.route('**/api/requirements/r1', route => route.fulfill({ json: local }));
  await page.route('**/api/me/jira-connection**', async route => {
    const request = route.request();
    if (request.method() === 'PUT') {
      if (options.rejectSave) return route.fulfill({ status: 502, json: { error: jiraConnectionMessages.invalidToken, code: 'JIRA_AUTH_FAILED' } });
      credential = request.postDataJSON().token; connection = { ...connection, configured: true, version: 'v2', verifiedAt: '2026-09-21T03:00:00Z', identity: '已验证用户 (tester)' };
    }
    if (request.url().endsWith('/test')) connection = { ...connection, verifiedAt: '2026-09-21T03:00:00Z', identity: '已验证用户 (tester)' };
    if (request.method() === 'DELETE') connection = { ...connection, configured: false, verifiedAt: null, identity: null };
    await route.fulfill({ json: connection });
  });
  await page.route('**/api/projects/p1/jira/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith('/prs')) return route.fulfill({ json: [] });
    const transition = rows[0].issue!.status.id === 'acceptance'
      ? { id: '61', name: '验收通过', to: { id: 'done', name: '完成' } }
      : { id: '51', name: '测试通过', to: { id: 'acceptance', name: '验收' } };
    if (path.endsWith('/metadata')) {
      const params = new URL(request.url()).searchParams;
      if (params.get('kind') === 'projects') return route.fulfill({ json: [{ id: '100', key: 'DCIM', name: '数据中心管理' }, { id: '101', key: 'NEW', name: '新项目' }] });
      if (params.get('kind') === 'types') return route.fulfill({ json: ['Story', 'Task'].map(name => ({ id: name.toLowerCase(), name, statuses: [] })) });
      if (params.get('kind') === 'components') return route.fulfill({ json: [{ id: 'c1', name: '平台' }] });
      if (params.get('kind') === 'users') return route.fulfill({ json: [{ name: 'tester', displayName: '测试用户' }] });
      if (params.get('kind') === 'labels') return route.fulfill({ json: ['release'] });
    }
    if (path.endsWith('/settings')) {
      if (request.method() === 'PUT') { settings = request.postDataJSON().settings; settingsVersion++; }
      return route.fulfill({ json: { version: settingsVersion, settings } });
    }
    if (path.endsWith('/progress')) return route.fulfill({ json: { rows } });
    if (path.endsWith('/progress/refresh')) { refreshes++; return route.fulfill({ json: { id: 'refresh1', offset: 22, total: 22, complete: true, failed: 0 } }); }
    if (path.endsWith('/transitions')) return route.fulfill({ json: { requirementId: 'r1', bindingVersion: 'b1', credentialVersion: connection.version, issue: rows[0].issue, transitions: options.noActions ? [] : [{ ...transition, requiredFields: options.required ? ['验收记录'] : [] }] } });
    if (path.includes('/requirements/')) return route.fulfill({ json: rows.find(r => r.requirementId === path.split('/').at(-1)) || null });
    if (path.endsWith('/scan')) { if (request.method() === 'POST') scans++; return route.fulfill({ json: scan }); }
    if (path.endsWith('/action-preview')) {
      preview = { id: 'preview1', legacy: false, createdAt: '2026-09-21T03:00:00Z', state: 'preview', items: [{ key: issue.key, issueId: issue.id, site: connection.baseUrl, requirementId: 'r1', title: local.title, from: rows[0].issue!.status, target: transition.to, transitionId: transition.id, transitionName: transition.name, reason: request.postDataJSON().reason, outcome: 'ready', message: null, observed: null }] };
      return route.fulfill({ json: preview });
    }
    if (path.endsWith('/execute')) {
      writes++; preview = { ...preview!, state: 'finished', items: preview!.items.map(i => ({ ...i, outcome: 'success', message: 'Jira 状态已修改' })) };
      rows[0].issue = { ...issue, status: preview.items[0].target };
      if (options.loseExecuteResponse) return route.abort('failed');
      return route.fulfill({ json: preview });
    }
    if (path.endsWith('/operations')) return route.fulfill({ json: preview ? [preview] : [] });
    if (path.includes('/operations/')) return route.fulfill({ json: preview });
    if (path.endsWith('/import-preview')) return route.fulfill({ json: { id: 'import1', issue: scan.rows[0].issue, links: [{ title: 'DCIM-99', url: scan.rows[0].issue!.url, kind: 'task' }, { title: '设计文档', url: 'https://ec-confluence.jereh.cn/pages/viewpage.action?pageId=1', kind: 'document' }], warnings: [] } });
    if (path.includes('/imports/')) {
      scan.rows[0] = { ...scan.rows[0], association: 'linked', requirementId: 'imported' };
      rows.push({ ...rows[0], requirementId: 'imported', title: request.postDataJSON().title, localStatus: 'not_started' });
      return route.fulfill({ json: { ...local, id: 'imported', ...request.postDataJSON(), status: 'not_started' } });
    }
    if (path.endsWith('/ignored')) { const data = request.postDataJSON(); scan.rows = scan.rows.map(r => r.key === data.key ? { ...r, ignored: data.ignored } : r); return route.fulfill({ json: { ok: true } }); }
    if (path.endsWith('/bindings')) {
      const data = request.postDataJSON(), row = rows.find(r => r.requirementId === data.requirementId)!;
      row.binding = { issueId: '999', key: data.key, url: connection.baseUrl + '/browse/' + data.key };
      scan.rows = scan.rows.map(r => r.key === data.key ? { ...r, association: 'linked', requirementId: row.requirementId } : r);
      return route.fulfill({ json: { ok: true } });
    }
    if (path.includes('/bindings/')) { const row = rows.find(r => r.requirementId === path.split('/').at(-1))!; row.binding = null; row.issue = null; return route.fulfill({ json: { ok: true } }); }
    return route.fulfill({ status: 404, json: { error: 'Unexpected mock request: ' + path } });
  });
  return { writes: () => writes, scans: () => scans, refreshes: () => refreshes, credential: () => credential, connection: () => connection, settings: () => settings, rows, scan };
}
async function choose(page: Page, name: string, value: string) {
  await page.getByRole('combobox', { name, exact: true }).click();
  await page.getByRole('option', { name: value, exact: true }).click();
}
async function openAction(page: Page) {
  await page.getByRole('row').filter({ has: page.getByRole('link', { name: 'DCIM-39', exact: true }) }).getByRole('button', { name: '修改状态', exact: true }).click();
}

test('进展列表真实分页和全量筛选，翻页和本地筛选不调用 Jira', async ({ page }) => {
  const mock = await fixture(page); await page.goto('/jira');
  await expect(page.getByRole('heading', { name: 'Jira 进展管理', exact: true })).toBeVisible();
  await expect(page.locator('.adaptive-data-row')).toHaveCount(20);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('.adaptive-data-row')).toHaveCount(6);
  await page.getByRole('searchbox', { name: '搜索 Jira 需求' }).fill('权限授权');
  await expect(page.locator('.adaptive-data-row')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'DCIM-39', exact: true })).toBeVisible();
  await page.getByRole('searchbox').fill('');
  await choose(page, '本地状态', '已取消'); await expect(page.locator('.adaptive-data-row')).toHaveCount(1);
  await expect(page.getByRole('link', { name: '需求 26', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await choose(page, 'Feature', '设备管理'); await expect(page.getByRole('navigation', { name: 'Jira 需求分页' })).toContainText('共 13 条');
  await choose(page, 'Phase', 'Phase 2'); await expect(page.locator('.adaptive-data-row')).toHaveCount(13);
  await choose(page, '关联情况', '未关联'); await expect(page.locator('.adaptive-data-row')).toHaveCount(2);
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await choose(page, 'Jira 状态', '测试'); await expect(page.getByRole('navigation', { name: 'Jira 需求分页' })).toContainText('共 21 条');
  await choose(page, '读取结果', '尚未读取'); await expect(page.locator('.adaptive-data-row')).toHaveCount(0);
  expect(mock.scans()).toBe(0); expect(mock.refreshes()).toBe(0); expect(mock.writes()).toBe(0);
});

test('Feature 与 Phase 联动，同名阶段隔离，切换特性清除旧阶段', async ({ page }) => {
  const mock = await fixture(page);
  mock.rows.filter(r => r.featureId === 'f2').forEach(r => { r.phaseName = 'Phase 1'; });
  for (let i = 2; i < 9; i++) { mock.rows[i].phaseId = 'extra-' + i; mock.rows[i].phaseName = 'Phase ' + i; }
  mock.rows[25].phaseId = null; mock.rows[25].phaseName = null;
  await page.goto('/jira');
  await expect(page.getByRole('combobox', { name: 'Phase', exact: true })).toBeDisabled();
  await choose(page, 'Feature', '设备管理');
  await page.getByRole('combobox', { name: 'Phase', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Phase 1', exact: true })).toHaveCount(1);
  await expect(page.getByRole('option', { name: 'Phase 2', exact: true })).toHaveCount(0);
  await page.getByRole('option', { name: 'Phase 1', exact: true }).click();
  await expect(page.locator('.adaptive-data-row')).toHaveCount(9);
  await expect(page.getByRole('link', { name: '权限授权管理', exact: true })).toHaveCount(0);
  await choose(page, 'Phase', '未归属 Phase');
  await expect(page.locator('.adaptive-data-row')).toHaveCount(1);
  await expect(page.getByRole('link', { name: '需求 26', exact: true })).toBeVisible();
  await choose(page, 'Feature', '权限管理');
  await expect(page.getByRole('combobox', { name: 'Phase', exact: true })).toHaveText('全部 Phase');
  await expect(page.locator('.adaptive-data-row')).toHaveCount(13);
  await choose(page, 'Phase', 'Phase 1');
  await expect(page.locator('.adaptive-data-row')).toHaveCount(9);
  await choose(page, 'Feature', '全部 Feature');
  await expect(page.getByRole('combobox', { name: 'Phase', exact: true })).toBeDisabled();
  await expect(page.getByRole('navigation', { name: 'Jira 需求分页' })).toContainText('共 26 条');
  expect(mock.refreshes()).toBe(0); expect(mock.scans()).toBe(0);
});

test('两个视图搜索与筛选栏等高，切换后列表起点不跳动', { tag: '@responsive' }, async ({ page }, info) => {
  await fixture(page); await page.goto('/jira');
  const tabs = page.getByRole('group', { name: 'Jira 视图', exact: true });
  for (const viewport of [page.viewportSize()!, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await tabs.getByRole('button', { name: '需求进展', exact: true }).click();
    await expect(page.locator('.adaptive-data-row')).toHaveCount(20);
    const fields = (await page.getByRole('group', { name: 'Jira 筛选条件' }).boundingBox())!;
    const phase = (await page.getByRole('combobox', { name: 'Phase', exact: true }).boundingBox())!;
    expect(phase.x + phase.width).toBeLessThanOrEqual(fields.x + fields.width + 1);
    const geometry = () => page.locator('.jira-progress-page').evaluate(root => ['.filter-bar', '.search-box', '.adaptive-data-list'].map(selector => {
      const rect = root.querySelector(selector)!.getBoundingClientRect(); return { y: rect.y, height: selector === '.adaptive-data-list' ? 0 : rect.height };
    }));
    const before = await geometry();
    await page.screenshot({ path: info.outputPath('progress-filters-' + viewport.width + '.png') });
    await tabs.getByRole('button', { name: '发现未纳入需求', exact: true }).click();
    await expect(page.locator('.adaptive-data-row')).toHaveCount(1);
    expect(await geometry()).toEqual(before);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: info.outputPath('discovery-filters-' + viewport.width + '.png') });
  }
});

test('视图常驻切换，分别保留筛选和页码，面包屑完整且连接状态在列表下方', { tag: '@responsive' }, async ({ page }, info) => {
  const mock = await fixture(page); await page.goto('/jira?projectId=p1');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  const tabs = page.getByRole('group', { name: 'Jira 视图', exact: true });
  await tabs.getByRole('button', { name: '发现未纳入需求', exact: true }).click();
  await expect(page).toHaveURL(url => url.searchParams.get('projectId') === 'p1' && url.searchParams.get('view') === 'discovery');
  await page.getByRole('searchbox', { name: '搜索 Jira 需求' }).fill('新的权限');
  await tabs.getByRole('button', { name: '需求进展', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: '搜索 Jira 需求' })).toHaveValue('');
  await expect(page.locator('.adaptive-data-row')).toHaveCount(6);
  await choose(page, '本地状态', '已取消');
  await tabs.getByRole('button', { name: '发现未纳入需求', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: '搜索 Jira 需求' })).toHaveValue('新的权限');
  await expect(page.locator('.adaptive-data-row')).toHaveCount(1);
  await page.goBack();
  await expect(tabs.getByRole('button', { name: '需求进展', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('combobox', { name: '本地状态', exact: true })).toHaveText('已取消');
  for (const viewport of [page.viewportSize()!, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const crumb = page.getByRole('navigation', { name: '页面层级', exact: true }).locator('[aria-current=page]');
    await expect(crumb).toHaveText('Jira 进展管理');
    await expect.poll(() => crumb.evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
    await expect(tabs.getByRole('button', { name: '发现未纳入需求', exact: true })).toBeVisible();
    const list = (await page.getByRole('table', { name: 'Jira 需求进展', exact: true }).boundingBox())!;
    const status = (await page.locator('footer[aria-label="Jira 连接与读取状态"]').boundingBox())!;
    expect(status.y).toBeGreaterThanOrEqual(list.y + list.height);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: info.outputPath('jira-navigation-' + viewport.width + '.png'), fullPage: true, animations: 'disabled' });
  }
  expect(mock.refreshes()).toBe(0); expect(mock.scans()).toBe(0); expect(mock.writes()).toBe(0);
});

test('无 Token 仍展示完整需求列表，不自动读取远端', async ({ page }) => {
  const mock = await fixture(page, { configured: false }); await page.goto('/jira');
  await expect(page.getByRole('link', { name: '权限授权管理', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '刷新 Jira 状态', exact: true })).toBeDisabled();
  await expect(page.getByRole('navigation', { name: 'Jira 需求分页' })).toContainText('共 26 条');
  expect(mock.scans()).toBe(0); expect(mock.refreshes()).toBe(0);
});

test('人工刷新可以停止后续批次，界面保留已读取进度', async ({ page }) => {
  const mock = await fixture(page); let batches = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/projects/p1/jira/progress/refresh', async route => { batches++; await gate; await route.fulfill({ json: { id: 'batch', offset: 50, total: 100, complete: false, failed: 0 } }); });
  await page.goto('/jira'); await page.getByRole('button', { name: '刷新 Jira 状态', exact: true }).click();
  await page.getByRole('button', { name: '停止后续读取', exact: true }).click(); release();
  await expect(page.getByRole('button', { name: '刷新 Jira 状态', exact: true })).toBeEnabled();
  await expect(page.getByRole('status')).toContainText('已读取 50 / 100 项'); expect(batches).toBe(1); expect(mock.writes()).toBe(0);
});

test('一次发现扫描连续读取远端分页，界面分页不重复扫描', async ({ page }) => {
  const mock = await fixture(page); let calls = 0;
  await page.route('**/api/projects/p1/jira/scan', route => {
    if (route.request().method() === 'GET') return route.fallback(); calls++;
    Object.assign(mock.scan, { id: 'scan-' + calls, complete: calls === 2, nextStartAt: calls === 1 ? 1 : null, total: 2,
      rows: calls === 1 ? mock.scan.rows : [...mock.scan.rows, { ...mock.scan.rows[0], key: 'DCIM-100', issue: { ...mock.scan.rows[0].issue!, id: '1000', key: 'DCIM-100' } }] });
    return route.fulfill({ json: mock.scan });
  });
  await page.goto('/jira?view=discovery'); await page.getByRole('button', { name: '扫描 Jira', exact: true }).click();
  await expect(page.getByRole('link', { name: 'DCIM-100', exact: true })).toBeVisible(); expect(calls).toBe(2); expect(mock.writes()).toBe(0);
});

test('单项修改不预选操作，不推导状态，一次确认只执行一次', { tag: '@responsive' }, async ({ page }, info) => {
  const mock = await fixture(page); mock.rows[1].title = '跨系统统一设备权限及多角色数据隔离管理需求'.repeat(3);
  mock.rows[1].issue!.status.name = '等待跨团队联合验收确认的较长状态名称';
  await page.goto('/jira');
  await expect(page.getByRole('link', { name: 'DCIM-39', exact: true })).toBeVisible();
  for (const cell of await page.locator('.adaptive-data-row').first().locator('[data-column=actions]').all()) {
    expect(await cell.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: info.outputPath('jira-progress-desktop.png'), fullPage: true, animations: 'disabled' });
  await openAction(page);
  await expect(page.getByRole('combobox', { name: 'Jira 操作', exact: true })).toHaveText('选择操作');
  await expect(page.getByRole('button', { name: '确认修改 Jira', exact: true })).toBeDisabled();
  const initialActionHeight = (await page.getByRole('dialog').boundingBox())!.height;
  await choose(page, 'Jira 操作', '测试通过 → 验收');
  await expect(page.getByRole('button', { name: '确认修改 Jira', exact: true })).toBeEnabled(); expect(mock.writes()).toBe(0);
  expect((await page.getByRole('dialog').boundingBox())!.height).toBe(initialActionHeight);
  const selectWidth = (await page.getByRole('combobox', { name: 'Jira 操作', exact: true }).boundingBox())!.width;
  expect((await page.getByRole('textbox', { name: '备注（选填）', exact: true }).boundingBox())!.width).toBe(selectWidth);
  await page.getByRole('dialog').screenshot({ path: info.outputPath('jira-action-desktop.png'), animations: 'disabled' });
  await page.getByRole('button', { name: '确认修改 Jira', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Jira 状态已修改'); expect(mock.writes()).toBe(1);
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath('jira-progress-mobile.png'), animations: 'disabled' });
  await openAction(page); await expect(page.getByRole('combobox', { name: 'Jira 操作', exact: true })).toHaveText('选择操作');
  await choose(page, 'Jira 操作', '验收通过 → 完成');
  await expect(page.getByRole('button', { name: '确认修改 Jira', exact: true })).toBeEnabled();
  await expect(page.locator('.jira-state-change')).toHaveText('验收完成'); expect(mock.writes()).toBe(1);
  expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await page.getByRole('dialog').screenshot({ path: info.outputPath('jira-action-mobile.png'), animations: 'disabled' });
});

test('必填资料和无可用操作均禁止提交', async ({ page }) => {
  await fixture(page, { required: true }); await page.goto('/jira'); await openAction(page);
  await choose(page, 'Jira 操作', '测试通过 → 验收');
  await expect(page.getByRole('dialog')).toContainText('请在 Jira 补充：验收记录');
  await expect(page.getByRole('button', { name: '确认修改 Jira', exact: true })).toBeDisabled();
  await expect(page.getByRole('link', { name: '打开 Jira', exact: true })).toBeVisible();
});

test('响应丢失后只读回执，不能重复提交', async ({ page }) => {
  const mock = await fixture(page, { loseExecuteResponse: true }); await page.goto('/jira'); await openAction(page);
  await choose(page, 'Jira 操作', '测试通过 → 验收'); await page.getByRole('button', { name: '确认修改 Jira', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('提交结果尚未确认');
  await expect(page.getByRole('button', { name: '确认修改 Jira', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '读取结果', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Jira 状态已修改'); expect(mock.writes()).toBe(1);
});

test('可用操作为空时不提交，列表读取失败后保留恢复入口', async ({ page }) => {
  const mock = await fixture(page, { noActions: true }); let failed = true;
  await page.route('**/api/projects/p1/jira/progress', route => failed ? route.fulfill({ status: 503, json: { error: 'Internal SQL failure' } }) : route.fallback());
  await page.goto('/jira'); await expect(page.getByRole('button', { name: '重新读取列表', exact: true })).toBeVisible();
  await expect(page.locator('.jira-progress-page')).not.toContainText('Internal SQL'); failed = false;
  await page.getByRole('button', { name: '重新读取列表', exact: true }).click(); await openAction(page);
  await expect(page.getByRole('dialog')).toContainText('当前账号没有可执行的操作');
  await expect(page.getByRole('button', { name: '确认修改 Jira', exact: true })).toBeDisabled(); expect(mock.writes()).toBe(0); expect(mock.refreshes()).toBe(0);
});

test('发现范围使用统一稳定浮窗，无状态映射和批准路径', { tag: '@responsive' }, async ({ page }, info) => {
  const mock = await fixture(page); await page.goto('/jira?view=discovery');
  await page.getByRole('button', { name: '发现范围', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible(); await expect(dialog).not.toContainText('状态映射'); await expect(dialog).not.toContainText('批准路径');
  const box = (await dialog.boundingBox())!, button = page.getByRole('button', { name: '保存范围', exact: true }), y = (await button.boundingBox())!.y;
  const projectPicker = (await page.getByRole('combobox', { name: 'Jira 项目', exact: true }).boundingBox())!;
  expect(projectPicker.x - box.x).toBeGreaterThanOrEqual(18);
  await choose(page, '筛选方式', '高级 JQL'); await page.getByLabel('JQL', { exact: true }).fill('');
  await button.click(); await expect(dialog).toContainText('请填写 JQL');
  expect((await dialog.boundingBox())!.height).toBe(box.height); expect((await button.boundingBox())!.y).toBe(y);
  await dialog.screenshot({ path: info.outputPath('jira-discovery-rules.png'), animations: 'disabled' });
  await page.getByLabel('JQL', { exact: true }).fill('project = DCIM'); await button.click();
  await expect(dialog).toHaveCount(0); expect(mock.settings().jql).toBe('project = DCIM');
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: '更多操作', exact: true }).click(); await page.getByRole('button', { name: '发现范围', exact: true }).click();
  expect(await dialog.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await dialog.screenshot({ path: info.outputPath('jira-discovery-rules-mobile.png'), animations: 'disabled' }); expect(mock.writes()).toBe(0);
});

test('发现事项录入复用表单，保留文档链接且不修改 Jira', async ({ page }) => {
  const mock = await fixture(page); await page.goto('/jira?view=discovery');
  await page.getByRole('button', { name: '录入需求', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建需求' });
  await expect(dialog.locator('input[name=title]')).toHaveValue('新的权限需求');
  await dialog.getByRole('button', { name: '补充信息', exact: false }).click();
  await expect(dialog.getByRole('textbox', { name: '链接 2 名称', exact: true })).toHaveValue('设计文档');
  await dialog.getByRole('button', { name: '创建需求', exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(page.getByRole('link', { name: 'DCIM-99', exact: true })).toHaveCount(0);
  expect(mock.rows.at(-1)!.localStatus).toBe('not_started'); expect(mock.writes()).toBe(0);
});

test('发现页可忽略恢复并关联已有需求', async ({ page }) => {
  const mock = await fixture(page); await page.goto('/jira?view=discovery');
  await page.getByRole('button', { name: 'DCIM-99 更多操作', exact: true }).click(); await page.getByRole('button', { name: '忽略事项', exact: true }).click();
  await expect(page.getByRole('link', { name: 'DCIM-99', exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: '已忽略' }).check();
  await page.getByRole('button', { name: 'DCIM-99 更多操作', exact: true }).click(); await page.getByRole('button', { name: '恢复事项', exact: true }).click();
  await page.getByRole('checkbox', { name: '已忽略' }).uncheck();
  await page.getByRole('button', { name: 'DCIM-99 更多操作', exact: true }).click(); await page.getByRole('button', { name: '关联已有需求', exact: true }).click();
  await choose(page, '关联的本地需求', '需求 26'); await page.getByRole('button', { name: '确认关联', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('link', { name: 'DCIM-99', exact: true })).toHaveCount(0);
  expect(mock.rows[25].binding?.key).toBe('DCIM-99'); expect(mock.writes()).toBe(0);
});

test('需求详情概况复用 Jira 状态与单项操作', async ({ page }) => {
  const mock = await fixture(page); await page.goto('/requirements/r1');
  await page.getByRole('tab', { name: '概况', exact: true }).click();
  const section = page.locator('.jira-requirement-section'); await expect(section).toContainText('DCIM-39');
  await section.getByRole('button', { name: '修改状态', exact: true }).click();
  await choose(page, 'Jira 操作', '测试通过 → 验收'); await page.getByRole('button', { name: '确认修改 Jira', exact: true }).click();
  await expect(page.getByText('Jira 状态已修改', { exact: true })).toBeVisible(); expect(mock.writes()).toBe(1);
});

test('项目经理权限之外不调用 Jira 管理接口', async ({ page }) => {
  await fixture(page); let calls = 0;
  await page.route('**/api/session', route => route.fulfill({ json: { authenticated: true, accountId: 'user', username: 'reader', role: 'user', globalRole: 'user', personId: null, mustChangePassword: false, managedProjectIds: [] } }));
  page.on('request', request => { if (request.url().includes('/jira/') || request.url().includes('/jira-connection')) calls++; });
  await page.goto('/jira'); await expect(page.getByRole('link', { name: 'Jira 进展管理', exact: true })).toHaveCount(0); expect(calls).toBe(0);
});

test('服务异常时显示友好提示，恢复后可直接填写 Token', { tag: '@responsive' }, async ({ page }, info) => {
  const mock = await fixture(page, { configured: false });
  let submissions = 0;
  page.on('request', request => { if (request.method() === 'PUT' && request.url().endsWith('/jira-connection')) submissions++; });
  mock.connection().setupIssue = 'deployment';
  mock.connection().problem = 'Internal AES key config unavailable';
  await page.goto('/settings');
  const panel = page.locator('.jira-connection-panel');
  await expect(panel).toContainText(jiraSetupMessages.deployment);
  await expect(panel).not.toContainText('Internal AES');
  await expect(panel.getByRole('button', { name: '验证并保存', exact: true })).toHaveCount(0);
  await expect(panel.getByLabel('Jira 个人访问 Token', { exact: true })).toHaveCount(0);
  await panel.screenshot({ path: info.outputPath('jira-connection-readiness.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => panel.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await panel.screenshot({ path: info.outputPath('jira-connection-readiness-mobile.png'), animations: 'disabled' });
  mock.connection().setupIssue = null; mock.connection().problem = null;
  await panel.getByRole('button', { name: '重新读取连接', exact: true }).click();
  await expect(panel.getByLabel('Jira 个人访问 Token', { exact: true })).toBeVisible();
  expect(submissions).toBe(0);
});


test('管理员停用集成后不提交 Token', async ({ page }) => {
  const mock = await fixture(page, { configured: false });
  let submissions = 0;
  page.on('request', request => { if (request.method() === 'PUT' && request.url().endsWith('/jira-connection')) submissions++; });
  await page.goto('/settings');
  const panel = page.locator('.jira-connection-panel');
  await panel.getByLabel('Jira 个人访问 Token', { exact: true }).fill('not-transmitted');
  mock.connection().setupIssue = 'disabled';
  await panel.getByRole('button', { name: '验证并保存', exact: true }).click();
  await expect(panel).toContainText(jiraSetupMessages.disabled);
  await expect(panel.getByLabel('Jira 个人访问 Token', { exact: true })).toHaveCount(0);
  expect(submissions).toBe(0);
});


test('未知服务错误显示操作建议，不回显内部报错', async ({ page }) => {
  await fixture(page, { configured: false });
  await page.route('**/api/me/jira-connection', route => route.request().method() === 'PUT'
    ? route.fulfill({ status: 500, json: { error: 'SQLITE_ERROR stack /private/path JIRA_ENCRYPTION_KEY' } }) : route.fallback());
  await page.goto('/settings');
  const panel = page.locator('.jira-connection-panel');
  await panel.getByLabel('Jira 个人访问 Token', { exact: true }).fill('valid-token');
  await panel.getByRole('button', { name: '验证并保存', exact: true }).click();
  await expect(panel).toContainText('请重新读取连接，核对保存状态后再试');
  await expect(panel).not.toContainText('SQLITE_ERROR');
  await expect(panel).not.toContainText('JIRA_ENCRYPTION_KEY');
});


test('真实 HTTP 服务无需手工配置密钥即可显示 Token 表单', async ({ page }, info) => {
  const login = await page.request.post('/api/login', { data: { username: 'admin', password: '41_xc7q0qOjo4Inw!' } });
  expect(login.ok()).toBe(true);
  const status = await page.request.get('/api/me/jira-connection');
  expect(status.ok()).toBe(true);
  expect(await status.json()).toMatchObject({ setupIssue: null, available: true, configured: false });
  await page.goto('/settings');
  expect(new URL(page.url()).protocol).toBe('http:');
  const panel = page.locator('.jira-connection-panel');
  await expect(panel.getByLabel('Jira 个人访问 Token', { exact: true })).toBeVisible();
  await expect(panel).not.toContainText('尚未开放');
  await panel.screenshot({ path: info.outputPath('jira-http-connection-ready.png'), animations: 'disabled' });
});


test('HTTP 入口可保存个人 Jira Token，刷新仍显示已保存，不写入浏览器存储', async ({ page }) => {
  const mock = await fixture(page, { configured: false }); await page.goto('/settings');
  expect(new URL(page.url()).protocol).toBe('http:');
  const panel = page.locator('.jira-connection-panel');
  await panel.getByLabel('Jira 个人访问 Token', { exact: true }).fill('browser-secret-test-token');
  await expect(panel.getByLabel('Jira 个人访问 Token', { exact: true })).toHaveAttribute('type', 'text');
  await panel.getByRole('button', { name: '验证并保存', exact: true }).click();
  await expect(panel.getByLabel('Jira 个人访问 Token', { exact: true })).toHaveCount(0);
  await expect(panel).toContainText('连接验证成功，Token 已保存');
  await expect(panel).toContainText('个人访问 Token 已保存');
  expect(mock.credential()).toBe('browser-secret-test-token');
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain('browser-secret-test-token');
  await panel.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(panel).toContainText('已验证用户'); expect(mock.writes()).toBe(0);
  await page.reload();
  await expect(panel).toContainText('个人访问 Token 已保存');
  await expect(panel.locator('.jira-connection-status')).toHaveText('已验证');
  await expect(panel).toContainText('已验证用户');
});


test('替换失败保留输入与原连接，取消后测试的是已保存连接', async ({ page }) => {
  const mock = await fixture(page, { rejectSave: true }); await page.goto('/settings');
  const panel = page.locator('.jira-connection-panel');
  await panel.getByRole('button', { name: '替换 Token', exact: true }).click();
  await panel.getByLabel('Jira 个人访问 Token', { exact: true }).fill('invalid-new-token');
  await expect(panel.getByRole('button', { name: '测试连接', exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: '验证并保存', exact: true }).click();
  await expect(panel).toContainText(jiraConnectionMessages.invalidToken);
  await expect(panel.getByLabel('Jira 个人访问 Token', { exact: true })).toHaveValue('invalid-new-token');
  expect(mock.connection().version).toBe('v1');
  await panel.getByRole('button', { name: '取消替换', exact: true }).click();
  await expect(panel.getByLabel('Jira 个人访问 Token', { exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(panel).toContainText('已保存的连接验证成功');
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain('invalid-new-token');
});


test('移除连接需确认，移除后可重新保存', async ({ page }) => {
  const mock = await fixture(page); await page.goto('/settings');
  const panel = page.locator('.jira-connection-panel');
  await panel.getByRole('button', { name: '移除个人 Jira Token' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  expect(mock.connection().configured).toBe(true);
  await panel.getByRole('button', { name: '移除个人 Jira Token' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '移除', exact: true }).click();
  await expect(panel.locator('.jira-connection-status')).toHaveText('未配置');
  await panel.getByLabel('Jira 个人访问 Token', { exact: true }).fill('new-valid-token');
  await panel.getByRole('button', { name: '验证并保存', exact: true }).click();
  await expect(panel).toContainText('个人访问 Token 已保存');
});


test('连接区标题、字段与操作对齐，桌面和移动端不溢出', { tag: '@responsive' }, async ({ page }, info) => {
  await fixture(page); await page.goto('/settings');
  const panel = page.locator('.jira-connection-panel');
  await expect(panel).toContainText('个人访问 Token 已保存');
  await panel.screenshot({ path: info.outputPath('jira-connection-saved.png'), animations: 'disabled' });
  await panel.getByRole('button', { name: '替换 Token', exact: true }).click();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const { frame, title, facts, input, save } = await panel.evaluate(el => ({ frame: el.getBoundingClientRect().toJSON(), title: el.querySelector('h2')!.getBoundingClientRect().toJSON(), facts: el.querySelector('dt')!.getBoundingClientRect().toJSON(), input: el.querySelector('input')!.getBoundingClientRect().toJSON(), save: el.querySelector('button[type=submit]')!.getBoundingClientRect().toJSON() }));
    expect(Math.abs(title.x - facts.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(title.x - input.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(input.x - save.x)).toBeLessThanOrEqual(1);
    expect(input.x - frame.x).toBeGreaterThanOrEqual(12);
    expect(input.y + input.height).toBeLessThan(save.y);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await panel.screenshot({ path: info.outputPath(`jira-connection-edit-${width}.png`), animations: 'disabled' });
  }
});


test('连接读取失败有恢复入口，不显示可误操作的空白表单', async ({ page }) => {
  await fixture(page);
  let failed = true;
  await page.route('**/api/me/jira-connection', route => failed ? route.fulfill({ status: 503, json: { error: '连接信息暂时无法读取' } }) : route.fallback());
  await page.goto('/settings');
  const panel = page.locator('.jira-connection-panel');
  await expect(panel).toContainText('暂时无法读取 Jira 连接，请稍后重试');
  await expect(panel.getByLabel('Jira 个人访问 Token', { exact: true })).toHaveCount(0);
  failed = false;
  await panel.getByRole('button', { name: '重新读取连接', exact: true }).click();
  await expect(panel).toContainText('个人访问 Token 已保存');
});
