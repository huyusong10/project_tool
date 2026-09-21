import { expect, test, type Page } from '@playwright/test';
import { analyticsCatalog, type AnalyticsPanelConfig } from '../../src/shared/analytics';
import {chooseOption,selectedValue} from './select-helper';
import {todayIso} from '../../src/shared/domain';
import {workspaceFixture} from './workspace-fixture';
import {closeGraphProperties} from './graph-interactions';
import { mockGanttData, mockGanttReport, requirement } from './gantt-fixture';

async function setup(page: Page) {
  await mockGanttData(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const items = [
    { ...requirement, id: 'risk', title: '高风险样本', status: 'in_progress' as const, progress: 70, riskLevel: 'high', highRisk: true, riskReason: '进度落后' },
    { ...requirement, id: 'unscheduled', title: '未排期样本', status: 'not_started' as const, plannedStart: null, plannedEnd: null, scheduleComplete: false, riskEvaluated: false, workItems: [] },
    ...Array.from({ length: 25 }, (_, i) => ({ ...requirement, id: `r${i}`, title: `普通样本 ${String(i).padStart(2, '0')}` })),
  ].map(r=>({...r,workItems:r.workItems.map(w=>({...w,id:r.id+':'+w.id,requirementId:r.id}))}));
  await mockGanttReport(page, () => items);
  await page.route('**/api/requirements**', route => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: url.pathname === '/api/requirements' ? items : items.find(r => url.pathname === '/api/requirements/' + r.id) || requirement });
  });
  await page.route('**/api/action-items?**', route => {
    const params = new URL(route.request().url()).searchParams;
    const current = Number(params.get('page') || 1), pageSize = Number(params.get('pageSize') || 10);
    return route.fulfill({ json: { asOfDate: '2026-09-09', total: 40, pages: Math.ceil(40/pageSize), page: current, pageSize,
      summary: { total: 40, high: 40, medium: 0, low: 0, byReason: {} }, ownerOptions: [],
      items: [{ id: 'a', title: '处理进度落后', severity: 'high', reasons: [{ label: '进度落后' }], targetPath: '/requirements/risk', overdueWorkdays: 0 }],
    } });
  });
  return items;
}

const rows=(page:Page)=>page.locator('.outline-table [data-object-kind="requirement"]');
const title=(page:Page,name:string)=>page.locator('.outline-title').filter({hasText:new RegExp('^'+name+'$')});

test('列表与详情共享风险和偏差含义，返回、刷新恢复查询和排序', async ({ page }) => {
  await setup(page);await page.goto('/requirements?q=高风险&outlineSort=name');
  await expect(rows(page)).toHaveCount(1);const source=page.url();
  await title(page,'高风险样本').click();
  await expect(page.locator('.object-facts > div').filter({has:page.locator('dt',{hasText:'风险'})})).toContainText('高风险');
  await expect(page.getByText('风险已关闭',{exact:true})).toHaveCount(0);
  await closeGraphProperties(page);await expect(page).toHaveURL(url=>{url.searchParams.delete('pathInspector');return url.href===source;});
  await expect(page.getByLabel('筛选清单')).toHaveValue('高风险');
  await expect(selectedValue(page.getByLabel('清单排序'))).toHaveValue('name');
  await page.reload();await expect(rows(page)).toHaveCount(1);
  await page.goto('/requirements?q=未排期');await expect(rows(page)).toContainText('未排期样本');
  await title(page,'未排期样本').click();
  const variance=page.locator('.object-facts > div').filter({has:page.locator('dt',{hasText:'偏差'})});
  await expect(variance).toContainText('未排期');await expect(variance).not.toContainText('0 工作日');
});

test('长列表往返恢复滚动；侧栏重新进入恢复原筛选；显式链接优先', async ({ page }) => {
  await setup(page);await page.goto('/requirements?q=普通&outlineSort=name');
  await expect(rows(page)).toHaveCount(25);
  const target=title(page,'普通样本 20'),body=page.locator('.outline-scroll');
  await target.scrollIntoViewIfNeeded();const scroll=await body.evaluate(el=>el.scrollTop);expect(scroll).toBeGreaterThan(0);
  await target.click();await expect(page.locator('.requirement-overview')).toBeVisible();
  await closeGraphProperties(page);await expect(target).toBeVisible();
  await expect.poll(()=>body.evaluate(el=>el.scrollTop)).toBeGreaterThanOrEqual(scroll-5);
  await page.getByRole('link',{name:'问题跟踪',exact:true}).click();await page.getByRole('link',{name:'项目空间',exact:true}).click();await expect(page.getByLabel('筛选清单')).toHaveValue('普通');
  await page.goto('/requirements?q=未排期');await expect(rows(page)).toHaveCount(1);await expect(rows(page)).toContainText('未排期样本');
});

