import {expect,test} from '@playwright/test';
import {phaseFixture as fixture,historicalPhaseFixture} from './phase-fixture';

test('特性 Phase、需求阶段、进展表和关系图在办公及窄屏可读',{tag:'@responsive'},async({page},info)=>{
 const f=await fixture(page),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const detail=page.locator('.modal-card-workspace[role=dialog]');
 for(const viewport of [info.project.use.viewport!,{width:390,height:844}]){
  await page.setViewportSize(viewport);
  for(const workspaceView of ['list','progress','graph']){
   await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView,scopeType:'phase',scopeId:f.phases[1].id}));
   if(workspaceView==='graph')await expect(page.locator('.dependency-canvas')).toHaveAttribute('data-layout-ready','true');
   const row=workspaceView==='list'?page.locator('[data-object-id="'+f.testing.id+'"]'):workspaceView==='progress'?page.locator('[data-row-id="'+f.testing.id+'"]'):page.locator('.react-flow__node[data-id="'+f.testing.id+'"]');
   await expect(row).toContainText(workspaceView==='progress'?'测试':'测试中');if(workspaceView==='progress')await expect(row).toHaveAttribute('data-status','in_progress');await expect(row).toContainText('70%');await expect(row).not.toContainText('99%');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath(workspaceView+'-'+viewport.width+'.png'),animations:'disabled'});
  }
  for(const id of ['feature:'+f.feature.id,'phase:'+f.phases[1].id,f.testing.id]){
   await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'list',scopeType:'project',detailId:id}));await expect(detail).toBeVisible();expect(await detail.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
 }
 expect(errors).toEqual([]);
});

test('新增与编辑 Phase、未知结果核对、历史记录和提测保留',async({page})=>{
 const f=await fixture(page);const historical=await historicalPhaseFixture(page,f);
 const featureUrl='/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'list',scopeType:'project',detailId:'feature:'+f.feature.id});
 const detail=page.locator('.modal-card-workspace[role=dialog]');
 await page.goto(featureUrl);await detail.getByRole('button',{name:'新建 Phase',exact:true}).click();const create=page.getByRole('dialog',{name:'新建 Phase',exact:true});await create.getByLabel('Phase 名称').fill('Phase 4');await create.getByLabel('交付范围').fill('跨站点治理');
 const endpoint='**'+f.base+'/features/'+f.feature.id+'/phases';let writes=0;
 await create.getByRole('region',{name:'编辑关联链接'}).getByRole('button',{name:'添加',exact:true}).click();await create.getByLabel('链接 1 地址',{exact:true}).fill('https://example.com/phase-delivery');await create.getByLabel('链接 1 名称',{exact:true}).fill('  阶段资料  ');
 await page.route(endpoint,async route=>{if(route.request().method()!=='POST')return route.continue();writes++;await route.fetch();await route.abort('failed');});await create.getByRole('button',{name:'新建 Phase',exact:true}).click();await expect(create.getByRole('button',{name:'读取最新 Phase 并核对'})).toBeVisible();await page.reload();await expect(create.getByLabel('Phase 名称')).toHaveValue('Phase 4');await create.getByRole('button',{name:'读取最新 Phase 并核对'}).click();await expect(create).toHaveCount(0);expect(writes).toBe(1);await page.unroute(endpoint);
 await detail.getByRole('tab',{name:'交付范围',exact:true}).click();await expect(detail.getByRole('tabpanel',{name:'交付范围',exact:true}).locator('.detail-card-row')).toHaveCount(4);await detail.getByRole('button',{name:'Phase 4',exact:true}).click();await detail.getByRole('button',{name:'编辑 Phase',exact:true}).click();const edit=page.getByRole('dialog',{name:'编辑 Phase',exact:true});await edit.getByLabel('交付范围').fill('跨站点治理与审计');await edit.getByRole('button',{name:'编辑 Phase',exact:true}).click();await expect(edit).toHaveCount(0);await expect(detail).toContainText('跨站点治理与审计');
 await page.goto(featureUrl+'&detailTab=history');await expect(detail.locator('.object-history-entry')).toHaveCount(1);await expect(detail).toContainText(historical.snapshot.scope);await expect(detail).toContainText('补充客户反馈');await expect(detail).toContainText('DCIM-001');
 await page.goto('/requirements/'+f.direct.id);await detail.getByRole('button',{name:'记录提测',exact:true}).click();const testing=page.getByRole('dialog',{name:'记录提测',exact:true});await testing.getByLabel('说明',{exact:true}).fill('版本已部署到测试环境');await testing.getByRole('button',{name:'保存提测记录'}).click();await expect(testing).toHaveCount(0);await expect(detail.locator('.requirement-overview')).toContainText('已提测');
 await page.goto(featureUrl);await detail.getByRole('button',{name:'新建 Phase',exact:true}).click();await create.getByLabel('Phase 名称').fill('尚未提交的输入');await page.route('**'+f.base+'/path-graph*',route=>route.fulfill({status:403,json:{error:'项目权限已移除'}}));await page.evaluate(()=>{window.dispatchEvent(new Event('offline'));window.dispatchEvent(new Event('online'));});await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.workspace-outline')).toHaveCount(0);
});
