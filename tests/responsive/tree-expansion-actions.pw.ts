import {expect,test} from '@playwright/test';
import {phaseFixture} from './phase-fixture';
import {chooseOption} from './select-helper';

for(const view of ['list','progress'])test(`${view} 的常驻展开收起支持筛选、刷新与窄屏，操作不移动工具栏`,async({page},info)=>{
  const f=await phaseFixture(page);
  const url=(scopeType='project',scopeId=f.projectId)=>'/?'+new URLSearchParams({projectId:f.projectId,workspaceView:view,scopeType,scopeId});
  await page.goto(url());
  const tools=page.locator(view==='list'?'.outline-actions':'.workspace-time-tools');
  const expand=tools.getByRole('button',{name:'展开全部',exact:true}),collapse=tools.getByRole('button',{name:'收起全部',exact:true});
  const work=page.locator(view==='list'?`[data-object-id="${f.testing.workItems[1].id}"]`:`[data-row-id="${f.testing.workItems[1].id}"]`);
  await expect(expand).toBeInViewport();await expect(collapse).toBeInViewport();
  const positions=async()=>[await expand.boundingBox(),await collapse.boundingBox(),await tools.boundingBox()];
  const initial=await positions();
  await expand.click();await expect(work).toBeVisible();await expect(expand).toBeDisabled();
  await collapse.click();await expect(work).toHaveCount(0);await expect(collapse).toBeDisabled();expect(await positions()).toEqual(initial);
  const search=view==='list'?page.getByRole('searchbox',{name:'筛选清单'}):page.getByPlaceholder('搜索名称或编号');
  await search.fill('测试');await expect(work).toBeVisible();
  await collapse.click();await expect(work).toHaveCount(0);
  await expand.click();await expect(work).toBeVisible();
  await search.fill('');await expect(work).toHaveCount(0);
  await expand.click();await page.reload();await expect(work).toBeVisible();await expect(expand).toBeDisabled();
  if(view==='progress'){
    await chooseOption(page.getByRole('combobox',{name:'展开层级'}),'collapsed');await expect(work).toHaveCount(0);
    await chooseOption(page.getByRole('combobox',{name:'展开层级'}),'work');await expect(work).toBeVisible();
  }
  await page.screenshot({path:info.outputPath(view+'-expanded.png'),animations:'disabled'});
  await page.goto(url('phase',f.phases[1].id));await expect(expand).toBeVisible();
  if(await expand.isEnabled())await expand.click();
  await expect(work).toBeVisible();await collapse.click();await expect(work).toHaveCount(0);
  await expect(page.locator(view==='list'?`[data-object-id="${f.testing.id}"]`:`[data-row-id="${f.testing.id}"]`)).toBeVisible();
  expect(new URL(page.url()).searchParams.get('scopeId')).toBe(f.phases[1].id);
  await page.setViewportSize({width:390,height:844});await tools.evaluate(element=>{element.scrollLeft=0;});
  await expect(expand).toBeInViewport();await expect(collapse).toBeInViewport();
  const narrow=await positions();await expand.click();await collapse.click();expect(await positions()).toEqual(narrow);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath(view+'-narrow.png'),animations:'disabled'});
  await page.goto(url('phase',f.phases[2].id));await expect(expand).toBeDisabled();await expect(collapse).toBeDisabled();
});
