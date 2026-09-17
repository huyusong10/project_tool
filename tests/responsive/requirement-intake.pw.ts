import {chooseOption} from './select-helper';
import {expect,test,type Page} from '@playwright/test';
import {intakeExample} from '../../src/shared/intake';
import {readFile} from 'node:fs/promises';

async function fixture(page:Page) {
  const login=await page.request.post('/api/login',{data:{username:'admin',password:'41_xc7q0qOjo4Inw!'}});expect(login.ok()).toBe(true);
  const session=await login.json();
  const response=await page.request.post('/api/projects',{data:{name:'需求导入 '+Date.now()}});expect(response.ok()).toBe(true);const project=await response.json();
  await page.addInitScript(({accountId,projectId})=>localStorage.setItem('project-manage:selected-project:'+accountId,projectId),{accountId:session.accountId,projectId:project.id});
  await page.goto('/requirements?intakeView=import');
  await page.getByLabel('原始需求',{exact:true}).fill(JSON.stringify(intakeExample));await page.getByRole('button',{name:'整理需求',exact:true}).click();
  await expect(page.getByLabel('导入需求标题')).toHaveValue('查询与详情');return project.id as string;
}
async function returnToList(page:Page){
  await page.getByRole('button',{name:'返回工作区',exact:true}).click();
  await page.getByRole('button',{name:'展开全部',exact:true}).click();
}
async function createFeature(page:Page){
  await page.getByRole('button',{name:'新建对象',exact:true}).click();
  await page.getByRole('button',{name:'新建特性',exact:true}).click();
  return page.getByRole('dialog',{name:'新建特性',exact:true});
}
async function openPlacement(page:Page){
  await page.getByRole('checkbox',{name:'选择查询与详情',exact:true}).check();
  await page.getByRole('button',{name:'调整归属…',exact:true}).click();
  return page.getByRole('dialog',{name:'调整 1 条需求归属',exact:true});
}
async function saveImport(page:Page) {
  await page.getByRole('button',{name:'预览导入',exact:true}).click();
  await page.getByRole('button',{name:'保存需求',exact:true}).click();
  await expect(page.getByText('已保存 1 个需求',{exact:true})).toBeVisible();
}

test('导出草稿保留未整理的最新输入，存储失败仍能备份并重新上传',async({page})=>{
  await fixture(page);
  const blockStorage=()=>{
    const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(key.startsWith('pm-intake:'))throw new DOMException('配额不足','QuotaExceededError');return original.call(this,key,value);};
  };
  await page.addInitScript(blockStorage);
  await page.evaluate(blockStorage);
  await page.getByRole('button',{name:'编辑导入文件',exact:true}).click();
  const edited='导入备份核对\n保留尚未整理的修改。\n\n另一条需求\n第二段原文。';
  await page.getByLabel('原始需求',{exact:true}).fill(edited);
  await expect(page.locator('.warning-banner')).toContainText('本机草稿保存失败');
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'导出草稿',exact:true}).click();
  const download=await downloadPromise;
  expect(await download.failure()).toBeNull();
  const path=(await download.path())!;
  expect(await readFile(path,'utf8')).toBe(edited);
  await page.getByLabel('上传文本、Markdown 或工具 JSON').setInputFiles({name:download.suggestedFilename(),mimeType:'text/plain',buffer:await readFile(path)});
  await expect(page.getByLabel('导入需求标题')).toHaveCount(2);
  await expect(page.getByLabel('导入需求标题').first()).toHaveValue('导入备份核对');
  await expect(page.getByLabel('导入需求标题').last()).toHaveValue('另一条需求');
  await page.reload();
  await page.evaluate(()=>{for(const key of Object.keys(localStorage))if(key.startsWith('pm-intake:'))localStorage.removeItem(key);});
  await page.reload();
  await page.getByLabel('原始需求',{exact:true}).fill('新的一条需求\n没有整理也可备份。');
  const rawDownloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'导出草稿',exact:true}).click();
  const rawDownload=await rawDownloadPromise;
  expect(await readFile((await rawDownload.path())!,'utf8')).toBe('新的一条需求\n没有整理也可备份。');
  await page.getByRole('button',{name:'整理需求',exact:true}).click();
  await page.getByLabel('导入需求标题').fill('整理后的草稿');
  const structuredPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'导出草稿',exact:true}).click();
  const structured=await structuredPromise;
  expect(structured.suggestedFilename()).toBe('requirement-import-draft.json');
  expect(JSON.parse(await readFile((await structured.path())!,'utf8')).requirements[0]).toMatchObject({title:'整理后的草稿',background:'新的一条需求\n没有整理也可备份。'});
  await page.getByRole('button',{name:'编辑导入文件',exact:true}).click();
  await page.getByLabel('上传文本、Markdown 或工具 JSON').setInputFiles({name:structured.suggestedFilename(),mimeType:'application/json',buffer:await readFile((await structured.path())!)});
  await expect(page.getByLabel('导入需求标题')).toHaveValue('整理后的草稿');
  const examplePromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'下载工具示例',exact:true}).click();
  const example=await examplePromise;
  expect(JSON.parse(await readFile((await example.path())!,'utf8'))).toEqual(intakeExample);
});

