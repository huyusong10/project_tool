import { expect, test, type Page } from '@playwright/test';
import type { FeaturePhase } from '../../src/shared/feature-phases';
import type { Requirement } from '../../src/client/types';

async function fixture(page: Page) {
  async function post(url: string, data: unknown) { const response = await page.request.post(url, { data }); expect(response.ok(), await response.text()).toBe(true); return response.json(); }
  const session = await post('/api/login', { username: 'admin', password: '41_xc7q0qOjo4Inw!' });
  const project = await post('/api/projects', { name: 'Phase 页面验证 ' + Date.now() });
  const owner = await post('/api/people', { projectId: project.id, name: 'Phase 负责人 ' + Date.now() });
  const base = '/api/projects/' + project.id;
  const feature = (await post(base + '/features', { name: '资产管理', description: '从基础台账开始逐步交付资产管理', referenceLinks: [{ title: 'MDS', url: 'https://example.com/asset-mds' }] })).features[0];
  const phases: FeaturePhase[] = [];
  for (const [index, scope] of ['基础台账', '批量导入', ''].entries()) phases.push(await post(base + '/features/' + feature.id + '/phases', { name: 'Phase ' + (index + 1), scope, note: index === 1 ? '字段映射待确认' : '' }));
  const create = async (title: string, phaseId: string | null, templateId?: string) => post('/api/requirements', { projectId: project.id, title, ownerId: owner.id, featureId: feature.id, phaseId, reason:'补充本次交付范围', templateId, ...(templateId ? { plannedStart: new Date().toISOString().slice(0, 10) } : {}) });
  let done = await create('DCIM-001 基础台账', phases[0].id); done = await post('/api/requirements/' + done.id + '/start', { expectedVersion: done.version }); await post('/api/requirements/' + done.id + '/complete', { expectedVersion: done.version, content: '验证交付' });
  const updated: FeaturePhase[] = await (await page.request.get(base + '/feature-phases')).json(); await post(base + '/feature-phases/' + phases[0].id + '/deliver', { expectedVersion: updated.find(p => p.id === phases[0].id)!.version });
  const template = await post('/api/templates', { projectId: project.id, name: '阶段工作流', dependencyMode: 'legacy', items: [{ title: '开发', workStage: 'development', durationDays: 99, startOffsetDays: 0, sortOrder: 0 }, { title: '测试', workStage: 'testing', durationDays: 1, startOffsetDays: 0, sortOrder: 1 }] });
  let testing: Requirement = await create('DCIM-002 资产导入', phases[1].id, template.id);
  const dev = await post('/api/work-items/' + testing.workItems[0].id + '/start', { expectedVersion: testing.workItems[0].version, expectedRequirementVersion:testing.version, ownerId: owner.id });
  await post('/api/work-items/' + testing.workItems[0].id + '/complete', { expectedVersion: dev.version });
  testing=await(await page.request.get("/api/requirements/"+testing.id)).json();
  const work = await post('/api/work-items/' + testing.workItems[1].id + '/start', { expectedVersion: testing.workItems[1].version, expectedRequirementVersion:testing.version, ownerId: owner.id });
  await post('/api/requirements/' + testing.id + '/progress', { expectedVersion: work.version, workItemId: work.id, workItemPercent: 70, content: '测试场景完成七成' });
  testing = await (await page.request.get('/api/requirements/' + testing.id)).json();
  let direct = await create('DCIM-003 无预设里程碑', phases[1].id); direct = await post('/api/requirements/' + direct.id + '/start', { expectedVersion: direct.version });
  await page.addInitScript(({ account, id }) => localStorage.setItem('project-manage:selected-project:' + account, id), { account: session.accountId, id: project.id });
  return { projectId: project.id, base, feature, phases, testing, direct };
}
const dialog = (page: Page) => page.getByRole('dialog').last();
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }

