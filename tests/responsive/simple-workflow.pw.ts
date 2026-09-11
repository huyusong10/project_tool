import {expect,test} from '@playwright/test';
import type {Requirement} from '../../src/client/types';

test('新建需求直接开始、更新、完成和返工，不经过来源或验收流程',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 const login=await page.request.post('/api/login',{data:{username:'admin',password:'41_xc7q0qOjo4Inw!'}});expect(login.ok()).toBe(true);
 const session=await login.json(),project=await(await page.request.post('/api/projects',{data:{name:'简化工作流 '+Date.now()}})).json();
 const owner=await(await page.request.post('/api/people',{data:{projectId:project.id,name:'执行负责人 '+Date.now()}})).json();
 await page.addInitScript(({accountId,projectId})=>localStorage.setItem('project-manage:selected-project:'+accountId,projectId),{accountId:session.accountId,projectId:project.id});
 await page.goto('/requirements');await page.getByRole('button',{name:'新建需求',exact:true}).click();
 const create=page.getByRole('dialog',{name:'新建需求'});
 await create.getByLabel('需求标题',{exact:true}).fill('用户登录认证');
 await create.getByLabel('需求负责人（可稍后指定）').selectOption(owner.id);
 await create.getByRole('button',{name:'创建需求',exact:true}).click();await expect(create).not.toBeVisible();
 const rows=await(await page.request.get('/api/requirements?projectId='+project.id)).json() as Requirement[];
 expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({status:'not_started',workItems:[]});
 const id=rows[0].id,detail=async()=>await(await page.request.get('/api/requirements/'+id)).json() as Requirement;
 await page.goto('/requirements/'+id);
 for(const name of ['确认验收','关联来源条款','填写落实范围','阻塞','解除阻塞','交付承诺'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'开始需求',exact:true}).click();
 await expect(page.getByRole("dialog")).toHaveCount(0);
 await expect.poll(async()=>(await detail()).status).toBe('in_progress');
 await page.getByRole('button',{name:'更新进度',exact:true}).click();
 const progress=page.getByRole('dialog',{name:'更新进度'});await progress.getByLabel('需求完成度').fill('60');await progress.getByRole('button',{name:'更新进度',exact:true}).click();
 await expect.poll(async()=>(await detail()).progress).toBe(60);
 await page.getByRole('button',{name:'完成需求',exact:true}).click();
 await expect(page.getByRole("dialog")).toHaveCount(0);
 await expect.poll(async()=>(await detail()).status).toBe('completed');expect(await detail()).toMatchObject({progress:100,acceptedAt:null});
 await page.screenshot({path:info.outputPath('simple-workflow-completed.png'),fullPage:true});
 await page.getByRole('button',{name:'返工',exact:true}).click();
 const rework=page.getByRole('dialog',{name:'返工'});await rework.getByLabel('需求完成度').fill('80');await rework.getByRole('button',{name:'返工',exact:true}).click();
 await expect.poll(async()=>(await detail()).status).toBe('in_progress');expect(await detail()).toMatchObject({progress:80,actualEnd:null});expect(errors).toEqual([]);
});

test('人类可以粘贴原文直接形成需求，保存后原文仍可读取',async({page})=>{
 const login=await page.request.post('/api/login',{data:{username:'admin',password:'41_xc7q0qOjo4Inw!'}}),session=await login.json();
 const project=await(await page.request.post('/api/projects',{data:{name:'原文导入 '+Date.now()}})).json();
 await page.addInitScript(({accountId,projectId})=>localStorage.setItem('project-manage:selected-project:'+accountId,projectId),{accountId:session.accountId,projectId:project.id});
 await page.goto('/requirements?intakeView=import');const raw='日志查询\n支持按时间和用户筛选日志。';
 await page.getByLabel('原始需求',{exact:true}).fill(raw);await page.getByRole('button',{name:'整理需求',exact:true}).click();
 await expect(page.getByLabel('导入需求标题')).toHaveValue('日志查询');await expect(page.getByLabel('导入需求原文')).toHaveValue(raw);
 await page.getByRole('button',{name:'预览导入',exact:true}).click();await page.getByRole('button',{name:'保存需求',exact:true}).click();
 await expect(page.getByText('已保存 1 个需求',{exact:true})).toBeVisible();
 const rows=await(await page.request.get('/api/requirements?projectId='+project.id)).json() as Requirement[];
 expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({title:'日志查询',background:raw,status:'not_started',workItems:[]});
});
