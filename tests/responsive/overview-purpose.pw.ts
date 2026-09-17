import {expect,test} from '@playwright/test';
import {phaseFixture} from './phase-fixture';

test('特性、Phase 和需求先展示用途，资料入口保留范围和弹窗尺寸',{tag:'@responsive'}, async({page},info)=>{
  const f=await phaseFixture(page);
  const background='批量导入资产台账，校验字段并说明每条失败原因。';
  const acceptance='成功记录入库，失败记录可修正后重试。';
  const updated=await page.request.patch('/api/requirements/'+f.testing.id,{data:{expectedVersion:f.testing.version,background,acceptanceCriteria:acceptance}});expect(updated.ok(),await updated.text()).toBe(true);
  const root=page.locator('.modal-card-workspace[role=dialog]');
  for(const [id,title,body] of [
    ['feature:'+f.feature.id,'目标与范围',f.feature.description],
    ['phase:'+f.phases[1].id,'本阶段做什么','批量导入'],
    [f.testing.id,'需求说明',background],
  ]){
    await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'progress',scopeType:'feature',scopeId:f.feature.id,detailId:id,detailTab:'overview'}));
    const intro=root.getByRole('region',{name:title,exact:true});await expect(intro).toBeInViewport();await expect(intro).toContainText(body);
    const panel=root.getByRole('tabpanel',{name:'概况',exact:true});
    expect((await intro.boundingBox())!.y).toBeLessThan((await panel.getByRole('heading',{name:id===f.testing.id?'执行进展':'交付进展',exact:true}).boundingBox())!.y);
    if(id===f.testing.id)await expect(intro).toContainText(acceptance);
    if(id.startsWith('phase:'))await expect(intro).toContainText('字段映射待确认');
    const frame=await root.boundingBox();
    await intro.getByRole('button',{name:'查看完整资料',exact:true}).click();
    await expect(root.getByRole('tab',{name:'资料',exact:true})).toHaveAttribute('aria-selected','true');await expect(root.getByRole('tab',{name:'资料',exact:true})).toBeFocused();
    const params=new URL(page.url()).searchParams;expect(params.get('detailTab')).toBe('basic');expect(params.get('workspaceView')).toBe('progress');expect(params.get('scopeId')).toBe(f.feature.id);expect(params.get('detailId')).toBe(id);
    await expect(root.getByRole('tabpanel',{name:'资料',exact:true})).toContainText(body);expect(await root.boundingBox()).toEqual(frame);
    await root.getByRole('tab',{name:'概况',exact:true}).click();
    await page.screenshot({path:info.outputPath(title+'.png'),animations:'disabled'});
  }
  await page.goto('/?'+new URLSearchParams({projectId:f.projectId,detailId:'phase:'+f.phases[2].id,detailTab:'overview'}));
  await expect(root.getByRole('region',{name:'本阶段做什么'})).toContainText('尚未填写本阶段范围');
});

test('长说明保持概况紧凑，来源去重且完整摘录仍可查阅，窄屏适配全部主题',{tag:'@responsive'}, async({page},info)=>{
  const f=await phaseFixture(page),background='解决资产重复录入问题。\n'+('字段说明与业务约束。'.repeat(50))+'\n完整说明末尾。';
  const updated=await page.request.patch('/api/requirements/'+f.testing.id,{data:{expectedVersion:f.testing.version,background,acceptanceCriteria:'校验失败时保留原始输入。'}});expect(updated.ok(),await updated.text()).toBe(true);
  const block='原始需求：LOG-001 统一模型\n出处：日志管理 MPS https://example.com/log\n版本：v24 功能需求\n完整材料中的字段定义\n已有实现说明：模型校验';
  const notes=block+'\n\n'+block+'\n工作项：测试\n\n原始需求：AC-01 覆盖范围\n出处：日志管理 MPS https://example.com/log\n版本：v24 验收需求\n独有的验收约束';
  await page.route('**/api/requirements/'+f.testing.id,async route=>{const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),sourceNotes:notes}});});
  await page.goto('/?'+new URLSearchParams({projectId:f.projectId,detailId:f.testing.id,detailTab:'overview'}));
  const root=page.locator('.modal-card-workspace[role=dialog]'),intro=root.getByRole('region',{name:'需求说明',exact:true});
  await expect(intro).toBeVisible();expect((await intro.boundingBox())!.height).toBeLessThan(270);
  await intro.getByRole('button',{name:'查看完整资料'}).click();
  const panel=root.getByRole('tabpanel',{name:'资料',exact:true});await expect(panel).toContainText('完整说明末尾。');
  const sources=panel.getByRole('region',{name:'参考资料'});await expect(sources.getByRole('link',{name:'日志管理 MPS',exact:true})).toHaveCount(1);await expect(sources).toContainText('LOG-001 统一模型；AC-01 覆盖范围');
  await expect(sources.locator('pre')).toBeHidden();await sources.getByText('查看原始摘录与历史说明',{exact:true}).click();await expect(sources.locator('pre')).toHaveText(notes);
  await page.screenshot({path:info.outputPath('source-materials.png'),animations:'disabled'});
  await root.getByRole('tab',{name:'概况',exact:true}).click();await page.setViewportSize({width:390,height:640});
  for(const theme of ['classic','dcim','midnight','forest','swiss','soft','industrial']){
    await page.evaluate(value=>{localStorage.setItem('project-manage:theme',value);window.dispatchEvent(new StorageEvent('storage',{key:'project-manage:theme',newValue:value}));},theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
    await expect(intro.getByRole('button',{name:'查看完整资料'})).toBeInViewport();
    expect(await root.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    expect(await intro.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    expect((await intro.boundingBox())!.height).toBeLessThan(270);
    await page.screenshot({path:info.outputPath('overview-narrow-'+theme+'.png'),animations:'disabled'});
  }
});
