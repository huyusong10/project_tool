import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockGanttData } from './gantt-fixture';

async function snapshot(surface: Locator) {
  return surface.evaluate(e => {
    const fixed = [...e.querySelectorAll<HTMLElement>('[data-gantt-fixed]')].reduce((sum, n) => sum + n.getBoundingClientRect().width, 0);
    const ticks = [...e.querySelectorAll<HTMLElement>('[data-date]')];
    const cell = ticks[0].getBoundingClientRect().width;
    const position = (e.scrollLeft + (e.clientWidth - fixed) / 2) / cell;
    const index = Math.floor(position);
    return { center: ticks[index]?.dataset.date, fraction: position-index, left:e.scrollLeft, first:ticks[0]?.dataset.date, last:ticks.at(-1)?.dataset.date, width:e.clientWidth, height:e.clientHeight, full:e.scrollWidth };
  });
}
async function drag(page: Page, surface: Locator, distance: number) {
  const b = await surface.boundingBox(); if (!b) throw new Error('No timeline');
  const fixed = await surface.locator('[data-gantt-fixed]').first().evaluate(e=>e.getBoundingClientRect().width);
  const right = await surface.locator('[data-gantt-fixed]').evaluateAll(es=>es.slice(1).reduce((sum,e)=>sum+e.getBoundingClientRect().width,0));
  const start = distance > 0 ? b.x + b.width - right - 35 : b.x + fixed + 35;
  await page.mouse.move(start,b.y+20); await page.mouse.down();
  await page.mouse.move(start-distance,b.y+20,{steps:20}); await page.mouse.up();
  await expect(surface).not.toHaveAttribute('data-gantt-panning');
  await page.waitForTimeout(40);
}
test.beforeEach(async({page})=>{await mockGanttData(page);await page.emulateMedia({reducedMotion:'reduce'});});

test('真实拖动跨月跨年、向左补日期、缩放和页面往返均保持日期锚点',async({page})=>{
  const writes:string[]=[];page.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/api/'))writes.push(r.url());});
  await page.goto('/'); const surface=page.locator('.project-gantt-scroll');
  await expect(surface).toHaveAttribute('data-gantt-ready','true');
  await expect(page.getByRole('button',{name:'向后扩展'})).toHaveCount(0);
  const initial=await snapshot(surface);
  for(let i=0;i<7;i++)await drag(page,surface,430);
  const future=await snapshot(surface);expect(future.center!>'2026-11-01').toBe(true);expect(future.last!>initial.last!).toBe(true);
  for(let i=0;i<10;i++)await drag(page,surface,-430);
  const past=await snapshot(surface);expect(past.center!<initial.center!).toBe(true);expect(past.first!<initial.first!).toBe(true);
  const tabs=page.locator('.project-gantt-toolbar .view-tabs[aria-label=时间粒度]');
  for(const zoom of ['周','月','日']){await tabs.getByRole('button',{name:zoom,exact:true}).click();await page.waitForTimeout(60);const current=await snapshot(surface);expect(current.center).toBe(past.center);expect(current.fraction).toBeCloseTo(past.fraction,1);}
  await page.getByLabel('跳转到日期',{exact:true}).fill('2027-01-12');await page.getByLabel('跳转到日期',{exact:true}).press('Enter');await expect.poll(async()=>(await snapshot(surface)).center).toBe('2027-01-12');
  await surface.hover();await page.mouse.wheel(300,0);await page.waitForTimeout(80);const panned=await snapshot(surface);await surface.focus();expect((await snapshot(surface)).center).toBe(panned.center);
  await page.getByLabel('跳转到日期',{exact:true}).press('Enter');await expect.poll(async()=>(await snapshot(surface)).center).toBe('2027-01-12');
  await page.reload();await expect(surface).toHaveAttribute('data-gantt-ready','true');expect((await snapshot(surface)).center).toBe('2027-01-12');
  await page.locator('.gantt-requirement-link').first().click();await expect(page.locator('.requirement-gantt-scroll')).toHaveAttribute('data-gantt-ready','true');
  await page.goBack();await expect(surface).toHaveAttribute('data-gantt-ready','true');expect((await snapshot(surface)).center).toBe('2027-01-12');
  await page.getByRole('button',{name:'适配全部',exact:true}).click();await page.waitForTimeout(60);expect((await snapshot(surface)).center!<'2027-01-01').toBe(true);
  await page.getByLabel('跳转到日期',{exact:true}).fill('2027-01-12');await page.getByLabel('跳转到日期',{exact:true}).press('Enter');await page.waitForTimeout(80);
  const fittedRange=await page.locator('.gantt-visible-range').textContent();await page.reload();await expect(surface).toHaveAttribute('data-gantt-ready','true');expect(await page.locator('.gantt-visible-range').textContent()).toBe(fittedRange);
  expect(writes).toEqual([]);
});