test('原文编辑刷新恢复最后输入，整理前不能预览旧内容',async({page})=>{
  await fixture(page);
  await page.getByRole('button',{name:'编辑导入文件',exact:true}).click();
  const raw='刷新恢复的需求\n这里是未整理的新内容。';
  await page.getByLabel('原始需求',{exact:true}).fill(raw);
  await page.reload();
  await expect(page.getByLabel('原始需求',{exact:true})).toBeVisible();
  await expect(page.getByLabel('原始需求',{exact:true})).toHaveValue(raw);
  await expect(page.getByRole('button',{name:'预览导入',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'保存需求',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'整理需求',exact:true}).click();
  await expect(page.getByLabel('导入需求标题')).toHaveValue('刷新恢复的需求');
  await page.reload();
  await expect(page.getByLabel('原始需求',{exact:true})).toHaveCount(0);
  await expect(page.getByLabel('导入需求标题')).toHaveValue('刷新恢复的需求');
  await saveImport(page);
});

test('原文首行截成标题时不拆开边界字符，保存后原文保持完整',async({page})=>{
  await fixture(page);
  const samples=[
    {line:'A'.repeat(199)+'🧪补充',title:'A'.repeat(199)},
    {line:'界'.repeat(198)+'𠮷补充',title:'界'.repeat(198)+'𠮷'},
    {line:'B'.repeat(200)+'后续',title:'B'.repeat(200)},
  ].map((sample,index)=>({...sample,background:sample.line+'\n保留完整说明 '+index}));
  await page.getByRole('button',{name:'编辑导入文件',exact:true}).click();
  await page.getByLabel('原始需求',{exact:true}).fill(samples.map(s=>s.background).join('\n\n'));
  await page.getByRole('button',{name:'整理需求',exact:true}).click();
  await expect.soft(page.getByLabel('导入需求标题')).toHaveCount(samples.length);
  expect.soft(await page.getByLabel('导入需求标题').evaluateAll(inputs=>inputs.map(input=>(input as HTMLInputElement).value))).toEqual(samples.map(s=>s.title));
  await page.getByRole('button',{name:'预览导入',exact:true}).click();
  const applied=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/requirement-import/apply'));
  await page.getByRole('button',{name:'保存需求',exact:true}).click();
  const response=await applied;expect(response.status()).toBe(200);const receipt=await response.json();
  await expect(page.getByText('已保存 3 个需求',{exact:true})).toBeVisible();
  const saved=await Promise.all(Object.values(receipt.requirementIds as Record<string,string>).map(async id=>(await page.request.get('/api/requirements/'+id)).json()));
  for(const sample of samples){const actual=saved.find(r=>r.background===sample.background);expect(actual).toBeDefined();expect.soft(actual.title).toBe(sample.title);}
});

test('按页面名称导入到其他需求，预览后保存并进入新需求',async({page})=>{
  const projectId=await fixture(page);
  await page.getByLabel('特性',{exact:true}).fill('其他需求');
  await page.getByLabel('Phase（可选）',{exact:true}).fill('');
  await saveImport(page);
  const result=page.locator('.intake-preview-result').filter({hasText:'已保存 1 个需求'});
  await result.getByRole('link',{name:'查询与详情',exact:true}).click();
  await expect(page.getByRole('heading',{name:'查询与详情',exact:true})).toBeVisible();
  const requirements=await(await page.request.get('/api/requirements?projectId='+projectId)).json();
  expect(requirements).toHaveLength(1);
  expect(requirements[0]).toMatchObject({featureName:'其他需求',phaseId:null});
});

test('导入可拆分合并，保存后按特性和 Phase 展开并进入详情',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const id=await fixture(page);
 await expect(page.getByText('标签',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'拆分需求',exact:true}).click();await expect(page.getByLabel('导入需求标题')).toHaveCount(2);
 await chooseOption(page.getByLabel('合并需求到').last(),{label:'查询与详情'});await expect(page.getByLabel('导入需求标题')).toHaveCount(1);
 await page.getByLabel('导入需求标题').fill('查询需求浏览器验证');await saveImport(page);await returnToList(page);
 await expect(page.locator('.outline-table')).toContainText('示例模块');
 await expect(page.locator('.outline-title',{hasText:'查询需求浏览器验证'})).toBeVisible();
 const requirements=await(await page.request.get('/api/requirements?projectId='+id)).json();
 expect(requirements).toHaveLength(1);expect(requirements[0].workItems).toHaveLength(2);expect(requirements[0]).not.toHaveProperty('tags');
 await page.goto('/requirements?tag=obsolete&grouped=1');await expect(page.locator('.outline-title',{hasText:'查询需求浏览器验证'})).toBeVisible();
 await page.getByRole('button',{name:'新建对象',exact:true}).click();await page.getByRole('button',{name:'新建需求',exact:true}).click();
 await expect(page.getByLabel('需求特性')).toBeVisible();await expect(page.getByLabel('需求标签')).toHaveCount(0);await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
 await page.goto('/requirements/'+requirements[0].id);await expect(page.getByRole('heading',{name:'查询需求浏览器验证',exact:true})).toBeVisible();
 await expect(page.locator('.requirement-overview')).toBeVisible();expect(errors).toEqual([]);
});

