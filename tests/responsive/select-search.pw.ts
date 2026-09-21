import { expect, test, type Page } from '@playwright/test';
import { headerAction } from './topbar-helpers';

async function openRequirement(page: Page) {
  const post = async (url: string, data: unknown) => {
    const response = await page.request.post(url, { data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  await post('/api/login', { username: 'admin', password: '41_xc7q0qOjo4Inw!' });
  const project = await post('/api/projects', { name: '选择与录入 ' + Date.now() });
  let featureId = '';
  for (const name of ['资产管理', 'DCIM-008 设备接入', ...Array.from({ length: 5 }, (_, i) => '平台配置 ' + i)]) {
    const result = await post(`/api/projects/${project.id}/features`, { name });
    if (name === '资产管理') featureId = result.features.find((feature: { name: string }) => feature.name === name).id;
  }
  await page.goto('/?' + new URLSearchParams({ projectId: project.id, workspaceView: 'list', scopeType: 'project' }));
  await headerAction(page, '新建对象');
  await page.getByRole('menu', { name: '新建对象', exact: true }).getByRole('button', { name: '新建需求', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建需求', exact: true });
  await dialog.getByLabel('需求标题', { exact: true }).fill('搜索选择后创建的需求');
  const select = dialog.getByRole('combobox', { name: '需求特性', exact: true });
  await select.click();
  const search = page.getByRole('textbox', { name: '搜索需求特性', exact: true });
  await expect(search).toBeFocused();
  return { project, featureId, dialog, select, search };
}

for (const width of [1280, 390]) test(`搜索特性支持复制名称、拼音和全角编号，选择并创建需求 ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 });
  const { project, featureId, dialog, select, search } = await openRequirement(page);
  await search.fill('不存在的特性');
  await search.press('Enter');
  await expect(page.locator('.select-empty')).toHaveText('没有匹配的选项');
  await expect(select).toContainText('默认归入其他需求');
  for (const [query, name] of [[' 资产管理 ', '资产管理'], ['ｄｃｉｍ－００８', 'DCIM-008 设备接入'], ['zcgl', '资产管理']]) {
    await search.fill(query);
    await expect(page.getByRole('option', { name, exact: true })).toBeVisible();
  }
  const popup = page.locator('.select-popover');
  const bounds = (await popup.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: info.outputPath(`feature-search-${width}.png`), animations: 'disabled' });
  await search.press('Enter');
  await expect(select).toBeFocused();
  await expect(select).toContainText('资产管理');
  await select.click();
  await expect(search).toHaveValue('');
  await search.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(select).toBeFocused();
  await dialog.getByRole('button', { name: '创建需求', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const saved = await (await page.request.get('/api/requirements?projectId=' + project.id)).json();
  expect(saved).toEqual([expect.objectContaining({ title: '搜索选择后创建的需求', featureId })]);
});

test('下拉搜索的 Home/End 编辑文本，方向键选项和 Escape 取消选择', async ({ page }) => {
  const { select, search } = await openRequirement(page);
  await search.fill('资产管理');
  for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
    await search.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', ...composition });
    await expect(search).toBeVisible();
    await expect(select).toContainText('默认归入其他需求');
  }
  await search.press('Home');
  expect(await search.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(0);
  await search.press('End');
  expect(await search.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(4);
  await search.fill('');
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(select).toBeFocused();
  const selected = await select.textContent();
  await select.click();
  await search.fill('资产管理');
  await search.press('Escape');
  await expect(select).toHaveText(selected!);
});
