import {expect, test, type Page, type Locator} from '@playwright/test';
import {phaseFixture} from './phase-fixture';
import {chooseOption} from './select-helper';

const bar = (page: Page) => page.getByRole('region', {name:'页面工具栏', exact:true});
async function geometry(page: Page) {
  await expect(bar(page)).toBeVisible();
  await expect.poll(() => bar(page).evaluate(root => {
    const frame = root.getBoundingClientRect();
    return Array.from(root.querySelectorAll('.page-toolbar-leading,.page-toolbar-trailing,button')).filter(el => {
      const r = el.getBoundingClientRect();
      return r.width && r.height && (r.left < frame.left - 1 || r.right > frame.right + 1 || r.top < frame.top - 1 || r.bottom > frame.bottom + 1);
    }).map(el => el.textContent);
  })).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}
async function startDrag(page: Page, source: Locator, target: Locator) {
  const from = (await source.boundingBox())!, to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2, {steps:3});
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {steps:12});
}

test('完成按钮悬浮保持可读且尺寸不变', async ({page}, info) => {
  const f = await phaseFixture(page);
  await page.goto('/execution');
  await chooseOption(page.getByLabel('展开层级', {exact:true}), 'work');
  const action = page.locator(`[data-row-id="${f.testing.workItems[1].id}"]`).getByRole('button', {name:'完成', exact:true});
  await expect(action).toBeEnabled();
  const before = await action.evaluate(el => {const s=getComputedStyle(el); return {color:s.color, background:s.backgroundColor};});
  const dimensions = await action.boundingBox();
  await action.hover();
  await expect(action).toHaveCSS('background-color', before.background);
  await expect(action).toHaveCSS('color', before.color);
  expect(await action.boundingBox()).toEqual(dimensions);
  await page.screenshot({path:info.outputPath('complete-hover.png'), animations:'disabled'});
});

test('工作项拖拽有对象预览，窄屏和横向滚动保留手柄，键盘也可排序', async ({page}, info) => {
  const f = await phaseFixture(page);
  await page.goto('/?' + new URLSearchParams({projectId:f.projectId, workspaceView:'progress', scopeType:'project', scopeId:f.projectId, pathNode:f.testing.id, pathInspector:'open'}));
  const detail = page.getByRole('complementary', {name:'对象详情'});
  await detail.getByRole('tab', {name:'工作项 2', exact:true}).click();
  await detail.getByRole('button', {name:'工作项设置', exact:true}).click();
  const settings = detail.getByRole('dialog', {name:'工作项设置', exact:true});
  const handles = settings.getByRole('button', {name:/拖动.*调整顺序/});
  const original = f.testing.workItems.map(item => item.id);
  const readOrder = async () => (await (await page.request.get('/api/requirements/' + f.testing.id)).json()).workItems.map((item:{id:string}) => item.id);
  await expect(handles.first()).toBeInViewport();
  await startDrag(page, handles.first(), handles.nth(1));
  await expect(page.locator('.drag-preview')).toContainText(f.testing.workItems[0].title);
  await page.screenshot({path:info.outputPath('work-order-preview.png'), animations:'disabled'});
  await page.mouse.up();
  await expect.poll(readOrder).toEqual([...original].reverse());
  await expect(handles.first()).toHaveAccessibleName('拖动测试调整顺序');
  await page.setViewportSize({width:390,height:844});
  await settings.locator('.work-editor-scroll').evaluate(el => {el.scrollLeft = el.scrollWidth;});
  await expect(handles.first()).toBeInViewport();
  const hit = await handles.first().evaluate(el => {const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});
  expect(hit).toBe(true);
  await handles.first().focus(); await page.keyboard.press('Space');
  await expect(page.locator('.drag-preview')).toContainText('测试');
  await page.keyboard.press('ArrowDown');
  await expect(settings.locator('tr.sortable-item').nth(1)).toHaveClass(/is-over/);
  await page.keyboard.press('Space');
  await expect.poll(readOrder).toEqual(original);
  await expect(handles.first()).toHaveAccessibleName('拖动开发调整顺序');
  await startDrag(page, handles.first(), handles.nth(1));
  await expect(page.locator('.drag-preview')).toBeInViewport();
  await page.screenshot({path:info.outputPath('work-order-narrow-preview.png'), animations:'disabled'});
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.locator('.drag-preview')).toHaveCount(0); await expect(settings).toBeVisible(); expect(await readOrder()).toEqual(original);
  await page.screenshot({path:info.outputPath('work-order-narrow.png'), animations:'disabled'});
});