test('预览失败保留调整，未知提交刷新后查询原回执且不重复创建',async({page})=>{
  const id=await fixture(page),url='**/api/projects/'+id+'/requirement-import/preview';
  await page.getByLabel('导入需求标题').fill('保留导入输入');
  await page.route(url,route=>route.fulfill({status:503,json:{error:'服务暂时不可用'}}));
  await page.getByRole('button',{name:'预览导入',exact:true}).click();await expect(page.getByRole('alert')).toContainText('服务暂时不可用');await expect(page.getByLabel('导入需求标题')).toHaveValue('保留导入输入');
  await page.unroute(url);await page.getByRole('button',{name:'预览导入',exact:true}).click();await expect(page.getByRole('button',{name:'保存需求',exact:true})).toBeEnabled();
  let writes=0;await page.route('**/api/projects/'+id+'/requirement-import/apply',async route=>{writes++;await route.fetch();await route.fulfill({status:200,contentType:'text/html',body:'invalid response'});});
  await page.getByRole('button',{name:'保存需求',exact:true}).click();await expect(page.getByRole('button',{name:'查询提交回执'})).toBeVisible();
  await page.reload();await page.getByRole('button',{name:'查询提交回执'}).click();await expect(page.getByText('已保存 1 个需求',{exact:true})).toBeVisible();expect(writes).toBe(1);
  expect((await(await page.request.get('/api/requirements?projectId='+id)).json()).length).toBe(1);
});

