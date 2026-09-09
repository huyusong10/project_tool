import { expect, test, type Page } from '@playwright/test';
import type { Requirement, WorkItem } from '../../src/client/types';

type Action = 'complete-as-planned' | 'accept' | 'cancel' | 'archive';
const labels: Record<Action, { title: string; confirm: string; field?: string }> = {
  'complete-as-planned': { title: '按期完成（历史补录）', confirm: '确认按期完成' },
  accept: { title: '确认验收', confirm: '确认验收', field: '验收说明' },
  cancel: { title: '取消需求', confirm: '确认取消', field: '取消原因' },
  archive: { title: '归档需求', confirm: '确认归档' },
};

async function fixture(page: Page, action: Action) {
  const completed = action === 'accept' || action === 'archive';
  const item: WorkItem = {
    id: 'w1', requirementId: 'r1', templateItemId: null, title: '历史设计', ownerId: null, ownerName: null,
    collaborators: [], assigneeIds: [], assigneeNames: [], status: completed ? 'completed' : 'not_started',
    plannedStart: '2020-01-02', plannedEnd: '2020-01-03', actualStart: completed ? '2020-01-02' : null,
    actualEnd: completed ? '2020-01-03' : null, forecastEnd: null, blockedAt: null, blockedReason: null,
    milestoneLabel: null, progress: completed ? 100 : 0, sortOrder: 0, version: 1, createdAt: '2020-01-02', updatedAt: '2020-01-03',
  };
  const requirement: Requirement = {
    id: 'r1', projectId: 'p1', projectName: '测试项目', title: '打开时的需求', templateId: null, templateName: null,
    ownerId: null, ownerName: null, status: action === 'accept' ? 'pending_acceptance' : action === 'archive' ? 'completed' : 'not_started',
    plannedStart: item.plannedStart, plannedEnd: item.plannedEnd, progress: item.progress, plannedProgress: 100, progressGap: 0,
    acceptedAt: action === 'archive' ? '2020-01-03' : null, acceptedByAccountId: null, version: 1,
    riskLevel: 'low', riskEvaluated: false, riskReason: '', priority: 'P2', createdAt: '2020-01-02', updatedAt: '2020-01-03',
    workItems: [item], progressUpdates: [], delayed: false, highRisk: false, finishVariance: 0, durationVariance: 0,
    effectiveEnd: item.plannedEnd, issueSummary: { active: 0, overdue: 0 },
  };
  const state = { requirement, reads: 0, readStatus: 0, writes: [] as Array<Record<string, unknown>> };
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (pathname === '/api/session') return route.fulfill({ json: { authenticated: true, accountId: 'admin', username: 'admin', role: 'admin', globalRole: 'admin', personId: null, mustChangePassword: false, managedProjectIds: [] } });
    if (pathname === '/api/projects') return route.fulfill({ json: [{ id: 'p1', name: '测试项目', status: 'active', defaultTemplateId: null }] });
    if (pathname === '/api/people' || pathname === '/api/templates') return route.fulfill({ json: [] });
    if (pathname === '/api/dashboard') return route.fulfill({ json: { summary: {}, requirements: [] } });
    if (pathname === '/api/requirements/r1' && method === 'GET') {
      state.reads++;
      return state.readStatus ? route.fulfill({ status: state.readStatus, json: { error: '当前需求无法读取' } }) : route.fulfill({ json: state.requirement });
    }
    if ((pathname === '/api/requirements/r1' && method === 'DELETE') || pathname === `/api/requirements/r1/${action}`) {
      state.writes.push(route.request().postDataJSON());
      return route.fulfill({ json: action === 'archive' ? { ok: true } : state.requirement });
    }
    return route.fulfill({ json: {} });
  });
  return state;
}

async function openCommand(page: Page, action: Action) {
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '需求操作', exact: true }).click();
  await page.locator('.inline-edit-popover').getByRole('button', { name: labels[action].title, exact: true }).click();
  return page.getByRole('dialog', { name: labels[action].title, exact: true });
}

