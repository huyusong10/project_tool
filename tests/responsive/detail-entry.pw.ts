import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {mockGanttData,requirement} from './gantt-fixture';

type Frame={time:number;path:string;phase:string|null;project:string;nav:string;title:string;titleRect:number[];loading:number[];summary:boolean};
for(const width of [1912,390])for(const moduleFirst of [false,true])test(`需求首次进入保留已确认的项目外壳 ${width}：${moduleFirst?'模块先到':'资料先到'}`,async({page},info)=>{
 await page.setViewportSize({width,height:949});await mockGanttData(page);
 let moduleStarted=0,requirementResolved=0;
 await page.route('**/api/requirements/r1',async route=>{await new Promise(r=>setTimeout(r,moduleFirst?850:250));requirementResolved=Date.now();await route.fulfill({json:requirement});});
 await page.route(/\/assets\/RequirementPage-[^/]+\.js$/,async route=>{moduleStarted=Date.now();await new Promise(r=>setTimeout(r,moduleFirst?50:650));await route.continue();});
 await page.goto('/');await expect(page.locator('.gantt-requirement-link').filter({hasText:requirement.title})).toBeVisible();
 const prior=await page.evaluate(()=>({project:document.querySelector('.project-switcher-name')?.textContent||'',nav:document.querySelector('.sidebar-nav')?.textContent||''}));
 await page.evaluate(()=>{
  const frames:Frame[]=[];Object.assign(window,{entryFrames:frames,stopEntryFrames:false});
  const loop=()=>{const title=document.querySelector('.integrated-page-title h1')?.getBoundingClientRect(),loading=document.querySelector('.loading-state')?.getBoundingClientRect();frames.push({time:performance.now(),path:location.pathname,phase:document.querySelector('.topbar')?.getAttribute('data-page-phase')||null,project:document.querySelector('.project-switcher-name')?.textContent||'',nav:document.querySelector('.sidebar-nav')?.textContent||'',title:document.querySelector('.integrated-page-title h1')?.textContent||'',titleRect:title?[title.x,title.y,title.width,title.height]:[],loading:loading?[loading.x,loading.y,loading.width,loading.height]:[],summary:Boolean(document.querySelector('.requirement-overview'))});if(!(window as typeof window&{stopEntryFrames:boolean}).stopEntryFrames)requestAnimationFrame(loop);};requestAnimationFrame(loop);
 });
 await page.locator('.gantt-requirement-link').filter({hasText:requirement.title}).click();
 await expect(page.locator('.loading-state')).toBeVisible();
 await page.screenshot({path:info.outputPath('detail-pending.png')});
 await expect(page.locator('.requirement-overview')).toBeVisible();await page.waitForTimeout(250);
 const frames=await page.evaluate(()=>{Object.assign(window,{stopEntryFrames:true});return(window as typeof window&{entryFrames:Frame[]}).entryFrames;});
 await writeFile(info.outputPath('frames.json'),JSON.stringify({prior,frames},null,2));
 const current=frames.filter(f=>f.path==='/requirements/r1');
 expect(current.length).toBeGreaterThan(3);
 expect(current.filter(f=>f.project!==prior.project),'同项目详情加载不应清空项目控件').toEqual([]);
 expect(current.filter(f=>f.nav!==prior.nav),'详情加载不应清空侧栏导航').toEqual([]);
 expect(new Set(current.filter(f=>f.loading.length).map(f=>f.loading.join(','))).size,'资料和页面模块共用同一加载矩形').toBeLessThanOrEqual(1);
 expect(moduleStarted,'应加载目标页面模块').toBeGreaterThan(0);
 expect(moduleStarted,'模块不再等待需求查询完成后才开始加载').toBeLessThan(requirementResolved);
});

test('已进入项目后打开其他项目的需求：确认归属时统一切换，不混合旧项目与新对象',async({page})=>{
 await mockGanttData(page);
 await page.route('**/api/projects',route=>route.fulfill({json:[{id:'p1',name:'项目 A'},{id:'p2',name:'项目 B'}]}));
 let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/requirements/r1',async route=>{await gate;await route.fulfill({json:{...requirement,projectId:'p2',title:'项目 B 的需求'}});});
 await page.goto('/');await expect(page.locator('.project-switcher-name')).toHaveText('项目 A');
 await page.locator('.gantt-requirement-link').filter({hasText:requirement.title}).click();
 await expect(page.locator('.topbar[data-page-phase=loading]')).toBeVisible();
 await expect(page.locator('.project-switcher-name')).toHaveText('项目 A');
 await expect(page.locator('.integrated-page-title h1')).toHaveAttribute('aria-busy','true');
 await expect(page.locator('.requirement-overview')).toHaveCount(0);
 release();
 await expect(page.locator('.integrated-page-title h1')).toHaveText('项目 B 的需求');
 await expect(page.locator('.project-switcher-name')).toHaveText('项目 B');
});
