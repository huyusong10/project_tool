import {expect,test} from '@playwright/test';
import {phaseFixture} from './phase-fixture';
import {chooseOption} from './select-helper';
import type {Requirement} from '../../src/client/types';

test.use({actionTimeout:10_000});
test('连续纠错保留历史引用并在工作项记录中显示',async({page},info)=>{
  const f=await phaseFixture(page),workId=f.testing.workItems[1].id;
  const read=async()=>await(await page.request.get('/api/requirements/'+f.testing.id)).json() as Requirement;
  const notePrefix='已完成资产导入、字段映射和历史数据核对，本次记录对应的独立验证材料为：';
  for(let index=0;index<12;index++){
    const r=await read(),response=await page.request.post('/api/requirements/'+r.id+'/progress',{data:{workItemId:workId,expectedVersion:r.workItems.find(w=>w.id===workId)!.version,content:notePrefix+'核对标记'+String(index).padStart(2,'0')}});
    expect(response.ok(),await response.text()).toBe(true);
  }
  const before=await read(),work=before.workItems.find(w=>w.id===workId)!;
  const original=before.progressUpdates!.find(u=>u.workItemId===workId&&u.content===notePrefix+'核对标记00')!;
  let source=original.id;
  await page.goto('/requirements/'+f.testing.id+'?workItemId='+workId);
  const detail=page.locator('.modal-card-workspace[role=dialog]');
  const reasons=['首次核对：补充原记录的验证范围','再次核对：保留补充说明并明确验收样本'];
  for(const reason of reasons){
    await detail.getByRole('button',{name:'修正实际日期',exact:true}).click();
    const form=page.getByRole('dialog',{name:'修正实际日期',exact:true});
    if(source===original.id)for(const width of [1280,390]){
      await page.setViewportSize({width,height:844});
      await form.getByRole('combobox',{name:'工作项纠错关联历史记录',exact:true}).click();
      const search=page.getByRole('textbox',{name:'搜索工作项纠错关联历史记录',exact:true});
      await search.fill('核对标记00');
      const options=page.getByRole('listbox',{name:'工作项纠错关联历史记录',exact:true}).getByRole('option');
      const option=options.filter({hasText:original.content});
      await expect(option).toBeVisible();await expect(options).toHaveCount(1);
      expect(await option.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
      await page.screenshot({path:info.outputPath('correction-source-'+width+'.png'),animations:'disabled'});
      await search.press('Escape');
    }
    await chooseOption(form.getByRole('combobox',{name:'工作项纠错关联历史记录',exact:true}),source);
    await form.getByRole('textbox',{name:'纠错原因',exact:true}).fill(reason);
    await form.getByRole('button',{name:'保存纠错',exact:true}).click();await expect(form).toHaveCount(0);
    const current=await read(),correction=current.progressUpdates!.find(u=>u.workItemId===workId&&u.content===reason)!;
    expect(correction).toMatchObject({eventType:'correction',supersedesId:source,workItemPercent:70});
    source=correction.id;
  }
  const after=await read();
  expect(after.progressUpdates).toHaveLength(before.progressUpdates!.length+2);
  expect(after.progressUpdates).toEqual(expect.arrayContaining(before.progressUpdates!));
  expect(after.workItems.find(w=>w.id===workId)).toMatchObject({status:work.status,progress:work.progress,actualStart:work.actualStart,actualEnd:work.actualEnd,plannedStart:work.plannedStart,plannedEnd:work.plannedEnd,ownerId:work.ownerId,collaborators:work.collaborators});
  await detail.getByRole('tab',{name:'记录',exact:true}).click();
  const first=detail.locator('.work-history-entry').filter({hasText:reasons[0]}),second=detail.locator('.work-history-entry').filter({hasText:reasons[1]});
  await expect(first.locator('.progress-correction-reference')).toContainText('说明');
  await expect(second.locator('.progress-correction-reference')).toContainText('纠错');
  await expect(detail).not.toContainText('原记录不可用');
  for(const width of [1280,390]){
    await page.setViewportSize({width,height:844});
    expect(await detail.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await page.screenshot({path:info.outputPath('correction-chain-'+width+'.png'),animations:'disabled'});
  }
  await page.reload();await expect(detail.locator('.work-history-entry')).toHaveCount(10);
  const pager=detail.getByRole('navigation',{name:'工作项记录分页'});
  await pager.getByRole('button',{name:'下一页',exact:true}).click();
  await expect(detail.locator('.work-history-entry').filter({hasText:original.content})).toBeVisible();
});
