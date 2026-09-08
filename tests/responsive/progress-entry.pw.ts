import { expect, test, type Page } from '@playwright/test';
import type { Requirement, WorkItem } from '../../src/client/types';

const workItem: WorkItem = {
  id: 'w1', requirementId: 'r1', templateItemId: null, title: '接口开发', ownerId: 'u1', ownerName: '张三',
  collaborators: [], assigneeIds: ['u1'], assigneeNames: ['张三'], status: 'in_progress', progress: 40,
  plannedStart: '2026-09-01', plannedEnd: '2026-09-10', actualStart: '2026-09-01', actualEnd: null,
  forecastEnd: null, blockedAt: null, blockedReason: null, milestoneLabel: null,
  sortOrder: 0, version: 1, createdAt: '2026-09-01', updatedAt: '2026-09-01',
};
const requirement: Requirement = {
  id: 'r1', projectId: 'p1', projectName: '测试项目', templateId: null, templateName: null, title: '进展录入测试',
  ownerId: 'u1', ownerName: '张三', status: 'in_progress', plannedStart: '2026-09-01', plannedEnd: '2026-09-10',
  progress: 40, plannedProgress: 40, progressGap: 0, acceptedAt: null, acceptedByAccountId: null, version: 1,
  riskLevel: 'low', riskEvaluated: true, riskReason: '', priority: 'P2', createdAt: '2026-09-01', updatedAt: '2026-09-01',
  workItems: [workItem, { ...workItem, id: 'w2', title: '另一个工作项', sortOrder: 1 }], progressUpdates: [],
  delayed: false, highRisk: false, finishVariance: 0, durationVariance: 0, effectiveEnd: '2026-09-10',
};

async function fixture(page: Page, status = 'in_progress', role: 'admin' | 'member' | 'owner' = 'admin') {
  const state = { requirement: structuredClone(requirement), failRead: false, reads: 0, requests: [] as Array<Record<string, unknown>> };
  state.requirement.workItems[0] = { ...state.requirement.workItems[0], status, ...(status === 'not_started' ? { progress: 0, actualStart: null } : {}) };
  if (role !== 'admin') {
    state.requirement.ownerId = role === 'owner' ? 'u1' : 'u2';
    state.requirement.workItems[1] = { ...state.requirement.workItems[1], ownerId: 'u2', ownerName: '李四', assigneeIds: ['u2'], assigneeNames: ['李四'] };
  }
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/session') return route.fulfill({ json: { authenticated: true, accountId: role, username: role, role: role === 'admin' ? 'admin' : 'user', globalRole: role === 'admin' ? 'admin' : 'user', personId: 'u1', mustChangePassword: false, managedProjectIds: [] } });
    if (pathname === '/api/projects') return route.fulfill({ json: [{ id: 'p1', name: '测试项目', status: 'active', plannedStart: '2026-09-01', plannedEnd: '2026-09-30', defaultTemplateId: null }] });
    if (pathname === '/api/people') return route.fulfill({ json: [{ id: 'u1', name: '张三', active: 1, projectRole: 'member' }, { id: 'u2', name: '李四', active: 1, projectRole: 'member' }] });
    if (pathname === '/api/templates') return route.fulfill({ json: [] });
    if (pathname === '/api/requirements/r1' || pathname === '/api/my-work') {
      state.reads++;
      if (state.failRead) return route.fulfill({ status: 503, json: { error: '最新工作项暂时无法读取' } });
      if (pathname === '/api/requirements/r1') return route.fulfill({ json: state.requirement });
      return route.fulfill({ json: {
        summary: { total: 2, notStarted: 0, inProgress: 2, blocked: 0, overdue: 0, completed: 0 }, requirements: [],
        items: state.requirement.workItems.map((item) => ({ ...item, projectId: 'p1', projectName: '测试项目', requirementTitle: state.requirement.title, requirementStatus: state.requirement.status, assignmentType: 'owner', overdue: false })),
        completionTrend: [], upcoming: [], recentProgress: state.requirement.progressUpdates || [],
      } });
    }
    if (pathname === '/api/requirements/r1/progress' && route.request().method() === 'POST') {
      const input = route.request().postDataJSON();
      state.requests.push(input);
      const item = state.requirement.workItems.find((entry) => entry.id === input.workItemId);
      if (input.workItemId && !item) return route.fulfill({ status: 404, json: { error: '关联工作项不存在' } });
      if (item && ['completed', 'cancelled'].includes(item.status)) return route.fulfill({ status: 409, json: { error: '工作项已结束', code: 'TERMINAL_LOCKED' } });
      if (input.workItemPercent !== undefined && item?.status !== 'in_progress') return route.fulfill({ status: 409, json: { error: '只有进行中工作项可以更新完成度', code: 'INVALID_TRANSITION' } });
      return route.fulfill({ json: state.requirement });
    }
    return route.fulfill({ json: {} });
  });
  return state;
}

