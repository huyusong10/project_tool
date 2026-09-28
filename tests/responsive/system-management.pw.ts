import {headerAction} from './topbar-helpers';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const response = await page.context().request.post('/api/login', {
    data: { username: 'admin', password: '41_xc7q0qOjo4Inw!' },
  });
  expect(response.ok()).toBe(true);
});

test('图片读取中不能抢先保存，恢复默认后迟到的图片不会覆盖选择', async ({ page }) => {
  await page.addInitScript(() => {
    const pending: Array<() => void> = [];
    const nativeRead = FileReader.prototype.readAsDataURL;
    const state = { completed: 0, release: () => pending.shift()?.() };
    Object.assign(window, { brandingReader: state });
    FileReader.prototype.readAsDataURL = function (file) {
      this.addEventListener('loadend', () => state.completed++, { once: true });
      pending.push(() => nativeRead.call(this, file));
    };
  });
  let branding: {systemName:string;shortName:string;logoUrl:string|null;updatedAt:string|null} = {systemName:'项目管理',shortName:'PM',logoUrl:null,updatedAt:null};
  await page.route('**/api/branding', route => route.fulfill({json:branding}));
  const writes:Array<Record<string,unknown>>=[];
  await page.route('**/api/system/branding', route => {
    const body=route.request().postDataJSON();writes.push(body);
    branding={systemName:body.systemName,shortName:body.shortName,logoUrl:body.logoDataUrl,updatedAt:'2026-09-17T12:00:00.000Z'};
    return route.fulfill({json:branding});
  });
  await page.goto('/system');
  const panel=page.locator('.system-branding-panel'),save=panel.getByRole('button',{name:'保存品牌设置',exact:true});
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
  await panel.locator('input[type=file]').setInputFiles({name:'pending.png',mimeType:'image/png',buffer:png});
  await expect.soft(save).toBeDisabled();
  await panel.getByRole('button',{name:'恢复默认值',exact:true}).click();
  await page.evaluate(()=>(window as unknown as {brandingReader:{release:()=>void}}).brandingReader.release());
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {brandingReader:{completed:number}}).brandingReader.completed)).toBe(1);
  await expect.soft(panel.locator('.system-branding-preview img')).toHaveAttribute('src','/project-management-logo.png');
  await expect(save).toBeEnabled();
  await panel.locator('input[type=file]').setInputFiles({name:'superseded.png',mimeType:'image/png',buffer:png});
  await panel.locator('input[type=file]').setInputFiles({name:'latest.png',mimeType:'image/png',buffer:png});
  await page.evaluate(()=>(window as unknown as {brandingReader:{release:()=>void}}).brandingReader.release());
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {brandingReader:{completed:number}}).brandingReader.completed)).toBe(2);
  await expect(save).toBeDisabled();
  await expect(panel.locator('.system-branding-preview img')).toHaveAttribute('src','/project-management-logo.png');
  await page.evaluate(()=>(window as unknown as {brandingReader:{release:()=>void}}).brandingReader.release());
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {brandingReader:{completed:number}}).brandingReader.completed)).toBe(3);
  await expect(panel.locator('.system-branding-preview img')).toHaveAttribute('src','data:image/png;base64,'+png.toString('base64'));
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(()=>writes.length).toBe(1);
  expect(writes[0].logoDataUrl).toBe('data:image/png;base64,'+png.toString('base64'));
  await expect(panel.getByText('品牌设置已保存')).toBeVisible();
  await panel.locator('input[type=file]').setInputFiles({name:'removed.png',mimeType:'image/png',buffer:png});
  await panel.getByRole('button',{name:'移除Logo',exact:true}).click();
  await page.evaluate(()=>(window as unknown as {brandingReader:{release:()=>void}}).brandingReader.release());
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {brandingReader:{completed:number}}).brandingReader.completed)).toBe(4);
  await expect(panel.locator('.system-branding-preview img')).toHaveAttribute('src','/project-management-logo.png');
  await expect(save).toBeEnabled();
});

test('system management focuses on health and data safety', async ({ page }) => {
  await page.goto('/system');
  await expect(page.getByRole('heading', { name: '系统管理', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'MCP Token', exact: true })).toHaveCount(0);
  await expect(page.getByText('平台治理', { exact: true })).toBeVisible();
  await expect(page.getByText('平台运维', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '立即备份' }).click();
  await expect(page.getByText(/备份已创建：/)).toBeVisible();
  await expect(page.locator('.system-backup-table tbody tr').first()).toBeVisible();

  await headerAction(page,'立即检查');
  await expect(page.getByText('数据库状态正常')).toBeVisible();

  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'MCP 接入', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'admin', exact: true })).toBeVisible();
  await expect(page.getByText('/mcp', { exact: false })).toBeVisible();
});

