import { expect, test } from '@playwright/test';
import { chooseOption } from './select-helper';
import { mockGanttData } from './gantt-fixture';

test('项目日志可以筛选已删除 Phase，并展开长操作内容', async ({ page }, info) => {
  async function post(url: string, data: unknown) {
    const response = await page.request.post(url, { data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  await post('/api/login', { username: 'admin', password: '41_xc7q0qOjo4Inw!' });
  const project = await post('/api/projects', { name: '操作追溯 ' + Date.now() });
  const base = '/api/projects/' + project.id;
  const features = await post(base + '/features', { name: '资产管理' });
  const scope = '必须保留的交付说明。'.repeat(60) + 'https://example.com/' + 'a'.repeat(400) + '尾部验收材料';
  const phase = await post(base + '/features/' + features.features[0].id + '/phases', { name: '日志追溯 Phase', scope });
  const removed = await page.request.delete(base + '/feature-phases/' + phase.id, { data: { expectedVersion: phase.version, reason: '删除未安排的空阶段' } });
  expect(removed.ok(), await removed.text()).toBe(true);
  await page.goto('/project-logs?projectId=' + project.id);
  for (const name of ['日志来源', '日志动作', '日志对象']) await expect(page.getByRole('combobox', { name, exact: true })).toBeVisible();
  await chooseOption(page.getByRole('combobox', { name: '日志对象', exact: true }), 'feature_phase');
  const rows = page.locator('.audit-table > div:not(.audit-head):not(.empty-state)');
  await expect(rows).toHaveCount(2);
  const created = rows.filter({ hasText: '尾部验收材料' });
  await expect(created).toHaveCount(1);
  await expect(created.locator('span').nth(2)).toHaveText('Phase');
  const details = created.locator('details');
  const compactHeight = (await created.boundingBox())!.height;
  await details.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(details).toHaveAttribute('open', '');
  await expect(details.locator('p')).toContainText('尾部验收材料');
  expect((await created.boundingBox())!.height).toBeGreaterThan(compactHeight);
  expect(await details.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('expanded-log.png'), animations: 'disabled' });
  await details.locator('summary').click();
  await expect(details).not.toHaveAttribute('open', '');
  await expect.poll(async () => (await created.boundingBox())!.height).toBe(compactHeight);
  await page.setViewportSize({ width: 390, height: 844 });
  await details.locator('summary').click();
  await expect(details.locator('p')).toContainText(scope);
  expect(await details.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('narrow-expanded-log.png'), animations: 'disabled' });
});

test.describe('日志筛选与显示的业务时区', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });
  test('浏览器在其他时区时，选定日期内的记录仍显示北京时间', async ({ page }) => {
    await mockGanttData(page);
    await page.route('**/api/audit/search?*', route => route.fulfill({ json: {
      items: [{ id: 'local-day', createdAt: '2026-09-16T16:15:00.000Z', actorType: 'user', actorName: '管理员', action: 'update', entityType: 'requirement', summary: '北京时间9月17日凌晨的修改' }],
      total: 1, page: 1, pageSize: 50, pages: 1, snapshot: 1,
    } }));
    await page.goto('/logs?from=2026-09-17&to=2026-09-17');
    for (const name of ['日志来源', '日志动作', '日志对象']) await expect(page.getByRole('combobox', { name, exact: true })).toBeVisible();
    const row = page.locator('.audit-table > div').filter({ hasText: '北京时间9月17日凌晨的修改' });
    await expect(row.locator('span').first()).toHaveText('2026/9/17 00:15:00');
    await expect(page.locator('.audit-head')).toContainText('北京时间');
  });
});
