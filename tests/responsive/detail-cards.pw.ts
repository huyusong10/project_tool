import {expect,test,type Locator} from '@playwright/test';
import {phaseFixture} from './phase-fixture';

async function checkCards(panel:Locator) {
  const cards=panel.locator('.detail-card:visible');
  expect(await cards.count()).toBeGreaterThan(0);
  const measurements=await cards.evaluateAll(nodes=>nodes.map(node=>{
    const style=getComputedStyle(node),heading=node.querySelector(':scope > header h3')!,title=getComputedStyle(heading);
    return {border:style.borderTopWidth,borderStyle:style.borderTopStyle,font:[title.fontFamily,title.fontSize,title.fontWeight,title.lineHeight],overflow:node.scrollWidth>node.clientWidth+1};
  }));
  for(const value of measurements){expect(value.border).toBe('1px');expect(value.borderStyle).toBe('solid');expect(value.font).toEqual(measurements[0].font);expect(value.overflow).toBe(false);}
  const titleBoxes=await cards.locator(':scope > header h3').evaluateAll(nodes=>nodes.map(node=>({x:node.getBoundingClientRect().x,width:node.getBoundingClientRect().width})));
  for(const box of titleBoxes)expect(box.width).toBeGreaterThan(20);
}

test('需求进展保留分行说明，长工作项名称和完成度互不遮挡',async({page},info)=>{
  const f=await phaseFixture(page),work=f.testing.workItems[1];
  const title='资产导入校验与问题回归'.repeat(8),lines=['已验证：','登录','查询','待处理：','导出'];
  const renamed=await page.request.patch('/api/work-items/'+work.id,{data:{expectedVersion:work.version,title,reason:'补充工作范围'}});
  expect(renamed.ok(),await renamed.text()).toBe(true);
  const latest=await renamed.json();
  const saved=await page.request.post('/api/requirements/'+f.testing.id+'/progress',{data:{expectedVersion:latest.version,workItemId:work.id,workItemPercent:80,content:lines.join('\n')}});
  expect(saved.ok(),await saved.text()).toBe(true);
  await page.goto('/?'+new URLSearchParams({projectId:f.projectId,detailId:f.testing.id,detailTab:'history'}));
  const modal=page.locator('.modal-card-workspace[role=dialog]'),feed=modal.locator('.progress-feed');
  const article=feed.locator('article').filter({hasText:'已验证：'}),content=article.locator('.progress-record-summary span');
  await expect(content).toHaveText(lines.join('\n'));
  for(const width of [1280,390]){
    await page.setViewportSize({width,height:800});await article.scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath('progress-history-'+width+'.png'),animations:'disabled'});
    const tops=await content.evaluate((el,values)=>values.map(value=>{const start=el.textContent!.indexOf(value),range=document.createRange();range.setStart(el.firstChild!,start);range.setEnd(el.firstChild!,start+1);return range.getBoundingClientRect().top;}),lines);
    expect.soft(new Set(tops).size,'各条说明应显示在独立行').toBe(lines.length);
    expect.soft(await feed.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'记录不应出现横向滚动').toBe(true);
    const marker=(await article.locator('.progress-marker').boundingBox())!,summary=(await article.locator('.progress-record-summary').boundingBox())!;
    expect.soft(marker.x+marker.width,'完成度不应覆盖内容').toBeLessThanOrEqual(summary.x);
  }
});

