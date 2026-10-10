import { expect, test, type Page } from '@playwright/test';
import type { Requirement } from '../../src/client/types';

const jiraUrl = (key: string) => 'https://ec-jira.jereh.cn/browse/' + key;
async function fixture(page: Page) {
  const post = async (url: string, data: object) => {
    const response = await page.request.post(url, { data });
    expect(response.ok(), await response.text()).toBe(true); return response.json();
  };
  await post('/api/login', { username: 'admin', password: '41_xc7q0qOjo4Inw!' });
  const project = await post('/api/projects', { name: 'JIRA 入口 ' + Date.now() });
  const owner = await post('/api/people', { projectId: project.id, name: '入口负责人 ' + Date.now() });
  let requirement: Requirement = await post('/api/requirements', { projectId: project.id, ownerId: owner.id, title: '用户管理与权限配置', referenceLinks: [
    { title: '需求', url: jiraUrl('DCIM-33') }, { title: '补充', url: jiraUrl('DCIM-34') },
  ] });
  const read = async () => (await (await page.request.get('/api/requirements/' + requirement.id)).json()) as Requirement;
  const inherited = await post('/api/requirements/' + requirement.id + '/work-items', { expectedVersion: requirement.version, title: '核对用户管理方案', ownerId: owner.id });
  requirement = await read();
  const own = await post('/api/requirements/' + requirement.id + '/work-items', { expectedVersion: requirement.version, title: '实现权限校验', ownerId: owner.id, referenceLinks: [{ title: '子任务', url: jiraUrl('DCIM-35') }] });
  await post('/api/requirements', { projectId: project.id, title: 'DCIM-99 只有编号没有链接' });
  return { post, project, owner, requirement, inherited, own, read,
    url: (view: string, detailId?: string) => '/?' + new URLSearchParams({ projectId: project.id, workspaceView: view, scopeType: 'requirement', scopeId: requirement.id, ...(detailId ? { detailId } : {}) }) };
}

for (const view of ['list', 'progress']) test(`${view} 按 Jira 编号找到工作，详情返回与刷新保留筛选`, async ({page}) => {
  const f=await fixture(page);
  await page.goto('/?'+new URLSearchParams({projectId:f.project.id,workspaceView:view,scopeType:'project',scopeId:f.project.id}));
  const search=page.getByRole('searchbox',{name:view==='list'?'筛选清单':'搜索名称或编号',exact:true});
  const work=page.getByRole('button',{name:f.own.title,exact:true});
  await search.fill('dcim-35');await expect(work).toBeVisible();
  await expect(page.getByRole('button',{name:f.requirement.title,exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:f.inherited.title,exact:true})).toHaveCount(0);
  await work.click();const detail=page.getByRole('dialog');
  await expect(detail.locator('header').first().getByRole('link',{name:'JIRA DCIM-35（引用），在新标签页打开',exact:true})).toBeVisible();
  await detail.getByRole('tab',{name:'资料',exact:true}).click();await page.reload();
  await expect(detail.getByRole('tab',{name:'资料',exact:true})).toHaveAttribute('aria-selected','true');
  await detail.getByRole('button',{name:'关闭',exact:true}).click();await expect(search).toHaveValue('dcim-35');await expect(work).toBeVisible();
  await search.fill('ＤＣＩＭ－３５');await expect(work).toBeVisible();
  await search.fill('DCIM-34');const inherited=page.getByRole('button',{name:f.inherited.title,exact:true});await expect(inherited).toBeVisible();
  await inherited.click();await expect(detail.getByRole('heading',{name:f.inherited.title,exact:true})).toBeVisible();
  expect(new URL(page.url()).searchParams.get('detailId')).toBe(f.inherited.id);
  await expect(detail.locator('header').first().getByRole('link',{name:'需求 JIRA DCIM-33（引用），在新标签页打开',exact:true})).toBeVisible();
  await detail.locator('header').first().getByRole('button',{name:'查看其余 1 个 JIRA 链接',exact:true}).click();
  await expect(page.getByRole('link',{name:'需求 JIRA DCIM-34（引用），在新标签页打开',exact:true})).toHaveAttribute('href',jiraUrl('DCIM-34'));
  await page.keyboard.press('Escape');await expect(detail.getByRole('heading',{name:f.inherited.title,exact:true})).toBeVisible();
  await detail.getByRole('button',{name:'关闭',exact:true}).click();await expect(search).toHaveValue('DCIM-34');
  await search.fill('DCIM-999');await expect(work).toHaveCount(0);await search.fill('');
});

