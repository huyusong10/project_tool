import { expect, test, type Page } from '@playwright/test';
import { mockGanttData } from './gantt-fixture';
import type { TemplateItem, WorkItemTemplate } from '../../src/client/types';

const item = (id: string, title: string, start: number, duration: number, predecessorIds: string[] = [], kind: 'work'|'milestone' = 'work'): TemplateItem => ({id,title,startOffsetDays:start,durationDays:duration,predecessorIds,kind,templateId:'t0',sortOrder:0,milestoneLabel:null});
const items = [item('req','需求设计',0,2),item('ux','UX 设计',0,2),item('base','需求基线',2,0,['req','ux'],'milestone'),item('front','前端开发',2,3,['base']),item('back','后端开发',2,4,['base']),item('test','联调测试',6,2,['front','back']),item('release','测试通过',8,0,['test'],'milestone')];

async function fixture(page: Page, count = 7, firstItems?: TemplateItem[]) {
  await mockGanttData(page);
  const writes: string[] = [];
  const names = ['DCIM AI 工作流V1.0','DCIM AI 工作流V2.0','单一工作模板','DCIM 服务端工作流V1.0','DCIM 前端工作流V1.0','DCIM 缺陷修复工作流V1.0','DCIM 文档工作流V1.0'];
  const templates: WorkItemTemplate[] = Array.from({length:count},(_,i)=>({id:'t'+i,projectId:'p1',name:names[i%names.length]+(i>6?' '+i:''),description:'适用于需求设计、前后端并行开发与联调测试。需求设计和 UX 设计形成需求基线，再进行开发。这里保留完整说明，用于检查详情预览不会影响列表中的卡片布局。',dependencyMode:'dependencies',createdAt:'2026-09-01',updatedAt:'2026-09-01',items:i===2?[item('only','实施工作',0,1)]:i===3?[items[0],{...items[4],predecessorIds:['req']},{...items[5],predecessorIds:['back']},items[6]]:items}));
  if (firstItems) templates[0].items = firstItems;
  page.on('request', request=>{ if (request.url().includes('/api/') && request.method() !== 'GET') writes.push(request.method()+' '+new URL(request.url()).pathname); });
  await page.route('**/api/templates**', route=>route.fulfill({json:templates}));
  await page.route('**/api/branding', route=>route.fulfill({json:{systemName:'项目管理',shortName:'PM',logoUrl:null,updatedAt:'2026-09-01'}}));
  await page.goto('/templates');
  await expect(page.locator('.template-card')).toHaveCount(count);
  return {templates,writes};
}

