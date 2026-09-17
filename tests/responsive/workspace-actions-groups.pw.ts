import {chooseOption} from './select-helper';
import {expect,test,type Page} from '@playwright/test';
import {phaseFixture} from './phase-fixture';
import {headerAction} from './topbar-helpers';
const bar=(page:Page)=>page.getByRole('region',{name:'页面工具栏',exact:true});
const view=(page:Page,name:string)=>bar(page).getByRole('button',{name,exact:true});

test('主要操作集中到公共右栏，窄屏和滚动后仍可使用',{tag:'@responsive'}, async({page},info)=>{
 const f=await phaseFixture(page);
 for(const viewport of [info.project.use.viewport!,{width:390,height:844}]){
  await page.setViewportSize(viewport);await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'list',scopeType:'feature',scopeId:f.feature.id}));
  const create=bar(page).getByRole('button',{name:'新建对象',exact:true});await expect(create).toBeInViewport();
  await expect(page.locator('.outline-actions').getByRole('button',{name:'展开全部',exact:true})).toBeVisible();await expect(page.locator('.outline-actions').getByRole('button',{name:'新建对象',exact:true})).toHaveCount(0);
  await create.click();await expect(page.getByRole('menu',{name:'新建对象'}).getByRole('button',{name:'新建 Phase',exact:true})).toBeVisible();
  await page.getByRole('menu',{name:'新建对象'}).getByRole('button',{name:'新建 Phase',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');
  const before=await view(page,'清单').boundingBox();await view(page,'关系图').click();await expect(page.locator('[data-layout-ready=true]')).toBeVisible();await view(page,'清单').click();expect(await view(page,'清单').boundingBox()).toEqual(before);
  await headerAction(page,'导入需求');await expect(bar(page).getByRole('button',{name:'返回工作区',exact:true})).toBeInViewport();const returnBox=(await bar(page).getByRole('button',{name:'返回工作区',exact:true}).boundingBox())!,viewsBox=(await bar(page).locator('.page-toolbar-views').boundingBox())!;expect(returnBox.x).toBeGreaterThanOrEqual(viewsBox.x+viewsBox.width);await page.screenshot({path:info.outputPath('import-actions-'+viewport.width+'.png'),animations:'disabled'});await bar(page).getByRole('button',{name:'返回工作区',exact:true}).click();
  await page.screenshot({path:info.outputPath('list-actions-'+viewport.width+'.png'),animations:'disabled'});
  for(const [url,action] of [['/issues','新建问题'],['/projects','新建项目'],['/templates','新建流程'],['/resources','新增人员'],['/project-settings','编辑项目'],['/analytics','编辑看板'],['/system','立即备份']]){
   await page.goto(url+'?projectId='+f.projectId);
   await expect(bar(page).getByRole('button',{name:action,exact:true})).toBeInViewport();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
  await page.goto('/settings');await expect(bar(page).getByRole('button',{name:/^创建(第一个)? Token$/})).toBeInViewport();
  await page.goto('/project-settings?projectId='+f.projectId);await headerAction(page,'添加成员');await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');
  await page.goto('/system');await bar(page).getByRole('button',{name:'更多操作',exact:true}).click();for(const name of ['导入数据库','导出数据库','立即检查'])await expect(page.getByRole('menu').getByRole('button',{name,exact:true})).toBeVisible();await page.keyboard.press('Escape');
  await page.locator('.page-content').evaluate(element=>{element.scrollTop=element.scrollHeight;});await expect(bar(page).getByRole('button',{name:'立即备份',exact:true})).toBeInViewport();
 }
});

test('未分派阶段有需求才显示，折叠置底，三个视角保持同一范围',async({page},info)=>{
 const f=await phaseFixture(page);
 const link=(view:string,scope='feature')=>'/?'+new URLSearchParams({projectId:f.projectId,workspaceView:view,scopeType:scope,scopeId:f.feature.id});
 await page.goto(link('list'));await expect(page.locator('.outline-title')).toHaveCount(f.phases.length);await expect(page.locator('[data-object-id="unphased:'+f.feature.id+'"]')).toHaveCount(0);
 await page.getByRole('button',{name:'展开概览',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByRole('dialog').getByRole('heading',{name:/未分派阶段/})).toHaveCount(0);await page.keyboard.press('Escape');
 await view(page,'进展表').click();await expect(page.locator('[data-row-id="phase:'+f.phases[0].id+'"]')).toBeVisible();await expect(page.locator('[data-row-id="unphased:'+f.feature.id+'"]')).toHaveCount(0);
 await view(page,'关系图').click();await expect(page.locator('[data-layout-ready=true]')).toBeVisible();await expect(page.locator('[data-phase-region="unassigned"]')).toHaveCount(0);
 const response=await page.request.post('/api/requirements',{data:{projectId:f.projectId,featureId:f.feature.id,title:'待分派交付需求'}});expect(response.ok()).toBe(true);const requirement=await response.json();
 await page.goto(link('list'));const group=page.locator('[data-object-id="unphased:'+f.feature.id+'"]');await expect(group).toContainText('未分派阶段');await expect(page.locator('[data-object-id="'+requirement.id+'"]')).toHaveCount(0);await expect(group.getByRole('checkbox')).toHaveCount(0);
 for(const order of ['name','date','manual']){await chooseOption(page.getByLabel('清单排序',{exact:true}), order);await expect(page.locator('.outline-table tbody tr').last()).toContainText('未分派阶段');}
 await group.getByRole('button',{name:'展开未分派阶段',exact:true}).click();await expect(page.locator('[data-object-id="'+requirement.id+'"]')).toHaveAttribute('aria-level','2');
 await group.getByRole('button',{name:'未分派阶段',exact:true}).click();await expect(page.getByRole('navigation',{name:'项目层级'})).toContainText('未分派阶段');await expect(page.locator('.outline-title')).toHaveText(['待分派交付需求']);
 for(const name of ['进展表','关系图','清单']){
  await view(page,name).click();expect(new URL(page.url()).searchParams.get('scopeType')).toBe('unphased');await expect(page.getByRole('navigation',{name:'项目层级'})).toContainText('未分派阶段');
  if(name==='进展表'){await expect(page.locator('[data-row-id="'+requirement.id+'"]')).toBeVisible();await expect(page.locator('[data-row-id="'+f.testing.id+'"]')).toHaveCount(0);}
  if(name==='关系图')await expect(page.locator('[data-layout-ready=true]')).toBeVisible();
 }
 await bar(page).getByRole('button',{name:'新建对象',exact:true}).click();await page.getByRole('menu').getByRole('button',{name:'新建需求',exact:true}).click();await page.getByLabel('需求标题',{exact:true}).fill('分组内新增需求');await page.getByRole('dialog').getByRole('button',{name:'创建需求',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 const created=(await(await page.request.get('/api/requirements?projectId='+f.projectId)).json()).find((r:{title:string})=>r.title==='分组内新增需求');expect(created).toMatchObject({featureId:f.feature.id,phaseId:null});
 await page.goto(link('progress'));const progressGroup=page.locator('[data-row-id="unphased:'+f.feature.id+'"]');await expect(progressGroup).toBeVisible();await expect(page.locator('[data-row-id="'+requirement.id+'"]')).toHaveCount(0);await progressGroup.getByRole('button',{name:'展开 未分派阶段',exact:true}).click();await expect(page.locator('[data-row-id="'+requirement.id+'"]')).toHaveAttribute('aria-level','2');
 await page.screenshot({path:info.outputPath('unassigned-progress.png'),animations:'disabled'});
});
