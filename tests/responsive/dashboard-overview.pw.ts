import {chooseOption} from './select-helper';
import {expect,test,type Page} from '@playwright/test';
import {mockGanttData,requirement} from './gantt-fixture';
import {workspaceFixture} from './workspace-fixture';
import type {Requirement} from '../../src/client/types';
const row = (id: string, extra: Partial<Requirement> = {}) => ({ ...requirement, id, title: id,
  plannedEnd: '2026-09-17', createdAt: '2026-08-01T00:00:00.000Z', riskLevel: 'low', highRisk: false, delayed: false, ...extra });
const fixtureRows = () => [
  row('正常进行'),
  row('进行且延期', { plannedEnd: '2026-09-09', highRisk: true, delayed: true, riskLevel: 'high' }),
  row('未开始高风险', { status: 'not_started', plannedEnd: '2026-09-16', highRisk: true, riskLevel: 'high' }),
  row('排期待确认', { plannedStart: null, plannedEnd: null, scheduleComplete: false, riskEvaluated: false }),
  row('最近完成但曾延期', { status: 'completed', actualEnd: '2026-09-08', executionCompletedAt: '2026-09-08', highRisk: true, delayed: true }),
  row('历史完成', { status: 'completed', actualEnd: '2026-08-01' }),
  row('已取消', { status: 'cancelled', actualEnd: '2026-09-10', highRisk: true, delayed: true }),
  row('最近新增', { status: 'not_started', plannedEnd: '2026-09-25', createdAt: '2026-09-11T00:00:00.000Z' }),
];

