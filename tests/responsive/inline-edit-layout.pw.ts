import {test,expect,type Locator} from '@playwright/test';
import {mockApplication} from './inline-edit-fixture';

async function shape(root:Locator){return root.evaluate(e=>[e,...e.querySelectorAll('.work-arrangement-row,.work-arrangement-field')].map(node=>{const b=node.getBoundingClientRect();return {width:b.width,height:b.height};}));}

test('编辑浮层与保存提示不改变工作项清单尺寸',{tag:'@responsive'},async({page})=>{
  await mockApplication(page,[]);await page.goto('/requirements/r1');await page.getByRole('tab',{name:/^工作项 /}).click();
  const list=page.locator('.work-arrangement-list'),before=await shape(list);
  for(const label of [/主负责人：未分配/,/协作人员：无协作人员/,/计划开始：2026-09-01/]){
    await list.getByRole('button',{name:label}).first().click();
    const popover=page.locator('.inline-edit-popover');await expect(popover).toBeVisible();expect(await shape(list)).toEqual(before);
    const box=(await popover.boundingBox())!,viewport=page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(viewport.width+1);expect(box.y+box.height).toBeLessThanOrEqual(viewport.height+1);
    await page.keyboard.press('Escape');
  }
  await list.getByRole('button',{name:/计划开始：2026-09-01/}).first().click();
  await page.locator('.inline-date-popover').getByRole('gridcell',{name:'2026-09-02',exact:true}).click();await page.locator('.inline-date-popover').getByRole('button',{name:'保存',exact:true}).click();
  const trigger=list.getByRole('button',{name:/计划开始：2026-09-02/}).first();await expect(trigger.locator('.inline-edit-success')).toBeVisible();expect(await shape(list)).toEqual(before);
  expect(await trigger.evaluate(e=>{const b=e.getBoundingClientRect(),i=e.querySelector('.inline-edit-success')!.getBoundingClientRect();return i.left>=b.left&&i.right<=b.right&&i.top>=b.top&&i.bottom<=b.bottom;})).toBe(true);
});

test('问题详情切换内容保持窗口尺寸，历史记录可滚动查看',{tag:'@responsive'},async({page})=>{
  await mockApplication(page,[],{issue:{dueDate:'2026-08-25',overdue:true,updates:[{id:'iu1',issueId:'i1',progress:50,content:'历史进展内容应当可以完整滚动查看',eventType:'progress',createdByAccountId:'admin',createdByName:'管理员',createdAt:'2026-09-02T08:00:00.000Z',updatedAt:'2026-09-02T08:00:00.000Z'}]}});
  await page.goto('/issues');
  const tops=await page.locator('.issue-data-row:first-child > .adaptive-data-cell:not([data-importance="secondary"]) .data-cell-primary').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().top));
  expect(Math.max(...tops)-Math.min(...tops)).toBeLessThanOrEqual(1);
  await page.locator('.issue-title-button').click();const dialog=page.getByRole('dialog',{name:'问题详情'});await expect(dialog.getByLabel('问题标题',{exact:true})).toBeVisible();
  const before=(await dialog.boundingBox())!;
  await dialog.getByRole('tab',{name:/^记录 /}).click();expect(await dialog.boundingBox()).toEqual(before);
  const panel=dialog.getByRole('tabpanel');await expect(panel).toHaveCSS('overflow-y','auto');
  const row=dialog.locator('.issue-update-setting-row').first();await row.scrollIntoViewIfNeeded();
  expect(await row.evaluate(e=>{const p=e.closest('[role=tabpanel]')!.getBoundingClientRect(),r=e.getBoundingClientRect();return r.top>=p.top-1&&r.bottom<=p.bottom+1;})).toBe(true);
  await dialog.getByRole('tab',{name:'基本信息',exact:true}).click();expect(await dialog.boundingBox()).toEqual(before);
});

test('问题与账号单元格的主次信息对齐，需求资料不溢出',{tag:'@responsive'},async({page})=>{
  await mockApplication(page,[],{issue:{dueDate:'2026-08-25',overdue:true},account:{mustChangePassword:true}});
  const left=(selector:string)=>page.locator(selector).evaluate(e=>{const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);let n=walker.nextNode();while(n&&!n.textContent?.trim())n=walker.nextNode();if(!n)return e.getBoundingClientRect().left;const r=document.createRange();r.selectNodeContents(n);return r.getBoundingClientRect().left;});
  await page.goto('/issues');
  const cell='.issue-data-row:first-child .issue-data-due .data-cell';
  expect(Math.abs(await left(cell+' .inline-edit-value')-await left(cell+' .data-cell-secondary'))).toBeLessThanOrEqual(1);
  await page.goto('/requirements/r1');const facts=page.locator('.requirement-overview .object-facts');await expect(facts).toContainText('低风险');
  expect(await facts.evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);
  await page.goto('/accounts');const status='.account-data-row:first-child .account-data-status .data-cell';
  const badge=await page.locator(status+' .account-status').evaluate(e=>e.getBoundingClientRect().left);
  expect(Math.abs(badge-await left(status+' .account-password-state'))).toBeLessThanOrEqual(1);
});
