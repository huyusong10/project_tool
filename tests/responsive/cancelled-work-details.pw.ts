import { expect, test } from '@playwright/test';
import type { Requirement } from '../../src/client/types';

for (const workspaceView of ['list', 'progress']) {
  test(`${workspaceView}中取消工作后移除占位，历史保留，刷新后重新添加使用新记录`, async ({ page }) => {
    const post = async (path: string, data: object) => {
      const response = await page.request.post(path, { data });
      expect(response.ok(), await response.text()).toBe(true);
      return response.json();
    };
    await post('/api/login', { username: 'admin', password: '41_xc7q0qOjo4Inw!' });
    const project = await post('/api/projects', { name: '部分范围取消 ' + Date.now() });
    const owner = await post('/api/people', { projectId: project.id, name: '范围负责人 ' + Date.now() });
    const template = await post('/api/templates', { projectId: project.id, name: '独立交付工作', dependencyMode: 'legacy', items: [
      { title: '继续实现接口', durationDays: 1, startOffsetDays: 0, sortOrder: 0 },
      { title: '已不需要的核验', durationDays: 1, startOffsetDays: 0, sortOrder: 1 },
    ] });
    let requirement: Requirement = await post('/api/requirements', { projectId: project.id, title: '保留核心交付', templateId: template.id, ownerId: owner.id });
    const read = async () => (await (await page.request.get('/api/requirements/' + requirement.id)).json()) as Requirement;
    const active = await post('/api/work-items/' + requirement.workItems[0].id + '/start', { expectedVersion: requirement.workItems[0].version, expectedRequirementVersion: requirement.version, ownerId: owner.id });
    await post('/api/requirements/' + requirement.id + '/progress', { expectedVersion: active.version, workItemId: active.id, workItemPercent: 40, content: '保留已完成的接口工作' });
    requirement = await read();
    const cancelled = requirement.workItems[1];
    await page.goto('/?' + new URLSearchParams({ projectId: project.id, workspaceView, scopeType: 'project', detailId: requirement.id, detailTab: 'work' }));
    const root = page.getByRole('dialog');
    const row = root.locator('[data-work-id="' + cancelled.id + '"]');
    await row.getByRole('button', { name: '取消工作项', exact: true }).click();
    const confirmation=page.getByRole('dialog',{name:'取消并移除工作项',exact:true});
    await expect(confirmation).toContainText('没有需要解除的前后依赖');
    await confirmation.getByRole('button',{name:'确认取消并移除',exact:true}).click();
    await expect(row).toHaveCount(0);
    const afterCancel = await read();
    expect(afterCancel).toMatchObject({ status: 'in_progress', progress: 40 });
    expect(afterCancel.workItems.find(w => w.id === active.id)).toMatchObject({ status: 'in_progress', progress: 40 });
    expect(afterCancel.progressUpdates).toEqual(expect.arrayContaining(requirement.progressUpdates || []));
    expect(afterCancel.workItems.some(w=>w.id===cancelled.id)).toBe(false);
    expect(afterCancel.progressUpdates).toEqual(expect.arrayContaining([expect.objectContaining({workItemId:cancelled.id,workItemTitle:cancelled.title,eventType:'cancel'})]));
    await root.getByRole('tab',{name:'记录',exact:true}).click();
    await expect(root).toContainText('取消工作项：'+cancelled.title);
    await page.reload();
    await expect(root).toContainText('取消工作项：'+cancelled.title);
    await root.getByRole('tab',{name:'工作项 1',exact:true}).click();
    await expect(root.locator('[data-work-id="'+cancelled.id+'"]')).toHaveCount(0);
    const replacement=await post('/api/requirements/'+requirement.id+'/work-items',{expectedVersion:afterCancel.version,title:cancelled.title});
    expect(replacement.id).not.toBe(cancelled.id);
    expect(replacement).toMatchObject({status:'not_started',progress:0,actualStart:null,ownerId:null});
    await page.reload();
    await expect(root.locator('[data-work-id="'+replacement.id+'"]')).toBeVisible();
    const saved=await read();
    expect(saved.workItems.find(w=>w.id===active.id)).toMatchObject({status:'in_progress',progress:40});
    expect(saved.progressUpdates).toEqual(expect.arrayContaining(afterCancel.progressUpdates || []));
  });
}