for (const action of ['complete-as-planned', 'accept', 'cancel', 'archive'] as const) {
  test(`${action}确认期间后台更新不能借新版本提交，重读前保留确认快照`, async ({ page }, testInfo) => {
    const state = await fixture(page, action);
    const dialog = await openCommand(page, action);
    if (!labels[action].field) await expect(dialog.getByRole('button', { name: labels[action].confirm, exact: true })).toBeFocused();
    if (labels[action].field) await dialog.getByRole('textbox', { name: labels[action].field, exact: true }).fill('打开时填写的说明');
    state.requirement = { ...state.requirement, title: '其他人更新的需求', version: 2,
      workItems: [{ ...state.requirement.workItems[0], plannedEnd: '2020-01-06', version: 2 }] };
    const previousReads = state.reads;
    await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
    await expect.poll(() => state.reads).toBeGreaterThan(previousReads);
    await expect(dialog.getByRole('button', { name: labels[action].confirm, exact: true })).toBeDisabled();
    await expect(dialog).toContainText('打开时的需求');
    expect(state.writes).toHaveLength(0);
    if (action === 'complete-as-planned') {
      await expect(dialog).toContainText('2020-01-03');
      await expect(dialog).not.toContainText('2020-01-06');
    }
    await dialog.locator('form').evaluate((form) => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(state.writes).toHaveLength(0);
    await dialog.getByRole('button', { name: '重新读取需求', exact: true }).click();
    await expect(dialog).toContainText('其他人更新的需求');
    if (action === 'complete-as-planned') await expect(dialog).toContainText('2020-01-06');
    if (labels[action].field) await expect(dialog.getByRole('textbox', { name: labels[action].field, exact: true })).toHaveValue('打开时填写的说明');
    if (testInfo.project.name === 'office-1280' && (action === 'complete-as-planned' || action === 'cancel')) await page.screenshot({ path: `data/round23-ui/${action}-review.png`, animations: 'disabled' });
    await dialog.getByRole('button', { name: labels[action].confirm, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.writes).toEqual([{ expectedVersion: 2, ...(action === 'accept' ? { content: '打开时填写的说明' } : action === 'cancel' ? { reason: '打开时填写的说明' } : {}) }]);
    if (action === 'archive') await expect(page).toHaveURL('/');
  });

  test(`${action}冲突重读503保留内容且禁写，恢复后核对最新版本重试`, async ({ page }) => {
    const state = await fixture(page, action);
    const endpoint = action === 'archive' ? '**/api/requirements/r1' : `**/api/requirements/r1/${action}`;
    await page.route(endpoint, (route) => {
      if (route.request().method() === 'GET') return route.fallback();
      state.writes.push(route.request().postDataJSON());
      if (state.writes.length === 1) {
        state.requirement = { ...state.requirement, title: '冲突后的需求', version: 2 };
        state.readStatus = 503;
        return route.fulfill({ status: 409, json: { error: '需求已被修改', code: 'STALE_WRITE' } });
      }
      return route.fulfill({ json: action === 'archive' ? { ok: true } : state.requirement });
    });
    const dialog = await openCommand(page, action);
    if (labels[action].field) await dialog.getByRole('textbox', { name: labels[action].field, exact: true }).fill('保留这份确认说明');
    await dialog.getByRole('button', { name: labels[action].confirm, exact: true }).click();
    await expect(dialog).toContainText('当前需求无法读取');
    await expect(dialog.getByRole('button', { name: labels[action].confirm, exact: true })).toBeDisabled();
    await expect(dialog).toContainText('打开时的需求');
    expect(state.writes).toHaveLength(1);
    state.readStatus = 0;
    await dialog.getByRole('button', { name: '重新读取需求', exact: true }).click();
    await expect(dialog).toContainText('冲突后的需求');
    if (labels[action].field) await expect(dialog.getByRole('textbox', { name: labels[action].field, exact: true })).toHaveValue('保留这份确认说明');
    await dialog.getByRole('button', { name: labels[action].confirm, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.writes.map((input) => input.expectedVersion)).toEqual([1, 2]);
  });

  test(`${action}重读发现状态不支持原操作时不能继续提交`, async ({ page }) => {
    const state = await fixture(page, action);
    const dialog = await openCommand(page, action);
    if (labels[action].field) await dialog.getByRole('textbox', { name: labels[action].field, exact: true }).fill('状态变化前的说明');
    state.requirement = { ...state.requirement, version: 2, status: action === 'accept' || action === 'archive' ? 'in_progress' : 'completed' };
    const previousReads = state.reads;
    await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
    await expect.poll(() => state.reads).toBeGreaterThan(previousReads);
    await dialog.getByRole('button', { name: '重新读取需求', exact: true }).click();
    await expect(dialog).toContainText('已读取最新需求');
    await expect(dialog.getByRole('button', { name: labels[action].confirm, exact: true })).toBeDisabled();
    if (labels[action].field) await expect(dialog.getByRole('textbox', { name: labels[action].field, exact: true })).toHaveValue('状态变化前的说明');
    await dialog.locator('form').evaluate((form) => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(state.writes).toHaveLength(0);
  });
}

for (const action of ['accept', 'cancel'] as const) {
  test(`${action}提交期间锁定说明，关闭和重复提交无效`, async ({ page }) => {
    const state = await fixture(page, action);
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    await page.route(`**/api/requirements/r1/${action}`, async (route) => {
      state.writes.push(route.request().postDataJSON());
      await waiting;
      return route.fulfill({ status: 500, json: { error: '暂时保存失败' } });
    });
    try {
      const dialog = await openCommand(page, action);
      const input = dialog.getByRole('textbox', { name: labels[action].field, exact: true });
      await input.fill('提交前的说明');
      await dialog.getByRole('button', { name: labels[action].confirm, exact: true }).click();
      await expect.poll(() => state.writes.length).toBe(1);
      await expect(input).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
      await dialog.locator('form').evaluate((form) => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
      expect(state.writes).toHaveLength(1);
      release();
      await expect(dialog).toContainText('暂时保存失败');
      await expect(input).toHaveValue('提交前的说明');
    } finally { release(); }
  });
}

test('归档响应不明保留确认窗口，不以目标状态推断成功', async ({ page }) => {
  const state = await fixture(page, 'archive');
  await page.route('**/api/requirements/r1', (route) => {
    if (route.request().method() === 'GET') return route.fallback();
    state.writes.push(route.request().postDataJSON());
    state.requirement = { ...state.requirement, deletedAt: '2026-09-05T10:00:00.000Z', version: 2 };
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>unexpected response</html>' });
  });
  const dialog = await openCommand(page, 'archive');
  await dialog.getByRole('button', { name: '确认归档', exact: true }).click();
  await expect(dialog).toContainText('提交结果仍待核对');
  await expect(dialog.getByRole('button', {name:'确认归档',exact:true})).toBeDisabled();
  await expect(page).toHaveURL('/requirements/r1');
  expect(state.writes).toHaveLength(1);
});

test('归档异常响应不把恢复后再次归档误认成本次归档', async ({ page }) => {
  const state = await fixture(page, 'archive');
  await page.route('**/api/requirements/r1', (route) => {
    if (route.request().method() === 'GET') return route.fallback();
    state.writes.push(route.request().postDataJSON());
    state.requirement = { ...state.requirement, deletedAt: '2026-09-05T10:00:00.000Z', version: 4 };
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>unexpected response</html>' });
  });
  const dialog = await openCommand(page, 'archive');
  await dialog.getByRole('button', { name: '确认归档', exact: true }).click();

  await expect(dialog).toBeVisible();
  await expect(page.getByText('已核对最新状态：需求已归档', { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL('/requirements/r1');
  expect(state.writes).toHaveLength(1);
});

for (const status of [403, 404]) {
  test(`需求命令失败后读取${status}，不再展示旧确认信息`, async ({ page }) => {
    const state = await fixture(page, 'cancel');
    await page.route('**/api/requirements/r1/cancel', (route) => {
      state.writes.push(route.request().postDataJSON());
      state.readStatus = status;
      return route.fulfill({ status, json: { error: '当前操作不可用' } });
    });
    const dialog = await openCommand(page, 'cancel');
    await dialog.getByRole('textbox', { name: '取消原因', exact: true }).fill('失权后隐藏的说明');
    await dialog.getByRole('button', { name: '确认取消', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('需求无法打开', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    expect(state.writes).toHaveLength(1);
  });
}

test('历史补录异常成功响应不自动重发，核对已完成状态后禁止重复补录', async ({ page }) => {
  const state = await fixture(page, 'complete-as-planned');
  await page.route('**/api/requirements/r1/complete-as-planned', (route) => {
    state.writes.push(route.request().postDataJSON());
    const completionAt = '2026-09-06T09:00:00.000Z';
    const acceptanceAt = '2026-09-06T09:00:00.001Z';
    const completedItem = {
      ...state.requirement.workItems[0], status: 'completed' as const, progress: 100,
      actualStart: '2020-01-02', actualEnd: '2020-01-03', version: 2, updatedAt: completionAt,
    };
    state.requirement = {
      ...state.requirement, status: 'completed', progress: 100, version: 3, updatedAt: acceptanceAt,
      workItems: [completedItem],
      progressUpdates: [{
        id: 'accept-event', requirementId: 'r1', workItemId: null, workItemTitle: null,
        percent: 100, workItemPercent: null, content: '历史补录，按计划完成；确认验收',
        eventType: 'accept', supersedesId: null, createdByAccountId: 'admin', createdByName: 'admin',
        createdAt: acceptanceAt, updatedAt: acceptanceAt,
      }, {
        id: 'complete-event', requirementId: 'r1', workItemId: 'w1', workItemTitle: completedItem.title,
        percent: 100, workItemPercent: 100, content: '历史补录，按计划完成（2020-01-02 至 2020-01-03）',
        eventType: 'complete', supersedesId: null, createdByAccountId: 'admin', createdByName: 'admin',
        createdAt: completionAt, updatedAt: completionAt,
      }],
    };
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>unexpected response</html>' });
  });
  const dialog = await openCommand(page, 'complete-as-planned');
  await dialog.getByRole('button', { name: '确认按期完成', exact: true }).click();
  await expect(dialog).toContainText('提交结果仍待核对');
  await expect(dialog.getByRole('button',{name:'确认按期完成',exact:true})).toBeDisabled();
  await dialog.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button', { name: '需求操作', exact: true }).click();
  await expect(page.getByRole('button', { name: '按期完成（历史补录）', exact: true })).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
});

test('历史补录异常响应不把旧补录事件误认成本次按期完成', async ({ page }) => {
  const state = await fixture(page, 'complete-as-planned');
  await page.route('**/api/requirements/r1/complete-as-planned', (route) => {
    state.writes.push(route.request().postDataJSON());
    const item = {
      ...state.requirement.workItems[0], status: 'completed' as const, progress: 100,
      actualStart: '2020-01-02', actualEnd: '2020-01-03', version: 4, updatedAt: '2026-09-06T10:00:00.000Z',
    };
    state.requirement = {
      ...state.requirement, status: 'completed', progress: 100, version: 5,
      updatedAt: '2026-09-06T10:00:00.000Z', workItems: [item],
      progressUpdates: [{
        id: 'old-complete', requirementId: 'r1', workItemId: 'w1', workItemTitle: item.title,
        percent: 100, workItemPercent: 100, content: '历史补录，按计划完成（2020-01-02 至 2020-01-03）',
        eventType: 'complete', supersedesId: null, createdByAccountId: 'admin', createdByName: 'admin',
        createdAt: '2026-09-06T09:00:00.000Z', updatedAt: '2026-09-06T09:00:00.000Z',
      }],
    };
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>unexpected response</html>' });
  });
  const dialog = await openCommand(page, 'complete-as-planned');
  await dialog.getByRole('button', { name: '确认按期完成', exact: true }).click();

  await expect(dialog).toBeVisible();
  await expect(page.getByText('已核对最新状态：需求已按期补录完成', { exact: true })).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
});

test('已完成需求可从操作菜单受控纠错且不提交交付字段', async ({ page }) => {
  const state = await fixture(page, 'archive');
  state.requirement = {
    ...state.requirement,
    ownerId: 'person-1', ownerName: '历史负责人', background: null, acceptanceCriteria: null, referenceUrl: null,
    progressUpdates: [{
      id: 'accept-1', requirementId: 'r1', workItemId: null, workItemTitle: null, percent: 100, workItemPercent: null,
      content: '原验收记录', eventType: 'accept', supersedesId: null, createdAt: '2020-01-03T08:00:00.000Z', updatedAt: '2020-01-03T08:00:00.000Z',
    }],
  };
  await page.route('**/api/people?**', (route) => route.fulfill({ json: [{ id: 'person-1', name: '历史负责人', active: 1, projectRole: 'member' }] }));
  await page.route('**/api/requirements/r1/correct', (route) => {
    const input = route.request().postDataJSON() as Record<string, unknown>;
    state.writes.push(input);
    state.requirement = { ...state.requirement, title: String(input.title), version: 2 };
    return route.fulfill({ json: state.requirement });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '需求操作', exact: true }).click();
  await page.getByRole('button', { name: '受控纠错', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '需求受控纠错', exact: true });
  await dialog.getByRole('textbox', { name: '纠错后的需求标题', exact: true }).fill('修正后的历史需求');
  await dialog.getByRole('combobox', { name: '需求纠错关联历史记录', exact: true }).selectOption('accept-1');
  await dialog.getByRole('textbox', { name: '需求纠错原因', exact: true }).fill('历史标题录入错误');
  await dialog.getByRole('button', { name: '保存纠错', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]).toMatchObject({
    expectedVersion: 1, title: '修正后的历史需求', reason: '历史标题录入错误', supersedesId: 'accept-1',
  });
  for (const field of ['status', 'progress', 'acceptedAt', 'plannedStart', 'plannedEnd', 'templateId']) expect(state.writes[0]).not.toHaveProperty(field);
});

for (const action of ['accept', 'cancel'] as const) {
  test(`${action}异常响应核对状态后保留说明且禁止重复提交`, async ({ page }) => {
    const state = await fixture(page, action);
    await page.route(`**/api/requirements/r1/${action}`, (route) => {
      state.writes.push(route.request().postDataJSON());
      const updatedAt = '2026-09-06T09:00:00.000Z';
      state.requirement = {
        ...state.requirement,
        status: action === 'accept' ? 'completed' : 'cancelled', version: 2, updatedAt,
        progressUpdates: [{
          id: `${action}-event`, requirementId: 'r1', workItemId: null, workItemTitle: null,
          percent: action === 'accept' ? 100 : 0, workItemPercent: null,
          content: '异常响应核对说明', eventType: action, supersedesId: null,
          createdByAccountId: 'admin', createdByName: 'admin', createdAt: updatedAt, updatedAt,
        }],
      };
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>unexpected response</html>' });
    });
    const dialog = await openCommand(page, action);
    await dialog.getByRole('textbox', { name: labels[action].field, exact: true }).fill('异常响应核对说明');
    await dialog.getByRole('button', { name: labels[action].confirm, exact: true }).click();
    await expect(dialog).toContainText('提交结果仍待核对');
    await expect(dialog.getByRole('textbox',{name:labels[action].field,exact:true})).toHaveValue('异常响应核对说明');
    await expect(dialog.getByRole('button',{name:labels[action].confirm,exact:true})).toBeDisabled();
    expect(state.writes).toHaveLength(1);
  });
}

test('验收异常响应不把旧同值事件误认成本次验收', async ({ page }) => {
  const state = await fixture(page, 'accept');
  await page.route('**/api/requirements/r1/accept', (route) => {
    state.writes.push(route.request().postDataJSON());
    state.requirement = {
      ...state.requirement,
      status: 'completed', version: 4, updatedAt: '2026-09-06T10:00:00.000Z',
      progressUpdates: [{
        id: 'old-accept', requirementId: 'r1', workItemId: null, workItemTitle: null,
        percent: 100, workItemPercent: null, content: '重复的验收说明', eventType: 'accept', supersedesId: null,
        createdByAccountId: 'admin', createdByName: 'admin',
        createdAt: '2026-09-06T09:00:00.000Z', updatedAt: '2026-09-06T09:00:00.000Z',
      }],
    };
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>unexpected response</html>' });
  });
  const dialog = await openCommand(page, 'accept');
  await dialog.getByRole('textbox', { name: '验收说明', exact: true }).fill('重复的验收说明');
  await dialog.getByRole('button', { name: '确认验收', exact: true }).click();

  await expect(dialog).toBeVisible();
  await expect(page.getByText('已核对最新状态：需求已验收', { exact: true })).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
});
