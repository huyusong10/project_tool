import {expect,test,type Locator} from '@playwright/test';
import {phaseFixture} from './phase-fixture';

async function addLink(editor:Locator,index:number,title:string,url:string){
  await editor.getByRole('button',{name:'添加',exact:true}).click();
  await editor.getByRole('textbox',{name:`链接 ${index} 地址`,exact:true}).fill(url);
  await editor.getByRole('textbox',{name:`链接 ${index} 名称`,exact:true}).fill(title);
}
test('特性、Phase、需求和工作项共用开放链接，草稿恢复与保存',async({page},info)=>{
  const f=await phaseFixture(page),root=page.locator('.modal-card-workspace[role=dialog]');
  const open=async(id:string,tab='basic')=>{await page.goto('/?'+new URLSearchParams({projectId:f.projectId,detailId:id,detailTab:tab}));await expect(root).toBeVisible();};
  await open('feature:'+f.feature.id);
  await root.getByRole('button',{name:'编辑特性',exact:true}).click();
  let editor=root.getByRole('region',{name:'编辑关联链接',exact:true});
  await expect(editor.getByRole('textbox',{name:'链接 1 名称',exact:true})).toHaveValue('MDS');
  await addLink(editor,2,'MPS 范围说明','https://docs.example.com/custom-mps');
  await addLink(editor,3,'交付跟踪','https://jira.example.com/browse/DCIM-33');
  await root.getByRole('button',{name:'编辑特性',exact:true}).click();
  await expect(root.getByRole('link',{name:'MPS 范围说明'})).toBeVisible();
  await root.getByRole('tab',{name:'概况',exact:true}).click();await expect(root.getByRole('region',{name:'目标与范围',exact:true}).getByRole('link',{name:'交付跟踪'})).toBeVisible();
  await page.screenshot({path:info.outputPath('feature-links.png'),animations:'disabled'});
  await open('phase:'+f.phases[2].id);await root.getByRole('button',{name:'编辑 Phase',exact:true}).click();
  editor=root.getByRole('region',{name:'编辑关联链接',exact:true});await addLink(editor,1,'阶段验收清单','https://example.com/checklist');
  await root.getByRole('button',{name:'编辑 Phase',exact:true}).click();await expect(root.getByRole('link',{name:'阶段验收清单'})).toBeVisible();
  await open(f.testing.id);await root.getByRole('button',{name:'编辑信息',exact:true}).click();
  editor=root.getByRole('region',{name:'编辑关联链接',exact:true});await addLink(editor,1,'Confluence 设计','https://docs.example.com/spaces/TEAM/pages/33');await addLink(editor,2,'实现任务','https://jira.example.com/browse/DCIM-33');
  await page.reload();await expect(root).toBeVisible();
  // Reopening the edit action restores this tab's unsaved input.
  if(!await editor.isVisible())await root.getByRole('button',{name:'编辑信息',exact:true}).click();
  await expect(editor.getByRole('textbox',{name:'链接 2 名称',exact:true})).toHaveValue('实现任务');
  await root.getByRole('button',{name:'保存信息',exact:true}).click();await expect(root.getByRole('link',{name:'实现任务'})).toBeVisible();
  const work=f.testing.workItems[0];await open(work.id);
  const links=root.getByRole('region',{name:'工作项关联链接',exact:true});await links.getByRole('button',{name:'编辑',exact:true}).click();
  editor=links.getByRole('region',{name:'编辑关联链接',exact:true});await addLink(editor,1,'完成项补充材料','https://example.com/evidence');await links.getByRole('button',{name:'保存',exact:true}).click();
  await expect(links.getByRole('link',{name:'完成项补充材料'})).toBeVisible();
  await page.screenshot({path:info.outputPath('work-links.png'),animations:'disabled'});
});

test('链接行键盘排序、删除及窄屏全主题无裁切',{tag:'@responsive'}, async({page},info)=>{
  const f=await phaseFixture(page);await page.goto('/?'+new URLSearchParams({projectId:f.projectId,detailId:'feature:'+f.feature.id,detailTab:'basic'}));
  const root=page.locator('.modal-card-workspace[role=dialog]');await root.getByRole('button',{name:'编辑特性',exact:true}).click();
  const editor=root.getByRole('region',{name:'编辑关联链接',exact:true});await addLink(editor,2,'外部关联材料','https://example.com/extra');
  await editor.getByRole('button',{name:'拖动链接 2 调整顺序',exact:true}).focus();await page.keyboard.press('Space');await expect(page.locator('.drag-preview')).toBeVisible();await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));await page.keyboard.press('ArrowUp');await expect(editor.locator('.reference-link-row').first()).toHaveClass(/is-over/);await page.keyboard.press('Space');
  await expect(editor.getByRole('textbox',{name:'链接 1 名称',exact:true})).toHaveValue('外部关联材料');
  await editor.getByRole('button',{name:'移除链接 2',exact:true}).click();await expect(editor.locator('.reference-link-row')).toHaveCount(1);
  await page.setViewportSize({width:390,height:640});
  for(const theme of ['classic','dcim','midnight','forest','swiss','soft','industrial']){
    await page.evaluate(value=>{localStorage.setItem('project-manage:theme',value);window.dispatchEvent(new StorageEvent('storage',{key:'project-manage:theme',newValue:value}));},theme);
    await editor.scrollIntoViewIfNeeded();expect(await editor.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);expect(await root.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    await expect(editor.getByRole('button',{name:'添加',exact:true})).toBeInViewport();await page.screenshot({path:info.outputPath('links-narrow-'+theme+'.png'),animations:'disabled'});
  }
});

test('工作项链接提交结果未知时刷新保留原请求，核对后不重复提交',async({page})=>{
  const f=await phaseFixture(page),work=f.testing.workItems[1];
  await page.goto('/?'+new URLSearchParams({projectId:f.projectId,detailId:work.id,detailTab:'basic'}));
  const links=page.getByRole('region',{name:'工作项关联链接',exact:true});await links.getByRole('button',{name:'编辑',exact:true}).click();
  await addLink(links.getByRole('region',{name:'编辑关联链接'}),1,'待核对材料','https://example.com/recheck');
  let writes=0;
  await page.route('**/api/work-items/'+work.id,async route=>{
    if(route.request().method()!=='PATCH')return route.continue();writes++;await route.fetch();await route.abort('failed');
  });
  await links.getByRole('button',{name:'保存',exact:true}).click();await expect(links.getByRole('button',{name:'核对',exact:true})).toBeVisible();expect(writes).toBe(1);
  await page.reload();await expect(links.getByRole('textbox',{name:'链接 1 名称',exact:true})).toHaveValue('待核对材料');
  await expect(links.getByRole('button',{name:'保存',exact:true})).toHaveCount(0);
  await links.getByRole('button',{name:'核对',exact:true}).click();await expect(links.getByRole('link',{name:'待核对材料'})).toBeVisible();expect(writes).toBe(1);
});
