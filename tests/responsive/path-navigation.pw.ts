import { headerAction } from './topbar-helpers';
import { test, expect, type Page } from '@playwright/test';
import { mockGanttData, requirement } from './gantt-fixture';
import { analysePaths } from '../../src/shared/paths';
import { req, work } from '../fixtures/path-network';

async function setup(page: Page) {
  await mockGanttData(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const data = analysePaths({ projectId: 'p1', projectName: '测试项目', projectEnd: '2026-09-30', revision: 1, asOfDate: '2026-09-11',
    requirements: [{ ...req('r1'), projectId: 'p1', title: requirement.title }, { ...req('r2'), projectId: 'p1', title: '关联需求' }],
    workItems: [work('w1', 'r1', 2), work('w2', 'r2', 3)],
    dependencies: [{ id: 'edge', projectId: 'p1', sourceRequirementId: 'r1', sourceWorkItemId: 'w1', targetRequirementId: 'r2', targetWorkItemId: 'w2', origin: 'manual' }],
  });
  await page.route('**/api/requirements/r2', r => r.fulfill({ json: { ...requirement, id: 'r2', title: '关联需求', workItems: [] } }));
  await page.route('**/path-analysis*', r => r.fulfill({ json: data }));
}
const ready = (page: Page) => expect(page.locator('[data-layout-ready="true"]')).toBeVisible();
const current = (page: Page) => new URL(page.url()).pathname + new URL(page.url()).search;
const index = (page: Page) => page.evaluate(() => history.state.idx as number);
const viewport = (page: Page) => page.locator('.react-flow__viewport').evaluate(n => (n as HTMLElement).style.transform);
async function openRequirement(page: Page, id: string, path = true) {
  await page.locator(`.react-flow__node[data-id="${id}"] .dependency-card`).click();
  await page.getByRole('button', { name: path ? '进入需求路径' : '查看需求详情', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/requirements/'+id));
  if (path) {await expect(page.locator('.graph-loading-shell')).toHaveCount(0);await ready(page);}
}

test('详情与路径切换不增加历史，返回及浏览器前进不再来回绕圈', async ({ page }) => {
  await setup(page); await page.goto('/');
  await page.locator('.gantt-requirement-link').filter({ hasText: requirement.title }).click();
  const entry = await index(page);
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: '路径分析', exact: true }).click(); await ready(page);
    expect(await index(page)).toBe(entry);
    await headerAction(page,'需求详情');
    await expect(page.locator('.requirement-overview')).toBeVisible(); expect(await index(page)).toBe(entry);
  }
  await page.getByRole('button', { name: '返回', exact: true }).click(); await expect(page).toHaveURL(/\/$/);
  await page.goForward(); await expect(page.locator('.requirement-overview')).toBeVisible();
  await page.goBack(); await expect(page).toHaveURL(/\/$/);
});

test('全局进入详情再切换路径，返回全局；跨需求沿浏览历史逐次返回', async ({ page }) => {
  await setup(page); await page.goto('/paths?pathScope=all'); await ready(page);
  await openRequirement(page, 'r1', false);
  await page.getByRole('button', { name: '路径分析', exact: true }).click(); await ready(page);
  await page.getByRole('button', { name: '返回项目路径', exact: true }).click(); await ready(page);
  await expect(page).toHaveURL(/\/paths\?/);
  await openRequirement(page, 'r2'); const source = current(page), entry = await index(page);
  await page.locator('.react-flow__node[data-id="w1"] .dependency-card').click();
  await page.getByRole('button', { name: '进入需求路径', exact: true }).click(); await ready(page);
  expect(await index(page)).toBe(entry + 1);
  await page.reload(); await ready(page);
  await expect(page.locator('#topbar-back-slot button')).toHaveAttribute('aria-label','返回关联需求 · 需求路径');
  await page.locator('#topbar-back-slot button').click(); await ready(page);
  expect(current(page).split('&pathNode')[0]).toBe(source.split('&pathNode')[0]);
  expect(await index(page)).toBe(entry);
  await page.goBack(); await ready(page); await expect(page).toHaveURL(/\/paths\?/);
});