test('异常行动的自动优先级和分页在往返后保持', async ({ page }) => {
  await setup(page);await page.goto('/actions?severity=high&page=2');
  await expect(selectedValue(page.getByLabel('处理优先级'))).toHaveValue('high');
  await page.getByRole('button',{name:/处理进度落后/}).click();await expect(page.locator('.requirement-overview')).toBeVisible();
  await page.goBack();await expect(page).toHaveURL(/severity=high&page=2/);
  await expect(selectedValue(page.getByLabel('处理优先级'))).toHaveValue('high');
  await page.goto('/actions');await expect(page).toHaveURL(/page=2/);
});

test('项目之间分别记忆筛选，显式链接不混入历史条件', async ({ page }) => {
  const items=await setup(page);
  await page.route('**/api/projects',route=>route.fulfill({json:[{id:'p1',name:'第一项目',status:'active'},{id:'p2',name:'第二项目',status:'active'}]}));
  const workspace=workspaceFixture('p2','第二项目',items);
  await page.route('**/api/projects/p2/**',route=>{const path=new URL(route.request().url()).pathname;return route.fulfill({json:path.endsWith('/path-graph')?{analysis:workspace.analysis}:path.endsWith('/features')?{features:workspace.features}:path.endsWith('/feature-overview')?workspace.overview:[]});});
  await page.goto('/requirements?q=普通');await expect(page.getByLabel('筛选清单')).toHaveValue('普通');
  await page.locator('.project-switcher-button').click();await page.getByRole('option',{name:'第二项目'}).click();
  await expect(page.getByLabel('筛选清单')).toHaveValue('');
  await page.getByLabel('筛选清单').fill('高风险');
  await page.locator('.project-switcher-button').click();await page.getByRole('option',{name:'第一项目'}).click();
  await expect(page.getByLabel('筛选清单')).toHaveValue('普通');
  await page.goto('/requirements?q=未排期');await expect(rows(page)).toHaveCount(1);await expect(page.getByLabel('筛选清单')).toHaveValue('未排期');
});

test('问题全部状态与分页在刷新后保持', async ({ page }) => {
  await setup(page);
  await page.route('**/api/issues?**', route => route.fulfill({ json: {
    items: [], total: 120, pages: 6, page: Number(new URL(route.request().url()).searchParams.get('page') || 1), pageSize: 20,
    summary: { total: 120, active: 120, inProgress: 120, deferred: 0, resolved: 0, highPriority: 0, overdue: 0, unassigned: 0 },
  } }));
  await page.goto('/issues?status=&page=2');
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator('.table-pagination [aria-current=page]')).toHaveText('2');
  await page.reload();
  await expect(page).toHaveURL(/status=&page=2/);
  await expect(page.locator('.table-pagination [aria-current=page]')).toHaveText('2');
});

test('统计页区分零数量、无完成样本和真实零按期率，并恢复时间范围', async ({ page }) => {
  await setup(page);
  const panels: AnalyticsPanelConfig[] = [
    { id: 'rate', title: '按期完成率', dataset: 'requirements', measure: 'on_time_rate', visualization: 'kpi', size: 'small', timeScope: 'range' },
    { id: 'count', title: '完成数量', dataset: 'requirements', measure: 'completed_count', visualization: 'kpi', size: 'small', timeScope: 'range' },
  ];
  let sampleCount = 0;
  await page.route('**/api/analytics/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('catalog')) return route.fulfill({ json: analyticsCatalog });
    if (path.endsWith('layout')) return route.fulfill({ json: { layout: { version: 1, panels }, canCustomize: true, source: 'default', updatedAt: null } });
    return route.fulfill({ json: { asOfDate: '2026-09-09', results: panels.map(p => ({ panelId: p.id, rows: [{ key: 'total', label: '总计', value: 0, sampleCount }], measureLabel: p.title, unit: p.id === 'rate' ? 'percent' : 'count', snapshot: false })) } });
  });
  await page.goto('/analytics');
  await expect(page.locator('.analytics-kpi').first()).toContainText('暂无完成样本');
  await expect(page.locator('.analytics-kpi strong').nth(1)).toHaveText('0');
  await page.getByRole('button', { name: '近30天', exact: true }).click();
  await expect(page).toHaveURL(/range=30/);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('pm-page-view:admin:p1:/analytics'))).toContain('range=30');
  await page.goto('/requirements');
  await page.goto('/analytics');
  await expect(page).toHaveURL(/range=30/);
  sampleCount = 2;
  await page.reload();
  await expect(page.locator('.analytics-kpi strong').first()).toHaveText('0%');
});

