import {expect,test,type APIRequestContext} from '@playwright/test';
import type {Requirement} from '../../src/client/types';

test('打开的需求在经理改为只读后拒绝旧提交，刷新权限且不影响其他项目',async({page,browser,baseURL},info)=>{
  const post=async(request:APIRequestContext,url:string,data:object)=>{const response=await request.post(url,{data});expect(response.ok(),await response.text()).toBe(true);return response.json();};
  await post(page.request,'/api/login',{username:'admin',password:'41_xc7q0qOjo4Inw!'});
  const project=await post(page.request,'/api/projects',{name:'权限变化甲 '+Date.now()}),other=await post(page.request,'/api/projects',{name:'权限变化乙 '+Date.now()});
  const owner=await post(page.request,'/api/people',{projectId:project.id,name:'保留经理 '+Date.now()}),person=await post(page.request,'/api/people',{projectId:project.id,name:'调整权限 '+Date.now()});
  const setRole=async(projectId:string,id:string,role:string)=>{const members=await(await page.request.get('/api/projects/'+projectId+'/members')).json();const response=await page.request.put('/api/projects/'+projectId+'/members/'+id,{data:{role,expectedMembershipUpdatedAt:members.find((m:{id:string})=>m.id===id)?.membershipUpdatedAt??null}});expect(response.ok(),await response.text()).toBe(true);};
  await setRole(project.id,owner.id,'manager');await setRole(project.id,person.id,'manager');await setRole(other.id,owner.id,'member');await setRole(other.id,person.id,'manager');
  const create=async(projectId:string,title:string)=>await post(page.request,'/api/requirements',{projectId,title,ownerId:owner.id}) as Requirement;
  const a=await create(project.id,'权限变化中保留执行事实'),b=await create(other.id,'其他项目仍可执行');
  let completed:Requirement=await post(page.request,'/api/requirements',{projectId:project.id,title:'只读人员保留历史归属',ownerId:person.id});completed=await post(page.request,'/api/requirements/'+completed.id+'/start',{expectedVersion:completed.version});await post(page.request,'/api/requirements/'+completed.id+'/complete',{expectedVersion:completed.version});
  const detail=async(id:string)=>await(await page.request.get('/api/requirements/'+id)).json() as Requirement;
  for(const r of [a,b]){const started=await post(page.request,'/api/requirements/'+r.id+'/start',{expectedVersion:r.version});await post(page.request,'/api/requirements/'+r.id+'/progress',{expectedVersion:started.version,requirementPercent:35,content:'已确认的交付成果'});}
  const before=await detail(a.id),otherBefore=await detail(b.id);
  expect(before.ownerValid).toBe(true);
  const context=await browser.newContext({baseURL,viewport:page.viewportSize()});
  try{
    const session=await post(context.request,'/api/login',{username:person.name,password:'888888'});await post(context.request,'/api/account/change-password',{currentPassword:'888888',newPassword:'live-role-review-password'});
    await context.addInitScript(({accountId,projectId})=>localStorage.setItem('project-manage:selected-project:'+accountId,projectId),{accountId:session.accountId,projectId:project.id});
    const actor=await context.newPage();await actor.clock.install();
    const initialCheck=actor.waitForResponse(response=>response.url().endsWith('/api/projects/'+project.id+'/change-version'));
    await actor.goto('/requirements/'+a.id);await initialCheck;
    await actor.getByRole('button',{name:'更新进度',exact:true}).click();const form=actor.getByRole('dialog',{name:'更新进度',exact:true});await form.getByLabel('需求完成度').fill('52');await form.getByLabel('执行说明').fill('尚未获准的修改');
    await setRole(project.id,person.id,'viewer');
    const rejected=actor.waitForResponse(response=>response.url().endsWith('/api/requirements/'+a.id+'/progress')&&response.request().method()==='POST');
    await form.getByRole('button',{name:'更新进度',exact:true}).click();expect((await rejected).status()).toBe(403);expect(await detail(a.id)).toEqual(before);
    const refreshed=actor.waitForResponse(response=>new URL(response.url()).pathname==='/api/projects');
    await actor.clock.fastForward(61_000);expect((await(await refreshed).json()).find((p:{id:string})=>p.id===project.id).projectRole).toBe('viewer');
    await expect(actor.locator('.delivery-controls button[aria-label="更新进度"]')).toHaveCount(0);
    await expect(actor.getByRole('button',{name:'完成需求',exact:true})).toHaveCount(0);
    await expect(form.getByRole('button',{name:'更新进度',exact:true})).toBeDisabled();
    await expect(form).toContainText('当前没有执行此需求的权限');
    await expect(form.getByLabel('执行说明')).toHaveValue('尚未获准的修改');
    const writes:string[]=[];actor.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/api/requirements/'+a.id+'/progress'))writes.push(request.postData()||'');});await form.locator('form').evaluate(element=>element.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(writes).toEqual([]);
    await expect(actor.locator('.requirement-overview')).toBeVisible();expect(await detail(a.id)).toEqual(before);
    const currentSession=await(await context.request.get('/api/session')).json();expect(currentSession.accountId).toBe(session.accountId);expect(currentSession.managedProjectIds).not.toContain(project.id);expect(currentSession.managedProjectIds).toContain(other.id);
    await actor.screenshot({path:info.outputPath('read-only-after-demotion.png'),animations:'disabled'});
    await actor.goto('/requirements/'+completed.id);await expect(actor.locator('.requirement-overview')).toContainText('已完成');await expect(actor.getByRole('button',{name:'返工',exact:true})).toHaveCount(0);expect(await detail(completed.id)).toMatchObject({ownerId:person.id,ownerValid:false});
    await actor.goto('/requirements/'+b.id);await expect(actor.getByRole('button',{name:'更新进度',exact:true})).toBeEnabled();expect(await detail(b.id)).toEqual(otherBefore);
    await setRole(project.id,person.id,'manager');await actor.goto('/requirements/'+a.id);await actor.reload();
    const restored=actor.getByRole('dialog',{name:'更新进度',exact:true});await expect(restored.getByRole('button',{name:'更新进度',exact:true})).toBeEnabled();await expect(restored.getByLabel('需求完成度')).toHaveValue('52');await expect(restored.getByLabel('执行说明')).toHaveValue('尚未获准的修改');await restored.getByLabel('执行说明').fill('重新授权后提交');await restored.getByRole('button',{name:'更新进度',exact:true}).click();await expect(restored).toHaveCount(0);
    await expect.poll(async()=>(await detail(a.id)).progress).toBe(52);expect((await detail(a.id)).progressUpdates?.some(update=>update.content==='尚未获准的修改')).toBe(false);expect(await detail(b.id)).toEqual(otherBefore);
  }finally{await context.close();}
});