test('需求导入待核对后，已打开标签复用原批次',async({page,context})=>{
  const id=await fixture(page);await page.getByRole('button',{name:'预览导入',exact:true}).click();await expect(page.getByRole('button',{name:'保存需求',exact:true})).toBeEnabled();
  const tab=await context.newPage();await tab.goto('/requirements?intakeView=import');await expect(tab.getByLabel('导入需求标题')).toHaveValue('查询与详情');await tab.getByRole('button',{name:'预览导入',exact:true}).click();await expect(tab.getByRole('button',{name:'保存需求',exact:true})).toBeEnabled();
  let originalBatch='';await page.route('**/api/projects/'+id+'/requirement-import/apply',async route=>{originalBatch=route.request().postDataJSON().batchId;await route.abort('connectionfailed');});
  await page.getByRole('button',{name:'保存需求',exact:true}).click();await expect.poll(()=>originalBatch).not.toBe('');await expect(page.getByRole('button',{name:'查询提交回执',exact:true})).toBeVisible();
  await expect(tab.getByRole('button',{name:'查询提交回执',exact:true})).toBeVisible();let resumedBatch='';await tab.route('**/api/projects/'+id+'/requirement-import/apply',async route=>{resumedBatch=route.request().postDataJSON().batchId;await route.abort('connectionfailed');});
  await tab.getByRole('button',{name:'按原批次重试',exact:true}).click();await expect.poll(()=>resumedBatch).not.toBe('');expect(resumedBatch).toBe(originalBatch);await tab.close();
});

test('需求导入原批次在另一标签完成后，当前页退出待核对状态',async({page,context})=>{
  const id=await fixture(page);await page.getByRole('button',{name:'预览导入',exact:true}).click();await expect(page.getByRole('button',{name:'保存需求',exact:true})).toBeEnabled();
  const tab=await context.newPage();await tab.goto('/requirements?intakeView=import');await expect(tab.getByLabel('导入需求标题')).toHaveValue('查询与详情');
  const endpoint='**/api/projects/'+id+'/requirement-import/apply';await page.route(endpoint,route=>route.abort('connectionfailed'));
  await page.getByRole('button',{name:'保存需求',exact:true}).click();await expect(page.getByRole('button',{name:'查询提交回执',exact:true})).toBeVisible();await expect(tab.getByRole('button',{name:'查询提交回执',exact:true})).toBeVisible();
  await page.evaluate(id=>{const key=Object.keys(localStorage).find(value=>value.startsWith('pm-intake:')&&value.endsWith(':'+id))!,saved=JSON.parse(localStorage.getItem(key)!);localStorage.setItem(key,JSON.stringify({...saved,attempt:null,closedBatchId:null}));},id);await expect(tab.getByRole('button',{name:'查询提交回执',exact:true})).toBeVisible();
  await page.unroute(endpoint);await page.getByRole('button',{name:'按原批次重试',exact:true}).click();await expect(page.getByText('已保存 1 个需求',{exact:true})).toBeVisible();
  await expect(tab.getByRole('button',{name:'查询提交回执',exact:true})).toHaveCount(0);await expect(tab.getByRole('alert')).toContainText('原待核对批次已在其他页面处理');
  expect((await(await page.request.get('/api/requirements?projectId='+id)).json()).length).toBe(1);await tab.close();
});

