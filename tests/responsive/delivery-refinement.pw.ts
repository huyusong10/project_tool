import {test,expect,type Page} from '@playwright/test';
import {phaseFixture} from './phase-fixture';
import {closeGraphProperties,graphProperties} from './graph-interactions';
const ready=(page:Page)=>expect(page.locator('.dependency-canvas')).toHaveAttribute('data-layout-ready','true',{timeout:20000});
const detail=(page:Page)=>page.locator('.modal-card-workspace[role=dialog]');
async function alignedDetailHeader(page:Page){
 const header=detail(page).locator(':scope > header'),title=(await header.locator('h2').boundingBox())!,actions=await header.locator('button:visible').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().toJSON()));
 expect(actions.length).toBeGreaterThan(0);for(const button of actions){expect(button.x).toBeGreaterThanOrEqual(title.x+title.width);expect(button.y).toBe(actions[0].y);expect(button.height).toBe(actions[0].height);}
 const panel=(await header.boundingBox())!;expect(actions.at(-1)!.right).toBeLessThanOrEqual(panel.x+panel.width);expect(await detail(page).evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
}
async function containedCards(page:Page){
 const errors=await page.locator('.react-flow__node:not(.graph-node-hidden) .dependency-card').evaluateAll(cards=>cards.flatMap(card=>{
  const b=card.getBoundingClientRect();return Array.from(card.children).filter(c=>!c.classList.contains('react-flow__handle')&&!c.classList.contains('business-handle')).flatMap(c=>{const r=c.getBoundingClientRect();return r.width&&r.height&&(r.left<b.left-1||r.right>b.right+1||r.top<b.top-1||r.bottom>b.bottom+1)?[card.textContent?.slice(0,50)+': '+c.className]:[];});
 }));expect(errors).toEqual([]);
}

test('空特性不产生空子行，居中详情切换栏目保持清单和画布位置',{tag:'@responsive'},async({page},info)=>{
 const f=await phaseFixture(page);const emptyResponse=await page.request.post(f.base+'/features',{data:{name:'尚未拆分的特性'}});expect(emptyResponse.ok()).toBe(true);
 const plannedResponse=await page.request.post(f.base+'/features',{data:{name:'只有交付规划的特性'}});expect(plannedResponse.ok()).toBe(true);const planned=(await plannedResponse.json()).features.find((f:{name:string})=>f.name==='只有交付规划的特性');expect((await page.request.post(f.base+'/features/'+planned.id+'/phases',{data:{name:'Phase 1',scope:'先记录目标'}})).ok()).toBe(true);
 for(const view of ['list','graph']){
  await page.goto('/?'+new URLSearchParams({projectId:f.projectId,scopeType:'project',workspaceView:view}));
  if(view==='graph')await ready(page);else{
   await expect(page.locator('tr').filter({has:page.locator('.outline-title',{hasText:'尚未拆分的特性'})}).locator('.outline-expand')).toBeDisabled();await page.getByRole('button',{name:'展开全部',exact:true}).click();await expect(page.locator('[data-object-kind=phase]')).toHaveCount(4);await page.getByRole('button',{name:'收起全部',exact:true}).click();
  }
  const geometry=()=>page.evaluate(()=>({surface:(document.querySelector('.dependency-canvas')||document.querySelector('.outline-scroll'))!.getBoundingClientRect().toJSON(),viewport:document.querySelector('.react-flow__viewport')?.getAttribute('style'),items:Array.from(document.querySelectorAll('.outline-table th,.react-flow__node')).map(n=>({text:n.textContent,rect:n.getBoundingClientRect().toJSON()}))}));
  let previous='',stable=0;await expect.poll(async()=>{const next=JSON.stringify(await geometry());stable=next===previous?stable+1:0;previous=next;return stable;},{intervals:[150]}).toBeGreaterThanOrEqual(3);const before=await geometry();
  if(view==='list')await page.locator('[data-object-id="feature:'+f.feature.id+'"] .outline-title').click();else await graphProperties(page,page.locator('.react-flow__node[data-id="feature:'+f.feature.id+'"] .dependency-card'));
  for(const tab of ['概况','交付范围','资料','记录']){
   await detail(page).getByRole('tab',{name:tab,exact:true}).click();await alignedDetailHeader(page);expect(await geometry()).toEqual(before);
  }
  await page.screenshot({path:info.outputPath('stable-'+view+'.png'),animations:'disabled'});await closeGraphProperties(page);expect(await geometry()).toEqual(before);
 }
 const longName='跨站点资产归属与生命周期协同管理'.repeat(5),created=await page.request.post(f.base+'/features',{data:{name:longName}});expect(created.ok()).toBe(true);const id=(await created.json()).features.find((f:{name:string})=>f.name===longName).id;
 for(const viewport of [info.project.use.viewport!,{width:390,height:844}]){
  await page.setViewportSize(viewport);await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'list',scopeType:'project',detailId:'feature:'+id}));await expect(detail(page).locator(':scope > header h2')).toHaveText(longName);await alignedDetailHeader(page);await page.screenshot({path:info.outputPath('long-title-'+viewport.width+'.png'),animations:'disabled'});
 }
});

test('Phase 区域与工作项卡片不越界，工作进度和窄屏详情保持可读',{tag:'@responsive'},async({page},info)=>{
 const f=await phaseFixture(page),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'graph',scopeType:'project'}));await ready(page);await containedCards(page);await page.screenshot({path:info.outputPath('refined-features.png'),animations:'disabled'});
 await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'graph',scopeType:'phase',scopeId:f.phases[1].id}));await ready(page);await expect(page.locator('[data-phase-region]')).toHaveCount(1);await containedCards(page);
 const region=(await page.locator('[data-phase-region]').boundingBox())!,cards=await page.locator('.react-flow__node:not(.graph-node-hidden)').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().toJSON()));for(const c of cards){expect(c.x).toBeGreaterThanOrEqual(region.x);expect(c.x+c.width).toBeLessThanOrEqual(region.x+region.width+1);expect(c.y+c.height).toBeLessThanOrEqual(region.y+region.height+1);}
 await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'graph',scopeType:'requirement',scopeId:f.testing.id,detailId:f.testing.workItems[1].id}));await ready(page);await containedCards(page);await expect(page.locator('.react-flow__node[data-id="'+f.testing.workItems[1].id+'"]')).toContainText('70%');await expect(detail(page)).toContainText('70%');await expect(detail(page)).toContainText('进行中');await expect(detail(page).getByRole('region',{name:'执行资料'})).toContainText('工作阶段测试');
 for(const viewport of [info.project.use.viewport!,{width:390,height:844}]){
  await page.setViewportSize(viewport);await alignedDetailHeader(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);const box=(await detail(page).boundingBox())!;expect(box.width).toBeLessThanOrEqual(viewport.width);expect(box.height).toBeLessThanOrEqual(viewport.height);await page.screenshot({path:info.outputPath('refined-work-'+viewport.width+'.png'),animations:'disabled'});
 }
 expect(errors).toEqual([]);
});
