import {expect,test} from '@playwright/test';
import {phaseFixture} from './phase-fixture';
import {chooseOption} from './select-helper';

test('双轨保留百分比；水平滚动时文字列和操作列覆盖时间轴',async({page},info)=>{
  const f=await phaseFixture(page);await page.goto('/execution');await chooseOption(page.getByLabel('展开层级',{exact:true}),'work');
  const grid=page.getByRole('treegrid'),work=grid.locator('[data-row-id="'+f.testing.workItems[1].id+'"]');
  await expect(work.locator('.workspace-row-progress')).toHaveText('70%');
  await expect(grid.locator('[data-row-id="'+f.testing.id+'"] .workspace-row-progress')).toHaveText('测试中 · 70%');
  for(const label of await work.locator('.gantt-date-progress').all())await expect(label).toHaveText('70%');
  await expect(work.getByRole('button',{name:'更新 测试 进度',exact:true})).toBeVisible();
  for(const left of [0,80,200,380,100000]){
    await grid.evaluate((el,left)=>{el.scrollLeft=left;},left);
    const covered=await grid.evaluate(root=>{
      const bounds=root.getBoundingClientRect(),failures:string[]=[];
      // Include decorative bars and today lines in the browser's paint-order hit test.
      const decorations=[...root.querySelectorAll<HTMLElement>('.workspace-row-track *')].map(el=>({el,value:el.style.pointerEvents}));decorations.forEach(({el})=>{el.style.pointerEvents='auto';});
      for(const cell of root.querySelectorAll<HTMLElement>('.workspace-row-label,.workspace-row-owner,.workspace-row-progress,.workspace-row-actions')){
        const b=cell.getBoundingClientRect();if(b.width===0||b.bottom<=bounds.top+50||b.top>=bounds.bottom)continue;
        for(let x=Math.max(b.left,bounds.left)+4;x<Math.min(b.right,bounds.right)-4;x+=12)for(let y=Math.max(b.top,bounds.top+50)+3;y<Math.min(b.bottom,bounds.bottom)-3;y+=5){
          if(document.elementFromPoint(x,y)?.closest('.workspace-row-track'))failures.push(cell.className);
        }
      }decorations.forEach(({el,value})=>{el.style.pointerEvents=value;});return [...new Set(failures)];
    });expect(covered).toEqual([]);
  }
  await page.getByRole('button',{name:'适配全部',exact:true}).click();await page.screenshot({path:info.outputPath('readable-dual-track.png'),animations:'disabled'});
});

test('Phase 布局移动、撤销和自动整理可恢复，保存后保持相对坐标',async({page})=>{
  const f=await phaseFixture(page);await page.goto('/?'+new URLSearchParams({view:'feature',featureId:f.feature.id,phaseId:f.phases[1].id,mode:'graph'}));
  const ready=()=>expect(page.locator('[data-layout-ready=true]')).toBeVisible(),node=page.locator('.react-flow__node[data-id="'+f.testing.id+'"]');await ready();
  const position=()=>node.evaluate(el=>({x:new DOMMatrix(getComputedStyle(el).transform).m41,y:new DOMMatrix(getComputedStyle(el).transform).m42})),original=await position();
  await page.getByRole('button',{name:'编辑画布',exact:true}).click();await node.locator('.dependency-card').click();await page.locator('.graph-detail').filter({visible:true}).getByRole('button',{name:'关闭',exact:true}).first().click();await page.locator('.dependency-canvas').focus();
  await page.keyboard.press('Shift+ArrowRight');await expect.poll(position).toEqual({x:original.x+10,y:original.y});await ready();
  await page.keyboard.press('Control+z');await expect.poll(position).toEqual(original);await ready();
  await page.keyboard.press('Shift+ArrowRight');await ready();await expect.poll(position).toEqual({x:original.x+10,y:original.y});
  await page.getByRole('button',{name:'保存修改',exact:true}).click();await expect(page.getByRole('button',{name:'编辑画布',exact:true})).toBeVisible();
  const saved=await position();await page.reload();await ready();expect(await position()).toEqual(saved);
  await page.getByRole('button',{name:'编辑画布',exact:true}).click();await page.getByRole('button',{name:'自动整理',exact:true}).click();await expect.poll(position).toEqual(original);await ready();
  await page.locator('.dependency-canvas').focus();await page.keyboard.press('Control+z');await expect.poll(position).toEqual(saved);
});

