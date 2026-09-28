import {graphToolbar,graphProperties,openGraphDrafts} from './graph-interactions';
import {addBusinessDays,todayIso} from '../../src/shared/domain';
import type {Requirement} from '../../src/client/types';
import type {PathAnalysis} from '../../src/shared/paths';
import { expect, test, type Page } from '@playwright/test';
import { mockGanttData, mockGanttReport, requirement, workItem } from './gantt-fixture';

async function setup(page: Page) {
  await mockGanttData(page);
  const state = { start: '2026-09-11', end: '2026-09-17' as string | null, manual: null as string | null, revision: 7, reject: false, progress: 61, status: 'in_progress', plannedStart: '2026-09-01' as string | null, plannedEnd: '2026-09-08' as string | null, scheduleComplete: true, writes: [] as Record<string, unknown>[] };
  const forecast = () => ({ revision: state.revision, asOfDate: '2026-09-11', start: state.start, end: state.end, remainingDays: 5, source: '按剩余工作和前置关系计算', reasons: state.end ? [] : ['预计工期缺失'] });
  const item = () => ({ ...workItem, plannedStart: state.plannedStart, plannedEnd: state.plannedEnd, actualStart: state.status === 'not_started' ? null : '2026-09-01', forecastEnd: state.manual, progress: state.progress, status: state.status, deliveryForecast: forecast() });
  const req = () => ({ ...requirement, asOfDate: '2026-09-11', plannedStart: state.plannedStart, plannedEnd: state.plannedEnd, scheduleComplete: state.scheduleComplete, actualStart: item().actualStart, actualEnd: state.status === 'completed' ? '2026-09-11' : null, observationEnd: '2026-09-11', workItems: [item()], progress: state.progress, status: state.status, deliveryForecast: forecast() });
  const analysis = () => ({ projectId: 'p1', asOfDate: '2026-09-11', revision: state.revision, nodes: [
    { id: 'w1', requirementId: 'r1', kind: 'work', title: '接口开发', status: state.status, forecastEnd: state.end, remainingDays: 5, source: state.manual ? '人工预测推算剩余工期' : '按进度估算剩余工期', unknownReasons: state.end ? [] : ['预计工期缺失'], estimate: { forecastEnd: state.manual } },
    { id: 'acceptance:r1', requirementId: 'r1', kind: 'acceptance', status: state.status, forecastEnd: state.end, source: '按工作完成日期计算', unknownReasons: state.end ? [] : ['预计工期缺失'] },
  ], edges: [], milestones: [{ id: 'ready', requirementId: 'r1', projectId: 'p1', title: '提测就绪', achievedAt: '2026-09-08', targetDate: null, version: 1, confirmationMode: 'auto' }] });
  await page.route('**/path-analysis*', route => route.fulfill({ json: analysis() }));
  await page.route('**/api/requirements/r1', route => route.fulfill({ json: req() }));
  await mockGanttReport(page,()=>[req()],()=> '2026-09-11',()=>analysis().milestones as NonNullable<PathAnalysis['milestones']>);
  await page.route('**/api/work-items/w1/path-estimate', async route => {
    const body = route.request().postDataJSON(); state.writes.push(body);
    if (state.reject) { state.revision++; return route.fulfill({ status: 409, json: { error: '项目已更新，请重新读取', code: 'REVISION_CONFLICT' } }); }
    state.manual = body.forecastEnd; state.end = body.forecastEnd || '2026-09-17'; state.revision++;
    await route.fulfill({ json: analysis() });
  });
  return Object.assign(state, { item, req });
}

