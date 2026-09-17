import { expect, test } from '@playwright/test';
import { phaseFixture } from './phase-fixture';

for (const width of [1280, 390]) test(`清单查找、打开和跨视图保留条件 ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 });
  const { projectId, testing, phases } = await phaseFixture(page);
  await page.goto('/?' + new URLSearchParams({ projectId, workspaceView: 'list', scopeType: 'project', scopeId: projectId }));
  const search = page.getByRole('searchbox', { name: '筛选清单', exact: true });
  const result = page.locator(`[data-object-id="${testing.id}"] .outline-title`);
  for (const query of ['  资产导入  ', 'zcdr', 'ＤＣＩＭ－００２']) {
    await search.fill(query);
    await expect(result).toBeVisible();
    await expect(page.locator(`[data-object-id="phase:${phases[1].id}"] .outline-title`)).toBeVisible();
    await result.click();
    const detail = page.getByRole('dialog', { name: testing.title, exact: true });
    await expect(detail.getByRole('tab', { name: '工作项 2', exact: true })).toBeVisible();
    await detail.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(search).toHaveValue(query);
    await page.getByRole('button', { name: '进展表', exact: true }).click();
    await expect(page.locator(`[data-row-id="${testing.id}"] .workspace-row-title`)).toBeVisible();
    await page.getByRole('button', { name: '清单', exact: true }).click();
    await expect(search).toHaveValue(query);
  }
  await page.screenshot({ path: info.outputPath('search-result.png'), animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await search.fill('找不到的需求');
  await expect(result).toHaveCount(0);
  await search.fill('');
  await page.getByRole('button', { name: '展开全部', exact: true }).click();
  await expect(result).toBeVisible();
});