test('健康检查定位结果并区分检查中、请求失败和实际异常', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let state: 'pending' | 'failed' | 'abnormal' | 'normal' = 'pending';
  await page.route('**/api/system/database-check', async route => {
    if (state === 'pending') await pending;
    if (state === 'failed') return route.fulfill({status:503,json:{error:'数据库暂时忙，请重新检查'}});
    if (state === 'abnormal') return route.fulfill({json:{ok:false,message:'测试页结构异常',checkedAt:'2026-09-25T02:00:00.000Z',durationMs:12}});
    return route.continue();
  });
  const panel=page.getByRole('article',{name:'数据库健康检查',exact:true});
  try {
    await page.goto('/system');await headerAction(page,'立即检查');
    await expect(panel).toBeInViewport({ratio:1});await expect(panel).toBeFocused();
    await expect(panel).toContainText('正在检查数据库…');await expect(panel).not.toContainText('数据库状态正常');
    state='failed';release();await expect(panel).toContainText('本次检查未完成');await expect(panel).toContainText('数据库暂时忙，请重新检查');await expect(panel).not.toContainText('发现数据库异常');
    state='abnormal';await headerAction(page,'立即检查');await expect(panel).toContainText('发现数据库异常');await expect(panel).toContainText('测试页结构异常');
    await page.setViewportSize({width:390,height:844});
    state='normal';await headerAction(page,'立即检查');await expect(panel).toBeInViewport({ratio:1});await expect(panel).toContainText('数据库状态正常');
    await expect(panel).not.toContainText('测试页结构异常');await expect(panel).toContainText('检查时间');await expect(panel).toContainText('检查耗时');
    expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await page.reload();await expect(panel).toContainText('等待执行完整性检查');
  } finally {release();}
});

test('backup and integrity check allow only one request at a time', async ({ page }) => {
  let releaseBackup!: () => void;
  let releaseCheck!: () => void;
  const waitingBackup = new Promise<void>((resolve) => { releaseBackup = resolve; });
  const waitingCheck = new Promise<void>((resolve) => { releaseCheck = resolve; });
  let backupRequests = 0;
  let checkRequests = 0;
  await page.route('**/api/backups', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    backupRequests++;
    await waitingBackup;
    return route.fulfill({ json: { name: 'single-flight.db', size: 1024, createdAt: '2026-09-05T00:00:00.000Z' } });
  });
  await page.route('**/api/system/database-check', async (route) => {
    checkRequests++;
    await waitingCheck;
    return route.fulfill({ json: { ok: true, message: '数据库完整性检查通过', checkedAt: '2026-09-05T00:00:00.000Z', durationMs: 1 } });
  });

  try {
    await page.goto('/system');
    const backup = page.getByRole('button', { name: '立即备份', exact: true });
    await backup.evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect.poll(() => backupRequests).toBe(1);
    await expect(page.getByRole('button', { name: '正在备份…', exact: true })).toBeDisabled();
    releaseBackup();
    await expect(page.getByText('备份已创建：single-flight.db')).toBeVisible();

    await page.getByRole('button',{name:'更多操作',exact:true}).click();
    const check = page.getByRole('button', { name: '立即检查', exact: true });
    await check.evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect.poll(() => checkRequests).toBe(1);
    await page.getByRole('button',{name:'更多操作',exact:true}).click();
    await expect(page.getByRole('button', { name: '检查中…', exact: true })).toBeDisabled();
    releaseCheck();
    await expect(page.getByText('数据库状态正常')).toBeVisible();
  } finally {
    releaseBackup();
    releaseCheck();
  }
});

