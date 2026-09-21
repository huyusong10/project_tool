import {expect,test,type Page} from '@playwright/test';
import {phaseFixture} from './phase-fixture';
import {featureAssessmentLabels,type Feature} from '../../src/shared/intake';
import type {Requirement} from '../../src/client/types';

async function fixture(page:Page){
  const f=await phaseFixture(page),endpoint=f.base+'/features';
  const read=async()=>((await(await page.request.get(endpoint)).json()) as Feature[]).find(feature=>feature.id===f.feature.id)!;
  const update=async(patch:Partial<Feature>)=>{const current=await read();const response=await page.request.post(endpoint,{data:{id:current.id,expectedVersion:current.version,name:current.name,...patch}});expect(response.ok(),await response.text()).toBe(true);return read();};
  const facts=async()=>Promise.all([f.testing,f.direct].map(async requirement=>{
    const r=await(await page.request.get('/api/requirements/'+requirement.id)).json() as Requirement;
    return {status:r.status,progress:r.progress,actualStart:r.actualStart,actualEnd:r.actualEnd,version:r.version,progressUpdates:r.progressUpdates,workItems:r.workItems.map(w=>({...w,deliveryForecast:{...w.deliveryForecast,revision:undefined}}))};
  }));
  const open=()=>page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'list',scopeType:'project',detailId:'feature:'+f.feature.id}));
  return {...f,endpoint,read,update,facts,open};
}

test('特性资料连续冲突后只保存本地改动，重读和刷新保留远端字段',async({page})=>{
  const f=await fixture(page),before=await f.facts();
  const phasesBefore=await(await page.request.get(f.base+'/feature-phases')).json();
  await f.open();await page.getByRole('button',{name:'编辑特性',exact:true}).click();
  const edit=page.getByRole('dialog',{name:'编辑特性',exact:true});
  await edit.getByRole('textbox',{name:'特性名称',exact:true}).fill('本地确认的新名称');
  let latest:Feature;
  for(const round of [1,2]){
    latest=await f.update({name:'另一处的名称 '+round,description:round===1?'另一处的新范围':'',referenceLinks:round===1?[{title:'范围原文',url:'https://example.com/changed-scope'}]:[]});
    const response=page.waitForResponse(r=>new URL(r.url()).pathname===f.endpoint&&r.request().method()==='POST');
    await edit.getByRole('button',{name:'编辑特性',exact:true}).click();expect((await response).status()).toBe(409);
    await expect(edit.getByRole('button',{name:'编辑特性',exact:true})).toBeDisabled();expect(await f.read()).toEqual(latest);
    await edit.getByRole('button',{name:'保留输入，按最新资料继续',exact:true}).click();
    await expect(edit.getByRole('heading',{name:'服务器上的最新资料'})).toHaveCount(0);
    expect.soft(await edit.getByRole('textbox',{name:'长期目标与范围',exact:true}).inputValue()).toBe(latest.description);
    expect.soft(await edit.getByRole('textbox',{name:/^链接 \d+ 地址$/}).evaluateAll(inputs=>inputs.map(input=>(input as HTMLInputElement).value))).toEqual(latest.referenceLinks?.map(link=>link.url));
    await expect(edit.getByRole('textbox',{name:'特性名称',exact:true})).toHaveValue('本地确认的新名称');
    if(round===1){
      await edit.locator('header').first().getByRole('button',{name:'关闭',exact:true}).click();await page.reload();
      await page.getByRole('button',{name:'编辑特性',exact:true}).click();
      await expect(edit.getByRole('textbox',{name:'特性名称',exact:true})).toHaveValue('本地确认的新名称');
      expect.soft(await edit.getByRole('textbox',{name:'长期目标与范围',exact:true}).inputValue()).toBe(latest.description);
    }
  }
  await edit.getByRole('button',{name:'编辑特性',exact:true}).click();await expect(edit).toHaveCount(0);
  expect.soft(await f.read()).toEqual({...latest!,name:'本地确认的新名称',version:latest!.version+1});
  expect(await f.facts()).toEqual(before);
  expect(await(await page.request.get(f.base+'/feature-phases')).json()).toEqual(phasesBefore);
});

