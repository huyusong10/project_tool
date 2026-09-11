import { test, expect, type Page } from '@playwright/test';
import { mockGanttData, requirement } from './gantt-fixture';
import { analysePaths } from '../../src/shared/paths';
import { req, work } from '../fixtures/path-network';

async function setup(page: Page) {
  await mockGanttData(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const data = analysePaths({ projectId: 'p1', projectName: '测试项目', projectEnd: '2026-09-30', revision: 1, asOfDate: '2026-09-11',
    requirements: [{ ...req('r1'), projectId: 'p1', title: requirement.title }, { ...req('r2'), projectId: 'p1', title: '关联需求' }],
    workItems: [work('w1', 'r1', 2), work('w2', 'r2', 3)],
    dependencies: [{ id: 'edge', projectId: 'p1', sourceRequirementId: 'r1', sourceWorkItemId: 'w1', targetRequirementId: 'r2', targetWorkItemId: 'w2', origin: 'manual' }],
  });
  await page.route('**/api/requirements/r2', r => r.fulfill({ json: { ...requirement, id: 'r2', title: '关联需求', workItems: [] } }));
  data.featureContext={overview:{asOfDate:data.asOfDate,recentFrom:data.asOfDate,groups:[],ungroupedCount:2},relations:[],requirements:data.requirements};
  await page.route('**/path-graph*', r => r.fulfill({ json: {analysis:data} }));
}
const ready=(page:Page)=>expect(page.locator('[data-layout-ready="true"]')).toBeVisible();
const viewport=(page:Page)=>page.locator('.react-flow__viewport').evaluate(n=>(n as HTMLElement).style.transform);
const root=(page:Page)=>page.getByRole('group',{name:'路径根视图'}).getByRole('button',{name:'全部需求',exact:true});
const back=(page:Page)=>page.getByRole('button',{name:'返回上一画布',exact:true}).click();
async function openRequirement(page:Page,id:string){await page.locator('.react-flow__node[data-id="'+id+'"] .dependency-card').click();await page.getByRole('button',{name:'进入工作项图',exact:true}).click();await ready(page);}

test('需求详情进入所属特性层级，画布返回恢复详情而不绕圈',async({page})=>{
 await setup(page);await page.goto('/requirements/r1');await expect(page.locator('.requirement-overview')).toBeVisible();
 for(let i=0;i<2;i++){await page.getByRole('button',{name:'路径分析',exact:true}).click();await ready(page);await expect(page).toHaveURL(/root=features/);await expect(page.getByRole('navigation',{name:'画布层级'})).toContainText('未归属需求');await back(page);await expect(page.locator('.requirement-overview')).toBeVisible();}
 await page.goForward();await ready(page);await page.goBack();await expect(page.locator('.requirement-overview')).toBeVisible();
});
test('外部工作项进入其所属层级，返回保持原来的选择',async({page})=>{
 await setup(page);await page.goto('/paths?view=project&pathScope=all');await ready(page);await openRequirement(page,'r2');
 await page.locator('.react-flow__node[data-id="w1"] .dependency-card').click();await page.getByRole('button',{name:'进入工作项图',exact:true}).click();await ready(page);await expect(page).toHaveURL(/requirementId=r1/);await page.reload();await ready(page);await back(page);await ready(page);await expect(page).toHaveURL(/requirementId=r2/);await expect(page.locator('.react-flow__node[data-id="w1"]')).toHaveClass(/selected/);
});
test('根视图切换新增访问，返回恢复每次画布的位置与选择',async({page})=>{
 await setup(page);await page.goto('/paths?view=project&pathScope=all');await ready(page);const first=await viewport(page);await openRequirement(page,'r1');await root(page).click();await ready(page);await page.getByLabel('缩小画布',{exact:true}).click();await expect.poll(()=>viewport(page)).not.toBe(first);const second=await viewport(page);await openRequirement(page,'r2');await root(page).click();await ready(page);
 await back(page);await ready(page);await expect(page).toHaveURL(/requirementId=r2/);await page.goBack();await ready(page);await expect.poll(()=>viewport(page)).toBe(second);await expect(page).toHaveURL(/pathNode=r2/);await back(page);await ready(page);await expect(page).toHaveURL(/requirementId=r1/);await back(page);await ready(page);await expect.poll(()=>viewport(page)).toBe(first);await expect(page).toHaveURL(/pathNode=r1/);
});
test('旧链接默认全部需求，窄屏提供明确根入口且导航不重叠',async({page},info)=>{
 await setup(page);await page.setViewportSize({width:390,height:844});await page.goto('/requirements/r1?view=path');await ready(page);await expect(page).toHaveURL(/view=requirement/);await expect(page).toHaveURL(/root=project/);await expect(page.getByRole('button',{name:'返回上一画布',exact:true})).toBeDisabled();await expect(root(page)).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('navigation-narrow.png'),animations:'disabled'});await root(page).click();await ready(page);await expect(page.locator('.canvas-breadcrumb')).toBeEmpty();
});
test('返回较早画布时不套用后来访问的搜索与抽屉状态',async({page})=>{
 await setup(page);await page.goto('/paths?view=features');await ready(page);await page.getByRole('link',{name:'项目进展',exact:true}).click();await page.getByRole('link',{name:'路径分析',exact:true}).click();await ready(page);await page.getByLabel('查找与筛选',{exact:true}).click();await page.locator('.graph-finder input').fill('未归属');await expect(page).toHaveURL(/pathSearch=/);await page.goBack();await expect(page).toHaveURL(/\/$/);await page.goBack();await ready(page);await expect(page).not.toHaveURL(/pathSearch=/);await expect(page.locator('.graph-finder')).not.toBeVisible();
});
test('处理工作项从画布打开详情，返回保留工作项选择',async({page})=>{
 await setup(page);await page.goto('/paths?view=project&pathScope=all');await ready(page);await openRequirement(page,'r1');await page.locator('.react-flow__node[data-id="w1"] .dependency-card').click();await page.getByRole('button',{name:'定位并处理工作项',exact:true}).click();await expect(page).toHaveURL(/\/requirements\/r1\?workItemId=w1/);await page.getByRole('button',{name:'返回',exact:true}).click();await ready(page);await expect(page).toHaveURL(/requirementId=r1/);await expect(page.locator('.react-flow__node[data-id="w1"]')).toHaveClass(/selected/);
});
test('旧草稿历史链接替换为正式地址并转入统一画布',async({page})=>{
 await setup(page);await page.addInitScript(()=>sessionStorage.setItem('pm-editor-ids:admin:p1',JSON.stringify({draft:'r1','draft-work':'w1'})));await page.goto('/requirements/draft?view=path&draftProject=p1&pathNode=draft-work&target=acceptance%3Adraft');await ready(page);await expect(page).toHaveURL(/requirementId=r1/);await expect(page).not.toHaveURL(/draft/);await expect(page).toHaveURL(/pathNode=w1/);expect(await page.evaluate(()=>history.state.idx)).toBe(0);
});