test('branding save locks the draft and duplicate submit', async ({ page }) => {
  let releaseSave!: () => void;
  const waitingSave = new Promise<void>((resolve) => { releaseSave = resolve; });
  let requests = 0;
  const payloads: Array<Record<string, unknown>> = [];
  await page.route('**/api/branding', (route) => route.fulfill({ json: { systemName: '项目管理', shortName: 'PM', logoUrl: null, updatedAt: null } }));
  await page.route('**/api/system/branding', async (route) => {
    requests++;
    const body = route.request().postDataJSON();
    payloads.push(body);
    await waitingSave;
    return route.fulfill({ json: { ...body, logoUrl: null, updatedAt: '2026-09-05T00:00:00.000Z' } });
  });

  try {
    await page.goto('/system');
    const systemName = page.getByLabel('系统名称', { exact: true });
    const shortName = page.getByLabel('系统简称', { exact: true });
    await systemName.fill('单航项目管理');
    await shortName.fill('单航');
    await page.getByRole('button', { name: '保存品牌设置', exact: true }).evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect.poll(() => requests).toBe(1);
    expect(payloads).toEqual([{ systemName: '单航项目管理', shortName: '单航', expectedUpdatedAt: null }]);
    await expect(systemName).toBeDisabled();
    await expect(shortName).toBeDisabled();
    await expect(page.getByRole('button', { name: '保存中…', exact: true })).toBeDisabled();
    releaseSave();
    await expect(page.getByText('品牌设置已保存', { exact: true })).toBeVisible();
  } finally { releaseSave(); }
});

test('branding refresh preserves drafts and late save cannot replace newer settings', async ({ page }) => {
  let current = { systemName: '品牌基线', shortName: '基线', logoUrl: null, updatedAt: '2026-09-05T00:00:00.000Z' };
  let reads = 0;
  let requestBody: Record<string, unknown> | undefined;
  let releaseSave!: () => void;
  const waitingSave = new Promise<void>((resolve) => { releaseSave = resolve; });
  await page.route('**/api/branding', (route) => {
    reads++;
    return route.fulfill({ json: current });
  });
  await page.route('**/api/system/branding', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requestBody = body;
    await waitingSave;
    return route.fulfill({ json: { systemName: body.systemName, shortName: body.shortName, logoUrl: null, updatedAt: '2026-09-05T00:00:00.002Z' } });
  });
  const reconnect = async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
  };

  try {
    await page.goto('/system');
    const systemName = page.getByLabel('系统名称', { exact: true });
    const shortName = page.getByLabel('系统简称', { exact: true });
    await expect(systemName).toHaveValue('品牌基线');
    await systemName.fill('尚未保存的品牌草稿');
    await shortName.fill('草稿');

    current = { systemName: '服务器更新一', shortName: '新一', logoUrl: null, updatedAt: '2026-09-05T00:00:00.001Z' };
    const firstReads = reads;
    await reconnect();
    await expect.poll(() => reads).toBeGreaterThan(firstReads);
    await expect(systemName).toHaveValue('尚未保存的品牌草稿');
    await expect(shortName).toHaveValue('草稿');
    await expect(page.locator('.system-branding-panel .warning-banner').filter({ hasText: '服务器上的品牌设置已经更新，当前草稿保持不变。' })).toBeVisible();
    await expect(page.getByRole('button', { name: '保存品牌设置', exact: true })).toBeDisabled();

    await page.getByRole('button', { name: '使用最新设置', exact: true }).click();
    await expect(systemName).toHaveValue('服务器更新一');
    await systemName.fill('本次保存的品牌');
    await shortName.fill('本次');
    await page.getByRole('button', { name: '保存品牌设置', exact: true }).click();
    await expect.poll(() => requestBody).toBeTruthy();
    expect(requestBody).toMatchObject({
      systemName: '本次保存的品牌', shortName: '本次', expectedUpdatedAt: '2026-09-05T00:00:00.001Z',
    });

    current = { systemName: '服务器更新三', shortName: '新三', logoUrl: null, updatedAt: '2026-09-05T00:00:00.003Z' };
    const secondReads = reads;
    await reconnect();
    await expect.poll(() => reads).toBeGreaterThan(secondReads);
    releaseSave();
    await expect(page.getByText('保存已完成，并已显示服务器最新设置', { exact: true })).toBeVisible();
    await expect(systemName).toHaveValue('服务器更新三');
    await expect(shortName).toHaveValue('新三');
    await expect(page.locator('.brand-name')).toHaveText('服务器更新三');
  } finally { releaseSave(); }
});

test('备份列表面板与分页保持有界布局',{tag:'@responsive'},async({page})=>{
  await page.goto('/system');
  await expect(page.locator('.system-backup-panel')).toBeVisible();
  const panel = page.locator('.system-backup-panel');
  const panelBox = await panel.boundingBox();
  expect(panelBox).not.toBeNull();
  expect(panelBox!.height).toBeGreaterThanOrEqual(200);
  expect(panelBox!.height).toBeLessThanOrEqual(621);
  const pagerBox = await panel.getByRole('navigation', { name: '备份列表分页' }).boundingBox();
  expect(pagerBox!.y + pagerBox!.height).toBeLessThanOrEqual(panelBox!.y + panelBox!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);

});