test('所有导航四字，公共栏左侧范围状态、右侧操作，编辑不改变高度', async ({page}, info) => {
  test.setTimeout(90000);
  const f = await phaseFixture(page); await page.goto('/');
  await expect(page.locator('.workspace-outline')).toBeVisible();
  const names = await page.locator('.sidebar-nav .nav-label').allTextContents();
  expect(names.length).toBeGreaterThan(10); expect(names.every(name => [...name.trim()].length === 4), names.join(',')).toBe(true);
  const pages = [['/','项目空间'], ['/issues','问题跟踪'], ['/actions','待办事项'], ['/analytics','统计分析'], ['/people','人员矩阵'], ['/templates','流程设计'], ['/project-settings','项目设置'], ['/project-logs','项目日志'], ['/projects','项目中心'], ['/resources','人员权限'], ['/archives','归档中心'], ['/system','系统管理'], ['/logs','操作审计'], ['/my-work','我的工作'], ['/settings','个人设置']];
  for (const [url, name] of pages) {
    await page.goto(url + '?projectId=' + f.projectId);
    await expect(page.locator('h1')).toHaveText(name);
    await geometry(page);
    await expect(bar(page).locator('.page-toolbar-leading')).not.toBeEmpty();
    await expect(bar(page).getByText('只读', {exact:true})).toHaveCount(0);
    await expect(bar(page).locator('.page-toolbar-leading .primary-button')).toHaveCount(0);
  }
  for (const viewport of [info.project.use.viewport!, {width:390, height:844}]) {
    await page.setViewportSize(viewport); await page.goto('/analytics?projectId=' + f.projectId);
    await expect(bar(page).getByRole('button',{name:'编辑看板', exact:true})).toBeEnabled();
    const baseline = await bar(page).boundingBox();
    await bar(page).getByRole('button',{name:'编辑看板', exact:true}).click();
    await expect(bar(page).getByRole('button',{name:'保存布局', exact:true})).toBeVisible();
    expect(await bar(page).boundingBox()).toEqual(baseline); await geometry(page);
    await page.screenshot({path:info.outputPath('analytics-toolbar-' + viewport.width + '.png'), animations:'disabled'});
    await bar(page).getByRole('button',{name:'取消编辑', exact:true}).click();
  }
});

test('看板拖拽预览跟随指针，原卡片保持位置', async ({page}, info) => {
  await phaseFixture(page); await page.goto('/analytics');
  await bar(page).getByRole('button',{name:'编辑看板', exact:true}).click();
  const items = page.locator('.analytics-drag-item');
  const original = await items.first().boundingBox();
  await startDrag(page, items.first().locator('.analytics-drag-handle'), items.nth(1).locator('.analytics-drag-handle'));
  await expect(page.locator('.drag-preview')).toBeVisible();
  expect(await items.first().boundingBox()).toEqual(original);
  await page.screenshot({path:info.outputPath('analytics-drag-preview.png'), animations:'disabled'});
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.locator('.drag-preview')).toHaveCount(0);
});

test('清单多选拖拽使用对象虚影和数量，保存后顺序正确', async ({page}) => {
  const f = await phaseFixture(page);
  for (const name of ['第二特性', '第三特性']) {const response=await page.request.post(f.base+'/features',{data:{name}});expect(response.ok()).toBe(true);}
  await page.goto('/');
  await page.getByRole('checkbox',{name:'选择第二特性', exact:true}).check();
  await page.getByRole('checkbox',{name:'选择第三特性', exact:true}).check();
  await page.evaluate(() => {
    const original=DataTransfer.prototype.setDragImage;
    DataTransfer.prototype.setDragImage=function(element,x,y){document.documentElement.dataset.dragImage=element.textContent || '';original.call(this,element,x,y);};
  });
  const target=page.locator(`[data-object-id="feature:${f.feature.id}"]`);
  const targetBox=(await target.boundingBox())!;
  await page.getByRole('button',{name:'拖动第三特性',exact:true}).dragTo(target,{targetPosition:{x:80,y:targetBox.height-3}});
  await expect(page.getByText('调整顺序已保存',{exact:true})).toBeVisible();
  expect(await page.locator('html').getAttribute('data-drag-image')).toContain('第三特性');
  expect(await page.locator('html').getAttribute('data-drag-image')).toContain('2');
  await expect(page.locator('.outline-title')).toHaveText(['资产管理','第三特性','第二特性']);
});
