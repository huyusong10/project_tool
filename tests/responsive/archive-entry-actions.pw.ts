import { expect, test, type Page, type Route } from '@playwright/test';
import type { Account, Person, Project, WorkItemTemplate } from '../../src/client/types';

const project: Project = {
  id: 'p1', name: '归档验证项目', status: 'active', plannedStart: null, plannedEnd: null,
  defaultTemplateId: 't1', isSample: false, createdAt: '2026-09-01', updatedAt: '2026-09-01',
};
const templates: WorkItemTemplate[] = [
  { id: 't1', projectId: 'p1', name: '默认流程', description: '', createdAt: '2026-09-01', updatedAt: '2026-09-01', items: [{ id: 'ti1', templateId: 't1', title: '设计', sortOrder: 0, startOffsetDays: 0, durationDays: 1, milestoneLabel: null }] },
  { id: 't2', projectId: 'p1', name: '备用流程', description: '', createdAt: '2026-09-01', updatedAt: '2026-09-01', items: [{ id: 'ti2', templateId: 't2', title: '开发', sortOrder: 0, startOffsetDays: 0, durationDays: 1, milestoneLabel: null }] },
];
const person: Person = {
  id: 'u1', name: '历史成员', jobTitle: '测试工程师', active: 1, username: '历史成员', accountStatus: 'active',
  createdAt: '2026-09-01', updatedAt: '2026-09-01',
};
const account: Account = {
  id: 'a1', username: '历史成员', personId: 'u1', personName: '历史成员', jobTitle: '测试工程师',
  globalRole: 'user', role: 'user', status: 'active', mustChangePassword: false, isBuiltin: false,
  lastLoginAt: null, createdAt: '2026-09-01', updatedAt: '2026-09-01', managedProjects: [],
  activeAssignments: { requirements: 0, workItems: 0, issues: 0 },
};

async function mockBase(page: Page, data: {
  projects?: () => Project[];
  templates?: () => WorkItemTemplate[];
  people?: () => Person[];
  accounts?: () => Account[];
}) {
  await page.route('**/api/**', async (route: Route) => {
    const pathname = new URL(route.request().url()).pathname;
    const json = (value: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
    if (pathname === '/api/branding') return json({ systemName: '项目管理', shortName: 'PM', logoUrl: null, updatedAt: null });
    if (pathname === '/api/session') return json({ authenticated: true, accountId: 'admin', username: 'admin', role: 'admin', globalRole: 'admin', personId: null, mustChangePassword: false, managedProjectIds: [] });
    if (pathname === '/api/projects') return json(data.projects?.() || []);
    if (pathname === '/api/templates') return json(data.templates?.() || []);
    if (pathname === '/api/people') return json(data.people?.() || []);
    if (pathname === '/api/accounts') return json(data.accounts?.() || []);
    return json({});
  });
}

async function reconnect(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
}

test('项目归档确认连点只提交一次', async ({ page }) => {
  let archived = false;
  await mockBase(page, { projects: () => archived ? [] : [project] });
  let requests = 0;
  const payloads: Array<Record<string, unknown>> = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/projects/p1', async (route) => {
    requests++;
    payloads.push(route.request().postDataJSON());
    await pending;
    if (requests > 1) return route.fulfill({ status: 404, json: { error: '项目不存在' } });
    archived = true;
    return route.fulfill({ json: { ok: true, forced: false, dependencies: { requirements: 0, issues: 0 } } });
  });
  try {
    await page.goto('/projects');
    await page.getByRole('button', { name: '归档', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '归档项目' });
    await dialog.getByRole('button', { name: '确认归档' }).dblclick();
    await expect.poll(() => requests).toBe(1);
    expect(payloads).toEqual([{ expectedUpdatedAt: project.updatedAt }]);
    await expect(dialog.getByRole('button', { name: '归档中…', exact: true })).toBeDisabled();
    release();
    await expect(dialog).toHaveCount(0);
  } finally { release(); }
});

