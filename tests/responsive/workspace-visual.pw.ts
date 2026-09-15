import {expect,test} from '@playwright/test';
import {phaseFixture} from './phase-fixture';
import {chooseOption} from './select-helper';

test('名称负责人固定在左，进展在时间轴内，摘要不移动表格',async({page},info)=>{
  const f=await phaseFixture(page),work=f.testing.workItems[1];
  const response=await page.request.post('/api/requirements/'+f.testing.id+'/progress',{data:{expectedVersion:work.version,workItemId:work.id,workItemPercent:70,content:'验证会议中直接阅读最近进展'}});
  expect(response.ok(),await response.text()).toBe(true);
  const requests:string[]=[];page.on('request',r=>{if(/\/api\/requirements\//.test(r.url()))requests.push(r.url());});
  await page.goto('/execution');await chooseOption(page.getByLabel('展开层级',{exact:true}),'work');
  const grid=page.getByRole('treegrid'),row=grid.locator('[data-row-id="'+work.id+'"]');
  const before=(await grid.boundingBox())!,stage=(await row.locator('.workspace-row-label').boundingBox())!,track=(await row.locator('.workspace-row-track').boundingBox())!;
  expect(Math.abs(stage.x+stage.width-track.x-await grid.evaluate(el=>el.scrollLeft))).toBeLessThan(1);
  const day=page.getByRole('button',{name:'日',exact:true});await day.click();
  await expect(grid.locator('.gantt-scale-month').first()).toContainText('年');
  const monthVisible=()=>grid.locator('.gantt-scale-month b').evaluateAll(nodes=>nodes.some(el=>{const b=el.getBoundingClientRect(),header=el.closest('.workspace-gantt-heading')!;const left=header.querySelector('.workspace-row-label')!.getBoundingClientRect().right,right=header.querySelector('.workspace-row-actions')!.getBoundingClientRect().left;return b.left>=left-1&&b.right<=right+1;}));
  expect(await monthVisible()).toBe(true);
  const hit=row.locator('.gantt-date-hitbox');await hit.focus();
  const tooltip=page.getByRole('tooltip');await expect(tooltip).toContainText('验证会议中直接阅读最近进展');
  await expect(tooltip).toContainText('实际日期');await expect(tooltip).toContainText('预计完成');
  expect(await grid.boundingBox()).toEqual(before);expect(requests).toHaveLength(0);
  await page.screenshot({path:info.outputPath('progress-summary.png'),animations:'disabled'});
  await page.keyboard.press('Escape');await expect(tooltip).toBeHidden();
  const progressVisible=()=>row.locator('.workspace-row-progress').evaluate(el=>{const b=el.getBoundingClientRect(),r=el.closest('[data-row-id]')!;return b.left>=r.querySelector('.workspace-row-label')!.getBoundingClientRect().right&&b.right<=r.querySelector('.workspace-row-actions')!.getBoundingClientRect().left;});
  await expect.poll(progressVisible).toBe(true);
  await grid.evaluate(el=>{el.scrollLeft=Math.max(0,el.scrollWidth-el.clientWidth);});
  await expect.poll(progressVisible).toBe(true);
  expect(await monthVisible()).toBe(true);
  const cover=await row.locator('.workspace-row-progress').evaluate(el=>{const b=el.getBoundingClientRect();return el.contains(document.elementFromPoint(b.right-4,b.top+b.height/2));});expect(cover).toBe(true);
  await grid.evaluate(el=>{el.scrollLeft=0;});
  await page.screenshot({path:info.outputPath('progress-table.png'),animations:'disabled'});
  await page.setViewportSize({width:390,height:844});await row.scrollIntoViewIfNeeded();
  await expect(row.getByRole('button',{name:'更新 '+work.title+' 进度',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('progress-narrow.png'),animations:'disabled'});
});

test('不同主题保留统一执行色，深色主题数字和操作可读',async({page},info)=>{
  test.skip(info.project.name!=='desktop-1080p','在一个办公视口检查全部主题');
  const f=await phaseFixture(page);await page.goto('/execution');await chooseOption(page.getByLabel('展开层级',{exact:true}),'work');
  const row=page.locator('[data-row-id="'+f.testing.workItems[1].id+'"]');
  for(const theme of ['classic','swiss','forest','midnight','soft','industrial','dcim']){
    await page.evaluate(value=>{localStorage.setItem('project-manage:theme',value);window.dispatchEvent(new StorageEvent('storage',{key:'project-manage:theme',newValue:value}));},theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
    const dark=['midnight','dcim'].includes(theme);
    const bar=await row.locator('.gantt-date-actual').evaluate(el=>getComputedStyle(el).backgroundColor);
    expect(bar).toBe(dark?'rgb(120, 153, 188)':'rgb(68, 107, 145)');
    await expect(row.getByRole('button',{name:'完成',exact:true})).toHaveCSS('color',dark?'rgb(16, 23, 25)':'rgb(255, 255, 255)');
    await page.screenshot({path:info.outputPath('progress-'+theme+'.png'),animations:'disabled'});
  }
});
