import { expect, test, type APIRequestContext } from '@playwright/test';
import { addBusinessDays, addCalendarDays, todayIso } from '../../src/shared/domain';
import type { Requirement } from '../../src/client/types';

async function post(request: APIRequestContext, url: string, data: object) {
  const response = await request.post(url, { data });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

test('经理从并发分析定位同名工作，调整协作后返回原日期核对，直接执行需求仍可打开', async ({ page }) => {
  await post(page.request, '/api/login', { username: 'admin', password: '41_xc7q0qOjo4Inw!' });
  const project = await post(page.request, '/api/projects', { name: '并发处理旅程' + Date.now() });
  const person = await post(page.request, '/api/people', { projectId: project.id, name: '并发人员' + Date.now() });
  const other = await post(page.request, '/api/people', { projectId: project.id, name: '接手人员' + Date.now() });
  const date = addBusinessDays(todayIso(), 1), later = addBusinessDays(date, 9);
  const primary = await post(page.request, '/api/requirements', { projectId: project.id, title: '主责需求', ownerId: person.id });
  const collaborating = await post(page.request, '/api/requirements', { projectId: project.id, title: '协作需求', ownerId: other.id });
  const direct = await post(page.request, '/api/requirements', { projectId: project.id, title: '直接核对交付', ownerId: person.id, plannedStart: date, plannedEnd: later });
  for (const [requirement, ownerId, collaboratorIds] of [[primary, person.id, []], [collaborating, other.id, [person.id]]] as const) {
    await post(page.request, `/api/requirements/${requirement.id}/work-items`, { expectedVersion: requirement.version, title: '复核记录', ownerId, collaboratorIds, plannedStart: date, plannedEnd: date });
  }
  const read = async () => (await (await page.request.get('/api/requirements/' + collaborating.id)).json()) as Requirement;
  const workId = (await read()).workItems[0].id;
  await page.goto('/analytics?' + new URLSearchParams({ projectId: project.id }));
  await page.getByRole('link', { name: '查看人员工作安排', exact: true }).click();
  await page.getByRole('combobox', { name: '分析人员', exact: true }).selectOption(person.id);
  if (date > addCalendarDays(todayIso(), 6)) await page.getByRole('button', { name: '加载后续7天', exact: true }).click();
  await page.getByRole('button', { name: `${person.name} ${date} 3项工作`, exact: true }).click();
  const details = page.getByRole('dialog', { name: '人员工作明细', exact: true });
  await expect(details).toContainText(`${date} · 计划工作 · 3 项`);
  const workLink = details.getByRole('link', { name: /复核记录.*协作需求/ });
  await expect(workLink).toHaveAttribute('href', new RegExp('workItemId=' + workId));
  await workLink.click();
  const work = page.getByRole('dialog', { name: '复核记录', exact: true });
  await work.getByRole('tab', { name: '资料', exact: true }).click();
  await work.getByRole('button', { name: `协作人员：${person.name}，点击编辑`, exact: true }).click();
  await page.getByRole('checkbox', { name: new RegExp(person.name) }).uncheck();
  await work.getByRole('button', { name: '完成', exact: true }).click();
  await expect.poll(async () => (await read()).workItems[0].collaborators).toEqual([]);
  await page.goBack();
  await expect(details).toContainText(`${date} · 计划工作 · 2 项`);
  await expect(details.getByRole('link', { name: /协作需求/ })).toHaveCount(0);
  await page.reload();
  await expect(details).toContainText(`${date} · 计划工作 · 2 项`);
  await expect(page.getByRole('combobox', { name: '分析人员', exact: true })).toHaveValue(person.id);
  await details.getByRole('link', { name: direct.title, exact: true }).click();
  await expect(page.getByRole('dialog', { name: direct.title, exact: true }).getByRole('tablist', { name: '需求详情内容' })).toBeVisible();

  // A saved date beyond the first loaded week can be read again and recover from a transient failure.
  let failRead = true;
  await page.route('**/api/analytics/people-concurrency?**', route => {
    const params = new URL(route.request().url()).searchParams;
    return failRead && params.get('from') === later && params.get('to') === later
      ? route.fulfill({ status: 503, json: { error: '当天工作暂时不可用' } }) : route.continue();
  });
  await page.goto('/people?' + new URLSearchParams({ projectId: project.id, view: 'analysis', analysisPersonId: person.id, concurrencyPersonId: person.id, concurrencyDate: later }));
  await expect(details.getByText('工作明细加载失败', { exact: true })).toBeVisible();
  await expect(details.getByRole('link')).toHaveCount(0);
  failRead = false;
  await details.getByRole('button', { name: '重新读取', exact: true }).click();
  await expect(details).toContainText(`${later} · 计划工作 · 1 项`);
  await expect(details.getByRole('link', { name: direct.title, exact: true })).toBeVisible();
  await details.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page).not.toHaveURL(/concurrencyDate=/);
  await expect(page.getByRole('combobox', { name: '分析人员', exact: true })).toHaveValue(person.id);
});
