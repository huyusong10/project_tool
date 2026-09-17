import {expect,test} from '@playwright/test';

test('岗位变更后三个人员视图仍显示真实筛选条件并可直接清空',async({page},info)=>{
  const post=async(url:string,data:object)=>{const response=await page.request.post(url,{data});expect(response.ok(),await response.text()).toBe(true);return response.json();};
  const session=await post('/api/login',{username:'admin',password:'41_xc7q0qOjo4Inw!'});
  const project=await post('/api/projects',{name:'岗位变化筛选检查 '+Date.now()});
  const first=await post('/api/people',{projectId:project.id,name:'转岗人员 '+Date.now(),jobTitle:'研发'});
  const second=await post('/api/people',{projectId:project.id,name:'原测试人员 '+Date.now(),jobTitle:'测试'});
  for(const person of [first,second]){
    const r=await post('/api/requirements',{projectId:project.id,title:person.name+'执行的需求',ownerId:person.id});
    await post('/api/requirements/'+r.id+'/start',{expectedVersion:r.version});
  }
  await page.addInitScript(({account,id})=>localStorage.setItem('project-manage:selected-project:'+account,id),{account:session.accountId,id:project.id});
  await page.goto('/resources');await page.getByLabel('按岗位筛选',{exact:true}).selectOption('研发');
  await page.goto('/people?view=matrix');await page.getByLabel('岗位筛选',{exact:true}).selectOption('研发');
  const views=page.getByRole('group',{name:'人员页面视图'});
  await views.getByRole('button',{name:'人力分析',exact:true}).click();
  const job=page.getByLabel('分析岗位',{exact:true}),person=page.getByLabel('分析人员',{exact:true});
  await job.selectOption('研发');await person.selectOption(first.id);
  const rows=page.getByRole('table',{name:'人员工作日并发度矩阵'}).locator('tbody tr');
  await expect(rows).toHaveCount(1);await expect(rows).toContainText(first.name);
  const change=await page.request.patch('/api/people/'+first.id,{data:{expectedUpdatedAt:first.updatedAt,name:first.name,jobTitle:'测试'}});expect(change.ok(),await change.text()).toBe(true);
  const refreshed=page.waitForResponse(response=>response.url().includes('/api/analytics/people-concurrency')&&new URL(response.url()).searchParams.get('jobTitle')==='研发'&&new URL(response.url()).searchParams.get('personId')===first.id);
  await page.reload();expect((await(await refreshed).json()).people).toEqual([]);
  await page.screenshot({path:info.outputPath('changed-job-filter.png'),animations:'disabled'});
  await expect(job).toHaveValue('研发');await expect(person).toHaveValue(first.id);
  await expect(page.getByText('当前区间暂无安排',{exact:true})).toBeVisible();
  await job.selectOption('');await expect(person).toHaveValue('');await expect(rows).toHaveCount(2);
  await job.selectOption('测试');await person.selectOption(first.id);await expect(rows).toHaveCount(1);await expect(rows).toContainText(first.name);
  await page.reload();await expect(job).toHaveValue('测试');await expect(person).toHaveValue(first.id);await expect(rows).toHaveCount(1);
  await views.getByRole('button',{name:'人员矩阵',exact:true}).click();
  const matrixJob=page.getByLabel('岗位筛选',{exact:true});
  await expect.soft(matrixJob).toHaveValue('研发');await expect(page.getByText('没有匹配的人员',{exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('changed-job-matrix.png'),animations:'disabled'});
  await matrixJob.selectOption('');await expect(page.getByText(first.name,{exact:true})).toBeVisible();
  await page.goto('/resources');const accountJob=page.getByLabel('按岗位筛选',{exact:true});
  await expect.soft(accountJob).toHaveValue('研发');
  await page.screenshot({path:info.outputPath('changed-job-accounts.png'),animations:'disabled'});
  await accountJob.selectOption('all');await expect(page.getByRole('row').filter({hasText:first.name})).toBeVisible();
});
