import {expect,test} from '@playwright/test';
import type {Person} from '../../src/client/types';

test('末页人员草稿在后台转岗或重排后保持，保存与取消再更新列表',async({page},info)=>{
  expect((await page.request.post('/api/login',{data:{username:'admin',password:'41_xc7q0qOjo4Inw!'}})).ok()).toBe(true);
  const suffix=Date.now();let target!:Person;
  for(let i=0;i<21;i++){const response=await page.request.post('/api/people',{data:{name:'转岗核对'+suffix+'-'+String(i).padStart(2,'0'),jobTitle:'研发'}});expect(response.ok()).toBe(true);target=await response.json();}
  await page.goto('/resources?jobTitle='+encodeURIComponent('研发')+'&page=2&pageSize=20');
  const row=page.locator('.people-access-row');await expect(row).toHaveCount(1);await expect(row).toContainText(target.name);
  await row.getByRole('button',{name:/人员姓名/}).click();const draft=page.getByRole('textbox',{name:'人员姓名',exact:true});await draft.fill('转岗后保留的姓名草稿'+suffix);
  const changed=await page.request.patch('/api/people/'+target.id,{data:{jobTitle:'测试',expectedUpdatedAt:target.updatedAt}});expect(changed.ok()).toBe(true);
  const writes:string[]=[];page.on('request',request=>{if(request.url().includes('/api/')&&!['GET','HEAD'].includes(request.method()))writes.push(new URL(request.url()).pathname);});
  const refreshed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/people'&&response.request().method()==='GET');
  await page.evaluate(()=>window.dispatchEvent(new Event('offline')));await page.evaluate(()=>window.dispatchEvent(new Event('online')));await refreshed;
  await expect(draft).toHaveValue('转岗后保留的姓名草稿'+suffix);expect(writes).toEqual([]);
  await expect(page.getByRole('status')).toContainText('结束当前编辑后');
  await draft.press('Enter');await expect(page.getByRole('alert')).toContainText('人员已更新');expect(writes).toEqual([]);
  await page.getByRole('button',{name:'重新读取人员',exact:true}).click();await expect(draft).toHaveValue('转岗后保留的姓名草稿'+suffix);
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:info.outputPath('people-filter-refresh-draft-390.png'),animations:'disabled'});
  await draft.press('Enter');await expect(draft).toHaveCount(0);await expect(page).toHaveURL(/page=1/);await expect(row).toHaveCount(20);
  expect(writes).toEqual(['/api/people/'+target.id]);
  const people=await(await page.request.get('/api/people')).json() as Person[],saved=people.find(person=>person.id===target.id)!;
  expect(saved).toMatchObject({name:'转岗后保留的姓名草稿'+suffix,jobTitle:'测试'});
  await expect(page.getByLabel('按岗位筛选',{exact:true})).toHaveValue('研发');
  await page.setViewportSize({width:1280,height:800});await page.goto('/resources?jobTitle=all&page=2&pageSize=20');await expect(row).toHaveCount(1);
  const currentName=await row.getByRole('button',{name:/人员姓名/}).textContent(),last=people.find(person=>person.name===currentName!.trim())!;
  await row.getByRole('button',{name:/岗位：/}).click();const job=page.getByRole('textbox',{name:'岗位',exact:true});await job.fill('保留的岗位草稿');
  const moved=await page.request.patch('/api/people/'+last.id,{data:{name:'A已重新排序'+suffix,expectedUpdatedAt:last.updatedAt}});expect(moved.ok()).toBe(true);
  const reordered=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/people'&&response.request().method()==='GET');
  await page.evaluate(()=>window.dispatchEvent(new Event('offline')));await page.evaluate(()=>window.dispatchEvent(new Event('online')));await reordered;
  await expect(job).toHaveValue('保留的岗位草稿');await expect(row).toContainText('A已重新排序'+suffix);await expect(page.getByRole('status')).toContainText('结束当前编辑后');
  await job.press('Escape');await expect(job).toHaveCount(0);await expect(row).not.toContainText('A已重新排序'+suffix);expect(writes).toEqual(['/api/people/'+target.id]);
  expect((await(await page.request.get('/api/people')).json() as Person[]).find(person=>person.id===last.id)).toMatchObject({name:'A已重新排序'+suffix,jobTitle:last.jobTitle});
});
