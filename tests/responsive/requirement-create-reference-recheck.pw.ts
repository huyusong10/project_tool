import {expect,test} from '@playwright/test';
import type {Requirement} from '../../src/client/types';

test('新建需求链接名称含空格，响应丢失后核对成功且不重复创建',async({page})=>{
  const post=async(url:string,data:object)=>{const response=await page.request.post(url,{data});expect(response.ok(),await response.text()).toBe(true);return response.json();};
  await post('/api/login',{username:'admin',password:'41_xc7q0qOjo4Inw!'});
  const project=await post('/api/projects',{name:'需求链接核对'+Date.now()});
  await page.goto('/requirements?projectId='+project.id);
  await page.getByRole('button',{name:'新建需求',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'新建需求',exact:true});
  await dialog.getByLabel('需求标题',{exact:true}).fill('  只创建一次的关联资料  ');
  await dialog.getByRole('button',{name:/补充信息/}).click();
  await dialog.getByLabel('需求背景',{exact:true}).fill('  保留创建内容  ');
  const links=dialog.getByRole('region',{name:'编辑关联链接'});
  for(const [index,title,url] of [[1,'  设计资料  ','https://example.com/pages/design'],[2,'  任务说明  ','https://example.com/browse/PM-123']] as const){
    await links.getByRole('button',{name:'添加',exact:true}).click();
    await dialog.getByLabel(`链接 ${index} 地址`,{exact:true}).fill(url);
    await dialog.getByLabel(`链接 ${index} 名称`,{exact:true}).fill(title);
  }
  let writes=0;
  await page.route('**/api/requirements',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    writes++;const response=await route.fetch();expect(response.ok(),await response.text()).toBe(true);await route.abort('failed');
  });
  await dialog.getByRole('button',{name:'创建需求',exact:true}).click();
  await expect(dialog).toContainText('创建结果待核对');
  await expect(dialog.getByRole('button',{name:'创建需求',exact:true})).toBeDisabled();
  const read=async()=>{const response=await page.request.get('/api/requirements?projectId='+project.id);expect(response.ok(),await response.text()).toBe(true);return await response.json() as Requirement[];};
  const created=await read();expect(created).toHaveLength(1);
  expect(created[0].referenceLinks).toEqual([{title:'设计资料',url:'https://example.com/pages/design',kind:'document'},{title:'任务说明',url:'https://example.com/browse/PM-123',kind:'task'}]);
  await page.reload();await expect(dialog).toContainText('创建结果待核对');
  await dialog.getByRole('button',{name:'读取最新需求并继续',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('已核对最新状态：需求已创建',{exact:true})).toBeVisible();
  expect(writes).toBe(1);expect(await read()).toEqual(created);
});