test('预测延伸到交付日，实际条和完成度仍在今天，双轨与窄屏一致', {tag:'@responsive'}, async ({ page }, info) => {
  const state = await setup(page); await page.goto('/execution');await page.getByRole('button',{name:'展开全部',exact:true}).click();
  const row = page.locator('.workspace-gantt-row.kind-requirement').first(), tail = row.locator('.gantt-forecast-tail');
  await expect(tail).toHaveAttribute('data-end', '2026-09-17');
  await expect(tail).toHaveCSS('border-top-color', await row.locator('.gantt-date-delay').evaluate(el => getComputedStyle(el).borderTopColor));
  await expect(tail).toHaveCSS('border-top-style', 'dashed');
  await expect(row.locator('.gantt-forecast-label')).toHaveCount(0);
  await expect(tail).toHaveAttribute('aria-label', /预计 09\/17 · 还需 4 工作日/);
  await expect(row.locator('.workspace-latest-milestone')).toHaveCount(0);
  const geometry = () => row.evaluate(root => {
    const el = (s: string) => root.querySelector<HTMLElement>(s)!;
    const end = (s: string) => parseFloat(el(s).style.left) + parseFloat(el(s).style.width);
    return { actual: end('.gantt-date-actual'), today: parseFloat(el('.gantt-today-line').style.left), marker: parseFloat(el('.gantt-progress-end').style.left), start: parseFloat(el('.gantt-forecast-tail').style.left), end: end('.gantt-forecast-tail'), width: parseFloat(el('.gantt-forecast-tail').style.width) };
  });
  const before = await geometry(); expect(before.actual).toBe(before.today); expect(before.marker).toBe(before.today); expect(before.start).toBe(before.today); expect(before.width).toBe(4 * 40);
  await page.locator('.workspace-gantt-scroll').screenshot({ path: info.outputPath('forecast-tail.png') });
  state.progress = 96; await page.reload(); await expect(row.locator('.gantt-progress-value')).toHaveText('96%'); expect(await geometry()).toEqual(before);

  await expect(tail).toHaveAttribute('data-end', '2026-09-17'); await expect(row.locator('.gantt-date-actual')).toHaveAttribute('data-end', '2026-09-11');
  await expect(row.locator('.gantt-forecast-label')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(row.locator('.gantt-forecast-label')).toHaveCount(0);
  await expect(tail).toHaveAttribute('data-end', '2026-09-17');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(state.writes).toEqual([]);
});

test('今日、缺失、已结束和按期预测都不画尾段', async ({ page }) => {
  const state = await setup(page); state.end = '2026-09-11'; await page.goto('/execution');await page.getByRole('button',{name:'展开全部',exact:true}).click();
  await expect(page.locator('.gantt-forecast-label')).toHaveCount(0); await expect(page.locator('.gantt-forecast-tail')).toHaveCount(0);
  await page.locator('.gantt-date-hitbox').first().focus(); await expect(page.getByRole('tooltip')).toContainText('2026-09-11');
  state.end = null; await page.reload(); await expect(page.locator('.gantt-forecast-label')).toHaveCount(0); await expect(page.locator('.gantt-forecast-tail')).toHaveCount(0);
  await page.locator('.gantt-date-hitbox').first().focus(); await expect(page.getByRole('tooltip')).toContainText('预计工期缺失');
  state.end = '2026-09-17'; state.status = 'completed'; await page.reload();
  await expect(page.locator('.workspace-gantt-row.kind-requirement')).toHaveCount(1); await expect(page.locator('.gantt-forecast-label')).toHaveCount(0);
  state.status = 'in_progress'; state.plannedEnd = '2026-09-30'; await page.reload();
  await expect(page.locator('.gantt-forecast-tail')).toHaveCount(0);
  state.plannedEnd = state.end; await page.reload();
  await expect(page.locator('.gantt-forecast-tail')).toHaveCount(0);
});

for (const surface of ['project', 'work'] as const) test(`${surface} 未排期不显示预测框；隐藏预测不扩大时间轴，排期不完整保留实际条`, async ({page}) => {
  const state=await setup(page);Object.assign(state,{status:'not_started',progress:0,plannedStart:null,plannedEnd:null,scheduleComplete:false});
  await page.goto('/?projectId=p1&workspaceView=progress&scopeType='+(surface==='project'?'project':'requirement')+'&scopeId='+(surface==='project'?'p1':'r1'));await page.getByRole('button',{name:'展开全部',exact:true}).click();

  const row=surface==='project'?page.locator('.workspace-gantt-row.kind-requirement').first():page.locator('[data-row-id="w1"]');
  const track=row.locator('.workspace-row-track');
  await expect(row).toBeVisible();await expect(row.locator('.gantt-forecast-tail')).toHaveCount(0);
  const before=await track.getAttribute('style');state.end='2026-12-31';await page.reload();
  await expect(row).toBeVisible();expect(await track.getAttribute('style')).toBe(before);
  Object.assign(state,{status:'in_progress',progress:24,plannedStart:'2026-09-01'});await page.reload();
  await expect(row.locator('.gantt-date-actual')).toBeVisible();await expect(row.locator('.gantt-progress-value')).toHaveText('24%');await expect(row.locator('.gantt-forecast-tail')).toHaveCount(0);
  if(surface==='project'){state.plannedEnd='2026-09-08';await page.reload();await expect(row.locator('.gantt-forecast-tail')).toHaveCount(0);}

  await expect(row.locator('.gantt-date-actual')).toBeVisible();await expect(row.locator('.gantt-forecast-tail')).toHaveCount(0);
  expect(state.writes).toEqual([]);
});

test('关系图更新预计日期，只改预测并联动进展表；并发冲突保留草稿',async({page})=>{
  const post=async(url:string,data:unknown)=>{const r=await page.request.post(url,{data});expect(r.ok(),await r.text()).toBe(true);return r.json();};
  await post('/api/login',{username:'admin',password:'41_xc7q0qOjo4Inw!'});
  const project=await post('/api/projects',{name:'预计日期验证 '+Date.now()});
  const person=await post('/api/people',{projectId:project.id,name:'预测负责人'});
  const template=await post('/api/templates',{projectId:project.id,name:'预测流程',items:[{title:'接口开发',workStage:'development',durationDays:2,startOffsetDays:0,sortOrder:0}]});
  let r:Requirement=await post('/api/requirements',{projectId:project.id,title:'预计日期核对',templateId:template.id,ownerId:person.id,plannedStart:addBusinessDays(todayIso(),0)});
  await post('/api/work-items/'+r.workItems[0].id+'/start',{expectedVersion:r.workItems[0].version,expectedRequirementVersion:r.version,ownerId:person.id});
  r=await(await page.request.get('/api/requirements/'+r.id)).json();const item=r.workItems[0];
  const analysis=async()=>(await(await page.request.get('/api/projects/'+project.id+'/path-graph?view=project')).json()).analysis as PathAnalysis;
  const mine=addBusinessDays(todayIso(),7),other=addBusinessDays(todayIso(),5),writes:Record<string,unknown>[]=[];
  await page.route('**/dependency-changes/apply',async route=>{writes.push(route.request().postDataJSON());await route.continue();});
  await page.goto('/?'+new URLSearchParams({projectId:project.id,workspaceView:'graph',scopeType:'requirement',scopeId:r.id}));
  await expect(page.locator('.dependency-canvas')).toHaveAttribute('data-layout-ready','true');await graphToolbar(page,'编辑画布');
  await graphProperties(page,page.locator('.react-flow__node[data-id="'+item.id+'"] .dependency-card'));
  await page.getByLabel('人工预测完成',{exact:true}).fill(mine);await page.getByLabel('人工预测完成',{exact:true}).blur();
  const response=await page.request.patch('/api/work-items/'+item.id+'/path-estimate',{data:{expectedRevision:(await analysis()).revision,forecastEnd:other}});expect(response.ok(),await response.text()).toBe(true);
  await graphToolbar(page,'保存修改');await openGraphDrafts(page);
  await expect(page.locator('.draft-conflict')).toContainText(mine);await expect(page.locator('.draft-conflict')).toContainText(other);
  await page.getByRole('button',{name:'保留我的修改',exact:true}).click();await expect(page.locator('.draft-conflict')).toHaveCount(0);
  await graphToolbar(page,'保存修改');await expect.poll(async()=>(await analysis()).nodes.find(n=>n.id===item.id)?.estimate.forecastEnd).toBe(mine);
  const saved:Requirement=await(await page.request.get('/api/requirements/'+r.id)).json();
  expect(saved.workItems[0].plannedStart).toBe(item.plannedStart);expect(saved.workItems[0].plannedEnd).toBe(item.plannedEnd);expect(saved.workItems[0].progress).toBe(item.progress);
  expect(writes).toHaveLength(1);
  await page.goto('/?'+new URLSearchParams({projectId:project.id,workspaceView:'progress',scopeType:'requirement',scopeId:r.id}));await page.getByRole('button',{name:'展开全部',exact:true}).click();
  for(const id of [r.id,item.id])await expect(page.locator('[data-row-id="'+id+'"] .gantt-forecast-tail')).toHaveAttribute('data-end',mine);
});

test('只读访客能看预测但不能修改', async ({ page }) => {
  await setup(page); await page.route('**/api/session', route => route.fulfill({ json: { authenticated: true, accountId: 'viewer', username: 'viewer', role: 'user', globalRole: 'user', personId: null, mustChangePassword: false, managedProjectIds: [] } }));
  await page.goto('/?projectId=p1&workspaceView=progress&scopeType=requirement&scopeId=r1');await page.getByRole('button',{name:'展开全部',exact:true}).click(); await expect(page.locator('.gantt-forecast-label')).toHaveCount(0);
  await page.locator('[data-row-id="w1"] .gantt-forecast-tail').focus(); await expect(page.getByRole('tooltip')).toContainText('2026-09-17');
  await expect(page.getByRole('button', { name: '修改预计完成日期' })).toHaveCount(0);
});

test('未开始工作从前置之后画预测，不画计划位置的零进度；旧拓扑响应不覆盖快照', async ({ page }) => {
  const state = await setup(page); state.status='not_started'; state.progress=0; state.start='2026-09-20'; state.end='2026-09-22';
  await page.route('**/path-analysis*', route => route.fulfill({json:{projectId:'p1',asOfDate:'2026-09-11',revision:6,nodes:[{id:'w1',kind:'work',forecastStart:'2026-09-11',forecastEnd:'2026-09-30',unknownReasons:[]}],edges:[],milestones:[]}}));
  await page.goto('/?projectId=p1&workspaceView=progress&scopeType=requirement&scopeId=r1');await page.getByRole('button',{name:'展开全部',exact:true}).click();
  const row=page.locator('[data-row-id="w1"]'),tail=row.locator('.gantt-forecast-tail');
  await expect(tail).toHaveAttribute('data-start','2026-09-20');await expect(tail).toHaveAttribute('data-end','2026-09-22');
  await expect(row.locator('.gantt-progress-value')).toHaveCount(0);await expect(row.locator('.gantt-date-actual')).toHaveCount(0);
  const geometry=await row.evaluate(root=>({start:parseFloat((root.querySelector('.gantt-forecast-tail') as HTMLElement).style.left),today:parseFloat((root.querySelector('.gantt-today-line') as HTMLElement).style.left),width:parseFloat((root.querySelector('.gantt-forecast-tail') as HTMLElement).style.width)}));
  expect(geometry.start).toBeGreaterThan(geometry.today);expect(geometry.width).toBe(3*40);

  await expect(tail).toHaveAttribute('data-start','2026-09-20');await expect(tail).toHaveAttribute('data-end','2026-09-22');
});

test('工作项设置保存和重读期间保留完整旧图，收到完整快照后一起刷新', async ({ page }) => {
  const state=await setup(page);
  let releaseWrite!:()=>void,releaseRead!:()=>void,writing=false,reading=false,holdRead=false;
  const writeGate=new Promise<void>(resolve=>{releaseWrite=resolve;}),readGate=new Promise<void>(resolve=>{releaseRead=resolve;});
  // The table now reads workspace snapshots, not the opened detail's query.
  await page.route(/\/api\/(dashboard|projects\/p1\/path-graph)(\?|$)/,async route=>{if(holdRead){reading=true;await readGate;}await route.fallback();});
  await page.route('**/api/requirements/r1',async route=>{if(holdRead){reading=true;await readGate;}await route.fulfill({json:state.req()});});
  await page.route('**/api/work-items/w1',async route=>{
    if(route.request().method()!=='PATCH')return route.fulfill({json:state.item()});
    writing=true;await writeGate;state.plannedEnd=route.request().postDataJSON().plannedEnd;state.end='2026-09-22';state.revision++;holdRead=true;
    await route.fulfill({json:state.item()});
  });
  await page.goto('/?projectId=p1&workspaceView=progress&scopeType=requirement&scopeId=r1');await page.getByRole('button',{name:'展开全部',exact:true}).click();
  const row=page.locator('[data-row-id="w1"]'),tail=row.locator('.gantt-forecast-tail');
  await expect(tail).toHaveAttribute('data-end','2026-09-17');
  const geometry=()=>row.locator('.gantt-date-plan').getAttribute('style');const old=await geometry();
  await row.locator('.workspace-row-title').click();
  const dialog=page.locator('.modal-card-workspace');await dialog.getByRole('tab',{name:'资料',exact:true}).click();
  await dialog.getByRole('button',{name:/^计划完成：/}).click();
  await page.getByRole('gridcell',{name:'2026-09-16',exact:true}).click();
  await page.locator('.inline-date-popover').getByRole('button',{name:'保存',exact:true}).click();
  await expect.poll(()=>writing).toBe(true);expect(await geometry()).toBe(old);await expect(tail).toHaveAttribute('data-end','2026-09-17');
  releaseWrite();await expect.poll(()=>reading).toBe(true);
  expect(await geometry()).toBe(old);await expect(tail).toHaveAttribute('data-end','2026-09-17');
  releaseRead();await expect(tail).toHaveAttribute('data-end','2026-09-22');await expect.poll(geometry).not.toBe(old);
  await expect(row.locator('.gantt-progress-value')).toHaveText('61%');
});