test('需求导入跨页通知延迟时，保存前读取原批次',async({page,context})=>{
  const id=await fixture(page);await page.getByRole('button',{name:'预览导入',exact:true}).click();await expect(page.getByRole('button',{name:'保存需求',exact:true})).toBeEnabled();
  const tab=await context.newPage();await tab.addInitScript(()=>{const target=window as unknown as {addEventListener:(...args:unknown[])=>void},add=target.addEventListener.bind(window);target.addEventListener=(...args:unknown[])=>{if(args[0]!=='storage')add(...args);};});await tab.goto('/requirements?intakeView=import');await expect(tab.getByLabel('导入需求标题')).toHaveValue('查询与详情');await tab.getByRole('button',{name:'预览导入',exact:true}).click();await expect(tab.getByRole('button',{name:'保存需求',exact:true})).toBeEnabled();
  let originalBatch='';await page.route('**/api/projects/'+id+'/requirement-import/apply',async route=>{originalBatch=route.request().postDataJSON().batchId;await route.abort('connectionfailed');});
  await page.getByRole('button',{name:'保存需求',exact:true}).click();await expect.poll(()=>originalBatch).not.toBe('');await expect(page.getByRole('button',{name:'查询提交回执',exact:true})).toBeVisible();
  const retried:string[]=[];await tab.route('**/api/projects/'+id+'/requirement-import/apply',async route=>{retried.push(route.request().postDataJSON().batchId);await route.abort('connectionfailed');});
  await tab.getByRole('button',{name:'保存需求',exact:true}).click();await expect(tab.getByRole('button',{name:'查询提交回执',exact:true})).toBeVisible();expect(retried).toEqual([]);
  await tab.getByRole('button',{name:'按原批次重试',exact:true}).click();await expect.poll(()=>retried.length).toBe(1);expect(retried).toEqual([originalBatch]);await tab.close();
});

