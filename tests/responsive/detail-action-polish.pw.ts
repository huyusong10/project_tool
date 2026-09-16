import {expect,test} from '@playwright/test';
import {phaseFixture} from './phase-fixture';

test('各对象操作栏保持同高，空菜单消失，资料区与顶栏留有间距',async({page},info)=>{
  const f=await phaseFixture(page);
  const url=(id:string,tab='overview')=>'/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'progress',scopeType:'project',detailId:id,detailTab:tab});
  const modal=page.locator('.modal-card-workspace[role=dialog]');
  for(const [id,tab] of [['phase:'+f.phases[1].id,'overview'],[f.testing.id,'overview'],[f.testing.workItems[1].id,'overview'],[f.testing.workItems[1].id,'basic']]){
    await page.goto(url(id,tab));await expect(modal.locator('.detail-workspace-toolbar')).toBeVisible();
    await expect(modal.getByRole('tab',{name:tab==='basic'?'资料':'概况',exact:true})).toHaveAttribute('aria-selected','true');
    const toolbar=modal.locator('.detail-workspace-toolbar');await expect(toolbar).toHaveCSS('height','44px');
    for(const button of await toolbar.locator('.ui-button:not([data-icon-only=true])').all()){
      const text=(await button.innerText()).trim();if(text)expect(text.replace(/\d+%/g,'').trim().length,text).toBeLessThanOrEqual(2);
    }
    if(id.startsWith('phase:'))await expect(modal.getByRole('button',{name:'Phase 更多操作',exact:true})).toHaveCount(0);
    const content=modal.locator('[role=tabpanel]:visible > :first-child');
    const barBox=(await toolbar.boundingBox())!,contentBox=(await content.boundingBox())!;
    expect(contentBox.y-barBox.y-barBox.height).toBeGreaterThanOrEqual(12);
  }
  await expect(modal.locator('.work-arrangement-field')).toHaveCount(6);
  await page.screenshot({path:info.outputPath('work-details.png'),animations:'disabled'});
  await page.setViewportSize({width:390,height:640});
  expect(await modal.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await expect(modal.locator('.detail-workspace-toolbar')).toContainText('点击字段编辑');
  await expect(modal.locator('.detail-workspace-toolbar > span')).toBeVisible();
  for(const field of await modal.locator('.work-arrangement-field').all())expect(await field.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('work-details-narrow.png'),animations:'disabled'});
  await modal.getByRole('tab',{name:'概况',exact:true}).click();await expect(modal.locator('.detail-workspace-toolbar')).toHaveCSS('height','44px');
});

test('完成统一为可留空的确认表单，说明可恢复且一次确认只写入一次',async({page},info)=>{
  const f=await phaseFixture(page),work=f.testing.workItems[1];
  await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'progress',scopeType:'requirement',scopeId:f.testing.id,detailId:work.id}));
  const modal=page.locator('.modal-card-workspace[role=dialog]');let writes=0;
  await page.route('**/api/work-items/'+work.id+'/complete',route=>{writes++;return route.continue();});
  await expect(modal.getByRole('button',{name:'完成并补充说明',exact:true})).toHaveCount(0);
  await modal.getByRole('button',{name:'完成',exact:true}).click();
  const form=modal.getByRole('region',{name:'完成工作项',exact:true});
  await form.getByRole('textbox',{name:'完成说明（可选）',exact:true}).fill('待确认的完成说明');
  await form.getByRole('button',{name:'返回',exact:true}).click();
  await modal.getByRole('button',{name:'完成',exact:true}).click();await expect(form.getByRole('textbox',{name:'完成说明（可选）',exact:true})).toHaveValue('待确认的完成说明');
  await form.getByRole('textbox',{name:'完成说明（可选）',exact:true}).fill('');
  expect(writes).toBe(0);await page.screenshot({path:info.outputPath('complete-optional.png'),animations:'disabled'});
  await form.getByRole('button',{name:'确认完成',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click();});
  await expect(form).toHaveCount(0);expect(writes).toBe(1);
  const latest=await(await page.request.get('/api/requirements/'+f.testing.id)).json();expect(latest.workItems.find((w:{id:string})=>w.id===work.id).status).toBe('completed');
});

test('进展图说明缺失的工作项排期，并直接打开工作项安排',async({page},info)=>{
  const f=await phaseFixture(page);
  const response=await page.request.post('/api/requirements/'+f.testing.id+'/work-items',{data:{expectedVersion:f.testing.version,title:'待安排验证'}});expect(response.ok(),await response.text()).toBe(true);
  await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'progress',scopeType:'requirement',scopeId:f.testing.id}));
  const row=page.locator('[data-row-id="'+f.testing.id+'"]'),link=row.getByRole('button',{name:'1 项待排期',exact:true});
  await expect(link).toHaveAttribute('title','待安排验证：缺少计划开始、计划完成');
  await link.click();const modal=page.locator('.modal-card-workspace[role=dialog]');await expect(modal.getByRole('tab',{name:/^工作项 /})).toHaveAttribute('aria-selected','true');
  await modal.getByRole('tab',{name:'概况',exact:true}).click();await expect(modal.getByRole('region',{name:'待补全的排期'})).toContainText('待安排验证：缺少计划开始、计划完成');
  await page.screenshot({path:info.outputPath('schedule-gaps.png')});
  await modal.getByRole('button',{name:'安排缺失的计划日期'}).click();await expect(modal.getByRole('tab',{name:/^工作项 /})).toHaveAttribute('aria-selected','true');
});