async function setup(page:Page){
 await mockGanttData(page);const state={asOfDate:'2026-09-11',rows:fixtureRows().map(r=>({...r,executionMode:'direct' as const,executionCompletedAt:r.status==='completed'?r.actualEnd:null,workItems:[]}))};
 const workspace=(id='p1')=>workspaceFixture(id,id==='p1'?'项目一':'项目二',state.rows,state.asOfDate);
 await page.route('**/api/projects',route=>route.fulfill({json:[{id:'p1',name:'项目一',status:'active'},{id:'p2',name:'项目二',status:'active'}]}));
 await page.route('**/api/projects/*/path-graph*',route=>route.fulfill({json:{analysis:workspace(new URL(route.request().url()).pathname.split('/')[3]).analysis}}));
 await page.route('**/api/dashboard**',route=>{const id=new URL(route.request().url()).searchParams.get('projectId')||'p1';return route.fulfill({json:{asOfDate:state.asOfDate,requirements:state.rows,featureOverview:workspace(id).overview,summary:{total:state.rows.length},issues:{summary:{},attention:[]},charts:{statuses:[],risks:[],weeks:[],varianceTop:[]}}});});
 for(const r of state.rows)await page.route('**/api/requirements/'+encodeURIComponent(r.id),route=>route.fulfill({json:r}));
 return state;
}
const cards=(page:Page)=>page.getByRole('region',{name:'当前范围概览'});
const metric=(page:Page,label:string)=>cards(page).locator('.overview-metric').filter({hasText:label});
async function timeScope(page:Page,value:string){await page.getByRole('button',{name:/^更多筛选/}).click();await chooseOption(page.getByLabel('进展时间范围',{exact:true}),value);await page.getByRole('region',{name:'更多进展筛选'}).getByRole('button',{name:'关闭',exact:true}).click();}
async function expectRows(page:Page,names:string[]){await expect(page.locator('.workspace-gantt-row.kind-requirement .workspace-row-title')).toHaveCount(names.length);expect((await page.locator('.workspace-gantt-row.kind-requirement .workspace-row-title').allTextContents()).sort()).toEqual([...names].sort());}
test('范围汇总不随列表筛选变化，概览打开完整对象并保留筛选',async({page})=>{
 await setup(page);await page.goto('/execution');await chooseOption(page.getByLabel('展开层级',{exact:true}),'requirements');
 await expect(metric(page,'近7天完成')).toContainText('1 · 累计 2');await expect(metric(page,'推进中')).toContainText('3');await expect(cards(page)).not.toContainText('完成率');
 await page.getByPlaceholder('搜索名称或编号').fill('完全不匹配');await expect(page.getByRole('treegrid',{name:'项目进展表'}).getByText('没有符合筛选条件的内容',{exact:true})).toBeVisible();await expect(metric(page,'推进中')).toContainText('3');
 await page.getByRole('button',{name:'展开概览',exact:true}).click();const overview=page.getByRole('dialog');await expect(overview.getByRole('button',{name:'最近完成但曾延期',exact:true}).first()).toBeVisible();await overview.getByRole('button',{name:'最近完成但曾延期',exact:true}).first().click();await expect(page.getByRole('dialog').getByRole('heading',{name:'最近完成但曾延期',exact:true})).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();await expect(page.getByPlaceholder('搜索名称或编号')).toHaveValue('完全不匹配');
 await page.getByRole('button',{name:'重置',exact:true}).click();await timeScope(page,'due_soon');await expectRows(page,['正常进行','未开始高风险']);
});
test('时间范围刷新与项目隔离，跨日零结果不扩大范围',async({page})=>{
 const state=await setup(page);await page.goto('/execution');await chooseOption(page.getByLabel('展开层级',{exact:true}),'requirements');await timeScope(page,'due_soon');await page.reload();await expectRows(page,['正常进行','未开始高风险']);
 await page.locator('.project-switcher-button').click();await page.getByRole('option',{name:'项目二',exact:true}).click();expect(new URL(page.url()).searchParams.get('progressScope')).toBeNull();
 await page.locator('.project-switcher-button').click();await page.getByRole('option',{name:'项目一',exact:true}).click();await expectRows(page,['正常进行','未开始高风险']);
 state.asOfDate='2026-09-18';await page.reload();await expect(page.getByRole('treegrid',{name:'项目进展表'}).getByText('没有符合筛选条件的内容',{exact:true})).toBeVisible();expect(new URL(page.url()).searchParams.get('progressScope')).toBe('due_soon');await expect(metric(page,'近7天完成')).toContainText('0 · 累计 2');await page.getByRole('button',{name:'重置',exact:true}).click();await expect(page.locator('.workspace-gantt-row.kind-requirement')).not.toHaveCount(0);
 state.rows=[];await page.reload();await expect(metric(page,'推进中')).toContainText('0');await expect(metric(page,'近7天完成')).toContainText('0 · 累计 0');
});
test('概览键盘入口与四项指标在当前视口和窄屏内可读',{tag:'@responsive'},async({page},info)=>{
 await setup(page);for(const viewport of [info.project.use.viewport!,{width:390,height:844}]){await page.setViewportSize(viewport);await page.goto('/execution');const trigger=page.getByRole('button',{name:'展开概览',exact:true});await trigger.focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);await page.keyboard.press('Escape');await expect(trigger).toBeFocused();await expect(cards(page).locator('.overview-metric')).toHaveCount(4);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await cards(page).screenshot({path:info.outputPath('overview-'+viewport.width+'.png')});}
});
test('所有主题及日夜模式保留概览统计和筛选，指标尺寸稳定',{tag:'@responsive'},async({page})=>{
 await setup(page);await page.goto('/execution?q=正常');for(const theme of ['classic','swiss','forest','midnight','soft','industrial','dcim']){await page.evaluate(value=>{localStorage.setItem('project-manage:theme',value);window.dispatchEvent(new StorageEvent('storage',{key:'project-manage:theme',newValue:value}));},theme);for(const colorScheme of ['light','dark'] as const){await page.emulateMedia({colorScheme});await expect(metric(page,'推进中')).toContainText('3');await expect(page.getByPlaceholder('搜索名称或编号')).toHaveValue('正常');const heights=await cards(page).locator('.overview-metric').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height));expect(Math.max(...heights)-Math.min(...heights)).toBeLessThanOrEqual(1);expect(Math.max(...heights)).toBeLessThanOrEqual(60);}}
});
test('日志页分页调用可运行，换页大小回到第一页', async ({ page }) => {
  await mockGanttData(page);
  const requests: URLSearchParams[] = [];
  await page.route('**/api/audit/search?*', route => {
    const params = new URL(route.request().url()).searchParams; requests.push(params);
    return route.fulfill({ json: { items: [{ id: 'log', createdAt: '2026-09-11T00:00:00.000Z', actorType: 'user', actorName: '管理员', action: 'update', entityType: 'requirement', summary: '更新需求' }],
      total: 120, page: Number(params.get('page')), pageSize: Number(params.get('pageSize')), pages: Math.ceil(120 / Number(params.get('pageSize'))), snapshot: 777 } });
  });
  await page.goto('/logs');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.get('page')).toBe('2');
  expect(requests.at(-1)?.get('snapshot')).toBe('777');
  await chooseOption(page.getByLabel('每页数量', { exact: true }), '20');
  await expect.poll(() => requests.at(-1)?.get('pageSize')).toBe('20');
  expect(requests.at(-1)?.get('page')).toBe('1');
});