test('项目归档已落库但响应异常时同时核对活动与归档列表', async ({ page }) => {
  let archived = false;
  let requests = 0;
  await mockBase(page, { projects: () => archived ? [] : [project] });
  await page.route('**/api/archives', (route) => route.fulfill({ json: {
    projects: archived ? [{ id: project.id, title: project.name, deletedAt: '2026-09-05T00:00:00.000Z' }] : [],
    requirements: [], people: [], templates: [],
  } }));
  await page.route('**/api/projects/p1', (route) => {
    requests++;
    archived = true;
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'archived' });
  });

  await page.goto('/projects');
  await page.getByRole('button', { name: '归档', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '归档项目', exact: true });
  await dialog.getByRole('button', { name: '确认归档', exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(project.name, { exact: true })).toHaveCount(0);
  expect(requests).toBe(1);
});

test('项目归档响应未知且双列表失败时跨导航保持锁定', async ({ page }) => {
  let archived=false,failReads=false,requests=0;
  await mockBase(page,{projects:()=>archived?[]:[project]});
  await page.route('**/api/projects',route=>failReads?route.fulfill({status:503,json:{error:'项目列表暂时不可用'}}):route.fallback());
  await page.route('**/api/archives',route=>failReads?route.fulfill({status:503,json:{error:'归档列表暂时不可用'}}):route.fulfill({json:{projects:archived?[{id:project.id,title:project.name,deletedAt:'2026-09-05T00:00:00.000Z'}]:[],requirements:[],people:[],templates:[]}}));
  await page.route('**/api/projects/p1',route=>{requests++;archived=true;failReads=true;return route.fulfill({status:200,contentType:'text/html',body:'archived'});});
  await page.goto('/projects');await page.getByRole('button',{name:'归档',exact:true}).click();const dialog=page.getByRole('dialog',{name:'归档项目',exact:true});await dialog.getByRole('button',{name:'确认归档',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('请关闭窗口后重新选择归档');await dialog.getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('link',{name:'项目进展',exact:true}).click();await page.getByRole('link',{name:'项目中心',exact:true}).click();await expect(page.getByRole('alert')).toContainText('项目归档结果待核对');
  const archiveButton=page.getByRole('button',{name:'归档',exact:true});await expect(archiveButton).toBeDisabled();await archiveButton.evaluate(button=>{button.removeAttribute('disabled');(button as HTMLButtonElement).click();});await expect(page.getByRole('dialog',{name:'归档项目',exact:true})).toHaveCount(0);expect(requests).toBe(1);
  failReads=false;await page.getByRole('button',{name:'重新读取项目与归档',exact:true}).click();await expect(page.getByText('项目归档结果待核对',{exact:false})).toHaveCount(0);await expect(page.getByText(project.name,{exact:true})).toHaveCount(0);expect(requests).toBe(1);
});

test('项目归档提交同一事件周期内不能被 Escape 关闭', async ({ page }) => {
  await mockBase(page, { projects: () => [project] });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/projects/p1', async (route) => {
    await pending;
    return route.fulfill({ json: { ok: true, forced: false, dependencies: { requirements: 0, issues: 0 } } });
  });
  try {
    await page.goto('/projects');
    await page.getByRole('button', { name: '归档', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '归档项目' });
    await dialog.getByRole('button', { name: '确认归档' }).evaluate((button) => {
      (button as HTMLButtonElement).click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await expect(dialog).toBeVisible();
    release();
    await expect(dialog).toHaveCount(0);
  } finally { release(); }
});

test('流程归档确认连点只提交一次', async ({ page }) => {
  let archived = false;
  await mockBase(page, { projects: () => [project], templates: () => archived ? templates.slice(0, 1) : templates });
  let requests = 0;
  const payloads: Array<Record<string, unknown>> = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/templates/t2', async (route) => {
    requests++;
    payloads.push(route.request().postDataJSON());
    await pending;
    if (requests > 1) return route.fulfill({ status: 404, json: { error: '流程不存在' } });
    archived = true;
    return route.fulfill({ json: { ok: true } });
  });
  try {
    await page.goto('/templates');
    await page.getByRole('button', { name: '归档流程 备用流程' }).click();
    const dialog = page.getByRole('dialog', { name: '归档流程' });
    await dialog.getByRole('button', { name: '确认归档' }).dblclick();
    await expect.poll(() => requests).toBe(1);
    expect(payloads).toEqual([{ expectedUpdatedAt: templates[1].updatedAt }]);
    await expect(dialog.getByRole('button', { name: '归档中…', exact: true })).toBeDisabled();
    release();
    await expect(dialog).toHaveCount(0);
  } finally { release(); }
});

