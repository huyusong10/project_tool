import { expect, test, type Page } from '@playwright/test';
import { mockGanttData } from './gantt-fixture';
import type { JiraPr, PrCandidate, PrGeneration, PrPreview, PrRemote, PrSource, PrStep } from '../../src/shared/jira-pr';
import { targetRoutes } from '../../src/shared/jira-workflow';
import { jiraSettingsSchema } from '../../src/shared/jira';

async function fixture(page: Page, failOnce = false) {
  await mockGanttData(page);
  const at = '2026-09-22T02:00:00.000Z';
  const commentBody = (sources: PrSource[]) => sources.length ? '进展摘要\n2026-08-07 开发已完成。\n\n人员评论\n\n' + sources.map(s => `${s.createdAt.slice(0, 10)} · ${s.workItemTitle || '需求'} · ${s.createdByName}\n${s.content}`).join('\n\n') : '本地：已完成';
  const rows: PrCandidate[] = Array.from({ length: 26 }, (_, n) => ({ requirementId: 'r' + (n + 1), title: n ? '需求 ' + (n + 1) : '权限管理与跨区域资源授权的长标题需求', featureId: 'f1', featureName: '权限管理', phaseName: 'Phase 1', archived: false, key: 'TEST-' + (n + 1), sources: [{ id: 's' + n, requirementId: 'r' + (n + 1), workItemId: null, workItemTitle: null, percent: 70, workItemPercent: null, content: '已完成权限接口开发，正在进行联调与回归测试。', eventType: 'progress', createdByName: '测试用户', createdAt: '2026-01-01T01:00:00Z', updatedAt: '2026-01-01T01:00:00Z', jiraSyncState: 'pending', jiraPrId: null, jiraCommentId: null, jiraSyncedAt: null }] }));
  let pr: JiraPr | null = null, generation: PrGeneration | null = null, preview: PrPreview | null = null, saves = 0, writes = 0, fail = failOnce, conflictSave = false, remoteBinding = 'b1';
  rows.forEach(r => { r.localStatus = 'completed'; r.localProgress = 100; });
  rows.push({ ...rows[0], requirementId: 'r27', title: '已完成但没有待同步进展的需求', featureId: 'f2', featureName: '日志管理', key: 'TEST-27', sources: [] });
  const statuses = [{ id: 'testing', name: '测试与跨区域集成验证中的较长状态名称' }, { id: 'done', name: '完成' }];
  const issue = (id: string) => ({ id, key: 'TEST-' + id.slice(1), title: '权限管理', typeId: 'story', type: 'Story', status: statuses[0], updated: '1', url: 'https://jira.example.test/browse/TEST-' + id.slice(1) });
  let multiStep = false, alternatives = false;
  const remote = (id: string): PrRemote => {
    const acceptance = { id: 'acceptance', name: '验收' };
    const transitions = [{ id: 'pass', name: '转验收', to: acceptance, requiredFields: [] }];
    if (!multiStep) transitions.unshift({ id: 'finish', name: '完成', to: statuses[1], requiredFields: [] });
    if (alternatives) transitions.push({ id: 'pass-other', name: '复核后转验收', to: acceptance, requiredFields: [] });
    return { issue: issue(id), site: 'https://jira.example.test', bindingVersion: remoteBinding, statuses: [...statuses, acceptance], transitions,
      workflow: { name: '真实工作流', edges: [...transitions.map(t => ({ id: t.id, name: t.name, from: statuses[0], to: t.to })), { id: 'finish2', name: '验收通过', from: acceptance, to: statuses[1] }] }, checkedAt: at };
  };

  await page.route('**/api/me/jira-connection', r => r.fulfill({ json: { configured: true, available: true, baseUrl: 'https://jira.example.test', version: 'v1', verifiedAt: at, identity: '测试用户', problem: null, setupIssue: null } }));
  await page.route('**/api/projects/p1/jira/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, input = request.postData() ? request.postDataJSON() : {};
    if (path.endsWith('/settings')) return route.fulfill({ json: { version: 1, settings: jiraSettingsSchema.parse({}) } });
    if (path.endsWith('/progress')) return route.fulfill({ json: { rows: [] } });
    if (path.endsWith('/prs')) return route.fulfill({ json: pr ? [{ id: pr.id, version: pr.version, state: pr.state, createdAt: at, updatedAt: at, itemCount: pr.items.length }] : [] });
    if (path.endsWith('/candidates')) return route.fulfill({ json: rows });
    if (path.endsWith('/generate-preview')) {
      generation = { id: 'generation', prId: input.prId || null, version: input.version || 0, scope: input.scope, collectedAt: at, warnings: [], items: rows.filter(r => input.scope.featureIds.includes(r.featureId) && !input.scope.excludedRequirementIds.includes(r.requirementId)).map(r => ({ requirementId: r.requirementId, title: r.title, featureName: r.featureName, phaseName: r.phaseName, key: r.key!, issueId: r.requirementId, site: 'https://jira.example.test', bindingVersion: 'b1', basis: '本地：已完成', localStatus: r.localStatus, localProgress: r.localProgress, decisionRequired: false, sources: r.sources, steps: [{ id: 'step-' + r.requirementId, kind: 'transition', body: commentBody(r.sources), sourceIds: r.sources.map(s => s.id), target: statuses[1], transitionId: 'finish', transitionName: '完成', comment: { state: 'pending' }, transition: { state: 'pending' } }] })) };
      return route.fulfill({ json: generation });
    }
    if (path.endsWith('/apply')) { pr = { id: 'pr1', projectId: 'p1', version: 1, state: 'active', startedAt: null, createdAt: at, updatedAt: at, scope: generation!.scope, collectedAt: at, items: generation!.items, warnings: [] }; rows.forEach(r => r.sources.forEach(s => { s.jiraPrId = pr!.id; s.jiraSyncState = 'in_pr'; })); return route.fulfill({ json: pr }); }
    if (path.includes('/remote/')) return route.fulfill({ json: remote(path.split('/').at(-1)!) });
    if (path.endsWith('/target-preview')) {
      const r = remote(input.requirementId), item = pr!.items.find(i => i.requirementId === input.requirementId)!;
      const routes = input.targetId ? targetRoutes(r, input.targetId) : [];
      const selected = input.routeIds ? routes.find(p => JSON.stringify(p.map(e => e.id)) === JSON.stringify(input.routeIds)) : routes.length === 1 ? routes[0] : null;
      if (input.targetId && !selected) return route.fulfill({ json: { version: pr!.version, requirementId: item.requirementId, remote: r, routes, steps: null, retainedComments: 0 } });
      const retained = input.regenerate ? [] : item.steps.filter(s => s.generatedBody === undefined || s.generatedBody !== s.body).map(s => ({ ...s, kind: 'comment' as const, target: null, transitionId: null, transitionName: null }));
      const used = new Set(retained.flatMap(s => s.sourceIds)), sources = item.sources.filter(s => !used.has(s.id));
      const steps: PrStep[] = (selected || []).map((edge, index) => ({ id: 'planned-' + index, kind: 'transition', body: index === 0 && sources.length ? commentBody(sources) : '本地：已完成\n拟将 Jira 状态更新为' + edge.to.name + '。', sourceIds: index === 0 ? sources.map(s => s.id) : [], target: edge.to, transitionId: edge.id, transitionName: edge.name, comment: { state: 'pending' }, transition: { state: 'pending' } }));
      if (!steps.length && sources.length) steps.push({ ...item.steps[0], id: 'summary', kind: 'comment', target: null, transitionId: null, body: commentBody(sources), sourceIds: sources.map(s => s.id) });
      return route.fulfill({ json: { version: pr!.version, requirementId: item.requirementId, remote: r, routes, steps: [...retained, ...steps], retainedComments: retained.filter(s => item.steps.find(old => old.id === s.id)?.kind === 'transition').length } });
    }
    if (path.endsWith('/items')) {
      const row = rows.find(r => r.requirementId === input.requirementId)!;
      pr!.items.push({ ...structuredClone(pr!.items[0]), ...row, key: row.key!, issueId: row.requirementId, steps: [{ ...structuredClone(pr!.items[0].steps[0]), id: 'manual-step', kind: 'comment', target: null, transitionId: null, sourceIds: [], body: '本地：已完成' }] }); pr!.version++; return route.fulfill({ json: pr });
    }
    if (path.endsWith('/manual-sync-preview')) return route.fulfill({ json: { version: 'a'.repeat(64), sources: rows.flatMap(r => r.sources.filter(s => input.ids.includes(s.id)).map(s => ({ ...s, title: r.title, key: r.key }))), affectedPrIds: pr ? [pr.id] : [] } });
    if (path.endsWith('/manual-sync')) {
      rows.forEach(r => r.sources.forEach(s => { if (input.ids.includes(s.id)) { s.jiraSyncState = input.restore ? 'pending' : 'synced'; s.jiraManualAccountId = input.restore ? null : 'manager'; s.jiraManualReason = input.reason; s.jiraSyncedAt = at; } }));
      if (pr) { for (const item of pr.items) { if (item.sources.some(s => input.ids.includes(s.id))) { item.reviewRequired = true; item.sources = item.sources.filter(s => !input.ids.includes(s.id)); item.steps.forEach(s => { s.sourceIds = s.sourceIds.filter(id => !input.ids.includes(id)); }); } } pr.version++; }
      return route.fulfill({ json: { ok: true } });
    }
    if (path.includes('/comments/')) return route.fulfill({ json: { comments: [], nextStartAt: null, total: 0 } });
    if (path.endsWith('/comment-preview')) return route.fulfill({ json: { body: commentBody(pr!.items.find(i => i.requirementId === input.requirementId)!.sources.filter(s => input.sourceIds.includes(s.id))) } });
    if (path.endsWith('/prepare')) { preview = { id: 'preview', prId: pr!.id, version: pr!.version, identity: '测试用户', createdAt: at, items: pr!.items.map(i => ({ requirementId: i.requirementId, issueId: i.issueId, site: i.site, issue: issue(i.requirementId), steps: i.steps, outcome: 'ready' })) }; return route.fulfill({ json: preview }); }
    if (path.endsWith('/execute')) {
      for (const item of pr!.items) for (const step of item.steps) {
        if (step.comment.state !== 'success') { writes++; step.comment = { state: 'success', message: '进展已同步' }; }
        if (step.kind === 'transition' && step.transition.state !== 'success') { writes++; step.transition = fail ? { state: 'failed', message: '状态修改失败' } : { state: 'success', message: '状态已修改' }; }
      }
      pr!.state = fail ? 'active' : 'completed'; fail = false; pr!.startedAt = at; pr!.version++; return route.fulfill({ json: pr });
    }
    if (path.endsWith('/pr1')) {
      if (request.method() === 'PUT' && conflictSave) { conflictSave = false; pr!.version++; pr!.items[0].steps[0].body = '另一位经理补充的进展'; return route.fulfill({ status: 409, json: { error: 'PR 已被其他人修改，请保留当前输入并重新读取', code: 'STALE_WRITE' } }); }
      if (request.method() === 'PUT' && input.version !== pr!.version) return route.fulfill({ status: 409, json: { error: 'PR 已变化', code: 'STALE_WRITE' } });
      if (request.method() === 'PUT') { saves++; pr = { ...pr!, version: pr!.version + 1, items: input.items.map((i: JiraPr['items'][number]) => ({ ...pr!.items.find(old => old.requirementId === i.requirementId)!, ...i, steps: i.steps.map(s => ({ ...s, comment: pr!.items.find(old => old.requirementId === i.requirementId)!.steps.find(old => old.id === s.id)?.comment || { state: 'pending' }, transition: { state: 'pending' } })) })) }; }
      return route.fulfill({ json: pr });
    }
    if (path.endsWith('/progress-state')) { rows.forEach(r => r.sources.forEach(s => { if (input.ids.includes(s.id)) s.jiraSyncState = input.ignored ? 'ignored' : 'pending'; })); return route.fulfill({ json: { ok: true } }); }
    return route.fulfill({ status: 404, json: { error: 'Unexpected mock ' + path } });
  });
  return { multiStep: (multiple = false) => { multiStep = true; alternatives = multiple; }, writes: () => writes, saves: () => saves, pr: () => pr, rows, conflictNextSave: () => { conflictSave = true; }, changeBinding: () => { remoteBinding = 'b2'; } };
}
async function openFirst(page: Page) {
  await page.getByRole('button', { name: '编辑需求 权限管理与跨区域资源授权的长标题需求', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Jira 评论 1', exact: true })).toBeVisible();
}
async function itemMenu(page: Page, name: string) {
  await page.getByRole('button', { name: '需求更多操作', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}
async function commentMenu(page: Page, name: string) {
  await page.getByRole('button', { name: '评论 1 更多操作', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}
async function create(page: Page) {
  await page.goto('/jira/prs?create=1');
  await page.getByRole('combobox', { name: '同步的 Feature', exact: true }).click();
  await page.getByRole('option', { name: '权限管理', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('navigation', { name: 'PR 范围分页' })).toContainText('共 26 条');
  await expect(page.getByText('手动添加评论草稿', { exact: true })).toHaveCount(0);
  await page.getByRole('dialog', { name: '创建 PR', exact: true }).getByRole('button', { name: '创建 PR', exact: true }).click();
  await expect(page.getByRole('table', { name: 'PR 变更清单' })).toBeVisible();
  await openFirst(page);
}
for (const unavailable of ['disabled', 'project', 'personal'] as const) {
  test(`创建 PR 在选择范围前说明连接前提：${unavailable}`, async ({ page }) => {
    const mock = await fixture(page);
    let recovered = false, generationCalls = 0;
    page.on('request', request => { if (request.url().endsWith('/generate-preview')) generationCalls++; });
    await page.route('**/api/me/jira-connection', route => route.fulfill({ json: {
      configured: recovered || unavailable !== 'personal', available: recovered || unavailable !== 'disabled',
      baseUrl: 'https://jira.example.test', version: 'v1', verifiedAt: recovered || unavailable === 'project' ? '2026-09-22T02:00:00Z' : null,
      identity: '测试用户', problem: null, setupIssue: !recovered && unavailable === 'disabled' ? 'disabled' : null,
    } }));
    await page.route('**/api/projects/p1/jira/settings', route => route.fulfill({ json: { version: 1, settings: jiraSettingsSchema.parse({ enabled: recovered || unavailable !== 'project' }) } }));
    await page.goto('/jira/prs?create=1');
    const dialog = page.getByRole('dialog', { name: '创建 PR', exact: true });
    const reason = unavailable === 'disabled' ? '系统管理员已停用 Jira 连接' : unavailable === 'project' ? '项目 Jira 集成已停用' : '请在个人设置中验证 Jira 连接';
    await expect(dialog).toContainText(reason);
    await expect(dialog.getByRole('combobox', { name: '同步的 Feature', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: '创建 PR', exact: true })).toBeDisabled();
    expect(generationCalls).toBe(0); expect(mock.pr()).toBeNull();
    recovered = true;
    await dialog.getByRole('button', { name: '重新读取连接与设置', exact: true }).click();
    await dialog.getByRole('combobox', { name: '同步的 Feature', exact: true }).click();
    await page.getByRole('option', { name: '权限管理', exact: true }).click(); await page.keyboard.press('Escape');
    await dialog.getByRole('button', { name: '创建 PR', exact: true }).click();
    await expect(page.getByRole('table', { name: 'PR 变更清单' })).toBeVisible();
    expect(generationCalls).toBe(1); expect(mock.writes()).toBe(0);
  });
}

test('更新 PR 草稿遇连接读取失败时保留范围并可重试', async ({ page }) => {
  const mock = await fixture(page); await create(page);
  let fail = true;
  await page.route('**/api/me/jira-connection', route => fail
    ? route.fulfill({ status: 503, json: { error: '连接暂时无法读取' } })
    : route.fulfill({ json: { configured: true, available: true, baseUrl: 'https://jira.example.test', version: 'v1', verifiedAt: '2026-09-22T02:00:00Z', identity: '测试用户', problem: null, setupIssue: null } }));
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('button', { name: '更新草稿', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '更新 PR 草稿', exact: true });
  await expect(dialog).toContainText('暂时无法读取 Jira 连接');
  await expect(dialog.getByRole('button', { name: '预览新增内容', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('combobox', { name: '同步的 Feature', exact: true })).toContainText('权限管理');
  fail = false;
  await dialog.getByRole('button', { name: '重新读取连接与设置', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '预览新增内容', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('combobox', { name: '同步的 Feature', exact: true })).toContainText('权限管理');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect(mock.writes()).toBe(0);
});

test('选择特性自动生成全历史 PR，分页、保存和推送完整评论', async ({ page }) => {
  const mock = await fixture(page); await create(page); expect(mock.writes()).toBe(0);
  await expect(page.getByRole('navigation', { name: 'PR 事项分页' })).toContainText('共 26 条');
  await page.getByRole('navigation', { name: 'PR 事项分页' }).getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('.jira-pr-changes .adaptive-data-row')).toHaveCount(6);
  await page.getByRole('searchbox', { name: '搜索 PR 事项' }).fill('长标题');
  await expect(page.locator('.jira-pr-changes .adaptive-data-row')).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Jira 评论 1', exact: true }).fill('人工修改：已经通过接口验证。');
  await expect.poll(mock.saves).toBeGreaterThan(0); await page.reload(); await openFirst(page);
  await expect(page.getByRole('textbox', { name: 'Jira 评论 1', exact: true })).toHaveValue('人工修改：已经通过接口验证。');
  await page.getByRole('button', { name: '推送到 Jira', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '确认推送到 Jira' });
  await expect(dialog).toContainText('人工修改：已经通过接口验证。'); await expect(dialog).toContainText('[PM-PR:');
  await dialog.getByRole('button', { name: '确认推送到 Jira', exact: true }).click();
  await expect(page.getByRole('button', { name: '推送到 Jira', exact: true })).toBeDisabled();
  expect(mock.writes()).toBe(52);
});
test('摘要简短且人工评论在重新生成和推送预览中完整保留', async ({ page }) => {
  const mock = await fixture(page);
  const note = '发现10个bug，部分文件需要解密。\n\n请保留原文：\n- 不省略历史问题\n- 报告 https://example.test/report';
  mock.rows[0].sources[0].content = note;
  mock.rows[0].sources.push({ ...mock.rows[0].sources[0], id: 'repeated-note', createdAt: '2026-01-02T01:00:00Z' });
  await create(page);
  const textarea = page.getByRole('textbox', { name: 'Jira 评论 1', exact: true });
  const original = await textarea.inputValue();
  expect(original.split('\n\n')[0]).toBe('进展摘要\n2026-08-07 开发已完成。');
  expect(original.split(note)).toHaveLength(3); expect(original).not.toContain('历时');
  await commentMenu(page, '重新生成评论');
  const regeneration = page.getByRole('dialog', { name: '重新生成评论预览' });
  expect((await regeneration.locator('pre').innerText()).split(note)).toHaveLength(3);
  await regeneration.getByRole('button', { name: '替换当前评论', exact: true }).click();
  await expect(textarea).toHaveValue(original);
  await page.getByRole('button', { name: '推送到 Jira', exact: true }).click();
  const preview = page.getByRole('dialog', { name: '确认推送到 Jira' });
  expect((await preview.locator('pre').first().innerText()).split(note)).toHaveLength(3);
  expect(mock.writes()).toBe(0);
  await preview.getByRole('button', { name: '确认推送到 Jira', exact: true }).click();
  await expect.poll(() => mock.pr()?.items[0].steps[0].comment.state).toBe('success');
  expect(mock.pr()!.items[0].steps[0].body).toBe(original);
});

test('评论已发布但状态失败后，重新推送不再发送评论', async ({ page }) => {
  const mock = await fixture(page, true); await create(page);
  await page.getByRole('button', { name: '推送到 Jira', exact: true }).click();
  await page.getByRole('button', { name: '确认推送到 Jira', exact: true }).click();
  await expect(page.getByText('状态修改失败', { exact: true })).toBeVisible(); expect(mock.writes()).toBe(52);
  await page.getByRole('button', { name: '推送到 Jira', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('评论已经发布，本次不重复发送');
  await page.getByRole('button', { name: '确认推送到 Jira', exact: true }).click();
  await expect.poll(mock.writes).toBe(78);
});
test('多人修改冲突保留本地输入，比较后再保存', async ({ page }) => {
  const mock = await fixture(page); await create(page); mock.conflictNextSave();
  const input = page.getByRole('textbox', { name: 'Jira 评论 1', exact: true }); await input.fill('我这次会议记录的进展');
  await expect(page.getByText('PR 已被其他人修改，请保留当前输入并重新读取', { exact: true })).toBeVisible(); await expect(input).toHaveValue('我这次会议记录的进展');
  await page.getByRole('button', { name: '读取并比较服务端草稿', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '草稿版本对比' }); await expect(dialog).toContainText('另一位经理补充的进展'); await expect(dialog).toContainText('我这次会议记录的进展');
  await dialog.getByRole('button', { name: '保留本地内容并保存', exact: true }).click();
  await expect.poll(mock.saves).toBeGreaterThan(0); expect(mock.pr()!.items[0].steps[0].body).toBe('我这次会议记录的进展'); expect(mock.writes()).toBe(0);
});
test('切换最终目标保留人工正文，关联变化不混用新旧状态', async ({ page }) => {
  const mock = await fixture(page); await create(page);
  const input = page.getByRole('textbox', { name: 'Jira 评论 1', exact: true });
  await input.fill('人工补充：接口验证已通过。');
  const choice = page.getByRole('combobox', { name: '本次同步到 TEST-1', exact: true });
  await expect(choice).toBeEnabled(); await choice.click();
  await page.getByRole('option', { name: '保持状态，仅发评论', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '确认目标变更' }); await expect(confirmation).toContainText('人工补充：接口验证已通过。');
  await confirmation.getByRole('button', { name: '保留评论并应用目标' }).click();
  await expect(input).toHaveValue('人工补充：接口验证已通过。'); await expect.poll(mock.saves).toBeGreaterThan(0);
  mock.changeBinding(); await itemMenu(page, '刷新当前 Jira 状态');
  await expect(page.getByText('关联已变化', { exact: true })).toBeVisible(); await expect(choice).toBeDisabled(); expect(mock.writes()).toBe(0);
});

test('重新生成评论必须确认替换，进展同步记录支持真实分页和排除恢复', async ({ page }) => {
  const mock = await fixture(page); await create(page);
  const textarea = page.getByRole('textbox', { name: 'Jira 评论 1', exact: true }), original = await textarea.inputValue();
  await commentMenu(page, '重新生成评论');
  await expect(page.getByRole('dialog', { name: '重新生成评论预览' })).toBeVisible();
  await page.getByRole('button', { name: '保留原文', exact: true }).click(); await expect(textarea).toHaveValue(original);
  mock.rows.forEach(r => r.sources.forEach(s => { s.jiraSyncState = 'pending'; s.jiraPrId = null; }));
  await page.goto('/jira/prs?view=history'); await page.getByRole('button', { name: '进展同步记录', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '进展同步记录分页' })).toContainText('共 26 条');
  await page.getByRole('checkbox', { name: '选择进展 s0', exact: true }).check();
  await page.getByRole('button', { name: '不再同步', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '进展同步记录分页' })).toContainText('共 25 条');
  expect(mock.writes()).toBe(0);
});
test('一次选择最终目标生成整条路径和多个评论，草稿中添加独立评论', async ({ page }) => {
  const mock = await fixture(page); await create(page);
  const tabs = page.getByRole('group', { name: 'Jira 视图' });
  await expect(tabs).toContainText('发现未纳入需求');
  await expect(page.locator('.jira-pr-changes .is-selected')).toContainText('100%');
  await page.getByRole('button', { name: '添加需求与评论', exact: true }).click();
  const add = page.getByRole('dialog', { name: '添加需求与评论' });
  await add.getByRole('button', { name: '加入草稿 已完成但没有待同步进展的需求', exact: true }).click();
  await expect(page.locator('.jira-pr-changes .is-selected')).toContainText('已完成但没有待同步进展');
  await expect(page.getByRole('textbox', { name: 'Jira 评论 1', exact: true })).toHaveValue('本地：已完成');
  await page.getByRole('button', { name: '添加评论', exact: true }).click();
  await page.getByRole('textbox', { name: 'Jira 评论 2', exact: true }).fill('人工新增评论');
  await expect.poll(() => mock.pr()?.items.at(-1)?.steps.at(-1)?.body).toBe('人工新增评论');
  await expect(tabs.getByRole('button', { name: 'PR', exact: true })).toBeEnabled();
  await tabs.getByRole('button', { name: 'PR', exact: true }).click();
  await expect(page).toHaveURL(/\/jira\/prs\/pr1/);
  await page.getByRole('searchbox', { name: '搜索 PR 事项' }).fill('长标题'); await openFirst(page);
  mock.multiStep();
  await itemMenu(page, '刷新当前 Jira 状态');
  await itemMenu(page, '精简并重新生成本项评论');
  const preview = page.getByRole('dialog', { name: '重新生成本项评论' });
  await expect(preview).toContainText('转入验收时的评论'); await expect(preview).toContainText('转入完成时的评论');
  await preview.getByRole('button', { name: '确认替换未发布评论' }).click();
  await expect(page.getByRole('textbox', { name: 'Jira 评论 2', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: /Jira 操作/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '上移操作' })).toHaveCount(0);
  await expect(page.getByRole('list', { name: '拟执行状态路径' })).toContainText('验收');
  await expect.poll(() => mock.pr()?.items[0].steps.map(s => s.target?.id)).toEqual(['acceptance', 'done']); expect(mock.writes()).toBe(0);
});

test('多路径选择整条路线，精简预览取消不覆盖正文', async ({ page }) => {
  const mock = await fixture(page); await create(page); mock.multiStep(true);
  const original = await page.getByRole('textbox', { name: 'Jira 评论 1', exact: true }).inputValue();
  await itemMenu(page, '精简并重新生成本项评论');
  const dialog = page.getByRole('dialog', { name: '重新生成本项评论' });
  await expect(dialog.locator('.jira-pr-route-options button')).toHaveCount(2);
  await dialog.locator('.jira-pr-route-options button').nth(1).click();
  await expect(dialog).toContainText('转入验收时的评论');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Jira 评论 1', exact: true })).toHaveValue(original); expect(mock.writes()).toBe(0);
});

test('人工同步确认保留正文、去除来源并可以撤销', async ({ page }) => {
  const mock = await fixture(page); await create(page);
  const body = await page.getByRole('textbox', { name: 'Jira 评论 1', exact: true }).inputValue();
  await itemMenu(page, '标记已在 Jira 同步');
  const dialog = page.getByRole('dialog', { name: '标记已在 Jira 同步', exact: true });
  await dialog.getByRole('textbox', { name: '人工同步确认说明' }).fill('会议后已经手动同步');
  await dialog.getByRole('checkbox', { name: '我已核对 Jira，所选进展已经同步' }).check();
  await dialog.getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.getByRole('button', { name: '已检查评论正文', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Jira 评论 1', exact: true })).toHaveValue(body);
  expect(mock.pr()!.items[0].steps[0].sourceIds).toEqual([]);
  await page.goto('/jira/prs?view=history'); await page.getByRole('button', { name: '进展同步记录', exact: true }).click();
  await page.getByRole('combobox', { name: '进展同步状态', exact: true }).click();
  await page.getByRole('option', { name: '已同步', exact: true }).click();
  await page.getByRole('checkbox', { name: '选择进展 s0', exact: true }).check();
  await page.getByRole('button', { name: '撤销人工确认', exact: true }).click();
  const undo = page.getByRole('dialog', { name: '撤销人工同步确认' });
  await undo.getByRole('textbox', { name: '人工同步确认说明' }).fill('误选，重新收集');
  await undo.getByRole('checkbox', { name: '确认将所选进展恢复待同步' }).check();
  await undo.getByRole('button', { name: '确认', exact: true }).click();
  await expect.poll(() => mock.rows[0].sources[0].jiraSyncState).toBe('pending'); expect(mock.writes()).toBe(0);
});

test('首次进入在同一框架内加载，不闪现空历史或未验证状态', async ({ page }) => {
  const mock = await fixture(page); await create(page);
  const gate = () => { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; };
  const list = gate(), detail = gate(), connection = gate(), progress = gate();
  let progressReads = 0;
  await page.route('**/api/projects/p1/jira/prs', async route => { await list.promise; await route.fallback(); });
  await page.route('**/api/projects/p1/jira/prs/pr1', async route => { await detail.promise; await route.fallback(); });
  await page.route('**/api/me/jira-connection', async route => { await connection.promise; await route.fallback(); });
  await page.route('**/api/projects/p1/jira/progress', async route => { progressReads++; await progress.promise; await route.fallback(); });
  try {
    await page.goto('/jira/prs');
    const tabs = page.getByRole('group', { name: 'Jira 视图' });
    await expect(page.getByText('正在读取 PR 内容…', { exact: true })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Jira PR 列表' })).toHaveCount(0);
    await expect(page.getByText('暂无 PR', { exact: true })).toHaveCount(0);
    const initialTabs = await tabs.boundingBox();
    const initialTable = await page.getByRole('table', { name: 'PR 变更清单' }).boundingBox();
    list.release();
    await expect(page.getByText('正在读取 PR 内容…', { exact: true })).toBeVisible();
    detail.release();
    await expect(page.locator('.jira-pr-changes .adaptive-data-row')).toHaveCount(20);
    expect((await tabs.boundingBox())!.y).toBe(initialTabs!.y);
    expect((await page.getByRole('table', { name: 'PR 变更清单' }).boundingBox())!.y).toBe(initialTable!.y);
    await expect(page.getByText('个人连接：正在读取…', { exact: true })).toBeVisible();
    await expect(page.getByText('个人连接：未验证', { exact: true })).toHaveCount(0);
    await expect(page.locator('.jira-pr-changes [data-column=remote]').nth(1)).toHaveText('正在读取…');
    expect(progressReads).toBe(0);
    connection.release();
    await expect.poll(() => progressReads).toBe(1);
    await expect(page.locator('.jira-pr-changes [data-column=remote]').nth(1)).toHaveText('正在读取…');
    progress.release();
    await expect(page.locator('.jira-pr-changes [data-column=remote]').nth(1)).toHaveText('尚未读取');
    expect(progressReads).toBe(1); expect(mock.writes()).toBe(0);
  } finally { list.release(); detail.release(); connection.release(); progress.release(); }
});

test('读取 PR 失败可重试，没有 Token 仍展示草稿且不误报为空', async ({ page }) => {
  const mock = await fixture(page); await create(page);
  let fail = true;
  await page.route('**/api/projects/p1/jira/prs/pr1', route => fail ? route.fulfill({ status: 503, json: { error: '暂时无法读取 PR，请稍后重试' } }) : route.fallback());
  await page.route('**/api/me/jira-connection', route => route.fulfill({ json: { configured: false, available: true, baseUrl: 'https://jira.example.test', version: 'none', verifiedAt: null, identity: null, problem: null, setupIssue: null } }));
  await page.goto('/jira/prs/pr1');
  await expect(page.getByText('PR 暂时无法读取', { exact: true })).toBeVisible();
  await expect(page.getByText('暂无 PR', { exact: true })).toHaveCount(0);
  fail = false; await page.getByRole('button', { name: '重新读取', exact: true }).click();
  await expect(page.locator('.jira-pr-changes .adaptive-data-row')).toHaveCount(20);
  await openFirst(page);
  await expect(page.getByRole('combobox', { name: '本次同步到 TEST-1', exact: true })).toBeDisabled();
  await expect(page.getByText('个人连接：未验证', { exact: true })).toBeVisible();
  expect(mock.writes()).toBe(0);
});

test('待处理直接定位需求，解决后消失，未纳入内容保留在生成记录', async ({ page }) => {
  const mock = await fixture(page); await create(page);
  mock.pr()!.warnings = ['未关联的设计需求：18 条进展未关联当前 Jira 站点，仍保持待同步', '旧记录：请确认到达完成的路径'];
  mock.pr()!.items[0].reviewRequired = true;
  await page.reload();
  await expect(page.getByText(/生成提示/)).toHaveCount(0);
  await expect(page.getByText('待检查评论', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'PR 处理情况' }).click();
  await page.getByRole('option', { name: '待处理', exact: true }).click();
  await expect(page.locator('.jira-pr-changes .adaptive-data-row')).toHaveCount(1);
  await openFirst(page);
  await page.getByRole('button', { name: '已检查评论正文', exact: true }).click();
  await expect(page.getByText('0 项待处理', { exact: true })).toBeVisible();
  await expect(page.getByText('没有符合条件的需求', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '查看生成记录', exact: true }).click();
  const record = page.getByRole('dialog', { name: '生成记录', exact: true });
  await expect(record).toContainText('18 条进展未关联');
  await expect(record).toContainText('当前处理情况以需求列表为准');
  expect(mock.writes()).toBe(0);
});

test('创建范围支持多特性且保持紧凑行和固定操作栏', { tag: '@responsive' }, async ({ page }, info) => {
  const mock = await fixture(page); await page.goto('/jira/prs?create=1');
  const modal = page.getByRole('dialog', { name: '创建 PR', exact: true });
  await page.getByRole('combobox', { name: '同步的 Feature', exact: true }).click();
  await page.getByRole('option', { name: '权限管理', exact: true }).click();
  await page.getByRole('option', { name: '日志管理', exact: true }).click();
  await expect(page.getByRole('option', { name: '权限管理', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('option', { name: '日志管理', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(modal).toContainText('27 个需求');
  for (const viewport of [page.viewportSize()!, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const row = modal.locator('.adaptive-data-row').first(); await expect(row).toBeVisible();
    const bounds = (await row.boundingBox())!; expect(bounds.height).toBeLessThan(viewport.width > 1000 ? 82 : 145);
    await expect(modal.getByRole('button', { name: '创建 PR', exact: true })).toBeInViewport();
    expect(await modal.locator('.jira-pr-scope-body').evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath('pr-create-' + viewport.width + '.png'), animations: 'disabled' });
  }
  await modal.getByRole('button', { name: '创建 PR', exact: true }).click();
  await openFirst(page);
  expect(mock.pr()!.scope.featureIds).toEqual(['f1', 'f2']); expect(mock.pr()!.items).toHaveLength(27); expect(mock.writes()).toBe(0);
});

test('PR 工作区和统一浮窗在桌面与手机不溢出', { tag: '@responsive' }, async ({ page }, info) => {
  await fixture(page); await create(page);
  for (const viewport of [page.viewportSize()!, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: '编辑需求 权限管理与跨区域资源授权的长标题需求', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Jira 评论 1', exact: true })).toHaveCount(0);
    const table = page.getByRole('table', { name: 'PR 变更清单' });
    const border = await table.evaluate(el => {
      const style = getComputedStyle(el);
      return { radius: style.borderTopLeftRadius, token: style.getPropertyValue('--surface-radius-compact').trim(), left: style.borderLeftWidth, right: style.borderRightWidth };
    });
    expect(border.radius).toBe(border.token); expect(parseFloat(border.radius)).toBeGreaterThan(0);
    expect(border.left).toBe('1px'); expect(border.right).toBe('1px');
    expect(await page.locator('.jira-pr-filters>.select-field').evaluateAll(els => els.every(el => getComputedStyle(el).marginLeft === '0px'))).toBe(true);
    const controls = await page.locator('.jira-pr-filters :is(.search-box,.select-trigger)').evaluateAll(els => els.map(el => el.getBoundingClientRect().height));
    expect(Math.max(...controls) - Math.min(...controls)).toBeLessThanOrEqual(1);
    if (viewport.width < 640) {
      const feature = (await page.getByRole('combobox', { name: 'PR Feature', exact: true }).boundingBox())!;
      const phase = (await page.getByRole('combobox', { name: 'PR Phase', exact: true }).boundingBox())!;
      expect(feature.y).toBe(phase.y); expect(Math.abs(feature.width - phase.width)).toBeLessThanOrEqual(1);
    }
    await page.screenshot({ path: info.outputPath('pr-overview-' + viewport.width + '.png'), animations: 'disabled' });
    await openFirst(page);
    await expect(page.getByRole('textbox', { name: 'Jira 评论 1', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const box = await page.getByRole('textbox', { name: 'Jira 评论 1', exact: true }).boundingBox(); expect(box!.width).toBeGreaterThan(200);
    expect(await page.getByRole('textbox', { name: 'Jira 评论 1', exact: true }).evaluate(el => el.scrollHeight <= el.clientHeight + 2)).toBe(true);
    const collapsed = page.locator('.jira-pr-changes .adaptive-data-row').nth(1);
    if (viewport.width >= 1280) expect((await collapsed.boundingBox())!.height).toBeLessThan(90);
    if (viewport.width >= 1280) {
      expect(await table.locator('.paged-body').evaluate(el => el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY === 'auto')).toBe(true);
      await expect(page.getByRole('navigation', { name: 'PR 事项分页' })).toBeInViewport({ ratio: 1 });
    }
    await page.screenshot({ path: info.outputPath('pr-workspace-' + viewport.width + '.png'), animations: 'disabled' });
    await page.getByRole('button', { name: '推送到 Jira', exact: true }).click();
    const modal = page.getByRole('dialog', { name: '确认推送到 Jira' }); await expect(modal).toBeVisible();
    await expect(modal).toHaveCSS('opacity', '1');
    const bounds = (await modal.boundingBox())!; expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
    await expect(modal.getByRole('button', { name: '确认推送到 Jira', exact: true })).toBeInViewport();
    await page.screenshot({ path: info.outputPath('pr-confirm-' + viewport.width + '.png'), animations: 'disabled' });
    await modal.getByRole('button', { name: '返回修改', exact: true }).click();
  }
});
