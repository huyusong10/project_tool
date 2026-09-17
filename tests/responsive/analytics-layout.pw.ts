import { expect, test, type Page } from '@playwright/test';
import {headerAction} from './topbar-helpers';
import { analyticsCatalog, defaultAnalyticsLayout, type AnalyticsLayout } from '../../src/shared/analytics';
import { chooseOption, selectedValue } from './select-helper';

test('切换指标后保留有效分组并选择兼容图表，真实预览与保存均成功', async ({ page }) => {
  const login=await page.request.post('/api/login',{data:{username:'admin',password:'41_xc7q0qOjo4Inw!'}});
  expect(login.ok()).toBe(true);
  const session=await login.json();
  const created=await page.request.post('/api/projects',{data:{name:'统计配置核对 '+Date.now()}});
  expect(created.ok()).toBe(true);
  const project=await created.json();
  await page.addInitScript(({accountId,projectId})=>localStorage.setItem('project-manage:selected-project:'+accountId,projectId),{accountId:session.accountId,projectId:project.id});
  await page.goto('/analytics');
  await page.getByRole('button',{name:'编辑看板',exact:true}).click();
  await page.getByRole('button',{name:'编辑风险分布',exact:true}).click();
  const editor=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'配置分析图表',exact:true})});
  const previewPromise=page.waitForResponse(response=>response.url().endsWith('/api/analytics/query')&&response.request().method()==='POST'&&response.request().postDataJSON().panels.length===1&&response.request().postDataJSON().panels[0].measure==='finish_variance');
  await chooseOption(editor.getByRole('combobox',{name:'指标',exact:true}),'finish_variance');
  const preview=await previewPromise;
  expect(preview.status(),await preview.text()).toBe(200);
  await expect(selectedValue(editor.getByRole('combobox',{name:'分组维度',exact:true}))).toHaveValue('risk');
  await expect(selectedValue(editor.getByRole('combobox',{name:'图表类型',exact:true}))).toHaveValue('bar');
  await editor.getByLabel('图表标题',{exact:true}).fill('按风险查看完成偏差');
  await editor.getByRole('button',{name:'应用配置',exact:true}).click();
  await page.getByRole('button',{name:'保存布局',exact:true}).click();
  await expect(page.getByRole('button',{name:'编辑看板',exact:true})).toBeVisible();
  const saved=await page.request.get('/api/analytics/layout');
  expect(saved.ok()).toBe(true);
  expect((await saved.json()).layout.panels.find((panel:{id:string})=>panel.id==='risk-distribution')).toMatchObject({title:'按风险查看完成偏差',measure:'finish_variance',dimension:'risk',visualization:'bar'});
  await page.reload();
  await page.getByRole('button',{name:'编辑看板',exact:true}).click();
  await page.getByRole('button',{name:'编辑按风险查看完成偏差',exact:true}).click();
  await expect(selectedValue(editor.getByRole('combobox',{name:'指标',exact:true}))).toHaveValue('finish_variance');
  await expect(selectedValue(editor.getByRole('combobox',{name:'图表类型',exact:true}))).toHaveValue('bar');
  const ungroupedPromise=page.waitForResponse(response=>response.url().endsWith('/api/analytics/query')&&response.request().method()==='POST'&&response.request().postDataJSON().panels.length===1&&response.request().postDataJSON().panels[0].measure==='completed_count');
  await chooseOption(editor.getByRole('combobox',{name:'指标',exact:true}),'completed_count');
  const ungrouped=await ungroupedPromise;
  expect(ungrouped.status(),await ungrouped.text()).toBe(200);
  await expect(selectedValue(editor.getByRole('combobox',{name:'分组维度',exact:true}))).toHaveValue('');
  await expect(selectedValue(editor.getByRole('combobox',{name:'图表类型',exact:true}))).toHaveValue('kpi');
  await editor.getByRole('button',{name:'取消',exact:true}).click();
});

async function mockAnalytics(page: Page) {
  let layout = structuredClone(defaultAnalyticsLayout);
  let updatedAt = '2026-09-04T00:00:00.000Z';
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/session') return route.fulfill({ json: { authenticated: true, accountId: 'admin', username: 'admin', role: 'admin', globalRole: 'admin', personId: null, mustChangePassword: false, managedProjectIds: [] } });
    if (url.pathname === '/api/projects') return route.fulfill({ json: [{ id: 'p1', name: '分析测试项目', status: 'active', plannedStart: '2026-01-01', plannedEnd: '2026-12-31', defaultTemplateId: null, isSample: false }] });
    if (url.pathname === '/api/analytics/catalog') return route.fulfill({ json: analyticsCatalog });
    if (url.pathname === '/api/analytics/layout' && route.request().method() === 'GET') return route.fulfill({ json: { layout, source: 'personal', canCustomize: true, updatedAt } });
    if (url.pathname === '/api/analytics/query') return route.fulfill({ json: { range: route.request().postDataJSON().range, results: [] } });
    return route.fulfill({ json: {} });
  });
  return {
    setLayout(next: AnalyticsLayout, nextUpdatedAt: string) { layout = next; updatedAt = nextUpdatedAt; },
  };
}

