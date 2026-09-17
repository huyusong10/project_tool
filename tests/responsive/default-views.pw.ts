import {chooseOption} from './select-helper';
import {test,expect,type Page} from '@playwright/test';
import {mockGanttData,requirement} from './gantt-fixture';
import {workspaceFixture} from './workspace-fixture';
const states=['not_started','in_progress','completed','cancelled'];
type ViewRequirement=Omit<typeof requirement,'ownerId'|'ownerName'>&{ownerId:string|null;ownerName:string|null;processingPriority:'P0'|'P1'|'P2'|'P3';executionMode?:'direct'|'work_items';actualEnd?:string|null;executionCompletedAt?:string|null};
async function setup(page:Page){
 await mockGanttData(page);const rows:ViewRequirement[]=states.map(status=>({...requirement,id:status,title:status,status,executionMode:'direct',workItems:[],actualEnd:status==='completed'?'2026-09-03':null,executionCompletedAt:status==='completed'?'2026-09-03':null,processingPriority:status==='in_progress'?'P1':'P2'}));
 const projection=(id='p1')=>workspaceFixture(id,'测试项目',rows);
 await page.route('**/api/projects/*/path-graph*',route=>route.fulfill({json:{analysis:projection(new URL(route.request().url()).pathname.split('/')[3]).analysis}}));
 await page.route('**/api/dashboard**',route=>route.fulfill({json:{asOfDate:'2026-09-03',summary:{total:rows.length},requirements:rows,featureOverview:projection(new URL(route.request().url()).searchParams.get('projectId')||'p1').overview,issues:{summary:{},attention:[]},charts:{statuses:[],risks:[],weeks:[],varianceTop:[]}}}));
 return rows;
}
const titles=(page:Page)=>page.locator('.workspace-gantt-row.kind-requirement .workspace-row-title strong');
const status=(page:Page)=>page.getByRole('button',{name:'筛选执行状态',exact:true});
async function preset(page:Page,label:string){await status(page).click();await page.getByRole('region',{name:'执行状态筛选'}).getByRole('button',{name:new RegExp('^'+label)}).click();}
test('进展默认显示全部状态，明确只看进行中时零结果不扩大范围',async({page})=>{
 const rows=await setup(page);await page.goto('/execution');await chooseOption(page.getByLabel('展开层级',{exact:true}),'requirements');await expect(status(page)).toContainText('全部状态');await expect(titles(page)).toHaveCount(4);
 await preset(page,'只看进行中');await expect(titles(page)).toHaveText(['in_progress']);await expect(page.locator('.progress-filter-result')).toContainText('1 项需求');await expect(page.getByRole('region',{name:'当前范围概览'}).locator('.overview-metric').filter({hasText:'近7天完成'})).toContainText('1 · 累计 1');
 rows.splice(rows.findIndex(r=>r.status==='in_progress'),1);await page.reload();await expect(page.getByRole('treegrid',{name:'项目进展表'}).getByText('没有符合筛选条件的内容',{exact:true})).toBeVisible();await expect(titles(page)).toHaveCount(0);await preset(page,'尚未结束');await expect(titles(page)).toHaveText(['not_started']);await page.reload();await expect(status(page)).toContainText('尚未结束');await page.getByRole('button',{name:'重置',exact:true}).click();await expect(status(page)).toContainText('全部状态');
});
for(const old of ['unfinished',''])test('旧状态 '+(old||'全部')+' 保留明确选择，新选择在刷新后恢复',async({page})=>{
 await setup(page);await page.addInitScript(value=>{if(!sessionStorage.getItem('seeded-status')){sessionStorage.setItem('seeded-status','1');sessionStorage.setItem('pm-path-view:admin:p1:dashboard-gantt:status',JSON.stringify(value));}},old);await page.goto('/execution');await expect(status(page)).toContainText(old?'尚未结束':'全部状态');await preset(page,'只看进行中');await page.reload();await expect(status(page)).toContainText('只看进行中');
});
test('旧阻塞筛选升级为进行中',async({page})=>{await setup(page);await page.addInitScript(()=>sessionStorage.setItem('pm-path-view:admin:p1:dashboard-gantt:status',JSON.stringify('blocked')));await page.goto('/execution');await expect(status(page)).toContainText('只看进行中');});
test('自动优先级不能手工修改，直接执行负责人可以筛选',async({page})=>{
 const rows=await setup(page);rows.splice(0,rows.length,{...requirement,id:'high',title:'自动紧急',status:'in_progress',priority:'P3',processingPriority:'P0',ownerId:'direct',ownerName:'直接负责人',executionMode:'direct',workItems:[]},{...requirement,id:'low',title:'自动较低',status:'in_progress',priority:'P0',processingPriority:'P3',executionMode:'direct',workItems:[]});
 await page.route('**/api/people*',route=>route.fulfill({json:[{id:'direct',name:'直接负责人',assignmentEligible:true}]}));await page.goto('/execution');await chooseOption(page.getByLabel('展开层级',{exact:true}),'requirements');await expect(titles(page)).toHaveCount(2);await page.getByRole('button',{name:/^更多筛选/}).click();await expect(page.getByLabel('进展排序',{exact:true})).not.toContainText('优先级');await page.getByRole('region',{name:'更多进展筛选'}).getByRole('button',{name:'关闭',exact:true}).click();await expect(page.getByLabel('按优先级筛选',{exact:true})).toHaveCount(0);await chooseOption(page.getByLabel('进展人员',{exact:true}),'direct');await expect(titles(page)).toHaveText(['自动紧急']);await page.reload();await expect(page.getByLabel('进展人员',{exact:true})).toContainText('直接负责人');
});
test('项目进展筛选相互隔离，返回恢复该项目的明确选择',async({page})=>{
 await setup(page);await page.route('**/api/projects',route=>route.fulfill({json:[{id:'p1',name:'第一项目',status:'active'},{id:'p2',name:'第二项目',status:'active'}]}));await page.goto('/execution');await preset(page,'只看进行中');await page.locator('.project-switcher-button').click();await page.getByRole('option',{name:'第二项目',exact:true}).click();await page.getByRole('button',{name:'进展表',exact:true}).click();await expect(status(page)).toContainText('全部状态');await page.locator('.project-switcher-button').click();await page.getByRole('option',{name:'第一项目',exact:true}).click();await expect(status(page)).toContainText('只看进行中');
});
test('行动筛选为空不宣称没有异常，清空后恢复项目行动',async({page})=>{
 await setup(page);await page.route('**/api/action-items?*',route=>{const filtered=new URL(route.request().url()).searchParams.has('severity');return route.fulfill({json:{asOfDate:'2026-09-09',total:filtered?0:1,items:filtered?[]:[{id:'requirement:r1',sourceId:'r1',sourceType:'requirement',projectId:'p1',title:'待跟进需求',reasonCodes:['high_risk'],reasons:[{code:'high_risk',label:'高风险'}],severity:'high',targetPath:'/requirements/r1',ownerName:'负责人',dueDate:null,overdueWorkdays:0}],summary:{total:1,high:1,medium:0,low:0},pages:1,page:1,pageSize:20,ownerOptions:[],hasUnassigned:false}});});
 await page.goto('/actions?severity=low');await expect(page.getByText('没有匹配的待处理事项',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'清空筛选',exact:true}).click();await expect(page.locator('.action-item')).toContainText('待跟进需求');
});
