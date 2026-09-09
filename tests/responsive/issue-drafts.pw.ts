import { expect, test, type Page } from '@playwright/test';
import type { Issue } from '../../src/client/types';

const issue: Issue = {
  id: 'i1', projectId: 'p1', projectName: '测试项目', requirementId: null, requirementTitle: null,
  sourceRef: null, title: '问题草稿测试', impact: '原影响', reporter: '张三', ownerId: 'u1', ownerName: '张三',
  status: 'in_progress', priority: 'P2', progress: 40, discoveredAt: '2026-09-01', dueDate: '2026-09-10',
  resolvedAt: null, version: 1, createdAt: '2026-09-01', updatedAt: '2026-09-01', latestUpdate: null,
  latestUpdateAt: null, overdue: false, updates: [],
};

async function fixture(page: Page, role: 'admin' | 'manager' | 'owner' | 'member' | 'viewer' = 'admin') {
  const state = { issue: { ...issue }, readFailure: 0, writes: [] as Array<{ path: string; body: Record<string, unknown> }>, writeFailure: 0, malformedWrite: false, stampCreate: false, stampStatusEvent: false, statusEventAccountId: 'admin', statusExtraVersion: 0, hold: undefined as Promise<void> | undefined };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path === '/api/session') return route.fulfill({ json: { authenticated: true, accountId: role, username: role, httpWarning: true, role: role === 'admin' ? 'admin' : 'user', globalRole: role === 'admin' ? 'admin' : 'user', personId: role === 'owner' || role === 'admin' ? 'u1' : 'u2', mustChangePassword: false, managedProjectIds: role === 'manager' ? ['p1'] : [] } });
    if (path === '/api/projects') return route.fulfill({ json: [{ id: 'p1', name: '测试项目', status: 'active', defaultTemplateId: null, isSample: false }] });
    if (path === '/api/people') return route.fulfill({ json: [{ id: 'u1', name: '张三', active: 1, projectRole: 'member' }, { id: 'u2', name: '李四', active: 1, projectRole: role === 'viewer' ? 'viewer' : 'member' }] });
    if (path === '/api/requirements' || path === '/api/templates') return route.fulfill({ json: [] });
    if (path.startsWith('/api/issues') && method !== 'GET') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      state.writes.push({ path, body });
      await state.hold;
      if (state.writeFailure) return route.fulfill({ status: state.writeFailure, json: { error: `保存失败 ${state.writeFailure}` } });
      if (path.endsWith('/updates')) state.issue = { ...state.issue, progress: typeof body.progress === 'number' ? body.progress : state.issue.progress, version: state.issue.version + (typeof body.progress === 'number' ? 1 : 0) };
      else if (path.endsWith('/defer')) state.issue = { ...state.issue, status: 'deferred', dueDate: null, version: state.issue.version + 1 };
      else if (path.endsWith('/resolve')) state.issue = { ...state.issue, status: 'resolved', progress: 100, resolvedAt: '2026-09-04', version: state.issue.version + 1 };
      else if (path.endsWith('/resume') || path.endsWith('/reopen')) state.issue = { ...state.issue, status: 'in_progress', resolvedAt: null, version: state.issue.version + 1 };
      else state.issue = state.stampCreate && path === '/api/issues'
        ? {
            ...state.issue, ...body, id: 'i-created', title: String(body.title).trim(),
            impact: String(body.impact || '').trim() || null, requirementId: String(body.requirementId || '') || null,
            sourceRef: String(body.sourceRef || '').trim() || null, reporter: String(body.reporter || '').trim() || null,
            dueDate: String(body.dueDate || '') || null, ownerId: null, ownerName: null,
            status: 'in_progress', progress: 0, version: 1,
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          }
        : { ...state.issue, ...body, version: state.issue.version + 1 };
      const statusCommand = path.split('/').at(-1);
      if (state.stampStatusEvent && ['defer', 'resolve', 'resume', 'reopen'].includes(statusCommand || '')) {
        const now = '2026-09-04T08:00:00.000Z';
        state.issue = { ...state.issue, updatedAt: now, updates: [...(state.issue.updates || []), {
          id: `status-${state.issue.version}`, issueId: state.issue.id, progress: state.issue.progress,
          content: String(body.content || body.reason), eventType: statusCommand!, supersedesId: null,
          createdByAccountId: state.statusEventAccountId, createdByName: state.statusEventAccountId, createdAt: now, updatedAt: now,
        }] };
        if (state.statusExtraVersion) state.issue = {
          ...state.issue, version: state.issue.version + state.statusExtraVersion, updatedAt: '2026-09-04T09:00:00.000Z',
        };
      }
      if (state.malformedWrite) return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Unexpected proxy response</html>' });
      return route.fulfill({ json: state.issue });
    }
    if (path === '/api/issues/i1') return state.readFailure
      ? route.fulfill({ status: state.readFailure, json: { error: `读取失败 ${state.readFailure}` } })
      : route.fulfill({ json: state.issue });
    if (path === '/api/issues') return route.fulfill({ json: { items: [state.issue], total: 1, page: 1, pageSize: 50, pages: 1, summary: { total: 1, inProgress: 1, deferred: 0, resolved: 0, active: 1, highPriority: 0, overdue: 0, unassigned: 0, closureRate: 0 } } });
    return route.fulfill({ json: {} });
  });
  return state;
}

const refresh = (page: Page) => page.evaluate(() => {
  window.dispatchEvent(new Event('offline'));
  window.dispatchEvent(new Event('online'));
});

