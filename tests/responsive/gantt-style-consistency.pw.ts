import {expect,test,type Locator,type Page} from '@playwright/test';
import {mockGanttData,mockGanttReport,requirement,workItem} from './gantt-fixture';

const skins=['classic','swiss','forest','midnight','soft','industrial','dcim'];
test.beforeEach(async({page})=>{await page.emulateMedia({reducedMotion:'reduce'});});
async function skin(page:Page,value:string){
  await page.evaluate(value=>{localStorage.setItem('project-manage:theme',value);window.dispatchEvent(new StorageEvent('storage',{key:'project-manage:theme',newValue:value}));},value);
  await expect(page.locator('html')).toHaveAttribute('data-theme',value);
}
async function appearance(node:Locator){
  return node.evaluate(node=>{const s=getComputedStyle(node);return {height:s.height,radius:s.borderRadius,background:s.backgroundColor,image:s.backgroundImage,border:s.borderTop,color:s.color,font:s.fontSize};});
}
async function workAppearance(row:Locator){
  return {
    plan:await appearance(row.locator('.gantt-date-plan')),
    actual:await appearance(row.locator('.gantt-date-actual')),
    fill:await appearance(row.locator('.gantt-completion-fill')),
    progress:await appearance(row.locator('.gantt-progress-text')),
    value:await row.locator('.gantt-progress-text').innerText(),
    start:await row.locator('.gantt-date-actual').getAttribute('data-start'),
    end:await row.locator('.gantt-date-actual').getAttribute('data-end'),
  };
}

test('我的工作与项目空间的日期、条形和进度胶囊在七套主题中一致',async({page},info)=>{
  await mockGanttData(page);
  const items=[workItem,
    {...workItem,id:'done',title:'已完成工作',status:'completed',progress:100,actualEnd:'2026-09-08'},
    {...workItem,id:'cancelled',title:'已取消工作',status:'cancelled',progress:30,cancelledAt:'2026-09-02'},
    {...workItem,id:'unplanned',title:'尚未排期的长名称工作项，用于检查窄屏操作和名称省略',status:'not_started',progress:0,plannedStart:null,plannedEnd:null,actualStart:null},
  ];
  await mockGanttReport(page,()=>[{...requirement,workItems:items}]);
  await page.route('**/api/my-work*',route=>route.fulfill({json:{asOfDate:'2026-09-03',summary:{total:4,notStarted:1,inProgress:1,blocked:0,completed:1,overdue:0},requirements:[],items:items.map(item=>({...item,projectId:'p1',projectName:'测试项目',requirementTitle:requirement.title,requirementStatus:requirement.status,assignmentType:'owner',overdue:false})),completionTrend:[],upcoming:[],recentProgress:[]}}));
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const project:Record<string,unknown>={};
  await page.goto('/execution');await page.getByRole('button',{name:'展开全部',exact:true}).click();
  for(const theme of skins){
    await skin(page,theme);
    project[theme]={work:await workAppearance(page.locator('[data-row-id="w1"]')),done:await workAppearance(page.locator('[data-row-id="done"]')),cancelled:await appearance(page.locator('[data-row-id="cancelled"] .gantt-date-actual')),scale:await appearance(page.locator('.gantt-scale'))};
    if(theme==='classic')await page.screenshot({path:info.outputPath('workspace.png')});
  }
  await page.goto('/my-work?filter=all');
  await expect(page.locator('.requirement-gantt-row')).toHaveCount(4);
  const header=(await page.locator('.gantt-axis-header .gantt-milestone-rail').boundingBox())!;
  expect((await page.locator('.requirement-gantt-track').first().boundingBox())!.y).toBeGreaterThanOrEqual(header.y+header.height);
  for(const theme of skins){
    await skin(page,theme);
    expect({work:await workAppearance(page.locator('[data-work-item-id="w1"]')),done:await workAppearance(page.locator('[data-work-item-id="done"]')),cancelled:await appearance(page.locator('[data-work-item-id="cancelled"] .gantt-date-actual')),scale:await appearance(page.locator('.gantt-scale'))},theme).toEqual(project[theme]);
    await expect(page.locator('.gantt-scale-month').first()).toBeAttached();
    if(['classic','midnight','dcim'].includes(theme))await page.screenshot({path:info.outputPath(`my-work-${theme}.png`)});
  }
  await expect(page.locator('[data-work-item-id="unplanned"] .gantt-date-actual')).toHaveCount(0);
  await expect(page.locator('[data-work-item-id="unplanned"] .gantt-date-unplanned')).toHaveText('待排期');
  await page.locator('[data-work-item-id="w1"] .gantt-progress-button').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  for(const width of [768,390,320]){
    await page.setViewportSize({width,height:844});
    await page.locator('.requirement-gantt-scroll').evaluate(node=>{node.scrollTop=0;});
    const header=(await page.locator('.gantt-axis-header .gantt-milestone-rail').boundingBox())!;
    expect((await page.locator('.requirement-gantt-track').first().boundingBox())!.y).toBeGreaterThanOrEqual(header.y+header.height);
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.locator('[data-work-item-id="w1"] .gantt-date-plan')).toHaveCSS('height','6px');
    await expect(page.locator('[data-work-item-id="w1"] .gantt-date-actual')).toHaveCSS('height','16px');
    await page.screenshot({path:info.outputPath(`my-work-${width}.png`)});
  }
  expect(errors).toEqual([]);
});