test('流程归档已落库但响应异常时同时核对活动与归档列表', async ({ page }) => {
  let archived = false;
  let requests = 0;
  await mockBase(page, { projects: () => [project], templates: () => archived ? templates.slice(0, 1) : templates });
  await page.route('**/api/archives?*', (route) => route.fulfill({ json: {
    projects: [], requirements: [], people: [],
    templates: archived ? [{ id: 't2', title: '备用流程', deletedAt: '2026-09-05T00:00:00.000Z' }] : [],
  } }));
  await page.route('**/api/templates/t2', (route) => {
    requests++;
    archived = true;
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'archived' });
  });

  await page.goto('/templates');
  await page.getByRole('button', { name: '归档流程 备用流程', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '归档流程', exact: true });
  await dialog.getByRole('button', { name: '确认归档', exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('备用流程', { exact: true })).toHaveCount(0);
  expect(requests).toBe(1);
});

test('流程归档响应未知且双列表失败时跨导航保持锁定', async ({ page }) => {
  let archived=false,failReads=false,requests=0;
  await mockBase(page,{projects:()=>[project],templates:()=>archived?templates.slice(0,1):templates});
  await page.route('**/api/templates?*',route=>failReads?route.fulfill({status:503,json:{error:'流程列表暂时不可用'}}):route.fallback());
  await page.route('**/api/archives?*',route=>failReads?route.fulfill({status:503,json:{error:'归档列表暂时不可用'}}):route.fulfill({json:{projects:[],requirements:[],people:[],templates:archived?[{id:'t2',title:'备用流程',deletedAt:'2026-09-05T00:00:00.000Z'}]:[]}}));
  await page.route('**/api/templates/t2',route=>{requests++;archived=true;failReads=true;return route.fulfill({status:200,contentType:'text/html',body:'archived'});});
  await page.goto('/templates');await page.getByRole('button',{name:'归档流程 备用流程',exact:true}).click();const dialog=page.getByRole('dialog',{name:'归档流程',exact:true});await dialog.getByRole('button',{name:'确认归档',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('请关闭窗口后重新选择归档');await dialog.getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('link',{name:'项目中心',exact:true}).click();await page.getByRole('link',{name:'流程设计',exact:true}).click();await expect(page.getByRole('alert')).toContainText('流程归档结果待核对');
  const archiveButton=page.getByRole('button',{name:'归档流程 备用流程',exact:true});await expect(archiveButton).toBeDisabled();await archiveButton.evaluate(button=>{button.removeAttribute('disabled');(button as HTMLButtonElement).click();});await expect(page.getByRole('dialog',{name:'归档流程',exact:true})).toHaveCount(0);expect(requests).toBe(1);
  failReads=false;await page.getByRole('button',{name:'重新读取流程与归档',exact:true}).click();await expect(page.getByText('流程归档结果待核对',{exact:false})).toHaveCount(0);await expect(page.getByText('备用流程',{exact:true})).toHaveCount(0);expect(requests).toBe(1);
});

test('流程归档确认期间后台更新后必须关闭并重新选择', async ({ page }) => {
  let currentTemplates = structuredClone(templates);
  let archived = false;
  const payloads: Array<Record<string, unknown>> = [];
  await mockBase(page, {
    projects: () => [project],
    templates: () => archived ? currentTemplates.slice(0, 1) : currentTemplates,
  });
  await page.route('**/api/templates/t2', (route) => {
    payloads.push(route.request().postDataJSON());
    archived = true;
    return route.fulfill({ json: { ok: true } });
  });

  await page.goto('/templates');
  await page.getByRole('button', { name: '归档流程 备用流程', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '归档流程', exact: true });
  currentTemplates = currentTemplates.map((template) => template.id === 't2'
    ? { ...template, name: '后台更新的备用流程', updatedAt: '2026-09-02' }
    : template);
  await reconnect(page);

  await expect(page.getByRole('button', { name: '归档流程 后台更新的备用流程', exact: true })).toBeVisible();
  await expect(dialog).toContainText('流程“备用流程”');
  await expect(dialog.getByRole('alert')).toContainText('请关闭窗口后重新选择归档');
  await expect(dialog.getByRole('button', { name: '无法归档', exact: true })).toBeDisabled();
  expect(payloads).toHaveLength(0);

  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '归档流程 后台更新的备用流程', exact: true }).click();
  await page.getByRole('dialog', { name: '归档流程', exact: true }).getByRole('button', { name: '确认归档', exact: true }).click();
  await expect.poll(() => payloads).toEqual([{ expectedUpdatedAt: '2026-09-02' }]);
});

