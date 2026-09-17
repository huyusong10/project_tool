import {expect,test} from '@playwright/test';
import {phaseFixture} from './phase-fixture';

test('工作项拖拽可取消，完成需求禁止新增但管理员可维护已有顺序',async({page},info)=>{
  const f=await phaseFixture(page),url='/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'list',scopeType:'project',detailId:f.testing.id,detailTab:'work'});
  await page.goto(url);const modal=page.getByRole('dialog'),rows=modal.locator('.work-arrangement-row');await expect(rows).toHaveCount(2);
  for(const row of await rows.all())expect((await row.boundingBox())!.height).toBeLessThan(135);
  const handle=modal.getByRole('button',{name:'拖动测试调整顺序',exact:true}),box=(await handle.boundingBox())!;
  await page.mouse.move(box.x+12,box.y+12);await page.mouse.down();await page.mouse.move(box.x+110,box.y-10,{steps:8});
  const ghost=page.locator('[data-sortable-drag-preview]');await expect(ghost).toBeInViewport();await expect(ghost).toContainText('测试');await expect(ghost.locator('.workspace-object-mark')).toBeVisible();expect((await ghost.boundingBox())!.height).toBeLessThan(100);
  expect(await ghost.evaluate(el=>{
    // Temporarily allow hit testing; a merely visible element may be behind the modal.
    const overlay=el.parentElement!,rect=el.getBoundingClientRect();overlay.style.pointerEvents='auto';
    const front=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);overlay.style.removeProperty('pointer-events');
    return front===overlay||!!front&&overlay.contains(front);
  })).toBe(true);
  await page.screenshot({path:info.outputPath('drag-shadow.png')});await page.keyboard.press('Escape');await page.mouse.up();await expect(ghost).toHaveCount(0);await expect(modal).toBeVisible();
  const complete=await page.request.post('/api/work-items/'+f.testing.workItems[1].id+'/complete',{data:{expectedVersion:f.testing.workItems[1].version}});expect(complete.ok(),await complete.text()).toBe(true);
  await page.reload();await expect(modal.locator(':scope > header')).toContainText('已完成');await expect(modal.getByRole('button',{name:'添加工作项',exact:true})).toBeDisabled();await expect(handle).toBeEnabled();await expect(modal.getByRole('status',{name:/拖动手柄排序/})).toContainText('支持键盘操作');
  await expect(rows.first().getByRole('button',{name:'修正实际日期',exact:true})).toBeVisible();await expect(rows.first().getByRole('button',{name:'重开\/返工',exact:true})).toBeVisible();await expect(modal.getByRole('button',{name:'更多工作项操作'})).toHaveCount(0);
  await page.screenshot({path:info.outputPath('completed-work-list.png')});
});

test('内部工作项依赖不重复父需求，外部依赖归组且端点可返回',async({page},info)=>{
  const f=await phaseFixture(page);
  const initial=await(await page.request.get(f.base+'/path-analysis')).json();const internalLink=await page.request.post(f.base+'/dependencies',{data:{expectedRevision:initial.revision,sourceRequirementId:f.testing.id,sourceWorkItemId:f.testing.workItems[0].id,targetRequirementId:f.testing.id,targetWorkItemId:f.testing.workItems[1].id}});expect(internalLink.ok(),await internalLink.text()).toBe(true);
  for(const work of f.testing.workItems){const analysis=await(await page.request.get(f.base+'/path-analysis')).json();const response=await page.request.post(f.base+'/dependencies',{data:{expectedRevision:analysis.revision,sourceRequirementId:f.testing.id,sourceWorkItemId:work.id,targetRequirementId:f.direct.id}});expect(response.ok(),await response.text()).toBe(true);}
  await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'progress',scopeType:'project',detailId:f.testing.id,detailTab:'dependencies'}));
  const modal=page.getByRole('dialog'),internal=modal.getByRole('region',{name:'内部工作项',exact:true}),external=modal.getByRole('region',{name:'后续需求',exact:true});
  await expect(internal).toBeVisible();await expect(internal.getByText(f.testing.title)).toHaveCount(0);await expect(external.locator('header')).toContainText('2 条关系');await expect(external.locator('header').getByRole('button',{name:f.direct.title,exact:true})).toHaveCount(1);
  await internal.getByRole('button',{name:/工作项\s*开发$/}).click();await expect(modal.getByRole('tablist',{name:'工作项详情内容'})).toBeVisible();expect(new URL(page.url()).searchParams.get('detailId')).toBe(f.testing.workItems[0].id);
  await modal.getByRole('button',{name:'返回'+f.testing.title,exact:true}).click();await expect(modal.getByRole('tab',{name:'依赖',exact:true})).toHaveAttribute('aria-selected','true');
  await external.locator('header').getByRole('button',{name:f.direct.title,exact:true}).click();expect(new URL(page.url()).searchParams.get('detailId')).toBe(f.direct.id);
  await modal.getByRole('button',{name:'返回'+f.testing.title,exact:true}).click();await page.screenshot({path:info.outputPath('dependency-groups.png')});
});

test('空操作栏不占位，问题表单与甘特按钮保持完整尺寸',{tag:'@responsive'},async({page},info)=>{
  const f=await phaseFixture(page),response=await page.request.post('/api/issues',{data:{projectId:f.projectId,title:'紧凑问题详情',priority:'P1',ownerId:f.testing.ownerId}});expect(response.ok()).toBe(true);const issue=await response.json();
  await page.goto('/issues?'+new URLSearchParams({projectId:f.projectId,detailId:issue.id,detailTab:'updates'}));const modal=page.getByRole('dialog');await expect(modal.locator('.issue-update-form')).toBeVisible();await expect(modal.locator('.detail-workspace-toolbar')).toBeHidden();
  const nav=(await modal.getByRole('tablist').boundingBox())!,entry=(await modal.locator('.issue-settings-progress-entry').boundingBox())!;expect(entry.y-nav.y-nav.height).toBeLessThan(20);
  await page.screenshot({path:info.outputPath('issue-compact.png')});
  await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'progress',scopeType:'requirement',scopeId:f.testing.id}));await page.getByLabel('展开层级').click();await page.getByRole('option',{name:'展开到工作项',exact:true}).click();
  for(const width of [1280,390]){await page.setViewportSize({width,height:800});const buttons=page.locator('.workspace-row-tools .execution-action');await expect(buttons.first()).toBeVisible();const sizes=await buttons.evaluateAll(nodes=>nodes.map(node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height})));expect(sizes.length).toBeGreaterThan(1);for(const size of sizes)expect(size).toEqual({width:66,height:30});
    expect(await page.locator('.workspace-row-tools').evaluateAll(nodes=>nodes.every(node=>node.scrollWidth<=node.clientWidth+1))).toBe(true);
  }
  await page.screenshot({path:info.outputPath('gantt-action-widths.png')});
});