test('特性 Phase 总览、需求阶段、甘特和路径在办公视口及窄屏可读', async ({ page }, info) => {
  const state = await fixture(page), errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await expect(page.locator('.phase-row')).toHaveCount(3);
  await page.getByRole('button',{name:'特性资料',exact:true}).click();await expect(dialog(page).locator('.phase-row')).toHaveCount(3);await dialog(page).locator('.phase-row').first().getByRole('button',{name:'详情',exact:true}).click();await expect(dialog(page)).toContainText('交付记录');await dialog(page).getByRole('button',{name:'关闭',exact:true}).first().click();await dialog(page).getByRole('button',{name:'关闭',exact:true}).first().click();
  await expect(page.locator('.feature-phase-summary')).not.toContainText('%');
  await expect(page.locator('.phase-row').first()).toContainText('已交付'); await expect(page.locator('.phase-row').nth(1)).toContainText('推进中'); await expect(page.locator('.phase-row').last()).toContainText('交付范围待明确');
  await page.locator('.phase-row').last().getByRole('button', { name: '编辑', exact: true }).click(); await expect(dialog(page).getByLabel('Phase 名称')).toHaveValue('Phase 3'); await dialog(page).getByRole('button', { name: '关闭', exact: true }).first().click(); await page.locator('.feature-overview-scroll').evaluate(el => { el.scrollTop = 0; });
  await noOverflow(page); await page.screenshot({ path: info.outputPath('feature-phases-office.png'), fullPage: true, animations: 'disabled' });
  await page.getByLabel('Phase 状态筛选').selectOption('delivered'); await expect(page.locator('.phase-row')).toHaveCount(1); await page.getByLabel('Phase 状态筛选').selectOption('');
  await page.locator('.phase-row').nth(1).getByRole('button', { name: '测试中 1', exact: true }).click(); await expect(dialog(page)).toContainText('DCIM-002'); await dialog(page).getByRole('button', { name: '关闭', exact: true }).first().click();
  await page.goto('/requirements'); const row = page.locator('tbody tr').filter({ hasText: state.testing.title }); await expect(row).toContainText('测试中'); await expect(row).toContainText('70%'); await expect(row).not.toContainText('99%'); await noOverflow(page);
  await page.goto('/requirements/' + state.testing.id); await expect(page.locator('.requirement-overview')).toContainText('测试中'); await expect(page.locator('.requirement-overview')).toContainText('70%'); await page.screenshot({ path: info.outputPath('requirement-stage-office.png'), fullPage: true, animations: 'disabled' });
  await page.goto('/execution'); await expect(page.locator('.gantt-stage.stage-testing')).toBeVisible(); await noOverflow(page); await page.screenshot({ path: info.outputPath('execution-stage-office.png'), fullPage: true, animations: 'disabled' });
  await page.goto('/paths?view=project'); await expect(page.locator('[data-layout-ready="true"]')).toBeVisible({ timeout: 20000 }); await noOverflow(page); await page.screenshot({ path: info.outputPath('paths-stage-office.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/'); await expect(page.locator('.phase-row')).toHaveCount(3); await noOverflow(page); await page.screenshot({ path: info.outputPath('feature-phases-mobile.png'), fullPage: true });
  await page.goto('/requirements/' + state.testing.id); await expect(page.locator('.requirement-overview')).toContainText('测试中'); await noOverflow(page); await page.screenshot({ path: info.outputPath('requirement-stage-mobile.png'), fullPage: true }); for(const path of ['/requirements','/execution','/paths?view=project']){await page.goto(path);await expect(page.locator('main')).toBeVisible();await noOverflow(page);await page.screenshot({path:info.outputPath('mobile-'+path.split('?')[0].slice(1)+'.png'),fullPage:true});} expect(errors).toEqual([]);
});

test('新增与编辑 Phase、未知结果核对、重新打开与记录提测', async ({ page }) => {
  const state = await fixture(page); await page.goto('/'); await page.getByRole('button', { name: '新增 Phase', exact: true }).click(); await dialog(page).getByLabel('Phase 名称').fill('Phase 4'); await dialog(page).getByLabel('交付范围').fill('跨站点治理');
  const endpoint = '**' + state.base + '/features/' + state.feature.id + '/phases'; let writes = 0;
  await page.route(endpoint, async route => { if (route.request().method() !== 'POST') return route.continue(); writes++; await route.fetch(); await route.abort('failed'); });
  await dialog(page).getByRole('button', { name: '新增 Phase', exact: true }).click(); await expect(dialog(page).getByRole('button', { name: '读取最新 Phase 并核对' })).toBeVisible();
  await page.reload(); await expect(dialog(page).getByLabel('Phase 名称')).toHaveValue('Phase 4'); await dialog(page).getByRole('button', { name: '读取最新 Phase 并核对' }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); expect(writes).toBe(1); await page.unroute(endpoint); await expect(page.locator('.phase-row')).toHaveCount(4);
  await page.locator('.phase-row').first().getByRole('button', { name: '重新打开', exact: true }).click(); await dialog(page).getByLabel('变更原因').fill('补充客户反馈'); await dialog(page).getByRole('button', { name: '重新打开 Phase', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.locator('.phase-row').first()).toContainText('待交付');
  await page.goto('/requirements/' + state.direct.id); await page.getByRole('button', { name: '记录提测', exact: true }).click(); await dialog(page).getByLabel('说明', { exact: true }).fill('版本已部署到测试环境'); await dialog(page).getByRole('button', { name: '保存提测记录' }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.locator('.requirement-overview')).toContainText('已提测');
  await page.goto('/'); await page.getByRole('button', { name: '新增 Phase', exact: true }).click(); await dialog(page).getByLabel('Phase 名称').fill('尚未提交的输入'); await page.route('**' + state.base + '/feature-overview*', route => route.fulfill({ status: 403, json: { error: '项目权限已移除' } })); await page.getByRole('button', { name: '刷新特性', exact: true }).evaluate((b: HTMLButtonElement) => b.click()); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.locator('.phase-row')).toHaveCount(0);
});
