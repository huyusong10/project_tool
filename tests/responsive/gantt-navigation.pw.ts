import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockGanttData } from './gantt-fixture';
import {addBusinessDays} from '../../src/shared/domain';

async function snapshot(surface: Locator) {
  const result=await surface.evaluate(e => {
    const fixed = [...e.querySelectorAll<HTMLElement>('[data-gantt-fixed]')].reduce((sum, n) => sum + n.getBoundingClientRect().width, 0);
    const ticks = [...e.querySelectorAll<HTMLElement>('[data-date]')];
    const cell = ticks[0].getBoundingClientRect().width;
    const position = (e.scrollLeft + (e.clientWidth - fixed) / 2) / cell;
    const index = Math.floor(position);
    return {index, fraction:position-index, left:e.scrollLeft, first:ticks[0].dataset.date!, last:ticks.at(-1)!.dataset.date!, width:e.clientWidth, height:e.clientHeight, full:e.scrollWidth };
  });
  return {...result,center:addBusinessDays(result.first,result.index)};
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
  await page.goto('/execution');await page.getByRole('button',{name:'展开全部',exact:true}).click(); const surface=page.locator('.workspace-gantt-scroll');
  await expect(surface).toHaveAttribute('data-gantt-ready','true');
  await expect(page.getByRole('button',{name:'向后扩展'})).toHaveCount(0);
  const initial=await snapshot(surface);
  for(let i=0;i<7;i++)await drag(page,surface,430);
  const future=await snapshot(surface);expect(future.center!>'2026-11-01').toBe(true);expect(future.last!>initial.last!).toBe(true);
  for(let i=0;i<10;i++)await drag(page,surface,-430);
  const past=await snapshot(surface);expect(past.center!<initial.center!,JSON.stringify({initial,future,past})).toBe(true);expect(past.first!<initial.first!).toBe(true);
  const tabs=page.locator('.workspace-time-tools .view-tabs[aria-label=时间粒度]');
  for(const zoom of ['周','月','日']){await tabs.getByRole('button',{name:zoom,exact:true}).click();await page.waitForTimeout(60);const current=await snapshot(surface);expect(current.center).toBe(past.center);expect(current.fraction).toBeCloseTo(past.fraction,1);}
  await page.getByLabel('跳转到日期',{exact:true}).fill('2027-01-12');await page.getByLabel('跳转到日期',{exact:true}).press('Enter');await expect.poll(async()=>(await snapshot(surface)).center).toBe('2027-01-12');
  await surface.hover();await page.mouse.wheel(300,0);await page.waitForTimeout(80);const panned=await snapshot(surface);await surface.focus();expect((await snapshot(surface)).center).toBe(panned.center);
  await page.getByLabel('跳转到日期',{exact:true}).press('Enter');await expect.poll(async()=>(await snapshot(surface)).center).toBe('2027-01-12');
  await page.reload();await expect(surface).toHaveAttribute('data-gantt-ready','true');expect((await snapshot(surface)).center).toBe('2027-01-12');
  await page.getByRole('button',{name:'进入统一甘特样式',exact:true}).click();await expect(page.locator('.workspace-gantt-scroll')).toHaveAttribute('data-gantt-ready','true');
  await page.goBack();await expect(surface).toHaveAttribute('data-gantt-ready','true');expect((await snapshot(surface)).center).toBe('2027-01-12');
  await page.getByRole('button',{name:'适配全部',exact:true}).click();await page.waitForTimeout(60);expect((await snapshot(surface)).center!<'2027-01-01').toBe(true);
  await page.getByLabel('跳转到日期',{exact:true}).fill('2027-01-12');await page.getByLabel('跳转到日期',{exact:true}).press('Enter');await page.waitForTimeout(80);
  const fittedRange=await page.locator('.gantt-visible-range').textContent();await page.reload();await expect(surface).toHaveAttribute('data-gantt-ready','true');expect(await page.locator('.gantt-visible-range').textContent()).toBe(fittedRange);
  expect(writes).toEqual([]);
});

