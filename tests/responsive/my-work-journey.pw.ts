import { test, expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import type { MyWork, Requirement } from '../../src/client/types';

async function post(request: APIRequestContext, url: string, data: Record<string, unknown>) {
  const response = await request.post(url, { data });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

async function fixture(page: Page, browser: Browser, baseURL: string) {
  await post(page.request, '/api/login', { username: 'admin', password: '41_xc7q0qOjo4Inw!' });
  const project = await post(page.request, '/api/projects', { name: '我的工作旅程' + Date.now() });
  const owner = await post(page.request, '/api/people', { projectId: project.id, name: '交付负责人' + Date.now() });
  const member = await post(page.request, '/api/people', { projectId: project.id, name: '协作执行人' + Date.now() });
  const r = await post(page.request, '/api/requirements', { projectId: project.id, title: '成员交付旅程', ownerId: owner.id, background: '交接班需要查看接口核对结果。', acceptanceCriteria: '刷新后仍可查看核对记录。' });
  await post(page.request, `/api/requirements/${r.id}/work-items`, { expectedVersion: r.version, title: '核对接口并交付', ownerId: owner.id, collaboratorIds: [member.id] });
  const detail = async () => (await (await page.request.get('/api/requirements/' + r.id)).json()) as Requirement;
  const work = (await detail()).workItems[0];
  const context = await browser.newContext({ baseURL, viewport: page.viewportSize() });
  try {
    const session = await post(context.request, '/api/login', { username: member.name, password: '888888' });
    await post(context.request, '/api/account/change-password', { currentPassword: '888888', newPassword: 'journey-member-password' });
    await context.addInitScript(({ accountId, projectId }) => localStorage.setItem('project-manage:selected-project:' + accountId, projectId), { accountId: session.accountId, projectId: project.id });
    const actor = await context.newPage();
    return { actor, context, detail, work, owner, member, myWork: async () => (await (await actor.request.get('/api/my-work')).json()) as MyWork };
  } catch (error) { await context.close(); throw error; }
}

for (const trigger of ['return', 'interval'] as const) test(`其他账号开工后我的工作自动更新：${trigger}`, async ({ page, browser, baseURL }) => {
  const { actor, context, detail, work } = await fixture(page, browser, baseURL!);
  try {
    await actor.clock.install();
    await actor.goto('/my-work');
    await expect(actor.getByRole('button', { name: '开始', exact: true })).toBeEnabled();
    await post(page.request, `/api/work-items/${work.id}/start`, { expectedVersion: work.version });
    expect((await detail()).workItems[0].status).toBe('in_progress');
    if (trigger === 'return') await actor.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    else await actor.clock.fastForward(61_000);
    await expect(actor.getByRole('button', { name: `为${work.title}更新进度`, exact: true })).toBeVisible();
    await expect(actor.getByRole('button', { name: '开始', exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});

test('普通协作成员经我的工作阅读需求、返回执行并完成，需求随工作完成', async ({ page, browser, baseURL }) => {
  const { actor, context, detail, work, myWork } = await fixture(page, browser, baseURL!);
  try {
    await actor.goto('/my-work');
    await actor.getByRole('button', { name: work.title, exact: true }).click();
    const itemDetail = actor.getByRole('dialog');
    await itemDetail.getByRole('tab', { name: '资料', exact: true }).click();
    const workspaceUrl = new URL(actor.url());
    await itemDetail.getByRole('button', { name: '需求说明', exact: true }).click();
    const introduction = itemDetail.getByRole('region', { name: '需求说明', exact: true });
    await expect(introduction.getByText('交接班需要查看接口核对结果。', { exact: true })).toBeVisible();
    await expect(introduction.getByText('刷新后仍可查看核对记录。', { exact: true })).toBeVisible();
    await itemDetail.getByRole('button', { name: '返回' + work.title, exact: true }).click();
    await expect(itemDetail.getByRole('tab', { name: '资料', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(actor).toHaveURL(url => ['projectId', 'workspaceView', 'scopeType', 'scopeId', 'detailId', 'detailTab'].every(key => url.searchParams.get(key) === workspaceUrl.searchParams.get(key)));
    await itemDetail.getByRole('button', { name: '关闭', exact: true }).click();
    await actor.getByRole('link', { name: '我的工作', exact: true }).click();
    const start = actor.getByRole('button', { name: '开始', exact: true });
    await expect(start).toBeEnabled();
    await start.click();
    await expect(actor.getByRole('button', { name: `为${work.title}更新进度`, exact: true })).toBeVisible();
    await actor.getByRole('button', { name: `为${work.title}更新进度`, exact: true }).click();
    const progress = actor.getByRole('dialog', { name: '更新工作项进度', exact: true });
    await progress.getByRole('spinbutton').fill('67');
    await expect(progress.getByRole('slider')).toHaveValue('67');
    await progress.getByLabel(/^说明/).fill('接口核对完成67%');
    await progress.getByRole('button', { name: '保存进展', exact: true }).click();
    await expect(progress).toHaveCount(0);
    expect((await detail()).progress).toBe(67);
    await actor.getByRole('button',{name:'完成',exact:true}).first().click();
    await actor.getByLabel('完成说明（可选）', { exact: true }).fill('对端核对完成，交付验证通过');
    await actor.getByRole('button', { name: '确认完成', exact: true }).click();
    await expect.poll(async () => (await detail()).status).toBe('completed');
    const completed = await detail();
    expect(completed).toMatchObject({ progress: 100, acceptedAt: null });
    expect((await myWork()).summary.completed).toBe(1);
    await actor.goto('/requirements/' + completed.id);
    await expect(actor.getByRole('button', { name: '确认验收', exact: true })).toHaveCount(0);
    await expect(actor.locator('.requirement-overview')).toContainText('已完成');
    await page.goto('/requirements/' + completed.id);
    await expect(page.getByRole('button', { name: '确认验收', exact: true })).toHaveCount(0);
    await actor.goto('/my-work?filter=completed');
    await expect(actor.locator('.requirement-gantt')).toContainText(work.title);
    expect((await myWork()).items[0].requirementStatus).toBe('completed');
  } finally { await context.close(); }
});

test('成员在我的工作查看已取消项，实际时间条和参与人保持与需求详情一致', async ({ page, browser, baseURL }) => {
  const { actor, context, detail, work, owner, member, myWork } = await fixture(page, browser, baseURL!);
  try {
    await post(actor.request, `/api/work-items/${work.id}/start`, { expectedVersion: work.version });
    await post(page.request, `/api/work-items/${work.id}/cancel`, { expectedVersion: (await detail()).workItems[0].version, reason: '取消这一项，保留执行事实' });
    await actor.goto('/my-work?filter=all');
    const personal = (await myWork()).items[0];
    expect(personal.cancelledAt).toBe((await detail()).workItems[0].cancelledAt);
    expect(personal.assigneeNames).toEqual([owner.name, member.name]);
    await expect(actor.locator('.gantt-date-actual.gantt-status-cancelled')).toHaveCount(1);
    await expect(actor.locator('.gantt-date-actual.gantt-status-cancelled')).toBeVisible();
    await actor.locator('.gantt-date-hitbox').focus();
    await expect(actor.locator('.gantt-popover-header')).toContainText(owner.name + '、' + member.name);
    await actor.keyboard.press('Escape');
    await expect(actor.locator('.gantt-date-actual.gantt-status-cancelled')).toHaveAttribute('data-end', personal.cancelledAt!);
    await expect(actor.getByRole('button', { name: '开始', exact: true })).toHaveCount(0);
    await expect(actor.getByRole('button', { name: '完成', exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});

test('我的工作取消项在矩阵与窄屏内显示',{tag:'@responsive'},async({page,browser,baseURL})=>{
  const {actor,context,detail,work}=await fixture(page,browser,baseURL!);
  try{
    await post(actor.request,`/api/work-items/${work.id}/start`,{expectedVersion:work.version});
    await post(page.request,`/api/work-items/${work.id}/cancel`,{expectedVersion:(await detail()).workItems[0].version,reason:'布局夹具'});
    await actor.goto('/my-work?filter=all');
    for(const width of [page.viewportSize()!.width,390]){
      await actor.setViewportSize({width,height:844});
      await expect(actor.locator('.gantt-date-actual.gantt-status-cancelled')).toBeVisible();
      await expect.poll(()=>actor.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  }finally{await context.close();}
});