test('项目归档确认期间后台更新后必须关闭并重新选择', async ({ page }) => {
  let currentProject = { ...project };
  let archived = false;
  const payloads: Array<Record<string, unknown>> = [];
  await mockBase(page, { projects: () => archived ? [] : [currentProject] });
  await page.route('**/api/projects/p1', (route) => {
    payloads.push(route.request().postDataJSON());
    archived = true;
    return route.fulfill({ json: { ok: true, forced: false, dependencies: { requirements: 0, issues: 0 } } });
  });

  await page.goto('/projects');
  await page.getByRole('button', { name: '归档', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '归档项目', exact: true });
  currentProject = { ...currentProject, name: '后台更新的项目', updatedAt: '2026-09-02' };
  await reconnect(page);

  await expect(page.getByText('后台更新的项目', { exact: true })).toBeVisible();
  await expect(dialog).toContainText('项目“归档验证项目”');
  await expect(dialog.getByRole('alert')).toContainText('请关闭窗口后重新选择归档');
  await expect(dialog.getByRole('button', { name: '无法归档', exact: true })).toBeDisabled();
  expect(payloads).toHaveLength(0);

  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '归档', exact: true }).click();
  await page.getByRole('dialog', { name: '归档项目', exact: true }).getByRole('button', { name: '确认归档', exact: true }).click();
  await expect.poll(() => payloads).toEqual([{ expectedUpdatedAt: '2026-09-02' }]);
});

test('人员归档确认连点只提交一次', async ({ page }) => {
  let archived = false;
  await mockBase(page, { people: () => archived ? [] : [person], accounts: () => archived ? [] : [account] });
  let requests = 0;
  const payloads: Array<Record<string, unknown>> = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/people/u1', async (route) => {
    requests++;
    payloads.push(route.request().postDataJSON());
    await pending;
    if (requests > 1) return route.fulfill({ status: 404, json: { error: '人员不存在' } });
    archived = true;
    return route.fulfill({ json: { ok: true } });
  });
  try {
    await page.goto('/resources');
    await page.getByRole('button', { name: '打开历史成员操作' }).click();
    await page.getByRole('menuitem', { name: '归档人员' }).click();
    const dialog = page.getByRole('dialog', { name: '归档人员' });
    await dialog.getByRole('button', { name: '确认归档' }).dblclick();
    await expect.poll(() => requests).toBe(1);
    expect(payloads).toEqual([{ expectedUpdatedAt: person.updatedAt }]);
    await expect(dialog.getByRole('button', { name: '处理中…', exact: true })).toBeDisabled();
    release();
    await expect(dialog).toHaveCount(0);
  } finally { release(); }
});