test('固定项目路径入口新增访问，历史返回恢复各次全局画布与筛选', async ({ page }) => {
  await setup(page); await page.goto('/paths?pathScope=all'); await ready(page);
  const firstView = await viewport(page);
  await openRequirement(page, 'r1');
  await headerAction(page,'项目路径'); await ready(page);
  await page.getByRole('button', { name: '缩小画布', exact: true }).click();
  await expect.poll(() => viewport(page)).not.toBe(firstView);
  const secondView = await viewport(page);
  await openRequirement(page, 'r2');
  await headerAction(page,'项目路径'); await ready(page);
  await page.getByRole('button', { name: '缩小画布', exact: true }).click();
  await expect.poll(() => viewport(page)).not.toBe(secondView);
  await expect(page.locator('#topbar-back-slot button')).toHaveCount(0);
  await page.goBack(); await ready(page); await expect(page).toHaveURL(/\/requirements\/r2\?/);
  await page.goBack(); await ready(page); await expect.poll(() => viewport(page)).toBe(secondView);
  await expect(page).toHaveURL(/pathNode=r2/);
  await page.goBack(); await ready(page); await expect(page).toHaveURL(/\/requirements\/r1\?/);
  await page.locator('#topbar-back-slot button').click(); await ready(page);
  await expect.poll(() => viewport(page)).toBe(firstView); await expect(page).toHaveURL(/pathScope=all/);
  await expect(page).toHaveURL(/pathNode=r1/);
});

test('直接打开路径有明确入口，窄屏导航不重叠', async ({ page }, info) => {
  await setup(page); await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/requirements/r1?view=path'); await ready(page);
  await expect(page.getByRole('button', { name: '返回', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '返回项目路径', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '更多操作', exact: true }).click();
  await expect(page.getByRole('button', { name: '需求详情', exact: true })).toBeVisible();
  const boxes = await page.locator('#topbar-back-slot button').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().toJSON()));
  for (let i = 1; i < boxes.length; i++) expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i - 1].right);
  await page.screenshot({ path: info.outputPath('navigation-narrow.png') });
  await headerAction(page,'需求详情');
  await expect(page.getByRole('button', { name: '需求列表', exact: true })).toBeVisible();
  expect(await index(page)).toBe(0);
});

test('返回无筛选的历史画布时不套用后来访问保存的筛选', async ({ page }) => {
  await setup(page); await page.goto('/paths'); await ready(page);
  await page.getByRole('link', { name: '项目进展', exact: true }).click();
  await page.getByRole('link', { name: '路径分析', exact: true }).click(); await ready(page);
  await page.getByRole('button', { name: '查找与筛选', exact: true }).click();
  await page.getByLabel('筛选图中节点').fill('关联需求');
  await expect(page).toHaveURL(/pathSearch=/);
  await page.goBack(); await expect(page).toHaveURL(/\/$/);
  await page.goBack(); await ready(page); await expect(page).toHaveURL(/\/paths$/);
  await expect(page.locator('.graph-finder')).not.toBeVisible();
});

test('定位处理工作项属于视图切换，返回仍到原项目图', async ({ page }) => {
  await setup(page); await page.goto('/paths?pathScope=all'); await ready(page);
  await openRequirement(page, 'r1'); const entry = await index(page);
  await page.locator('.react-flow__node[data-id="w1"] .dependency-card').click();
  await page.getByRole('button', { name: '定位并处理工作项', exact: true }).click();
  await expect(page).toHaveURL(/workItemId=w1/); expect(await index(page)).toBe(entry);
  await page.getByRole('button', { name: '返回', exact: true }).click(); await ready(page); await expect(page).toHaveURL(/\/paths\?/);
});