test.describe('北京时间问题默认日期', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('新建问题跨日更新未编辑的发现日期并保留手动日期', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-05T15:59:30.000Z') });
    await fixture(page);
    await page.goto('/issues');
    await page.getByRole('button', { name: '新建问题', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '新建问题', exact: true });
    const discoveredAt = dialog.getByLabel('发现日期', { exact: true });
    await expect(discoveredAt).toHaveValue('2026-09-05');
    await dialog.getByLabel('问题标题', { exact: true }).fill('跨日仍在填写的问题');

    await page.clock.fastForward(90_000);
    await expect(discoveredAt).toHaveValue('2026-09-06');

    await discoveredAt.fill('2026-09-01');
    await page.clock.setSystemTime(new Date('2026-09-06T16:01:00.000Z'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(discoveredAt).toHaveValue('2026-09-01');
  });
});

test('新建问题结果未知时保留草稿、刷新列表并禁止直接重复创建', async ({ page }) => {
  const state = await fixture(page);
  state.malformedWrite = true;
  await page.goto('/issues');
  await page.getByRole('button', { name: '新建问题', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建问题', exact: true });
  const title = dialog.getByRole('textbox', { name: '问题标题', exact: true });
  const submit = dialog.getByRole('button', { name: '创建问题', exact: true });
  await title.fill('结果未知的新问题草稿');
  await submit.click();
  await expect(dialog.getByRole('alert')).toContainText('创建结果暂时无法确认');
  await expect(title).toHaveValue('结果未知的新问题草稿');
  await expect(submit).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '重新读取问题', exact: true })).toHaveCount(0);
  await dialog.locator('form').evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(state.writes).toHaveLength(1);
});

