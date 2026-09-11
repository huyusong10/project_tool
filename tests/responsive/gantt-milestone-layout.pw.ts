import { test, expect } from '@playwright/test';
import { mockGanttData } from './gantt-fixture';

const milestone = { id: 'm1', title: '接口基线', projectId: 'p1', requirementId: 'r1', targetDate: '2026-09-04', achievedAt: '2026-09-03', confirmationMode: 'auto', version: 1 };

test('里程碑贴住条带切面；有无标记的行始终等高居中，刷新和双轨不挤动内容', async ({ page }, info) => {
  await mockGanttData(page); await page.emulateMedia({ reducedMotion: 'reduce' });
  let reached = true;
  await page.route('**/path-analysis*', route => route.fulfill({ json: { milestones: [{ ...milestone, achievedAt: reached ? milestone.achievedAt : null }], nodes: [], edges: [] } }));
  await page.goto('/');
  const surface = page.locator('.project-gantt-scroll');
  await expect(surface).toHaveAttribute('data-gantt-ready', 'true');
  const geometry = () => surface.locator('.gantt-track').evaluateAll(rows => rows.map(row => {
    const box = row.getBoundingClientRect(), rect = (selector: string) => row.querySelector(selector)?.getBoundingClientRect();
    const plan = rect('.gantt-date-plan') || rect('.unified-gantt-plan')!, actual = rect('.gantt-date-actual');
    const top = plan.top, bottom = actual?.bottom || plan.bottom;
    const pin = rect('.gantt-milestone-pin'), label = rect('.gantt-milestone-label'), cut = rect('.is-inline .gantt-milestone-cut');
    return { height: box.height, barTop: top - box.top, barBottom: bottom - box.top, center: (top + bottom) / 2 - box.top,
      pinCenter: pin && pin.y + pin.height / 2 - box.top, labelTop: label && label.top - box.top, labelBottom: label && label.bottom - box.top,
      cutTop: cut && cut.top - box.top, cutBottom: cut && cut.bottom - box.top };
  }));
  const verify = async () => {
    const [withMark, withoutMark] = await geometry();
    expect(withMark.height).toBe(withoutMark.height);
    for (const row of [withMark, withoutMark]) expect(Math.abs(row.center - row.height / 2)).toBeLessThan(1);
    expect(withMark.barTop).toBe(withoutMark.barTop); expect(withMark.barBottom).toBe(withoutMark.barBottom);
    expect(withMark.pinCenter).toBeCloseTo(withMark.barTop, 1);
    expect(withMark.labelTop).toBeGreaterThanOrEqual(0);
    expect(withMark.labelBottom!).toBeLessThan(withMark.barTop);
    expect(withMark.cutTop).toBe(withMark.barTop); expect(withMark.cutBottom).toBe(withMark.barBottom);
    return withMark;
  };
  const original = await verify();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('button', { name: '适配全部', exact: true }).click(); await verify();
    await expect(surface).toBeVisible();
    await expect.poll(async () => (await surface.boundingBox())?.height || 0).toBeGreaterThanOrEqual(240);
    await surface.screenshot({ path: info.outputPath(`milestone-centered-${width}.png`) });
    await page.getByRole('button', { name: /甘特显示方式，当前/ }).click();
    await page.getByRole('button', { name: '计划·实际双轨', exact: true }).click(); await verify();
    await surface.screenshot({ path: info.outputPath(`milestone-centered-split-${width}.png`) });
    await page.getByRole('button', { name: /甘特显示方式，当前/ }).click();
    await page.getByRole('button', { name: '现有视图', exact: true }).click(); await verify();
  }
  await page.setViewportSize({ width: 1280, height: 800 }); reached = false; await page.reload();
  await expect(surface).toHaveAttribute('data-gantt-ready', 'true');
  await expect(surface.locator('.gantt-milestone-rail')).toHaveCount(0);
  const refreshed = (await geometry())[0];
  expect(refreshed.height).toBe(original.height); expect(refreshed.center).toBe(original.center);
  expect(refreshed.barTop).toBe(original.barTop); expect(refreshed.barBottom).toBe(original.barBottom);
});

test('密集达成标记合并名称但保留每个实际日期，已取消记录不显示', async ({ page }, info) => {
  await mockGanttData(page); await page.emulateMedia({ reducedMotion: 'reduce' });
  const reached = [
    { ...milestone, targetDate: '2030-12-20', title: '很长的接口设计评审交付基线名称' },
    { ...milestone, id: 'm2', title: 'MDS基线' },
    { ...milestone, id: 'm3', title: '文档基线', achievedAt: '2026-09-04' },
    { ...milestone, id: 'cancelled', title: '已取消发布', cancelled: true },
  ];
  await page.route('**/path-analysis*', route => route.fulfill({ json: { milestones: reached, nodes: [], edges: [] } }));
  await page.goto('/'); const surface = page.locator('.project-gantt-scroll');
  await expect(surface).toHaveAttribute('data-gantt-ready', 'true');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const zoom of ['日', '周', '月']) {
      await page.locator('[aria-label="时间粒度"]').getByRole('button', { name: zoom, exact: true }).click();
      const rail = surface.locator('.gantt-milestone-rail.is-inline');
      await expect(rail.locator('[data-milestone-id]')).toHaveCount(3);
      await expect(rail.locator('[data-milestone-id="cancelled"], [data-milestone-actual]')).toHaveCount(0);
      await expect(rail.locator('[data-milestone-id="m1"]')).toHaveAttribute('data-milestone-date', '2026-09-03');
      const labels = await rail.locator('.gantt-milestone-label').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().toJSON()));
      for (let i = 1; i < labels.length; i++) expect(labels[i].x).toBeGreaterThanOrEqual(labels[i - 1].right);
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: '适配全部', exact: true }).click();
  const label = surface.locator('.gantt-milestone-label').first(); await expect(label).not.toContainText('已达成'); await expect(label).toContainText('项'); await label.click();
  const details = page.getByRole('dialog', { name: '里程碑详情' });
  await expect(details).toContainText('很长的接口设计评审交付基线名称'); await expect(details).not.toContainText('目标日期');
  await expect(details).toContainText('实际达成2026-09-03'); await expect(details).not.toContainText('已取消发布');
  await page.keyboard.press('Escape'); await surface.screenshot({ path: info.outputPath('milestone-grouped.png') });
});
