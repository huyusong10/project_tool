import {expect,test,type Page} from '@playwright/test';
import {phaseFixture} from './phase-fixture';
import {headerAction} from './topbar-helpers';
import {chooseOption} from './select-helper';

const view=(page:Page,name:string)=>page.getByRole('region',{name:'页面工具栏'}).getByRole('button',{name,exact:true});
const row=(page:Page,id:string)=>page.locator('[data-object-id="'+id+'"]');
async function frame(page:Page){
  return page.locator('.page-toolbar,.page-toolbar-location,.page-toolbar-views,.page-toolbar-status,.page-toolbar-actions,.workspace-overview,.unified-workspace-body').evaluateAll(elements=>elements.map(element=>{
    const {x,y,width,height}=element.getBoundingClientRect();return {name:element.className,x:Math.round(x),y:Math.round(y),width:Math.round(width),height:Math.round(height)};
  }));
}
async function tableFrame(page:Page){return page.locator('.outline-table thead th').evaluateAll(elements=>elements.map(element=>{const {x,y,width,height}=element.getBoundingClientRect();return [x,y,width,height];}));}

test('视角、层级、画布编辑与概览浮窗保持公共框架坐标',async({page},info)=>{
  test.setTimeout(90000);const f=await phaseFixture(page);await page.goto('/');await expect(page.locator('.workspace-outline')).toBeVisible();
  const initial=await frame(page);
  for(const name of ['关系图','进展表','清单']){await view(page,name).click();await expect.poll(()=>frame(page)).toEqual(initial);}
  await view(page,'关系图').click();await expect(page.locator('[data-layout-ready=true]')).toBeVisible();const canvas=page.locator('.dependency-canvas'),canvasBox=await canvas.boundingBox(),dateFilter=page.locator('.delivery-date-filter'),dateBox=await dateFilter.boundingBox();
  await dateFilter.click();await page.getByLabel('目标日期从',{exact:true}).fill('2026-01-01');await page.getByLabel('目标日期至',{exact:true}).fill('2026-12-31');expect(await canvas.boundingBox()).toEqual(canvasBox);expect(await dateFilter.boundingBox()).toEqual(dateBox);await page.getByRole('button',{name:'清除日期',exact:true}).click();
  await view(page,'清单').click();
  await row(page,'feature:'+f.feature.id).getByRole('button',{name:'进入'+f.feature.name,exact:true}).click();await expect.poll(()=>frame(page)).toEqual(initial);
  await row(page,'phase:'+f.phases[1].id).getByRole('button',{name:'进入Phase 2',exact:true}).click();await expect.poll(()=>frame(page)).toEqual(initial);
  await row(page,f.testing.id).getByRole('button',{name:'进入'+f.testing.title,exact:true}).click();await expect.poll(()=>frame(page)).toEqual(initial);
  await view(page,'关系图').click();await expect(page.locator('[data-layout-ready=true]')).toBeVisible();await expect.poll(()=>frame(page)).toEqual(initial);
  await page.getByRole('button',{name:'编辑画布',exact:true}).click();await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeVisible();await expect.poll(()=>frame(page)).toEqual(initial);
  await page.screenshot({path:info.outputPath('graph-edit-frame.png'),animations:'disabled'});
  await headerAction(page,'放弃修改');await expect.poll(()=>frame(page)).toEqual(initial);
  await page.getByRole('button',{name:'展开概览',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();expect(await frame(page)).toEqual(initial);
  await page.screenshot({path:info.outputPath('overview-dialog.png'),animations:'disabled'});await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('button',{name:'展开概览',exact:true})).toBeFocused();expect(await frame(page)).toEqual(initial);
  await page.setViewportSize({width:390,height:844});await expect(page.getByRole('complementary',{name:'主导航'})).toHaveCSS('width','72px');await expect(page.locator('.page-toolbar')).toHaveCSS('height','88px');const narrow=await frame(page);
  for(const name of ['进展表','清单','关系图']){await view(page,name).click();await expect.poll(()=>frame(page)).toEqual(narrow);}
  await page.getByRole('button',{name:'编辑画布',exact:true}).click();await expect.poll(()=>frame(page)).toEqual(narrow);await page.screenshot({path:info.outputPath('narrow-toolbar.png'),animations:'disabled'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('树表类型、左侧选择、浮动批量工具与详情操作保持列宽',async({page},info)=>{
  const f=await phaseFixture(page);await page.request.post('/api/requirements',{data:{projectId:f.projectId,title:'临时补充'}});await page.goto('/');
  await page.getByRole('button',{name:'展开全部',exact:true}).click();
  const typeColors=await page.locator('.outline-table .workspace-object-mark').evaluateAll(elements=>Object.fromEntries(elements.map(el=>[el.getAttribute('data-kind'),getComputedStyle(el).color])));
  expect(Object.keys(typeColors).sort()).toEqual(['feature','group','phase','requirement','work']);expect(new Set(Object.values(typeColors)).size).toBe(5);
  const initial=await frame(page),columns=await tableFrame(page);
  await row(page,f.testing.id).getByRole('checkbox').check();await expect(page.getByRole('region',{name:'批量操作'})).toBeVisible();expect(await tableFrame(page)).toEqual(columns);expect(await frame(page)).toEqual(initial);
  expect(new URL(page.url()).searchParams.get('scopeType')).toBe('project');await expect(page.locator('.modal-card-workspace[role=dialog]')).toHaveCount(0);
  await expect(page.locator('.outline-table thead input[type=checkbox]')).toHaveJSProperty('indeterminate',true);
  await page.screenshot({path:info.outputPath('typed-tree-selection.png'),animations:'disabled'});await page.getByRole('button',{name:'清空选择',exact:true}).click();expect(await tableFrame(page)).toEqual(columns);
  await row(page,f.testing.id).locator('.outline-title').click();await expect(page.locator('.modal-card-workspace[role=dialog]')).toBeVisible();expect(new URL(page.url()).searchParams.get('scopeType')).toBe('project');expect(await tableFrame(page)).toEqual(columns);expect(await frame(page)).toEqual(initial);
  await page.locator('.modal-card-workspace[role=dialog]').getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('searchbox',{name:'筛选清单'}).fill('不匹配');expect(await tableFrame(page)).toEqual(columns);await page.getByRole('searchbox',{name:'筛选清单'}).fill('');
  const menuSizes=await page.locator('.outline-row-actions button').evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return r.width+'×'+r.height;}));expect(new Set(menuSizes).size).toBe(1);
  await expect(page.locator('.outline-row-actions').getByRole('button',{name:'资料',exact:true})).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});await row(page,f.testing.id).getByRole('checkbox').check();const batch=page.getByRole('region',{name:'批量操作'});await expect(batch.getByRole('button',{name:'调整归属…'})).toBeVisible();
  const b=(await batch.boundingBox())!;expect(b.x).toBeGreaterThanOrEqual(0);expect(b.x+b.width).toBeLessThanOrEqual(390);await page.screenshot({path:info.outputPath('narrow-tree-selection.png'),animations:'disabled'});
  await page.getByRole('button',{name:'展开概览',exact:true}).click();await page.screenshot({path:info.outputPath('narrow-overview.png'),animations:'disabled'});expect(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
});

test('进展名称直接查看详情，执行动作占用固定宽度',async({page},info)=>{
  const f=await phaseFixture(page);await page.goto('/execution');await chooseOption(page.getByLabel('展开层级',{exact:true}),'work');const work=page.locator('[data-row-id="'+f.testing.workItems[1].id+'"]');await expect(work).toBeVisible();
  const initial=await frame(page);await work.locator('.workspace-name-heading').getByRole('button',{name:f.testing.workItems[1].title,exact:true}).click();await expect(page.locator('.modal-card-workspace[role=dialog]')).toBeVisible();expect(new URL(page.url()).searchParams.get('scopeType')).toBe('project');expect(await frame(page)).toEqual(initial);
  await page.locator('.modal-card-workspace[role=dialog]').getByRole('button',{name:'关闭',exact:true}).click();
  await expect(page.locator('.workspace-row-tools').getByRole('button',{name:/^(工作项|资料)$/})).toHaveCount(0);await expect(work.getByRole('button',{name:'完成',exact:true})).toBeVisible();await expect(work.getByRole('button',{name:'更新 '+f.testing.workItems[1].title+' 进度',exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('progress-actions.png'),animations:'disabled'});
  await page.setViewportSize({width:390,height:844});await work.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('narrow-progress-actions.png'),animations:'disabled'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const label=(await work.locator('.workspace-row-label').boundingBox())!,actions=(await work.locator('.workspace-row-actions').boundingBox())!;expect(label.x+label.width).toBeLessThanOrEqual(actions.x);
  const timeTools=page.locator('.workspace-time-tools'),toolbar=(await timeTools.boundingBox())!;
  for(const button of await timeTools.locator('button:visible').all()){const b=(await button.boundingBox())!;expect(b.y).toBeGreaterThanOrEqual(toolbar.y);expect(b.y+b.height).toBeLessThanOrEqual(toolbar.y+toolbar.height);}
});

test('深色主题中的状态文字保持可读对比度',async({page},info)=>{
  test.skip(info.project.name!=='desktop-1080p','两个深色主题共用相同颜色规则');
  await phaseFixture(page);await page.goto('/');await page.getByRole('button',{name:'展开全部',exact:true}).click();
  for(const theme of ['midnight','dcim']){
    await page.evaluate(value=>{localStorage.setItem('project-manage:theme',value);window.dispatchEvent(new StorageEvent('storage',{key:'project-manage:theme',newValue:value}));},theme);await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
    const contrast=await page.locator('.outline-table .stage-badge').evaluateAll(elements=>{
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d')!;
      const luminance=(color:string)=>{ctx.fillStyle=color;ctx.fillRect(0,0,1,1);const pixel=ctx.getImageData(0,0,1,1).data;return [0,1,2].map(i=>{const c=pixel[i]/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);};
      return elements.map(el=>{const s=getComputedStyle(el),a=luminance(s.color),b=luminance(s.backgroundColor);return {text:el.textContent,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});
    });for(const item of contrast)expect(item.ratio,item.text||'状态').toBeGreaterThanOrEqual(4.5);
    await page.screenshot({path:info.outputPath('tree-'+theme+'.png'),animations:'disabled'});
  }
});
