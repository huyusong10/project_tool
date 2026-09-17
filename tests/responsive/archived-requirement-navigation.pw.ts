import { expect, test, type Page } from '@playwright/test';

async function fixture(page: Page) {
  const post = async (url: string, data: object) => {
    const response = await page.request.post(url, { data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  await post('/api/login', { username: 'admin', password: '41_xc7q0qOjo4Inw!' });
  const project = await post('/api/projects', { name: '归档成果旅程 ' + Date.now() });
  const base = '/api/projects/' + project.id;
  const feature = (await post(base + '/features', { name: '首期交付' })).features.find((f: {name: string}) => f.name === '首期交付');
  const phase = await post(base + '/features/' + feature.id + '/phases', { name: '第一期' });
  const owner = await post('/api/people', { projectId: project.id, name: '归档负责人 ' + Date.now() });
  let requirement = await post('/api/requirements', { projectId: project.id, featureId: feature.id, phaseId: phase.id,
    ownerId: owner.id, title: '已归档的首期成果', acceptanceCriteria: '能追溯本期已完成的交付内容' });
  requirement = await post('/api/requirements/' + requirement.id + '/start', { expectedVersion: requirement.version });
  requirement = await post('/api/requirements/' + requirement.id + '/complete', { expectedVersion: requirement.version });
  const archived = await page.request.delete('/api/requirements/' + requirement.id, { data: { expectedVersion: requirement.version } });
  expect(archived.ok(), await archived.text()).toBe(true);
  return { project, feature, phase, requirement };
}

for (const width of [1280, 390]) test(`归档成果从清单、进展表和 Phase 查看后恢复 ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 });
  const { project, feature, phase, requirement } = await fixture(page);
  const params = new URLSearchParams({ projectId: project.id, workspaceView: 'list', scopeType: 'phase', scopeId: phase.id });
  await page.goto('/?' + params);
  await page.locator(`[data-object-id="${requirement.id}"] .outline-title`).click();
  const detail = page.getByRole('dialog', { name: requirement.title, exact: true });
  await expect(detail).toContainText('能追溯本期已完成的交付内容');
  await expect(detail).toContainText('已归档');
  await expect(detail.getByRole('button', { name: '进入需求', exact: true })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: '操作', exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('archived-detail.png'), animations: 'disabled' });
  expect(await detail.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await detail.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('button', { name: '进入' + requirement.title, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '进展表', exact: true }).click();
  await page.locator(`[data-row-id="${requirement.id}"] .workspace-row-title`).click();
  await expect(detail).toContainText('能追溯本期已完成的交付内容');
  await detail.getByRole('button', { name: '关闭', exact: true }).click();
  params.set('scopeType', 'feature'); params.set('scopeId', feature.id); params.set('detailId', 'phase:' + phase.id);
  await page.goto('/?' + params);
  const phaseDetail = page.getByRole('dialog', { name: phase.name, exact: true });
  await phaseDetail.getByRole('tab', { name: '需求清单', exact: true }).click();
  await phaseDetail.getByRole('button', { name: requirement.title, exact: true }).click();
  await expect(detail).toContainText('能追溯本期已完成的交付内容');
  await detail.getByRole('button', { name: '返回' + phase.name, exact: true }).click();
  await expect(phaseDetail.getByRole('tab', { name: '需求清单', exact: true })).toHaveAttribute('aria-selected', 'true');
  await phaseDetail.getByRole('button', { name: requirement.title, exact: true }).click();
  await detail.getByRole('link', { name: '前往项目归档', exact: true }).click();
  await expect(page).toHaveURL(/\/project-settings/);
  const row = page.locator('.compact-list > div').filter({ hasText: requirement.title });
  await row.getByRole('button', { name: '恢复', exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.goto('/?' + params);
  await phaseDetail.getByRole('tab', { name: '需求清单', exact: true }).click();
  await phaseDetail.getByRole('button', { name: requirement.title, exact: true }).click();
  await expect(detail.getByRole('tab', { name: '工作项 0', exact: true })).toBeVisible();
  await expect(detail.getByRole('link', { name: '前往项目归档', exact: true })).toHaveCount(0);
});

test('游客查看已有归档交付事实，不显示恢复管理入口', async ({ page, browser, baseURL }) => {
  const { project, phase, requirement } = await fixture(page);
  const opened = await page.request.patch('/api/projects/' + project.id, { data: { guestVisible: true, expectedUpdatedAt: project.updatedAt } });
  expect(opened.ok(), await opened.text()).toBe(true);
  const guest = await browser.newContext({ baseURL });
  try {
    const actor = await guest.newPage();
    await actor.goto('/?' + new URLSearchParams({ projectId: project.id, workspaceView: 'list', scopeType: 'phase', scopeId: phase.id }));
    await actor.locator(`[data-object-id="${requirement.id}"] .outline-title`).click();
    const detail = actor.getByRole('dialog', { name: requirement.title, exact: true });
    await expect(detail).toContainText('能追溯本期已完成的交付内容');
    await expect(detail.getByRole('link', { name: '前往项目归档', exact: true })).toHaveCount(0);
    expect((await actor.request.get('/api/archives?projectId=' + project.id)).status()).toBe(401);
  } finally { await guest.close(); }
});
