import {test,expect,type Page} from '@playwright/test';
import {phaseFixture} from './phase-fixture';
import {headerAction} from './topbar-helpers';
const bar=(page:Page)=>page.getByRole('region',{name:'页面工具栏',exact:true});
async function toolbarAnchors(page:Page){
  return page.locator('.page-toolbar').evaluate(root=>Object.fromEntries([
    '.page-toolbar-back-slot','.page-breadcrumb>span:first-child',
    '.page-toolbar-views button:first-child','.page-toolbar-views button:last-child',
    '.page-toolbar-status','.page-editor-history','.page-editor-primary','.page-toolbar-more-slot',
  ].map(selector=>{const r=root.querySelector(selector)!.getBoundingClientRect();return [selector,[r.x,r.y,r.width,r.height].map(n=>Math.round(n*10)/10)];})));
}
async function geometry(page:Page){
  await expect(bar(page)).toHaveCount(1);
  const measure=()=>page.evaluate(()=>{
    const top=document.querySelector('.topbar')!.getBoundingClientRect(),toolbar=document.querySelector('.page-toolbar')!,box=toolbar.getBoundingClientRect();
    const parts=Array.from(toolbar.children).filter(n=>{const r=n.getBoundingClientRect();return r.width&&r.height;});
    return {height:top.height,gap:box.top-top.bottom,overflow:document.documentElement.scrollWidth>innerWidth,
      outside:parts.filter(n=>{const r=n.getBoundingClientRect();return r.left<box.left-1||r.right>box.right+1||r.bottom>box.bottom+1;}).map(n=>n.className),
      overlap:parts.flatMap((n,i)=>parts.slice(i+1).filter(m=>{const a=n.getBoundingClientRect(),b=m.getBoundingClientRect();return a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1;}).map(m=>n.className+' / '+m.className))};
  });
  await expect.poll(measure).toEqual({height:52,gap:0,overflow:false,outside:[],overlap:[]});
  await expect(page.locator('.topbar').getByRole('button',{name:/返回|保存修改|编辑画布|新建需求|新建流程/})).toHaveCount(0);
}
test('公共工具栏覆盖列表、详情、工作区，视图切换后返回原范围',async({page},testInfo)=>{
  const f=await phaseFixture(page);await page.goto('/?view=features&mode=table');await expect(page.locator('.delivery-table')).toContainText('资产管理');await geometry(page);
  await expect(bar(page).getByLabel('返回上一画布',{exact:true})).toHaveCount(0);
  await page.locator('.delivery-table').getByRole('button',{name:'资产管理',exact:true}).dblclick();await expect(page).toHaveURL(/view=feature/);
  await bar(page).getByRole('button',{name:'关系图',exact:true}).click();await expect(page.locator('[data-layout-ready=true]')).toBeVisible();await geometry(page);
  await bar(page).getByRole('button',{name:'表格',exact:true}).click();await page.locator('.delivery-table').getByRole('button',{name:f.testing.title,exact:true}).dblclick();await expect(page).toHaveURL(/view=requirement/);await geometry(page);
  await bar(page).getByRole('button',{name:'关系图',exact:true}).click();await bar(page).getByLabel('返回上一画布',{exact:true}).click();await expect(page).toHaveURL(/view=feature/);await expect(page).toHaveURL(/mode=table/);
  await bar(page).getByLabel('返回上一画布',{exact:true}).click();await expect(page).toHaveURL(/view=features/);
  await page.getByRole('link',{name:'需求管理',exact:true}).click();await expect(bar(page).getByRole('tab',{name:'导入预览',exact:true})).toBeVisible();await geometry(page);
  await page.getByPlaceholder('搜索需求或负责人').fill('资产导入');await expect(page).toHaveURL(/q=/);const requirementsUrl=page.url();
  await page.locator('main').getByRole('link',{name:f.testing.title,exact:true}).click();await expect(page.locator('.requirement-overview')).toBeVisible();await expect(page.locator('h1')).toHaveText('需求管理');await expect(bar(page)).toContainText(f.testing.title);await geometry(page);
  await page.setViewportSize({width:390,height:844});await geometry(page);await page.screenshot({path:testInfo.outputPath('toolbar-detail-narrow.png')});
  await bar(page).getByRole('button',{name:'返回',exact:true}).click();await expect(page).toHaveURL(requirementsUrl);
  await page.getByRole('link',{name:'人员矩阵',exact:true}).click();await expect(bar(page).getByRole('button',{name:'人力分析',exact:true})).toBeVisible();await geometry(page);
  await page.screenshot({path:testInfo.outputPath('toolbar-people-narrow.png')});
});
test('工具栏长名称、加载失败与直接链接保留父级返回',async({page},testInfo)=>{
  const f=await phaseFixture(page),name='跨站点资产生命周期协同管理'.repeat(10);
  const r=await page.request.get('/api/requirements/'+f.testing.id),data=await r.json();
  await page.route('**/api/requirements/'+f.testing.id,route=>route.fulfill({json:{...data,title:name}}));
  await page.goto('/requirements/'+f.testing.id);await expect(bar(page)).toContainText(name);await geometry(page);
  for(const viewport of [testInfo.project.use.viewport!,{width:390,height:844}]){await page.setViewportSize(viewport);await geometry(page);await page.screenshot({path:testInfo.outputPath('toolbar-long-'+viewport.width+'.png')});}
  await bar(page).getByRole('button',{name:'需求列表',exact:true}).click();await expect(page).toHaveURL(/\/requirements$/);
  await page.route('**/api/requirements/missing',route=>route.fulfill({status:404,json:{error:'需求不存在'}}));await page.goto('/requirements/missing');await expect(page.getByText('需求不存在',{exact:true})).toBeVisible();await geometry(page);await expect(bar(page).getByRole('button',{name:'返回需求管理',exact:true})).toBeVisible();
});
test('流程编辑在窄屏仍直接提供保存和返回',async({page},testInfo)=>{
  await phaseFixture(page);await page.goto('/templates');await expect(bar(page).getByRole('button',{name:'新建流程',exact:true})).toBeVisible();await headerAction(page,'新建流程');
  await expect(page.locator('[data-layout-ready=true]')).toBeVisible();await expect(page.locator('h1')).toHaveText('流程设计');await geometry(page);
  await page.setViewportSize({width:390,height:844});await geometry(page);await expect(bar(page).getByLabel('保存修改',{exact:true})).toBeVisible();await expect(bar(page).getByLabel('返回流程列表',{exact:true})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('toolbar-template-narrow.png')});
});

