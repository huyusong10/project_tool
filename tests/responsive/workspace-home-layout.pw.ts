import {expect,test} from '@playwright/test';
import {phaseFixture} from './phase-fixture';

test('主页返回、范围概览和需求详情在标准视口与窄屏内保留工作区矩形',{tag:'@responsive'},async({page},info)=>{
  const f=await phaseFixture(page);
  for(const viewport of [info.project.use.viewport!,{width:390,height:844}]){
    await page.setViewportSize(viewport);await page.goto('/issues?projectId='+f.projectId);
    const home=page.getByRole('link',{name:'返回主页',exact:true});await expect(home).toBeInViewport();await home.click();
    const table=page.locator('.outline-table');await expect(table).toBeVisible();const frame=await table.boundingBox();
    await page.getByRole('button',{name:'展开概览',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();expect(await table.boundingBox()).toEqual(frame);
    await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
    await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'list',scopeType:'phase',scopeId:f.phases[1].id}));
    await page.locator('[data-object-id="'+f.testing.id+'"] .outline-title').click();const detail=page.locator('.modal-card-workspace[role=dialog]');await expect(detail).toBeVisible();
    expect(await detail.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.screenshot({path:info.outputPath('workspace-details-'+viewport.width+'.png'),animations:'disabled'});
  }
});

test('折叠需求的进展入口在窄屏可打开工作项表单，关闭后恢复焦点',{tag:'@responsive'},async({page},info)=>{
  const f=await phaseFixture(page);
  for(const viewport of [info.project.use.viewport!,{width:390,height:844}]){
    await page.setViewportSize(viewport);await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'progress',scopeType:'project'}));
    const requirement=page.locator('[data-row-id="'+f.testing.id+'"]'),trigger=requirement.getByRole('button',{name:'更新进展',exact:true});await trigger.click();
    const panel=page.locator('.modal-card-workspace[role=dialog]'),work=panel.locator('[data-work-id="'+f.testing.workItems[1].id+'"]');await expect(work).toBeVisible();
    expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await work.getByRole('button',{name:'更新 测试 进度',exact:true}).click();const progress=page.getByRole('dialog',{name:'更新工作项进度',exact:true});await expect(progress).toBeVisible();
    expect(await progress.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('progress-form-'+viewport.width+'.png'),animations:'disabled'});
    await page.keyboard.press('Escape');await expect(panel).toBeVisible();await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);await expect(trigger).toBeFocused();
  }
});
