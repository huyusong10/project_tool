import {chooseOption} from './select-helper';
import { project, template, secondaryTemplate, people, mockForms, scenarios, type FormReferenceState } from './form-fixture';
import { headerAction } from './topbar-helpers';

import { expect, test, type Page } from '@playwright/test';
import type { Project, Requirement, WorkItemTemplate } from '../../src/client/types';










async function reconnect(page: Page) {

  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
}



async function openTemplateFields(page:Page){
 const editor=page.locator('.template-flow-workspace');await editor.locator('[data-layout-ready="true"]').waitFor();
 await headerAction(page,'流程属性');
}
async function openFirstTemplateItem(page:Page){
 const editor=page.locator('.template-flow-workspace');
 if(!await editor.locator('.graph-finder').isVisible())await editor.getByRole('button',{name:'查找与筛选',exact:true}).click();
 await editor.getByRole('button',{name:/^节点 \d/}).click();await editor.locator('.graph-list-row>button:first-child').first().click();
}
test('超出法定工作日日历范围时提示回退规则', async ({ page }) => {
  await mockForms(page);
  await page.goto('/requirements');
  await page.getByRole('button', { name: '新建需求', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建需求', exact: true });
  await dialog.getByRole('button', { name: /流程与排期/ }).click();
  await dialog.getByLabel('计划开始', { exact: true }).fill('2027-01-04');
  await expect(dialog.getByRole('status')).toContainText('将按周一至周五计算');
  await dialog.getByLabel('计划开始', { exact: true }).fill('2026-12-31');
  await expect(dialog.getByRole('status')).toHaveCount(0);
});

for (const scheduleMode of ['start', 'deadline'] as const) {
  test(`新建需求折叠后保留补充信息与${scheduleMode}排期并提交`, async ({ page }, testInfo) => {
    await mockForms(page);
    let saved: Record<string, unknown> | undefined;
    await page.route('**/api/requirements', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      saved = route.request().postDataJSON();
      return route.fulfill({ json: { id: 'saved', ...saved } });
    });
    await page.goto('/requirements');
    await page.getByRole('button', { name: '新建需求', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '新建需求', exact: true });
    await dialog.getByRole('textbox', { name: '需求标题', exact: true }).fill('折叠不丢草稿');
    const detailsToggle = dialog.getByRole('button', { name: /补充信息/ });
    await detailsToggle.click();
    const background = dialog.getByRole('textbox', { name: '需求背景', exact: true });
    await background.fill('需求背景不能丢');
    await dialog.getByRole('textbox', { name: '完成标准', exact: true }).fill('完成标准不能丢');
    await dialog.getByRole('region', { name: '编辑关联链接' }).getByRole('button', { name: '添加', exact: true }).click();
    await dialog.getByLabel('链接 1 地址', { exact: true }).fill('https://example.com/spec');
    await detailsToggle.click();
    await expect(background).toBeHidden();
    await detailsToggle.click();
    await expect(background).toHaveValue('需求背景不能丢');
    await detailsToggle.click();
    const planningToggle = dialog.getByRole('button', { name: /流程与排期/ });
    await planningToggle.click();
    await chooseOption(dialog.getByRole('combobox', { name: '流程设计', exact: true }), 't1');
    if (scheduleMode === 'deadline') await dialog.getByRole('radio', { name: /按截止日期倒排/ }).click();
    const dateLabel = scheduleMode === 'start' ? '计划开始' : '截止日期';
    await dialog.getByLabel(dateLabel, { exact: true }).fill('2020-01-06');
    await planningToggle.click();
    await planningToggle.click();
    await expect(dialog.getByLabel(dateLabel, { exact: true })).toHaveValue('2020-01-06');
    await detailsToggle.click();
    await expect(background).toHaveValue('需求背景不能丢');
    if (scheduleMode === 'start' && testInfo.project.name === 'desktop-1080p') await page.screenshot({ path: testInfo.outputPath('requirement-disclosure.png') });
    await detailsToggle.click();
    await planningToggle.click();
    await dialog.getByRole('button', { name: '创建需求', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(saved).toMatchObject({
      title: '折叠不丢草稿', projectId: 'p1', templateId: 't1',
      background: '需求背景不能丢', acceptanceCriteria: '完成标准不能丢', referenceLinks: [expect.objectContaining({ url: 'https://example.com/spec' })],
      [scheduleMode === 'start' ? 'plannedStart' : 'plannedEnd']: '2020-01-06',
    });
    expect(saved).not.toHaveProperty(scheduleMode === 'start' ? 'plannedEnd' : 'plannedStart');
  });
}

test('收起的无效参考链接自动展开定位，修正后保留其它草稿', async ({ page }) => {
  await mockForms(page);
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/api/requirements', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { id: 'saved' } });
  });
  await page.goto('/requirements');
  await page.getByRole('button', { name: '新建需求', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建需求', exact: true });
  await dialog.getByRole('textbox', { name: '需求标题', exact: true }).fill('校验折叠内容');
  const toggle = dialog.getByRole('button', { name: /补充信息/ });
  await toggle.click();
  await dialog.getByRole('textbox', { name: '需求背景', exact: true }).fill('仍要保留');
  await dialog.getByRole('region', { name: '编辑关联链接' }).getByRole('button', { name: '添加', exact: true }).click();
  const url = dialog.getByLabel('链接 1 地址', { exact: true });
  await url.fill('not-a-url');
  await toggle.click();
  await dialog.getByRole('button', { name: '创建需求', exact: true }).click();
  await expect(url).toBeVisible();
  await expect(url).toBeFocused();
  expect(requests).toHaveLength(0);
  await expect(dialog.getByRole('textbox', { name: '需求背景', exact: true })).toHaveValue('仍要保留');
  await url.fill('https://example.com/fixed');
  await toggle.click();
  await dialog.getByRole('button', { name: '创建需求', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ background: '仍要保留', referenceLinks: [expect.objectContaining({ url: 'https://example.com/fixed' })] });
  expect(requests[0]).not.toHaveProperty('templateId');
  expect(requests[0]).not.toHaveProperty('plannedStart');
  expect(requests[0]).not.toHaveProperty('plannedEnd');
});

test('引用选项刷新失效后保留未保存选择并明确提示', async ({ page }) => {
  const references: FormReferenceState = {
    templates: [template, secondaryTemplate],
    people: [...people],
    templateRequests: 0,
    peopleRequests: 0,
  };
  await mockForms(page, references);
  await page.goto('/project-settings');
  await page.getByRole('button', { name: '编辑项目', exact: true }).click();
  const projectDialog = page.getByRole('dialog', { name: '编辑项目', exact: true });
  const defaultTemplate = projectDialog.getByRole('combobox', { name: '默认流程', exact: true });
  await chooseOption(defaultTemplate, 't2');
  const projectTemplateRequests = references.templateRequests;
  references.templates = [template];
  await reconnect(page);
  await expect.poll(() => references.templateRequests).toBeGreaterThan(projectTemplateRequests);
  await expect(defaultTemplate).toHaveValue('t2');
  await expect(defaultTemplate.locator('option:checked')).toHaveText('已不可用的流程（请重新选择）');
  await projectDialog.getByRole('button', { name: '取消', exact: true }).click();

  references.templates = [template, secondaryTemplate];
  await page.goto('/requirements');
  await page.getByRole('button', { name: '新建需求', exact: true }).click();
  const requirementDialog = page.getByRole('dialog', { name: '新建需求', exact: true });
  const owner = requirementDialog.getByRole('combobox', { name: '需求负责人（可稍后指定）', exact: true });
  await expect(owner.locator('option[value="u2"]')).toHaveText('备用负责人');
  await chooseOption(owner, 'u2');
  await requirementDialog.getByRole('button', { name: /流程与排期/ }).click();
  const requirementTemplate = requirementDialog.getByRole('combobox', { name: '流程设计', exact: true });
  await expect(requirementTemplate.locator('option[value="t2"]')).toHaveText('备用流程');
  await chooseOption(requirementTemplate, 't2');
  const requirementTemplateRequests = references.templateRequests;
  const requirementPeopleRequests = references.peopleRequests;
  references.templates = [template];
  references.people = people.slice(0, 1);
  await reconnect(page);
  await expect.poll(() => references.templateRequests).toBeGreaterThan(requirementTemplateRequests);
  await expect.poll(() => references.peopleRequests).toBeGreaterThan(requirementPeopleRequests);
  await expect(requirementTemplate).toHaveValue('t2');
  await expect(requirementTemplate.locator('option:checked')).toHaveText('已不可用的流程（请重新选择）');
  await expect(owner).toHaveValue('u2');
  await expect(owner.locator('option:checked')).toHaveText('已不可用的负责人（请重新选择）');
});

test('编辑项目后台刷新后不携带新版本覆盖旧草稿', async ({ page }) => {
  await mockForms(page);
  let serverProject: Project = { ...project };
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/api/projects', (route) => route.fulfill({ json: [serverProject] }));
  await page.route('**/api/projects/p1', (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { ...serverProject, ...requests.at(-1), updatedAt: '2026-09-01T00:00:00.002Z' } });
  });

  await page.goto('/project-settings');
  await page.getByRole('button', { name: '编辑项目', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑项目', exact: true });
  const name = dialog.getByLabel('项目名称', { exact: true });
  await name.fill('尚未保存的项目草稿');

  serverProject = { ...serverProject, name: '后台更新的项目', status: 'planned', plannedStart: '2026-09-05', updatedAt: '2026-09-01T00:00:00.001Z' };
  await reconnect(page);
  await expect(page.locator('.project-settings-summary').getByText('后台更新的项目', { exact: true })).toBeVisible();
  await expect(name).toHaveValue('尚未保存的项目草稿');
  await expect(dialog.locator('.warning-banner')).toContainText('项目设置已在其他位置更新，当前草稿保持不变。');
  await expect(dialog.getByRole('button', { name: '保存修改', exact: true })).toBeDisabled();
  await dialog.locator('form').evaluate((form) => (form as HTMLFormElement).requestSubmit());
  expect(requests).toHaveLength(0);

  await dialog.getByRole('button', { name: '使用最新设置', exact: true }).click();
  await expect(name).toHaveValue('后台更新的项目');
  await expect(dialog.getByRole('combobox', { name: /项目状态/ })).toHaveValue('planned');
  await expect(dialog.getByLabel('计划开始', { exact: true })).toHaveValue('2026-09-05');
  await name.fill('核对后的项目名称');
  await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({ name: '核对后的项目名称', status: 'planned', plannedStart: '2026-09-05', expectedUpdatedAt: '2026-09-01T00:00:00.001Z' });
});

test('项目设置已落库但响应异常时核对完整项目草稿', async ({ page }) => {
  await mockForms(page);
  let serverProject: Project = { ...project };
  let requests = 0;
  await page.route('**/api/projects', (route) => route.fulfill({ json: [serverProject] }));
  await page.route('**/api/projects/p1', (route) => {
    requests += 1;
    const body = route.request().postDataJSON();
    serverProject = {
      ...serverProject,
      name: String(body.name).trim(), status: String(body.status),
      plannedStart: String(body.plannedStart || '') || null,
      plannedEnd: String(body.plannedEnd || '') || null,
      defaultTemplateId: String(body.defaultTemplateId || '') || null,
      updatedAt: '2026-09-01T00:00:00.001Z',
    };
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/project-settings');
  await page.getByRole('button', { name: '编辑项目', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '编辑项目', exact: true });
  await dialog.getByLabel('项目名称', { exact: true }).fill('核对后的项目');
  await chooseOption(dialog.getByRole('combobox', { name: /项目状态/ }), 'planned');
  await dialog.getByLabel('计划开始', { exact: true }).fill('2026-09-01');
  await dialog.getByLabel('计划完成', { exact: true }).fill('2026-09-30');
  await dialog.getByRole('button', { name: '保存修改', exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('已核对最新状态：项目设置已保存', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '核对后的项目', exact: true })).toBeVisible();
  expect(requests).toBe(1);
});

test('新建项目已落库但响应异常时核对本次新增项目', async ({ page }) => {
  await mockForms(page);
  let created: Project | undefined;
  let requests = 0;
  await page.route('**/api/projects', (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: created ? [project, created] : [project] });
    requests += 1;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    created = {
      id: 'p-created', name: String(body.name).trim(), status: String(body.status),
      plannedStart: String(body.plannedStart || '') || null, plannedEnd: String(body.plannedEnd || '') || null,
      defaultTemplateId: 't-created-default', isSample: false,
      createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
    };
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/projects');
  await expect(page.getByText('测试项目', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建项目', exact: true });
  await dialog.getByLabel('项目名称', { exact: true }).fill('  异常响应项目  ');
  await chooseOption(dialog.getByRole('combobox', { name: /项目状态/ }), 'planned');
  await dialog.getByLabel('计划开始', { exact: true }).fill('2026-09-07');
  await dialog.getByLabel('计划完成', { exact: true }).fill('2026-09-30');
  await dialog.getByRole('button', { name: '创建项目', exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('已核对最新状态：项目已创建', { exact: true })).toBeVisible();
  await expect(page.getByText('异常响应项目', { exact: true })).toBeVisible();
  expect(requests).toBe(1);
});

test('新建项目响应未知且列表核对失败时阻止重复创建', async ({ page }) => {
  await mockForms(page);
  let failReads = false;
  let requests = 0;
  await page.route('**/api/projects', (route) => {
    if (route.request().method() === 'POST') {
      requests += 1;
      failReads = true;
      return route.abort('connectionfailed');
    }
    if (failReads) return route.fulfill({ status: 503, json: { error: '项目列表暂时不可用' } });
    return route.fallback();
  });
  await page.goto('/projects');
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建项目', exact: true });
  await dialog.getByLabel('项目名称', { exact: true }).fill('待核对创建项目');
  await dialog.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(dialog).toContainText('操作结果暂时无法确认');
  await expect(dialog.getByRole('button', { name: '创建项目', exact: true })).toBeDisabled();
  await dialog.locator('form').dispatchEvent('submit');
  expect(requests).toBe(1);
  await dialog.getByRole('button',{name:'取消',exact:true}).click();await page.goto('/');await page.goto('/projects');
  await expect(page.getByRole('alert')).toContainText('项目创建结果待核对');await expect(page.getByRole('button',{name:'新建项目',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'核对项目创建',exact:true}).click();await expect(dialog.getByLabel('项目名称',{exact:true})).toHaveValue('待核对创建项目');await expect(dialog.getByRole('button',{name:'创建项目',exact:true})).toBeDisabled();
  await dialog.locator('form').dispatchEvent('submit');expect(requests).toBe(1);
  failReads=false;await dialog.getByRole('button',{name:'读取最新项目并继续',exact:true}).click();await expect(dialog).toContainText('未发现本次新增项目');await expect(dialog.getByRole('button',{name:'创建项目',exact:true})).toBeEnabled();await expect(page.getByText('项目创建结果待核对',{exact:false})).toHaveCount(0);
});

test('新建需求响应异常跨导航保留输入并核对本次创建', async ({ page }) => {
  await mockForms(page);
  let created: Requirement | undefined;
  let failReads = false;
  let requests = 0;
  await page.route('**/api/requirements?*', (route) => failReads?route.fulfill({status:503,json:{error:'需求列表暂时不可用'}}):route.fulfill({ json: created ? [created] : [] }));
  await page.route('**/api/requirements', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    requests += 1;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    created = {
      id: 'r-created', projectId: 'p1', projectName: '测试项目', templateId: 't1', templateName: '测试流程',
      title: String(body.title).trim(), ownerId: String(body.ownerId || '') || null, ownerName: '负责人',
      background: String(body.background || '').trim() || null,
      acceptanceCriteria: String(body.acceptanceCriteria || '').trim() || null,
      referenceUrl: String(body.referenceUrl || '').trim() || null, referenceLinks: body.referenceLinks as Requirement['referenceLinks'],
      status: 'not_started', plannedStart: null, plannedEnd: null, progress: 0, plannedProgress: 0, progressGap: 0,
      acceptedAt: null, acceptedByAccountId: null, version: 1, riskLevel: 'low', riskEvaluated: false,
      riskReason: '', priority: 'P2', createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
      workItems: [], delayed: false, highRisk: false, finishVariance: 0, durationVariance: 0, effectiveEnd: null,
    };
    failReads = true;
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/requirements');
  await page.getByRole('button', { name: '新建需求', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建需求', exact: true });
  await dialog.getByLabel('需求标题', { exact: true }).fill('  异常响应需求  ');
  await expect(dialog.getByRole('combobox', { name: '优先级', exact: true })).toHaveCount(0);
  await chooseOption(dialog.getByRole('combobox', { name: '需求负责人（可稍后指定）', exact: true }), 'u1');
  await dialog.getByRole('button', { name: /补充信息/ }).click();
  await dialog.getByLabel('需求背景', { exact: true }).fill('  需要核对  ');
  await dialog.getByLabel('完成标准', { exact: true }).fill('  只创建一次  ');
  await dialog.getByRole('region', { name: '编辑关联链接' }).getByRole('button', { name: '添加', exact: true }).click();
  await dialog.getByLabel('链接 1 地址', { exact: true }).fill('https://example.com/requirement');
  await dialog.getByRole('button', { name: '创建需求', exact: true }).click();

  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button',{name:'创建需求',exact:true})).toBeDisabled();
  await expect(page.getByText('已核对最新状态：需求已创建', { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel('需求标题',{exact:true})).toHaveValue('  异常响应需求  ');
  await expect(dialog).toContainText('创建结果待核对');
  await dialog.getByRole('button',{name:'取消',exact:true}).click();await page.goto('/');await page.goto('/requirements');
  await expect(dialog).toContainText('创建结果待核对');await expect(dialog.getByRole('button',{name:'创建需求',exact:true})).toBeDisabled();
  await expect(dialog.getByLabel('需求标题',{exact:true})).toHaveValue('  异常响应需求  ');await expect(dialog.getByRole('combobox',{name:'需求负责人（可稍后指定）',exact:true})).toHaveValue('u1');
  await dialog.getByRole('button',{name:/补充信息/}).click();await expect(dialog.locator('textarea[name="background"]')).toHaveValue('  需要核对  ');await expect(dialog.locator('textarea[name="acceptanceCriteria"]')).toHaveValue('  只创建一次  ');await expect(dialog.getByLabel('链接 1 地址',{exact:true})).toHaveValue('https://example.com/requirement');
  await dialog.locator('form').dispatchEvent('submit');expect(requests).toBe(1);
  failReads=false;await dialog.getByRole('button',{name:'读取最新需求并继续',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByText('已核对最新状态：需求已创建',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'新建需求',exact:true})).toBeEnabled();
  expect(requests).toBe(1);
});

test('编辑流程后台刷新后不携带新版本覆盖旧草稿', async ({ page }) => {
  await mockForms(page);
  let serverTemplate: WorkItemTemplate = structuredClone(template);
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/api/templates?*', (route) => route.fulfill({ json: [serverTemplate] }));
  await page.route('**/api/templates/t1', (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { ...serverTemplate, ...requests.at(-1), updatedAt: '2026-09-01T00:00:00.002Z' } });
  });

  await page.goto('/templates');
  await page.getByRole('button', { name: '编辑流程 测试流程', exact: true }).click();
  const dialog = page.locator('.template-flow-workspace');await openTemplateFields(page);
  const name = dialog.getByLabel('流程名称', { exact: true });
  const description = dialog.getByRole('textbox', { name: '设计说明', exact: true });
  await name.fill('尚未保存的流程草稿');

  serverTemplate = {
    ...serverTemplate,
    name: '后台更新的流程',
    description: '后台更新的说明',
    updatedAt: '2026-09-01T00:00:00.001Z',
    items: serverTemplate.items.map((item, index) => index === 0 ? { ...item, title: '后台更新的工作项', durationDays: 4 } : item),
  };
  await reconnect(page);
  await expect(name).toHaveValue('尚未保存的流程草稿');
  await expect(page.locator('.page-toolbar-status')).toContainText('草稿');
  await expect(page.getByRole('button', { name: '保存修改', exact: true })).toBeDisabled();
  expect(requests).toHaveLength(0);

  await dialog.getByRole('button', { name: '草稿状态', exact: true }).click();
  for (const choice of await dialog.getByRole('button', { name: '使用服务端', exact: true }).all()) await choice.click();
  await dialog.getByRole('button', { name: '已核对，使用最新版本预览', exact: true }).click();
  if (!await description.isVisible()) await headerAction(page,'流程属性');
  await expect(name).toHaveValue('后台更新的流程');
  await expect(description).toHaveValue('后台更新的说明');
  await name.fill('核对后的流程名称');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect.poll(() => requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ name: '核对后的流程名称', description: '后台更新的说明', expectedUpdatedAt: '2026-09-01T00:00:00.001Z' });
  expect((requests[0].items as Array<Record<string, unknown>>)[0]).toMatchObject({ title: '后台更新的工作项', durationDays: 4 });
});

test('流程设计已落库但响应异常时核对完整有序工作项', async ({ page }) => {
  await mockForms(page);
  let serverTemplate: WorkItemTemplate = structuredClone(template);
  let requests = 0;
  await page.route('**/api/templates?*', (route) => route.fulfill({ json: [serverTemplate] }));
  await page.route('**/api/projects/p1/dependency-changes/*', (route) => route.fulfill({ json: { status: 'applied', addedIds: { $template: 't1' } } }));
  await page.route('**/api/templates/t1', (route) => {
    requests += 1;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    serverTemplate = {
      ...serverTemplate,
      name: String(body.name).trim(),
      description: String(body.description).trim(),
      updatedAt: '2026-09-01T00:00:00.001Z',
      items: (body.items as Array<Record<string, unknown>>).map((item, index) => ({
        id: String(item.id), templateId: 't1', title: String(item.title).trim(), sortOrder: index,
        startOffsetDays: Number(item.startOffsetDays), durationDays: Number(item.durationDays),
        milestoneLabel: String(item.milestoneLabel || '').trim() || null,
      })),
    };
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/templates');
  await page.getByRole('button', { name: '编辑流程 测试流程', exact: true }).click();
  const dialog = page.locator('.template-flow-workspace');await openTemplateFields(page);
  await dialog.getByLabel('流程名称', { exact: true }).fill('核对后的流程');
  await dialog.getByRole('textbox', { name: '设计说明', exact: true }).fill('核对完整工作项');
  await openFirstTemplateItem(page);
  const firstInputs = page.getByRole('dialog').getByLabel('元素名称', {exact:true});
  await firstInputs.nth(0).fill('架构设计');
  await page.getByRole('dialog').getByLabel('预计工期', { exact: true }).fill('4');
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '保存修改', exact: true }).click();

  await dialog.getByRole('button', { name: '查询原批次并重试', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '查询原批次并重试', exact: true })).toHaveCount(0);
  await expect(page.getByText('已核对最新状态：流程设计已保存', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '页面层级' })).toContainText('核对后的流程');
  await expect(page).toHaveURL(/edit=t1/);
  expect(requests).toBe(1);
});

test('新建流程已落库但响应异常时核对本次新增流程', async ({ page }) => {
  await mockForms(page);
  let created: WorkItemTemplate | undefined;
  let requests = 0;
  await page.route('**/api/templates?*', (route) => route.fulfill({ json: created ? [template, created] : [template] }));
  await page.route('**/api/projects/p1/dependency-changes/*', (route) => route.fulfill({ json: { status: 'applied', addedIds: { $template: 't-created' } } }));
  await page.route('**/api/templates', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    requests += 1;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    created = {
      id: 't-created', projectId: 'p1', dependencyMode: body.dependencyMode as 'legacy' | 'dependencies', name: String(body.name).trim(), description: String(body.description).trim(),
      createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
      items: (body.items as Array<Record<string, unknown>>).map((item, index) => ({
        id: `ti-created-${index}`, templateId: 't-created', predecessorIds: ((item.predecessorKeys || []) as string[]).map(key => `ti-created-${(body.items as Array<Record<string, unknown>>).findIndex(candidate => candidate.clientKey === key)}`), title: String(item.title).trim(), sortOrder: index,
        startOffsetDays: Number(item.startOffsetDays), durationDays: Number(item.durationDays),
        milestoneLabel: String(item.milestoneLabel || '').trim() || null,
      })),
    };
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/templates');
  await expect(page.locator('.template-card .template-name-line')).toContainText('测试流程');
  await page.getByRole('button', { name: '新建流程', exact: true }).click();
  const dialog = page.locator('.template-flow-workspace');await openTemplateFields(page);
  await dialog.getByLabel('流程名称', { exact: true }).fill('  异常响应流程  ');
  await dialog.getByLabel('设计说明', { exact: true }).fill('  核对全部工作项  ');
  await openFirstTemplateItem(page);
  const firstInputs = page.getByRole('dialog').getByLabel('元素名称', {exact:true});
  await firstInputs.nth(0).fill('架构设计');
  await page.getByRole('dialog').getByLabel('预计工期', { exact: true }).fill('4');
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '保存修改', exact: true }).click();

  await dialog.getByRole('button', { name: '查询原批次并重试', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '查询原批次并重试', exact: true })).toHaveCount(0);
  await expect(page.getByText('已核对最新状态：流程已创建', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '页面层级' })).toContainText('异常响应流程');
  await expect(page).toHaveURL(/edit=t-created/);
  expect(requests).toBe(1);
});

for (const scenario of scenarios.filter(s=>s.kind!=='template') as Array<(typeof scenarios)[number]>) {
  // Template submission uses the page workspace tests below.
  test(`${scenario.name}提交锁定弹窗与草稿，失败保留并重试`, async ({ page }, testInfo) => {
    await mockForms(page);
    const requests: Array<Record<string, unknown>> = [];
    let releaseFailure!: () => void;
    let releaseSuccess!: () => void;
    const failing = new Promise<void>((resolve) => { releaseFailure = resolve; });
    const succeeding = new Promise<void>((resolve) => { releaseSuccess = resolve; });
    await page.route(`**${scenario.endpoint}`, async (route) => {
      if (route.request().method() !== scenario.method) return route.fallback();
      requests.push(route.request().postDataJSON());
      if (requests.length === 1) {
        await failing;
        return route.fulfill({ status: 409, json: { error: '暂时无法保存，请核对后重试' } });
      }
      await succeeding;
      return route.fulfill({ json: { id: 'saved', ...requests.at(-1) } });
    });
    try {
      await page.goto(scenario.path);
      await page.getByRole('button', { name: scenario.trigger, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: scenario.name, exact: true });
      await dialog.getByLabel(scenario.field, { exact: true }).fill('保留这份草稿');
      if (scenario.kind === 'project') {
        await dialog.getByLabel('计划开始', { exact: true }).fill('2020-01-02');
        await dialog.getByLabel('计划完成', { exact: true }).fill('2020-01-06');
      } else if (scenario.kind === 'requirement') {
        await expect(dialog.getByRole('combobox', { name: '优先级', exact: true })).toHaveCount(0);
        await dialog.getByRole('button', { name: /流程与排期/ }).click();
        await chooseOption(dialog.getByRole('combobox', { name: '流程设计', exact: true }), 't1');
        await dialog.getByLabel('计划开始', { exact: true }).fill('2020-01-02');
        await dialog.getByRole('button', { name: /补充信息/ }).click();
        await dialog.getByLabel('需求背景', { exact: true }).fill('不可丢失的背景');
      } else {
        await dialog.getByRole('textbox', { name: '设计说明', exact: true }).fill('不可丢失的设计说明');
        await dialog.getByLabel('工作项名称', {exact:true}).fill('设计修订');
      }
      const fields = dialog.locator('input,select,textarea');
      const draft = await fields.evaluateAll((elements) => elements.map((element) => (element as HTMLInputElement).value));
      await dialog.getByRole('button', { name: scenario.submit, exact: true }).click();
      await expect.poll(() => requests.length).toBe(1);
      expect(requests[0]).toMatchObject(scenario.kind === 'requirement'
        ? { title: '保留这份草稿', projectId: 'p1', plannedStart: '2020-01-02', templateId: 't1', background: '不可丢失的背景' }
        : scenario.kind === 'project'
          ? { name: '保留这份草稿', plannedStart: '2020-01-02', plannedEnd: '2020-01-06' }
          : { name: '保留这份草稿', description: '不可丢失的设计说明', ...(scenario.name === '新建流程' ? {projectId: 'p1'} : {}) });
      if (scenario.kind === 'template') expect((requests[0].items as Array<{ title: string }>)[0].title).toBe('设计修订');
      if (scenario.name === '编辑项目') expect(requests[0].expectedUpdatedAt).toBe(project.updatedAt);
      if (scenario.name === '编辑流程') expect(requests[0].expectedUpdatedAt).toBe(template.updatedAt);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeDisabled();
      for (const field of await fields.all()) await expect(field).toBeDisabled();
      await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeDisabled();
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      await dialog.locator('form').evaluate((form) => { (form as HTMLFormElement).requestSubmit(); (form as HTMLFormElement).requestSubmit(); });
      if (scenario.kind === 'template') {
        await expect(dialog.getByRole('button', { name: /^(添加工作项|接在后面)$/ })).toBeDisabled();
        await dialog.locator('.template-gantt-bar').first().dispatchEvent('pointerdown', { clientX: 100 });
        await page.evaluate(() => { window.dispatchEvent(new PointerEvent('pointermove', { clientX: 500 })); window.dispatchEvent(new PointerEvent('pointerup')); });
      }
      releaseFailure();
      await expect(dialog.getByRole('alert')).toHaveText('暂时无法保存，请核对后重试');
      expect(await fields.evaluateAll((elements) => elements.map((element) => (element as HTMLInputElement).value))).toEqual(draft);
      expect(requests).toHaveLength(1);
      for (const field of await fields.all()) await expect(field).toBeEnabled();

      if (scenario.name === '编辑流程' && testInfo.project.name === 'desktop-1080p') await page.screenshot({ path: testInfo.outputPath('form-review.png') });
      await dialog.getByRole('button', { name: scenario.submit, exact: true }).click();
      await expect.poll(() => requests.length).toBe(2);
      expect(requests[1]).toEqual(requests[0]);
      releaseSuccess();
      await expect(dialog).toHaveCount(0);
    } finally { releaseFailure(); releaseSuccess(); }
  });
}

for (const scenario of scenarios.filter(s=>s.kind==='template')) test(scenario.name+'工作区提交锁定、失败核对、草稿重试',async({page})=>{
  await mockForms(page);const requests:Array<Record<string,unknown>>=[];let release!:()=>void;
  const hold=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**'+scenario.endpoint,async route=>{
    if(route.request().method()!==scenario.method)return route.fallback();
    requests.push(route.request().postDataJSON());
    if(requests.length===1){await hold;return route.fulfill({status:409,json:{error:'暂时无法保存，请核对后重试'}});}
    const body=requests.at(-1)!;
    const savedId=scenario.name==='编辑流程'?'t1':'t-saved';
    return route.fulfill({json:{...template,...body,id:savedId,projectId:'p1',updatedAt:'2026-09-01T00:00:00.001Z',items:(body.items as Array<Record<string,unknown>>).map((item,index)=>({...item,id:String(item.id||`ti-saved-${index}`),templateId:savedId,predecessorIds:item.predecessorKeys||[]}))}});
  });
  try {
    await page.goto(scenario.path);await page.getByRole('button',{name:scenario.trigger,exact:true}).click();
    const editor=page.locator('.template-flow-workspace');await openTemplateFields(page);
    await editor.getByLabel('流程名称',{exact:true}).fill('保留这份草稿');
    await editor.getByRole('textbox',{name:'设计说明',exact:true}).fill('不可丢失的设计说明');
    await openFirstTemplateItem(page);
    const detail=page.getByRole('dialog');
    await detail.getByLabel('元素名称',{exact:true}).fill('设计修订');
    await page.keyboard.press('Control+s');await expect.poll(()=>requests.length).toBe(1);
    expect(requests[0]).toMatchObject({name:'保留这份草稿',description:'不可丢失的设计说明'});
    expect((requests[0].items as Array<{title:string}>)[0].title).toBe('设计修订');
    await expect(page.getByRole('button',{name:'保存修改',exact:true,includeHidden:true})).toBeDisabled();
    await expect(detail.getByLabel('元素名称',{exact:true})).toBeDisabled();
    await detail.getByRole('button',{name:'关闭',exact:true}).click();
    await page.getByRole('button',{name:'更多操作',exact:true}).click();await expect(page.getByRole('button',{name:'放弃修改',exact:true})).toBeDisabled();await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');await expect(editor).toBeVisible();
    release();await expect(editor.getByRole('alert')).toContainText('暂时无法保存');
    await openFirstTemplateItem(page);
    await expect(page.getByRole('dialog').getByLabel('元素名称',{exact:true})).toHaveValue('设计修订');
    await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
    await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'保存修改',exact:true}).click();
    await expect(editor).toBeVisible();
    await expect(page.getByText(scenario.name==='编辑流程'?'流程设计已保存':'流程已创建',{exact:true})).toBeVisible();
    await expect(page).toHaveURL(scenario.name==='编辑流程'?/edit=t1/:/edit=t-saved/);
    expect(requests).toHaveLength(2);
    const {batchId:firstBatch,...firstBody}=requests[0],{batchId:secondBatch,...secondBody}=requests[1];
    expect(secondBody).toEqual(firstBody);expect(secondBatch).not.toBe(firstBatch);
  } finally {release();}
});