test('未分派阶段单独分组，Phase 筛选与三个视角入口保持可用',async({page})=>{
  const f=await phaseFixture(page),response=await page.request.post('/api/requirements',{data:{projectId:f.projectId,featureId:f.feature.id,title:'未分派需求'}});expect(response.ok()).toBe(true);const requirement=await response.json();
  await page.goto('/execution');const grid=page.getByRole('treegrid'),row=grid.locator('[data-row-id="'+requirement.id+'"]'),group=grid.locator('[data-row-id="unphased:'+f.feature.id+'"]');
  await expect(group).toBeVisible();await expect(row).toHaveCount(0);await group.getByRole('button',{name:'展开 未分派阶段',exact:true}).click();await expect(row).toHaveAttribute('aria-level','3');
  await chooseOption(page.getByLabel('进展特性',{exact:true}),f.feature.id);await page.getByRole('button',{name:/^更多筛选/}).click();await chooseOption(page.getByLabel('进展 Phase',{exact:true}),f.phases[1].id);await page.getByRole('dialog').filter({has:page.getByLabel('更多进展筛选')}).getByRole('button',{name:'关闭',exact:true}).click();await expect(row).toHaveCount(0);
  await page.getByRole('button',{name:/^更多筛选/}).click();await chooseOption(page.getByLabel('进展 Phase',{exact:true}),'unassigned');await page.getByRole('dialog').filter({has:page.getByLabel('更多进展筛选')}).getByRole('button',{name:'关闭',exact:true}).click();await expect(row).toBeVisible();
  const views=page.getByRole('group',{name:'项目视角'});await expect(views.getByRole('button')).toHaveText(['特性清单','关系图','进展表']);
  await views.getByRole('button',{name:'特性清单',exact:true}).click();await expect(page.locator('.outline-table')).toBeVisible();
});

test('Phase 外框适应长标题、依赖链和分支；不压缩卡片或改变关系',async({page},info)=>{
  test.setTimeout(90000);const f=await phaseFixture(page),ids:string[]=[];
  for(let i=0;i<7;i++){
    const response=await page.request.post('/api/requirements',{data:{projectId:f.projectId,featureId:f.feature.id,phaseId:f.phases[2].id,title:'DCIM-'+(100+i)+' 设备跨站点部署、历史数据迁移与权限继承校验'}});expect(response.ok()).toBe(true);ids.push((await response.json()).id);
  }
  for(let i=1;i<ids.length;i++){
    const analysis=await(await page.request.get(f.base+'/path-analysis')).json();
    const response=await page.request.post(f.base+'/dependencies',{data:{expectedRevision:analysis.revision,sourceRequirementId:ids[i<5?i-1:2],targetRequirementId:ids[i]}});expect(response.ok(),await response.text()).toBe(true);
  }
  await page.goto('/?'+new URLSearchParams({view:'feature',featureId:f.feature.id,phaseId:f.phases[2].id,mode:'graph'}));
  await expect(page.locator('[data-layout-ready=true]')).toBeVisible();
  const frame=page.locator('[data-phase-region="'+f.phases[2].id+'"]'),bounds=await frame.boundingBox();expect(bounds!.width).toBeGreaterThan(1200);
  const cards=await page.locator('.react-flow__node').evaluateAll((nodes,ids)=>nodes.filter(n=>ids.includes(n.getAttribute('data-id')!)).map(n=>{const b=n.getBoundingClientRect();return {id:n.getAttribute('data-id'),left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width};}),ids);
  expect(cards).toHaveLength(7);
  for(const c of cards){expect(c.width).toBeGreaterThanOrEqual(200);expect(c.left).toBeGreaterThan(bounds!.x);expect(c.right).toBeLessThan(bounds!.x+bounds!.width);expect(c.top).toBeGreaterThan(bounds!.y);expect(c.bottom).toBeLessThan(bounds!.y+bounds!.height);}
  for(let i=1;i<5;i++)expect(cards.find(c=>c.id===ids[i])!.left).toBeGreaterThan(cards.find(c=>c.id===ids[i-1])!.right);
  await page.screenshot({path:info.outputPath('phase-topology.png'),animations:'disabled'});
  await page.setViewportSize({width:390,height:844});await expect(page.locator('[data-layout-ready=true]')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('narrow-topology.png'),animations:'disabled'});
});
