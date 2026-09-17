import {expect,test} from '@playwright/test';
import {phaseFixture} from './phase-fixture';
import type {Requirement} from '../../src/client/types';

test.use({actionTimeout:10_000});
for(const outcome of ['saved','retry','completed','reworked','legacy_changed'] as const)test('提测响应中断后恢复：'+outcome,async({page},info)=>{
  const f=await phaseFixture(page),id=f.direct.id,endpoint=f.base+'/requirements/'+id+'/test-submission';
  const read=async()=>await(await page.request.get('/api/requirements/'+id)).json() as Requirement;
  const post=async(url:string,data:object)=>{const response=await page.request.post(url,{data});expect(response.ok(),await response.text()).toBe(true);return response.json() as Promise<Requirement>;};
  const original=await read();let writes=0;
  await page.route('**'+endpoint,async route=>{writes++;if(outcome==='saved')await route.fetch();await route.abort('failed');});
  await page.goto('/requirements/'+id);await page.getByRole('button',{name:'记录提测',exact:true}).click();
  const form=page.getByRole('dialog',{name:'记录提测',exact:true});
  await form.getByRole('textbox',{name:'说明',exact:true}).fill('第一轮提测：保留核对说明');
  await form.getByRole('button',{name:'保存提测记录',exact:true}).click();
  await expect(form.getByRole('button',{name:'读取最新记录并核对',exact:true})).toBeVisible();
  await expect(form.getByRole('button',{name:'保存提测记录',exact:true})).toBeDisabled();
  await form.getByRole('button',{name:'关闭',exact:true}).last().click();
  let latest=await read();
  if(outcome!=='saved'&&outcome!=='retry'){
    expect(latest).toEqual(original);
    latest=await post('/api/requirements/'+id+'/complete',{expectedVersion:latest.version,content:'另一处完成了本轮工作'});
    if(outcome==='reworked'||outcome==='legacy_changed')latest=await post('/api/requirements/'+id+'/rework',{expectedVersion:latest.version,progress:40,reason:'开始新一轮工作'});
    latest=await read();
  }
  if(outcome==='legacy_changed')await page.evaluate(id=>{
    const key=Object.keys(sessionStorage).find(key=>key.startsWith('pm-test-submission:')&&key.endsWith(':'+id))!;
    const value=JSON.parse(sessionStorage.getItem(key)!);delete value.stageResetAt;sessionStorage.setItem(key,JSON.stringify(value));
  },id);
  await page.reload();await page.getByRole('button',{name:'核对提测记录',exact:true}).click();
  await expect(form.getByRole('textbox',{name:'说明',exact:true})).toHaveValue('第一轮提测：保留核对说明');
  await form.getByRole('button',{name:'读取最新记录并核对',exact:true}).click();
  if(outcome==='saved'){
    await expect(form).toHaveCount(0);expect((await read()).milestones?.filter(m=>m.milestoneKind==='test_submitted')).toHaveLength(1);
    await expect(page.getByRole('button',{name:'核对提测记录',exact:true})).toHaveCount(0);
  }else if(outcome==='retry'){
    await expect(form).toContainText('已核对当前记录');
    await expect(form.getByRole('textbox',{name:'说明',exact:true})).toHaveValue('第一轮提测：保留核对说明');
    expect(await read()).toEqual(original);
    await page.unroute('**'+endpoint);
    await form.getByRole('button',{name:'保存提测记录',exact:true}).click();await expect(form).toHaveCount(0);
    const saved=await read();expect(saved.version).toBe(original.version+1);expect(saved.milestones?.filter(m=>m.milestoneKind==='test_submitted')).toHaveLength(1);
  }else{
    await expect(form).toContainText(outcome==='legacy_changed'?'无法确认旧草稿对应的执行轮次':'已变化');
    await expect(form.getByRole('button',{name:'保存提测记录',exact:true})).toHaveCount(0);
    if(outcome==='reworked'){
      await page.setViewportSize({width:390,height:844});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      await page.screenshot({path:info.outputPath('submission-round-review-390.png'),animations:'disabled'});
    }
    await form.getByRole('button',{name:'已核对并关闭',exact:true}).click();await expect(form).toHaveCount(0);
    await page.reload();await expect(page.getByRole('button',{name:'核对提测记录',exact:true})).toHaveCount(0);
    expect(await read()).toEqual(latest);
    if(outcome==='reworked'||outcome==='legacy_changed'){
      await page.unroute('**'+endpoint);await page.getByRole('button',{name:'记录提测',exact:true}).click();
      await expect(form.getByRole('textbox',{name:'说明',exact:true})).toHaveValue('');
      await form.getByRole('textbox',{name:'说明',exact:true}).fill('新一轮提测');
      await form.getByRole('button',{name:'保存提测记录',exact:true}).click();await expect(form).toHaveCount(0);
      const saved=await read();expect(saved.milestones?.filter(m=>m.milestoneKind==='test_submitted')).toHaveLength(1);
      expect(saved).toMatchObject({version:latest.version+1,status:latest.status,progress:40,stageResetAt:latest.stageResetAt,actualStart:latest.actualStart,actualEnd:latest.actualEnd});
    }
  }
  expect(writes).toBe(1);
});
