import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const credentials = { username: 'admin', password: '41_xc7q0qOjo4Inw!' };
test.beforeEach(async ({ page }) => {
  expect((await page.context().request.post('/api/login', { data: credentials })).ok()).toBe(true);
});

test('从页面导出、预览、取消和确认导入，重启后重新登录', async ({ page }, testInfo) => {
  const projectName = `数据库迁移-${randomUUID()}`;
  const request = page.context().request;
  expect((await request.post('/api/projects', { data: { name: projectName } })).ok()).toBe(true);
  await page.goto('/system');
  const exporting = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出数据库', exact: true }).click();
  const download = await exporting;
  expect(download.suggestedFilename()).toMatch(/^project-manage-.*\.db$/);
  const buffer = fs.readFileSync((await download.path())!);
  expect(buffer.subarray(0, 16).toString()).toBe('SQLite format 3\0');
  const extraName = `导出后新增-${randomUUID()}`;
  expect((await request.post('/api/projects', { data: { name: extraName } })).ok()).toBe(true);

  await page.getByLabel('选择数据库文件').setInputFiles({ name: '迁移备份.db', mimeType: 'application/octet-stream', buffer });
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: '导入数据库' })).toBeVisible();
  await expect(dialog.getByText('迁移备份.db', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/个项目 · .*条需求 · .*名人员/)).toBeVisible();
  await expect(dialog.getByText(/admin 使用本机配置的管理员密码/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: '确认导入并替换' })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  await page.screenshot({ path: testInfo.outputPath('database-import-preview.png'), animations: 'disabled' });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect((await (await request.get('/api/projects')).json()).some((item: { name: string }) => item.name === extraName)).toBe(true);

  // 取消后从保留的上传文件再次恢复，仍使用本机管理员密码规则。
  const imported = page.locator('.system-backup-table tbody tr').filter({ hasText: 'project-manage-import-' }).first();
  await imported.getByRole('button', { name: '恢复', exact: true }).click();
  await expect(dialog.getByText(/admin 使用本机配置的管理员密码/)).toBeVisible();
  const restartedPage = page.waitForEvent('load', { timeout: 20_000 });
  await dialog.getByRole('button', { name: '确认导入并替换' }).click();
  await restartedPage;
  await expect.poll(async () => {
    try {
      const response = await request.get('/api/session');
      return response.ok() ? (await response.json()).authenticated : undefined;
    } catch { return undefined; }
  }, { timeout: 20_000 }).toBe(false);
  expect((await request.post('/api/login', { data: credentials })).ok()).toBe(true);
  await page.goto('/system');
  await expect(page.getByText(/最近一次数据库恢复已完成/)).toBeVisible();
  const projects = await (await request.get('/api/projects')).json() as Array<{ name: string }>;
  expect(projects.some((item) => item.name === projectName)).toBe(true);
  expect(projects.some((item) => item.name === extraName)).toBe(false);
});

test('无效本地文件显示错误，页面允许重新选择文件', async ({ page }) => {
  await page.goto('/system');
  await expect(page.getByRole('button', { name: '导入数据库', exact: true })).toBeEnabled();
  await page.getByLabel('选择数据库文件').setInputFiles({ name: 'invalid.db', mimeType: 'application/octet-stream', buffer: Buffer.from('broken database') });
  await expect(page.getByText('备份数据库文件无效', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '导入数据库', exact: true })).toBeEnabled();
});
