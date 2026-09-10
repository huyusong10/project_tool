import {expect,test,type Page} from '@playwright/test';
import {intakeExample} from '../../src/shared/intake';

async function fixture(page:Page) {
  const login=await page.request.post('/api/login',{data:{username:'admin',password:'41_xc7q0qOjo4Inw!'}});expect(login.ok()).toBe(true);
  const session=await login.json();
  const response=await page.request.post('/api/projects',{data:{name:'需求导入 '+Date.now()}});expect(response.ok()).toBe(true);const project=await response.json();
  await page.addInitScript(({accountId,projectId})=>localStorage.setItem('project-manage:selected-project:'+accountId,projectId),{accountId:session.accountId,projectId:project.id});
  await page.goto('/requirements?intakeView=import');
  await page.getByLabel('原始需求',{exact:true}).fill(JSON.stringify(intakeExample));await page.getByRole('button',{name:'整理需求',exact:true}).click();
  await expect(page.getByLabel('导入需求标题')).toHaveValue('查询与详情');return project.id as string;
}
async function expectGroupToggleAligned(page:Page) {
  const checkbox=page.getByRole('checkbox',{name:'按分组查看',exact:true});
  const box=(await checkbox.boundingBox())!,text=(await page.locator('.requirement-group-toggle span').boundingBox())!;
  expect(Math.abs(box.y+box.height/2-text.y-text.height/2)).toBeLessThanOrEqual(2);
  expect(text.x-box.x-box.width).toBeGreaterThanOrEqual(6);
  expect(text.height).toBeLessThanOrEqual(22);
  await expect(page.getByLabel('标签筛选')).toHaveCount(0);
}
async function saveImport(page:Page) {
  await page.getByRole('button',{name:'预览导入',exact:true}).click();
  await page.getByRole('button',{name:'保存需求',exact:true}).click();
  await expect(page.getByText('已保存 1 个需求',{exact:true})).toBeVisible();
}

test('导入可拆分合并，保存后按分组查看，复选框文字对齐',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const id=await fixture(page);
  await expect(page.getByText('标签',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'拆分需求',exact:true}).click();await expect(page.getByLabel('导入需求标题')).toHaveCount(2);
  await page.getByLabel('合并需求到').last().selectOption({label:'查询与详情'});await expect(page.getByLabel('导入需求标题')).toHaveCount(1);
  await page.getByLabel('导入需求标题').fill('查询需求浏览器验证');await saveImport(page);
  await page.getByRole('tab',{name:'需求',exact:true}).click();await expectGroupToggleAligned(page);
  await page.getByRole('checkbox',{name:'按分组查看',exact:true}).click();await expect(page.getByRole('checkbox',{name:'按分组查看',exact:true})).toBeChecked();
  await page.getByLabel('分组筛选').selectOption({label:'示例模块'});await expect(page.locator('tbody .intake-group-heading')).toContainText('示例模块');
  await page.screenshot({path:info.outputPath('requirement-groups-desktop.png'),fullPage:true});
  const requirements=await(await page.request.get('/api/requirements?projectId='+id)).json();expect(requirements).toHaveLength(1);expect(requirements[0].workItems).toHaveLength(2);expect(requirements[0]).not.toHaveProperty('tags');
  await page.goto('/requirements?tag=obsolete&grouped=1');await expect(page.getByRole('link',{name:'查询需求浏览器验证',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'新建需求',exact:true}).click();await expect(page.getByLabel('需求分组')).toBeVisible();await expect(page.getByLabel('需求标签')).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
  await page.goto('/requirements/'+requirements[0].id);await expect(page.getByRole('heading',{name:'查询需求浏览器验证',exact:true})).toBeVisible();
  await expect(page.locator('.requirement-progress-panel')).toBeVisible();expect(errors).toEqual([]);
});

