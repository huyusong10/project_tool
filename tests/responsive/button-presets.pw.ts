import {expect, test, type Locator, type Page} from '@playwright/test';
import {phaseFixture} from './phase-fixture';

test.beforeEach(async({page})=>{await page.emulateMedia({reducedMotion:'reduce'});});
const themes=['classic','dcim','midnight','forest','swiss','soft','industrial'];
async function changeTheme(page:Page,theme:string){
  await page.evaluate(value=>{localStorage.setItem('project-manage:theme',value);window.dispatchEvent(new StorageEvent('storage',{key:'project-manage:theme',newValue:value}));},theme);
  await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
  await page.mouse.move(0,0);
}
async function contrast(button:Locator){
  return button.evaluate(el=>{
    const rgb=(color:string)=>{const values=color.match(/[\d.]+/g)!.map(Number);return [...values.slice(0,3).map(v=>color.startsWith('color(srgb')?v:v/255),values[3]??1];};
    const luminance=(values:number[])=>values.slice(0,3).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
    let background=[0,0,0,0];
    for(let node:Element|null=el;node&&background[3]<1;node=node.parentElement){const color=rgb(getComputedStyle(node).backgroundColor),alpha=color[3]*(1-background[3]);background=[...background.slice(0,3).map((v,i)=>v+color[i]*alpha),background[3]+alpha];}
    const a=luminance(rgb(getComputedStyle(el).color)),b=luminance(background.slice(0,3).map(v=>v+1-background[3]));
    return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  });
}

test('公共按钮七主题可读，加载不改变按钮和相邻控件位置', async ({page}, info) => {
  await phaseFixture(page);
  await page.goto('/resources');
  await page.getByRole('button', {name:'新增人员', exact:true}).click();
  const dialog=page.getByRole('dialog', {name:'新增人员', exact:true});
  await dialog.getByLabel('姓名', {exact:true}).fill('按钮加载验证');
  const submit=dialog.locator('button[type=submit]'), cancel=dialog.getByRole('button',{name:'取消',exact:true});
  const primaryColors=new Set<string>();
  for(const theme of themes) {
    await changeTheme(page,theme);
    for(const button of [submit,cancel]) {
      await expect(button).toHaveCSS('height','36px');
      const box=await button.boundingBox();
      for(const state of ['rest','hover','focus']) {
        if(state==='hover')await button.hover();
        if(state==='focus')await button.focus();
        await expect.poll(()=>contrast(button)).toBeGreaterThanOrEqual(4.5);
        expect(await button.boundingBox()).toEqual(box);
      }
    }
    primaryColors.add(await submit.evaluate(el=>getComputedStyle(el).backgroundColor));
    await page.screenshot({path:info.outputPath('buttons-'+theme+'.png'),animations:'disabled'});
  }
  expect(primaryColors.size).toBe(themes.length);
  let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/people',async route=>{if(route.request().method()!=='POST')return route.fallback();await pending;return route.fulfill({status:400,json:{message:'验证失败时保留输入'}});});
  try {
    const submitBox=await submit.boundingBox(),cancelBox=await cancel.boundingBox();
    await submit.click();await expect(submit).toHaveAttribute('aria-busy','true');await expect(submit).toBeDisabled();
    await expect(submit).toHaveCSS('color','rgba(0, 0, 0, 0)');
    expect(await submit.boundingBox()).toEqual(submitBox);expect(await cancel.boundingBox()).toEqual(cancelBox);
    await page.screenshot({path:info.outputPath('buttons-busy.png'),animations:'disabled'});
    release();await expect(submit).toBeEnabled();await expect(dialog.getByLabel('姓名',{exact:true})).toHaveValue('按钮加载验证');
    await page.setViewportSize({width:390,height:844});await expect(submit).toBeInViewport();await expect(cancel).toBeInViewport();
    await page.screenshot({path:info.outputPath('buttons-narrow.png'),animations:'disabled'});
  } finally {release();}
});

test('进展操作与选中状态跟随主题，完成、返工、删除在交互时保持可读',async({page},info)=>{
  const f=await phaseFixture(page);
  await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'progress',scopeType:'feature',scopeId:f.feature.id}));
  const row=page.locator('[data-row-id="'+f.testing.id+'"]');
  await row.getByRole('button',{name:'展开 '+f.testing.title,exact:true}).click();
  const work=page.locator('[data-row-id="'+f.testing.workItems[1].id+'"]');
  const complete=work.getByRole('button',{name:'完成',exact:true}),progress=row.getByRole('button',{name:'更新进展',exact:true});
  const rework=page.getByRole('treegrid').getByRole('button',{name:'返工',exact:true});
  const selected=page.getByRole('region',{name:'页面工具栏',exact:true}).getByRole('button',{name:'进展表',exact:true});
  const selectedColors=new Set<string>();
  for(const theme of themes){
    await changeTheme(page,theme);
    for(const button of [complete,progress,rework,selected]){
      await button.scrollIntoViewIfNeeded();const box=await button.boundingBox();
      await expect.poll(()=>contrast(button)).toBeGreaterThanOrEqual(4.5);
      const rest=await button.evaluate(el=>getComputedStyle(el).backgroundColor);
      await button.hover();await expect.poll(()=>contrast(button)).toBeGreaterThanOrEqual(4.5);
      await expect(button).not.toHaveCSS('background-color',rest);
      const hover=await button.evaluate(el=>getComputedStyle(el).backgroundColor);
      await button.focus();expect(await button.boundingBox()).toEqual(box);
      await page.mouse.down();
      try {await expect.poll(()=>contrast(button)).toBeGreaterThanOrEqual(4.5);await expect(button).not.toHaveCSS('background-color',hover);expect(await button.boundingBox()).toEqual(box);}
      finally {await page.mouse.move(0,0);await page.mouse.up();}
    }
    selectedColors.add(await selected.evaluate(el=>getComputedStyle(el).backgroundColor));
    await page.screenshot({path:info.outputPath('progress-buttons-'+theme+'.png'),animations:'disabled'});
    await work.getByRole('button',{name:'更多工作项操作',exact:true}).click();
    const danger=page.getByRole('button',{name:'取消工作项',exact:true});
    await expect(danger).toBeVisible();await expect.poll(()=>contrast(danger)).toBeGreaterThanOrEqual(4.5);
    await danger.hover();await expect.poll(()=>contrast(danger)).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({path:info.outputPath('menu-buttons-'+theme+'.png'),animations:'disabled'});
    await page.keyboard.press('Escape');
  }
  expect(selectedColors.size).toBe(themes.length);
});
