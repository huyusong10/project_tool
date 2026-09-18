import { expect, test, type Page, type Route } from '@playwright/test';

const authenticatedSession = { authenticated: true, accountId: 'admin', username: 'admin', role: 'admin', globalRole: 'admin', personId: null, mustChangePassword: false, managedProjectIds: [] };

async function mockShell(page: Page, session: Record<string, unknown> = authenticatedSession, lastRestore: Record<string, unknown> | null = null) {
  await page.route('**/api/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const json = (value: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
    if (url.pathname === '/api/branding') return json({ systemName: '项目管理', shortName: 'PM', logoUrl: null, updatedAt: null });
    if (url.pathname === '/api/session') return json(session);
    if (url.pathname === '/api/projects') return json([]);
    if (url.pathname === '/api/people') return json([]);
    if (url.pathname === '/api/accounts') return json([]);
    if (url.pathname === '/api/tokens') return json([]);
    if (url.pathname === '/api/system/overview') return json({
      status: 'ok',
      service: { version: '1.0.0', startedAt: '2026-09-05T00:00:00.000Z', uptimeSeconds: 300, environment: 'test', timezone: 'Asia/Shanghai', host: '127.0.0.1', port: 3211, protocol: 'http' },
      database: { path: 'test.db', backupDirectory: 'backups', mainSizeBytes: 1024, walSizeBytes: 0, shmSizeBytes: 0, totalSizeBytes: 1024, journalMode: 'wal' },
      backups: { count: 1, totalSizeBytes: 1024, lastCreatedAt: '2026-09-05T00:00:00.000Z', overdue: false, retentionDays: 30, maxCount: 30, nextScheduledAt: '2026-09-06T02:00:00.000Z' },
      lastRestore,
    });
    if (url.pathname === '/api/backups') return json([{ name: 'backup-20260905.db', size: 1024, createdAt: '2026-09-05T00:00:00.000Z', fingerprint: 'a'.repeat(64) }]);
    return json({});
  });
}

test('创建 Token 同周期重复提交与 Escape 只执行一次且不关闭窗口', async ({ page }) => {
  await mockShell(page);
  let requests = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/tokens', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    requests++;
    await pending;
    return route.fulfill({ json: { id: `t${requests}`, name: 'Codex', prefix: '1234567890', token: 'pm_1234567890_secret', expiresAt: '2026-12-04T00:00:00.000Z', createdAt: '2026-09-05T00:00:00.000Z' } });
  });
  try {
    await page.goto('/settings');
    await page.getByRole('button', { name: '创建第一个 Token' }).click();
    const dialog = page.getByRole('dialog', { name: '创建 MCP Token' });
    await dialog.getByLabel('Token 名称').fill('Codex');
    await dialog.getByRole('button', { name: '创建 Token' }).evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await expect.poll(() => requests).toBe(1);
    await expect(dialog).toBeVisible();
    release();
    await expect(dialog.getByText('Token 已创建，只显示这一次')).toBeVisible();
  } finally { release(); }
});

test('创建 Token 结果未知时必须核对列表，不能直接生成第二个凭据', async ({ page }) => {
  await mockShell(page);
  let requests = 0;
  await page.route('**/api/tokens', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    requests++;
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>invalid token response</html>' });
  });
  await page.goto('/settings');
  await page.getByRole('button', { name: '创建第一个 Token', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '创建 MCP Token', exact: true });
  await dialog.getByLabel('Token 名称', { exact: true }).fill('结果未知的 Token');
  const create = dialog.getByRole('button', { name: '创建 Token', exact: true });
  await create.click();
  await expect(dialog).toContainText('Token 可能已经创建，但密钥无法再次读取');
  await expect(create).toBeDisabled();
  await dialog.locator('form').evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(requests).toBe(1);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.reload();
  const recheckNotice = page.locator('.personal-mcp-panel .warning-banner').filter({ hasText: 'Token 操作结果需要核对，创建和撤销暂不可用。' });
  await expect(recheckNotice).toBeVisible();
  await expect(page.getByRole('button', { name: '创建第一个 Token', exact: true })).toBeDisabled();
  await recheckNotice.getByRole('button', { name: '重新读取 Token 列表', exact: true }).click();
  await expect(recheckNotice).toHaveCount(0);
  await expect(dialog).toHaveCount(0);
});