test('预览失败保留调整，未知提交刷新后查询原回执且不重复创建',async({page})=>{
  const id=await fixture(page),url='**/api/projects/'+id+'/requirement-import/preview';
  await page.getByLabel('导入需求标题').fill('保留导入输入');
  await page.route(url,route=>route.fulfill({status:503,json:{error:'服务暂时不可用'}}));
  await page.getByRole('button',{name:'预览导入',exact:true}).click();await expect(page.getByRole('alert')).toContainText('服务暂时不可用');await expect(page.getByLabel('导入需求标题')).toHaveValue('保留导入输入');
  await page.unroute(url);await page.getByRole('button',{name:'预览导入',exact:true}).click();await expect(page.getByRole('button',{name:'保存需求',exact:true})).toBeEnabled();
  let writes=0;await page.route('**/api/projects/'+id+'/requirement-import/apply',async route=>{writes++;await route.fetch();await route.fulfill({status:200,contentType:'text/html',body:'invalid response'});});
  await page.getByRole('button',{name:'保存需求',exact:true}).click();await expect(page.getByRole('button',{name:'查询提交回执'})).toBeVisible();
  await page.reload();await page.getByRole('button',{name:'查询提交回执'}).click();await expect(page.getByText('已保存 1 个需求',{exact:true})).toBeVisible();expect(writes).toBe(1);
  expect((await(await page.request.get('/api/requirements?projectId='+id)).json()).length).toBe(1);
});

test('窄屏可新建分组和批量调整，分组开关对齐且页面无横向溢出',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});const id=await fixture(page);await saveImport(page);
  await page.getByRole('tab',{name:'需求',exact:true}).click();await expectGroupToggleAligned(page);
  await page.getByRole('button',{name:'管理分组',exact:true}).click();const manager=page.getByRole('dialog',{name:'管理需求分组'});
  await manager.getByLabel('新分组名称').fill('权限管理');await manager.getByRole('button',{name:'新建分组',exact:true}).click();await expect(manager.getByText('权限管理',{exact:true})).toBeVisible();
  await manager.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByLabel('选择需求 查询与详情').check();await page.getByRole('button',{name:'整理所选需求'}).click();
  const dialog=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'整理 1 个需求',exact:true})});await expect(dialog).toBeVisible();await dialog.getByRole('combobox',{name:'分组',exact:true}).selectOption({label:'权限管理'});await expect(dialog.getByText('统一替换标签')).toHaveCount(0);
  await dialog.getByRole('button',{name:'保存整理'}).click();await expect(dialog).not.toBeVisible();
  await page.getByRole('checkbox',{name:'按分组查看',exact:true}).click();await expect(page.getByRole('checkbox',{name:'按分组查看',exact:true})).toBeChecked();await page.getByLabel('分组筛选').selectOption({label:'权限管理'});
  await expect(page.locator('tbody .intake-group-heading')).toContainText('权限管理');await expectGroupToggleAligned(page);
  const width=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));expect(width.scroll).toBeLessThanOrEqual(width.client+2);
  await page.screenshot({path:info.outputPath('requirement-groups-mobile.png'),fullPage:true});
  expect(await(await page.request.get('/api/projects/'+id+'/requirement-intake')).json()).not.toHaveProperty('tags');
});

test('含旧标签的本机草稿保留原始文本，便于修正后继续导入',async({page})=>{
  const id=await fixture(page);
  const pkg={...intakeExample,requirements:intakeExample.requirements.map(r=>({...r,tags:['旧标签']}))},raw=JSON.stringify(pkg);
  await page.evaluate(({id,pkg,raw})=>{
    const key=Object.keys(localStorage).find(k=>k.startsWith('pm-intake:')&&k.endsWith(':'+id))!;
    localStorage.setItem(key,JSON.stringify({raw,pkg,attempt:null}));
  },{id,pkg,raw});
  await page.reload();await expect(page.getByLabel('原始需求',{exact:true})).toHaveValue(raw);
  await page.getByLabel('原始需求',{exact:true}).fill(JSON.stringify(intakeExample));
  await page.getByRole('button',{name:'整理需求',exact:true}).click();await expect(page.getByLabel('导入需求标题')).toHaveValue('查询与详情');
});