test('详情中的说明、进展、安排和记录使用一致的模块边界与标题',{tag:'@responsive'}, async({page},info)=>{
  const f=await phaseFixture(page),modal=page.locator('.modal-card-workspace[role=dialog]');
  for(const id of ['feature:'+f.feature.id,'phase:'+f.phases[1].id,f.testing.id,f.testing.workItems[1].id]){
    await page.goto('/?'+new URLSearchParams({projectId:f.projectId,detailId:id,detailTab:'overview'}));
    await expect(modal.getByRole('tabpanel',{name:'概况',exact:true})).toBeVisible();
    for(const tab of ['概况','资料','记录','依赖']){
      await modal.getByRole('tab',{name:tab,exact:true}).click();
      await checkCards(modal.getByRole('tabpanel',{name:tab,exact:true}));
      await page.setViewportSize({width:390,height:700});
      await checkCards(modal.getByRole('tabpanel',{name:tab,exact:true}));
      expect(await modal.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
      await page.setViewportSize(info.project.use.viewport!);
    }
    await modal.getByRole('tab',{name:'概况',exact:true}).click();
    await page.screenshot({path:info.outputPath(id.split(':')[0]+'-cards.png'),animations:'disabled'});
  }
  await modal.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'展开概览'}).click();
  await checkCards(page.locator('.workspace-overview-dialog'));
  await page.screenshot({path:info.outputPath('range-overview-cards.png'),animations:'disabled'});
});

test('窄屏长内容不撑破卡片，失败后保留编辑输入和操作入口',{tag:'@responsive'}, async({page},info)=>{
  const f=await phaseFixture(page);
  const description='提供个人资料、账号安全与自主设置。'.repeat(40);
  const saved=await page.request.post(f.base+'/features',{data:{id:f.feature.id,expectedVersion:f.feature.version,name:f.feature.name,description}});expect(saved.ok(),await saved.text()).toBe(true);
  await page.setViewportSize({width:390,height:700});
  await page.goto('/?'+new URLSearchParams({projectId:f.projectId,detailId:'feature:'+f.feature.id,detailTab:'overview'}));
  const modal=page.locator('.modal-card-workspace[role=dialog]');
  await expect(modal.getByRole('region',{name:'目标与范围',exact:true})).toBeVisible();
  for(const theme of ['classic','midnight']){
    await page.evaluate(value=>{localStorage.setItem('project-manage:theme',value);window.dispatchEvent(new StorageEvent('storage',{key:'project-manage:theme',newValue:value}));},theme);
    await checkCards(modal.getByRole('tabpanel',{name:'概况',exact:true}));
    const cards=modal.getByRole('tabpanel',{name:'概况',exact:true}).locator('.detail-card');
    const boxes=await cards.evaluateAll(nodes=>nodes.map(node=>({top:node.getBoundingClientRect().top,bottom:node.getBoundingClientRect().bottom})));
    for(let i=1;i<boxes.length;i++)expect(boxes[i].top-boxes[i-1].bottom).toBeGreaterThanOrEqual(12);
    expect(await modal.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await page.screenshot({path:info.outputPath('feature-narrow-'+theme+'.png'),animations:'disabled'});
  }
  await modal.getByRole('button',{name:'编辑特性',exact:true}).click();
  const input=modal.getByRole('textbox',{name:'长期目标与范围'});
  await input.fill('修改后的说明，保存失败仍需保留。');
  await page.route('**/api/projects/'+f.projectId+'/features',route=>route.request().method()==='POST'?route.fulfill({status:400,json:{error:'模拟保存失败'}}):route.continue());
  const submit=modal.locator('.feature-form').getByRole('button',{name:'编辑特性',exact:true});
  await submit.click();
  await expect(input).toHaveValue('修改后的说明，保存失败仍需保留。');
  await expect(modal.getByText('模拟保存失败',{exact:true})).toBeVisible();
  await expect(submit).toBeInViewport();
  await page.screenshot({path:info.outputPath('feature-edit-preserved.png'),animations:'disabled'});
  const response=await page.request.post('/api/issues',{data:{projectId:f.projectId,title:'问题详情卡片',priority:'P1',ownerId:f.testing.ownerId}});expect(response.ok()).toBe(true);const issue=await response.json();
  await page.goto('/issues?'+new URLSearchParams({projectId:f.projectId,detailId:issue.id,detailTab:'updates'}));
  for(const tab of ['进展','基本信息','记录 0']){
    await modal.getByRole('tab',{name:tab,exact:true}).click();
    await checkCards(modal.getByRole('tabpanel',{name:tab,exact:true}));
  }
  await modal.getByRole('tab',{name:'进展',exact:true}).click();
  await page.screenshot({path:info.outputPath('issue-narrow-cards.png'),animations:'disabled'});
});
