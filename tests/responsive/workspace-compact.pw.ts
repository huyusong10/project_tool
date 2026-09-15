import {expect,test} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {phaseFixture} from './phase-fixture';
import {todayIso} from '../../src/shared/domain';

test.use({launchOptions:{ignoreDefaultArgs:['--hide-scrollbars']}});

test('无 Phase 的并行需求保持紧凑，折叠时有工作项入口，只有一个横向滚动条',async({page},info)=>{
  const f=await phaseFixture(page);
  const post=async(url:string,data:unknown)=>{const response=await page.request.post(url,{data});expect(response.ok(),await response.text()).toBe(true);return response.json();};
  const template=await post('/api/templates',{projectId:f.projectId,name:'并行工作',dependencyMode:'legacy',items:[{title:'分析设计',workStage:'analysis',durationDays:5,startOffsetDays:0,sortOrder:0},{title:'开发实现',workStage:'development',durationDays:5,startOffsetDays:0,sortOrder:1}]});
  let requirement=await post('/api/requirements',{projectId:f.projectId,featureId:f.feature.id,title:'EPDS-DCIM-137【租户管理】',templateId:template.id,plannedStart:todayIso(),ownerId:f.testing.ownerId});
  for(let index=0;index<2;index++){
    const work=requirement.workItems[index];
    const started=await post('/api/work-items/'+work.id+'/start',{expectedVersion:work.version,expectedRequirementVersion:requirement.version,ownerId:f.testing.ownerId});
    await post('/api/requirements/'+requirement.id+'/progress',{expectedVersion:started.version,workItemId:work.id,workItemPercent:index?17:90,content:'并行开发样例'});
    requirement=await(await page.request.get('/api/requirements/'+requirement.id)).json();
  }
  const graph=await(await page.request.get(f.base+'/path-analysis')).json();
  const input={expectedRevision:graph.revision,target:'project',changes:{add:[],remove:[],estimates:[],entities:['需求基线','设计完成','提测就绪','验收'].map((title,index)=>({id:randomUUID(),entity:'milestone',op:'create',requirementId:requirement.id,data:{title,confirmationMode:'manual',targetDate:index?null:todayIso()}}))}};
  const preview=await post(f.base+'/dependency-changes/preview',input);await post(f.base+'/dependency-changes/apply',{...input,batchId:randomUUID(),previewToken:preview.previewToken});
  await page.goto('/execution');const grid=page.getByRole('treegrid'),row=grid.locator('[data-row-id="'+requirement.id+'"]');
  await expect(row).toBeVisible();await row.scrollIntoViewIfNeeded();
  const left=await row.locator('.workspace-row-label').boundingBox();expect(left!.width).toBeLessThanOrEqual(350);
  await expect(row.locator('.workspace-row-label .workspace-row-owner')).toHaveText(f.testing.ownerName!);
  await expect(row.locator('.workspace-row-label .workspace-row-progress')).toHaveCount(0);
  await expect(row.locator('.workspace-row-progress')).toHaveText('并行 · 分析设计 90% · 开发 17%');
  expect((await row.boundingBox())!.height).toBeLessThanOrEqual(66);
  const undated=row.getByRole('button',{name:'待定日期 3 项'});await expect(undated).toHaveText('◇ 3');
  await undated.click();await expect(page.getByRole('dialog',{name:'里程碑详情'})).toContainText('提测就绪');await page.keyboard.press('Escape');
  await page.mouse.move(5,5);await row.locator('.workspace-row-title').focus();await expect(page.getByRole('tooltip')).toHaveCount(1);await expect(page.getByRole('tooltip')).toContainText(f.testing.ownerName!);await page.keyboard.press('Escape');
  await expect(row.locator('.gantt-milestone-label')).toHaveText('需求基线');
  const dateLabel=await row.locator('.gantt-milestone-label').boundingBox(),plan=await row.locator('.gantt-date-plan').boundingBox();expect(dateLabel!.y+dateLabel!.height).toBeLessThanOrEqual(plan!.y);
  const position=await row.getByRole('button',{name:/^查看 .* 的工作项$/}).boundingBox();
  await row.getByRole('button',{name:/^查看 .* 的工作项$/}).click();
  expect(await row.getByRole('button',{name:/^收起 .* 的工作项$/}).boundingBox()).toEqual(position);
  const work=grid.locator('[data-row-id="'+requirement.workItems[1].id+'"]');
  await expect(work.getByRole('button',{name:'更新 开发实现 进度',exact:true})).toBeVisible();await expect(work.getByRole('button',{name:'完成',exact:true})).toBeVisible();
  expect(await grid.locator('.kind-work').count()).toBe(2);
  await expect(page.locator('.workspace-gantt .gantt-navigation-scrollbar')).toHaveCount(0);
  expect(await grid.evaluate(el=>(el as HTMLElement).offsetHeight-el.clientHeight)).toBeGreaterThanOrEqual(10);
  const bounds=await row.locator('.workspace-row-label').boundingBox(),actions=await row.locator('.workspace-row-actions').boundingBox();
  await grid.evaluate(el=>{el.scrollLeft=el.scrollWidth-el.clientWidth;});
  expect(await row.locator('.workspace-row-label').boundingBox()).toEqual(bounds);expect(await row.locator('.workspace-row-actions').boundingBox()).toEqual(actions);
  expect(await row.locator('.workspace-row-label').evaluate(el=>{const b=el.getBoundingClientRect();return el.contains(document.elementFromPoint(b.right-2,b.top+10));})).toBe(true);
  await page.getByRole('button',{name:'今天',exact:true}).click();await page.screenshot({path:info.outputPath('compact-parallel.png'),animations:'disabled'});
  await page.setViewportSize({width:390,height:844});await work.scrollIntoViewIfNeeded();await work.locator('.workspace-row-actions').scrollIntoViewIfNeeded();
  const progress=await work.getByRole('button',{name:'更新 开发实现 进度',exact:true}).boundingBox(),complete=await work.getByRole('button',{name:'完成',exact:true}).boundingBox();
  expect(progress!.x+progress!.width<=complete!.x||progress!.y+progress!.height<=complete!.y).toBe(true);expect(complete!.x+complete!.width).toBeLessThanOrEqual(390);
  const narrowLabel=await work.locator('.workspace-row-label').boundingBox(),narrowActions=await work.locator('.workspace-row-actions').boundingBox();expect(narrowActions!.x-narrowLabel!.x-narrowLabel!.width).toBeGreaterThan(40);
  await expect(work.locator('.workspace-row-label .workspace-row-progress')).toHaveCount(0);
  expect(await grid.locator('.workspace-row-actions button').evaluateAll(buttons=>buttons.every(button=>{const b=button.getBoundingClientRect(),cell=button.closest('.workspace-row-actions')!.getBoundingClientRect();return !b.width||b.left>=cell.left-1&&b.right<=cell.right+1;}))).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('compact-narrow.png'),animations:'disabled'});
});
