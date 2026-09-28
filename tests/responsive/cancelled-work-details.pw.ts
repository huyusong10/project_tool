import { expect, test } from '@playwright/test';
import type { Requirement } from '../../src/client/types';

for (const workspaceView of ['list', 'progress']) {
  test(`${workspaceView}中取消单项工作后仍可读取历史、刷新和恢复，剩余执行保持`, async ({ page }) => {
    const post = async (path: string, data: object) => {
      const response = await page.request.post(path, { data });
      expect(response.ok(), await response.text()).toBe(true);
      return response.json();
    };
    await post('/api/login', { username: 'admin', password: '41_xc7q0qOjo4Inw!' });
    const project = await post('/api/projects', { name: '部分范围取消 ' + Date.now() });
    const owner = await post('/api/people', { projectId: project.id, name: '范围负责人 ' + Date.now() });
    const template = await post('/api/templates', { projectId: project.id, name: '独立交付工作', dependencyMode: 'legacy', items: [
      { title: '继续实现接口', durationDays: 1, startOffsetDays: 0, sortOrder: 0 },
      { title: '已不需要的核验', durationDays: 1, startOffsetDays: 0, sortOrder: 1 },
    ] });
    let requirement: Requirement = await post('/api/requirements', { projectId: project.id, title: '保留核心交付', templateId: template.id, ownerId: owner.id });
    const read = async () => (await (await page.request.get('/api/requirements/' + requirement.id)).json()) as Requirement;
    const active = await post('/api/work-items/' + requirement.workItems[0].id + '/start', { expectedVersion: requirement.workItems[0].version, expectedRequirementVersion: requirement.version, ownerId: owner.id });
    await post('/api/requirements/' + requirement.id + '/progress', { expectedVersion: active.version, workItemId: active.id, workItemPercent: 40, content: '保留已完成的接口工作' });
    requirement = await read();
    const cancelled = requirement.workItems[1];
    await page.goto('/?' + new URLSearchParams({ projectId: project.id, workspaceView, scopeType: 'project', detailId: requirement.id, detailTab: 'work' }));
    const root = page.getByRole('dialog');
    const row = root.locator('[data-work-id="' + cancelled.id + '"]');
    await row.getByRole('button', { name: '取消工作项', exact: true }).click();
    await expect(row.getByRole('img', { name: '已取消', exact: true })).toBeVisible();
    const afterCancel = await read();
    expect(afterCancel).toMatchObject({ status: 'in_progress', progress: 40 });
    expect(afterCancel.workItems.find(w => w.id === active.id)).toMatchObject({ status: 'in_progress', progress: 40 });
    expect(afterCancel.progressUpdates).toEqual(expect.arrayContaining(requirement.progressUpdates || []));
    await row.getByRole('button', { name: cancelled.title, exact: true }).click();
    await expect(root.getByRole('heading', { name: cancelled.title, exact: true })).toBeVisible();
    await expect(root.locator('header').first()).toContainText('已取消');
    await root.getByRole('tab', { name: '记录', exact: true }).click();
    await expect(root.locator('.work-history-entry')).toContainText('取消工作项');
    await page.reload();
    await expect(root.getByRole('heading', { name: cancelled.title, exact: true })).toBeVisible();
    await expect(root.locator('.work-history-entry')).toContainText('取消工作项');
    await root.getByRole('tab', { name: '概况', exact: true }).click();
    await root.getByRole('button', { name: '重开/返工', exact: true }).click();
    await expect(root.getByRole('button', { name: '开始', exact: true })).toBeVisible();
    await root.getByRole('button', { name: '需求说明', exact: true }).click();
    await expect(root.getByRole('heading', { name: requirement.title, exact: true })).toBeVisible();
    const restored = await read();
    expect(restored).toMatchObject({ status: 'in_progress', progress: 20 });
    expect(restored.workItems.find(w => w.id === cancelled.id)).toMatchObject({ status: 'not_started', progress: 0, actualStart: null, actualEnd: null });
    expect(restored.workItems.find(w => w.id === active.id)).toMatchObject({ status: 'in_progress', progress: 40 });
    expect(restored.progressUpdates).toEqual(expect.arrayContaining(afterCancel.progressUpdates || []));
  });
}