test('保存后的旧草稿历史链接替换为正式地址，不新增浏览记录', async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => sessionStorage.setItem('pm-editor-ids:admin:p1', JSON.stringify({ draft: 'r1', 'draft-work': 'w1' })));
  await page.goto('/requirements/draft?view=path&draftProject=p1&pathNode=draft-work&target=acceptance%3Adraft'); await ready(page);
  await expect(page).toHaveURL(/\/requirements\/r1\?/); await expect(page).not.toHaveURL(/draft/);
  await expect(page).toHaveURL(/pathNode=w1/); expect(await index(page)).toBe(0);
});

test('顶层显示页面图标，来源变化不挤动标题，窄屏加载与返回保持88px', async ({page},info) => {
  await setup(page);await page.setViewportSize({width:390,height:844});
  await page.goto('/');await page.getByRole('link',{name:'路径分析',exact:true}).click();await ready(page);
  await expect(page.locator('#topbar-back-slot button')).toHaveCount(0);
  await expect(page.locator('.integrated-page-title button')).toHaveCount(0);
  const titleX=(await page.locator('.integrated-page-title h1').boundingBox())!.x;
  await page.route('**/api/requirements/r1',async route=>{await new Promise(r=>setTimeout(r,180));await route.fallback();});
  await page.evaluate(()=>{
    const frames:Array<{height:number;x:number}>=[];
    (window as typeof window & {returnFrames:typeof frames}).returnFrames=frames;
    const sample=()=>{const bar=document.querySelector('.topbar')!,title=document.querySelector('.integrated-page-title h1');frames.push({height:bar.getBoundingClientRect().height,x:title?.getBoundingClientRect().x??-1});if(frames.length<240)requestAnimationFrame(sample);};sample();
  });
  await openRequirement(page,'r1');
  await expect(page.getByRole('button',{name:'返回项目路径',exact:true})).toBeVisible();
  await expect(page.locator('.integrated-page-title button')).toHaveCount(0);
  expect((await page.locator('.integrated-page-title h1').boundingBox())!.x).toBe(titleX);
  const nav=(await page.locator('#topbar-back-slot button').boundingBox())!,rail=(await page.locator('.graph-tool-rail').boundingBox())!;
  expect(rail.y-nav.y-nav.height).toBeGreaterThanOrEqual(12);
  const graph=(await page.locator('.dependency-canvas').boundingBox())!;
  await page.getByRole('button',{name:'查找与筛选',exact:true}).click();
  const finder=(await page.locator('.graph-finder').boundingBox())!;
  expect(finder.y-nav.y-nav.height).toBeGreaterThanOrEqual(12);
  expect(await page.locator('.dependency-canvas').boundingBox()).toEqual(graph);
  await page.screenshot({path:info.outputPath('return-narrow.png')});
  await page.getByRole('button',{name:'返回项目路径',exact:true}).click();await ready(page);
  await expect(page).toHaveURL(/\/paths/);await expect(page.locator('#topbar-back-slot button')).toHaveCount(0);
  const frames=await page.evaluate(()=>(window as typeof window & {returnFrames:Array<{height:number;x:number}>}).returnFrames);
  expect(frames.length).toBeGreaterThan(5);
  expect([...new Set(frames.map(f=>f.height))]).toEqual([88]);
  expect([...new Set(frames.map(f=>f.x))]).toEqual([titleX]);
});

test('全局路径加载失败也没有返回，跨项目来源不用于返回',async({page})=>{
  await setup(page);
  await page.route('**/path-analysis*',route=>route.fulfill({status:503,json:{error:'模拟读取失败'}}));
  await page.goto('/paths');await expect(page.getByText('路径分析暂不可用',{exact:true})).toBeVisible();
  await expect(page.locator('#topbar-back-slot button,.integrated-page-title button')).toHaveCount(0);
  await page.goto('/requirements/r1?view=path');
  await page.evaluate(()=>history.replaceState({...history.state,idx:2,usr:{pathSource:{projectId:'other',label:'其他项目需求路径',index:1}}},''));
  await page.reload();await expect(page.getByRole('button',{name:'返回项目路径',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'返回项目路径',exact:true}).click();await expect(page).toHaveURL(/\/paths$/);
});
