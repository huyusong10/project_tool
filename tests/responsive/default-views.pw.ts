import {test,expect,type Page} from '@playwright/test';
import {mockGanttData,requirement} from './gantt-fixture';
const states=['planning','not_started','in_progress','blocked','pending_acceptance','completed','cancelled'];
type ViewRequirement=Omit<typeof requirement,'ownerId'|'ownerName'>&{ownerId:string|null;ownerName:string|null;processingPriority:string;executionMode?:string};
async function setup(page:Page){
 await mockGanttData(page);
 const rows:ViewRequirement[]=states.map(status=>({...requirement,id:status,title:status,status,processingPriority:status==='in_progress'?'P1':'P2'}));
 await page.route('**/api/dashboard**',route=>route.fulfill({json:{summary:{total:7,active:5,completed:1,delayed:1,highRisk:1,completionRate:14},requirements:rows,issues:{summary:{},attention:[]},charts:{statuses:[],risks:[],weeks:[],varianceTop:[]}}}));
 return rows;
}
test('项目进展默认只显示进行中，统计保持全项目；没有进行中时不自动扩大范围',async({page})=>{
 const rows=await setup(page);await page.goto('/');
 await expect(page.getByLabel('按状态筛选',{exact:true})).toHaveValue('in_progress');
 await expect(page.locator('.gantt-requirement-link')).toHaveText(['in_progress']);
 await expect(page.locator('.gantt-filter-result')).toHaveText('1 / 7 项');
 await expect(page.locator('.dashboard-top-stats')).toContainText('全部 7 项');
 await expect(page.getByRole('option',{name:'阻塞 · 1',exact:true})).toHaveCount(1);
 rows.splice(rows.findIndex(r=>r.status==='in_progress'),1);
 await page.reload();await expect(page.getByText('当前没有进行中的需求',{exact:true})).toBeVisible();
 await expect(page.locator('.gantt-requirement-link')).toHaveCount(0);
 await page.getByRole('button',{name:'查看未结束需求',exact:true}).click();
 await expect(page.locator('.gantt-requirement-link')).toHaveCount(4);
 await page.reload();await expect(page.getByLabel('按状态筛选',{exact:true})).toHaveValue('unfinished');
 await page.getByTitle('重置为进行中和风险排序',{exact:true}).click();
 await expect(page.getByLabel('按状态筛选',{exact:true})).toHaveValue('in_progress');
});
for(const old of ['unfinished','','blocked'])test(`旧视图 ${old||'全部'} 升级保留明确选择，旧默认改为进行中`,async({page})=>{
 await setup(page);await page.addInitScript(value=>sessionStorage.setItem('pm-path-view:admin:p1:dashboard-gantt:status',JSON.stringify(value)),old);await page.goto('/');
 await expect(page.getByLabel('按状态筛选',{exact:true})).toHaveValue(old==='unfinished'?'in_progress':old);
 await page.getByLabel('按状态筛选',{exact:true}).selectOption('unfinished');await page.reload();
 await expect(page.getByLabel('按状态筛选',{exact:true})).toHaveValue('unfinished');
});
test('甘特优先级只读自动结果，直接执行负责人可被筛选',async({page})=>{
 const rows=await setup(page);
 rows.splice(0,rows.length,...[
 {...requirement,id:'high',title:'自动紧急',status:'in_progress',priority:'P3',processingPriority:'P0',ownerId:'direct',ownerName:'直接负责人',executionMode:'direct',workItems:[]},
 {...requirement,id:'low',title:'自动较低',status:'in_progress',priority:'P0',processingPriority:'P3'},
 ]);
 await page.goto('/');await page.getByLabel('需求排序',{exact:true}).selectOption('priority');
 await expect(page.locator('.gantt-requirement-link')).toHaveText(['自动紧急','自动较低']);
 await expect(page.locator('.gantt-row').filter({hasText:'自动紧急'}).locator('.priority-badge')).toHaveText('P0 · 紧急');
 await page.getByLabel('按优先级筛选',{exact:true}).selectOption('P0');await expect(page.locator('.gantt-requirement-link')).toHaveText(['自动紧急']);
 await page.getByLabel('按优先级筛选',{exact:true}).selectOption('');
 await page.getByLabel('按人员筛选',{exact:true}).selectOption('direct');await expect(page.locator('.gantt-requirement-link')).toHaveText(['自动紧急']);
 await page.reload();await expect(page.getByLabel('按人员筛选',{exact:true})).toHaveValue('direct');
});
test('项目之间的甘特筛选独立，查看其他页面不改变进行中默认',async({page})=>{
 await setup(page);await page.route('**/api/projects',route=>route.fulfill({json:[{id:'p1',name:'第一项目',status:'active'},{id:'p2',name:'第二项目',status:'active'}]}));
 await page.goto('/');await page.getByLabel('按状态筛选',{exact:true}).selectOption('blocked');
 await page.locator('.project-switcher-button').click();await page.getByRole('option',{name:'第二项目',exact:true}).click();await expect(page.getByLabel('按状态筛选',{exact:true})).toHaveValue('in_progress');
 await page.locator('.project-switcher-button').click();await page.getByRole('option',{name:'第一项目',exact:true}).click();await expect(page.getByLabel('按状态筛选',{exact:true})).toHaveValue('blocked');
});
test('行动筛选为空不宣称没有异常，清空后恢复项目行动',async({page})=>{
 await setup(page);await page.route('**/api/action-items?*',route=>{const filtered=new URL(route.request().url()).searchParams.has('severity');return route.fulfill({json:{asOfDate:'2026-09-09',total:filtered?0:1,items:filtered?[]:[{id:'requirement:r1',sourceId:'r1',sourceType:'requirement',projectId:'p1',title:'待跟进需求',reasonCodes:['high_risk'],reasons:[{code:'high_risk',label:'高风险'}],severity:'high',targetPath:'/requirements/r1',ownerName:'负责人',dueDate:null,overdueWorkdays:0}],summary:{total:1,high:1,medium:0,low:0},pages:1,page:1,pageSize:20,ownerOptions:[],hasUnassigned:false}});});
 await page.goto('/actions?severity=low');await expect(page.getByText('没有匹配的待处理事项',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'清空筛选',exact:true}).click();await expect(page.locator('.action-item')).toContainText('待跟进需求');
});