test('底部滚动条、触控板和 Shift 滚轮可横移；普通滚轮保持纵向；空筛选恢复视图',async({page})=>{
  await page.goto('/execution');await page.getByRole('button',{name:'展开全部',exact:true}).click();const surface=page.locator('.workspace-gantt-scroll');await expect(surface).toHaveAttribute('data-gantt-ready','true');
  const initial=await snapshot(surface);await surface.hover();await page.mouse.wheel(360,0);await page.waitForTimeout(80);const afterTrackpad=await snapshot(surface);expect(afterTrackpad.left).toBeGreaterThan(initial.left);
  await page.keyboard.down('Shift');await page.mouse.wheel(0,300);await page.keyboard.up('Shift');await page.waitForTimeout(80);const afterShift=await snapshot(surface);expect(afterShift.left).toBeGreaterThan(afterTrackpad.left);
  await page.mouse.wheel(0,150);await page.waitForTimeout(80);expect((await snapshot(surface)).center).toBe(afterShift.center);
  // The unified workspace uses a native scrollbar; moving it keeps the same anchor state.
  await surface.evaluate(e=>{e.scrollLeft+=240;});await page.waitForTimeout(100);
  expect((await snapshot(surface)).center!>=afterShift.center!).toBe(true);
  const beforeFilter=await snapshot(surface);await page.getByPlaceholder('搜索名称或编号').fill('no-such-requirement');await expect(surface.locator('.workspace-gantt-row')).toHaveCount(0);
  await page.getByPlaceholder('搜索名称或编号').fill('');await expect(surface).toHaveAttribute('data-gantt-ready','true');expect((await snapshot(surface)).center).toBe(beforeFilter.center);
});

test('需求范围内拖动和失焦结束不提交业务修改',async({page})=>{
  const writes:string[]=[];page.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/api/'))writes.push(r.url());});
  await page.goto('/?projectId=p1&workspaceView=progress&scopeType=requirement&scopeId=r1');
  const surface=page.locator('.workspace-gantt-scroll');await expect(surface).toHaveAttribute('data-gantt-ready','true');
  const initial=await snapshot(surface);await drag(page,surface,220);expect((await snapshot(surface)).left).toBeGreaterThan(initial.left);
  const beforeBlank=await snapshot(surface),blank=await surface.locator('.workspace-row-track').first().boundingBox();
  if(!blank)throw new Error('No blank track');
  const surfaceBox=(await surface.boundingBox())!;
  await page.mouse.move(surfaceBox.x+surfaceBox.width-155,blank.y+blank.height-3);await page.mouse.down();
  await page.mouse.move(surfaceBox.x+surfaceBox.width-255,blank.y+blank.height-3,{steps:8});
  await expect(surface).toHaveAttribute('data-gantt-panning','true');await page.mouse.up();
  await expect.poll(async()=>(await snapshot(surface)).left).toBeGreaterThan(beforeBlank.left);
  const b=await surface.boundingBox();if(!b)throw new Error('No viewport');await page.mouse.move(b.x+450,b.y+22);await page.mouse.down();await page.mouse.move(b.x+350,b.y+22,{steps:6});
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();await expect(surface).not.toHaveAttribute('data-gantt-panning');
  expect(writes).toEqual([]);
});

test('进展表在窄屏与主题切换后保留日期锚点',{tag:'@responsive'},async({page},info)=>{
  await page.goto('/?projectId=p1&workspaceView=progress&scopeType=requirement&scopeId=r1');
  const surface=page.locator('.workspace-gantt-scroll');await expect(surface).toHaveAttribute('data-gantt-ready','true');
  await page.getByLabel('跳转到日期',{exact:true}).fill('2026-12-15');await page.getByLabel('跳转到日期',{exact:true}).press('Enter');
  await expect.poll(async()=>(await snapshot(surface)).center).toBe('2026-12-15');
  for(const viewport of [page.viewportSize()!,{width:390,height:844}]){
    await page.setViewportSize(viewport);await page.emulateMedia({colorScheme:'dark'});
    await expect.poll(async()=>(await snapshot(surface)).center).toBe('2026-12-15');
    const bounds=await page.locator('.workspace-gantt').boundingBox();expect(bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    const row=await surface.locator('.workspace-row-label').last().boundingBox(),track=await surface.boundingBox();
    expect(row!.x).toBeCloseTo(track!.x,0);
  }
  await page.getByRole('button',{name:'展开侧边栏',exact:true}).click();await expect.poll(async()=>(await snapshot(surface)).center).toBe('2026-12-15');
  await page.getByRole('button',{name:'收起侧边栏',exact:true}).click();await expect.poll(async()=>(await snapshot(surface)).center).toBe('2026-12-15');
  await page.screenshot({path:info.outputPath('gantt-navigation-narrow.png')});
});
