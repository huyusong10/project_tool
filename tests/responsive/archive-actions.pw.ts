import { expect, test, type Page, type Route } from '@playwright/test';
import type { Archives } from '../../src/client/types';
import {graphFixture} from './graph-fixture';
import {chooseOption} from './select-helper';

const archivedRequirement = {
  id: 'r1', title: '历史需求', deletedAt: '2026-09-04T10:00:00.000Z',
  workItemCount: 2, progressCount: 3, linkedIssueCount: 0,
};
const archivedPerson = {
  id: 'u1', title: '历史成员', jobTitle: '测试工程师', deletedAt: '2026-09-04T09:00:00.000Z',
};

async function mockArchiveCenter(page: Page, content: Archives = { projects: [], requirements: [archivedRequirement], people: [], templates: [] }) {
  let cleared = false;
  let loadFailure = false;
  await page.route('**/api/**', async (route: Route) => {
    const pathname = new URL(route.request().url()).pathname;
    const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (pathname === '/api/branding') return json({ systemName: '项目管理', shortName: 'PM', logoUrl: null, updatedAt: null });
    if (pathname === '/api/session') return json({ authenticated: true, accountId: 'admin', username: 'admin', role: 'admin', globalRole: 'admin', personId: null, mustChangePassword: false, managedProjectIds: [] });
    if (pathname === '/api/projects') return json([]);
    if (pathname === '/api/archives') return loadFailure
      ? json({ error: '归档列表暂不可用' }, 503)
      : json(cleared ? { projects: [], requirements: [], people: [], templates: [] } : content);
    return json({});
  });
  return {
    clear: () => { cleared = true; },
    failLoad: () => { loadFailure = true; },
    recoverLoad: () => { loadFailure = false; },
  };
}

test('归档列表失败时显示错误并可重新加载', async ({ page }, _testInfo) => {

  const state = await mockArchiveCenter(page);
  state.failLoad();
  await page.goto('/archives');
  await expect(page.getByText('归档列表加载失败', { exact: true })).toBeVisible();
  await expect(page.getByText('归档列表暂不可用', { exact: true })).toBeVisible();
  await expect(page.getByText('没有符合条件的归档内容', { exact: true })).toHaveCount(0);
  state.recoverLoad();
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.getByText('历史需求', { exact: true })).toBeVisible();
});

test('归档恢复连点只提交一次，请求期间锁定当前操作', async ({ page }) => {
  const state = await mockArchiveCenter(page);
  let requests = 0;
  const payloads: Array<Record<string, unknown>> = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/requirements/r1/restore', async (route) => {
    requests++;
    payloads.push(route.request().postDataJSON());
    await pending;
    if (requests > 1) return route.fulfill({ status: 404, json: { error: '归档需求不存在' } });
    state.clear();
    return route.fulfill({ json: { id: 'r1', title: '历史需求', version: 4 } });
  });
  try {
    await page.goto('/archives');
    const restore = page.getByRole('button', { name: '恢复' });
    await restore.dblclick();
    await expect.poll(() => requests).toBe(1);
    expect(payloads).toEqual([{ expectedDeletedAt: archivedRequirement.deletedAt }]);
    await expect(restore).toBeDisabled();
    await expect(restore).toHaveAttribute('aria-busy', 'true');
    release();
    await expect(restore).toHaveCount(0);
    await expect(page.getByText('归档需求不存在')).toHaveCount(0);
  } finally { release(); }
});

