import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const response = await page.context().request.post('/api/login', {
    data: { username: 'admin', password: '41_xc7q0qOjo4Inw!' },
  });
  expect(response.ok()).toBe(true);
});

test('system management focuses on health and data safety', async ({ page }) => {
  await page.goto('/system');
  await expect(page.getByRole('heading', { name: '系统管理', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'MCP Token', exact: true })).toHaveCount(0);
  await expect(page.getByText('平台治理', { exact: true })).toBeVisible();
  await expect(page.getByText('平台运维', { exact: true })).toBeVisible();

  const panel = page.locator('.system-backup-panel');
  const panelBox = await panel.boundingBox();
  expect(panelBox).not.toBeNull();
  expect(panelBox!.height).toBeGreaterThanOrEqual(419);
  expect(panelBox!.height).toBeLessThanOrEqual(621);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);

  await page.getByRole('button', { name: '立即备份' }).click();
  await expect(page.getByText(/备份已创建：/)).toBeVisible();
  await expect(page.locator('.system-backup-table tbody tr').first()).toBeVisible();

  await page.getByRole('button', { name: '立即检查' }).click();
  await expect(page.getByText('数据库状态正常')).toBeVisible();

  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'MCP 接入', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'admin', exact: true })).toBeVisible();
  await expect(page.getByText('/mcp', { exact: false })).toBeVisible();
});
