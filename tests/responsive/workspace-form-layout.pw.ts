import {expect,test,type Page} from '@playwright/test';
import {phaseFixture} from './phase-fixture';

async function fits(page:Page){
  const dialog=page.locator('.modal-card-workspace[role=dialog]');
  const rect=(await dialog.boundingBox())!;
  expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.x+rect.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
}

test('详情层级切换保持正文和弹窗矩形，新增工作项表单在窄屏内完整显示',{tag:'@responsive'},async({page},info)=>{
  const f=await phaseFixture(page),url=(id:string,tab='overview')=>'/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'progress',scopeType:'project',detailId:id,detailTab:tab});
  for(const viewport of [info.project.use.viewport!,{width:390,height:844}]){
    await page.setViewportSize(viewport);await page.goto(url('feature:'+f.feature.id));
    const detail=page.locator('.modal-card-workspace[role=dialog]');await expect(detail.getByRole('tab',{name:'概况',exact:true})).toBeVisible();
    const frame=await detail.boundingBox(),grid=await page.getByRole('treegrid').boundingBox();
    await detail.getByRole('tab',{name:'交付范围',exact:true}).click();await detail.getByRole('button',{name:'Phase 2',exact:true}).click();
    await expect(detail.getByRole('tab',{name:'需求清单',exact:true})).toBeVisible();expect(await detail.boundingBox()).toEqual(frame);
    await detail.getByRole('tab',{name:'需求清单',exact:true}).click();await detail.getByRole('button',{name:f.testing.title,exact:true}).click();
    await detail.getByRole('tab',{name:/^工作项 /}).click();await detail.locator('.detail-work-row-title').filter({hasText:'测试'}).click();
    await expect(detail.getByRole('tablist',{name:'工作项详情内容'})).toBeVisible();expect(await detail.boundingBox()).toEqual(frame);
    await detail.getByRole('button',{name:'返回'+f.testing.title,exact:true}).click();
    await detail.getByRole('button',{name:'添加工作项',exact:true}).click();const create=detail.getByRole('form',{name:'新增工作项'});
    await create.getByLabel('新工作项名称',{exact:true}).fill('布局检查');await fits(page);
    await expect(create.getByRole('button',{name:'保存工作项',exact:true})).toBeInViewport();
    expect(await create.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await page.screenshot({path:info.outputPath('detail-create-'+viewport.width+'.png'),animations:'disabled'});
    await create.getByRole('button',{name:'取消',exact:true}).click();await detail.locator(':scope > header').getByRole('button',{name:'关闭',exact:true}).click();
    expect(await page.getByRole('treegrid').boundingBox()).toEqual(grid);
  }
});

test('问题优先级在标准视口和窄屏内保持完整短标签',{tag:'@responsive'},async({page},info)=>{
  const f=await phaseFixture(page),response=await page.request.post('/api/issues',{data:{projectId:f.projectId,title:'完整优先级',priority:'P0',ownerId:f.testing.ownerId}});expect(response.ok()).toBe(true);
  await page.goto('/issues?projectId='+f.projectId);
  for(const viewport of [info.project.use.viewport!,{width:900,height:844},{width:390,height:844}]){
    await page.setViewportSize(viewport);const badge=page.locator('.issue-data-priority .priority-badge').first();await badge.scrollIntoViewIfNeeded();
    expect(await badge.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    expect(await badge.evaluate(el=>{const box=el.getBoundingClientRect(),cell=el.closest('[role=cell]')!.getBoundingClientRect();return box.left>=cell.left&&box.right<=cell.right;})).toBe(true);
    await page.screenshot({path:info.outputPath('priority-'+viewport.width+'.png'),animations:'disabled'});
  }
});

test('短操作在标准视口和窄屏各主题中保留背景且不溢出',{tag:'@responsive'},async({page},info)=>{
  const f=await phaseFixture(page);await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'progress',scopeType:'project',detailId:f.testing.id,detailTab:'work'}));
  const root=page.locator('.modal-card-workspace[role=dialog]'),row=root.locator('[data-work-id="'+f.testing.workItems[1].id+'"]');
  for(const viewport of [info.project.use.viewport!,{width:390,height:640}]){
    await page.setViewportSize(viewport);await expect(row).toBeVisible();const before=await root.boundingBox();
    for(const theme of ['classic','dcim','midnight','forest','swiss','soft','industrial']){
      await page.evaluate(value=>{localStorage.setItem('project-manage:theme',value);window.dispatchEvent(new StorageEvent('storage',{key:'project-manage:theme',newValue:value}));},theme);
      await row.getByRole('button',{name:'完成',exact:true}).click();const form=page.getByRole('dialog',{name:'完成工作项',exact:true});await expect(form).toBeVisible();
      expect(await root.boundingBox()).toEqual(before);expect(await form.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
      const box=(await form.boundingBox())!;expect(box.width).toBeLessThanOrEqual(480);expect(box.height).toBeLessThan(500);
      await expect(form.getByRole('button',{name:'确认完成',exact:true})).toBeInViewport();
      await page.screenshot({path:info.outputPath('completion-'+theme+'-'+viewport.width+'.png'),animations:'disabled'});await page.keyboard.press('Escape');
    }
  }
});
