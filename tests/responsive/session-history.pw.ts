import {expect,test,type APIRequestContext,type Page} from '@playwright/test';
import type {Requirement} from '../../src/client/types';

test.use({actionTimeout:10_000});
test('返回标签时更新登录身份，历史导航不恢复旧私有项目',async({page,browser,baseURL},info)=>{
  test.setTimeout(90_000);
  const admin=await browser.newContext({baseURL}),errors:string[]=[],writes:string[]=[],report:Record<string,unknown>={};
  let second:Page|undefined;
  const post=async(request:APIRequestContext,url:string,data:object)=>{const response=await request.post(url,{data});expect(response.ok(),await response.text()).toBe(true);return response.json();};
  const read=async(request:APIRequestContext,url:string)=>{const response=await request.get(url);expect(response.ok(),await response.text()).toBe(true);return response.json();};
  const detail=async(id:string)=>await read(admin.request,'/api/requirements/'+id) as Requirement;
  try{
    await post(admin.request,'/api/login',{username:'admin',password:'41_xc7q0qOjo4Inw!'});
    const a=await post(admin.request,'/api/projects',{name:'会话验证甲私有项目'}),b=await post(admin.request,'/api/projects',{name:'会话验证乙私有项目'});
    const person=await post(admin.request,'/api/people',{projectId:b.id,name:'历史导航成员 '+Date.now()});
    const ra=await post(admin.request,'/api/requirements',{projectId:a.id,title:'仅甲可见的专项需求',background:'私有资料，不应出现在乙成员旧页面'}),rb=await post(admin.request,'/api/requirements',{projectId:b.id,title:'乙成员正常可读需求',ownerId:person.id});
    const setup=await browser.newContext({baseURL});
    try{await post(setup.request,'/api/login',{username:person.name,password:'888888'});await post(setup.request,'/api/account/change-password',{currentPassword:'888888',newPassword:'kv-member-history-password'});}finally{await setup.close();}
    const beforeA=await detail(ra.id),beforeB=await detail(rb.id);report.before={a:beforeA,b:beforeB};
    await post(page.request,'/api/login',{username:'admin',password:'41_xc7q0qOjo4Inw!'});
    page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().includes('/api/')&&!['GET','HEAD'].includes(request.method()))writes.push(request.method()+' '+new URL(request.url()).pathname);});
    const aUrl='/?'+new URLSearchParams({projectId:a.id,workspaceView:'progress',detailId:ra.id}),panel=page.locator('.modal-card-workspace[role=dialog]');
    await page.goto(aUrl);await expect(panel).toContainText(ra.title);await panel.locator(':scope > header').getByRole('button',{name:'关闭',exact:true}).click();
    const oldUrl=page.url();await page.getByRole('link',{name:'个人设置',exact:true}).click();await expect(page).toHaveURL(/\/settings/);
    // 无头浏览器的标签均可见；显式模拟离开和返回标签。
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'});document.dispatchEvent(new Event('visibilitychange',{bubbles:true}));});
    second=await page.context().newPage();await second.goto('/settings');await second.getByRole('button',{name:'账号菜单：admin',exact:true}).click();await second.getByRole('menuitem',{name:'退出登录',exact:true}).click();await second.getByRole('button',{name:'游客登录',exact:true}).click();
    const login=second.getByRole('dialog',{name:'用户登录',exact:true});await login.getByLabel('用户名',{exact:true}).fill(person.name);await login.getByLabel('密码',{exact:true}).fill('kv-member-history-password');await login.getByRole('button',{name:'用户登录',exact:true}).click();await expect(login).toHaveCount(0);await expect(second.getByRole('button',{name:'账号菜单：'+person.name,exact:true})).toBeVisible();
    report.memberAccountId=(await read(second.request,'/api/session')).accountId;report.previousVisibility=await page.evaluate(()=>document.visibilityState);
    await page.bringToFront();await page.evaluate(()=>{Reflect.deleteProperty(document,'visibilityState');document.dispatchEvent(new Event('visibilitychange',{bubbles:true}));});await expect(page.getByRole('button',{name:'账号菜单：'+person.name,exact:true})).toBeVisible({timeout:10_000});
    await expect(page.getByRole('link',{name:'系统管理',exact:true})).toHaveCount(0);
    await page.goBack();await expect(page).toHaveURL(oldUrl);await expect(page.getByRole('heading',{name:'项目不可用',exact:true})).toBeVisible();await expect(page.locator('.unified-workspace')).toHaveCount(0);await expect(page.getByText(ra.title,{exact:true})).toHaveCount(0);
    expect((await page.request.get('/api/requirements/'+ra.id)).status()).toBe(404);expect((await page.request.get('/api/projects/'+a.id+'/path-graph')).status()).toBe(404);
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:info.outputPath('session-history-denied-390.png'),animations:'disabled'});
    await page.goForward();await expect(page).toHaveURL(/\/settings/);await expect(page.getByRole('button',{name:'账号菜单：'+person.name})).toBeVisible();await page.goBack();await expect(page.getByRole('heading',{name:'项目不可用',exact:true})).toBeVisible();await expect(page.getByText(ra.title,{exact:true})).toHaveCount(0);
    expect(await detail(ra.id)).toEqual(beforeA);expect(await detail(rb.id)).toEqual(beforeB);expect(writes).toEqual([]);
    const grant=await admin.request.put('/api/projects/'+a.id+'/members/'+person.id,{data:{role:'viewer',expectedMembershipUpdatedAt:null}});expect(grant.ok(),await grant.text()).toBe(true);
    await page.reload();await expect(page.locator('.unified-workspace')).toHaveCount(1);
    await page.getByRole('button',{name:'展开全部',exact:true}).click();await expect(page.getByText(ra.title,{exact:true}).first()).toBeVisible();await expect(page.getByRole('heading',{name:'项目不可用',exact:true})).toHaveCount(0);
    await page.goto(aUrl);await expect(panel).toContainText(ra.title);await expect(panel.getByRole('button',{name:/^(更新进度|完成需求|编辑需求)$/})).toHaveCount(0);await page.screenshot({path:info.outputPath('session-history-restored-390.png'),animations:'disabled'});
    await page.reload();await expect(panel).toContainText(ra.title);expect(await detail(ra.id)).toEqual(beforeA);expect(await detail(rb.id)).toEqual(beforeB);expect(await read(page.request,'/api/requirements/'+ra.id)).toEqual(beforeA);
    expect(writes).toEqual([]);expect(errors).toEqual([]);report.accepted=true;
  }finally{report.writes=writes;report.errors=errors;await info.attach('session-history',{body:JSON.stringify(report,null,2),contentType:'application/json'});await second?.close();await admin.close();}
});
