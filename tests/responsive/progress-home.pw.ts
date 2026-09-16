import {expect,test} from '@playwright/test';
import {phaseFixture} from './phase-fixture';
import {chooseOption} from './select-helper';

test('执行按钮区分颜色，日夜主题悬浮和键盘聚焦保持尺寸与可读性',async({page},info)=>{
  const f=await phaseFixture(page);await page.goto('/execution');
  await chooseOption(page.getByLabel('展开层级',{exact:true}),'work');
  const complete=page.locator('[data-row-id="'+f.testing.workItems[1].id+'"]').getByRole('button',{name:'完成',exact:true});
  const direct=page.locator('[data-row-id="'+f.direct.id+'"]').getByRole('button',{name:'完成需求',exact:true});
  for(const theme of ['classic','dcim','midnight','forest','swiss','soft','industrial']){
    await page.evaluate(value=>{localStorage.setItem('project-manage:theme',value);window.dispatchEvent(new StorageEvent('storage',{key:'project-manage:theme',newValue:value}));},theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
    for(const button of [complete,direct]){
      await expect(button).toBeEnabled();
      const expected=await button.evaluate(el=>{const hex=getComputedStyle(el).getPropertyValue('--gantt-completed').trim();return 'rgb('+[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(', ')+')';});
      await expect(button).toHaveCSS('background-color',expected);const before=await button.boundingBox();
      const colors=await button.evaluate(el=>{const style=getComputedStyle(el);return {background:style.backgroundColor,color:style.color};});
      const green=colors.background.match(/[\d.]+/g)!.map(Number);expect(green[1]).toBeGreaterThan(green[0]);expect(green[1]).toBeGreaterThan(green[2]);
      const luminance=(color:string)=>color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
      const values=[luminance(colors.color),luminance(colors.background)];expect((Math.max(...values)+.05)/(Math.min(...values)+.05)).toBeGreaterThanOrEqual(4.5);
      await button.hover();await expect(button).toHaveCSS('background-color',colors.background);expect(await button.boundingBox()).toEqual(before);
      await button.focus();expect(await button.boundingBox()).toEqual(before);
    }
    await page.screenshot({path:info.outputPath('execution-'+theme+'.png'),animations:'disabled'});
  }
});

test('首屏展示近期完成，恢复上次范围，Logo 返回当前项目主页',async({page},info)=>{
  const f=await phaseFixture(page);
  const feature='/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'progress',scopeType:'feature',scopeId:f.feature.id});
  await page.goto(feature);await expect(page.locator('.workspace-gantt')).toBeVisible();
  await page.goto('/issues');await page.goto('/');await expect(page.locator('.workspace-gantt')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('scopeId')).toBe(f.feature.id);
  const home=page.getByRole('link',{name:'返回主页',exact:true});await home.focus();await page.keyboard.press('Enter');
  await expect(page.locator('.outline-table')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('scopeType')).toBe('project');expect(new URL(page.url()).searchParams.get('projectId')).toBe(f.projectId);
  const overview=page.getByRole('region',{name:'当前范围概览'});
  await expect(overview.locator('.overview-metric').filter({hasText:'近7天完成'})).toContainText('1 · 累计 1');
  await expect(overview.locator('.overview-metric').filter({hasText:'推进中'})).toContainText('2');
  const frame=await page.locator('.outline-table').boundingBox();
  await page.getByRole('button',{name:'展开概览',exact:true}).click();const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('heading',{name:'近7天完成',exact:false})).toBeVisible();await expect(dialog.getByRole('button',{name:'DCIM-001 基础台账',exact:true})).toBeVisible();
  expect(await page.locator('.outline-table').boundingBox()).toEqual(frame);await dialog.getByRole('button',{name:'关闭',exact:true}).click();
  await page.screenshot({path:info.outputPath('project-home.png'),animations:'disabled'});
  await page.setViewportSize({width:390,height:844});await page.goto('/issues');await home.click();await expect(page.locator('.outline-table')).toBeVisible();
  await expect(home).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('project-home-narrow.png'),animations:'disabled'});
});
