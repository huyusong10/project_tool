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
  await expect(page.locator('.template-card')).toHaveCount(Math.min(20,count));
  return {templates,writes};
}

test('概览默认显示分支与里程碑，预览不移动卡片或写入流程', async ({page}, info) => {
  const {writes}=await fixture(page);
  const card=page.locator('.template-card').first();
  await expect(card.locator('[data-template-node]')).toHaveCount(7);
  await expect(card.locator('[data-template-edge]')).toHaveCount(7);
  await expect(card.getByText('需求基线',{exact:true})).toBeVisible();
  const front=await card.locator('[data-template-node=front]').boundingBox(), back=await card.locator('[data-template-node=back]').boundingBox();
  expect(front!.y).toBe(back!.y);
  await expect(card.locator('details')).toHaveCount(0);
  const before=await page.locator('.template-card').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().toJSON()));
  await page.screenshot({path:info.outputPath('template-overview-desktop.png'),animations:'disabled'});
  await card.getByRole('button',{name:'查看流程 DCIM AI 工作流V1.0',exact:true}).click();
  const preview=page.getByRole('dialog',{name:'流程详情'});
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('前置：前端开发、后端开发');
  await expect(preview).toContainText('第 8 个工作日结束');
  await expect(preview).toContainText('这里保留完整说明');
  expect(await page.locator('.template-card').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().toJSON()))).toEqual(before);
  await expect(preview.locator('.modal-body')).toHaveJSProperty('scrollTop',0);
  await page.screenshot({path:info.outputPath('template-preview.png'),animations:'disabled'});
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  expect(await page.locator('.template-card').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().toJSON()))).toEqual(before);
  expect(writes).toEqual([]);
});

test('流程卡片在窄屏至大屏保持可读、两三列对比及稳定分页', async ({page}, info) => {
  await fixture(page,21);
  for (const width of [390,768,1280,1536,1920,2560]) {
    await page.setViewportSize({width,height:900});
    const grid=page.locator('.template-grid');
    const columns=await grid.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(columns).toBeGreaterThanOrEqual(1); expect(columns).toBeLessThanOrEqual(3);
    if (width===1280) expect(columns).toBe(2);
    if (width>=1920) expect(columns).toBe(3);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const clipped=await page.locator('.template-structure-node').evaluateAll(nodes=>nodes.filter(node=>node.scrollWidth>node.clientWidth+1).length);
    expect(clipped).toBe(0);
    if (width===390) {
      await page.locator('.template-name-button').first().click();
      const preview=page.getByRole('dialog',{name:'流程详情'}), box=await preview.boundingBox();
      expect(box!.width).toBe(390);
      expect(box!.x).toBe(0); expect(box!.y).toBe(0);
      await expect(preview.locator('.modal-body')).toHaveJSProperty('scrollTop',0);
      await page.screenshot({path:info.outputPath('template-preview-mobile.png'),animations:'disabled'});
      await preview.getByRole('button',{name:'关闭',exact:true}).click();
    }
  }
  const pager=page.getByRole('navigation',{name:'流程列表分页'});
  await pager.getByRole('button',{name:'下一页',exact:true}).click();
  await expect(page.locator('.template-card')).toHaveCount(1);
  await page.locator('.template-name-button').click();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/page=2/);
});

test('长名称、多分支换行和跨层连线保持可读', async ({page}, info) => {
  const roots=Array.from({length:5},(_,i)=>item('root'+i,'并行工作'+i+'：接口适配与跨模块边界检查',0,2));
  await page.setViewportSize({width:390,height:844});
  await fixture(page,1,[...roots,item('join','集成验证',2,2,roots.map(node=>node.id)),item('end','交付基线',4,0,['root0','join'],'milestone')]);
  const card=page.locator('.template-card');
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