test('特性评估冲突按字段保留本地说明和远端判断，远端清空也能保留',async({page})=>{
  const f=await fixture(page);
  await f.update({overview:{expectation:'原有预期',progressSummary:'原有进展',assessment:'on_track',note:'原有说明'}});
  const before=await f.facts();await f.open();
  await page.getByRole('button',{name:'更新评估',exact:true}).click();
  const edit=page.getByRole('dialog',{name:'评估特性',exact:true});
  await edit.getByRole('textbox',{name:'原因或变化说明',exact:true}).fill('本地补充的原因');
  let latest:Feature;
  for(const round of [1,2]){
    latest=await f.update({name:'远端更新名称 '+round,overview:{expectation:round===1?'远端的新预期':'',progressSummary:'远端进展 '+round,assessment:round===1?'off_track':'needs_adjustment',note:'另一人的说明 '+round}});
    const response=page.waitForResponse(r=>new URL(r.url()).pathname===f.endpoint&&r.request().method()==='POST');
    await edit.getByRole('button',{name:'保存评估',exact:true}).click();expect((await response).status()).toBe(409);
    await expect(edit.getByRole('button',{name:'保存评估',exact:true})).toBeDisabled();expect(await f.read()).toEqual(latest);
    await edit.getByRole('button',{name:'保留输入，按最新资料继续',exact:true}).click();
    await expect(edit.getByRole('heading',{name:'服务器上的最新资料'})).toHaveCount(0);
    expect.soft(await edit.getByRole('textbox',{name:'大致预期',exact:true}).inputValue()).toBe(latest.overview.expectation);
    expect.soft(await edit.getByRole('textbox',{name:'进展简述',exact:true}).inputValue()).toBe(latest.overview.progressSummary);
    expect.soft((await edit.getByLabel('判断',{exact:true}).textContent())?.trim()).toBe(featureAssessmentLabels[latest.overview.assessment]);
    await expect(edit.getByRole('textbox',{name:'原因或变化说明',exact:true})).toHaveValue('本地补充的原因');
  }
  await edit.getByRole('button',{name:'保存评估',exact:true}).click();await expect(edit).toHaveCount(0);
  const saved=await f.read();
  expect.soft(saved.overview).toEqual({...latest!.overview,note:'本地补充的原因'});
  expect(saved).toMatchObject({name:latest!.name,description:latest!.description,referenceLinks:latest!.referenceLinks,sortOrder:latest!.sortOrder,version:latest!.version+1});
  expect(await f.facts()).toEqual(before);
});

test('特性写入响应丢失核对成功后清除已保存草稿，再编辑读取当前资料',async({page})=>{
  const f=await fixture(page),before=await f.facts();await f.open();
  await page.getByRole('button',{name:'更新评估',exact:true}).click();
  const edit=page.getByRole('dialog',{name:'评估特性',exact:true});
  await edit.getByRole('textbox',{name:'大致预期',exact:true}).fill('本次已保存预期');
  await edit.getByRole('textbox',{name:'原因或变化说明',exact:true}).fill('本次已保存说明');
  let writes=0;
  await page.route('**'+f.endpoint,async route=>{if(route.request().method()==='POST'){writes++;if(writes===1){await route.fetch();await route.abort('connectionfailed');return;}}await route.continue();});
  await edit.getByRole('button',{name:'保存评估',exact:true}).click();
  await expect(edit.getByRole('button',{name:'读取最新资料',exact:true})).toBeVisible();await page.reload();
  await expect(edit.getByRole('textbox',{name:'原因或变化说明',exact:true})).toHaveValue('本次已保存说明');
  await edit.getByRole('button',{name:'读取最新资料',exact:true}).click();
  await edit.getByRole('button',{name:'已核对，操作已生效',exact:true}).click();await expect(edit).toHaveCount(0);expect(writes).toBe(1);
  const latest=await f.update({overview:{expectation:'后续的新预期',progressSummary:'后续的新进展',assessment:'off_track',note:'后续的新说明'}});
  await page.reload();await page.getByRole('button',{name:'更新评估',exact:true}).click();
  expect.soft(await edit.getByRole('textbox',{name:'大致预期',exact:true}).inputValue()).toBe(latest.overview.expectation);
  expect.soft(await edit.getByRole('textbox',{name:'原因或变化说明',exact:true}).inputValue()).toBe(latest.overview.note);
  expect(await f.read()).toEqual(latest);expect(await f.facts()).toEqual(before);expect(writes).toBe(1);
  await edit.getByRole('textbox',{name:'原因或变化说明',exact:true}).fill('下一次本地说明');
  const response=page.waitForResponse(r=>new URL(r.url()).pathname===f.endpoint&&r.request().method()==='POST');
  await edit.getByRole('button',{name:'保存评估',exact:true}).click();expect((await response).status()).toBe(200);await expect(edit).toHaveCount(0);
  expect((await f.read()).overview).toEqual({...latest.overview,note:'下一次本地说明'});expect(writes).toBe(2);expect(await f.facts()).toEqual(before);
});
