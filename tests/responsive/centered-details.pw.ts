import {expect,test} from '@playwright/test';
import {phaseFixture} from './phase-fixture';
const themes=['classic','dcim','midnight','forest','swiss','soft','industrial'];

test('关系图选中与详情独立，三个视角使用同一居中详情',{tag:'@responsive'}, async({page},info)=>{
  const f=await phaseFixture(page);
  const link=(view:string)=>'/?'+new URLSearchParams({projectId:f.projectId,workspaceView:view,scopeType:'requirement',scopeId:f.testing.id});
  await page.goto(link('graph'));await expect(page.locator('[data-layout-ready=true]')).toBeVisible();
  const node=page.locator('.react-flow__node[data-id="'+f.testing.workItems[1].id+'"]');
  await node.locator('.dependency-card-top').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('pathNode')).toBe(f.testing.workItems[1].id);
  await node.locator('.graph-title').click();
  const modal=page.getByRole('dialog');await expect(modal.getByRole('tablist',{name:'工作项详情内容'})).toBeVisible();
  const frame=await modal.boundingBox();
  await modal.getByRole('button',{name:'关闭',exact:true}).click();
  expect(new URL(page.url()).searchParams.get('pathNode')).toBe(f.testing.workItems[1].id);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goBack();await expect(modal).toBeVisible();await page.goForward();await expect(modal).toHaveCount(0);
  for(const view of ['list','progress']){
    await page.goto(link(view)+'&detailId='+f.testing.workItems[1].id);
    await expect(modal.getByRole('tablist',{name:'工作项详情内容'})).toBeVisible();
    expect(await modal.boundingBox()).toEqual(frame);
    await modal.getByRole('tab',{name:'记录',exact:true}).click();await expect(modal.getByText('测试场景完成七成',{exact:true})).toBeVisible();
    await page.screenshot({path:info.outputPath('work-'+view+'.png'),animations:'disabled'});
  }
});

test('工作项排序、直接操作及七主题在桌面与窄屏稳定',{tag:'@responsive'}, async({page},info)=>{
  const f=await phaseFixture(page);
  await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'list',scopeType:'requirement',scopeId:f.testing.id,detailId:f.testing.id,detailTab:'work'}));
  const modal=page.getByRole('dialog');await expect(modal.locator('.work-arrangement-row')).toHaveCount(2);
  const handle=modal.getByRole('button',{name:'拖动测试调整顺序',exact:true});
  await handle.focus();await page.keyboard.press('Space');await expect(page.locator('.drag-preview')).toContainText('测试');await page.keyboard.press('ArrowUp');await expect(modal.locator('.work-arrangement-row').first()).toHaveClass(/is-over/);await page.keyboard.press('Space');
  await expect.poll(async()=>((await(await page.request.get('/api/requirements/'+f.testing.id)).json()).workItems as {title:string}[]).map(w=>w.title)).toEqual(['测试','开发']);
  await expect(modal.getByRole('button',{name:'更多工作项操作',exact:true})).toHaveCount(0);
  await expect(modal.getByRole('button',{name:/^[上下]移/})).toHaveCount(0);
  await expect(modal.locator('.work-arrangement-row').first()).toHaveAttribute('data-work-id',f.testing.workItems[1].id);await expect(handle).toBeEnabled();
  await handle.focus();await page.keyboard.press('Space');await expect(page.locator('.drag-preview')).toBeVisible();await page.keyboard.press('ArrowDown');await expect(modal.locator('.work-arrangement-row').last()).toHaveClass(/is-over/);await page.keyboard.press('Space');
  await expect.poll(async()=>((await(await page.request.get('/api/requirements/'+f.testing.id)).json()).workItems as {title:string}[]).map(w=>w.title)).toEqual(['开发','测试']);
  await expect(modal.locator('.work-arrangement-row').first()).toHaveAttribute('data-work-id',f.testing.workItems[0].id);await expect(handle).toBeEnabled();
  const from=(await handle.boundingBox())!,to=(await modal.getByRole('button',{name:'拖动开发调整顺序',exact:true}).boundingBox())!;
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(from.x+from.width/2+12,from.y+from.height/2-12,{steps:4});await expect(page.locator('.drag-preview')).toContainText('测试');await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:8});await expect(modal.locator('.work-arrangement-row').first()).toHaveClass(/is-over/);await page.mouse.up();
  await expect.poll(async()=>((await(await page.request.get('/api/requirements/'+f.testing.id)).json()).workItems as {title:string}[]).map(w=>w.title)).toEqual(['测试','开发']);
  const frame=await modal.boundingBox();
  for(const theme of themes){
    await page.evaluate(value=>{localStorage.setItem('project-manage:theme',value);window.dispatchEvent(new StorageEvent('storage',{key:'project-manage:theme',newValue:value}));},theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
    const complete=modal.getByRole('button',{name:'完成',exact:true});await expect(complete).toBeVisible();
    const before=await complete.boundingBox();await complete.hover();expect(await complete.boundingBox()).toEqual(before);expect(await modal.boundingBox()).toEqual(frame);
    await page.screenshot({path:info.outputPath('work-list-'+theme+'.png'),animations:'disabled'});
  }
  await page.setViewportSize({width:390,height:640});
  await expect(modal.getByRole('button',{name:'添加工作项',exact:true})).toBeInViewport();
  expect(await modal.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  expect(await modal.locator('.work-arrangement-field').filter({has:page.getByText('计划开始',{exact:true})}).locator('.inline-edit-value').evaluateAll(nodes=>nodes.every(node=>node.scrollWidth<=node.clientWidth+1))).toBe(true);
  await expect(modal.getByRole('button',{name:'修正实际日期',exact:true}).first()).toBeVisible();
  await page.screenshot({path:info.outputPath('work-list-short-narrow.png'),animations:'disabled'});
});
