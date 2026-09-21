import { expect, test, type Page } from '@playwright/test';
import { graphFixture } from './graph-fixture';
import { openGraph, graphToolbar, graphProperties } from './graph-interactions';
import { chooseOption, selectedValue } from './select-helper';
import type { Requirement } from '../../src/client/types';

const ready=async(page:Page)=>expect(page.locator('.dependency-canvas')).toHaveAttribute('data-layout-ready','true');

test('已开始工作调整依赖和撤销草稿时保留执行事实，并提示未满足的前置',async({page},info)=>{
  const {project,a,b,analysis}=await graphFixture(page,false),workId=b.workItems[0].id;
  const detail=async()=>await(await page.request.get('/api/requirements/'+b.id)).json() as Requirement;
  const write=async(method:'post'|'patch',url:string,data:unknown)=>{const response=await page.request[method](url,{data});expect(response.ok(),await response.text()).toBe(true);};
  await write('patch','/api/work-items/'+workId,{expectedVersion:b.workItems[0].version,ownerId:b.ownerId});
  await write('post','/api/work-items/'+workId+'/start',{expectedVersion:(await detail()).workItems[0].version});
  await write('post','/api/requirements/'+b.id+'/progress',{expectedVersion:(await detail()).workItems[0].version,workItemId:workId,workItemPercent:42,content:'原有执行进展'});
  const before=await detail(),formal=await analysis();
  const facts=(r:Requirement)=>r.workItems.map(w=>({id:w.id,status:w.status,progress:w.progress,actualStart:w.actualStart,actualEnd:w.actualEnd,ownerId:w.ownerId}));
  expect(before.workItems[0]).toMatchObject({status:'in_progress',progress:42});
  await openGraph(page,'/paths?pathScope=all');await ready(page);await graphToolbar(page,'编辑画布');
  await page.locator('.react-flow__node[data-id="'+a.id+'"] .business-handle[data-side="right"]').click();
  await page.locator('.react-flow__node[data-id="'+b.id+'"] .dependency-card').click({position:{x:80,y:45}});await ready(page);
  const edge=page.locator('.react-flow__edge[data-id="'+a.id+'>'+b.id+'"]');
  await edge.locator('.dependency-edge-label').click();
  await chooseOption(page.getByLabel('等待什么完成',{exact:true}),a.workItems[0].id);await ready(page);
  await page.locator('.delivery-target summary').click();
  await chooseOption(page.getByLabel('完成后允许什么开始',{exact:true}),workId);await ready(page);
  await graphToolbar(page,'撤销');await expect(selectedValue(page.getByLabel('完成后允许什么开始',{exact:true}))).toHaveValue('start:'+b.id);
  expect((await analysis()).dependencies).toEqual(formal.dependencies);expect(facts(await detail())).toEqual(facts(before));
  await graphToolbar(page,'重做');await expect(selectedValue(page.getByLabel('完成后允许什么开始',{exact:true}))).toHaveValue(workId);
  await graphToolbar(page,'保存修改');await expect(page.getByLabel('编辑画布',{exact:true})).toBeVisible();await ready(page);
  const saved=await detail(),result=await analysis();
  expect(facts(saved)).toEqual(facts(before));
  for(const event of before.progressUpdates||[])expect(saved.progressUpdates).toContainEqual(event);
  expect(result.dependencies.filter(d=>d.sourceRequirementId===a.id&&d.targetRequirementId===b.id)).toEqual([expect.objectContaining({sourceWorkItemId:a.workItems[0].id,targetWorkItemId:workId})]);
  expect(result.nodes.find(n=>n.id===workId)?.unknownReasons).toContain('已开始但前置条件尚未满足，请核对依赖');
  await openGraph(page,'/requirements/'+b.id+'?view=path');await ready(page);
  await graphProperties(page,page.locator('.react-flow__node[data-id="'+workId+'"] .dependency-card'));
  const warning=page.getByRole('tabpanel',{name:'概况',exact:true}).getByRole('alert');
  await expect(warning).toContainText('已开始但前置条件尚未满足，请核对依赖');
  await expect(warning).toBeVisible();
  await page.screenshot({path:info.outputPath('started-dependency-warning.png'),animations:'disabled'});
  for(const view of ['list','progress']){
    await page.goto('/?'+new URLSearchParams({projectId:project.id,workspaceView:view,scopeType:'requirement',scopeId:b.id,detailId:workId}));
    await expect(warning).toContainText('已开始但前置条件尚未满足，请核对依赖');
  }
  await page.setViewportSize({width:390,height:844});await expect(warning).toBeVisible();
  const box=(await warning.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);
  await page.screenshot({path:info.outputPath('started-dependency-narrow.png'),animations:'disabled'});
  const source=async()=>(await(await page.request.get('/api/requirements/'+a.id)).json()) as Requirement;
  await write('patch','/api/work-items/'+a.workItems[0].id,{expectedVersion:(await source()).workItems[0].version,ownerId:a.ownerId});
  await write('post','/api/work-items/'+a.workItems[0].id+'/start',{expectedVersion:(await source()).workItems[0].version});
  await write('post','/api/work-items/'+a.workItems[0].id+'/complete',{expectedVersion:(await source()).workItems[0].version,content:'前置当天完成'});
  expect((await analysis()).nodes.find(n=>n.id===workId)?.unknownReasons).not.toContain('已开始但前置条件尚未满足，请核对依赖');
  await page.reload();await expect(page.getByRole('tabpanel',{name:'概况',exact:true})).toBeVisible();await expect(warning).toHaveCount(0);
  expect(facts(await detail())).toEqual(facts(before));
});
