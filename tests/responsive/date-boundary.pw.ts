import { expect, test } from '@playwright/test';

test('排期越界保留日期输入，改正后可预览和补全原需求', async ({ page }) => {
  async function post(url: string, data: unknown) {
    const response = await page.request.post(url, { data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  await post('/api/login', { username: 'admin', password: '41_xc7q0qOjo4Inw!' });
  const project = await post('/api/projects', { name: '日期边界 ' + Date.now() });
  const template = await post('/api/templates', { projectId: project.id, name: '两天流程', items: [{ title: '实现', startOffsetDays: 0, durationDays: 2, sortOrder: 0 }] });
  const requirement = await post('/api/requirements', { projectId: project.id, templateId: template.id, title: '保留原需求补全排期' });
  await page.goto('/requirements/' + requirement.id);
  await page.getByRole('tab', { name: /^工作项 / }).click();
  await page.getByRole('button', { name: '补全计划', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '按模板补全计划', exact: true });
  const date = dialog.getByLabel('计划开始', { exact: true });
  await date.fill('9999-12-31');
  await dialog.getByRole('button', { name: '生成差异预览', exact: true }).click();
  await expect(dialog).toContainText('排期超出支持的日期范围，请调整日期或工期');
  await expect(date).toHaveValue('9999-12-31');
  const unchanged = await (await page.request.get('/api/requirements/' + requirement.id)).json();
  expect(unchanged.version).toBe(requirement.version);
  expect(unchanged.workItems[0]).toMatchObject({ plannedStart: null, plannedEnd: null });
  await date.fill('2026-09-01');
  await dialog.getByRole('button', { name: '生成差异预览', exact: true }).click();
  await expect(dialog.locator('.plan-preview-list')).toContainText('2026-09-01');
  await dialog.getByRole('button', { name: '确认补全', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const saved = await (await page.request.get('/api/requirements/' + requirement.id)).json();
  expect(saved.workItems).toHaveLength(1);
  expect(saved.workItems[0]).toMatchObject({ id: requirement.workItems[0].id, plannedStart: '2026-09-01', plannedEnd: '2026-09-02' });
});