for (const view of ['list', 'progress']) test(`${view} 的 JIRA 入口打开新页且保留上下文，详情切页和刷新保持入口`, async ({ page, context }) => {
  const f = await fixture(page);
  await context.route('https://ec-jira.jereh.cn/**', route => route.fulfill({ contentType: 'text/html', body: '<title>JIRA test destination</title>' }));
  await page.goto(f.url(view));
  const expand = page.getByRole('button', { name: '展开全部', exact: true });
  await expect(expand).toBeVisible(); if (await expand.isEnabled()) await expand.click();
  const work = page.getByRole('row').filter({ has: page.getByRole('button', { name: f.inherited.title, exact: true }) });
  const own = page.getByRole('row').filter({ has: page.getByRole('button', { name: f.own.title, exact: true }) });
  await expect(work.getByRole('link', { name: '需求 JIRA DCIM-33（引用），在新标签页打开', exact: true })).toBeVisible();
  await expect(own.getByRole('link', { name: 'JIRA DCIM-35（引用），在新标签页打开', exact: true })).toBeVisible();
  const localUrl = page.url();
  const popupPromise = context.waitForEvent('page');
  await work.getByRole('link').click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(jiraUrl('DCIM-33')); await popup.close();
  await expect(page).toHaveURL(localUrl); await expect(page.getByRole('dialog')).toHaveCount(0);
  await work.getByRole('button', { name: '查看其余 1 个 JIRA 链接' }).click();
  await expect(page.getByRole('link', { name: '需求 JIRA DCIM-34（引用），在新标签页打开', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await work.getByRole('button', { name: f.inherited.title, exact: true }).click();
  const dialog = page.getByRole('dialog');
  const entry = dialog.locator('header').first().getByRole('link', { name: '需求 JIRA DCIM-33（引用），在新标签页打开', exact: true });
  await expect(entry).toBeVisible();
  await dialog.getByRole('tab', { name: '资料', exact: true }).click(); await expect(entry).toBeVisible();
  await page.reload(); await expect(entry).toBeVisible();
  expect((await f.read()).workItems.find(w => w.id === f.own.id)?.jiraLinks?.[0].key).toBe('DCIM-35');
});

test('关系图和窄屏详情保持入口可见，不为只有标题编号的需求制造链接', async ({ page }, info) => {
  const f = await fixture(page);
  await page.goto(f.url('graph'));
  const card = page.locator('.react-flow__node').filter({ has: page.getByRole('button', { name: f.inherited.title, exact: true }) });
  await expect(card.getByRole('link', { name: '需求 JIRA DCIM-33（引用），在新标签页打开', exact: true })).toBeVisible();
  await expect.poll(() => card.locator('.dependency-card > small').evaluateAll(elements => elements.every(element => element.clientHeight >= element.scrollHeight))).toBe(true);
  await page.goto(f.url('list', f.requirement.id));
  await page.setViewportSize({ width: 390, height: 844 });
  const header = page.getByRole('dialog').locator('header').first();
  await expect(header.getByRole('heading', { name: f.requirement.title })).toBeVisible();
  await expect(header.getByRole('link', { name: 'JIRA DCIM-33（引用），在新标签页打开', exact: true })).toBeVisible();
  const bounds = await header.getByRole('link').boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath('jira-entry-mobile.png') });
  await page.goto('/?' + new URLSearchParams({ projectId: f.project.id, workspaceView: 'list' }));
  await page.getByRole('searchbox').fill('DCIM-99');
  await expect(page.getByRole('button', { name: 'DCIM-99 只有编号没有链接', exact: true })).toBeVisible();
  await expect(page.locator('a[href="' + jiraUrl('DCIM-99') + '"]')).toHaveCount(0);
});

test('普通成员从我的工作直接访问工作 JIRA 或所属需求 JIRA', async ({ page, browser, baseURL }) => {
  const f = await fixture(page);
  const actorContext = await browser.newContext({ baseURL, viewport: page.viewportSize() });
  try {
    const login = await actorContext.request.post('/api/login', { data: { username: f.owner.name, password: '888888' } }); expect(login.ok()).toBe(true);
    const change = await actorContext.request.post('/api/account/change-password', { data: { currentPassword: '888888', newPassword: 'jira-entry-member-password' } }); expect(change.ok()).toBe(true);
    const actor = await actorContext.newPage(); await actor.goto('/my-work');
    await expect(actor.getByRole('link', { name: '需求 JIRA DCIM-33（引用），在新标签页打开', exact: true })).toBeVisible();
    await expect(actor.getByRole('link', { name: 'JIRA DCIM-35（引用），在新标签页打开', exact: true })).toBeVisible();
    await actor.reload();
    await expect(actor.getByRole('link', { name: 'JIRA DCIM-35（引用），在新标签页打开', exact: true })).toBeVisible();
    await actor.goto('/?'+new URLSearchParams({projectId:f.project.id,workspaceView:'list',scopeType:'project',scopeId:f.project.id}));
    await actor.getByRole('searchbox',{name:'筛选清单',exact:true}).fill('DCIM-35');
    await actor.getByRole('button',{name:f.own.title,exact:true}).click();
    await expect(actor.getByRole('dialog').locator('header').first().getByRole('link',{name:'JIRA DCIM-35（引用），在新标签页打开',exact:true})).toBeVisible();
  } finally { await actorContext.close(); }
});
