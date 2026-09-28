import {expect,test} from '@playwright/test';

type DeferredFile = {releaseFileRead:()=>void;fileRead:Promise<string>};

for(const replacement of ['new-file','manual-text','new-file-after-invalid','other-tab'] as const)test('导入慢文件不能覆盖后续输入 '+replacement,async({page,context})=>{
  const login=await page.request.post('/api/login',{data:{username:'admin',password:'41_xc7q0qOjo4Inw!'}});expect(login.ok()).toBe(true);const session=await login.json();
  const created=await page.request.post('/api/projects',{data:{name:'读取顺序 '+replacement+' '+Date.now()}});expect(created.ok()).toBe(true);const project=await created.json();
  await page.addInitScript(({accountId,id})=>localStorage.setItem('project-manage:selected-project:'+accountId,id),{accountId:session.accountId,id:project.id});
  await page.goto('/requirements?intakeView=import');
  await page.evaluate(()=>{
    const original=File.prototype.text,target=window as unknown as DeferredFile;
    File.prototype.text=function(){
      const contents=original.call(this);if(this.name!=='slow.txt')return contents;
      const gate=new Promise<void>(resolve=>{target.releaseFileRead=resolve;});
      target.fileRead=Promise.all([contents,gate]).then(([text])=>text);return target.fileRead;
    };
  });
  const upload=page.getByLabel('上传文本、Markdown 或工具 JSON'),raw=page.getByLabel('原始需求',{exact:true}),title=page.getByLabel('导入需求标题');
  await upload.setInputFiles({name:'slow.txt',mimeType:'text/plain',buffer:Buffer.from(replacement==='new-file-after-invalid'?'{"invalid":true}':'较早的文件\n旧文件说明')});
  await expect.poll(()=>page.evaluate(()=>typeof(window as unknown as DeferredFile).releaseFileRead)).toBe('function');
  const latest='最新的需求\n后续输入必须保留';
  if(replacement==='other-tab'){
    const tab=await context.newPage();let releaseApply!:()=>void;const pending=new Promise<void>(resolve=>{releaseApply=resolve;});
    try{
      await tab.goto('/requirements?intakeView=import');await tab.getByLabel('原始需求',{exact:true}).fill(latest);await tab.getByRole('button',{name:'整理需求',exact:true}).click();
      await tab.getByRole('button',{name:'预览导入',exact:true}).click();await expect(tab.getByRole('button',{name:'保存需求',exact:true})).toBeEnabled();
      await tab.route('**/requirement-import/apply',async route=>{await pending;await route.continue();});
      await tab.getByRole('button',{name:'保存需求',exact:true}).click();await expect(page.getByRole('button',{name:'查询提交回执',exact:true})).toBeVisible();
      releaseApply();await expect(tab.getByText('已保存 1 个需求',{exact:true})).toBeVisible();await expect(page.getByText('已保存 1 个需求',{exact:true})).toBeVisible();
    }finally{releaseApply();await tab.close();}
  }
  else if(replacement==='manual-text')await raw.fill(latest);
  else {await upload.setInputFiles({name:'latest.txt',mimeType:'text/plain',buffer:Buffer.from(latest)});await expect(title).toHaveValue('最新的需求');}
  await page.evaluate(async()=>{const target=window as unknown as DeferredFile;target.releaseFileRead();await target.fileRead;await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
  if(replacement==='manual-text'){await expect(raw).toHaveValue(latest);await expect(title).toHaveCount(0);await page.getByRole('button',{name:'整理需求',exact:true}).click();}
  await expect(title).toHaveValue('最新的需求');await expect(page.getByLabel('导入需求原文')).toHaveValue(latest);
  if(replacement==='other-tab'){await expect(page.getByText('已保存 1 个需求',{exact:true})).toBeVisible();await expect(title).toBeDisabled();await page.reload();await expect(title).toHaveValue('最新的需求');await expect(page.getByText('已保存 1 个需求',{exact:true})).toBeVisible();const items=await(await page.request.get('/api/requirements?projectId='+project.id)).json();expect(items).toHaveLength(1);expect(items[0].title).toBe('最新的需求');return;}
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.reload();await expect(title).toHaveValue('最新的需求');await page.getByRole('button',{name:'预览导入',exact:true}).click();await expect(page.getByRole('button',{name:'保存需求',exact:true})).toBeEnabled();
  expect(await(await page.request.get('/api/requirements?projectId='+project.id)).json()).toEqual([]);
});
