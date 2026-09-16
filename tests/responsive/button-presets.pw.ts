import {expect, test} from '@playwright/test';
import {phaseFixture} from './phase-fixture';

test('公共按钮七主题可读，加载不改变按钮和相邻控件位置', async ({page}, info) => {
  await phaseFixture(page);
  await page.goto('/resources');
  await page.getByRole('button', {name:'新增人员', exact:true}).click();
  const dialog=page.getByRole('dialog', {name:'新增人员', exact:true});
  await dialog.getByLabel('姓名', {exact:true}).fill('按钮加载验证');
  const submit=dialog.locator('button[type=submit]'), cancel=dialog.getByRole('button',{name:'取消',exact:true});
  for(const theme of ['classic','dcim','midnight','forest','swiss','soft','industrial']) {
    await page.evaluate(value=>{localStorage.setItem('project-manage:theme',value);window.dispatchEvent(new StorageEvent('storage',{key:'project-manage:theme',newValue:value}));},theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
    await page.mouse.move(0,0);
    for(const button of [submit,cancel]) {
      await expect(button).toHaveCSS('height','36px');
      const box=await button.boundingBox();
      for(const state of ['rest','hover','focus']) {
        if(state==='hover')await button.hover();
        if(state==='focus')await button.focus();
        await expect.poll(()=>button.evaluate(el=>{
          const s=getComputedStyle(el);
          const luminance=(color:string)=>color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v=>color.startsWith("color(srgb")?v:v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
          const a=luminance(s.color),b=luminance(s.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
        })).toBeGreaterThanOrEqual(4.5);
        expect(await button.boundingBox()).toEqual(box);
      }
    }
    await page.screenshot({path:info.outputPath('buttons-'+theme+'.png'),animations:'disabled'});
  }
  let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/people',async route=>{if(route.request().method()!=='POST')return route.fallback();await pending;return route.fulfill({status:400,json:{message:'验证失败时保留输入'}});});
  try {
    const submitBox=await submit.boundingBox(),cancelBox=await cancel.boundingBox();
    await submit.click();await expect(submit).toHaveAttribute('aria-busy','true');await expect(submit).toBeDisabled();
    expect(await submit.boundingBox()).toEqual(submitBox);expect(await cancel.boundingBox()).toEqual(cancelBox);
    await page.screenshot({path:info.outputPath('buttons-busy.png'),animations:'disabled'});
    release();await expect(submit).toBeEnabled();await expect(dialog.getByLabel('姓名',{exact:true})).toHaveValue('按钮加载验证');
    await page.setViewportSize({width:390,height:844});await expect(submit).toBeInViewport();await expect(cancel).toBeInViewport();
    await page.screenshot({path:info.outputPath('buttons-narrow.png'),animations:'disabled'});
  } finally {release();}
});