test('排期预览与模板复用计划条和表头规范，预测保持独立含义',async({page},info)=>{
  await mockGanttData(page);
  await page.goto('/execution');await page.getByRole('button',{name:'展开全部',exact:true}).click();await skin(page,'classic');
  const plan=await appearance(page.locator('[data-row-id="w1"] .gantt-date-plan'));
  await page.goto('/?projectId=p1&workspaceView=graph&scopeType=requirement&scopeId=r1');
  await expect(page.locator('[data-layout-ready="true"]')).toBeVisible({timeout:20000});
  await page.getByRole('button',{name:'排期预览',exact:true}).click();
  const chart=page.locator('.path-draft-gantt');
  await expect(chart.locator('.gantt-date-plan').first()).toBeAttached();
  expect(await appearance(chart.locator('.gantt-date-plan').first())).toEqual(plan);
  await expect(chart.locator('.gantt-date-prediction').first()).toHaveCSS('height','16px');
  await expect(chart.locator('.gantt-date-prediction').first()).toHaveCSS('border-top-style','dashed');
  await expect(chart.locator('.gantt-scale')).toHaveCSS('height','58px');
  await expect(page.locator('.graph-auxiliary')).toHaveCSS('opacity','1');
  await page.screenshot({path:info.outputPath('path-preview.png')});
  for(const zoom of ['月','周','日'])await chart.getByRole('button',{name:zoom,exact:true}).click();
  await expect(chart.locator('.gantt-scale-day').first()).toBeAttached();
  await page.route('**/api/templates**',route=>route.fulfill({json:[{id:'t0',projectId:'p1',name:'甘特样式测试',description:'按相对工作日安排流程',createdAt:'2026-09-01',updatedAt:'2026-09-01',items:[{id:'tw1',templateId:'t0',title:'需求设计',kind:'work',startOffsetDays:0,durationDays:2,sortOrder:0,predecessorIds:[],milestoneLabel:null},{id:'tw2',templateId:'t0',title:'开发验证',kind:'work',startOffsetDays:2,durationDays:3,sortOrder:1,predecessorIds:[],milestoneLabel:null}]}]}));
  await page.goto('/templates');await page.getByRole('button',{name:'查看流程 甘特样式测试',exact:true}).click();
  const template=page.getByRole('dialog',{name:'流程预览'});
  expect(await appearance(template.locator('.template-plan-bar').first())).toEqual(plan);
  await expect(template.locator('.template-plan-scale')).toHaveCSS('height','58px');
  await template.getByRole('button',{name:'工期：开发验证',exact:true}).click();
  await expect(template.getByRole('button',{name:'工期：开发验证',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.screenshot({path:info.outputPath('template-preview.png')});
  await page.setViewportSize({width:390,height:844});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path:info.outputPath('template-preview-mobile.png')});
});