test('项目设置恢复归档连点只提交一次', async ({ page }) => {
  let restored = false;
  await mockBase(page, { projects: () => [project] });
  await page.route('**/api/projects/p1/members', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/archives?*', (route) => route.fulfill({ json: {
    projects: [], requirements: [], people: [], templates: restored ? [] : [{ id: 't2', title: '备用流程归档', deletedAt: '2026-09-04T08:00:00.000Z' }],
  } }));
  let requests = 0;
  const payloads: Array<Record<string, unknown>> = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/templates/t2/restore', async (route) => {
    requests++;
    payloads.push(route.request().postDataJSON());
    await pending;
    if (requests > 1) return route.fulfill({ status: 404, json: { error: '归档模板不存在' } });
    restored = true;
    return route.fulfill({ json: { ...templates[1], name: '备用流程归档' } });
  });
  try {
    await page.goto('/project-settings');
    const restore = page.locator('.compact-list').getByRole('button', { name: '恢复' });
    await restore.dblclick();
    await expect.poll(() => requests).toBe(1);
    expect(payloads).toEqual([{ expectedDeletedAt: '2026-09-04T08:00:00.000Z' }]);
    await expect(restore).toBeDisabled();
    await expect(restore).toContainText('恢复中');
    release();
    await expect(restore).toHaveCount(0);
    await expect(page.getByText('归档模板不存在')).toHaveCount(0);
  } finally { release(); }
});

test('项目设置恢复已落库但响应异常时重读项目归档', async ({ page }) => {
  let restored = false;
  let requests = 0;
  await mockBase(page, { projects: () => [project] });
  await page.route('**/api/projects/p1/members', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/archives?*', (route) => route.fulfill({ json: {
    projects: [], requirements: [], people: [], templates: restored ? [] : [{ id: 't2', title: '备用流程归档', deletedAt: '2026-09-04T08:00:00.000Z' }],
  } }));
  await page.route('**/api/templates/t2/restore', (route) => {
    requests += 1;
    restored = true;
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/project-settings');
  await page.locator('.compact-list').getByRole('button', { name: '恢复', exact: true }).click();
  await expect(page.getByText('备用流程归档', { exact: true })).toHaveCount(0);
  await expect(page.getByText('已核对最新状态：内容已移出项目归档', { exact: true })).toBeVisible();
  expect(requests).toBe(1);
});

test('项目设置恢复响应未知且归档回读失败时锁定旧操作', async ({ page }) => {
  let restored = false;
  let failReads = false;
  let requests = 0;
  await mockBase(page, { projects: () => [project] });
  await page.route('**/api/projects/p1/members', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/archives?*', (route) => failReads
    ? route.fulfill({ status: 503, json: { error: '项目归档读取失败' } })
    : route.fulfill({ json: {
      projects: [], requirements: [], people: [], templates: restored ? [] : [{ id: 't2', title: '备用流程归档', deletedAt: '2026-09-04T08:00:00.000Z' }],
    } }));
  await page.route('**/api/templates/t2/restore', (route) => {
    requests += 1;
    restored = true;
    failReads = true;
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/project-settings');
  let restore = page.locator('.compact-list').getByRole('button', { name: '恢复', exact: true });
  await restore.click();
  await expect(page.getByRole('alert')).toContainText('项目归档恢复结果待核对');
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
  await expect(page).toHaveURL(/\/project-settings$/);
  restore = page.locator('.compact-list').getByRole('button', { name: '恢复', exact: true });
  await expect(page.getByRole('alert')).toContainText('项目归档恢复结果待核对');
  await expect(restore).toBeDisabled();
  await restore.evaluate((button) => {
    (button as HTMLButtonElement).disabled = false;
    (button as HTMLButtonElement).click();
  });
  await page.waitForTimeout(100);
  expect(requests).toBe(1);

  failReads = false;
  await page.getByRole('button', { name: '重新读取项目归档', exact: true }).click();
  await expect(page.getByText('备用流程归档', { exact: true })).toHaveCount(0);
});
