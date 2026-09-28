import { expect, test, type Page } from '@playwright/test';
import type { WorkItemTemplate } from '../../src/client/types';
import { chooseOption } from './select-helper';
import { headerAction } from './topbar-helpers';
import { graphToolbar, openGraphDrafts } from './graph-interactions';

async function fixture(page: Page) {
  const post = async (url: string, data: Record<string, unknown>) => {
    const response = await page.request.post(url, { data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  await post('/api/login', { username: 'admin', password: '41_xc7q0qOjo4Inw!' });
  const source = await post('/api/projects', { name: `成熟流程-${Date.now()}` });
  const target = await post('/api/projects', { name: `流程接收-${Date.now()}` });
  const template: WorkItemTemplate = await post('/api/templates', {
    projectId: source.id, name: '上线核对流程', description: '先核对，再发布，最后确认结果。', dependencyMode: 'dependencies',
    items: [
      { clientKey: 'check', title: '核对清单', durationDays: 2, startOffsetDays: 0, sortOrder: 0, predecessorKeys: [] },
      { clientKey: 'release', title: '发布', durationDays: 1, startOffsetDays: 2, sortOrder: 1, predecessorKeys: ['check'] },
      { clientKey: 'accepted', title: '交付确认', kind: 'milestone', confirmationMode: 'manual', durationDays: 0, startOffsetDays: 3, sortOrder: 2, predecessorKeys: ['release'] },
    ],
  });
  const list = async (projectId: string): Promise<WorkItemTemplate[]> => (await page.request.get(`/api/templates?projectId=${projectId}`)).json();
  const before = await list(source.id), targetBefore = await list(target.id);
  await page.goto(`/templates?projectId=${target.id}`);
  await headerAction(page, '复用已有流程');
  const dialog = page.getByRole('dialog', { name: '复用已有流程', exact: true });
  return { source, target, template, before, targetBefore, list, dialog };
}

test('跨项目复用流程，草稿刷新与异常回执恢复后，新需求沿用工作和里程碑', async ({ page }) => {
  const { source, target, template, before, targetBefore, list, dialog } = await fixture(page);
  await chooseOption(dialog.getByRole('combobox', { name: '来源项目' }), source.id);
  await chooseOption(dialog.getByRole('combobox', { name: '来源流程' }), template.id);
  await expect(dialog.locator('.template-preview-summary')).toContainText('2 个工作项 · 1 个里程碑');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect(await list(target.id)).toEqual(targetBefore);
  await headerAction(page, '复用已有流程');
  await chooseOption(dialog.getByRole('combobox', { name: '来源项目' }), source.id);
  await chooseOption(dialog.getByRole('combobox', { name: '来源流程' }), template.id);
  await dialog.getByRole('button', { name: '继续编辑', exact: true }).click();
  const editor = page.locator('.template-flow-workspace');
  await expect(editor.locator('[data-layout-ready="true"]')).toBeVisible();
  await expect(editor.getByRole('group', { name: '核对清单', exact: true })).toBeVisible();
  expect(await list(target.id)).toEqual(targetBefore);
  await page.reload();
  await expect(editor.locator('[data-layout-ready="true"]')).toBeVisible();
  await expect(editor.getByRole('group', { name: '核对清单', exact: true })).toBeVisible();
  await expect(editor.getByRole('group', { name: '交付确认', exact: true })).toBeVisible();
  await headerAction(page, '流程属性');
  await expect(page.getByRole('textbox', { name: '流程名称', exact: true })).toHaveValue('上线核对流程（副本）');
  await page.getByRole('textbox', { name: '流程名称', exact: true }).fill('目标项目上线流程');
  let writes = 0;
  await page.route('**/api/templates', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    writes++;
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBe(true);
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{' });
  });
  await graphToolbar(page, '保存修改');
  await expect(page.getByRole('button', { name: '查询原批次并重试', exact: true })).toBeVisible();
  await page.reload();
  await expect(editor.locator('[data-layout-ready="true"]')).toBeVisible();
  if (!await page.getByRole('button', { name: '查询原批次并重试', exact: true }).isVisible()) await openGraphDrafts(page);
  await page.getByRole('button', { name: '查询原批次并重试', exact: true }).click();
  await expect(page.getByRole('button', { name: '查询原批次并重试', exact: true })).toHaveCount(0);
  expect(writes).toBe(1);
  const saved = (await list(target.id)).find(t => t.name === '目标项目上线流程')!;
  expect(saved.projectId).toBe(target.id);
  expect(saved.items.map(i => i.title)).toEqual(template.items.map(i => i.title));
  expect(saved.items.every(i => !template.items.some(s => s.id === i.id))).toBe(true);
  expect(saved.items[1].predecessorIds).toEqual([saved.items[0].id]);
  expect(saved.items[2]).toMatchObject({ kind: 'milestone', confirmationMode: 'manual', predecessorIds: [saved.items[1].id] });
  expect(await list(source.id)).toEqual(before);
  expect((await list(target.id)).filter(t => t.id !== saved.id)).toEqual(targetBefore);
  const project = (await (await page.request.get('/api/projects')).json()).find((p: { id: string }) => p.id === target.id);
  expect(project.defaultTemplateId).toBe(target.defaultTemplateId);

  await page.goto(`/?projectId=${target.id}&scopeType=project&scopeId=${target.id}&workspaceView=list`);
  await headerAction(page, '新建对象');
  await page.getByRole('menu', { name: '新建对象' }).getByRole('button', { name: '新建需求', exact: true }).click();
  const form = page.getByRole('dialog', { name: '新建需求', exact: true });
  await form.getByLabel('需求标题', { exact: true }).fill('复用流程的发布任务');
  await form.getByRole('button', { name: /流程与排期/ }).click();
  await chooseOption(form.getByRole('combobox', { name: '流程设计', exact: true }), saved.id);
  await form.getByLabel('计划开始', { exact: true }).fill('2026-09-28');
  await form.getByRole('button', { name: '创建需求', exact: true }).click();
  await expect(form).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: '展开全部', exact: true }).click();
  await expect(page.getByRole('button', { name: '核对清单', exact: true })).toBeVisible();
  const requirements = await (await page.request.get(`/api/requirements?projectId=${target.id}`)).json();
  const detail = await (await page.request.get(`/api/requirements/${requirements[0].id}`)).json();
  expect(detail.templateId).toBe(saved.id);
  expect(detail.workItems.map((i: { title: string }) => i.title)).toEqual(['核对清单', '发布']);
  expect(detail.milestones[0]).toMatchObject({ title: '交付确认', confirmationMode: 'manual' });
  expect(detail.workItems.every((i: { plannedStart: string; plannedEnd: string }) => i.plannedStart && i.plannedEnd)).toBe(true);
  expect(await list(source.id)).toEqual(before);
});

test('来源流程读取失败可恢复，切换来源清空旧选择且取消不新增流程', async ({ page }) => {
  const { source, target, template, targetBefore, list, dialog } = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  let fail = true;
  await page.route(`**/api/templates?projectId=${source.id}`, route => fail
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '来源暂时无法读取' }) })
    : route.continue());
  await chooseOption(dialog.getByRole('combobox', { name: '来源项目' }), source.id);
  await expect(dialog.getByRole('alert')).toContainText('来源暂时无法读取');
  await expect(dialog.getByRole('button', { name: '继续编辑' })).toBeDisabled();
  fail = false;
  await dialog.getByRole('button', { name: '重新读取流程' }).click();
  await chooseOption(dialog.getByRole('combobox', { name: '来源流程' }), template.id);
  await expect(dialog.getByRole('button', { name: '继续编辑' })).toBeEnabled();
  expect(await dialog.evaluate(e => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  await chooseOption(dialog.getByRole('combobox', { name: '来源项目' }), target.id);
  await expect(dialog.getByRole('button', { name: '继续编辑' })).toBeDisabled();
  await expect(dialog.locator('.template-preview')).toHaveCount(0);
  await dialog.getByRole('button', { name: '取消' }).click();
  expect(await list(target.id)).toEqual(targetBefore);
});
