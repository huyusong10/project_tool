import {expect,test} from '@playwright/test';
import {phaseFixture} from './phase-fixture';
import {chooseOption} from './select-helper';

test('执行按钮区分颜色，日夜主题悬浮和键盘聚焦保持尺寸与可读性',{tag:'@responsive'},async({page},info)=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  const f=await phaseFixture(page);await page.goto('/execution');
  await chooseOption(page.getByLabel('展开层级',{exact:true}),'work');
  const complete=page.locator('[data-row-id="'+f.testing.workItems[1].id+'"]').getByRole('button',{name:'完成',exact:true});
  const direct=page.locator('[data-row-id="'+f.direct.id+'"]').getByRole('button',{name:'完成需求',exact:true});
  for(const theme of ['classic','dcim','midnight','forest','swiss','soft','industrial']){
    await page.evaluate(value=>{localStorage.setItem('project-manage:theme',value);window.dispatchEvent(new StorageEvent('storage',{key:'project-manage:theme',newValue:value}));},theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
    for(const button of [complete,direct]){
      await expect(button).toBeEnabled();
      await page.mouse.move(0,0);await expect(button).toHaveAttribute('data-tone','success');const before=await button.boundingBox();
      const colors=await button.evaluate(el=>{const style=getComputedStyle(el),canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d')!;const rgb=(value:string)=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return Array.from(ctx.getImageData(0,0,1,1).data).slice(0,3);};return {background:style.backgroundColor,color:rgb(style.color),rgb:rgb(style.backgroundColor)};});
      const green=colors.color;expect(green[1],theme+' success text').toBeGreaterThan(green[0]);expect(green[1],theme+' success text').toBeGreaterThan(green[2]);
      const luminance=(color:number[])=>color.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
      const values=[luminance(colors.color),luminance(colors.rgb)];expect((Math.max(...values)+.05)/(Math.min(...values)+.05)).toBeGreaterThanOrEqual(4.5);
      await button.hover();await expect(button).not.toHaveCSS('background-color',colors.background);expect(await button.boundingBox()).toEqual(before);
      await button.focus();expect(await button.boundingBox()).toEqual(before);
    }
    await page.screenshot({path:info.outputPath('execution-'+theme+'.png'),animations:'disabled'});
  }
});

test('首屏展示近期完成，恢复上次视角，Logo 返回当前项目主页',async({page},info)=>{
  const f=await phaseFixture(page);
  const feature='/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'progress',scopeType:'feature',scopeId:f.feature.id});
  await page.goto(feature);await expect(page.locator('.workspace-gantt')).toBeVisible();
  await page.goto('/issues');await page.goto('/');await expect(page.locator('.workspace-gantt')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('scopeId')).toBe(f.projectId);
  const home=page.getByRole('link',{name:'返回主页',exact:true});await home.focus();await page.keyboard.press('Enter');
  await expect(page.locator('.outline-table')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('scopeType')).toBe('project');expect(new URL(page.url()).searchParams.get('projectId')).toBe(f.projectId);
  const overview=page.getByRole('region',{name:'当前范围概览'});
  await expect(overview.locator('.overview-metric').filter({hasText:'近7天完成'})).toContainText('1 · 累计 1');
  await expect(overview.locator('.overview-metric').filter({hasText:'推进中'})).toContainText('2');
  await page.getByRole('button',{name:'展开概览',exact:true}).click();const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('heading',{name:'近7天完成',exact:false})).toBeVisible();await expect(dialog.getByRole('button',{name:'DCIM-001 基础台账',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'关闭',exact:true}).click();
  await page.screenshot({path:info.outputPath('project-home.png'),animations:'disabled'});

});

test('项目概览弹窗不移动清单',{tag:'@responsive'},async({page})=>{
  await phaseFixture(page);await page.goto('/');await expect(page.locator('.outline-table')).toBeVisible();
  const frame=await page.locator('.outline-table').boundingBox();
  await page.getByRole('button',{name:'展开概览',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.locator('.outline-table').boundingBox()).toEqual(frame);
  expect(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
});