test('新建问题已落库但响应异常时核对本次新增问题', async ({ page }) => {
  const state = await fixture(page);
  state.malformedWrite = true;
  state.stampCreate = true;
  await page.goto('/issues');
  await page.getByRole('button', { name: '新建问题', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建问题', exact: true });
  await dialog.getByRole('textbox', { name: '问题标题', exact: true }).fill('异常响应新增问题');
  await dialog.getByRole('textbox', { name: '问题影响', exact: true }).fill('需要核对结果');
  await dialog.getByLabel('范围标识', { exact: true }).fill('RISK-01');
  await dialog.getByRole('combobox', { name: '优先级', exact: true }).selectOption('P1');
  await dialog.getByRole('button', { name: '创建问题', exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('已核对最新状态：问题已创建', { exact: true })).toBeVisible();
  await expect(page.getByText('异常响应新增问题', { exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(1);
});

test('项目经理新建问题时可以直接选择负责人', async ({ page }) => {
  const state = await fixture(page, 'manager');
  await page.goto('/issues');
  await page.getByRole('button', { name: '新建问题', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建问题', exact: true });
  await dialog.getByRole('textbox', { name: '问题标题', exact: true }).fill('创建时直接分配负责人');
  await dialog.getByRole('button', { name: '负责人：未分配', exact: true }).click();
  await page.getByRole('listbox', { name: '负责人', exact: true }).getByRole('option', { name: '李四', exact: true }).click();
  await dialog.getByRole('button', { name: '创建问题', exact: true }).click();

  await expect(dialog).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].body).toMatchObject({ projectId: 'p1', title: '创建时直接分配负责人', ownerId: 'u2' });
});

test('问题搜索选择浮层不改变弹窗滚动布局', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'laptop-1366', '滚动布局回归只需在一个窄桌面视口执行');
  await fixture(page, 'manager');
  await page.route('**/api/people', (route) => route.fulfill({ json: Array.from({ length: 14 }, (_, index) => ({
    id: `u${index + 1}`,
    name: index === 0 ? '张三' : index === 1 ? '李四' : `成员${index + 1}`,
    active: 1,
    projectRole: 'member',
  })) }));
  await page.goto('/issues');
  await page.getByRole('button', { name: '新建问题', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建问题', exact: true });
  const body = dialog.locator('.modal-body');

  for (const label of ['关联需求', '负责人', '提出人']) {
    const before = await body.evaluate((element) => ({ scrollHeight: element.scrollHeight, clientWidth: element.clientWidth }));
    await dialog.getByRole('button', { name: new RegExp(`^${label}：`) }).click();
    const listbox = page.getByRole('listbox', { name: label, exact: true });
    const popover = page.locator('body > .issue-search-select-menu');
    await expect(listbox).toBeVisible();
    await expect(popover).toBeVisible();
    const after = await body.evaluate((element) => ({ scrollHeight: element.scrollHeight, clientWidth: element.clientWidth }));
    expect(after).toEqual(before);
    const bounds = await popover.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(12);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(768 - 12);
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await expect(dialog.getByRole('button', { name: new RegExp(`^${label}：`) })).toBeFocused();
  }
});

test('普通成员新建问题时不显示负责人选择', async ({ page }) => {
  await fixture(page, 'member');
  await page.goto('/issues');
  await page.getByRole('button', { name: '新建问题', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建问题', exact: true });
  await expect(dialog.getByRole('button', { name: /^负责人：/ })).toHaveCount(0);
  await expect(dialog.getByText('由项目经理分配负责人并确认关闭', { exact: false })).toBeVisible();
});

async function openForm(page: Page, form: 'basic' | 'updates') {
  await page.goto('/issues?issueId=i1');
  if (form === 'basic') await page.getByRole('tab', { name: '基本信息', exact: true }).click();
  const container = page.locator(form === 'basic' ? '.issue-form' : '.issue-update-form');
  await expect(container).toBeVisible();
  const field = form === 'basic' ? container.getByRole('textbox', { name: '问题标题', exact: true }) : container.getByPlaceholder('记录新进展、决策或待办结果');
  await field.fill('本次草稿');
  if (form === 'updates') await container.getByRole('spinbutton').fill('60');
  return { container, field, submit: container.getByRole('button', { name: form === 'basic' ? '保存修改' : '追加进展', exact: true }) };
}

async function openStatus(page: Page, location: 'list' | 'detail', action = '确认解决') {
  await page.goto(location === 'detail' ? '/issues?issueId=i1' : '/issues?status=');
  const trigger = page.locator(location === 'detail' ? '.issue-settings-summary .issue-status-trigger' : '.issue-data-status .issue-status-trigger');
  await trigger.click();
  const container = page.locator('.issue-status-popover');
  await container.getByRole('button', { name: new RegExp(action) }).click();
  const field = container.locator('textarea');
  await field.fill('本次状态说明');
  return { container, field, trigger, submit: container.getByRole('button', { name: '确认变更', exact: true }) };
}

test('问题详情受控纠错可修正事实并保留原因', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/issues?issueId=i1');
  await page.getByRole('button', { name: '受控纠错', exact: true }).click();
  const form = page.locator('.issue-correction-form');
  await expect(form).toBeVisible();
  await form.getByLabel('纠错后的问题标题', { exact: true }).fill('核对后的问题标题');
  await form.getByLabel('纠错后的问题影响', { exact: true }).fill('核对后的影响范围');
  await form.getByLabel('纠错后的问题完成度', { exact: true }).fill('25');
  await expect(form.getByRole('alert')).toContainText('请填写纠错原因');
  await form.getByLabel('问题纠错原因', { exact: true }).fill('根据原始记录修正');
  await form.getByRole('button', { name: '保存纠错', exact: true }).click();

  await expect(form).toHaveCount(0);
  await expect(page.getByText('问题纠错已记录', { exact: true })).toBeVisible();
  expect(state.writes).toEqual([{ path: '/api/issues/i1/correct', body: {
    expectedVersion: 1,
    title: '核对后的问题标题',
    impact: '核对后的影响范围',
    progress: 25,
    resolvedAt: null,
    supersedesId: null,
    reason: '根据原始记录修正',
  } }]);
});

test('已解决问题通过受控纠错修正解决日期而不重开', async ({ page }) => {
  const state = await fixture(page);
  state.issue = { ...state.issue, status: 'resolved', progress: 100, resolvedAt: '2026-09-04' };
  await page.goto('/issues?issueId=i1');
  await page.getByRole('tab', { name: '基本信息', exact: true }).click();
  await expect(page.getByText('解决日期：2026-09-04', { exact: true })).toBeVisible();
  await expect(page.getByText(/修正标题、影响或解决日期请使用“受控纠错”/)).toBeVisible();
  await page.getByRole('button', { name: '受控纠错', exact: true }).click();
  const form = page.locator('.issue-correction-form');
  await expect(form.getByLabel('纠错后的问题完成度', { exact: true })).toHaveCount(0);
  await form.getByLabel('纠错后的解决日期', { exact: true }).fill('2026-09-03');
  await form.getByLabel('问题纠错原因', { exact: true }).fill('核对实际闭环日期');
  await form.getByRole('button', { name: '保存纠错', exact: true }).click();

  await expect(form).toHaveCount(0);
  expect(state.writes[0]).toEqual({ path: '/api/issues/i1/correct', body: {
    expectedVersion: 1,
    title: '问题草稿测试',
    impact: '原影响',
    progress: 100,
    resolvedAt: '2026-09-03',
    supersedesId: null,
    reason: '核对实际闭环日期',
  } });
  expect(state.issue.status).toBe('resolved');
});

test('问题受控纠错成功但响应损坏时读回事件且不重复提交', async ({ page }) => {
  const state = await fixture(page);
  let correctionWrites = 0;
  await page.route('**/api/issues/i1/correct', async (route) => {
    correctionWrites += 1;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const now = new Date().toISOString();
    (state as { issue: Issue }).issue = {
      ...state.issue,
      title: String(body.title),
      impact: body.impact ? String(body.impact) : null,
      progress: Number(body.progress),
      resolvedAt: body.resolvedAt ? String(body.resolvedAt) : null,
      version: state.issue.version + 1,
      updatedAt: now,
      updates: [{
        id: 'correction-1', issueId: state.issue.id, progress: Number(body.progress),
        content: String(body.reason), eventType: 'correction', supersedesId: body.supersedesId ? String(body.supersedesId) : null,
        createdByAccountId: 'admin', createdByName: 'admin', createdAt: now, updatedAt: now,
      }],
    };
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Unexpected proxy response</html>' });
  });
  await page.goto('/issues?issueId=i1');
  await page.getByRole('button', { name: '受控纠错', exact: true }).click();
  const form = page.locator('.issue-correction-form');
  await form.getByLabel('问题纠错原因', { exact: true }).fill('补充原记录纠错说明');
  await expect(form.getByRole('button', { name: '保存纠错', exact: true })).toBeDisabled();
  await form.getByLabel('纠错后的问题标题', { exact: true }).fill('核对后的问题标题');
  await form.getByRole('button', { name: '保存纠错', exact: true }).click();

  await expect(form).toHaveCount(0);
  await expect(page.getByText('已核对最新状态：问题纠错已记录', { exact: true })).toBeVisible();
  expect(correctionWrites).toBe(1);
});

test('问题受控纠错异常响应不把旧同值纠错误认成本次写入', async ({ page }) => {
  const state = await fixture(page);
  await page.route('**/api/issues/i1/correct', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    (state as { issue: Issue }).issue = {
      ...state.issue,
      title: String(body.title), impact: body.impact ? String(body.impact) : null,
      progress: Number(body.progress), resolvedAt: body.resolvedAt ? String(body.resolvedAt) : null,
      version: state.issue.version + 3, updatedAt: '2026-09-06T10:00:00.000Z',
      updates: [{
        id: 'old-correction', issueId: state.issue.id, progress: Number(body.progress),
        content: String(body.reason), eventType: 'correction', supersedesId: null,
        createdByAccountId: 'admin', createdByName: 'admin',
        createdAt: '2026-09-06T09:00:00.000Z', updatedAt: '2026-09-06T09:00:00.000Z',
      }],
    };
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Unexpected proxy response</html>' });
  });
  await page.goto('/issues?issueId=i1');
  await page.getByRole('button', { name: '受控纠错', exact: true }).click();
  const form = page.locator('.issue-correction-form');
  await form.getByLabel('纠错后的问题完成度', { exact: true }).fill('35');
  await form.getByLabel('问题纠错原因', { exact: true }).fill('重复的纠错说明');
  await form.getByRole('button', { name: '保存纠错', exact: true }).click();

  await expect(form).toBeVisible();
  await expect(page.getByText('已核对最新状态：问题纠错已记录', { exact: true })).toHaveCount(0);
});

test('问题纠错历史显示被更正记录', async ({ page }) => {
  const state = await fixture(page);
  state.issue = { ...state.issue, updates: [
    {
      id: 'correction-1', issueId: 'i1', progress: 30, content: '修正原进展', eventType: 'correction', supersedesId: 'update-1',
      createdByAccountId: 'admin', createdByName: 'admin', createdAt: '2026-09-04T08:00:00.000Z', updatedAt: '2026-09-04T08:00:00.000Z',
    },
    {
      id: 'update-1', issueId: 'i1', progress: 40, content: '原进展内容', eventType: 'progress', supersedesId: null,
      createdByAccountId: 'admin', createdByName: 'admin', createdAt: '2026-09-03T08:00:00.000Z', updatedAt: '2026-09-03T08:00:00.000Z',
    },
  ] };
  await page.goto('/issues?issueId=i1');
  const correction = page.locator('.issue-update-setting-row').filter({ hasText: '修正原进展' });
  await expect(correction).toContainText('更正：');
  await expect(correction).toContainText('进度');
  await expect(correction).not.toContainText('原记录不可用');
});

for (const location of ['list', 'detail'] as const) {
  test(`问题状态 ${location}冲突重读失败保留输入，恢复后显式重试`, async ({ page }, testInfo) => {
    const state = await fixture(page);
    const { container, field, submit } = await openStatus(page, location, '挂起');
    state.issue = { ...state.issue, title: '冲突后的状态记录', version: 2, progress: 60 };
    state.writeFailure = 409;
    state.readFailure = 503;
    await submit.click();
    await expect(container).toContainText('读取失败 503');
    await expect(submit).toBeDisabled();
    await expect(field).toHaveValue('本次状态说明');
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0].body.expectedVersion).toBe(1);
    state.readFailure = 0;
    state.writeFailure = 0;
    await container.getByRole('button', { name: '重新读取问题', exact: true }).click();
    await expect(container).toContainText('冲突后的状态记录');
    await expect(field).toHaveValue('本次状态说明');
    await expect(submit).toBeEnabled();
    if (testInfo.project.name === 'office-1280') await page.screenshot({ path: `data/round20-ui/${location}-conflict-1280.png`, animations: 'disabled' });
    await submit.click();
    await expect(container).toHaveCount(0);
    expect(state.writes[1]).toEqual({ path: '/api/issues/i1/defer', body: { expectedVersion: 2, reason: '本次状态说明' } });
  });

  test(`问题状态 ${location}重读发现状态改变不能沿用旧操作`, async ({ page }) => {
    const state = await fixture(page);
    const { container, field, submit } = await openStatus(page, location);
    state.issue = { ...state.issue, version: 2, status: 'deferred', dueDate: null };
    state.writeFailure = 409;
    await submit.click();
    await expect(container).toContainText('当前状态不支持“确认解决”');
    await expect(field).toHaveValue('本次状态说明');
    await expect(submit).toBeDisabled();
    expect(state.writes).toHaveLength(1);
    state.writeFailure = 0;
    await container.getByRole('button', { name: /恢复处理/ }).click();
    await expect(field).toHaveValue('本次状态说明');
    await field.fill('已核对，恢复处理的新说明');
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(container).toHaveCount(0);
    expect(state.writes[1]).toEqual({ path: '/api/issues/i1/resume', body: { expectedVersion: 2, reason: '已核对，恢复处理的新说明' } });
  });

  test(`问题状态 ${location}异常成功响应核对状态且不自动重发`, async ({ page }) => {
    const state = await fixture(page);
    const { container, submit } = await openStatus(page, location);
    state.malformedWrite = true;
    state.stampStatusEvent = true;
    await submit.click();
    await expect(container).toHaveCount(0);
    await expect(page.getByText('已核对最新状态：问题已解决', { exact: true })).toBeVisible();
    expect(state.writes).toHaveLength(1);
  });

  test(`问题状态 ${location}异常响应不把其他状态记录误认成本次成功`, async ({ page }) => {
    const state = await fixture(page);
    const { container, submit } = await openStatus(page, location);
    state.malformedWrite = true;
    await submit.click();
    await expect(container).toBeVisible();
    await expect(container).toContainText('当前状态不支持“确认解决”');
    await expect(page.getByText('已核对最新状态：问题已解决', { exact: true })).toHaveCount(0);
    expect(state.writes).toHaveLength(1);
  });

  if (location === 'detail') test('问题状态异常响应不把其他账号的相同命令误认成本人提交', async ({ page }) => {
    const state = await fixture(page);
    const { container, submit } = await openStatus(page, 'detail');
    state.malformedWrite = true;
    state.stampStatusEvent = true;
    state.statusEventAccountId = 'other-account';
    await submit.click();

    await expect(container).toBeVisible();
    await expect(page.getByText('已核对最新状态：问题已解决', { exact: true })).toHaveCount(0);
    expect(state.writes).toHaveLength(1);
  });

  if (location === 'detail') test('问题状态异常响应不把旧同值状态事件误认成本次命令', async ({ page }) => {
    const state = await fixture(page);
    const { container, submit } = await openStatus(page, 'detail');
    state.malformedWrite = true;
    state.stampStatusEvent = true;
    state.statusExtraVersion = 2;
    await submit.click();

    await expect(container).toBeVisible();
    await expect(page.getByText('已核对最新状态：问题已解决', { exact: true })).toHaveCount(0);
    expect(state.writes).toHaveLength(1);
  });

  for (const [status, action, command, payloadKey, target] of [
    ['in_progress', '挂起', 'defer', 'reason', 'deferred'],
    ['in_progress', '确认解决', 'resolve', 'content', 'resolved'],
    ['deferred', '恢复处理', 'resume', 'reason', 'in_progress'],
    ['resolved', '重新打开', 'reopen', 'reason', 'in_progress'],
  ] as const) {
    test(`问题状态 ${location}${command}保留原有命令与说明字段`, async ({ page }) => {
      const state = await fixture(page);
      state.issue = { ...state.issue, status, progress: status === 'resolved' ? 100 : 40, dueDate: status === 'deferred' ? null : state.issue.dueDate };
      const { container, submit } = await openStatus(page, location, action);
      await submit.click();
      await expect(container).toHaveCount(0);
      expect(state.writes).toEqual([{ path: `/api/issues/i1/${command}`, body: { expectedVersion: 1, [payloadKey]: '本次状态说明' } }]);
      expect(state.issue.status).toBe(target);
    });
  }

  test(`问题状态 ${location}后台更新保留说明并要求核对新版本`, async ({ page }) => {
    const state = await fixture(page);
    const { container, field, submit } = await openStatus(page, location);
    state.issue = { ...state.issue, version: 2, title: '状态操作的新标题', progress: 80 };
    await refresh(page);
    await expect(page.getByText('状态操作的新标题', { exact: true }).first()).toBeVisible();
    await expect(field).toHaveValue('本次状态说明');
    await expect(submit).toBeDisabled();
    expect(state.writes).toHaveLength(0);
    await container.getByRole('button', { name: '重新读取问题', exact: true }).click();
    await expect(container).toContainText('80%');
    await expect(field).toHaveValue('本次状态说明');
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect.poll(() => state.writes.length).toBe(1);
    expect(state.writes[0]).toEqual({ path: '/api/issues/i1/resolve', body: { expectedVersion: 2, content: '本次状态说明' } });
  });

  test(`问题状态 ${location}提交期间锁定说明和关闭入口，失败保留选择`, async ({ page }) => {
    const state = await fixture(page);
    const { container, field, submit, trigger } = await openStatus(page, location);
    let release!: () => void;
    state.hold = new Promise<void>((resolve) => { release = resolve; });
    state.writeFailure = 500;
    try {
      await submit.click();
      await expect.poll(() => state.writes.length).toBe(1);
      await expect(field).toBeDisabled();
      await expect(trigger).toBeDisabled();
      await expect(container.getByRole('button', { name: '返回', exact: true })).toBeDisabled();
      for (const button of await container.locator('.issue-status-choice-list button').all()) await expect(button).toBeDisabled();
      await page.keyboard.press('Escape');
      await page.mouse.click(5, 5);
      await expect(container).toBeVisible();
      if (location === 'detail') {
        await expect(page.locator('.modal-card > header button[aria-label="关闭"]')).toHaveCount(0);
        await expect(page.getByRole('tab', { name: '基本信息', exact: true })).toBeDisabled();
        await expect(page.locator('.issue-update-form textarea')).toBeDisabled();
      }
      release();
      await expect(container).toContainText('保存失败 500');
      await expect(field).toHaveValue('本次状态说明');
      await expect(field).toBeEnabled();
      state.writeFailure = 0;
      await submit.click();
      await expect(container).toHaveCount(0);
      expect(state.writes).toHaveLength(2);
      expect(state.writes[1]).toEqual(state.writes[0]);
    } finally { release(); }
  });
}

test('问题状态 列表重读被拒绝后隐藏旧内容，临时失败不能重新显示', async ({ page }) => {
  const state = await fixture(page);
  const { container, submit } = await openStatus(page, 'list');
  state.writeFailure = 409;
  state.readFailure = 403;
  await submit.click();
  await expect(container.getByRole('alert')).toHaveText('读取失败 403');
  await expect(container.locator('textarea')).toHaveCount(0);
  await expect(container).not.toContainText('问题草稿测试');
  await page.keyboard.press('Escape');
  await page.locator('.issue-data-status .issue-status-trigger').click();
  await expect(container.locator('.issue-status-choice-list')).toHaveCount(0);
  state.readFailure = 503;
  await container.getByRole('button', { name: '重新读取问题', exact: true }).click();
  await expect(container.getByRole('alert')).toHaveText('读取失败 503');
  await expect(container.locator('textarea')).toHaveCount(0);
  state.readFailure = 0;
  await container.getByRole('button', { name: '重新读取问题', exact: true }).click();
  await expect(container.getByRole('button', { name: /确认解决/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('.issue-data-status .issue-status-trigger').click();
  await expect(container.getByRole('button', { name: /确认解决/ })).toBeVisible();
  expect(state.writes).toHaveLength(1);
});

for (const location of ['list', 'detail'] as const) {
test(`问题状态 ${location}详情失权后迟到的冲突重读不能恢复旧内容`, async ({ page }) => {
  const state = await fixture(page);
  const { submit } = await openStatus(page, location);
  let release!: () => void;
  const heldRead = new Promise<void>((resolve) => { release = resolve; });
  let reads = 0;
  await page.route('**/api/issues/i1', async (route) => {
    reads++;
    if (reads === 1) {
      await heldRead;
      return route.fulfill({ json: { ...issue, version: 2 } });
    }
    return route.fulfill({ status: 403, json: { error: '问题访问已撤销' } });
  });
  state.writeFailure = 409;
  try {
    await submit.click();
    // 详情刷新与保存后的读回可以并行；等待首个请求被挂起即可。
    await expect.poll(() => reads).toBeGreaterThanOrEqual(1);
    if (location === 'list') await page.locator('.issue-title-button').click();
    else await refresh(page);
    await expect(page.getByText(/^(问题访问已撤销|问题不存在或当前账号无权访问。)$/)).toBeVisible();
    await expect(page.locator('.issue-settings-shell')).toHaveCount(0);
    const lateResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/issues/i1' && response.status() === 200);
    release();
    await lateResponse;
    await expect(page.locator('.issue-settings-shell')).toHaveCount(0);
    if (location === 'list') {
      await expect(page.locator('.issue-status-popover')).toContainText('问题访问状态已变更');
      await expect(page.locator('.issue-status-popover textarea')).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
    await page.route('**/api/issues/i1', (route) => route.fulfill({ status: 503, json: { error: '临时读取失败' } }));
    await page.getByRole('button', { name: '重新加载', exact: true }).click();
    await expect(page.getByText('临时读取失败', { exact: true })).toBeVisible();
    await expect(page.locator('.issue-settings-shell')).toHaveCount(0);
    expect(state.writes).toHaveLength(1);
  } finally { release(); }
});
}

for (const role of ['admin', 'manager', 'owner', 'member', 'viewer'] as const) {
  test(`问题状态 ${role}保留经理专属权限`, async ({ page }) => {
    await fixture(page, role);
    await page.goto('/issues?issueId=i1');
    await expect(page.locator('.issue-settings-shell')).toBeVisible();
    await expect(page.locator('.issue-status-trigger')).toHaveCount(role === 'admin' || role === 'manager' ? 2 : 0);
  });
}

for (const form of ['basic', 'updates'] as const) {
  test(`问题草稿 ${form}未开始编辑时同步最新字段`, async ({ page }) => {
    const state = await fixture(page);
    await page.goto('/issues?issueId=i1');
    if (form === 'basic') await page.getByRole('tab', { name: '基本信息', exact: true }).click();
    const container = page.locator(form === 'basic' ? '.issue-form' : '.issue-update-form');
    await expect(container).toBeVisible();
    state.issue = { ...state.issue, version: 2, title: '未编辑时的新标题', impact: '最新影响', progress: 70, dueDate: '2026-09-15' };
    await refresh(page);
    if (form === 'basic') {
      await expect(container.getByRole('textbox', { name: '问题标题', exact: true })).toHaveValue('未编辑时的新标题');
      await expect(container.getByRole('textbox', { name: '问题影响', exact: true })).toHaveValue('最新影响');
      await expect(container.getByLabel('目标日期', { exact: true })).toHaveValue('2026-09-15');
    } else await expect(container.getByRole('spinbutton')).toHaveValue('70');
    await expect(container.getByRole('button', { name: '重新读取问题', exact: true })).toHaveCount(0);
    expect(state.writes).toHaveLength(0);
  });

  test(`问题草稿 ${form}异常成功响应不清空草稿且不自动重发`, async ({ page }) => {
    const state = await fixture(page);
    const { container, field, submit } = await openForm(page, form);
    state.malformedWrite = true;
    await submit.click();
    await expect(container.getByRole('alert')).toContainText('核对');
    await expect(field).toHaveValue('本次草稿');
    await expect(field).toBeEnabled();
    if (form === 'updates') await expect(container.getByRole('spinbutton')).toHaveValue('60');
    expect(state.writes).toHaveLength(1);
  });

  test(`问题草稿 ${form}冲突重读被拒绝后不显示旧数据`, async ({ page }) => {
    const state = await fixture(page);
    const { submit } = await openForm(page, form);
    state.writeFailure = 409;
    state.readFailure = 403;
    await submit.click();
    await expect(page.getByText('问题详情加载失败', { exact: true })).toBeVisible();
    await expect(page.locator('.issue-settings-shell')).toHaveCount(0);
    state.readFailure = 503;
    await page.getByRole('button', { name: '重新加载', exact: true }).click();
    await expect(page.getByText('读取失败 503', { exact: true })).toBeVisible();
    await expect(page.locator('.issue-settings-shell')).toHaveCount(0);
    state.readFailure = 0;
    await page.getByRole('button', { name: '重新加载', exact: true }).click();
    await expect(page.locator('.issue-settings-shell')).toBeVisible();
    expect(state.writes).toHaveLength(1);
  });

  test(`问题草稿 ${form}409后重读失败仍保留输入，显式重试读取后用新版本`, async ({ page }, testInfo) => {
    const state = await fixture(page);
    const { container, field, submit } = await openForm(page, form);
    state.issue = { ...state.issue, version: 2, title: '冲突后的新标题', progress: 50 };
    state.writeFailure = 409;
    state.readFailure = 503;
    await submit.click();
    await expect(container).toContainText('读取失败 503');
    await expect(field).toHaveValue('本次草稿');
    await expect(submit).toBeDisabled();
    if (form === 'updates') await expect(container.getByRole('spinbutton')).toHaveValue('60');
    expect(state.writes[0].body.expectedVersion).toBe(1);
    state.readFailure = 0;
    state.writeFailure = 0;
    await container.getByRole('button', { name: '重新读取问题', exact: true }).click();
    await expect(container).toContainText('冲突后的新标题');
    await expect(field).toHaveValue('本次草稿');
    await expect(submit).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath('issue-conflict.png'), animations: 'disabled' });
    await submit.click();
    await expect.poll(() => state.writes.length).toBe(2);
    expect(state.writes[1].body.expectedVersion).toBe(2);
  });

  test(`问题草稿 ${form}后台解决问题保留草稿但禁止保存`, async ({ page }) => {
    const state = await fixture(page);
    const { field, submit } = await openForm(page, form);
    state.issue = { ...state.issue, status: 'resolved', progress: 100, version: 2, resolvedAt: '2026-09-04' };
    await refresh(page);
    await expect(page.locator('.issue-settings-summary')).toContainText('100%');
    await expect(field).toHaveValue('本次草稿');
    await expect(submit).toBeDisabled();
    expect(state.writes).toHaveLength(0);
  });

  test(`问题草稿 ${form}后台刷新保留输入，核对之前不能配新版本提交`, async ({ page }) => {
    const state = await fixture(page);
    const { container, field, submit } = await openForm(page, form);
    state.issue = { ...state.issue, version: 2, title: '他人的新标题', progress: 50 };
    await refresh(page);
    await expect(page.locator('.issue-settings-summary h3')).toHaveText('他人的新标题');
    await expect(field).toHaveValue('本次草稿');
    if (form === 'updates') await expect(container.getByRole('spinbutton')).toHaveValue('60');
    await expect(submit).toBeDisabled();
    expect(state.writes).toHaveLength(0);
    await container.getByRole('button', { name: '重新读取问题', exact: true }).click();
    await expect(field).toHaveValue('本次草稿');
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect.poll(() => state.writes.length).toBe(1);
    expect(state.writes[0].body.expectedVersion).toBe(2);
    if (form === 'updates') expect(state.writes[0].body).toMatchObject({ progress: 60, content: '本次草稿' });
  });

  test(`问题草稿 ${form}提交锁定全部输入与关闭入口，失败保留草稿`, async ({ page }) => {
    const state = await fixture(page);
    const { container, field, submit } = await openForm(page, form);
    let release!: () => void;
    state.hold = new Promise<void>((resolve) => { release = resolve; });
    state.writeFailure = 500;
    try {
      await submit.click();
      await expect.poll(() => state.writes.length).toBe(1);
      await expect(field).toBeDisabled();
      if (form === 'updates') await expect(container.getByRole('spinbutton')).toBeDisabled();
      await expect(page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true })).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(container).toBeVisible();
      await container.evaluate((element) => element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      expect(state.writes).toHaveLength(1);
      release();
      await expect(container).toContainText('保存失败 500');
      await expect(field).toHaveValue('本次草稿');
      await expect(field).toBeEnabled();
      state.writeFailure = 0;
      await submit.click();
      await expect.poll(() => state.writes.length).toBe(2);
      expect(state.writes[1].body.expectedVersion).toBe(1);
    } finally { release(); }
  });
}

test('问题信息已落库但响应异常时核对完整字段并关闭', async ({ page }) => {
  const state = await fixture(page);
  await page.route('**/api/issues/i1', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    state.writes.push({ path: '/api/issues/i1', body });
    state.issue = {
      ...state.issue,
      title: String(body.title).replace(/\s+/gu, ' ').trim(),
      impact: String(body.impact || '').trim() || null,
      requirementId: String(body.requirementId || '') || null,
      sourceRef: String(body.sourceRef || '').trim() || null,
      priority: String(body.priority),
      ownerId: String(body.ownerId || '') || null,
      reporter: String(body.reporter || '').trim() || null,
      discoveredAt: String(body.discoveredAt),
      dueDate: String(body.dueDate || '') || null,
      version: 2,
    };
    await route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });
  const { container, submit } = await openForm(page, 'basic');
  await container.getByLabel('问题标题', { exact: true }).fill('本次  问题草稿');
  await submit.click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('已核对最新状态：问题信息已保存', { exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(1);
});

test('问题草稿 他人提高完成度后保留输入，重新读取后仍禁止降低', async ({ page }) => {
  const state = await fixture(page);
  const { container, field, submit } = await openForm(page, 'updates');
  state.issue = { ...state.issue, version: 2, progress: 70 };
  await refresh(page);
  await expect(submit).toBeDisabled();
  await expect(container.getByRole('spinbutton')).toHaveValue('60');
  await container.getByRole('button', { name: '重新读取问题', exact: true }).click();
  await expect(container).toContainText('普通进展不能降低完成度');
  await expect(submit).toBeDisabled();
  await expect(field).toHaveValue('本次草稿');
  await container.getByRole('spinbutton').fill('80');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0].body).toEqual({ content: '本次草稿', progress: 80, expectedVersion: 2 });
});

test('问题进展已落库但响应异常时核对新记录并清空草稿', async ({ page }) => {
  const state = await fixture(page);
  await page.route('**/api/issues/i1/updates', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    state.writes.push({ path: '/api/issues/i1/updates', body });
    state.issue = {
      ...state.issue,
      progress: Number(body.progress),
      version: 2,
      updates: [{
        id: 'new-issue-update', issueId: 'i1', progress: Number(body.progress), content: String(body.content).normalize('NFC'),
        eventType: 'progress', createdByAccountId: 'admin', createdByName: 'admin',
        createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
      }],
    };
    await route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });
  const { container, field, submit } = await openForm(page, 'updates');
  await field.fill('Cafe\u0301 进展');
  await submit.click();
  await expect(field).toHaveValue('');
  await expect(container.getByRole('spinbutton')).toHaveValue('60');
  await expect(page.getByText('已核对最新状态：问题进展已记录', { exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(1);
});

test('问题进展响应异常时不把同内容同进度的状态事件误认成进展', async ({ page }) => {
  const state = await fixture(page, 'owner');
  state.issue = { ...state.issue, progress: 60 };
  await page.route('**/api/issues/i1/updates', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    state.writes.push({ path: '/api/issues/i1/updates', body });
    const changedAt = '2026-09-05T08:00:00.000Z';
    state.issue = {
      ...state.issue, status: 'deferred', dueDate: null, version: 2, updatedAt: changedAt,
      updates: [{
        id: 'defer-event', issueId: 'i1', progress: 60, content: String(body.content), eventType: 'defer',
        createdByAccountId: 'admin', createdByName: 'admin', createdAt: changedAt, updatedAt: changedAt,
      }],
    };
    await route.fulfill({ status: 200, contentType: 'text/html', body: 'saved elsewhere' });
  });
  const { container, field, submit } = await openForm(page, 'updates');
  await submit.click();

  await expect(container).toBeVisible();
  await expect(field).toHaveValue('本次草稿');
  await expect(page.getByText('已核对最新状态：问题进展已记录', { exact: true })).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
});

test('问题进展响应异常时不把其他账号的相同记录误认成本人提交', async ({ page }) => {
  const state = await fixture(page, 'owner');
  state.issue = { ...state.issue, progress: 60 };
  await page.route('**/api/issues/i1/updates', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    state.writes.push({ path: '/api/issues/i1/updates', body });
    const changedAt = '2026-09-05T08:00:00.000Z';
    state.issue = {
      ...state.issue, progress: 60, version: 2, updatedAt: changedAt,
      updates: [{
        id: 'other-progress', issueId: 'i1', progress: 60, content: String(body.content), eventType: 'progress',
        createdByAccountId: 'other-account', createdByName: '其他用户', createdAt: changedAt, updatedAt: changedAt,
      }],
    };
    await route.fulfill({ status: 200, contentType: 'text/html', body: 'saved elsewhere' });
  });
  const { container, field, submit } = await openForm(page, 'updates');
  await submit.click();

  await expect(container).toBeVisible();
  await expect(field).toHaveValue('本次草稿');
  await expect(page.getByText('已核对最新状态：问题进展已记录', { exact: true })).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
});

for (const role of ['owner', 'member', 'viewer'] as const) {
  test(`问题草稿 ${role}保留原有进度或说明权限`, async ({ page }) => {
    const state = await fixture(page, role);
    await page.goto('/issues?issueId=i1');
    const form = page.locator('.issue-update-form');
    if (role === 'viewer') {
      await expect(page.locator('.issue-settings-shell')).toBeVisible();
      await expect(form).toHaveCount(0);
      return;
    }
    await form.getByPlaceholder('记录新进展、决策或待办结果').fill('本人记录');
    if (role === 'owner') await form.getByRole('spinbutton').fill('60');
    else await expect(form.getByRole('spinbutton')).toHaveCount(0);
    await form.getByRole('button', { name: '追加进展', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    expect(state.writes[0].body).toEqual(role === 'owner' ? { content: '本人记录', progress: 60, expectedVersion: 1 } : { content: '本人记录' });
  });
}

for (const change of ['deferred', 'reassigned'] as const) {
  test(`问题草稿 ${change}后须核对才能改为仅记录说明`, async ({ page }) => {
    const state = await fixture(page, 'owner');
    const { container, field, submit } = await openForm(page, 'updates');
    state.issue = { ...state.issue, version: 2, ...(change === 'deferred' ? { status: 'deferred', dueDate: null } : { ownerId: 'u2', ownerName: '李四' }) };
    await refresh(page);
    await expect(submit).toBeDisabled();
    await expect(field).toHaveValue('本次草稿');
    await expect(container.getByRole('spinbutton')).toHaveValue('60');
    await container.getByRole('button', { name: '重新读取问题', exact: true }).click();
    await expect(container).toContainText('本次仅记录说明，不修改完成度');
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect.poll(() => state.writes.length).toBe(1);
    expect(state.writes[0].body).toEqual({ content: '本次草稿' });
  });
}

test('问题草稿 新建问题提交中锁定窗口且失败保留字段', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/issues');
  await page.getByRole('button', { name: '新建问题', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建问题', exact: true });
  const field = dialog.getByRole('textbox', { name: '问题标题', exact: true });
  await field.fill('新建问题草稿');
  let release!: () => void;
  state.hold = new Promise<void>((resolve) => { release = resolve; });
  state.writeFailure = 500;
  try {
    await dialog.getByRole('button', { name: '创建问题', exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    await expect(field).toBeDisabled();
    await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    release();
    await expect(dialog).toContainText('保存失败 500');
    await expect(field).toHaveValue('新建问题草稿');
    expect(state.writes[0].body).toMatchObject({ title: '新建问题草稿', ownerId: null, projectId: 'p1', reporter: '张三' });
  } finally { release(); }
});

test('问题草稿 新建问题提交同一事件周期内不能被 Escape 关闭', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/issues');
  await page.getByRole('button', { name: '新建问题', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建问题', exact: true });
  await dialog.getByRole('textbox', { name: '问题标题', exact: true }).fill('同周期新建问题');
  let release!: () => void;
  state.hold = new Promise<void>((resolve) => { release = resolve; });
  try {
    await dialog.getByRole('button', { name: '创建问题', exact: true }).evaluate((button) => {
      (button as HTMLButtonElement).click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await expect.poll(() => state.writes.length).toBe(1);
    await expect(dialog).toBeVisible();
    release();
    await expect(dialog).toHaveCount(0);
  } finally { release(); }
});

test('问题草稿 详情保存同一事件周期内不能被 Escape 关闭', async ({ page }) => {
  const state = await fixture(page);
  const { submit } = await openForm(page, 'basic');
  const dialog = page.getByRole('dialog', { name: '问题详情', exact: true });
  let release!: () => void;
  state.hold = new Promise<void>((resolve) => { release = resolve; });
  try {
    await submit.evaluate((button) => {
      (button as HTMLButtonElement).click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await expect.poll(() => state.writes.length).toBe(1);
    await expect(dialog).toBeVisible();
    release();
    await expect(dialog).toHaveCount(0);
  } finally { release(); }
});

test('问题草稿 已有问题未指定提出人时不能自动补成当前用户', async ({ page }) => {
  const state = await fixture(page);
  state.issue.reporter = null;
  await page.goto('/issues?issueId=i1');
  await page.getByRole('tab', { name: '基本信息', exact: true }).click();
  const form = page.locator('.issue-form');
  await expect(form.getByRole('button', { name: '提出人：未指定', exact: true })).toBeVisible();
  await form.getByRole('textbox', { name: '问题标题', exact: true }).fill('只改标题');
  await form.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0].body.reporter).toBe('');
});