test('负责人归档后历史问题筛选保持原范围且可切换清空',async({page},info)=>{
  const post=async(url:string,data:object)=>{const r=await page.request.post(url,{data});expect(r.ok(),await r.text()).toBe(true);return r.json();};
  await post('/api/login',{username:'admin',password:'41_xc7q0qOjo4Inw!'});const project=await post('/api/projects',{name:'历史负责人筛选 '+Date.now()});
  const a=await post('/api/people',{projectId:project.id,name:'历史负责人甲 '+Date.now()}),b=await post('/api/people',{projectId:project.id,name:'当前负责人乙 '+Date.now()});
  const issues=[];for(const [person,title] of [[a,'甲负责的已解决问题'],[b,'乙负责的已解决问题']] as const){const issue=await post('/api/issues',{projectId:project.id,title,ownerId:person.id,discoveredAt:todayIso()});issues.push(await post('/api/issues/'+issue.id+'/resolve',{expectedVersion:issue.version,content:'已核对解决'}));}
  const url='/issues?'+new URLSearchParams({projectId:project.id,status:'resolved',ownerId:a.id});await page.goto(url);const owner=page.locator('.issue-filters').getByRole('combobox').nth(2),rowA=page.getByRole('row').filter({hasText:'甲负责的已解决问题'}),rowB=page.getByRole('row').filter({hasText:'乙负责的已解决问题'});await expect(selectedValue(owner)).toHaveValue(a.id);await expect(rowA).toBeVisible();await expect(rowB).toHaveCount(0);
  const archived=await page.request.delete('/api/people/'+a.id,{data:{expectedUpdatedAt:a.updatedAt}});expect(archived.ok(),await archived.text()).toBe(true);await page.reload();
  const filtered=await(await page.request.get('/api/issues?'+new URLSearchParams({projectId:project.id,status:'resolved',ownerId:a.id}))).json();expect(filtered.total).toBe(1);expect(filtered.items[0].id).toBe(issues[0].id);
  await expect(selectedValue(owner)).toHaveValue(a.id);expect(new URL(page.url()).searchParams.get('ownerId')).toBe(a.id);await expect(rowB).toHaveCount(0);await expect(rowA).toBeVisible();
    expect(await selectedValue(owner).locator('option:checked').textContent()).toBe(a.name);await page.setViewportSize({width:390,height:844});await owner.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('archived-issue-owner-filter-390.png'),animations:'disabled'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await chooseOption(owner,b.id);await expect(rowB).toBeVisible();await expect(rowA).toHaveCount(0);await chooseOption(owner,'');await expect(rowA).toBeVisible();await expect(rowB).toBeVisible();
    await page.goto('/issues?'+new URLSearchParams({projectId:project.id,status:'resolved',ownerId:'no-such-person'}));await expect(selectedValue(owner)).toHaveValue('no-such-person');await expect(rowA).toHaveCount(0);await expect(rowB).toHaveCount(0);await chooseOption(owner,'');await expect(rowA).toBeVisible();await expect(rowB).toBeVisible();
  for(const issue of issues)expect(await(await page.request.get('/api/issues/'+issue.id)).json()).toEqual(issue);
});

test('需求归档后问题筛选仍明确保留原范围',async({page})=>{
  const post=async(url:string,data:object)=>{const r=await page.request.post(url,{data});expect(r.ok(),await r.text()).toBe(true);return r.json();};
  await post('/api/login',{username:'admin',password:'41_xc7q0qOjo4Inw!'});const project=await post('/api/projects',{name:'历史范围筛选 '+Date.now()}),owner=await post('/api/people',{projectId:project.id,name:'范围负责人 '+Date.now()});
  let requirement=await post('/api/requirements',{projectId:project.id,ownerId:owner.id,title:'待归档的已完成需求'});
  for(const [requirementId,title] of [[requirement.id,'需求内历史问题'],[null,'其他公共问题']] as const){const issue=await post('/api/issues',{projectId:project.id,title,requirementId,ownerId:owner.id,discoveredAt:todayIso()});await post('/api/issues/'+issue.id+'/resolve',{expectedVersion:issue.version,content:'已确认解决'});}
  requirement=await post('/api/requirements/'+requirement.id+'/start',{expectedVersion:requirement.version});requirement=await post('/api/requirements/'+requirement.id+'/complete',{expectedVersion:requirement.version});
  await page.goto('/issues?'+new URLSearchParams({projectId:project.id,status:'resolved',requirementId:requirement.id}));const scope=page.locator('.issue-filters').getByRole('combobox').nth(3),own=page.getByRole('row').filter({hasText:'需求内历史问题'}),other=page.getByRole('row').filter({hasText:'其他公共问题'});await expect(selectedValue(scope)).toHaveValue(requirement.id);await expect(own).toBeVisible();await expect(other).toHaveCount(0);
  const archived=await page.request.delete('/api/requirements/'+requirement.id,{data:{expectedVersion:requirement.version}});expect(archived.ok(),await archived.text()).toBe(true);await page.reload();
  const filtered=await(await page.request.get('/api/issues?'+new URLSearchParams({projectId:project.id,status:'resolved',requirementId:requirement.id}))).json();expect(filtered.total).toBe(0);
  await expect(selectedValue(scope)).toHaveValue(requirement.id);expect(new URL(page.url()).searchParams.get('requirementId')).toBe(requirement.id);await expect(other).toHaveCount(0);await expect(own).toHaveCount(0);
  await chooseOption(scope,'public');await expect(other).toBeVisible();await chooseOption(scope,'');await expect(other).toBeVisible();await expect(own).toHaveCount(0);
  const archives=await(await page.request.get('/api/archives?projectId='+project.id)).json();expect(archives.requirements.find((r:{id:string})=>r.id===requirement.id).linkedIssueCount).toBe(1);
});
