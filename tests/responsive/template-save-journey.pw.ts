import { expect, test, type Page, type Locator } from '@playwright/test';
import type { WorkItemTemplate } from '../../src/client/types';

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
  await editor.getByRole('textbox', { name: '流程名称', exact: true }).fill(name);
  if (description !== undefined) await editor.getByRole('textbox', { name: '设计说明', exact: true }).fill(description);
}

async function openProperties(editor: Locator) {
  if (!await editor.getByRole('textbox', { name: '流程名称', exact: true }).isVisible()) {
    await editor.getByRole('button', { name: '流程属性', exact: true }).click();
  }
}

async function openDraft(editor: Locator) {
  if (!await editor.getByText('草稿与冲突', { exact: true }).isVisible()) {
    await editor.getByRole('button', { name: '草稿状态', exact: true }).click();
  }
}

async function reconnect(page: Page) {
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
}

test('流程元素与名称即时保存，返回再进入保留里程碑、依赖和排期', async ({ page }) => {
  const { editor, template, list } = await fixture(page);
  await editor.locator(`.react-flow__node[data-id="${template!.items[0].id}"]`).click();
  await editor.getByRole('textbox', { name: '元素名称', exact: true }).fill('架构设计');
  await editor.getByRole('spinbutton', { name: '预计工期', exact: true }).fill('4');
  await editor.locator(`.react-flow__node[data-id="${template!.items[2].id}"]`).click();
  await editor.getByRole('textbox', { name: '元素名称', exact: true }).fill('发布基线');
  await properties(editor, '已核对交付流程', '保存前最后输入的说明');
  await editor.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect.poll(async () => (await list()).find(t => t.id === template!.id)!.description).toBe('保存前最后输入的说明');
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('button', { name: '撤销', exact: true })).toBeDisabled();
  const saved = (await list()).find(t => t.id === template!.id)!;
  expect(saved).toMatchObject({ id: template!.id, name: '已核对交付流程' });
  expect(saved.items[0]).toMatchObject({ id: template!.items[0].id, title: '架构设计', durationDays: 4 });
  expect(saved.items[1].predecessorIds).toEqual([saved.items[0].id]);
  expect(saved.items[2]).toMatchObject({ id: template!.items[2].id, kind: 'milestone', title: '发布基线', durationDays: 0 });
  expect(saved.items[2].predecessorIds).toEqual([saved.items[1].id]);
  expect(Object.keys(saved.layout!.positions)).toHaveLength(3);
  await editor.getByRole('button', { name: '返回流程列表', exact: true }).click();
  await page.getByRole('button', { name: '编辑流程 已核对交付流程', exact: true }).click();
  await expect(editor.locator('[data-layout-ready="true"]')).toBeVisible();
  await expect(editor.locator('.react-flow__node')).toHaveCount(3);
  await editor.locator(`.react-flow__node[data-id="${saved.items[0].id}"]`).click();
  await expect(editor.getByRole('spinbutton', { name: '预计工期', exact: true })).toHaveValue('4');
});

test('流程后台更新后核对冲突，保留本次输入和服务端未冲突字段', async ({ page }) => {
  const { editor, template, list } = await fixture(page);
  await editor.locator(`.react-flow__node[data-id="${template!.items[0].id}"]`).click();
  await editor.getByRole('textbox', { name: '元素名称', exact: true }).fill('草稿架构设计');
  await properties(editor, '草稿交付流程');
  const response = await page.request.patch(`/api/templates/${template!.id}`, { data: {
    expectedUpdatedAt: template!.updatedAt, name: '后台交付流程', description: '后台补充的说明',
  } });
  expect(response.ok(), await response.text()).toBe(true);
  await reconnect(page);
  await expect(editor.getByRole('button', { name: '保存修改', exact: true })).toBeDisabled();
  await expect(editor.getByRole('textbox', { name: '流程名称', exact: true })).toHaveValue('草稿交付流程');
  await openDraft(editor);
  await expect(editor.locator('.editor-conflict')).toHaveCount(1);
  await editor.getByRole('button', { name: '保留草稿', exact: true }).click();
  await editor.getByRole('button', { name: '已核对，使用最新版本预览', exact: true }).click();
  await editor.getByRole('button', { name: '保存修改', exact: true }).click();
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
  await editor.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(editor.getByRole('button', { name: '查询原批次并重试', exact: true })).toBeVisible();
  const receipt = await (await page.request.get(`/api/projects/${project.id}/dependency-changes/${batchId}`)).json();
  expect(receipt.status).toBe('applied');
  const saved = (await list()).find(t => t.id === receipt.addedIds.$template)!;
  expect(saved).toMatchObject({ name: '异常响应后交付流程', description: '原批次的说明' });
  await page.reload();
  await expect(editor.locator('[data-layout-ready="true"]')).toBeVisible();
  await openDraft(editor);
  const retry = editor.getByRole('button', { name: '查询原批次并重试', exact: true });
  await retry.click();
  await expect(editor.getByRole('button', { name: '查询原批次并重试', exact: true })).toHaveCount(0);
  await expect(editor.getByRole('button', { name: '保存修改', exact: true })).toBeEnabled();
  expect(writes).toBe(1);
  expect((await list()).filter(t => t.name === '异常响应后交付流程')).toHaveLength(1);
  await editor.getByRole('button', { name: '返回流程列表', exact: true }).click();
  await page.getByRole('button', { name: '编辑流程 异常响应后交付流程', exact: true }).click();
  await expect(editor.locator('[data-layout-ready="true"]')).toBeVisible();
  expect((await list()).find(t => t.id === saved.id)!.layout).toEqual(saved.layout);
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
    await editor.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect.poll(() => submissions.length).toBe(1);
    await expect(editor.getByRole('button', { name: '保存修改', exact: true })).toBeDisabled();
    await editor.getByRole('button', { name: '返回流程列表', exact: true }).click();
    await page.getByRole('button', { name: '编辑流程 接口交付流程', exact: true }).click();
    await expect(editor.locator('[data-layout-ready="true"]')).toBeVisible();
    await expect(editor.getByRole('button', { name: '保存修改', exact: true })).toBeDisabled();
    release();
    if (outcome === 'failure') {
      await openDraft(editor);
      await editor.getByRole('button', { name: '查询原批次并重试', exact: true }).click();
      await expect.poll(() => submissions.length).toBe(2);
      expect(submissions[1]).toEqual(submissions[0]);
    }
    await expect.poll(async () => (await list()).find(t => t.id === template!.id)!.name).toBe('等待保存的流程');
    await openProperties(editor);
    await expect(editor.getByRole('textbox', { name: '流程名称', exact: true })).toBeEditable();
    await expect(editor.getByRole('textbox', { name: '流程名称', exact: true })).toHaveValue('等待保存的流程');
    expect(submissions).toHaveLength(outcome === 'success' ? 1 : 2);
  } finally { release(); }
});