test('列表显示紧凑双缩略图，打开完整预览不移动卡片或写入流程', {tag:'@responsive'},async ({page}, info) => {
  const {writes}=await fixture(page);
  const card=page.locator('.template-card').first();
  await expect(card.locator('[data-thumbnail-node]')).toHaveCount(7);
  await expect(card.locator('[data-thumbnail-edge]')).toHaveCount(7);
  const cardGantt=card.locator('.template-thumbnail-gantt'),cardFlow=card.locator('.template-thumbnail-flow');
  await expect(cardGantt.locator('[data-thumbnail-work]')).toHaveCount(5);
  await expect(cardFlow.locator('text').filter({hasText:'需求基线'})).toBeVisible();
  const cardLeft=(await cardGantt.boundingBox())!,cardRight=(await cardFlow.boundingBox())!;
  expect(cardRight.x).toBeGreaterThan(cardLeft.x+cardLeft.width);expect(cardRight.y).toBe(cardLeft.y);
  const front=await card.locator('[data-thumbnail-node=front]').boundingBox(), back=await card.locator('[data-thumbnail-node=back]').boundingBox();
  expect(front!.x).toBe(back!.x);
  expect((await card.boundingBox())!.height).toBeLessThan(300);
  await expect(card.locator('details')).toHaveCount(0);
  await card.getByRole('button',{name:'查看流程 DCIM AI 工作流V1.0',exact:true}).scrollIntoViewIfNeeded();
  const before=await page.locator('.template-card').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().toJSON()));
  await page.screenshot({path:info.outputPath('template-overview-desktop.png'),animations:'disabled'});
  await card.getByRole('button',{name:'查看流程 DCIM AI 工作流V1.0',exact:true}).click();
  const preview=page.getByRole('dialog',{name:'流程预览'});
  await expect(preview).toBeVisible();
  const gantt=preview.getByRole('region',{name:'甘特预览'}),flow=preview.getByRole('region',{name:'流程预览'});
  await expect(gantt.locator('.template-plan-row')).toHaveCount(5);await expect(flow.locator('[data-template-node]')).toHaveCount(7);
  const left=(await gantt.boundingBox())!,right=(await flow.boundingBox())!;expect(right.x).toBeGreaterThan(left.x+left.width);expect(right.y).toBe(left.y);
  await flow.getByRole('button',{name:'联调测试',exact:true}).click();await expect(gantt.getByRole('button',{name:'工期：联调测试',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(preview.locator('.template-preview-selection')).toContainText('前置：前端开发、后端开发');
  await gantt.getByRole('button',{name:'工期：需求设计',exact:true}).click();await expect(flow.getByRole('button',{name:'需求设计',exact:true})).toHaveAttribute('aria-pressed','true');
  await flow.locator('[data-template-node=release]').click();await expect(preview.locator('.template-preview-selection')).toContainText('第 8 个工作日结束');
  await preview.getByText('用途说明',{exact:true}).click();await expect(preview).toContainText('这里保留完整说明');
  expect(await page.locator('.template-card').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().toJSON()))).toEqual(before);
  await expect(preview.locator('.modal-body')).toHaveJSProperty('scrollTop',0);
  await page.screenshot({path:info.outputPath('template-preview.png'),animations:'disabled'});
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  expect(await page.locator('.template-card').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().toJSON()))).toEqual(before);
  expect(writes).toEqual([]);
});

test('流程列表无需分页，窄屏至大屏没有图内滚动条', {tag:'@responsive'}, async ({page}, info) => {
  await fixture(page,21);
  for (const width of [390,768,1280,1536,1920,2560]) {
    await page.setViewportSize({width,height:900});
    const grid=page.locator('.template-catalog');
    expect(await grid.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(1);
    await expect(page.getByRole('navigation',{name:'流程列表分页'})).toHaveCount(0);
    await expect(page.locator('.template-card')).toHaveCount(21);
    const card=page.locator('.template-card').first();
    const cardLeft=(await card.locator('.template-thumbnail-gantt').boundingBox())!,cardRight=(await card.locator('.template-thumbnail-flow').boundingBox())!;
    if(width<=800){expect(cardRight.y).toBeGreaterThan(cardLeft.y+cardLeft.height);expect(cardRight.x).toBe(cardLeft.x);}
    else{expect(cardRight.x).toBeGreaterThan(cardLeft.x+cardLeft.width);expect(cardRight.y).toBe(cardLeft.y);}
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const scrollable=await grid.evaluate(root=>[root,...root.querySelectorAll('*')].filter(node=>{
      const style=getComputedStyle(node);
      return (/auto|scroll/.test(style.overflowY)&&node.scrollHeight>node.clientHeight+1)||(/auto|scroll/.test(style.overflowX)&&node.scrollWidth>node.clientWidth+1);
    }).length);
    expect(scrollable).toBe(0);
    if(width===390||width===1920)await page.screenshot({path:info.outputPath(`template-cards-${width}.png`),animations:'disabled'});
    if (width===390) {
      await page.locator('.template-name-button').first().click();
      const preview=page.getByRole('dialog',{name:'流程预览'}), box=await preview.boundingBox();
      expect(box!.width).toBeLessThanOrEqual(390);expect(box!.x).toBeGreaterThanOrEqual(0);
      const panes=await preview.locator('.template-preview-pane').all();const top=(await panes[0].boundingBox())!,bottom=(await panes[1].boundingBox())!;
      expect(bottom.y).toBeGreaterThan(top.y+top.height);expect(bottom.x).toBe(top.x);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await expect(preview.locator('.modal-body')).toHaveJSProperty('scrollTop',0);
      await page.screenshot({path:info.outputPath('template-preview-mobile.png'),animations:'disabled'});
      await preview.getByRole('button',{name:'关闭',exact:true}).click();
    }
  }
  await page.locator('.template-card').last().getByRole('button',{name:/查看流程/}).click();
  const scroll=await page.evaluate(()=>window.scrollY);
  expect(scroll).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(()=>window.scrollY)).toBe(scroll);
});