test.describe('北京时间分析默认范围', () => {
  test.use({ timezoneId: 'America/Los_Angeles' });

  test('自定义范围跨日更新系统默认并保留手动范围', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-05T15:59:30.000Z') });
    await mockAnalytics(page);
    await page.goto('/analytics');
    await page.getByRole('button', { name: '自定义', exact: true }).click();
    const from = page.getByLabel('分析开始日期', { exact: true });
    const to = page.getByLabel('分析结束日期', { exact: true });
    await expect(from).toHaveValue('2026-06-08');
    await expect(to).toHaveValue('2026-09-05');

    await page.clock.fastForward(90_000);
    await expect(from).toHaveValue('2026-06-09');
    await expect(to).toHaveValue('2026-09-06');

    await to.fill('2026-09-04');
    await page.clock.setSystemTime(new Date('2026-09-06T16:01:00.000Z'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(from).toHaveValue('2026-06-09');
    await expect(to).toHaveValue('2026-09-04');
  });
});

test('统计图的长需求名可在悬浮提示中完整阅读且不撑出页面',async({page},info)=>{
  const server=await mockAnalytics(page),label='跨系统资源同步与资产校验'.repeat(12);
  const panel={...defaultAnalyticsLayout.panels.find(p=>p.id==='variance-top')!,size:'large' as const};
  server.setLayout({...defaultAnalyticsLayout,panels:[panel]},'2026-09-17T00:00:00.000Z');
  await page.route('**/api/analytics/query',route=>route.fulfill({json:{asOfDate:'2026-09-17',range:route.request().postDataJSON().range,results:[{panelId:panel.id,measureLabel:'延期工作日',unit:'days',snapshot:true,rows:[{key:'long-name',label,value:8}]}]}}));
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/analytics');
  const chart=page.getByRole('img',{name:panel.title+'图表'});
  for(const width of [1280,390]){
    await page.setViewportSize({width,height:850});await chart.scrollIntoViewIfNeeded();
    await expect.poll(async()=>Math.round((await chart.locator('canvas').boundingBox())!.width)).toBe(Math.round((await chart.boundingBox())!.width));
    const bounds=(await chart.boundingBox())!;
    await chart.hover({position:{x:Math.min(180,bounds.width-24),y:bounds.height/2}});
    const tooltip=chart.locator(':scope > div').filter({hasText:label}).last();
    await expect(tooltip).toBeVisible();await expect(tooltip).toContainText('8');
    await page.screenshot({path:info.outputPath('long-chart-label-'+width+'.png'),animations:'disabled'});
    const box=(await tooltip.boundingBox())!;
    expect.soft(box.x,'提示左侧应可见').toBeGreaterThanOrEqual(0);
    expect.soft(box.x+box.width,'提示右侧应可见').toBeLessThanOrEqual(width);
    expect.soft(await tooltip.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'提示内部应完整换行').toBe(true);
    expect.soft(box.y+box.height,'提示应位于图表底边之内').toBeLessThanOrEqual(bounds.y+bounds.height+1);
    expect.soft(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'提示不能撑宽页面').toBe(true);
    await page.mouse.move(0,0);
  }
});

test('分析卡片显示服务端快照日期', async ({ page }) => {
  await mockAnalytics(page);
  const graphRequests:string[]=[];
  page.on('request',request=>{if(/\/path-(analysis|graph)(\?|$)/.test(request.url()))graphRequests.push(request.url());});
  await page.route('**/api/analytics/query', (route) => {
    const request = route.request().postDataJSON();
    return route.fulfill({ json: {
      asOfDate: '2026-02-16',
      range: request.range,
      results: request.panels.map((panel: { id: string; measure: string; timeScope: string }) => ({
        panelId: panel.id,
        rows: [{ key: 'all', label: '全部', value: 1 }],
        measureLabel: panel.measure,
        unit: 'count',
        snapshot: panel.timeScope === 'snapshot',
      })),
    } });
  });
  await page.goto('/analytics');
  const snapshot = page.locator('.analytics-panel').filter({ hasText: '活跃需求' });
  await expect(snapshot.locator('header span')).toHaveText('截至 2026-02-16');
  const future = page.locator('.analytics-panel').filter({ hasText: '未来30天到期需求' });
  await expect(future.locator('header span')).toHaveText('2026-02-16 起30天');
  expect(graphRequests).toEqual([]);
});

test('saving an analytics layout locks the draft and duplicate submit', async ({ page }) => {
  const server = await mockAnalytics(page);
  let releaseSave!: () => void;
  const waitingSave = new Promise<void>((resolve) => { releaseSave = resolve; });
  let requests = 0;
  const payloads: Array<Record<string, unknown>> = [];
  await page.route('**/api/analytics/layout', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    requests++;
    const body = route.request().postDataJSON() as AnalyticsLayout & { expectedUpdatedAt: string | null };
    payloads.push(body);
    const layout = { version: body.version, panels: body.panels } as AnalyticsLayout;
    await waitingSave;
    if (requests === 1) return route.fulfill({ status: 500, json: { error: '布局暂时无法保存' } });
    server.setLayout(layout, '2026-09-05T00:00:00.000Z');
    return route.fulfill({ json: { layout, source: 'personal', canCustomize: true, updatedAt: '2026-09-05T00:00:00.000Z' } });
  });

  try {
    await page.goto('/analytics');
    await page.getByRole('button', { name: '编辑看板', exact: true }).click();
    const save = page.getByRole('button', { name: '保存布局', exact: true });
    await save.evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await expect.poll(() => requests).toBe(1);
    await expect(save).toBeDisabled();
    await expect(page.getByRole('button', { name: '取消编辑', exact: true })).toBeDisabled();
    await page.getByRole('button', {name:'更多操作', exact:true}).click();
    await expect(page.getByRole('button', { name: '新增图表', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '恢复默认', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.locator('.analytics-drag-handle').first()).toBeDisabled();
    await expect(page.locator('.analytics-panel-actions button').first()).toBeDisabled();
  } finally { releaseSave(); }
  await expect(page.getByText('布局暂时无法保存', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存布局', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '取消编辑', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '保存布局', exact: true }).click();
  await expect.poll(() => requests).toBe(2);
  expect(payloads.map((payload) => payload.expectedUpdatedAt)).toEqual(['2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z']);
  await expect(page.getByRole('button', { name: '编辑看板', exact: true })).toBeVisible();
});

test('stale analytics draft reloads the latest layout before retrying', async ({ page }) => {
  const server = await mockAnalytics(page);
  const expectedVersions: Array<string | null> = [];
  let requests = 0;
  await page.route('**/api/analytics/layout', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    requests++;
    const body = route.request().postDataJSON() as AnalyticsLayout & { expectedUpdatedAt: string | null };
    expectedVersions.push(body.expectedUpdatedAt);
    if (requests === 1) {
      const latest = structuredClone(defaultAnalyticsLayout);
      latest.panels[0].title = '其他会话保存的布局';
      server.setLayout(latest, '2026-09-05T00:00:00.000Z');
      return route.fulfill({ status: 409, json: { error: '个人分析布局已被其他会话修改，请重新读取后再保存', code: 'STALE_WRITE' } });
    }
    const layout = { version: body.version, panels: body.panels } as AnalyticsLayout;
    return route.fulfill({ json: { layout, source: 'personal', canCustomize: true, updatedAt: '2026-09-06T00:00:00.000Z' } });
  });

  await page.goto('/analytics');
  await page.getByRole('button', { name: '编辑看板', exact: true }).click();
  await page.getByRole('button', { name: '保存布局', exact: true }).click();
  await expect(page.getByRole('button', { name: '放弃草稿并读取最新布局', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '放弃草稿并读取最新布局', exact: true }).click();
  await expect(page.getByText('其他会话保存的布局', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保存布局', exact: true }).click();
  await expect.poll(() => requests).toBe(2);
  expect(expectedVersions).toEqual(['2026-09-04T00:00:00.000Z', '2026-09-05T00:00:00.000Z']);
});

test('analytics layout result unknown reads back and confirms the saved layout', async ({ page }) => {
  const server = await mockAnalytics(page);
  let requests = 0;
  await page.route('**/api/analytics/layout', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    requests++;
    const body = route.request().postDataJSON() as AnalyticsLayout & { expectedUpdatedAt: string | null };
    server.setLayout({ version: body.version, panels: body.panels }, '2026-09-05T00:00:00.000Z');
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>invalid write response</html>' });
  });
  await page.goto('/analytics');
  await page.getByRole('button', { name: '编辑看板', exact: true }).click();
  const save = page.getByRole('button', { name: '保存布局', exact: true });
  await save.click();
  await expect(page.getByRole('button', { name: '编辑看板', exact: true })).toBeVisible();
  await expect(page.getByText(/操作结果暂时无法确认/)).toHaveCount(0);
  expect(requests).toBe(1);
});

test('分析布局响应未知且回读失败时跨导航保留草稿和写入锁', async ({ page }) => {
  const server = await mockAnalytics(page);
  let failRead = false;
  let requests = 0;
  await page.route('**/api/analytics/layout', (route) => {
    if (route.request().method() === 'GET') return failRead
      ? route.fulfill({ status: 503, json: { error: '布局暂时无法读取' } })
      : route.fallback();
    if (route.request().method() !== 'PUT') return route.fallback();
    requests++;
    const body = route.request().postDataJSON() as AnalyticsLayout & { expectedUpdatedAt: string | null };
    server.setLayout({ version: body.version, panels: body.panels }, '2026-09-05T00:00:00.000Z');
    failRead = true;
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/analytics');
  await page.getByRole('button', { name: '编辑看板', exact: true }).click();
  await page.getByRole('button', { name: '编辑活跃需求', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '配置分析图表', exact: true });
  await editor.getByLabel('图表标题', { exact: true }).fill('跨导航保留的活跃需求');
  await editor.getByRole('button', { name: '应用配置', exact: true }).click();
  const save = page.getByRole('button', { name: '保存布局', exact: true });
  await save.click();
  await expect(page.getByText(/操作结果暂时无法确认/)).toBeVisible();

  await page.getByRole('link', { name: '项目中心', exact: true }).click();
  await page.goBack();
  await expect(page.getByRole('alert').filter({ hasText: '布局保存结果待核对' })).toBeVisible();
  await expect(page.getByText('跨导航保留的活跃需求', { exact: true })).toBeVisible();
  await expect(save).toBeDisabled();
  await save.evaluate((button) => (button as HTMLButtonElement).click());
  expect(requests).toBe(1);

  failRead = false;
  await page.getByRole('button', { name: '重新读取布局', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑看板', exact: true })).toBeVisible();
  await expect(page.getByText('跨导航保留的活跃需求', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: '布局保存结果待核对' })).toHaveCount(0);
  expect(requests).toBe(1);
});

test('analytics layout reset result unknown reads back and confirms the default layout', async ({ page }) => {
  await mockAnalytics(page);
  let personal = true;
  let requests = 0;
  await page.route('**/api/analytics/layout', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: {
      layout: defaultAnalyticsLayout,
      source: personal ? 'personal' : 'default',
      canCustomize: true,
      updatedAt: personal ? '2026-09-04T00:00:00.000Z' : null,
    } });
    if (route.request().method() !== 'DELETE') return route.fallback();
    requests++;
    personal = false;
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>invalid write response</html>' });
  });

  await page.goto('/analytics');
  await page.getByRole('button', { name: '编辑看板', exact: true }).click();
  await headerAction(page, '恢复默认');
  const dialog = page.getByRole('dialog', { name: '恢复默认看板', exact: true });
  await dialog.getByRole('button', { name: '恢复默认', exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: '编辑看板', exact: true })).toBeVisible();
  await expect(page.getByText(/操作结果暂时无法确认/)).toHaveCount(0);
  expect(requests).toBe(1);
});

test('恢复默认布局响应未知且回读失败时跨导航保持锁定', async ({ page }) => {
  await mockAnalytics(page);
  let personal = true;
  let failRead = false;
  let requests = 0;
  await page.route('**/api/analytics/layout', (route) => {
    if (route.request().method() === 'GET') return failRead
      ? route.fulfill({ status: 503, json: { error: '布局暂时无法读取' } })
      : route.fulfill({ json: {
        layout: defaultAnalyticsLayout,
        source: personal ? 'personal' : 'default',
        canCustomize: true,
        updatedAt: personal ? '2026-09-04T00:00:00.000Z' : null,
      } });
    if (route.request().method() !== 'DELETE') return route.fallback();
    requests++;
    personal = false;
    failRead = true;
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'reset' });
  });

  await page.goto('/analytics');
  await page.getByRole('button', { name: '编辑看板', exact: true }).click();
  await headerAction(page, '恢复默认');
  await page.getByRole('dialog', { name: '恢复默认看板', exact: true }).getByRole('button', { name: '恢复默认', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '布局恢复默认结果待核对' })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存布局', exact: true })).toBeDisabled();

  await page.getByRole('link', { name: '项目中心', exact: true }).click();
  await page.goBack();
  await expect(page.getByRole('alert').filter({ hasText: '布局恢复默认结果待核对' })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存布局', exact: true })).toBeDisabled();
  await page.getByRole('button', {name:'更多操作', exact:true}).click();
  await page.getByRole('button', { name: '恢复默认', exact: true }).evaluate((button) => (button as HTMLButtonElement).click());
  await page.keyboard.press('Escape');
  expect(requests).toBe(1);

  failRead = false;
  await page.getByRole('button', { name: '重新读取布局', exact: true }).click();
  await expect(page.getByRole('button', { name: '编辑看板', exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: '布局恢复默认结果待核对' })).toHaveCount(0);
  expect(requests).toBe(1);
});
