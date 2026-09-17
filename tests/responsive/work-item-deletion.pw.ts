import {expect,test} from '@playwright/test';
import type {Requirement} from '../../src/client/types';
import {addBusinessDays,todayIso} from '../../src/shared/domain';

test('删除最后一个未执行工作项恢复直接执行并保留既有进度和历史',async({page},info)=>{
  const post=async(url:string,data:object)=>{const response=await page.request.post(url,{data});expect(response.ok(),await response.text()).toBe(true);return response.json();};
  const session=await post('/api/login',{username:'admin',password:'41_xc7q0qOjo4Inw!'});
  const project=await post('/api/projects',{name:'最后工作项恢复 '+Date.now()}),owner=await post('/api/people',{projectId:project.id,name:'执行人 '+Date.now()});
  await page.addInitScript(({id,accountId})=>localStorage.setItem('project-manage:selected-project:'+accountId,id),{id:project.id,accountId:session.accountId});
  const detail=async(id:string)=>await(await page.request.get('/api/requirements/'+id)).json() as Requirement;
  const plan={plannedStart:addBusinessDays(todayIso(),0),plannedEnd:addBusinessDays(todayIso(),5)};
  for(const progress of [0,30]){
    let r:Requirement=await post('/api/requirements',{projectId:project.id,title:'恢复直接执行 '+progress,ownerId:owner.id,...plan});
    if(progress){r=await post('/api/requirements/'+r.id+'/start',{expectedVersion:r.version});await post('/api/requirements/'+r.id+'/progress',{expectedVersion:r.version,requirementPercent:progress,content:'已有三成成果'});r=await detail(r.id);}
    const before=r;
    const work=await post('/api/requirements/'+r.id+'/work-items',{expectedVersion:r.version,title:'尚未执行的剩余工作',ownerId:owner.id,...plan});
    r=await detail(r.id);expect(r).toMatchObject({executionMode:'work_items',progress,splitBaseProgress:progress});
    await page.goto('/?'+new URLSearchParams({projectId:project.id,scopeType:'requirement',scopeId:r.id,workspaceView:'list',detailId:work.id,detailTab:'basic'}));
    await page.locator('[aria-label="工作项详情"]').getByRole('button',{name:'删除',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'删除工作项',exact:true});await dialog.getByRole('button',{name:'确认删除',exact:true}).click();await expect(dialog).toHaveCount(0);
    await expect.poll(async()=>(await detail(r.id)).workItems.length).toBe(0);
    const after=await detail(r.id);expect(after).toMatchObject({executionMode:'direct',splitBaseProgress:0,splitAt:null,progress,status:before.status,actualStart:before.actualStart,actualEnd:before.actualEnd,ownerId:before.ownerId,...plan});expect(after.progressUpdates).toEqual(before.progressUpdates);
    await expect(page.getByText('对象不存在或已无法访问，未提交输入已保留。',{exact:true})).toHaveCount(0);
    await expect(page).not.toHaveURL(/detailId=/);
    expect(new URL(page.url()).searchParams.get('scopeId')).toBe(r.id);
    await page.screenshot({path:info.outputPath('after-last-delete-'+progress+'.png'),animations:'disabled'});
    await page.goto('/requirements/'+r.id);
    if(progress){await page.getByRole('button',{name:'更新进度',exact:true}).click();await page.getByLabel('需求完成度').fill('50');await page.getByLabel('执行说明').fill('恢复直接执行后继续交付');await page.getByRole('dialog',{name:'更新进度',exact:true}).getByRole('button',{name:'更新进度',exact:true}).click();await expect.poll(async()=>(await detail(r.id)).progress).toBe(50);}
    else {await page.getByRole('button',{name:'开始需求',exact:true}).click();await expect.poll(async()=>(await detail(r.id)).status).toBe('in_progress');}
    r=await detail(r.id);await page.goto('/?'+new URLSearchParams({projectId:project.id,scopeType:'unphased',scopeId:r.featureId!,workspaceView:'list'}));const row=page.locator('[data-object-id="'+r.id+'"]');await expect(row).toContainText('进行中');await expect(row).toContainText(plan.plannedEnd);
    await page.reload();await expect(row).toContainText('进行中');
    if(progress){const next=await post('/api/requirements/'+r.id+'/work-items',{expectedVersion:r.version,title:'已开始不能删除',ownerId:owner.id});await post('/api/work-items/'+next.id+'/start',{expectedVersion:next.version});const started=await detail(r.id);const response=await page.request.delete('/api/work-items/'+next.id,{data:{expectedVersion:started.workItems[0].version}});expect(response.status()).toBe(409);expect(await response.text()).toContain('只有未开始');expect(await detail(r.id)).toEqual(started);}
  }
});