async function openProgress(page: Page, source: 'detail' | 'my-work', selectItem = true) {
  await page.goto(source === 'detail' ? '/requirements/r1' : '/my-work');
  if (source === 'detail') {
    await page.getByRole('button', { name: '增加进展', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '增加进展', exact: true });
    if (selectItem) await dialog.getByRole('combobox', { name: /关联工作项/ }).selectOption('w1');
    return dialog;
  }
  await page.getByRole('button', { name: '为接口开发写进展', exact: true }).click();
  return page.getByRole('dialog', { name: '添加工作进展', exact: true });
}

for (const [source, status] of [['detail', 'not_started'], ['detail', 'blocked'], ['my-work', 'blocked']] as const) {
  test(`${source} ${status}只追加关联说明，不发送完成度`, async ({ page }) => {
    const state = await fixture(page, status);
    const dialog = await openProgress(page, source);
    await expect(dialog.getByRole('spinbutton')).toHaveCount(0);
    await dialog.getByRole('textbox', { name: '具体进展', exact: true }).fill('保留工作项关联的说明');
    await dialog.getByRole('button', { name: source === 'detail' ? '记录进展' : '保存进展', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.requests).toEqual([{ content: '保留工作项关联的说明', workItemId: 'w1', expectedVersion: 1 }]);
  });
}

for (const source of ['detail', 'my-work'] as const) {
  for (const [kind, body] of [['html', '<html>invalid write response</html>'], ['truncated', '{"id":'], ['empty', '']] as const) {
    test(`${source}异常成功响应${kind}不误报保存成功、不丢稿或自动重发`, async ({ page }, testInfo) => {
      const state = await fixture(page);
      await page.route('**/api/requirements/r1/progress', async (route) => {
        state.requests.push(route.request().postDataJSON());
        await route.fulfill({ status: 200, contentType: kind === 'html' ? 'text/html' : 'application/json', body });
      });
      const dialog = await openProgress(page, source);
      const content = dialog.getByRole('textbox', { name: '具体进展', exact: true });
      const percent = dialog.getByRole('spinbutton');
      await content.fill('操作结果需要核对，不能假装保存成功');
      await percent.fill('60');
      await dialog.getByRole('button', { name: source === 'detail' ? '记录进展' : '保存进展', exact: true }).click();
      await expect(dialog.getByText(/操作结果暂时无法确认/)).toBeVisible();
      await expect(dialog.getByText(/避免重复提交/)).toBeVisible();
      await expect(content).toHaveValue('操作结果需要核对，不能假装保存成功');
      await expect(percent).toHaveValue('60');
      await expect(content).toBeEnabled();
      expect(state.requests).toHaveLength(1);
      expect(state.requests[0]).toMatchObject({ workItemId: 'w1', workItemPercent: 60, expectedVersion: 1 });
      if (kind === 'html') await dialog.screenshot({ path: testInfo.outputPath('response-unknown.png'), animations: 'disabled' });
    });
  }

  test(`${source}进展已落库但响应异常时核对新记录并关闭`, async ({ page }) => {
    const state = await fixture(page);
    await page.route('**/api/requirements/r1/progress', async (route) => {
      const input = route.request().postDataJSON();
      state.requests.push(input);
      state.requirement.workItems[0] = { ...state.requirement.workItems[0], progress: input.workItemPercent, version: 2 };
      state.requirement.progressUpdates = [{
        id: 'new-progress', requirementId: 'r1', workItemId: 'w1', workItemTitle: '接口开发',
        percent: 60, workItemPercent: input.workItemPercent, content: String(input.content).normalize('NFC'), eventType: 'progress',
        createdByAccountId: 'admin', createdByName: 'admin',
        createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
      }];
      await route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
    });
    const dialog = await openProgress(page, source);
    await dialog.getByRole('textbox', { name: '具体进展', exact: true }).fill('Cafe\u0301 需要读取后确认的新进展');
    await dialog.getByRole('spinbutton').fill('60');
    await dialog.getByRole('button', { name: source === 'detail' ? '记录进展' : '保存进展', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('已核对最新状态：进展已记录', { exact: true })).toBeVisible();
    expect(state.requests).toHaveLength(1);
  });

  if (source === 'detail') test('关联说明响应异常时不把同内容的状态事件误认成进展', async ({ page }) => {
    const state = await fixture(page, 'blocked');
    await page.route('**/api/requirements/r1/progress', async (route) => {
      const input = route.request().postDataJSON();
      state.requests.push(input);
      const changedAt = '2026-09-05T08:00:00.000Z';
      state.requirement.workItems[0] = {
        ...state.requirement.workItems[0], status: 'in_progress', blockedAt: null, blockedReason: null,
        version: 2, updatedAt: changedAt,
      };
      state.requirement.progressUpdates = [{
        id: 'unblock-event', requirementId: 'r1', workItemId: 'w1', workItemTitle: '接口开发',
        percent: 40, workItemPercent: 40, content: '解除阻塞工作项', eventType: 'unblock',
        createdAt: changedAt, updatedAt: changedAt,
      }];
      await route.fulfill({ status: 200, contentType: 'text/html', body: 'saved elsewhere' });
    });
    const dialog = await openProgress(page, 'detail');
    const content = dialog.getByRole('textbox', { name: '具体进展', exact: true });
    await content.fill('解除阻塞工作项');
    await dialog.getByRole('button', { name: '记录进展', exact: true }).click();

    await expect(dialog).toBeVisible();
    await expect(content).toHaveValue('解除阻塞工作项');
    await expect(page.getByText('已核对最新状态：进展已记录', { exact: true })).toHaveCount(0);
    expect(state.requests).toHaveLength(1);
  });

  if (source === 'detail') test('进展响应异常时不把其他账号的相同记录误认成本人提交', async ({ page }) => {
    const state = await fixture(page);
    await page.route('**/api/requirements/r1/progress', async (route) => {
      const input = route.request().postDataJSON();
      state.requests.push(input);
      const changedAt = '2026-09-05T08:00:00.000Z';
      state.requirement.workItems[0] = {
        ...state.requirement.workItems[0], progress: 60, version: 2, updatedAt: changedAt,
      };
      state.requirement.progressUpdates = [{
        id: 'other-progress', requirementId: 'r1', workItemId: 'w1', workItemTitle: '接口开发',
        percent: 60, workItemPercent: 60, content: '相同内容的并发进展', eventType: 'progress',
        createdByAccountId: 'other-account', createdByName: '其他用户', createdAt: changedAt, updatedAt: changedAt,
      }];
      await route.fulfill({ status: 200, contentType: 'text/html', body: 'saved elsewhere' });
    });
    const dialog = await openProgress(page, 'detail');
    const content = dialog.getByRole('textbox', { name: '具体进展', exact: true });
    await content.fill('相同内容的并发进展');
    await dialog.getByRole('spinbutton').fill('60');
    await dialog.getByRole('button', { name: '记录进展', exact: true }).click();

    await expect(dialog).toBeVisible();
    await expect(content).toHaveValue('相同内容的并发进展');
    await expect(page.getByText('已核对最新状态：进展已记录', { exact: true })).toHaveCount(0);
    expect(state.requests).toHaveLength(1);
  });

  test(`${source}提交锁定、500保留草稿、409重新读取失败后重试，不能降低完成度`, async ({ page }, testInfo) => {
    const state = await fixture(page);
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/api/requirements/r1/progress', async (route) => {
      state.requests.push(route.request().postDataJSON());
      if (state.requests.length === 1) { await waiting; return route.fulfill({ status: 500, json: { error: '保存失败，请重试' } }); }
      if (state.requests.length === 2) {
        state.requirement.workItems[0] = { ...state.requirement.workItems[0], progress: 70, version: 2 };
        state.failRead = true;
        return route.fulfill({ status: 409, json: { error: '工作项已更新，请重新核对', code: 'STALE_WRITE', currentVersion: 2 } });
      }
      return route.fulfill({ json: state.requirement });
    });
    try {
      const dialog = await openProgress(page, source);
      const saveName = source === 'detail' ? '记录进展' : '保存进展';
      const content = dialog.getByRole('textbox', { name: '具体进展', exact: true });
      const percent = dialog.getByRole('spinbutton');
      await content.fill('我的工作结果和说明');
      await percent.fill('60');
      await dialog.getByRole('button', { name: saveName, exact: true }).click();
      await expect.poll(() => state.requests.length).toBe(1);
      await expect(content).toBeDisabled();
      await expect(percent).toBeDisabled();
      await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
      await dialog.locator('form').evaluate((form) => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
      release();
      await expect(dialog.getByText('保存失败，请重试')).toBeVisible();
      expect(state.requests).toHaveLength(1);
      await expect(content).toHaveValue('我的工作结果和说明');
      await expect(percent).toHaveValue('60');
      await dialog.getByRole('button', { name: saveName, exact: true }).click();
      await expect(dialog.getByText('最新工作项暂时无法读取')).toBeVisible();
      await expect(dialog.getByRole('button', { name: saveName, exact: true })).toBeDisabled();
      state.failRead = false;
      await dialog.getByRole('button', { name: '重新读取工作项', exact: true }).click();
      await expect(dialog.getByText(/当前完成度 70%/)).toBeVisible();
      await expect(percent).toHaveValue('60');
      await expect(dialog.getByText(/不能降低完成度/)).toBeVisible();
      await expect(dialog.getByRole('button', { name: saveName, exact: true })).toBeDisabled();
      await percent.fill('75');
      await dialog.screenshot({ path: testInfo.outputPath('progress-review.png'), animations: 'disabled' });
      await dialog.getByRole('button', { name: saveName, exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(state.requests).toEqual([
        { content: '我的工作结果和说明', workItemId: 'w1', workItemPercent: 60, expectedVersion: 1 },
        { content: '我的工作结果和说明', workItemId: 'w1', workItemPercent: 60, expectedVersion: 1 },
        { content: '我的工作结果和说明', workItemId: 'w1', workItemPercent: 75, expectedVersion: 2 },
      ]);
    } finally { release(); }
  });

  test(`${source}后台更新工作项后不能用新版本悄悄提交旧草稿`, async ({ page }) => {
    const state = await fixture(page);
    const dialog = await openProgress(page, source);
    await dialog.getByRole('textbox', { name: '具体进展', exact: true }).fill('保留正在输入的内容');
    await dialog.getByRole('spinbutton').fill('75');
    state.requirement.workItems[0] = { ...state.requirement.workItems[0], progress: 50, version: 2 };
    const previousReads = state.reads;
    await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
    await expect.poll(() => state.reads).toBeGreaterThan(previousReads);
    const saveName = source === 'detail' ? '记录进展' : '保存进展';
    await expect(dialog.getByRole('button', { name: saveName, exact: true })).toBeDisabled();
    await expect(dialog.getByText(/工作项已更新/)).toBeVisible();
    expect(state.requests).toHaveLength(0);
    await dialog.getByRole('button', { name: '重新读取工作项', exact: true }).click();
    await expect(dialog.getByRole('button', { name: saveName, exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: saveName, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.requests).toEqual([{ content: '保留正在输入的内容', workItemId: 'w1', workItemPercent: 75, expectedVersion: 2 }]);
  });
}

for (const next of ['completed', 'removed'] as const) {
  test(`已选择的工作项${next}后不悄悄退化为需求说明`, async ({ page }) => {
    const state = await fixture(page, next === 'removed' ? 'not_started' : 'in_progress');
    const dialog = await openProgress(page, 'detail');
    await dialog.getByRole('textbox', { name: '具体进展', exact: true }).fill('不能丢失关联的输入');
    state.requirement.workItems = next === 'removed' ? state.requirement.workItems.slice(1) : state.requirement.workItems.map((item) => item.id === 'w1' ? { ...item, status: 'completed', progress: 100, actualEnd: '2026-09-04', version: 2 } : item);
    const previousReads = state.reads;
    await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
    await expect.poll(() => state.reads).toBeGreaterThan(previousReads);
    await expect(dialog.getByRole('button', { name: '记录进展', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('combobox', { name: /关联工作项/ })).toHaveValue('w1');
    await dialog.locator('form').evaluate((form) => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(state.requests).toHaveLength(0);
    await expect(dialog.getByRole('textbox', { name: '具体进展', exact: true })).toHaveValue('不能丢失关联的输入');
    await dialog.getByRole('combobox', { name: /关联工作项/ }).selectOption('');
    await dialog.getByRole('button', { name: '记录进展', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.requests).toEqual([{ content: '不能丢失关联的输入' }]);
  });
}

for (const source of ['detail', 'my-work'] as const) {
  test(`${source}固定工作项入口结束后禁止提交，不出现其他关联选项`, async ({ page }) => {
    const state = await fixture(page);
    let dialog;
    if (source === 'detail') {
      await page.goto('/requirements/r1');
      await page.locator('.requirement-gantt-grid .gantt-progress-marker').first().click();
      dialog = page.getByRole('dialog', { name: '更新工作项进度', exact: true });
    } else dialog = await openProgress(page, source);
    await dialog.getByRole('textbox', { name: '具体进展', exact: true }).fill('固定关联的草稿');
    state.requirement.workItems[0] = { ...state.requirement.workItems[0], status: 'completed', progress: 100, actualEnd: '2026-09-04', version: 2 };
    const previousReads = state.reads;
    await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
    await expect.poll(() => state.reads).toBeGreaterThan(previousReads);
    await expect(dialog.getByRole('button', { name: source === 'detail' ? '记录进展' : '保存进展', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('combobox')).toHaveCount(0);
    await expect(dialog.getByRole('textbox', { name: '具体进展', exact: true })).toHaveValue('固定关联的草稿');
    await dialog.locator('form').evaluate((form) => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(state.requests).toHaveLength(0);
  });
}

for (const role of ['member', 'owner'] as const) {
  test(`${role}进展录入仅展示允许的工作项与需求说明入口`, async ({ page }) => {
    const state = await fixture(page, 'in_progress', role);
    const dialog = await openProgress(page, 'detail', false);
    const select = dialog.getByRole('combobox', { name: /关联工作项/ });
    expect(await select.locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value)))
      .toEqual(role === 'owner' ? ['', 'w1', 'w2'] : ['w1']);
    if (role === 'owner') await select.selectOption('w2');
    await dialog.getByRole('textbox', { name: '具体进展', exact: true }).fill('权限范围内更新进展');
    await dialog.getByRole('spinbutton').fill('75');
    await dialog.getByRole('button', { name: '记录进展', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.requests).toEqual([{ content: '权限范围内更新进展', workItemId: role === 'owner' ? 'w2' : 'w1', workItemPercent: 75, expectedVersion: 1 }]);
  });
}

test('完成工作项允许留空说明并保留可选提示', async ({ page }) => {
  const state = await fixture(page);
  await page.route('**/api/work-items/w1/complete', async (route) => {
    state.requests.push(route.request().postDataJSON());
    state.requirement.workItems[0] = { ...state.requirement.workItems[0], status: 'completed', progress: 100, version: 2 };
    return route.fulfill({ json: state.requirement.workItems[0] });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('button', { name: '完成', exact: true }).first().click();
  const popover = page.locator('.inline-edit-popover');
  await expect(popover.getByText('可留空，系统会记录“完成工作项”', { exact: true })).toBeVisible();
  await expect(popover.getByRole('textbox', { name: '完成说明', exact: true })).toHaveValue('');
  await expect(popover.getByRole('button', { name: '确认完成', exact: true })).toBeEnabled();
  await popover.getByRole('button', { name: '确认完成', exact: true }).click();
  await expect(popover).toHaveCount(0);
  expect(state.requests).toEqual([{ expectedVersion: 1 }]);
});

for (const source of ['detail', 'my-work'] as const) {
  test(`${source}完成操作固定草稿版本，冲突重读失败后显式恢复再提交`, async ({ page }, testInfo) => {
    const state = await fixture(page);
    await page.route('**/api/work-items/w1/complete', async (route) => {
      state.requests.push(route.request().postDataJSON());
      if (state.requests.length === 1) {
        state.failRead = true;
        return route.fulfill({ status: 409, json: { error: '工作项已更新，请核对后重试', code: 'STALE_WRITE' } });
      }
      state.requirement.workItems[0] = { ...state.requirement.workItems[0], status: 'completed', progress: 100, version: 3 };
      return route.fulfill({ json: state.requirement.workItems[0] });
    });
    await page.goto(source === 'detail' ? '/requirements/r1' : '/my-work');
    await page.getByRole('button', { name: '完成', exact: true }).first().click();
    const popover = page.locator('.inline-edit-popover');
    const content = popover.getByRole('textbox', { name: '完成说明', exact: true });
    await content.fill('本次交付结果需要保留');
    state.requirement.workItems[0] = { ...state.requirement.workItems[0], progress: 60, version: 2 };
    const previousReads = state.reads;
    await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
    await expect.poll(() => state.reads).toBeGreaterThan(previousReads);
    await popover.getByRole('button', { name: '确认完成', exact: true }).click();
    await expect(popover.getByText('最新工作项暂时无法读取')).toBeVisible();
    await expect(popover.getByRole('button', { name: '确认完成', exact: true })).toBeDisabled();
    await expect(content).toHaveValue('本次交付结果需要保留');
    expect(state.requests).toEqual([{ content: '本次交付结果需要保留', expectedVersion: 1 }]);
    state.failRead = false;
    await popover.getByRole('button', { name: '重新读取工作项', exact: true }).click();
    await expect(popover.getByText(/已读取最新工作项（版本 2）/)).toBeVisible();
    await expect(content).toHaveValue('本次交付结果需要保留');
    if (testInfo.project.name === 'office-1280') await page.screenshot({ path: `data/round22-ui/${source}-work-action-review.png`, animations: 'disabled' });
    await popover.getByRole('button', { name: '确认完成', exact: true }).click();
    await expect(popover).toHaveCount(0);
    expect(state.requests).toEqual([
      { content: '本次交付结果需要保留', expectedVersion: 1 },
      { content: '本次交付结果需要保留', expectedVersion: 2 },
    ]);
  });

  test(`${source}完成操作等待期间锁定，重读发现阻塞后保留说明并禁止旧操作`, async ({ page }) => {
    const state = await fixture(page);
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/api/work-items/w1/complete', async (route) => {
      state.requests.push(route.request().postDataJSON());
      await waiting;
      state.requirement.workItems[0] = { ...state.requirement.workItems[0], status: 'blocked', blockedReason: '新发现阻塞', version: 2 };
      return route.fulfill({ status: 409, json: { error: '工作项状态已更新', code: 'STALE_WRITE' } });
    });
    try {
      await page.goto(source === 'detail' ? '/requirements/r1' : '/my-work');
      await page.getByRole('button', { name: '完成', exact: true }).first().click();
      const popover = page.locator('.inline-edit-popover');
      const content = popover.getByRole('textbox', { name: '完成说明', exact: true });
      await content.fill('状态变化也不能丢失这段说明');
      await popover.getByRole('button', { name: '确认完成', exact: true }).click();
      await expect.poll(() => state.requests.length).toBe(1);
      await expect(content).toHaveAttribute('readonly', '');
      await expect(popover.getByRole('button', { name: '关闭', exact: true })).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(popover).toBeVisible();
      release();
      await expect(popover.getByText('工作项状态已变化，请关闭后重新选择操作。')).toBeVisible();
      await expect(content).toHaveValue('状态变化也不能丢失这段说明');
      await expect(popover.getByRole('button', { name: '确认完成', exact: true })).toBeDisabled();
      await popover.locator('form').evaluate((form) => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
      expect(state.requests).toHaveLength(1);
    } finally { release(); }
  });

  test(`${source}工作项操作失权后重读确认拒绝，隐藏旧操作与说明`, async ({ page }) => {
    const state = await fixture(page);
    let denied = false;
    await page.route(source === 'detail' ? '**/api/requirements/r1' : '**/api/my-work', (route) => denied
      ? route.fulfill({ status: 403, json: { error: '已经没有访问权限' } })
      : route.fallback());
    await page.route('**/api/work-items/w1/complete', (route) => {
      state.requests.push(route.request().postDataJSON());
      denied = true;
      return route.fulfill({ status: 403, json: { error: '没有完成权限' } });
    });
    await page.goto(source === 'detail' ? '/requirements/r1' : '/my-work');
    await page.getByRole('button', { name: '完成', exact: true }).first().click();
    await page.getByRole('textbox', { name: '完成说明', exact: true }).fill('失权后不能继续显示的说明');
    await page.getByRole('button', { name: '确认完成', exact: true }).click();
    await expect(page.locator('.inline-edit-popover')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: '完成说明', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '重新加载', exact: true })).toBeVisible();
    expect(state.requests).toHaveLength(1);
  });
}
