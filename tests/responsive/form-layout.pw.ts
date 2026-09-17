import { expect,test } from '@playwright/test';
import { mockForms,scenarios } from './form-fixture';
import { headerAction } from './topbar-helpers';

for(const scenario of scenarios.filter(item=>item.kind!=='template'))test(`${scenario.name} 错误状态保持在视口内`,{tag:'@responsive'},async({page})=>{
  await mockForms(page);
  await page.route('**'+scenario.endpoint,route=>route.request().method()===scenario.method
    ?route.fulfill({status:400,json:{error:'请修正输入后重试',code:'VALIDATION_ERROR'}}):route.fallback());
  await page.goto(scenario.path);await headerAction(page,scenario.trigger);
  const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
  await dialog.getByLabel(scenario.field,{exact:true}).fill('布局错误态测试');
  await dialog.getByRole('button',{name:scenario.submit,exact:true}).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  const bounds=(await dialog.boundingBox())!,viewport=page.viewportSize()!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x+bounds.width).toBeLessThanOrEqual(viewport.width+1);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y+bounds.height).toBeLessThanOrEqual(viewport.height+1);
});