for (const branch of ['changed','unknown'] as const) test(`详情取消展示前后依赖并处理${branch}结果，不留下失效详情`,async({page},info)=>{
  const post=async(url:string,data:object)=>{const response=await page.request.post(url,{data});expect(response.ok(),await response.text()).toBe(true);return response.json();};
  await post('/api/login',{username:'admin',password:'41_xc7q0qOjo4Inw!'});
  const project=await post('/api/projects',{name:'依赖取消 '+branch+' '+Date.now()});
  let r:Requirement=await post('/api/requirements',{projectId:project.id,title:'取消范围验收'});
  const read=async()=>(await(await page.request.get('/api/requirements/'+r.id)).json()) as Requirement;
  const works=[];
  for(const title of ['接口设计','旧渠道核验','发布准备']){works.push(await post('/api/requirements/'+r.id+'/work-items',{expectedVersion:r.version,title}));r=await read();}
  for(const [source,target] of [[works[0],works[1]],[works[1],works[2]]]){
    const analysis=await(await page.request.get('/api/projects/'+project.id+'/path-analysis')).json();
    await post('/api/projects/'+project.id+'/dependencies',{expectedRevision:analysis.revision,sourceRequirementId:r.id,sourceWorkItemId:source.id,targetRequirementId:r.id,targetWorkItemId:target.id});
  }
  const work=works[1];
  await page.goto('/?'+new URLSearchParams({projectId:project.id,workspaceView:'list',scopeType:'requirement',scopeId:r.id,detailId:work.id,detailTab:'overview'}));
  await page.getByRole('button',{name:'取消工作项',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'取消并移除工作项',exact:true});
  await expect(dialog).toContainText('接口设计 → 旧渠道核验');await expect(dialog).toContainText('旧渠道核验 → 发布准备');
  let writes=0;page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/work-items/'+work.id+'/cancel'))writes++;});
  if(branch==='changed'){
    r=await read();await post('/api/requirements/'+r.id+'/work-items',{expectedVersion:r.version,title:'新增安排'});
    await dialog.getByRole('button',{name:'确认取消并移除',exact:true}).click();
    await expect(dialog).toContainText('请重新读取工作项的取消影响');
    expect((await read()).workItems.some(w=>w.id===work.id)).toBe(true);
    await expect(dialog.getByRole('button',{name:'确认取消并移除',exact:true})).toBeEnabled();
  }else{
    await page.route('**/api/work-items/'+work.id+'/cancel',async route=>{const response=await route.fetch();expect(response.ok()).toBe(true);await route.fulfill({status:200,contentType:'application/json',body:'{'});});
  }
  await dialog.getByRole('button',{name:'确认取消并移除',exact:true}).click();
  await expect.poll(async()=>(await read()).workItems.some(w=>w.id===work.id)).toBe(false);
  await expect(page).toHaveURL(new RegExp('detailId='+r.id));
  await expect(page.getByRole('button',{name:'返回旧渠道核验',exact:true})).toHaveCount(0);
  await expect(page.getByText('工作项不存在或已无法访问，未提交输入已保留。',{exact:true})).toHaveCount(0);
  await expect(page.getByText('取消工作项：旧渠道核验；工作项已移除，需要时重新添加。',{exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByText('取消工作项：旧渠道核验；工作项已移除，需要时重新添加。',{exact:true})).toBeVisible();
  const edges=await(await page.request.get('/api/projects/'+project.id+'/dependencies')).json();expect(edges).toEqual([]);
  expect(writes).toBe(branch==='changed'?2:1);
  await page.screenshot({path:info.outputPath('cancel-'+branch+'-history.png')});
});
