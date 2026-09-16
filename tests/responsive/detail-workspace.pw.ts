import {expect, test, type Page} from '@playwright/test';
import {phaseFixture} from './phase-fixture';

async function post(page: Page, url: string, data: unknown) {
  const response = await page.request.post(url, {data});
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

test('需求详情页签和操作固定，工作项返回与切换视角保留输入', async ({page}, info) => {
  const f = await phaseFixture(page);
  for (let index = 0; index < 10; index++) {
    const current = await (await page.request.get('/api/requirements/' + f.testing.id)).json();
    await post(page, '/api/requirements/' + f.testing.id + '/work-items', {expectedVersion: current.version, title: '补充工作项 ' + index, reason: '验证长工作项清单'});
  }
  const current = await (await page.request.get('/api/requirements/' + f.testing.id)).json();
  const saved = await page.request.patch('/api/requirements/' + f.testing.id, {data: {expectedVersion: current.version, background: '很长的需求说明\n'.repeat(100)}});
  expect(saved.ok(), await saved.text()).toBe(true);
  await page.goto('/?' + new URLSearchParams({projectId: f.projectId, workspaceView: 'progress', scopeType: 'project', scopeId: f.projectId, pathNode: f.testing.id, pathInspector: 'open'}));
  const detail = page.getByRole('complementary', {name: '对象详情'});
  const tabs = detail.getByRole('tablist', {name: '需求详情内容'});
  await expect(tabs).toBeVisible();
  const frame = await detail.boundingBox(), grid = await page.getByRole('treegrid').boundingBox(), tabFrame = await tabs.boundingBox();
  await tabs.getByRole('tab', {name: '基本信息', exact: true}).click();
  await detail.getByRole('tabpanel', {name: '基本信息', exact: true}).evaluate(el => {el.scrollTop = 900;});
  expect(await tabs.boundingBox()).toEqual(tabFrame);
  await tabs.getByRole('tab', {name: '工作项 12', exact: true}).click();
  await expect(detail.getByRole('button', {name: '添加工作项', exact: true})).toBeInViewport();
  await expect(detail.getByRole('button', {name: '工作项设置', exact: true})).toBeInViewport();
  await detail.getByRole('button', {name: /^测试.*Phase 负责人/}).click();
  const work = detail.getByRole('dialog', {name: '测试', exact: true});
  await expect(work.getByText('协作人', {exact: true})).toBeVisible();
  expect(await detail.boundingBox()).toEqual(frame);
  await work.locator(':scope > header').getByRole('button', {name: '返回', exact: true}).click();
  await expect(tabs.getByRole('tab', {name: '工作项 12', exact: true})).toHaveAttribute('aria-selected', 'true');
  await tabs.getByRole('tab', {name: '基本信息', exact: true}).click();
  expect(await detail.getByRole('tabpanel', {name: '基本信息', exact: true}).evaluate(el => el.scrollTop)).toBeGreaterThan(800);
  await detail.getByRole('button', {name: '编辑信息', exact: true}).click();
  const edit = detail.getByRole('dialog', {name: '编辑需求信息', exact: true});
  await edit.getByLabel('需求标题', {exact: true}).fill('保留未提交的需求标题');
  await page.getByRole('button', {name: '关系图', exact: true}).click();
  await expect(edit.getByLabel('需求标题', {exact: true})).toHaveValue('保留未提交的需求标题');
  await page.getByRole('button', {name: '特性清单', exact: true}).click();
  await expect(edit.getByLabel('需求标题', {exact: true})).toHaveValue('保留未提交的需求标题');
  await page.getByRole('button', {name: '进展表', exact: true}).click();
  expect(await page.getByRole('treegrid').boundingBox()).toEqual(grid);
  await expect(edit.getByRole('button', {name: '保存信息', exact: true})).toBeInViewport();
  await page.screenshot({path: info.outputPath('detail-inline-edit.png'), animations: 'disabled'});
  await edit.getByRole('button', {name: '返回', exact: true}).click();
  await page.setViewportSize({width: 390, height: 844});
  await tabs.getByRole('tab', {name: '工作项 12', exact: true}).click();
  await detail.getByRole('button', {name: '工作项设置', exact: true}).click();
  await expect(detail.getByRole('dialog', {name: '工作项设置', exact: true})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({path: info.outputPath('narrow-work-settings.png'), animations: 'disabled'});
  await detail.getByRole('dialog', {name: '工作项设置', exact: true}).getByRole('button', {name: '返回', exact: true}).click();
  await detail.getByRole('button', {name: '添加工作项', exact: true}).click();
  const create = detail.getByRole('dialog', {name: '添加工作项', exact: true});
  await create.getByLabel('新工作项名称', {exact: true}).fill('在窄屏新增工作项');
  await create.getByLabel('变更说明（可选）', {exact: true}).fill('补充本次交付范围');
  await expect(create.getByRole('button', {name: '保存工作项', exact: true})).toBeInViewport();
  expect(await create.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.screenshot({path: info.outputPath('narrow-create-work.png'), animations: 'disabled'});
  await create.getByRole('button', {name: '保存工作项', exact: true}).click();
  await expect(create).toHaveCount(0);
  await expect(tabs.getByRole('tab', {name: '工作项 13', exact: true})).toHaveAttribute('aria-selected', 'true');
  await expect(detail.getByRole('button', {name: /^在窄屏新增工作项/})).toBeVisible();
  await detail.getByRole('button', {name: '添加工作项', exact: true}).click();
  await expect(create.getByLabel('新工作项名称', {exact: true})).toHaveValue('');
  await create.getByRole('button', {name: '取消', exact: true}).click();
  await expect(create).toHaveCount(0);
});

test('问题100%一次解决，基础修改和降低进度保留更正历史，短标签完整', async ({page}, info) => {
  const f = await phaseFixture(page);
  const issue = await post(page, '/api/issues', {projectId: f.projectId, title: '完整显示优先级和执行进度', priority: 'P0', ownerId: f.testing.ownerId});
  await page.goto('/issues?' + new URLSearchParams({projectId: f.projectId, issueId: issue.id}));
  const detail = page.getByRole('dialog', {name: '问题详情', exact: true}), form = detail.locator('.issue-update-form');
  await expect(form).toBeVisible();
  await expect(detail.getByRole('button', {name: '纠错', exact: true})).toHaveCount(0);
  for (const value of [20, 50, 80, 100]) await expect(form.getByRole('button', {name: value + '%', exact: true})).toBeVisible();
  await form.getByRole('button', {name: '80%', exact: true}).click();
  await form.locator('textarea').fill('推进到八成');
  await form.getByRole('button', {name: '追加进展', exact: true}).click();
  await expect(detail.locator('.issue-settings-current-progress strong')).toHaveText('80%');
  await form.getByRole('button', {name: '50%', exact: true}).click();
  await form.locator('textarea').fill('核对后调整');
  await form.getByRole('button', {name: '保存更正', exact: true}).click();
  await expect(detail.locator('.issue-settings-current-progress strong')).toHaveText('50%');
  const requests: string[] = [];
  page.on('request', request => {if (request.method() === 'POST' && request.url().includes('/api/issues/' + issue.id)) requests.push(request.url());});
  await form.getByRole('button', {name: '100%', exact: true}).click();
  await form.locator('textarea').fill('确认处理完成');
  await form.getByRole('button', {name: '保存并解决', exact: true}).click();
  await expect(detail.locator('.issue-settings-current-progress strong')).toHaveText('100%');
  expect(requests).toHaveLength(1); expect(requests[0]).toMatch(/\/resolve$/);
  await detail.getByRole('tab', {name: '基本信息', exact: true}).click();
  await detail.getByLabel('问题标题', {exact: true}).fill('核对后的问题标题');
  await detail.getByLabel('修改说明', {exact: true}).fill('修正标题');
  await detail.getByRole('button', {name: '保存修改', exact: true}).click();
  await expect(detail.locator('.issue-settings-summary h3')).toHaveText('核对后的问题标题');
  const latest = await (await page.request.get('/api/issues/' + issue.id)).json();
  expect(latest.status).toBe('resolved'); expect(latest.progress).toBe(100);
  expect(latest.updates.filter((update: {eventType: string}) => update.eventType === 'resolve')).toHaveLength(1);
  expect(latest.updates.filter((update: {eventType: string}) => update.eventType === 'correction')).toHaveLength(2);
  await detail.getByRole('tab', {name: /^记录 /}).click();
  await expect(detail.getByText('确认处理完成', {exact: true})).toBeVisible();
  await page.screenshot({path: info.outputPath('issue-history.png'), animations: 'disabled'});
  await detail.getByRole('button', {name: '关闭', exact: true}).click();
  await page.goto('/issues?' + new URLSearchParams({projectId: f.projectId, status: ''}));
  for (const width of [1280, 900, 390]) {
    await page.setViewportSize({width, height: 844});
    const badge = page.locator('.issue-data-priority .priority-badge').first();
    await badge.scrollIntoViewIfNeeded();
    expect(await badge.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await badge.evaluate(el => {const box = el.getBoundingClientRect(), cell = el.closest('[role=cell]')!.getBoundingClientRect(); return box.left >= cell.left && box.right <= cell.right;})).toBe(true);
  }
  await page.screenshot({path: info.outputPath('narrow-issue-priority.png'), animations: 'disabled'});
});

test('独立导航保留项目，筛选字体一致', async ({page}) => {
  const f = await phaseFixture(page);
  await page.goto('/execution');
  const filters = page.locator('.workspace-progress-tools');
  await expect(filters.locator('input').first()).toBeVisible();
  const fonts = await filters.locator('input,.progress-status-filter,.select-trigger').evaluateAll(elements => elements.map(el => {const style = getComputedStyle(el); return [style.fontFamily, style.fontSize, style.fontWeight, style.textAlign].join('|');}));
  expect(new Set(fonts).size, fonts.join("\n")).toBe(1);
  for (const [path, title] of [['/actions', '待办事项'], ['/analytics', '统计分析']]) {
    await page.goto(path + '?projectId=' + f.projectId);
    await expect(page.getByRole('link', {name: title, exact: true})).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.topbar')).toContainText(title);
    await expect(page.getByRole('button', {name: '进展表', exact: true})).toHaveCount(0);
  }
});

test('新增工作项冲突保留表单，未知响应禁止重复创建', async ({page}, info) => {
  test.skip(info.project.name !== 'office-1280', '写入恢复在基准视口验证');
  const f = await phaseFixture(page);
  await page.goto('/?' + new URLSearchParams({projectId: f.projectId, workspaceView: 'progress', scopeType: 'project', scopeId: f.projectId, pathNode: f.testing.id, pathInspector: 'open'}));
  const detail = page.getByRole('complementary', {name: '对象详情'}), tabs = detail.getByRole('tablist', {name: '需求详情内容'});
  await tabs.getByRole('tab', {name: /^工作项 /}).click();
  await detail.getByRole('button', {name: '添加工作项', exact: true}).click();
  const form = detail.getByRole('dialog', {name: '添加工作项', exact: true});
  await form.getByLabel('新工作项名称', {exact: true}).fill('冲突后仍保留的工作项');
  await form.getByLabel('变更说明（可选）', {exact: true}).fill('补充本次范围');
  const current = await (await page.request.get('/api/requirements/' + f.testing.id)).json();
  const changed = await page.request.patch('/api/requirements/' + f.testing.id, {data: {expectedVersion: current.version, title: '他人先修改了需求标题'}});
  expect(changed.ok(), await changed.text()).toBe(true);
  const endpoint = '/api/requirements/' + f.testing.id + '/work-items';
  let writes = 0;
  page.on('request', request => {if (new URL(request.url()).pathname === endpoint && request.method() === 'POST') writes++;});
  await form.getByRole('button', {name: '保存工作项', exact: true}).click();
  await expect(form).toContainText('新增草稿保持不变');
  await expect(form.getByLabel('新工作项名称', {exact: true})).toHaveValue('冲突后仍保留的工作项');
  expect(writes).toBe(1);
  await form.getByRole('button', {name: '保存工作项', exact: true}).click();
  await expect(form).toHaveCount(0);
  expect(writes).toBe(2);
  await detail.getByRole('button', {name: '添加工作项', exact: true}).click();
  await form.getByLabel('新工作项名称', {exact: true}).fill('响应损坏但已经创建');
  await form.getByLabel('变更说明（可选）', {exact: true}).fill('补充本次范围');
  await page.route('**' + endpoint, async route => {await route.fetch(); await route.fulfill({status: 200, contentType: 'text/html', body: '<html>proxy response</html>'});});
  await form.getByRole('button', {name: '保存工作项', exact: true}).click();
  await expect(form.getByRole('button', {name: '保存工作项', exact: true})).toBeDisabled();
  await expect(form.getByLabel('新工作项名称', {exact: true})).toHaveValue('响应损坏但已经创建');
  expect(writes).toBe(3);
  await expect.poll(async () => (await (await page.request.get('/api/requirements/' + f.testing.id)).json()).workItems.filter((item: {title: string}) => item.title === '响应损坏但已经创建').length).toBe(1);
  await form.getByRole('button', {name: '返回', exact: true}).click();
  await expect(detail.getByRole('button', {name: '添加工作项', exact: true})).toBeDisabled();
  await tabs.getByRole('tab', {name: '执行', exact: true}).click();
  await detail.getByRole('button', {name: '重新读取需求', exact: true}).click();
  await tabs.getByRole('tab', {name: /^工作项 /}).click();
  await expect(detail.getByRole('button', {name: '添加工作项', exact: true})).toBeEnabled();
});
