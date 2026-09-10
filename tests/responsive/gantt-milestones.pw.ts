import { test, expect, type Page } from '@playwright/test';
import { mockGanttData, requirement } from './gantt-fixture';
import { analysePaths, type PathMilestone } from '../../src/shared/paths';
import { req, work } from '../fixtures/path-network';
import { themes } from '../../src/client/theme';
const milestones = [
  { id: 'm1', title: 'MPS基线', projectId: 'p1', requirementId: 'r1', targetDate: '2026-09-04', achievedAt: '2026-09-03', confirmationMode: 'auto', version: 1 },
  { id: 'm2', title: 'MDS基线', projectId: 'p1', requirementId: 'r1', targetDate: '2026-09-10', achievedAt: null, confirmationMode: 'manual', version: 1 },
  { id: 'm3', title: '待定发布', projectId: 'p1', requirementId: 'r1', targetDate: null, achievedAt: null, confirmationMode: 'manual', version: 1 },
  { id: 'm4', title: '文档基线', projectId: 'p1', requirementId: 'r1', targetDate: '2026-09-10', achievedAt: null, confirmationMode: 'auto', version: 1 },
  { id: 'project-ms', title: '项目交付点', projectId: 'p1', requirementId: null, targetDate: '2026-09-11', achievedAt: null, confirmationMode: 'auto', version: 1 },
];
async function setup(page: Page) {
  await mockGanttData(page);
  await page.route('**/api/requirements/r1', route => route.fulfill({ json: { ...requirement, milestones: milestones.filter(m => m.requirementId) } }));
  await page.route('**/path-analysis*', route => route.fulfill({ json: { milestones, nodes: [{ id: 'w1', requirementId: 'r1' }], edges: [{ source: 'w1', target: 'm1' }, { source: 'm1', target: 'project-ms' }] } }));
  await page.emulateMedia({ reducedMotion: 'reduce' });
}
test('里程碑不占工作行；目标与实际独立，点击高亮前置且不写入', async ({ page }, info) => {
  await setup(page); const writes: string[] = []; page.on('request', r => { if (r.url().includes('/api/') && r.method() !== 'GET') writes.push(r.url()); });
  await page.goto('/requirements/r1');
  const surface = page.locator('.requirement-gantt-scroll'); await expect(surface).toHaveAttribute('data-gantt-ready', 'true');
  await page.getByRole('button', { name: '适配全部', exact: true }).click();
  await expect(surface.locator('.requirement-gantt-row')).toHaveCount(3);
  await expect(surface.locator('.gantt-milestone-pin')).toHaveCount(3);
  await expect(page.getByRole('button', { name: '待定日期 1 项' })).toBeVisible();
  const pin = surface.locator('[data-milestone-id="m1"]');
  const position = await pin.evaluate(n => Number((n as HTMLElement).style.left.replace('px', '')));
  const tickEnd = await surface.locator('.gantt-scale-tick[data-date="2026-09-04"]').evaluate(n => parseFloat((n as HTMLElement).style.left) + parseFloat((n as HTMLElement).style.width));
  expect(position).toBeCloseTo(tickEnd, 2);
  const actual = surface.locator('[data-milestone-actual="m1"]');
  expect(await actual.evaluate(n => parseFloat((n as HTMLElement).style.left))).toBeLessThan(position);
  const label = surface.locator('.gantt-milestone-label[aria-label*="MPS基线"]'); await label.click();
  await expect(page.getByRole('dialog', { name: '里程碑详情' })).toContainText('目标日期2026-09-04');
  await expect(page.getByRole('dialog', { name: '里程碑详情' })).toContainText('实际达成2026-09-03');
  await expect(surface.locator('[data-work-item-id="w1"]')).toHaveClass(/is-milestone-related/);
  await expect(surface.locator('[data-work-item-id="w-late"]')).not.toHaveClass(/is-milestone-related/);
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog', { name: '里程碑详情' })).toHaveCount(0);
  await page.getByRole('button', { name: '待定日期 1 项' }).click(); await expect(page.getByRole('dialog', { name: '里程碑详情' })).toContainText('待定发布');
  await page.locator('.requirement-gantt-toolbar').click({ position: { x: 5, y: 5 } }); await expect(page.getByRole('dialog', { name: '里程碑详情' })).toHaveCount(0);
  await surface.screenshot({ path: info.outputPath('milestone-slices.png') }); expect(writes).toEqual([]);
});
test('切面与日期轴同步横移缩放；窄屏标签不重叠，标记带高度固定', async ({ page }, info) => {
  await setup(page); await page.goto('/requirements/r1');
  const surface = page.locator('.requirement-gantt-scroll'); await expect(surface).toHaveAttribute('data-gantt-ready', 'true');
  const verify = async () => {
    const mismatches = await surface.evaluate(root => [...root.querySelectorAll<HTMLElement>('[data-milestone-id]')].flatMap(pin => {
      const cuts = [...root.querySelectorAll<HTMLElement>('[data-milestone-cut="' + pin.dataset.milestoneId + '"]')];
      return cuts.filter(c => Math.abs(c.getBoundingClientRect().x - pin.getBoundingClientRect().x - pin.getBoundingClientRect().width / 2) > 2).map(c => c.dataset.milestoneCut);
    })); expect(mismatches).toEqual([]);
    const rail = surface.locator('.gantt-milestone-rail'); expect((await rail.boundingBox())!.height).toBe(28);
    const boxes = await rail.locator('.gantt-milestone-label').evaluateAll(ns => ns.map(n => ({ x: n.getBoundingClientRect().x, right: n.getBoundingClientRect().right })));
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i - 1].right);
  };
  for (const zoom of ['日', '周', '月']) { await page.locator('[aria-label="时间粒度"]').getByRole('button', { name: zoom, exact: true }).click(); await verify(); }
  const viewport = (await surface.boundingBox())!, railBox = (await surface.locator('.gantt-milestone-rail').boundingBox())!;
  const scrollBefore = await surface.evaluate(n => n.scrollLeft);
  const fixedRight = await surface.locator('[data-gantt-fixed]').evaluateAll(ns => ns.slice(1).reduce((width, n) => width + n.getBoundingClientRect().width, 0));
  const dragX = viewport.x + viewport.width - fixedRight - 40, dragY = railBox.y + 26;
  await page.mouse.move(dragX, dragY); await page.mouse.down(); await page.mouse.move(dragX - 90, dragY, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => surface.evaluate(n => n.scrollLeft)).not.toBe(scrollBefore); await verify();
  await expect(page.getByRole('dialog', { name: '里程碑详情' })).toHaveCount(0);
  await surface.hover(); await page.mouse.wheel(350, 0); await verify();
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: '适配全部', exact: true }).click(); await verify();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('milestone-narrow.png') });
});
test('项目切面跨需求，需求里程碑只出现在对应需求行', async ({ page }) => {
  await setup(page); await page.goto('/'); const surface = page.locator('.project-gantt-scroll');
  await expect(surface).toHaveAttribute('data-gantt-ready', 'true');
  await expect(surface.locator('.gantt-axis-header [data-milestone-id="project-ms"]')).toHaveCount(1);
  await expect(surface.locator('.gantt-axis-header [data-milestone-id="m1"]')).toHaveCount(0);
  await expect(surface.locator('.gantt-row [data-milestone-cut="project-ms"]')).toHaveCount(2);
  await expect(surface.locator('.gantt-row').filter({ hasText: '统一甘特样式' }).locator('[data-milestone-id="m1"]')).toHaveCount(1);
});
test('流程预览只保留工作行，里程碑在第2日末尾切开，不新增一天', async ({ page }, info) => {
  await mockGanttData(page);
  const template = { id: 't1', projectId: 'p1', name: '阶段交付流程', description: '', dependencyMode: 'dependencies', createdAt: '2026-09-01', updatedAt: '2026-09-01', items: [
    { id: 'ta', clientKey: 'ta', templateId: 't1', title: 'MPS编写', kind: 'work', sortOrder: 0, durationDays: 2, startOffsetDays: 0, predecessorIds: [] },
    { id: 'tb', clientKey: 'tb', templateId: 't1', title: 'MDS编写', kind: 'work', sortOrder: 1, durationDays: 3, startOffsetDays: 2, predecessorIds: ['ta'] },
    { id: 'tm', clientKey: 'tm', templateId: 't1', title: 'MPS基线', kind: 'milestone', sortOrder: 2, durationDays: 0, startOffsetDays: 2, predecessorIds: ['ta'] },
  ] };
  await page.route('**/api/templates*', r => r.fulfill({ json: [template] }));
  await page.goto('/templates?edit=t1'); await expect(page.locator('[data-layout-ready="true"]')).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: '甘特预览', exact: true }).click();
  await expect(page.locator('.template-plan-row')).toHaveCount(2);
  const ratio = await page.locator('.template-milestone-plan').evaluate(root => {
    const width = root.querySelector('.template-plan-scale')!.getBoundingClientRect().width;
    const point = parseFloat(root.querySelector<HTMLElement>('[data-milestone-id="tm"]')!.style.left);
    return point / width;
  }); expect(ratio).toBeCloseTo(2 / 5, 2);
  await page.locator('.template-milestone-plan .gantt-milestone-label').click();
  await expect(page.getByRole('dialog', { name: '里程碑详情' })).toContainText('第 2 工作日结束');
  await expect(page.locator('.template-plan-row .template-plan-name.is-milestone-related')).toContainText('MPS编写');
  await page.keyboard.press('Escape'); await page.locator('.template-milestone-plan').screenshot({ path: info.outputPath('template-slices.png') });
});
test('需求路径排期预览复用切面，独立里程碑和验收点不增加工作行', async ({ page }, info) => {
  await mockGanttData(page);
  const data = analysePaths({ projectId: 'p1', projectName: '测试项目', projectEnd: '2026-09-30', revision: 1, asOfDate: '2026-09-07',
    requirements: [{ ...req('r1'), projectId: 'p1', title: requirement.title }], workItems: [work('w1', 'r1', 2), work('w2', 'r1', 3)],
    milestones: milestones.filter(m => m.requirementId) as PathMilestone[], dependencies: [],
  });
  await page.route('**/path-analysis*', r => r.fulfill({ json: data }));
  await page.goto('/requirements/r1?view=path'); await expect(page.locator('[data-layout-ready="true"]')).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: '排期预览', exact: true }).click();
  const chart = page.locator('.path-draft-gantt'); await expect(chart.locator('.path-draft-gantt-row')).toHaveCount(2);
  await expect(chart.locator('.gantt-milestone-rail')).toHaveCount(1);
  await expect(chart.locator('.path-gantt-name').filter({ hasText: '基线' })).toHaveCount(0);
  const panelBox = (await page.locator('.graph-auxiliary').boundingBox())!, toolbarBox = (await chart.locator('.gantt-navigation').boundingBox())!, rowBox = (await chart.locator('.path-draft-gantt-track').nth(1).boundingBox())!;
  expect(toolbarBox.y).toBeGreaterThan(panelBox.y + 35);
  expect(rowBox.y + rowBox.height).toBeLessThan(panelBox.y + panelBox.height);
  await expect(page.locator('.graph-auxiliary')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: info.outputPath('path-workspace.png') });
  await chart.screenshot({ path: info.outputPath('path-slices.png') });
});
test('里程碑切面在全部主题及减少动态效果下保留几何位置', async ({ page }, info) => {
  await setup(page); await page.goto('/requirements/r1');
  const surface = page.locator('.requirement-gantt-scroll'); await expect(surface).toHaveAttribute('data-gantt-ready', 'true');
  const positions = () => surface.locator('[data-milestone-id]').evaluateAll(ns => ns.map(n => (n as HTMLElement).style.left));
  const before = await positions();
  for (const theme of themes) {
    await page.evaluate(value => { localStorage.setItem('project-manage:theme', value); window.dispatchEvent(new StorageEvent('storage', { key: 'project-manage:theme', newValue: value })); }, theme.id);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.id);
    expect(await positions()).toEqual(before);
    expect((await surface.locator('.gantt-axis-header').boundingBox())!.height).toBe(82);
    const color = await surface.locator('[data-milestone-id="m1"]').evaluate(n => {
      const probe = document.createElement('span'); probe.style.color = 'var(--gantt-completed)'; n.appendChild(probe);
      const values = { expected: getComputedStyle(probe).color, actual: getComputedStyle(n).borderTopColor }; probe.remove(); return values;
    }); expect(color.actual).toBe(color.expected);
    if (theme.id === 'dcim') await surface.screenshot({ path: info.outputPath('milestone-night.png') });
  }
});