test('页面主操作使用公共栏，空操作页面不留空栏',async({page},testInfo)=>{
  await phaseFixture(page);
  for(const [url,action] of [['/requirements','新建需求'],['/issues','新建问题'],['/templates','新建流程'],['/projects','新建项目'],['/resources','新增人员'],['/project-settings','编辑项目'],['/analytics','编辑看板']]){
    await page.goto(url);await expect(bar(page).getByRole('button',{name:action,exact:true})).toBeVisible();await geometry(page);
  }
  await bar(page).getByRole('button',{name:'编辑看板',exact:true}).click();await expect(bar(page).getByRole('button',{name:'保存布局',exact:true})).toBeVisible();await geometry(page);
  await page.setViewportSize({width:390,height:844});await geometry(page);await expect(bar(page).getByRole('button',{name:'保存布局',exact:true})).toBeVisible();await page.screenshot({path:testInfo.outputPath('toolbar-analytics-narrow.png')});
  await page.goto('/my-work');await expect(page.locator('h1')).toHaveText('我的工作');await expect(bar(page)).toHaveCount(0);
});

test('特性下钻、视图与编辑状态变化时，返回位和常用按钮坐标不变',async({page},testInfo)=>{
  const f=await phaseFixture(page);
  for(const viewport of [testInfo.project.use.viewport!,{width:390,height:844}]){
    const closeNarrowDetail=async()=>{const close=page.locator('.graph-detail[aria-hidden=false] .delivery-inspector-heading').getByRole('button',{name:'关闭',exact:true});if(viewport.width<640&&await close.isVisible()){await close.click();await expect(close).toBeHidden();}};
    await page.setViewportSize(viewport);await page.goto('/?view=features&mode=table');await expect(page.locator('.delivery-table')).toContainText('资产管理');await geometry(page);
    await expect(bar(page).locator('.page-back-button')).toHaveCount(0);await expect(bar(page).getByLabel('更多操作',{exact:true})).toBeVisible();
    const baseline=await toolbarAnchors(page);
    await bar(page).getByLabel('更多操作',{exact:true}).click();await expect(page.getByRole('button',{name:'刷新特性',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'新建特性',exact:true})).toBeVisible();await page.keyboard.press('Escape');
    await expect(page.getByRole('menu',{name:'更多操作',exact:true})).toHaveCount(0);await page.screenshot({path:testInfo.outputPath('stable-root-'+viewport.width+'.png'),animations:'disabled'});
    const featureButton=page.locator('.delivery-table').getByRole('button',{name:'资产管理',exact:true});
    if(viewport.width<640){await featureButton.click();await page.locator('.delivery-inspector-content').getByRole('button',{name:'进入需求',exact:true}).click();}else await featureButton.dblclick();
    await expect(page).toHaveURL(/view=feature(?:&|$)/);await expect(page.locator('.delivery-table')).toContainText(f.testing.title);await closeNarrowDetail();await geometry(page);await expect.poll(()=>toolbarAnchors(page)).toEqual(baseline);
    await bar(page).getByLabel('更多操作',{exact:true}).click();await expect(page.getByRole('button',{name:'Phase 资料',exact:true})).toBeVisible();await page.keyboard.press('Escape');
    await expect(page.getByRole('menu',{name:'更多操作',exact:true})).toHaveCount(0);await page.screenshot({path:testInfo.outputPath('stable-feature-'+viewport.width+'.png'),animations:'disabled'});
    const requirementButton=page.locator('.delivery-table').getByRole('button',{name:f.testing.title,exact:true});
    if(viewport.width<640){await requirementButton.click();await page.locator('.delivery-inspector-content').getByRole('button',{name:'进入工作项',exact:true}).click();}else await requirementButton.dblclick();
    await expect(page).toHaveURL(/view=requirement/);await expect(page.locator('.delivery-table')).toContainText('测试');await closeNarrowDetail();await geometry(page);await expect.poll(()=>toolbarAnchors(page)).toEqual(baseline);
    await bar(page).getByRole('button',{name:'关系图',exact:true}).click();await expect(page.locator('[data-layout-ready=true]')).toBeVisible();await geometry(page);await expect.poll(()=>toolbarAnchors(page)).toEqual(baseline);
    const edit=bar(page).getByLabel('编辑画布',{exact:true});if(await edit.isVisible())await edit.click();await expect(bar(page).getByLabel('保存修改',{exact:true})).toBeVisible();await geometry(page);await expect.poll(()=>toolbarAnchors(page)).toEqual(baseline);
    await page.screenshot({path:testInfo.outputPath('stable-edit-'+viewport.width+'.png'),animations:'disabled'});
    await bar(page).getByLabel('返回上一画布',{exact:true}).click();await expect(page).toHaveURL(/view=feature(?:&|$)/);await closeNarrowDetail();await expect.poll(()=>toolbarAnchors(page)).toEqual(baseline);
    await bar(page).getByLabel('返回上一画布',{exact:true}).click();await expect(page).toHaveURL(/view=features/);await closeNarrowDetail();await expect.poll(()=>toolbarAnchors(page)).toEqual(baseline);
  }
});