test('长名称、多分支换行和跨层连线保持可读',{tag:'@responsive'}, async ({page}, info) => {
  const roots=Array.from({length:5},(_,i)=>item('root'+i,'并行工作'+i+'：接口适配与跨模块边界检查',0,2));
  await page.setViewportSize({width:390,height:844});
  await fixture(page,1,[...roots,item('join','集成验证',2,2,roots.map(node=>node.id)),item('end','交付基线',4,0,['root0','join'],'milestone')]);
  await page.locator('.template-card').getByRole('button',{name:/查看流程/}).click();
  const card=page.getByRole('dialog',{name:'流程预览'});
  await expect(card.locator('[data-template-edge]')).toHaveCount(7);
  const intersections=await card.evaluate(el=>{
    const boxes=[...el.querySelectorAll<HTMLElement>('[data-template-node]')].map(node=>node.getBoundingClientRect());
    return [...el.querySelectorAll<SVGPathElement>('[data-template-edge]')].filter(path=>{
      const length=path.getTotalLength(),matrix=path.getScreenCTM()!;
      for(let distance=2;distance<length-2;distance+=2){
        const point=path.getPointAtLength(distance),screen=new DOMPoint(point.x,point.y).matrixTransform(matrix);
        if(boxes.some(box=>screen.x>box.left+1&&screen.x<box.right-1&&screen.y>box.top+1&&screen.y<box.bottom-1))return true;
      }
      return false;
    }).map(path=>path.dataset.templateEdge);
  });
  expect(intersections).toEqual([]);
  expect(await card.locator('[data-template-node]').evaluateAll(nodes=>nodes.filter(node=>node.scrollWidth>node.clientWidth+1).length)).toBe(0);
  await page.screenshot({path:info.outputPath('template-overview-branches-mobile.png'),animations:'disabled',fullPage:true});
});


test('长工期预览可横向滚动，名称保留且不写入流程',{tag:'@responsive'},async({page})=>{
 const {writes}=await fixture(page,1,[item('a','长周期工作',0,120),item('b','一天验证',120,1,['a'])]);
 await page.locator('.template-name-button').first().click();const preview=page.getByRole('dialog',{name:'流程预览'}),pane=preview.getByRole('region',{name:'甘特预览'}).locator('.template-preview-scroll');
 expect(await pane.evaluate(e=>e.scrollWidth>e.clientWidth)).toBe(true);
 const label=preview.locator('[data-template-work=b]'),before=(await label.boundingBox())!.x;
 await pane.evaluate(e=>{e.scrollLeft=300;});expect((await label.boundingBox())!.x).toBeCloseTo(before,0);
 expect((await preview.getByRole('button',{name:'工期：一天验证',exact:true}).locator('.template-plan-bar').boundingBox())!.width).toBeGreaterThanOrEqual(9);
 expect(writes).toEqual([]);
});

test('编辑页预览使用未保存草稿，关闭后继续编辑',async({page},info)=>{
 const {writes}=await fixture(page,1);
 await page.goto('/templates?projectId=p1&edit=t0&templateNode=req');await expect(page.locator('[data-layout-ready=true]')).toBeVisible();
 await page.getByRole('group',{name:'需求设计',exact:true}).click();
 const duration=page.getByLabel('预计工期',{exact:true});await duration.fill('5');await duration.press('Tab');
 await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('button',{name:'流程预览',exact:true}).click();const preview=page.getByRole('dialog',{name:'流程预览'});
 await expect(preview.locator('.template-preview-summary')).toContainText('11 个工作日');await preview.locator('[data-template-node=req]').click();await expect(preview.locator('.template-preview-selection')).toContainText('工期 5 天');
 await page.screenshot({path:info.outputPath('draft-preview.png'),animations:'disabled'});
 await preview.getByRole('button',{name:'关闭',exact:true}).click();await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeVisible();expect(writes).toEqual([]);
});