test('归档恢复已落库但响应异常时重读列表并移除旧归档项', async ({ page }) => {
  const state = await mockArchiveCenter(page);
  let requests = 0;
  await page.route('**/api/requirements/r1/restore', (route) => {
    requests += 1;
    state.clear();
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/archives');
  await page.getByRole('button', { name: '恢复', exact: true }).click();
  await expect(page.getByText('历史需求', { exact: true })).toHaveCount(0);
  await expect(page.getByText('已核对最新状态：内容已移出归档列表', { exact: true })).toBeVisible();
  expect(requests).toBe(1);
});

test('归档恢复响应未知且列表回读失败时锁定旧操作', async ({ page }) => {
  const state = await mockArchiveCenter(page);
  let requests = 0;
  await page.route('**/api/requirements/r1/restore', (route) => {
    requests += 1;
    state.clear();
    state.failLoad();
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/archives');
  let restore = page.getByRole('button', { name: '恢复', exact: true });
  await restore.click();
  await expect(page.getByRole('alert')).toContainText('归档恢复结果待核对');
  await expect(restore).toBeDisabled();
  await restore.evaluate((button) => {
    (button as HTMLButtonElement).disabled = false;
    (button as HTMLButtonElement).click();
  });
  await page.waitForTimeout(100);
  expect(requests).toBe(1);

  await page.getByRole('link', { name: '项目中心', exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/archives$/);
  restore = page.getByRole('button', { name: '恢复', exact: true });
  await expect(page.getByRole('alert')).toContainText('归档恢复结果待核对');
  await expect(restore).toBeDisabled();
  await restore.evaluate((button) => {
    (button as HTMLButtonElement).disabled = false;
    (button as HTMLButtonElement).click();
  });
  await page.waitForTimeout(100);
  expect(requests).toBe(1);

  state.recoverLoad();
  await page.getByRole('button', { name: '重新加载归档', exact: true }).click();
  await expect(page.getByText('历史需求', { exact: true })).toHaveCount(0);
});

test('需求永久删除连点只提交一次', async ({ page }) => {
  const state = await mockArchiveCenter(page);
  let requests = 0;
  const payloads: unknown[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/archives/requirements/r1', async (route) => {
    requests++;
    payloads.push(route.request().postDataJSON());
    await pending;
    if (requests > 1) return route.fulfill({ status: 404, json: { error: '归档需求不存在' } });
    state.clear();
    return route.fulfill({ json: { ok: true } });
  });
  try {
    await page.goto('/archives');
    await page.locator('tr').filter({ hasText: '历史需求' }).getByRole('button', { name: '删除' }).click();
    const dialog = page.getByRole('dialog', { name: '永久删除需求' });
    await dialog.getByRole('textbox').fill('历史需求');
    const confirm = dialog.getByRole('button', { name: '永久删除' });
    await confirm.dblclick();
    await expect.poll(() => requests).toBe(1);
    expect(payloads).toEqual([{ confirmName: '历史需求', expectedDeletedAt: archivedRequirement.deletedAt }]);
    await expect(dialog.getByRole('button', { name: '处理中…', exact: true })).toBeDisabled();
    release();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('归档需求不存在')).toHaveCount(0);
  } finally { release(); }
});

test('需求永久删除提交同一事件周期内不能被 Escape 关闭', async ({ page }) => {
  const state = await mockArchiveCenter(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/archives/requirements/r1', async (route) => {
    await pending;
    state.clear();
    return route.fulfill({ json: { ok: true } });
  });
  try {
    await page.goto('/archives');
    await page.locator('tr').filter({ hasText: '历史需求' }).getByRole('button', { name: '删除' }).click();
    const dialog = page.getByRole('dialog', { name: '永久删除需求' });
    await dialog.getByRole('textbox').fill('历史需求');
    await dialog.getByRole('button', { name: '永久删除' }).evaluate((button) => {
      (button as HTMLButtonElement).click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await expect(dialog).toBeVisible();
    release();
    await expect(dialog).toHaveCount(0);
  } finally { release(); }
});

test('需求永久删除失败后保留名称并允许重试', async ({ page }) => {
  const state = await mockArchiveCenter(page);
  let requests = 0;
  await page.route('**/api/archives/requirements/r1', async (route) => {
    requests++;
    if (requests === 1) return route.fulfill({ status: 500, json: { error: '删除暂时失败' } });
    state.clear();
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/archives');
  await page.locator('tr').filter({ hasText: '历史需求' }).getByRole('button', { name: '删除' }).click();
  const dialog = page.getByRole('dialog', { name: '永久删除需求' });
  const input = dialog.getByRole('textbox');
  await input.fill('历史需求');
  await dialog.getByRole('button', { name: '永久删除' }).click();
  await expect(dialog.getByText('删除暂时失败')).toBeVisible();
  await expect(input).toHaveValue('历史需求');
  await expect(dialog.getByRole('button', { name: '永久删除' })).toBeEnabled();
  await dialog.getByRole('button', { name: '永久删除' }).click();
  await expect(dialog).toHaveCount(0);
  expect(requests).toBe(2);
});

test('永久删除后响应异常且目标离开归档时停止危险重试', async ({ page }) => {
  const state = await mockArchiveCenter(page);
  let requests = 0;
  await page.route('**/api/archives/requirements/r1', (route) => {
    requests += 1;
    state.clear();
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'deleted' });
  });

  await page.goto('/archives');
  await page.locator('tr').filter({ hasText: '历史需求' }).getByRole('button', { name: '删除', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '永久删除需求', exact: true });
  await dialog.getByRole('textbox').fill('历史需求');
  await dialog.getByRole('button', { name: '永久删除', exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('已核对最新状态：内容已不在归档列表，请到对应业务页面确认', { exact: true })).toBeVisible();
  await expect(page.getByText('历史需求', { exact: true })).toHaveCount(0);
  expect(requests).toBe(1);
});

test('永久删除响应未知且列表回读失败时锁定旧确认', async ({ page }) => {
  const state = await mockArchiveCenter(page);
  let requests = 0;
  await page.route('**/api/archives/requirements/r1', (route) => {
    requests += 1;
    state.clear();
    state.failLoad();
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'deleted' });
  });

  await page.goto('/archives');
  await page.locator('tr').filter({ hasText: '历史需求' }).getByRole('button', { name: '删除', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '永久删除需求', exact: true });
  await dialog.getByRole('textbox').fill('历史需求');
  await dialog.getByRole('button', { name: '永久删除', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('永久删除结果待核对');
  await expect(dialog.getByRole('button', { name: '永久删除', exact: true })).toBeDisabled();
  await dialog.locator('form').evaluate((form) => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(100);
  expect(requests).toBe(1);

  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('link', { name: '项目中心', exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/archives$/);
  await expect(page.getByRole('alert')).toContainText('永久删除结果待核对');
  await expect(page.locator('tr').filter({ hasText: '历史需求' }).getByRole('button', { name: '删除', exact: true })).toBeDisabled();
  expect(requests).toBe(1);

  state.recoverLoad();
  await page.getByRole('button', { name: '重新加载归档', exact: true }).click();
  await expect(page.getByText('历史需求', { exact: true })).toHaveCount(0);
});

test('人员永久删除连点只提交一次', async ({ page }) => {
  const state = await mockArchiveCenter(page, { projects: [], requirements: [], people: [archivedPerson], templates: [] });
  let requests = 0;
  const payloads: unknown[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/archives/people/u1', async (route) => {
    requests++;
    payloads.push(route.request().postDataJSON());
    await pending;
    if (requests > 1) return route.fulfill({ status: 404, json: { error: '归档人员不存在' } });
    state.clear();
    return route.fulfill({ json: { ok: true } });
  });
  try {
    await page.goto('/archives');
    await page.locator('tr').filter({ hasText: '历史成员' }).getByRole('button', { name: '删除' }).click();
    const dialog = page.getByRole('dialog', { name: '永久删除归档内容' });
    const confirm = dialog.getByRole('button', { name: '永久删除' });
    await confirm.dblclick();
    await expect.poll(() => requests).toBe(1);
    expect(payloads).toEqual([{ expectedDeletedAt: archivedPerson.deletedAt }]);
    await expect(dialog.getByRole('button', { name: '删除中…', exact: true })).toBeDisabled();
    release();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('归档人员不存在')).toHaveCount(0);
  } finally { release(); }
});

test('跨项目同名归档在筛选、删除确认和恢复时保留归属',async({page},info)=>{
  const fixtures=[];const suffix=Date.now();
  for(const region of ['南区机房集成','北区机房集成']){
    const fixture=await graphFixture(page,false);
    const renamed=await page.request.patch('/api/projects/'+fixture.project.id,{data:{name:region+suffix,expectedUpdatedAt:fixture.project.updatedAt}});expect(renamed.ok(),await renamed.text()).toBe(true);fixture.project=await renamed.json();
    const cancelled=await page.request.post('/api/requirements/'+fixture.a.id+'/cancel',{data:{expectedVersion:fixture.a.version,reason:'归档同名来源验证'}});expect(cancelled.ok(),await cancelled.text()).toBe(true);fixture.a=await cancelled.json();
    const archiveRequirement=await page.request.delete('/api/requirements/'+fixture.a.id,{data:{expectedVersion:fixture.a.version}});expect(archiveRequirement.ok(),await archiveRequirement.text()).toBe(true);
    const templates=await(await page.request.get('/api/templates?projectId='+fixture.project.id)).json();const template=templates.find((item:{id:string})=>item.id===fixture.a.templateId);
    const archiveTemplate=await page.request.delete('/api/templates/'+template.id,{data:{expectedUpdatedAt:template.updatedAt}});expect(archiveTemplate.ok(),await archiveTemplate.text()).toBe(true);
    fixtures.push({...fixture,template});
  }
  const [south,north]=fixtures;
  const archives=async(projectId?:string)=>await(await page.request.get('/api/archives'+(projectId?'?projectId='+projectId:''))).json() as Archives;
  const before=await archives(),northBefore=await archives(north.project.id),northFacts=await(await page.request.get('/api/requirements/'+north.b.id)).json();
  await page.goto('/archives?q='+suffix);await expect(page.locator('.archive-table tbody tr')).toHaveCount(4);
  await expect(page.locator('.archive-table')).toContainText(south.project.name);await expect(page.locator('.archive-table')).toContainText(north.project.name);
  for(const fixture of fixtures){for(const entity of ['requirements','templates'] as const){const id=entity==='requirements'?fixture.a.id:fixture.template.id;expect(before[entity].find(item=>item.id===id)).toMatchObject({projectName:fixture.project.name});}}
  const writes:string[]=[];page.on('request',request=>{if(request.url().includes('/api/')&&!['GET','HEAD'].includes(request.method()))writes.push(request.method()+' '+new URL(request.url()).pathname);});
  const search=page.locator('.archive-toolbar').getByRole('searchbox'),type=page.locator('.archive-toolbar').getByRole('combobox');
  await search.fill(south.project.name);await expect(page.locator('.archive-table tbody tr')).toHaveCount(2);
  for(const entity of ['requirements','templates'] as const){
    await chooseOption(type,entity);const row=page.locator('.archive-table tbody tr');await expect(row).toHaveCount(1);await expect(row).toContainText(south.project.name);
    await row.getByRole('button',{name:'删除',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog).toContainText(south.project.name);
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:info.outputPath('archive-project-'+entity+'-390.png'),animations:'disabled'});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await dialog.getByRole('button',{name:'取消',exact:true}).click();await row.getByRole('button',{name:'恢复',exact:true}).click();await expect(row).toHaveCount(0);
  }
  const after=await archives();expect(after.requirements).toEqual(before.requirements.filter(item=>item.id!==south.a.id));expect(after.templates).toEqual(before.templates.filter(item=>item.id!==south.template.id));
  expect(await archives(north.project.id)).toEqual(northBefore);
  expect((await archives(south.project.id)).requirements).toEqual([]);expect((await archives(south.project.id)).templates).toEqual([]);
  expect(await(await page.request.get('/api/requirements/'+north.b.id)).json()).toEqual(northFacts);
  expect(writes).toEqual(['POST /api/requirements/'+south.a.id+'/restore','POST /api/templates/'+south.template.id+'/restore']);
  await search.fill(String(suffix));await chooseOption(type,'all');await page.reload();await expect(page.locator('.archive-table tbody tr')).toHaveCount(2);await expect(page.locator('.archive-table')).toContainText(north.project.name);
});