test('窄屏图形编辑和加载期间工具栏不挤压或遮挡画布',async({page},testInfo)=>{
  const f=await phaseFixture(page);await page.setViewportSize({width:390,height:844});
  const scopes:Array<Record<string,string>>=[{view:'features',mode:'graph'},{view:'requirement',mode:'graph',featureId:f.feature.id,requirementId:f.testing.id}];
  for(const params of scopes){
    await page.goto('/?'+new URLSearchParams(params));await expect(page.locator('[data-layout-ready=true]')).toBeVisible();await geometry(page);
    const edit=bar(page).getByLabel('编辑画布',{exact:true});if(await edit.isVisible())await edit.click();await expect(bar(page).getByLabel('保存修改',{exact:true})).toBeVisible();await geometry(page);
    const canvas=await page.locator('.dependency-canvas').boundingBox(),toolbar=await bar(page).boundingBox();expect(canvas!.y).toBeGreaterThanOrEqual(toolbar!.y+toolbar!.height);expect(toolbar!.height).toBe(96);
    await page.screenshot({path:testInfo.outputPath('toolbar-edit-'+params.view+'.png')});
  }
  let release!:()=>void;const hold=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/requirements/'+f.testing.id,async route=>{await hold;await route.continue();});
  await page.goto('/requirements/'+f.testing.id);await expect(page.locator('.toolbar-location-placeholder')).toBeVisible();await geometry(page);
  const before=await bar(page).boundingBox();release();await expect(page.locator('.requirement-overview')).toBeVisible();await geometry(page);expect(await bar(page).boundingBox()).toEqual(before);
});

test.describe('触屏工具栏',()=>{
  test.use({hasTouch:true,viewport:{width:390,height:844}});
  test('关系图编辑保持两行，保存与返回触控区域足够大',async({page},testInfo)=>{
    const f=await phaseFixture(page);await page.goto('/?'+new URLSearchParams({view:'requirement',mode:'graph',featureId:f.feature.id,requirementId:f.testing.id}));
    await expect(page.locator('[data-layout-ready=true]')).toBeVisible();await bar(page).getByLabel('编辑画布',{exact:true}).click();await expect(bar(page).getByLabel('保存修改',{exact:true})).toBeVisible();await geometry(page);
    expect((await bar(page).boundingBox())!.height).toBe(112);
    for(const name of ['保存修改','撤销','重做','更多操作','返回上一画布']){const box=(await bar(page).getByLabel(name,{exact:true}).boundingBox())!;expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);}
    await page.screenshot({path:testInfo.outputPath('toolbar-touch.png')});
  });
});