test('底部滚动条、触控板和 Shift 滚轮可横移；普通滚轮保持纵向；空筛选恢复视图',async({page})=>{
  await page.goto('/');const surface=page.locator('.project-gantt-scroll');await expect(surface).toHaveAttribute('data-gantt-ready','true');
  const initial=await snapshot(surface);await surface.hover();await page.mouse.wheel(360,0);await page.waitForTimeout(80);expect((await snapshot(surface)).left).toBeGreaterThan(initial.left);
  await page.keyboard.down('Shift');await page.mouse.wheel(0,300);await page.keyboard.up('Shift');await page.waitForTimeout(80);const afterShift=await snapshot(surface);expect(afterShift.left).toBeGreaterThan(initial.left+400);
  await page.mouse.wheel(0,150);await page.waitForTimeout(80);expect((await snapshot(surface)).center).toBe(afterShift.center);
  const bar=page.locator('.project-gantt-panel .gantt-navigation-scrollbar');await expect(bar).toBeVisible();
  const thumb=await bar.locator('.gantt-scroll-thumb').boundingBox();expect(thumb!.width).toBeGreaterThanOrEqual(24);
  await page.mouse.move(thumb!.x+thumb!.width/2,thumb!.y+4);await page.mouse.down();await page.mouse.move(thumb!.x+thumb!.width/2+45,thumb!.y+4,{steps:8});await page.mouse.up();
  const box=await bar.boundingBox();if(!box)throw new Error('No scrollbar');await page.mouse.click(box.x+box.width-25,box.y+8);await page.waitForTimeout(120);expect((await snapshot(surface)).center!>=afterShift.center!).toBe(true);
  const beforeFilter=await snapshot(surface);await page.getByPlaceholder('搜索需求、工作项或拼音').fill('no-such-requirement');await expect(surface).toHaveCount(0);
  await page.getByPlaceholder('搜索需求、工作项或拼音').fill('');await expect(surface).toHaveAttribute('data-gantt-ready','true');expect((await snapshot(surface)).center).toBe(beforeFilter.center);
});

test('需求内部拖动、失焦结束、窄屏与主题下保持可浏览',async({page},info)=>{
  await page.goto('/requirements/r1');const surface=page.locator('.requirement-gantt-scroll');await expect(surface).toHaveAttribute('data-gantt-ready','true');
  const initial=await snapshot(surface);await drag(page,surface,220);expect((await snapshot(surface)).left).toBeGreaterThan(initial.left);
  const b=await surface.boundingBox();if(!b)throw new Error('No viewport');await page.mouse.move(b.x+450,b.y+22);await page.mouse.down();await page.mouse.move(b.x+350,b.y+22,{steps:6});
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();await expect(surface).not.toHaveAttribute('data-gantt-panning');
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({colorScheme:'dark'});await page.waitForTimeout(80);
  const panel=page.locator('.requirement-gantt');const bounds=await panel.boundingBox();expect(bounds!.width).toBeLessThanOrEqual(390);
  await expect(page.locator('.requirement-gantt .gantt-navigation-scrollbar')).toBeVisible();await page.getByLabel('跳转到日期',{exact:true}).fill('2026-12-15');await page.getByLabel('跳转到日期',{exact:true}).press('Enter');await expect.poll(async()=>(await snapshot(surface)).center).toBe('2026-12-15');
  await page.getByRole('button',{name:'收起侧边栏',exact:true}).click();await expect.poll(async()=>(await snapshot(surface)).center).toBe('2026-12-15');
  const row=await surface.locator('.requirement-gantt-item').first().boundingBox(),track=await surface.boundingBox();expect(row!.x).toBeCloseTo(track!.x,0);
  await expect(page.locator('.requirement-gantt .gantt-scroll-thumb')).toBeVisible();
  await page.screenshot({path:info.outputPath('gantt-navigation-narrow.png')});
});