test('撤销 Token 结果未知后关闭窗口仍锁定旧列表，重读后才允许继续操作', async ({ page }) => {
  await mockShell(page);
  let active = true;
  let revokeRequests = 0;
  const token = {
    id: 't1', name: '办公电脑', prefix: '1234567890', accountId: 'admin', expiresAt: null,
    lastUsedAt: null, revokedAt: null, createdAt: '2026-09-05T00:00:00.000Z',
  };
  await page.route('**/api/tokens/t1', (route) => {
    revokeRequests++;
    active = false;
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>invalid revoke response</html>' });
  });
  await page.route('**/api/tokens', (route) => route.request().method() === 'GET'
    ? route.fulfill({ json: active ? [token] : [] })
    : route.fallback());

  await page.goto('/settings');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '撤销 MCP Token', exact: true });
  await dialog.getByRole('button', { name: '确认撤销', exact: true }).click();
  await expect(dialog).toContainText('撤销结果需要核对');
  await expect(dialog.getByRole('button', { name: '确认撤销', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.reload();

  const recheckNotice = page.locator('.personal-mcp-panel .warning-banner').filter({ hasText: 'Token 操作结果需要核对，创建和撤销暂不可用。' });
  await expect(recheckNotice).toBeVisible();
  const create = page.getByRole('button', { name: '创建第一个 Token', exact: true });
  await expect(create).toBeDisabled();
  await create.evaluate((button) => (button as HTMLButtonElement).click());
  await expect(page.getByRole('dialog', { name: '创建 MCP Token', exact: true })).toHaveCount(0);
  expect(revokeRequests).toBe(1);

  await page.getByRole('button', { name: '重新读取 Token 列表', exact: true }).click();
  await expect(recheckNotice).toHaveCount(0);
  await expect(create).toBeEnabled();
});

test('撤销 Token 已落库但响应异常时核对撤销时间并解除锁定', async ({ page }) => {
  await mockShell(page);
  let revokeRequests = 0;
  let token = {
    id: 't1', name: '办公电脑', prefix: '1234567890', accountId: 'admin', expiresAt: null,
    lastUsedAt: null, revokedAt: null as string | null, createdAt: '2026-09-05T00:00:00.000Z',
  };
  const sibling = { ...token, id: 't2', prefix: 'abcdef1234' };
  await page.route('**/api/tokens/t1', (route) => {
    revokeRequests++;
    token = { ...token, revokedAt: '2026-09-05T00:00:00.001Z' };
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>invalid revoke response</html>' });
  });
  await page.route('**/api/tokens', (route) => route.request().method() === 'GET'
    ? route.fulfill({ json: [token, sibling] })
    : route.fallback());

  await page.goto('/settings');
  const targetRow = page.getByRole('row').filter({ hasText: 'pm_1234567890_…' });
  await targetRow.getByRole('button', { name: '撤销', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '撤销 MCP Token', exact: true });
  await expect(dialog).toContainText('pm_1234567890_…');
  await expect(dialog).not.toContainText('pm_abcdef1234_…');
  await dialog.getByRole('button', { name: '确认撤销', exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('已撤销', { exact: true })).toBeVisible();
  await expect(page.locator('.personal-mcp-panel .warning-banner')).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'pm_abcdef1234_…' }).getByRole('button', { name: '撤销', exact: true })).toBeEnabled();
  await expect(page.getByText('1 个有效 Token', { exact: true })).toBeVisible();
  expect(revokeRequests).toBe(1);
});

test('新增人员同周期重复提交与 Escape 只执行一次且不关闭窗口', async ({ page }) => {
  await mockShell(page);
  let requests = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/people', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    requests++;
    await pending;
    return route.fulfill({ json: { id: `u${requests}`, name: '新同事', jobTitle: '工程师', active: 1, username: '新同事', accountStatus: 'active', createdAt: '2026-09-05', updatedAt: '2026-09-05' } });
  });
  try {
    await page.goto('/resources');
    await page.getByRole('button', { name: '新增人员', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '新增人员' });
    await dialog.getByLabel('姓名').fill('新同事');
    await dialog.getByRole('button', { name: '新增人员', exact: true }).evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await expect.poll(() => requests).toBe(1);
    await expect(dialog).toBeVisible();
    release();
    await expect(dialog).toHaveCount(0);
  } finally { release(); }
});

