import {expect,test} from '@playwright/test';
import {phaseFixture} from './phase-fixture';

test('取消进展草稿保留待核对原文，刷新不重复写入',async({page})=>{
  const f=await phaseFixture(page),item=f.testing.workItems[1];await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'list',scopeType:'project',detailId:f.testing.id,detailTab:'work'}));
  const root=page.locator('.modal-card-workspace[role=dialog]'),row=root.locator('[data-work-id="'+item.id+'"]'),form=root.getByRole('dialog',{name:'更新工作项进度',exact:true});
  await row.getByRole('button',{name:'更新 测试 进度',exact:true}).click();await form.getByRole('spinbutton').fill('85');await form.getByRole('textbox',{name:/^说明/}).fill('需要保留的原提交');let writes=0;
  await page.route('**/api/requirements/'+f.testing.id+'/progress',async route=>{writes++;await route.fetch();await route.abort('failed');});
  await form.getByRole('button',{name:'记录进展',exact:true}).click();await expect(form.getByText('待核对的原提交',{exact:true})).toBeVisible();await form.getByRole('button',{name:'取消',exact:true}).click();await expect(form).toHaveCount(0);
  expect(await page.evaluate(id=>Object.entries(sessionStorage).find(([key])=>key.endsWith(id+':progress-receipt'))?.[1],item.id)).toContain('需要保留的原提交');
  await row.getByRole('button',{name:'更新 测试 进度',exact:true}).click();await expect(form.getByRole('textbox',{name:/^说明/})).toHaveValue('');await expect(form.getByRole('button',{name:'记录进展',exact:true})).toBeDisabled();await page.reload();await form.getByRole('button',{name:'重新读取工作项',exact:true}).click();await form.getByText('待核对的原提交',{exact:true}).click();await expect(form).toContainText('需要保留的原提交');await expect(form).toContainText('完成度 85%');expect(writes).toBe(1);
  await form.getByRole('button',{name:'已核对，结束本次操作',exact:true}).click();await expect(form).toHaveCount(0);expect(await page.evaluate(id=>Object.keys(sessionStorage).some(key=>key.endsWith(id+':progress-receipt')),item.id)).toBe(false);expect(writes).toBe(1);
});
