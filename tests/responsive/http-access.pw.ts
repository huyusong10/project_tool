import { test, expect } from '@playwright/test';
import { intakeExample } from '../../src/shared/intake';

// 普通 HTTP 域名保留真实的非安全上下文；不覆盖浏览器的 crypto API。
test.use({ launchOptions: { args: ['--host-resolver-rules=MAP project-manage.test 127.0.0.1', '--no-proxy-server'] } });

test('局域网 HTTP 可登录、恢复会话、保存流程、导入需求和恢复路径视口', async ({ page, baseURL }) => {
  const login = await page.request.post('/api/login', { data: { username: 'admin', password: '41_xc7q0qOjo4Inw!' } });
  expect(login.ok()).toBe(true);
  const session = await (await page.request.get('/api/session')).json();
  const projectResponse = await page.request.post('/api/projects', { data: { name: 'HTTP访问验证' + Date.now() } });
  expect(projectResponse.ok()).toBe(true);
  const project = await projectResponse.json();
  await page.addInitScript(({ account, id }) => localStorage.setItem(`project-manage:selected-project:${account}`, id), { account: session.accountId, id: project.id });

  const origin = new URL(baseURL!);
  origin.hostname = 'project-manage.test';
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin.href);
  expect(await page.evaluate(() => ({ secure: isSecureContext, uuid: typeof crypto.randomUUID }))).toEqual({ secure: false, uuid: 'undefined' });
  await expect(page.getByRole('heading', { name: '登录项目工作台', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '用户登录', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('用户名', { exact: true }).fill('admin');
  await dialog.getByLabel('密码', { exact: true }).fill('41_xc7q0qOjo4Inw!');
  await dialog.getByRole('button', { name: '用户登录', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(async () => (await (await fetch('/api/session')).json()).authenticated)).toBe(true);

  await page.goto(new URL('/templates?edit=new', origin).href);
  const ready = () => expect(page.locator('[data-layout-ready="true"]')).toBeVisible({ timeout: 20000 });
  await ready();
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await page.getByRole('button', { name: '流程属性', exact: true }).click();
  await page.getByLabel('流程名称', { exact: true }).fill('HTTP流程');
  await page.getByLabel('流程名称', { exact: true }).blur();
  await page.locator('.graph-auxiliary').getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('.react-flow__node .dependency-card').first().click();
  await page.getByLabel('新增后续', { exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await page.getByLabel('复制元素', { exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  await expect(page.locator('.graph-toolbar')).toContainText('草稿已保留');
  await page.reload();
  await ready();
  await expect(page.locator('.react-flow__node')).toHaveCount(3);
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/templates' && response.request().method() === 'POST');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  expect((await saved).ok()).toBe(true);
  const templates = await (await page.request.get('/api/templates?projectId=' + project.id)).json();
  expect(templates.find((template: { name: string }) => template.name === 'HTTP流程')?.items).toHaveLength(3);

  await page.goto(new URL('/requirements?intakeView=import', origin).href);
  await page.getByLabel('原始需求').fill(JSON.stringify(intakeExample));
  await page.getByRole('button', { name: '整理需求', exact: true }).click();
  await page.getByRole('button', { name: '拆分需求', exact: true }).click();
  await expect(page.getByLabel('导入需求标题')).toHaveCount(2);
  await page.getByLabel('合并需求到').last().selectOption({ label: '查询与详情' });
  await expect(page.getByLabel('导入需求标题')).toHaveCount(1);
  await page.getByRole('button', { name: '预览导入', exact: true }).click();
  await page.getByRole('button', { name: '保存需求', exact: true }).click();
  await expect(page.getByText('已保存 1 个需求', { exact: true })).toBeVisible();
  const requirements = await (await page.request.get('/api/requirements?projectId=' + project.id)).json();
  expect(requirements).toHaveLength(1);
  expect(requirements[0].workItems).toHaveLength(2);
  const viewportKey = `pm-graph-view:${session.accountId}:${project.id}:all:right:current`;
  await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ x: -100000, y: -100000, zoom: 1 })), viewportKey);
  await page.goto(new URL('/paths?pathScope=all', origin).href);
  await ready();
  await expect.poll(() => page.locator('.react-flow__node:not(.graph-node-hidden)').evaluateAll(nodes => {
    const canvas = document.querySelector('.dependency-canvas')!.getBoundingClientRect();
    return nodes.filter(node => {
      const box = node.getBoundingClientRect();
      return box.right > canvas.left && box.left < canvas.right && box.bottom > canvas.top && box.top < canvas.bottom;
    }).length;
  })).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
