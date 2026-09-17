import {test,expect} from '@playwright/test';
import { themes } from '../../src/client/theme-preference';
test.use({actionTimeout:10_000});
const openedProjects:string[]=[];
test.afterEach(async({request})=>{
  if(!openedProjects.length)return;
  await request.post('/api/login',{data:{username:'admin',password:'41_xc7q0qOjo4Inw!'}});
  const projects=await(await request.get('/api/projects')).json();
  for(const id of openedProjects.splice(0)){
    const project=projects.find((p:{id:string;guestVisible:boolean})=>p.id===id);
    if(project?.guestVisible){const response=await request.patch('/api/projects/'+id,{data:{guestVisible:false,expectedUpdatedAt:project.updatedAt}});expect(response.ok(),await response.text()).toBe(true);}
  }
});

test('游客浏览选项支持文字点击、键盘和保存', async ({page}) => {
  await page.request.post('/api/login', {data:{username:'admin',password:'41_xc7q0qOjo4Inw!'}});
  const response = await page.request.post('/api/projects', {data:{name:'游客选项布局验证'}});
  expect(response.ok()).toBe(true);
  const project = await response.json();
  openedProjects.push(project.id);
  await page.goto('/project-settings?projectId='+project.id);
  await page.getByRole('button',{name:'编辑项目',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'编辑项目'});
  const checkbox = dialog.getByRole('checkbox',{name:'允许游客查看',exact:true});
  await expect(checkbox).not.toBeChecked();
  await expect(dialog.locator('label label')).toHaveCount(0);
  await dialog.getByText('允许游客查看',{exact:true}).click();
  await expect(checkbox).toBeChecked();
  await checkbox.focus(); await page.keyboard.press('Space');
  await expect(checkbox).not.toBeChecked();
  await page.keyboard.press('Space');
  await dialog.getByRole('button',{name:'保存修改',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await page.getByRole('button',{name:'编辑项目',exact:true}).click();
  await expect(checkbox).toBeChecked();
});

test('游客浏览选项在当前视口、窄屏和主题下保持紧凑对齐',{tag:'@responsive'}, async ({page}, testInfo) => {
  await page.request.post('/api/login', {data:{username:'admin',password:'41_xc7q0qOjo4Inw!'}});
  const response = await page.request.post('/api/projects', {data:{name:'游客选项布局验证'}});
  expect(response.ok()).toBe(true);
  const project = await response.json();
  openedProjects.push(project.id);
  await page.goto('/project-settings?projectId='+project.id);
  await page.getByRole('button',{name:'编辑项目',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'编辑项目'});
  const checkbox = dialog.getByRole('checkbox',{name:'允许游客查看',exact:true});
  await expect(checkbox).not.toBeChecked();
  await expect(dialog.locator('label label')).toHaveCount(0);
  for (const width of [testInfo.project.use.viewport!.width,390]) {
    await page.setViewportSize({width,height:800});
    for (const theme of themes) {
      await page.evaluate(id => document.documentElement.dataset.theme = id, theme.id);
      const box = await checkbox.boundingBox();
      const label = await dialog.getByText('允许游客查看',{exact:true}).boundingBox();
      expect(box).not.toBeNull(); expect(label).not.toBeNull();
      expect(box!.width).toBeLessThanOrEqual(20);
      expect(box!.height).toBeLessThanOrEqual(20);
      expect(label!.x).toBeGreaterThan(box!.x+box!.width);
      expect(Math.abs(label!.y+label!.height/2-box!.y-box!.height/2)).toBeLessThanOrEqual(2);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    }
    await page.evaluate(()=>document.documentElement.dataset.theme = 'classic');
    await page.screenshot({path:testInfo.outputPath('guest-checkbox-'+width+'.png')});
  }
});

test('游客浏览三视角和四类详情，登录保留位置，撤回开放清理页面',async({page,browser,baseURL},testInfo)=>{
  test.setTimeout(120_000);
  const errors:string[]=[],failures:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.url().includes('/api/')&&r.status()>=400)failures.push(r.status()+' '+new URL(r.url()).pathname);});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'暂未开放游客浏览'})).toBeVisible();
  const admin=await browser.newContext({baseURL});
  const post=async(url:string,data:object)=>{const r=await admin.request.post(url,{data});expect(r.ok(),await r.text()).toBe(true);return r.json();};
  await post('/api/login',{username:'admin',password:'41_xc7q0qOjo4Inw!'});
  const project=await post('/api/projects',{name:'游客浏览验证'}),projectId=project.id,base='/api/projects/'+projectId;
  openedProjects.push(projectId);
  await post('/api/projects',{name:'不公开的内部项目'});
  const owner=await post('/api/people',{name:'游客验证负责人 '+testInfo.project.name,projectId});
  const feature=(await post(base+'/features',{name:'资产管理',description:'统一管理设备台账和资产变更',referenceLinks:[{title:'设计文档',url:'https://example.com/mds'}]})).features[0];
  const phase=await post(base+'/features/'+feature.id+'/phases',{name:'基础交付',scope:'建立基础设备台账'});
  const template=await post('/api/templates',{projectId,name:'交付步骤',items:[{title:'开发实现',durationDays:2,startOffsetDays:0,sortOrder:0},{title:'验收测试',durationDays:1,startOffsetDays:2,sortOrder:1}]});
  const requirement=await post('/api/requirements',{projectId,ownerId:owner.id,featureId:feature.id,phaseId:phase.id,title:'设备台账',background:'记录每台设备的位置和负责人',templateId:template.id,plannedStart:'2026-09-16',referenceLinks:[{title:'Jira',url:'https://example.com/task'}]});
  const opened=await admin.request.patch(base,{data:{guestVisible:true,expectedUpdatedAt:project.updatedAt}});expect(opened.ok(),await opened.text()).toBe(true);
  await page.reload();
  await expect(page.getByRole('button',{name:'进展表',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByText('游客浏览',{exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'问题跟踪',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'开始',exact:true})).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath('guest-progress.png')});
  for(const view of ['清单','关系图','进展表']){
    await page.getByRole('button',{name:view,exact:true}).click();
    await expect(page.getByRole('button',{name:view,exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(page.getByRole('button',{name:'编辑画布',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'保存项目草稿',exact:true})).toHaveCount(0);
  }
  for(const [id,title] of [['feature:'+feature.id,'资产管理'],['phase:'+phase.id,'基础交付'],[requirement.id,'设备台账'],[requirement.workItems[0].id,'开发实现']]){
    await page.goto('/?'+new URLSearchParams({projectId,workspaceView:'progress',detailId:id}));
    const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading',{name:title,exact:true})).toBeVisible();
    for(const tab of ['资料','依赖','记录']){
      await dialog.getByRole('tab',{name:tab,exact:true}).click();
      await expect(dialog.getByRole('tab',{name:tab,exact:true})).toHaveAttribute('aria-selected','true');
      await expect(dialog.getByRole('button',{name:/^(新增|保存|完成|开始|更新|编辑)$/})).toHaveCount(0);
    }
  }
  expect(failures).toEqual([]);expect(errors).toEqual([]);
  await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
  const currentUrl=page.url();
  await page.getByRole('button',{name:'游客登录',exact:true}).click();
  const login=page.getByRole('dialog',{name:'用户登录'});
  await login.getByLabel('用户名',{exact:true}).fill('admin');await login.getByLabel('密码',{exact:true}).fill('41_xc7q0qOjo4Inw!');
  await login.getByRole('button',{name:'用户登录',exact:true}).click();await expect(login).toHaveCount(0);
  await expect(page.getByRole('button',{name:'账号菜单：admin'})).toBeVisible();
  expect(page.url()).toBe(currentUrl);
  // Opening and saving the existing project form controls guest visibility.
  await page.goto('/project-settings?projectId='+projectId);
  await page.getByRole('button',{name:'编辑项目',exact:true}).click();
  await expect(page.getByLabel('允许游客查看')).toBeChecked();
  await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
  await page.request.post('/api/logout',{data:{}});
  await page.goto('/?projectId='+projectId);
  await expect(page.getByText('游客浏览',{exact:true})).toBeVisible();
  const latest=(await(await admin.request.get('/api/projects')).json()).find((p:{id:string})=>p.id===projectId);
  expect((await admin.request.patch(base,{data:{guestVisible:false,expectedUpdatedAt:latest.updatedAt}})).ok()).toBe(true);
  await expect.poll(async()=>{await page.evaluate(()=>window.dispatchEvent(new Event('focus')));return page.locator('.unified-workspace').count();},{timeout:15_000,intervals:[2500]}).toBe(0);
  await expect(page.getByRole('heading',{name:'项目不可用'})).toBeVisible();
  expect(errors).toEqual([]);
  await admin.close();
});

test('多个开放项目提供选择，关闭项目不会出现在选择列表',async({page,browser,baseURL})=>{
  const admin=await browser.newContext({baseURL});await admin.request.post('/api/login',{data:{username:'admin',password:'41_xc7q0qOjo4Inw!'}});
  const ids:string[]=[];
  for(const name of ['游客甲项目','游客乙项目']){
    const p=await(await admin.request.post('/api/projects',{data:{name}})).json();ids.push(p.id);openedProjects.push(p.id);
    expect((await admin.request.patch('/api/projects/'+p.id,{data:{guestVisible:true,expectedUpdatedAt:p.updatedAt}})).ok()).toBe(true);
  }
  await page.goto('/');await expect(page.getByRole('heading',{name:'选择项目'})).toBeVisible();
  await expect(page.getByRole('button',{name:'不公开的内部项目',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'游客乙项目',exact:true}).click();
  await expect(page).toHaveURL(new RegExp('projectId='+ids[1]));
  await expect(page.getByText('游客浏览',{exact:true})).toBeVisible();
  for(const id of ids){const p=(await(await admin.request.get('/api/projects')).json()).find((p:{id:string})=>p.id===id);expect((await admin.request.patch('/api/projects/'+id,{data:{guestVisible:false,expectedUpdatedAt:p.updatedAt}})).ok()).toBe(true);}
  await admin.close();
});

test('游客工作项详情在当前视口和窄屏只读且无横向溢出',{tag:'@responsive'},async({page},info)=>{
  await page.request.post('/api/login',{data:{username:'admin',password:'41_xc7q0qOjo4Inw!'}});
  const project=await(await page.request.post('/api/projects',{data:{name:'游客详情布局'}})).json();openedProjects.push(project.id);
  const requirement=await(await page.request.post('/api/requirements',{data:{projectId:project.id,title:'设备台账',background:'记录每台设备的位置和负责人'}})).json();
  const workResponse=await page.request.post('/api/requirements/'+requirement.id+'/work-items',{data:{expectedVersion:requirement.version,title:'开发实现'}});expect(workResponse.ok(),await workResponse.text()).toBe(true);
  const latest=await(await page.request.get('/api/requirements/'+requirement.id)).json();const opened=await page.request.patch('/api/projects/'+project.id,{data:{guestVisible:true,expectedUpdatedAt:project.updatedAt}});expect(opened.ok(),await opened.text()).toBe(true);await page.request.post('/api/logout',{data:{}});
  for(const viewport of [info.project.use.viewport!,{width:390,height:844}]){await page.setViewportSize(viewport);await page.goto('/?'+new URLSearchParams({projectId:project.id,workspaceView:'progress',detailId:latest.workItems[0].id}));const panel=page.getByRole('dialog');await expect(panel).toBeVisible();await expect(panel.getByRole('button',{name:/^(开始|更新|完成|保存)$/})).toHaveCount(0);expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('guest-detail-'+viewport.width+'.png')});}
});
