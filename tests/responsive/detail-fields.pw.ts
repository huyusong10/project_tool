import {expect,test} from '@playwright/test';
import {phaseFixture} from './phase-fixture';
import {addBusinessDays,todayIso} from '../../src/shared/domain';

test('工作项人员、协作人、日期和阶段可编辑，保存时锁定详情导航',async({page})=>{
  const f=await phaseFixture(page),work=f.testing.workItems[1];const response=await page.request.post('/api/people',{data:{projectId:f.projectId,name:'详情字段负责人 '+Date.now()}});expect(response.ok()).toBe(true);const person=await response.json();
  const current=async()=>{const r=await(await page.request.get('/api/requirements/'+f.testing.id)).json();return r.workItems.find((w:{id:string})=>w.id===work.id);};
  await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'list',scopeType:'project',detailId:f.testing.id,detailTab:'work'}));const root=page.locator('.modal-card-workspace[role=dialog]'),row=root.locator('[data-work-id="'+work.id+'"]');
  let release=()=>{},started=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;}),requestStarted=new Promise<void>(resolve=>{started=resolve;});const endpoint='**/api/work-items/'+work.id;
  await page.route(endpoint,async route=>{if(route.request().method()!=='PATCH')return route.continue();started();await gate;await route.continue();});await row.getByRole('button',{name:/^主负责人：/}).click();await root.getByRole('option',{name:new RegExp(person.name)}).click();await requestStarted;
  await expect(root.locator(':scope > header').getByRole('button',{name:'关闭',exact:true})).toBeDisabled();await expect(root.getByRole('tab',{name:'资料',exact:true})).toBeDisabled();release();await expect.poll(async()=>(await current()).ownerId).toBe(person.id);await page.unroute(endpoint);await expect(row.getByRole('button',{name:/^主负责人：/})).toContainText(person.name);
  await row.getByRole('button',{name:/^协作人员：/}).click();const people=root.locator('.inline-multi-popover');await people.getByRole('checkbox',{name:new RegExp(f.testing.ownerName!)}).check();await people.getByRole('button',{name:'完成',exact:true}).click();await expect.poll(async()=>(await current()).collaborators.map((p:{id:string})=>p.id)).toContain(f.testing.ownerId);await expect(row.getByRole('button',{name:/^协作人员：/})).toContainText(f.testing.ownerName!);
  await row.getByRole('button',{name:/^计划完成：/}).click();const date=root.locator('.inline-date-popover'),end=addBusinessDays(todayIso(),2);await date.getByRole('gridcell',{name:end,exact:true}).click();await date.getByRole('button',{name:'保存',exact:true}).click();await expect.poll(async()=>(await current()).plannedEnd).toBe(end);
  await row.locator('.detail-work-row-title').click();await root.getByRole('tab',{name:'资料',exact:true}).click();await root.getByRole('button',{name:/^工作阶段：/}).click();await root.getByRole('option',{name:'开发',exact:true}).click();await expect.poll(async()=>(await current()).workStage).toBe('development');
});
