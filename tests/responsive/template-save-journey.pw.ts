import { expect, test, type Page, type Locator } from '@playwright/test';
import type { WorkItemTemplate } from '../../src/client/types';
import { headerAction as toolbarAction } from './topbar-helpers';
import { closeGraphProperties, graphProperties, graphToolbar, openGraphDrafts } from './graph-interactions';
const headerAction=async(page:Page,name:string)=>{await closeGraphProperties(page);await toolbarAction(page,name);};

async function fixture(page: Page, existing = true) {
  const post = async (url: string, data: Record<string, unknown>) => {
    const response = await page.request.post(url, { data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  await post('/api/login', { username: 'admin', password: '41_xc7q0qOjo4Inw!' });
  const session = await (await page.request.get('/api/session')).json();
  const project = await post('/api/projects', { name: `流程保存旅程-${Date.now()}` });
  const template: WorkItemTemplate | undefined = existing ? await post('/api/templates', {
    projectId: project.id, name: '接口交付流程', description: '原流程说明', dependencyMode: 'dependencies',
    items: [
      { clientKey: 'design', title: '设计', kind: 'work', durationDays: 2, startOffsetDays: 0, sortOrder: 0, predecessorKeys: [] },
      { clientKey: 'build', title: '开发', kind: 'work', durationDays: 3, startOffsetDays: 2, sortOrder: 1, predecessorKeys: ['design'] },
      { clientKey: 'release', title: '交付标记', kind: 'milestone', durationDays: 0, startOffsetDays: 5, sortOrder: 2, predecessorKeys: ['build'] },
    ],
  }) : undefined;
  await page.addInitScript(({ projectId, accountId }) => localStorage.setItem(`project-manage:selected-project:${accountId}`, projectId), { projectId: project.id, accountId: session.accountId });
  const list = async () => (await (await page.request.get(`/api/templates?projectId=${project.id}`)).json()) as WorkItemTemplate[];
  await page.goto('/templates');
  await page.getByRole('button', { name: template ? `编辑流程 ${template.name}` : '新建流程', exact: true }).click();
  const editor = page.locator('.template-flow-workspace');
  await expect(editor.locator('[data-layout-ready="true"]')).toBeVisible();
  return { project, template, list, editor };
}

async function properties(editor: Locator, name: string, description?: string) {
  await openProperties(editor);
  await editor.page().getByRole('textbox', { name: '流程名称', exact: true }).fill(name);
  if (description !== undefined) await editor.page().getByRole('textbox', { name: '设计说明', exact: true }).fill(description);
}

async function openProperties(editor: Locator) {
  if (!await editor.page().getByRole('textbox', { name: '流程名称', exact: true }).isVisible()) {
    await headerAction(editor.page(), '流程属性');
  }
}

async function openDraft(editor: Locator) {
  if (!await editor.page().getByText('草稿与冲突', { exact: true }).isVisible()) {
    await openGraphDrafts(editor.page());
  }
}

async function reconnect(page: Page) {
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
}

test('流程元素与名称即时保存，返回再进入保留里程碑、依赖和排期', async ({ page }) => {
  const { editor, template, list } = await fixture(page);
  await graphProperties(page,editor.locator(`.react-flow__node[data-id="${template!.items[0].id}"]`));
  await editor.page().getByRole('textbox', { name: '元素名称', exact: true }).fill('架构设计');
  await editor.page().getByRole('spinbutton', { name: '预计工期', exact: true }).fill('4');
  await editor.locator('.dependency-canvas').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-card-workspace')).toHaveCount(0);
  await graphProperties(page,editor.locator(`.react-flow__node[data-id="${template!.items[2].id}"]`));
  await editor.page().getByRole('textbox', { name: '元素名称', exact: true }).fill('发布基线');
  await properties(editor, '已核对交付流程', '保存前最后输入的说明');
  await graphToolbar(page,'保存修改');
  await expect.poll(async () => (await list()).find(t => t.id === template!.id)!.description).toBe('保存前最后输入的说明');
  await expect(editor).toBeVisible();
  await expect(editor.page().getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  const saved = (await list()).find(t => t.id === template!.id)!;
  expect(saved).toMatchObject({ id: template!.id, name: '已核对交付流程' });
  expect(saved.items[0]).toMatchObject({ id: template!.items[0].id, title: '架构设计', durationDays: 4 });
  expect(saved.items[1].predecessorIds).toEqual([saved.items[0].id]);
  expect(saved.items[2]).toMatchObject({ id: template!.items[2].id, kind: 'milestone', title: '发布基线', durationDays: 0 });
  expect(saved.items[2].predecessorIds).toEqual([saved.items[1].id]);
  expect(Object.keys(saved.layout!.positions)).toHaveLength(3);
  await headerAction(page,'返回流程列表');
  await page.getByRole('button', { name: '编辑流程 已核对交付流程', exact: true }).click();
  await expect(editor.locator('[data-layout-ready="true"]')).toBeVisible();
  await expect(editor.locator('.react-flow__node')).toHaveCount(3);
  // The previous properties panel is restored and covers the first node.
  await editor.locator('.graph-auxiliary:not(.is-leaving)').getByRole('button', { name: '关闭', exact: true }).click();
  await graphProperties(page,editor.locator(`.react-flow__node[data-id="${saved.items[0].id}"]`));
  await expect(editor.page().getByRole('spinbutton', { name: '预计工期', exact: true })).toHaveValue('4');
});

test('流程后台更新后核对冲突，保留本次输入和服务端未冲突字段', async ({ page }) => {
  const { editor, template, list } = await fixture(page);
  await graphProperties(page,editor.locator(`.react-flow__node[data-id="${template!.items[0].id}"]`));
  await editor.page().getByRole('textbox', { name: '元素名称', exact: true }).fill('草稿架构设计');
  await properties(editor, '草稿交付流程');
  const response = await page.request.patch(`/api/templates/${template!.id}`, { data: {
    expectedUpdatedAt: template!.updatedAt, name: '后台交付流程', description: '后台补充的说明',
  } });
  expect(response.ok(), await response.text()).toBe(true);
  await reconnect(page);
  await expect(editor.page().getByRole('button', { name: '保存修改', exact: true })).toBeDisabled();
  await expect(editor.page().getByRole('textbox', { name: '流程名称', exact: true })).toHaveValue('草稿交付流程');
  await openDraft(editor);
  await expect(editor.page().locator('.editor-conflict')).toHaveCount(1);
  await editor.page().getByRole('button', { name: '保留草稿', exact: true }).click();
  await editor.page().getByRole('button', { name: '已核对，使用最新版本预览', exact: true }).click();
  await graphToolbar(page,'保存修改');
  await expect.poll(async () => (await list()).find(t => t.id === template!.id)!.name).toBe('草稿交付流程');
  expect((await list()).find(t => t.id === template!.id)!.description).toBe('后台补充的说明');
  expect((await list()).find(t => t.id === template!.id)!.items[0].title).toBe('草稿架构设计');
});

for (const existing of [true, false]) test(`${existing ? '修改' : '新建'}流程响应异常后刷新，通过原批次回执核对且不重复提交`, async ({ page }) => {
  const { editor, project, template, list } = await fixture(page, existing);
  const endpoint = template ? `/api/templates/${template.id}` : '/api/templates';
  let writes = 0, batchId = '';
  await page.route(`**${endpoint}`, async route => {
    if (route.request().method() !== (existing ? 'PATCH' : 'POST')) return route.continue();
    writes++;
    batchId = route.request().postDataJSON().batchId;
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBe(true);
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'response lost after commit' });
  });
  await properties(editor, '异常响应后交付流程', '原批次的说明');
  await graphToolbar(page,'保存修改');
  // Saving opens the error panel itself; toggling it here races the response.
  await expect(editor.page().getByRole('button', { name: '查询原批次并重试', exact: true })).toBeVisible();
  const receipt = await (await page.request.get(`/api/projects/${project.id}/dependency-changes/${batchId}`)).json();
  expect(receipt.status).toBe('applied');
  const saved = (await list()).find(t => t.id === receipt.addedIds.$template)!;
  expect(saved).toMatchObject({ name: '异常响应后交付流程', description: '原批次的说明' });
  await page.reload();
  await expect(editor.locator('[data-layout-ready="true"]')).toBeVisible();
  await openDraft(editor);
  const retry = editor.page().getByRole('button', { name: '查询原批次并重试', exact: true });
  await retry.click();
  await expect(editor.page().getByRole('button', { name: '查询原批次并重试', exact: true })).toHaveCount(0);
  await expect(editor.page().getByRole('button', { name: '保存修改', exact: true })).toBeEnabled();
  expect(writes).toBe(1);
  expect((await list()).filter(t => t.name === '异常响应后交付流程')).toHaveLength(1);
  await headerAction(page,'返回流程列表');
  await page.getByRole('button', { name: '编辑流程 异常响应后交付流程', exact: true }).click();
  await expect(editor.locator('[data-layout-ready="true"]')).toBeVisible();
  expect((await list()).find(t => t.id === saved.id)!.layout).toEqual(saved.layout);
});

test('流程待核对提交被另一标签接管后沿用原批次', async ({ page, context }) => {
  const { editor, template } = await fixture(page);
  await properties(editor, '跨页待核对流程', '接管后不能生成新批次');
  await expect(page.getByText('草稿已保留', { exact: true })).toBeVisible();
  const tab = await context.newPage();
  await tab.goto(page.url());
  const takeoverEditor = tab.locator('.template-flow-workspace');
  await expect(takeoverEditor.locator('[data-layout-ready="true"]')).toBeVisible();
  await expect(tab.getByText('其他页面编辑中', { exact: true })).toBeVisible();
  let original: Record<string, unknown> | undefined;
  await page.route(`**/api/templates/${template!.id}`, async route => {
    if (route.request().method() !== 'PATCH') return route.continue();
    original = route.request().postDataJSON();
    return route.abort('connectionfailed');
  });
  await graphToolbar(page,'保存修改');
  await expect.poll(() => original?.batchId).toBeTruthy();
  await openDraft(editor);
  await expect(editor.page().getByRole('button', { name: '查询原批次并重试', exact: true })).toBeVisible();
  await openDraft(takeoverEditor);
  await takeoverEditor.page().getByRole('button', { name: '接管此草稿', exact: true }).click();
  let retried: Record<string, unknown> | undefined;
  await tab.route(`**/api/templates/${template!.id}`, async route => {
    if (route.request().method() !== 'PATCH') return route.continue();
    retried = route.request().postDataJSON();
    return route.abort('connectionfailed');
  });
  await tab.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect.poll(() => retried?.batchId).toBeTruthy();
  expect(retried).toEqual(original);
  await tab.close();
});

test('流程待核对通知丢失后，自动接手页面保存前读取原批次', async ({ page, context }) => {
  const { editor, template } = await fixture(page);
  await properties(editor, '通知丢失待核对流程', '自动接手仍须复用原批次');
  await expect(page.getByText('草稿已保留', { exact: true })).toBeVisible();
  const tab = await context.newPage();
  await tab.addInitScript(() => {
    const target = window as unknown as { addEventListener: (...args: unknown[]) => void };
    const add = target.addEventListener.bind(window);
    target.addEventListener = (...args: unknown[]) => {
      if (args[0] === 'storage') {
        const listener = args[1] as (event: StorageEvent) => void;
        args[1] = (event: StorageEvent) => { if (!event.key?.endsWith(':submission:changed')) listener(event); };
      }
      add(...args);
    };
  });
  await tab.goto(page.url());
  const resumedEditor = tab.locator('.template-flow-workspace');
  await expect(resumedEditor.locator('[data-layout-ready="true"]')).toBeVisible();
  await expect(tab.getByText('其他页面编辑中', { exact: true })).toBeVisible();
  let original: Record<string, unknown> | undefined;
  await page.route(`**/api/templates/${template!.id}`, async route => {
    if (route.request().method() !== 'PATCH') return route.continue();
    original = route.request().postDataJSON();
    return route.abort('connectionfailed');
  });
  await graphToolbar(page,'保存修改');
  await expect.poll(() => original?.batchId).toBeTruthy();
  await openDraft(editor);
  await expect(editor.page().getByRole('button', { name: '查询原批次并重试', exact: true })).toBeVisible();
  await page.close();
  await expect(tab.getByRole('button', { name: '保存修改', exact: true })).toBeEnabled();
  let retried: Record<string, unknown> | undefined;
  await tab.route(`**/api/templates/${template!.id}`, async route => {
    if (route.request().method() !== 'PATCH') return route.continue();
    retried = route.request().postDataJSON();
    return route.abort('connectionfailed');
  });
  await tab.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect.poll(() => retried?.batchId).toBeTruthy();
  expect(retried).toEqual(original);
  await tab.close();
});

for (const outcome of ['success', 'failure'] as const) test(`流程保存中返回并重新进入，${outcome === 'success' ? '成功后恢复编辑' : '失败后保留原批次重试'}`, async ({ page }) => {
  const { editor, template, list } = await fixture(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const submissions: Record<string, unknown>[] = [];
  await page.route(`**/api/templates/${template!.id}`, async route => {
    if (route.request().method() !== 'PATCH') return route.continue();
    submissions.push(route.request().postDataJSON());
    if (submissions.length === 1) {
      await held;
      if (outcome === 'failure') return route.fulfill({ status: 500, json: { error: '临时保存失败' } });
    }
    return route.continue();
  });
  try {
    await properties(editor, '等待保存的流程', '等待保存的说明');
    await graphToolbar(page,'保存修改');
    await expect.poll(() => submissions.length).toBe(1);
    await expect(editor.page().getByRole('button', { name: '保存修改', exact: true })).toBeDisabled();
    await headerAction(page,'返回流程列表');
    await page.getByRole('button', { name: '编辑流程 接口交付流程', exact: true }).click();
    await expect(editor.locator('[data-layout-ready="true"]')).toBeVisible();
    await expect(editor.page().getByRole('button', { name: '保存修改', exact: true })).toBeDisabled();
    release();
    if (outcome === 'failure') {
      await openDraft(editor);
      await editor.page().getByRole('button', { name: '查询原批次并重试', exact: true }).click();
      await expect.poll(() => submissions.length).toBe(2);
      expect(submissions[1]).toEqual(submissions[0]);
    }
    await expect.poll(async () => (await list()).find(t => t.id === template!.id)!.name).toBe('等待保存的流程');
    await openProperties(editor);
    await expect(editor.page().getByRole('textbox', { name: '流程名称', exact: true })).toBeEditable();
    await expect(editor.page().getByRole('textbox', { name: '流程名称', exact: true })).toHaveValue('等待保存的流程');
    expect(submissions).toHaveLength(outcome === 'success' ? 1 : 2);
  } finally { release(); }
});
