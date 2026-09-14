import {expect,test} from '@playwright/test';
import {phaseFixture} from './phase-fixture';
test('多特性、长标题、空 Phase 与跨 Phase 依赖不重叠',async({page},info)=>{
 const f=await phaseFixture(page),name='跨租户站点与资产数据治理分期'.repeat(6),scope='先完成基础台账，后续补充跨站点校验与数据治理。'.repeat(60);
 const phase=(await(await page.request.get(f.base+'/feature-phases')).json()).find((p:{id:string})=>p.id===f.phases[2].id);
 expect((await page.request.post(f.base+'/features/'+f.feature.id+'/phases',{data:{id:phase.id,expectedVersion:phase.version,name,scope}})).ok()).toBe(true);
 for(const title of ['用户与组织中心','多站点采集网关与权限配置'])expect((await page.request.post(f.base+'/features',{data:{name:title.repeat(4)}})).ok()).toBe(true);
 const target=await(await page.request.post('/api/requirements',{data:{projectId:f.projectId,featureId:f.feature.id,phaseId:phase.id,title:'DCIM-长标题需求：多站点采集、批量同步和历史数据校验'.repeat(3)}})).json();
 const a=await(await page.request.get(f.base+'/path-analysis')).json();expect((await page.request.post(f.base+'/dependencies',{data:{expectedRevision:a.revision,sourceRequirementId:f.testing.id,targetRequirementId:target.id}})).ok()).toBe(true);
 await page.goto('/?view=features&mode=graph');await expect(page.locator('[data-layout-ready=true]')).toBeVisible();await expect(page.locator('.react-flow__node[data-id^="feature:"]')).toHaveCount(3);await page.screenshot({path:info.outputPath('multi-features.png'),animations:'disabled'});
 await page.goto('/?'+new URLSearchParams({view:'feature',mode:'graph',featureId:f.feature.id,phaseId:phase.id,pathInspector:'closed'}));await expect(page.locator('[data-layout-ready=true]')).toBeVisible();const region=page.locator('[data-phase-region="'+phase.id+'"]'),node=page.locator('.react-flow__node[data-id="'+target.id+'"]');await expect(region).toContainText(name);await expect(node).toContainText(target.title);await expect(page.locator('.react-flow__node[data-id="'+f.testing.id+'"]')).not.toHaveClass(/graph-node-hidden/);const header=await region.locator('.delivery-region-header').boundingBox(),card=await node.boundingBox();expect(header!.y+header!.height).toBeLessThan(card!.y);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('long-phase-cross-dependency.png'),animations:'disabled'});
});
