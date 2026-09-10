import {expect,test,type Page} from '@playwright/test';
import {intakeExample} from '../../src/shared/intake';

async function fixture(page:Page) {
  const login=await page.request.post('/api/login',{data:{username:'admin',password:'41_xc7q0qOjo4Inw!'}});expect(login.ok()).toBe(true);
  const session=await login.json();
  const response=await page.request.post('/api/projects',{data:{name:'来源导入 '+Date.now()}});expect(response.ok()).toBe(true);const project=await response.json();
  await page.addInitScript(({accountId,projectId})=>localStorage.setItem('project-manage:selected-project:'+accountId,projectId),{accountId:session.accountId,projectId:project.id});
  await page.goto('/requirements?intakeView=import');
  await page.getByLabel('导入 JSON').fill(JSON.stringify(intakeExample));await page.getByRole('button',{name:'读取并整理',exact:true}).click();
  await expect(page.getByLabel('导入需求标题')).toHaveValue('查询与详情可用');return project.id as string;
}
test('导入可拆分合并，保存后按分组标签查看并追溯来源',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const id=await fixture(page);
  await page.getByRole('button',{name:'拆出另一份交付'}).click();await expect(page.getByLabel('导入需求标题')).toHaveCount(2);
  await page.getByLabel('合并交付到').last().selectOption({label:'查询与详情可用'});await expect(page.getByLabel('导入需求标题')).toHaveCount(1);
  await page.getByLabel('导入需求标题').fill('查询交付浏览器验证');
  await page.getByRole('button',{name:'预览导入',exact:true}).click();await expect(page.getByText('原编号 EX-001 重复',{exact:false})).toBeVisible();
  await page.screenshot({path:info.outputPath('import-preview.png'),fullPage:true});
  await page.getByRole('button',{name:'保存导入',exact:true}).click();await expect(page.getByText('已保存导入结果',{exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'交付需求',exact:true}).click();await page.getByLabel('按分组查看').click();await expect(page.getByLabel('按分组查看')).toBeChecked();
  await page.getByLabel('分组筛选').selectOption({label:'示例模块'});await page.getByLabel('标签筛选').selectOption('中心');await expect(page.locator('tbody .intake-group-heading')).toContainText('示例模块');
  await page.getByRole('tab',{name:'来源条款',exact:true}).click();await expect(page.locator('.intake-document')).toHaveCount(1);await expect(page.locator('.intake-clause')).toHaveCount(2);
  await page.screenshot({path:info.outputPath('sources.png'),fullPage:true});
  const requirements=await(await page.request.get('/api/requirements?projectId='+id)).json();expect(requirements).toHaveLength(1);expect(requirements[0].workItems).toHaveLength(2);
  await page.goto('/requirements/'+requirements[0].id);await page.locator('.intake-detail>summary').click();await expect(page.locator('.intake-detail')).toContainText('查询权限');
  await expect(page.locator('.requirement-progress-panel')).toBeVisible();expect(errors).toEqual([]);
});
test('预览失败保留调整，未知提交刷新后查询原回执且不重复创建',async({page})=>{
  const id=await fixture(page),url=`**/api/projects/${id}/requirement-import/preview`;
  await page.getByLabel('导入需求标题').fill('保留导入输入');
  await page.route(url,route=>route.fulfill({status:503,json:{error:'服务暂时不可用'}}));
  await page.getByRole('button',{name:'预览导入',exact:true}).click();await expect(page.getByRole('alert')).toContainText('服务暂时不可用');await expect(page.getByLabel('导入需求标题')).toHaveValue('保留导入输入');
  await page.unroute(url);await page.getByRole('button',{name:'预览导入',exact:true}).click();await expect(page.getByRole('button',{name:'保存导入',exact:true})).toBeEnabled();
  let writes=0;await page.route(`**/api/projects/${id}/requirement-import/apply`,async route=>{writes++;await route.fetch();await route.fulfill({status:200,contentType:'text/html',body:'invalid response'});});
  await page.getByRole('button',{name:'保存导入',exact:true}).click();await expect(page.getByRole('button',{name:'查询提交回执'})).toBeVisible();
  await page.reload();await page.getByRole('button',{name:'查询提交回执'}).click();await expect(page.getByText('已保存导入结果',{exact:true})).toBeVisible();expect(writes).toBe(1);
  expect((await(await page.request.get('/api/requirements?projectId='+id)).json()).length).toBe(1);
});
test('窄屏分组整理与来源暂缓可用，页面无横向溢出',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});const id=await fixture(page);
  await page.getByRole('button',{name:'预览导入',exact:true}).click();await page.getByRole('button',{name:'保存导入',exact:true}).click();await expect(page.getByText('已保存导入结果',{exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'交付需求',exact:true}).click();await page.getByLabel('选择需求 查询与详情可用').check();await page.getByRole('button',{name:'整理所选需求'}).click();
  const dialog=page.getByRole('dialog',{name:'整理 1 个需求'});await dialog.getByLabel('统一替换标签').check();await dialog.getByRole('textbox').fill('边缘，基础准备');await dialog.getByRole('button',{name:'保存整理'}).click();await expect(dialog).not.toBeVisible();
  await page.getByLabel('标签筛选').selectOption('边缘');await expect(page.getByRole('link',{name:'查询与详情可用',exact:true})).toBeVisible();
  await page.getByRole('tab',{name:'来源条款',exact:true}).click();await page.getByRole('button',{name:'标记暂缓',exact:true}).first().click();const defer=page.getByRole('dialog',{name:'暂缓条款'});await defer.getByRole('textbox').fill('下期补充验收场景');await defer.getByRole('button',{name:'保存安排'}).click();await expect(page.getByText('暂缓：下期补充验收场景')).toBeVisible();
  const width=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));expect(width.scroll).toBeLessThanOrEqual(width.client+2);
  await page.screenshot({path:info.outputPath('sources-mobile.png'),fullPage:true});
  expect((await(await page.request.get(`/api/projects/${id}/requirement-intake`)).json()).tags).toEqual(['基础准备','边缘']);
});
