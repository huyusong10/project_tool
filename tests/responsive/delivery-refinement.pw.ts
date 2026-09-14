import {test,expect,type Page} from '@playwright/test';
import {phaseFixture} from './phase-fixture';
import {chooseOption} from './select-helper';
const ready=(page:Page)=>expect(page.locator('[data-layout-ready=true]')).toBeVisible({timeout:20000});
async function containedCards(page:Page){
  const errors=await page.locator('.react-flow__node:not(.graph-node-hidden) .dependency-card').evaluateAll(cards=>cards.flatMap(card=>{
    const b=card.getBoundingClientRect();return Array.from(card.children).filter(c=>!c.classList.contains('react-flow__handle')&&!c.classList.contains('business-handle')).flatMap(c=>{const r=c.getBoundingClientRect();return r.width&&r.height&&(r.left<b.left-1||r.right>b.right+1||r.top<b.top-1||r.bottom>b.bottom+1)?[card.textContent?.slice(0,50)+': '+c.className]:[];});
  }));expect(errors).toEqual([]);
}

test('空特性没有空展开行，打开与加宽详情保持主区域位置',async({page},testInfo)=>{
  test.setTimeout(90000);const f=await phaseFixture(page);
  const empty=await page.request.post(f.base+'/features',{data:{name:'尚未拆分的特性'}});expect(empty.ok()).toBe(true);
  const planned=await page.request.post(f.base+'/features',{data:{name:'只有交付规划的特性'}});expect(planned.ok()).toBe(true);
  const plannedId=(await planned.json()).features.find((item:{name:string})=>item.name==='只有交付规划的特性').id;
  const phase=await page.request.post(f.base+'/features/'+plannedId+'/phases',{data:{name:'Phase 1',scope:'先记录目标'}});expect(phase.ok()).toBe(true);
  await page.goto('/?view=features&mode=table&pathInspector=closed');
  await expect(page.locator('.delivery-table')).toContainText('尚未拆分的特性');
  await expect(page.getByRole('button',{name:'展开 尚未拆分的特性',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'展开 只有交付规划的特性',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'展开／收起全部 Phase'}).click();
  await expect(page.locator('.delivery-expanded-phases')).toHaveCount(1);
  await expect(page.locator('.delivery-expanded-phases')).toContainText('Phase 3');
  await page.getByRole('button',{name:'展开／收起全部 Phase'}).click();
  await expect(page.locator('.graph-footer')).toHaveCount(0);
  await expect(page.getByText('单击查看详情 · 双击进入需求')).toHaveCount(0);
  for(const mode of ['table','graph']){
    if(mode==='graph'){await page.getByRole('group',{name:'交付视图'}).getByRole('button',{name:'关系图',exact:true}).click();await ready(page);}
    const geometry=()=>page.evaluate(()=>({
      surface:(document.querySelector('.delivery-table-surface')||document.querySelector('.dependency-canvas'))!.getBoundingClientRect().toJSON(),
      viewport:document.querySelector('.react-flow__viewport')?.getAttribute('style'),
      items:Array.from(document.querySelectorAll('.delivery-table th,.react-flow__node')).map(n=>({text:n.textContent,rect:n.getBoundingClientRect().toJSON()}))
    }));
    let last='',stable=0;await expect.poll(async()=>{const next=JSON.stringify(await geometry());stable=next===last?stable+1:0;last=next;return stable;},{intervals:[150]}).toBeGreaterThanOrEqual(4);
    const before=await geometry();
    if(mode==='table')await page.locator('.delivery-table').getByRole('button',{name:'资产管理',exact:true}).click();
    else await page.locator('.react-flow__node[data-id="feature:'+f.feature.id+'"] strong').click();
    const panel=page.locator('.graph-detail:not(.is-leaving)');await expect(panel).toBeVisible();
    await expect(panel.locator('.feature-detail-toolbar')).toContainText('进入需求');
    await expect(panel.locator('.feature-detail-toolbar').getByLabel('特性更多操作')).toBeVisible();
    for(const action of ['open','expand','basic','collapse','close']){
      if(action==='expand')await panel.getByRole('button',{name:'展开',exact:true}).click();
      if(action==='basic')await panel.getByRole('button',{name:'目标与范围',exact:true}).click();
      if(action==='collapse')await panel.getByRole('button',{name:'收起',exact:true}).click();
      if(action==='close')await panel.getByRole('button',{name:'关闭',exact:true}).click();
      // Observe the full former resize/reveal delay, rather than only its first frame.
      for(let tick=0;tick<5;tick++){await page.waitForTimeout(150);expect(await geometry(),mode+' '+action).toEqual(before);}
      if(action==='open'){
        const overflow=await panel.evaluate(el=>Array.from(el.querySelectorAll('.feature-detail-navigation button,.phase-row>*')).filter(n=>{const r=n.getBoundingClientRect(),p=n.parentElement!.getBoundingClientRect();return r.left<p.left-1||r.right>p.right+1;}).map(n=>n.className));expect(overflow).toEqual([]);
        const tabs=await panel.getByRole('group',{name:'特性详情'}).getByRole('button').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));expect(Math.max(...tabs)-Math.min(...tabs)).toBeLessThan(1);
        await page.screenshot({path:testInfo.outputPath('stable-'+mode+'-detail.png'),animations:'disabled'});
      }
    }
  }
  await page.setViewportSize({width:390,height:844});await page.goto('/?'+new URLSearchParams({view:'features',mode:'table',pathNode:'feature:'+f.feature.id,pathInspector:'open'}));
  const mobile=page.locator('.graph-detail:not(.is-leaving)');await expect(mobile).toBeVisible();
  expect(await mobile.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('stable-mobile-feature.png'),animations:'disabled'});
});
test('交付界面控件、卡片边界、Phase 筛选、工作进度和窄屏详情',async({page},testInfo)=>{
  test.setTimeout(90000);const f=await phaseFixture(page),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?view=features&mode=table');await expect(page.locator('.delivery-table')).toContainText('资产管理');
  await expect(page.getByRole('group',{name:'交付范围',exact:true})).toHaveCount(0);await expect(page.locator('.delivery-filters select:visible')).toHaveCount(0);
  await page.getByRole('combobox',{name:'Phase 状态筛选'}).press('ArrowDown');await expect(page.getByRole('listbox',{name:'Phase 状态筛选'})).toBeVisible();await page.keyboard.press('End');await page.keyboard.press('Enter');await expect(page).toHaveURL(/phaseStatus=delivered/);
  await chooseOption(page.getByRole('combobox',{name:'Phase 状态筛选'}),'');await page.screenshot({path:testInfo.outputPath('refined-table.png'),animations:'disabled'});
  await page.getByRole('group',{name:'交付视图'}).getByRole('button',{name:'关系图',exact:true}).click();await ready(page);await containedCards(page);await page.screenshot({path:testInfo.outputPath('refined-features.png'),animations:'disabled'});
  await page.goto('/?'+new URLSearchParams({view:'feature',featureId:f.feature.id,mode:'graph',phaseId:f.phases[1].id,pathInspector:'closed'}));await ready(page);await expect(page.locator('[data-phase-region]')).toHaveCount(1);await containedCards(page);
  const region=await page.locator('[data-phase-region]').boundingBox();const cards=await page.locator('.react-flow__node:not(.graph-node-hidden)').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().toJSON()));for(const c of cards){expect(c.x).toBeGreaterThanOrEqual(region!.x);expect(c.x+c.width).toBeLessThanOrEqual(region!.x+region!.width+1);expect(c.y+c.height).toBeLessThanOrEqual(region!.y+region!.height+1);}
  await page.screenshot({path:testInfo.outputPath('refined-phase.png'),animations:'disabled'});
  await page.goto('/?'+new URLSearchParams({view:'requirement',requirementId:f.testing.id,featureId:f.feature.id,root:'features',mode:'graph',pathNode:f.testing.workItems[1].id,pathInspector:'open'}));await ready(page);await containedCards(page);
  const work=page.locator('.react-flow__node[data-id="'+f.testing.workItems[1].id+'"]');await expect(work).toContainText('70%');await expect(work).toContainText('测试中');
  const inspector=page.locator('.graph-detail').filter({visible:true});await expect(inspector.locator('.delivery-work-details')).toContainText('70%');await page.screenshot({path:testInfo.outputPath('refined-work-detail.png'),animations:'disabled'});
  await page.setViewportSize({width:390,height:844});await expect(inspector).toBeVisible();const panel=await inspector.boundingBox();expect(panel!.width).toBe(390);expect(panel!.height).toBe(844);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:testInfo.outputPath('refined-mobile-detail.png'),animations:'disabled'});
  await inspector.getByRole('button',{name:'关闭',exact:true}).first().click();await chooseOption(page.getByRole('combobox',{name:'工作阶段筛选'}),'testing');await expect(page.getByRole('combobox',{name:'工作阶段筛选'})).toContainText('测试');expect(errors).toEqual([]);
});