test('新增人员已落库但响应异常时核对本次新增人员', async ({ page }) => {
  await mockShell(page);
  let created: Record<string, unknown> | undefined;
  let requests = 0;
  await page.route('**/api/people', (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: created ? [created] : [] });
    requests += 1;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    created = {
      id: 'u-created', name: String(body.name).trim(), jobTitle: String(body.jobTitle).trim() || null,
      active: 1, projectRole: 'member', username: 'new-user', accountStatus: 'active', accountDeletedAt: null,
      createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
    };
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/resources');
  await expect(page.getByText('没有符合条件的人员', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新增人员', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新增人员', exact: true });
  await dialog.getByLabel('姓名', { exact: true }).fill('  新增异常同事  ');
  await dialog.getByLabel('岗位', { exact: true }).fill('  架构师  ');
  await dialog.getByRole('button', { name: '新增人员', exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('已核对最新状态：人员和账号已创建', { exact: true })).toBeVisible();
  await expect(page.getByText('新增异常同事', { exact: true })).toBeVisible();
  expect(requests).toBe(1);
});

test('新增人员响应未知且人员回读失败时关闭弹窗并跨导航锁定原草稿', async ({ page }) => {
  await mockShell(page);
  let created: Record<string, unknown> | undefined;
  let failReads = false;
  let requests = 0;
  await page.route('**/api/people', (route) => {
    if (route.request().method() !== 'POST') {
      return failReads
        ? route.fulfill({ status: 503, json: { error: '人员列表读取失败' } })
        : route.fulfill({ json: created ? [created] : [] });
    }
    requests += 1;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    created = {
      id: 'u-unknown', name: String(body.name).trim(), jobTitle: String(body.jobTitle).trim() || null,
      active: 1, projectRole: 'member', username: 'unknown-user', accountStatus: 'active', accountDeletedAt: null,
      createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z',
    };
    failReads = true;
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/resources');
  await page.getByRole('button', { name: '新增人员', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新增人员', exact: true });
  await dialog.getByLabel('姓名', { exact: true }).fill('待核对同事');
  await dialog.getByLabel('岗位', { exact: true }).fill('测试工程师');
  await dialog.getByRole('button', { name: '新增人员', exact: true }).click();

  await expect(dialog.getByRole('alert')).toContainText('新增人员结果待核对');
  await expect(dialog.getByLabel('姓名', { exact: true })).toBeDisabled();
  await dialog.locator('form').evaluate((form) => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(100);
  expect(requests).toBe(1);

  await dialog.getByRole('button', { name: '关闭并核对', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('新增人员结果待核对');
  await page.getByRole('link', { name: '项目中心', exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/resources$/);
  await expect(page.getByRole('alert')).toContainText('新增人员结果待核对');

  await page.getByRole('button', { name: '核对新增人员', exact: true }).click();
  await expect(dialog.getByLabel('姓名', { exact: true })).toHaveValue('待核对同事');
  await expect(dialog.getByLabel('岗位', { exact: true })).toHaveValue('测试工程师');
  await expect(dialog.getByLabel('姓名', { exact: true })).toBeDisabled();
  await dialog.locator('form').evaluate((form) => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(100);
  expect(requests).toBe(1);

  failReads = false;
  await dialog.getByRole('button', { name: '重新读取人员', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('已核对最新状态：人员和账号已创建', { exact: true })).toBeVisible();
});

test('恢复数据库同周期重复提交与 Escape 只执行一次且不关闭窗口', async ({ page }) => {
  await mockShell(page);
  let requests = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const payloads: Array<Record<string, unknown>> = [];
  await page.route('**/api/backups/restore', async (route) => {
    requests++;
    payloads.push(route.request().postDataJSON());
    await pending;
    return route.fulfill({ json: { ok: true, message: '数据库恢复成功，等待服务重启', safetyBackupName: 'safety.db', operationId: 'restore-1' } });
  });
  try {
    await page.goto('/system');
    await page.locator('.system-backup-table tbody tr').getByRole('button', { name: '恢复', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '恢复数据库备份' });
    await dialog.getByRole('button', { name: '确认恢复' }).evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await expect.poll(() => requests).toBe(1);
    expect(payloads).toEqual([{ name: 'backup-20260905.db', expectedFingerprint: 'a'.repeat(64) }]);
    await expect(dialog).toBeVisible();
    release();
    await expect(dialog.getByText('数据库恢复成功，等待服务重启')).toBeVisible();
    await expect(dialog.getByRole('button', { name: '等待服务重启' })).toBeDisabled();
  } finally { release(); }
});

test('系统页明确显示数据库恢复已自动回滚', async ({ page }) => {
  await mockShell(page, authenticatedSession, {
    operationId: 'restore-1', outcome: 'rolled_back', backupName: 'target.db', safetyBackupName: 'safety.db',
    updatedAt: '2026-09-05T01:00:00.000Z', message: '恢复数据库启动失败，系统已自动切回原数据库',
    failedDatabase: 'service.db.failed-restore-2026-09-05',
  });
  await page.goto('/system');
  await expect(page.getByText(/恢复数据库启动失败，系统已自动切回原数据库/)).toBeVisible();
  await expect(page.getByText(/目标备份：target\.db/)).toBeVisible();
  await expect(page.getByText(/失败库已保留为 service\.db\.failed-restore-2026-09-05/)).toBeVisible();
});

test('服务端仍记录恢复待确认时锁定备份、恢复和删除操作', async ({ page }) => {
  await mockShell(page, authenticatedSession, {
    operationId: 'restore-pending', outcome: 'pending', backupName: 'target.db', safetyBackupName: 'safety.db',
    updatedAt: '2026-09-05T01:00:00.000Z', message: '数据库恢复已安排，正在等待服务重启', failedDatabase: null,
  });
  await page.goto('/system');
  await expect(page.getByText('上次数据库恢复尚未确认结果，请检查服务日志后再执行新的恢复。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '立即备份', exact: true })).toBeDisabled();
  const row = page.locator('.system-backup-table tbody tr').first();
  await expect(row.getByRole('button', { name: '恢复', exact: true })).toBeDisabled();
  await expect(row.getByRole('button', { name: '删除', exact: true })).toBeDisabled();
});

test('系统概览未验证时锁定数据库维护操作', async ({ page }) => {
  await mockShell(page);
  await page.route('**/api/system/overview*', (route) => route.fulfill({ status: 503, json: { error: '系统状态暂不可用' } }));
  await page.goto('/system');
  await expect(page.getByText('系统概览加载失败，运行状态未确认，维护操作暂不可用。', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '立即备份', exact: true })).toBeDisabled();
  const row = page.locator('.system-backup-table tbody tr').first();
  await expect(row.getByRole('button', { name: '恢复', exact: true })).toBeDisabled();
  await expect(row.getByRole('button', { name: '删除', exact: true })).toBeDisabled();
});

test('已打开的恢复和删除确认随后台恢复状态立即锁定', async ({ page }) => {
  await mockShell(page);
  let restorePending = false;
  let overviewReads = 0;
  await page.route('**/api/system/overview*', (route) => {
    overviewReads++;
    return route.fulfill({ json: {
      status: 'ok',
      service: { version: '1.0.0', startedAt: '2026-09-05T00:00:00.000Z', uptimeSeconds: 300, environment: 'test', timezone: 'Asia/Shanghai', host: '127.0.0.1', port: 3211, protocol: 'http' },
      database: { path: 'test.db', backupDirectory: 'backups', mainSizeBytes: 1024, walSizeBytes: 0, shmSizeBytes: 0, totalSizeBytes: 1024, journalMode: 'wal' },
      backups: { count: 1, totalSizeBytes: 1024, lastCreatedAt: '2026-09-05T00:00:00.000Z', overdue: false, retentionDays: 30, maxCount: 30, nextScheduledAt: '2026-09-06T02:00:00.000Z' },
      lastRestore: restorePending ? { operationId: 'restore-pending', outcome: 'pending', backupName: 'target.db', safetyBackupName: 'safety.db', updatedAt: '2026-09-05T01:00:00.000Z', message: '等待服务重启', failedDatabase: null } : null,
    } });
  });
  const reconnect = async () => {
    const before = overviewReads;
    await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
    await expect.poll(() => overviewReads).toBeGreaterThan(before);
  };

  await page.goto('/system');
  const row = page.locator('.system-backup-table tbody tr').first();
  await row.getByRole('button', { name: '恢复', exact: true }).click();
  const restoreDialog = page.getByRole('dialog', { name: '恢复数据库备份', exact: true });
  restorePending = true;
  await reconnect();
  await expect(restoreDialog.getByRole('button', { name: '确认恢复', exact: true })).toBeDisabled();

  restorePending = false;
  await reconnect();
  await expect(restoreDialog.getByRole('button', { name: '确认恢复', exact: true })).toBeEnabled();
  await restoreDialog.getByRole('button', { name: '取消', exact: true }).click();
  await row.getByRole('button', { name: '删除', exact: true }).click();
  const deleteDialog = page.getByRole('dialog', { name: '删除数据库备份', exact: true });
  restorePending = true;
  await reconnect();
  await expect(deleteDialog.getByRole('button', { name: '永久删除', exact: true })).toBeDisabled();
});

test('已打开的维护确认在备份指纹变化或文件消失后立即锁定', async ({ page }) => {
  await mockShell(page);
  let backupReads = 0;
  let currentBackups = [{
    name: 'backup-20260905.db', size: 1024, createdAt: '2026-09-05T00:00:00.000Z', fingerprint: 'a'.repeat(64),
  }];
  await page.route('**/api/backups', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    backupReads++;
    return route.fulfill({ json: currentBackups });
  });
  const reconnect = async () => {
    const before = backupReads;
    await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
    await expect.poll(() => backupReads).toBeGreaterThan(before);
  };

  await page.goto('/system');
  const row = page.locator('.system-backup-table tbody tr').first();
  await row.getByRole('button', { name: '恢复', exact: true }).click();
  const restoreDialog = page.getByRole('dialog', { name: '恢复数据库备份', exact: true });
  currentBackups = [{ ...currentBackups[0], fingerprint: 'b'.repeat(64) }];
  await reconnect();
  await expect(restoreDialog.getByRole('alert')).toContainText('备份文件已被后台删除或替换');
  await expect(restoreDialog.getByRole('button', { name: '确认恢复', exact: true })).toBeDisabled();
  await restoreDialog.getByRole('button', { name: '取消', exact: true }).click();

  await page.locator('.system-backup-table tbody tr').first().getByRole('button', { name: '删除', exact: true }).click();
  const deleteDialog = page.getByRole('dialog', { name: '删除数据库备份', exact: true });
  currentBackups = [];
  await reconnect();
  await expect(deleteDialog.getByRole('alert')).toContainText('备份文件已被后台删除或替换');
  await expect(deleteDialog.getByRole('button', { name: '永久删除', exact: true })).toBeDisabled();
});

test('备份列表刷新失败时在恢复确认中说明锁定原因，恢复后识别替换文件', async ({ page }) => {
  await mockShell(page);
  let backupReads = 0;
  let readFails = false;
  let currentBackups = [{
    name: 'backup-20260905.db', size: 1024, createdAt: '2026-09-05T00:00:00.000Z', fingerprint: 'a'.repeat(64),
  }];
  await page.route('**/api/backups', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    backupReads++;
    return readFails
      ? route.fulfill({ status: 503, json: { error: '备份目录暂不可用' } })
      : route.fulfill({ json: currentBackups });
  });
  const reconnect = async () => {
    const before = backupReads;
    await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
    await expect.poll(() => backupReads).toBeGreaterThan(before);
  };

  await page.goto('/system');
  await page.locator('.system-backup-table tbody tr').first().getByRole('button', { name: '恢复', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '恢复数据库备份', exact: true });
  readFails = true;
  await reconnect();
  await expect(dialog.getByRole('alert')).toContainText('备份列表刷新失败，当前文件状态未确认');
  await expect(dialog.getByRole('button', { name: '确认恢复', exact: true })).toBeDisabled();

  readFails = false;
  currentBackups = [{ ...currentBackups[0], fingerprint: 'b'.repeat(64) }];
  await dialog.getByRole('button', { name: '重新读取备份列表', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('备份文件已被后台删除或替换');
  await expect(dialog.getByRole('button', { name: '确认恢复', exact: true })).toBeDisabled();
});

test('删除结果未知后重读列表不会把旧确认改绑到同名新备份', async ({ page }) => {
  await mockShell(page);
  let currentBackups = [{
    name: 'backup-20260905.db', size: 1024, createdAt: '2026-09-05T00:00:00.000Z', fingerprint: 'a'.repeat(64),
  }];
  let deleteRequests = 0;
  await page.route('**/api/backups/backup-20260905.db', (route) => {
    deleteRequests++;
    currentBackups = [{ ...currentBackups[0], fingerprint: 'b'.repeat(64) }];
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>invalid delete response</html>' });
  });
  await page.route('**/api/backups', (route) => route.request().method() === 'GET'
    ? route.fulfill({ json: currentBackups })
    : route.fallback());

  await page.goto('/system');
  await page.locator('.system-backup-table tbody tr').first().getByRole('button', { name: '删除', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除数据库备份', exact: true });
  await dialog.getByRole('button', { name: '永久删除', exact: true }).click();
  await expect(dialog.getByRole('alert').filter({ hasText: '删除结果需要核对，当前备份不会再次提交。' })).toBeVisible();
  await dialog.getByRole('button', { name: '重新读取备份列表', exact: true }).click();
  await expect(dialog.getByRole('alert').filter({ hasText: '备份文件已被后台删除或替换' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '永久删除', exact: true })).toBeDisabled();
  expect(deleteRequests).toBe(1);
});

test('立即备份结果未知且列表回读失败后跨导航保持维护锁', async ({ page }) => {
  await mockShell(page);
  let readFails = false;
  let backupRequests = 0;
  const backups = [{
    name: 'backup-20260905.db', size: 1024, createdAt: '2026-09-05T00:00:00.000Z', fingerprint: 'a'.repeat(64),
  }];
  await page.route('**/api/backups', (route) => {
    if (route.request().method() === 'GET') return readFails
      ? route.fulfill({ status: 503, json: { error: '备份目录暂不可用' } })
      : route.fulfill({ json: backups });
    backupRequests++;
    readFails = true;
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>invalid backup response</html>' });
  });

  await page.goto('/system');
  let backup = page.getByRole('button', { name: '立即备份', exact: true });
  await backup.click();
  await expect(page.getByRole('button', { name: '重新读取备份列表', exact: true })).toBeVisible();
  await expect(backup).toBeDisabled();

  await page.getByRole('link', { name: '项目中心', exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/system$/);
  backup = page.getByRole('button', { name: '立即备份', exact: true });
  await expect(page.getByRole('button', { name: '重新读取备份列表', exact: true })).toBeVisible();
  await expect(backup).toBeDisabled();
  await backup.evaluate((button) => {
    (button as HTMLButtonElement).disabled = false;
    (button as HTMLButtonElement).click();
  });
  await page.waitForTimeout(100);
  expect(backupRequests).toBe(1);

  readFails = false;
  await page.getByRole('button', { name: '重新读取备份列表', exact: true }).click();
  await expect(page.getByRole('button', { name: '重新读取备份列表', exact: true })).toHaveCount(0);
  await expect(backup).toBeEnabled();
});

test('数据库恢复待核对时跨导航保持维护锁', async ({ page }) => {
  await mockShell(page);
  let restoreRequests = 0;
  await page.route('**/api/backups/restore', (route) => {
    restoreRequests++;
    return route.fulfill({ status: 409, json: { error: '备份版本已变化' } });
  });

  await page.goto('/system');
  await page.locator('.system-backup-table tbody tr').first().getByRole('button', { name: '恢复', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '恢复数据库备份', exact: true });
  await dialog.getByRole('button', { name: '确认恢复', exact: true }).click();
  await expect(dialog.locator('.warning-banner').filter({ hasText: '恢复结果需要核对，当前备份不会再次提交。' })).toBeVisible();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();

  await page.getByRole('link', { name: '项目中心', exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/system$/);
  const restoreNotice = page.locator('.system-page > .warning-banner').filter({ hasText: '数据库恢复结果需要核对，其他维护操作暂不可用。' });
  await expect(restoreNotice).toBeVisible();
  const restore = page.locator('.system-backup-table tbody tr').first().getByRole('button', { name: '恢复', exact: true });
  await expect(restore).toBeDisabled();
  await restore.evaluate((button) => {
    (button as HTMLButtonElement).disabled = false;
    (button as HTMLButtonElement).click();
  });
  dialog = page.getByRole('dialog', { name: '恢复数据库备份', exact: true });
  await expect(dialog).toHaveCount(0);
  expect(restoreRequests).toBe(1);

  await page.getByRole('button', { name: '重新读取系统状态', exact: true }).click();
  await expect(restoreNotice).toHaveCount(0);
  await expect(restore).toBeEnabled();
});

test('删除备份结果未知且列表回读失败后跨导航保持维护锁', async ({ page }) => {
  await mockShell(page);
  let readFails = false;
  let deleteRequests = 0;
  const backups = [{
    name: 'backup-20260905.db', size: 1024, createdAt: '2026-09-05T00:00:00.000Z', fingerprint: 'a'.repeat(64),
  }];
  await page.route('**/api/backups/backup-20260905.db', (route) => {
    deleteRequests++;
    readFails = true;
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>invalid delete response</html>' });
  });
  await page.route('**/api/backups', (route) => route.request().method() === 'GET'
    ? readFails
      ? route.fulfill({ status: 503, json: { error: '备份目录暂不可用' } })
      : route.fulfill({ json: backups })
    : route.fallback());

  await page.goto('/system');
  await page.locator('.system-backup-table tbody tr').first().getByRole('button', { name: '删除', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除数据库备份', exact: true });
  await dialog.getByRole('button', { name: '永久删除', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '永久删除', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();

  await page.getByRole('link', { name: '项目中心', exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/system$/);
  await expect(page.getByRole('button', { name: '重新读取备份列表', exact: true })).toBeVisible();
  const remove = page.locator('.system-backup-table tbody tr').first().getByRole('button', { name: '删除', exact: true });
  await expect(remove).toBeDisabled();
  await remove.evaluate((button) => {
    (button as HTMLButtonElement).disabled = false;
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole('dialog', { name: '删除数据库备份', exact: true })).toHaveCount(0);
  expect(deleteRequests).toBe(1);

  readFails = false;
  await page.getByRole('button', { name: '重新读取备份列表', exact: true }).click();
  await expect(page.getByRole('button', { name: '重新读取备份列表', exact: true })).toHaveCount(0);
  await expect(remove).toBeEnabled();
});

test('品牌保存结果未知且回读失败后跨导航保持原提交锁', async ({ page }) => {
  await mockShell(page);
  let readFails = false;
  let saveRequests = 0;
  let branding = { systemName: '项目管理', shortName: 'PM', logoUrl: null, updatedAt: null as string | null };
  await page.route('**/api/branding', (route) => readFails
    ? route.fulfill({ status: 503, json: { error: '品牌设置暂不可用' } })
    : route.fulfill({ json: branding }));
  await page.route('**/api/system/branding', (route) => {
    saveRequests++;
    const body = route.request().postDataJSON() as { systemName: string; shortName: string };
    branding = { systemName: body.systemName, shortName: body.shortName, logoUrl: null, updatedAt: '2026-09-05T00:00:00.001Z' };
    readFails = true;
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>invalid branding response</html>' });
  });

  await page.goto('/system');
  await page.getByLabel('系统名称', { exact: true }).fill('结果未知的品牌');
  await page.getByLabel('系统简称', { exact: true }).fill('未知');
  await page.getByRole('button', { name: '保存品牌设置', exact: true }).click();
  let notice = page.locator('.system-branding-panel .warning-banner').filter({ hasText: '保存结果需要核对，当前草稿不会再次提交。' });
  await expect(notice).toBeVisible();

  await page.getByRole('link', { name: '项目中心', exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/system$/);
  notice = page.locator('.system-branding-panel .warning-banner').filter({ hasText: '保存结果需要核对，当前草稿不会再次提交。' });
  await expect(notice).toBeVisible();
  const save = page.getByRole('button', { name: '保存品牌设置', exact: true });
  await expect(save).toBeDisabled();
  await page.locator('.system-branding-form').evaluate((form) => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(100);
  expect(saveRequests).toBe(1);

  readFails = false;
  await notice.getByRole('button', { name: '重新读取品牌设置', exact: true }).click();
  await expect(notice).toHaveCount(0);
  await expect(page.getByLabel('系统名称', { exact: true })).toHaveValue('结果未知的品牌');
  await expect(page.getByLabel('系统简称', { exact: true })).toHaveValue('未知');
  await expect(save).toBeEnabled();
});

test('品牌保存与备份删除响应未知时自动核对已生效状态', async ({ page }) => {
  await mockShell(page);
  let branding = { systemName: '项目管理', shortName: 'PM', logoUrl: null, updatedAt: null as string | null };
  let backups = [{
    name: 'backup-20260905.db', size: 1024, createdAt: '2026-09-05T00:00:00.000Z', fingerprint: 'a'.repeat(64),
  }];
  await page.route('**/api/branding', (route) => route.fulfill({ json: branding }));
  await page.route('**/api/system/branding', (route) => {
    const body = route.request().postDataJSON() as { systemName: string; shortName: string };
    branding = { systemName: body.systemName, shortName: body.shortName, logoUrl: null, updatedAt: '2026-09-05T00:00:00.001Z' };
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>invalid branding response</html>' });
  });
  await page.route('**/api/backups/backup-20260905.db', (route) => {
    backups = [];
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>invalid delete response</html>' });
  });
  await page.route('**/api/backups', (route) => route.request().method() === 'GET'
    ? route.fulfill({ json: backups })
    : route.fallback());

  await page.goto('/system');
  await page.getByLabel('系统名称', { exact: true }).fill('已保存品牌');
  await page.getByLabel('系统简称', { exact: true }).fill('已存');
  await page.getByRole('button', { name: '保存品牌设置', exact: true }).click();
  await expect(page.getByText('品牌设置已保存', { exact: true })).toBeVisible();
  await expect(page.locator('.system-branding-panel .warning-banner')).toHaveCount(0);

  await page.locator('.system-backup-table tbody tr').getByRole('button', { name: '删除', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除数据库备份', exact: true });
  await dialog.getByRole('button', { name: '永久删除', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('备份已删除：backup-20260905.db', { exact: true })).toBeVisible();
});

test('系统页持续刷新运行状态和自动产生的备份', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-06T01:59:00.000Z') });
  await mockShell(page);
  let overviewReads = 0;
  let backupReads = 0;
  let scheduledBackupCreated = false;
  await page.route('**/api/system/overview*', (route) => {
    overviewReads++;
    return route.fulfill({ json: {
      status: 'ok',
      service: { version: `1.0.${overviewReads}`, startedAt: '2026-09-05T00:00:00.000Z', uptimeSeconds: 60, environment: 'test', timezone: 'Asia/Shanghai', host: '127.0.0.1', port: 3211, protocol: 'http' },
      database: { path: 'test.db', backupDirectory: 'backups', mainSizeBytes: 1024, walSizeBytes: 0, shmSizeBytes: 0, totalSizeBytes: 1024, journalMode: 'wal' },
      backups: { count: scheduledBackupCreated ? 2 : 1, totalSizeBytes: 1024, lastCreatedAt: '2026-09-05T00:00:00.000Z', overdue: false, retentionDays: 30, maxCount: 30, nextScheduledAt: '2026-09-06T02:00:00.000Z' },
      lastRestore: null,
    } });
  });
  await page.route('**/api/backups', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    backupReads++;
    const backups = [{ name: 'backup-1.db', size: 1024, createdAt: '2026-09-05T00:00:00.000Z', fingerprint: 'a'.repeat(64) }];
    if (scheduledBackupCreated) backups.unshift({ name: 'backup-2.db', size: 1024, createdAt: '2026-09-06T02:00:00.000Z', fingerprint: 'b'.repeat(64) });
    return route.fulfill({ json: backups });
  });

  await page.goto('/system');
  await expect(page.getByText('已运行 1天1小时', { exact: true })).toBeVisible();
  await expect(page.locator('.system-overview-warning')).toHaveCount(0);
  await expect(page.locator('.system-backup-table tbody tr')).toHaveCount(1);

  const initialOverviewReads = overviewReads;
  const initialBackupReads = backupReads;
  scheduledBackupCreated = true;
  await page.clock.fastForward(120_000);
  await expect.poll(() => overviewReads).toBeGreaterThan(initialOverviewReads);
  await expect.poll(() => backupReads).toBeGreaterThan(initialBackupReads);
  await expect(page.locator('.system-overview-warning').getByText('已超过安全备份周期', { exact: true })).toBeVisible();
  await expect(page.locator('.system-backup-table tbody tr')).toHaveCount(2);
});

test('删除数据库备份固定列表中的文件指纹且重复提交只执行一次', async ({ page }) => {
  await mockShell(page);
  let requests = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const payloads: Array<Record<string, unknown>> = [];
  await page.route('**/api/backups/backup-20260905.db', async (route) => {
    requests++;
    payloads.push(route.request().postDataJSON());
    await pending;
    return route.fulfill({ json: { ok: true, name: 'backup-20260905.db' } });
  });
  try {
    await page.goto('/system');
    await page.locator('.system-backup-table tbody tr').getByRole('button', { name: '删除', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '删除数据库备份' });
    await dialog.getByRole('button', { name: '永久删除', exact: true }).evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect.poll(() => requests).toBe(1);
    expect(payloads).toEqual([{ expectedFingerprint: 'a'.repeat(64) }]);
    release();
    await expect(dialog).toHaveCount(0);
  } finally { release(); }
});

test('登录同周期重复提交与 Escape 只执行一次且不关闭窗口', async ({ page }) => {
  await mockShell(page, { authenticated: false, accountId: null, username: null, role: null, globalRole: null, personId: null, mustChangePassword: false, managedProjectIds: [] });
  let requests = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/login', async (route) => {
    requests++;
    await pending;
    return route.fulfill({ json: authenticatedSession });
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '游客登录', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '用户登录' });
    await dialog.getByLabel('用户名', {exact:true}).fill('admin');
    await dialog.getByLabel('密码').fill('test-password');
    await dialog.getByRole('button', { name: '用户登录', exact: true }).evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await expect.poll(() => requests).toBe(1);
    await expect(dialog).toBeVisible();
    release();
    await expect(dialog).toHaveCount(0);
  } finally { release(); }
});

test('登录与退出响应未知时按服务端会话自动完成身份切换', async ({ page }) => {
  const guest = { authenticated: false, accountId: null, username: null, role: 'guest', globalRole: 'guest', personId: null, mustChangePassword: false, managedProjectIds: [] };
  await mockShell(page, guest);
  let currentSession = guest as typeof guest | typeof authenticatedSession;
  await page.route('**/api/session', (route) => route.fulfill({ json: currentSession }));
  await page.route('**/api/login', (route) => {
    currentSession = authenticatedSession;
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>invalid login response</html>' });
  });
  await page.route('**/api/logout', (route) => {
    currentSession = guest;
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>invalid logout response</html>' });
  });

  await page.goto('/');
  await page.getByRole('button', { name: '游客登录', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '用户登录', exact: true });
  await dialog.getByLabel('用户名', {exact:true}).fill('admin');
  await dialog.getByLabel('密码').fill('test-password');
  await dialog.getByRole('button', { name: '用户登录', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button',{name:'账号菜单：admin',exact:true})).toBeVisible();

  await page.getByRole('button',{name:/^账号菜单/}).click();await page.getByRole('menuitem',{ name:'退出登录', exact: true }).click();
  await expect(page.getByRole('heading',{name:'暂未开放游客浏览',exact:true})).toBeVisible();
  await expect(page.getByRole('button', { name: '游客登录', exact: true })).toBeVisible();
});

test('修改密码同周期重复提交与 Escape 只执行一次且不关闭窗口', async ({ page }) => {
  await mockShell(page);
  let requests = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/account/change-password', async (route) => {
    requests++;
    await pending;
    return route.fulfill({ json: { session: authenticatedSession } });
  });
  try {
    await page.goto('/settings');
    await page.getByRole('button', { name: '修改密码', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '修改密码' });
    await dialog.getByLabel('当前密码').fill('old-password');
    await dialog.getByLabel('新密码', { exact: true }).fill('new-password-2026');
    await dialog.getByLabel('确认新密码').fill('new-password-2026');
    await dialog.getByRole('button', { name: '保存新密码' }).evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await expect.poll(() => requests).toBe(1);
    await expect(dialog).toBeVisible();
    release();
    await expect(dialog).toHaveCount(0);
  } finally { release(); }
});

test('修改密码响应未知时核对首次改密并阻止普通改密重复提交', async ({ page }) => {
  const forcedSession = { ...authenticatedSession, mustChangePassword: true };
  let currentSession = forcedSession;
  let writes = 0;
  await mockShell(page, forcedSession);
  await page.route('**/api/session', (route) => route.fulfill({ json: currentSession }));
  await page.route('**/api/account/change-password', (route) => {
    writes++;
    if (writes === 1) currentSession = authenticatedSession;
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>invalid password response</html>' });
  });

  await page.goto('/');
  const forcedDialog = page.getByRole('dialog', { name: '修改初始密码', exact: true });
  await forcedDialog.getByLabel('当前密码').fill('old-password');
  await forcedDialog.getByLabel('新密码', { exact: true }).fill('new-password-2026');
  await forcedDialog.getByLabel('确认新密码').fill('new-password-2026');
  await forcedDialog.getByRole('button', { name: '保存新密码', exact: true }).click();
  await expect(forcedDialog).toHaveCount(0);

  await page.goto('/settings');
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  const regularDialog = page.getByRole('dialog', { name: '修改密码', exact: true });
  await regularDialog.getByLabel('当前密码').fill('new-password-2026');
  await regularDialog.getByLabel('新密码', { exact: true }).fill('next-password-2026');
  await regularDialog.getByLabel('确认新密码').fill('next-password-2026');
  await regularDialog.getByRole('button', { name: '保存新密码', exact: true }).click();
  await expect(regularDialog).toContainText('退出后使用新密码重新登录');
  await expect(regularDialog.getByRole('button', { name: '保存新密码', exact: true })).toBeDisabled();
  expect(writes).toBe(2);
});