test('特性和需求归属表单在矩阵与窄屏中可操作且不横向溢出',{tag:'@responsive'},async({page},info)=>{
 const id=await fixture(page);await saveImport(page);await returnToList(page);
 for(const viewport of [page.viewportSize()!,{width:390,height:844}]){
  await page.setViewportSize(viewport);const feature=await createFeature(page);
  await feature.getByLabel('特性名称').fill('布局输入');await feature.getByLabel('长期目标与范围').fill('长期目标与范围'.repeat(30));
  const box=(await feature.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(viewport.width+1);
  await feature.getByRole('button',{name:'关闭',exact:true}).last().click();
  const dialog=await openPlacement(page);await chooseOption(dialog.getByLabel('需求特性'),{label:'示例模块'});
  await expect(dialog.getByRole('button',{name:'确认移动',exact:true})).toBeEnabled();
  const bounds=(await dialog.boundingBox())!;expect(bounds.y+bounds.height).toBeLessThanOrEqual(viewport.height+1);
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  await page.screenshot({path:info.outputPath('placement-'+viewport.width+'.png')});await dialog.getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('checkbox',{name:'选择查询与详情',exact:true}).uncheck();
 }
 expect(await(await page.request.get('/api/projects/'+id+'/requirement-intake')).json()).not.toHaveProperty('tags');
});

test('新建特性响应未知且核对读取失败时阻止重复创建',async({page})=>{
 const id=await fixture(page);await saveImport(page);await returnToList(page);let writes=0,failReads=false;
 const endpoint='**/api/projects/'+id+'/features*';
 await page.route(endpoint,async route=>{
  if(route.request().method()==='POST'){writes++;await route.fetch();failReads=true;return route.fulfill({status:200,contentType:'text/html',body:'invalid response'});}
  if(failReads)return route.fulfill({status:503,json:{error:'核对读取失败'}});return route.continue();
 });
 const dialog=await createFeature(page);await dialog.getByLabel('特性名称').fill('响应未知特性');await dialog.getByRole('button',{name:'新建特性',exact:true}).click();
 await expect(dialog).toContainText('提交结果待核对');await expect(dialog.getByRole('button',{name:'新建特性',exact:true})).toBeDisabled();
 await dialog.locator('form').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));expect(writes).toBe(1);
 await dialog.getByRole('button',{name:'读取最新资料',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('核对读取失败');
 await dialog.getByRole('button',{name:'关闭',exact:true}).last().click();await page.goto('/issues');await page.goto('/requirements');
 await expect(dialog.getByLabel('特性名称')).toHaveValue('响应未知特性');await expect(dialog.getByRole('button',{name:'新建特性',exact:true})).toBeDisabled();
 failReads=false;await dialog.getByRole('button',{name:'读取最新资料',exact:true}).click();await dialog.getByRole('button',{name:'已核对，操作已生效',exact:true}).click();await expect(dialog).toHaveCount(0);expect(writes).toBe(1);
 expect((await(await page.request.get('/api/projects/'+id+'/features')).json()).filter((f:{name:string})=>f.name==='响应未知特性')).toHaveLength(1);
});

test('批量整理响应未知且核对读取失败时阻止重复写入',async({page})=>{
 const id=await fixture(page);await saveImport(page);
 const catalog=await(await page.request.post('/api/projects/'+id+'/features',{data:{name:'待整理特性',sortOrder:0}})).json();
 const feature=catalog.features.find((f:{name:string})=>f.name==='待整理特性');
 await returnToList(page);await page.reload();await expect(page.getByRole('checkbox',{name:'选择查询与详情',exact:true})).toBeVisible();
 const dialog=await openPlacement(page);await chooseOption(dialog.getByLabel('需求特性'),feature.id);
 let writes=0,failReads=false;await page.route('**/api/projects/'+id+'/requirement-placement',async route=>{writes++;await route.fetch();failReads=true;await route.fulfill({status:200,contentType:'text/html',body:'invalid response'});});
 await page.route('**/api/dashboard?**',route=>failReads?route.fulfill({status:503,json:{error:'核对读取失败'}}):route.continue());
 await dialog.getByRole('button',{name:'确认移动',exact:true}).click();await expect(dialog.getByRole('button',{name:'确认移动',exact:true})).toBeDisabled();
 await dialog.getByRole('button',{name:'读取正式结果并核对',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('核对读取失败');
 await dialog.getByRole('button',{name:'取消',exact:true}).click();await page.goto('/issues');await page.goto('/requirements');
 await expect(page.getByText('核对读取失败',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'新建对象',exact:true})).toHaveCount(0);expect(writes).toBe(1);
 failReads=false;await page.getByRole('button',{name:'重新读取',exact:true}).click();
 await expect(page.locator('.outline-notice')).toContainText('提交结果待核对');expect(writes).toBe(1);
 await page.getByRole('button',{name:'读取正式结果并核对',exact:true}).click();
 const review=page.getByRole('dialog',{name:'核对正式结果',exact:true});await review.getByText('原提交内容 · 移动需求',{exact:true}).click();await expect(review.locator('pre')).toContainText(feature.id);
 await expect(review.locator('tbody')).toContainText('待整理特性');await review.getByRole('button',{name:'确认已生效，结束核对',exact:true}).click();await expect(review).toHaveCount(0);expect(writes).toBe(1);
 const requirements=await(await page.request.get('/api/requirements?projectId='+id)).json();expect(requirements[0].featureId).toBe(feature.id);
});

test('含旧标签的本机草稿保留原始文本，便于修正后继续导入',async({page})=>{
  const id=await fixture(page);
  const pkg={...intakeExample,requirements:intakeExample.requirements.map(r=>({...r,tags:['旧标签']}))},raw=JSON.stringify(pkg);
  await page.evaluate(({id,pkg,raw})=>{
    const key=Object.keys(localStorage).find(k=>k.startsWith('pm-intake:')&&k.endsWith(':'+id))!;
    localStorage.setItem(key,JSON.stringify({raw,pkg,attempt:null}));
  },{id,pkg,raw});
  await page.reload();await expect(page.getByLabel('原始需求',{exact:true})).toHaveValue(raw);
  await page.getByLabel('原始需求',{exact:true}).fill(JSON.stringify(intakeExample));
  await page.getByRole('button',{name:'整理需求',exact:true}).click();await expect(page.getByLabel('导入需求标题')).toHaveValue('查询与详情');
});
