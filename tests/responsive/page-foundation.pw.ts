import {test,expect,type Page} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {mockGanttData,requirement} from './gantt-fixture';

type Rect = {text:string;x:number;y:number;w:number;h:number};
type Frame = {barId:number;sideId:number;bar:Rect;project:Rect;title:Rect;brand:string;bodyStart:number};
async function sampleStartup(page:Page) {
  await page.addInitScript(() => {
    const ids=new WeakMap<Element,number>();let next=0;
    const frames:unknown[]=[];
    Object.assign(window,{startupFrames:frames});
    const identity=(node:Element)=>{if(!ids.has(node))ids.set(node,++next);return ids.get(node);};
    const rect=(node:Element)=>{const r=node.getBoundingClientRect();return{text:node.textContent||'',x:r.x,y:r.y,w:r.width,h:r.height};};
    const sample=()=>{
      const bar=document.querySelector('.topbar'),side=document.querySelector('.sidebar'),project=document.querySelector('.project-switcher'),title=document.querySelector('.integrated-page-title h1');
      if(bar&&side&&project&&title)frames.push({barId:identity(bar),sideId:identity(side),bar:rect(bar),project:rect(project),title:rect(title),brand:document.querySelector('.brand-name')?.textContent||'',bodyStart:parseFloat(getComputedStyle(document.querySelector('main')!).paddingTop)});
      if(!(window as typeof window&{stopStartupFrames?:boolean}).stopStartupFrames)requestAnimationFrame(sample);
    };requestAnimationFrame(sample);
  });
}

for(const width of [1280,390])for(const scenario of ['global','detail','different-project'])test(`应用启动：${scenario} ${width} 项目和标题一次到位，外壳不重挂载`,async({page},info)=>{
  await page.setViewportSize({width,height:844}); await mockGanttData(page);
  let reads=0;
  await page.route('**/api/session',async route=>{await new Promise(r=>setTimeout(r,120));await route.fallback();});
  await page.route('**/api/projects',async route=>{await new Promise(r=>setTimeout(r,scenario==='different-project'?520:240));await route.fulfill({json:[{id:'p1',name:'DCIM',status:'active'},{id:'p2',name:'不应闪现的记忆项目',status:'active'}]});});
  await page.route('**/api/branding',async route=>{await new Promise(r=>setTimeout(r,800));await route.fulfill({json:{systemName:'DCIM软件',shortName:'DCIM',logoUrl:null,updatedAt:null}});});
  const name='EPDS-DCIM-35【菜单权限方案管理】';
  await page.route('**/api/requirements/r1',async route=>{reads++;await new Promise(r=>setTimeout(r,scenario==='different-project'?180:480));await route.fulfill({json:{...requirement,title:name}});});
  await page.addInitScript(different=>localStorage.setItem('project-manage:selected-project:admin',different?'p2':'p1'),scenario==='different-project');
  await sampleStartup(page);
  for(const entry of ['open','refresh']){
    reads=0;
    if(entry==='open')await page.goto(scenario==='global'?'/':'/requirements/r1');else await page.reload();
    await expect(page.locator('.integrated-page-title h1')).toHaveText(scenario==='global'?'项目进展':name);
    await expect(page.locator('.brand-name')).toHaveText('DCIM软件');
    await page.screenshot({path:info.outputPath(`${entry}-${width}.png`)});
    const frames=await page.evaluate(()=>{Object.assign(window,{stopStartupFrames:true});return(window as typeof window&{startupFrames:Frame[]}).startupFrames;});
    await writeFile(info.outputPath(`${entry}-frames.json`),JSON.stringify(frames,null,2));
    expect(frames.length).toBeGreaterThan(5);
    expect(new Set(frames.map(f=>f.barId)).size).toBe(1);expect(new Set(frames.map(f=>f.sideId)).size).toBe(1);
    expect(new Set(frames.map(f=>`${f.project.x}:${f.project.w}:${f.title.x}:${f.title.y}:${f.title.h}:${f.bar.h}:${f.bodyStart}`)).size).toBe(1);
    expect(frames.some(f=>f.project.text.includes('不应闪现'))).toBe(false);
    expect(frames.every(f=>!f.brand||f.brand==='DCIM软件')).toBe(true);
    expect(frames.filter(f=>f.title.text).every(f=>f.title.text===(scenario==='global'?'项目进展':name))).toBe(true);
    expect(frames.every(f=>!f.title.text || f.project.text==='DCIM')).toBe(true);
    expect(reads).toBe(scenario==='global'?0:1);
  }
});

test('快速项目切换与旧响应：外壳稳定，筛选不重新初始化页面',async({page})=>{
  await mockGanttData(page);
  await page.route('**/api/projects',route=>route.fulfill({json:[{id:'p1',name:'项目 A'},{id:'p2',name:'项目 B'}]}));
  await page.route('**/api/dashboard?*',async route=>{const id=new URL(route.request().url()).searchParams.get('projectId');if(id==='p2')await new Promise(r=>setTimeout(r,600));await route.fallback();});
  await page.goto('/'); await expect(page.locator('.project-switcher-name')).toHaveText('项目 A');
  await page.evaluate(()=>Object.assign(window,{initialBar:document.querySelector('.topbar'),initialSidebar:document.querySelector('.sidebar')}));
  for(const name of ['项目 B','项目 A']){await page.locator('.project-switcher-button').click();await page.getByRole('option',{name,exact:true}).click();}
  await page.waitForTimeout(700);
  await expect(page.locator('.project-switcher-name')).toHaveText('项目 A');
  await expect(page.locator('.integrated-page-title h1')).toHaveText('项目进展');
  expect(await page.evaluate(()=>{const w=window as typeof window&{initialBar:Element;initialSidebar:Element};return w.initialBar===document.querySelector('.topbar')&&w.initialSidebar===document.querySelector('.sidebar');})).toBe(true);
});

test('对象失败不冒用记忆项目；旧流程只查询记忆项目且明确报错',async({page})=>{
  await mockGanttData(page);
  const requests:string[]=[];page.on('request',request=>{if(request.url().includes('/api/'))requests.push(request.url());});
  await page.route('**/api/requirements/missing',route=>route.fulfill({status:404,json:{error:'对象已删除'}}));
  await page.goto('/requirements/missing'); await expect(page.getByText('对象已删除',{exact:true})).toBeVisible();
  await expect(page.locator('.project-switcher-name')).toHaveText('选择项目');
  await expect(page.locator('.topbar-page-tools button')).toHaveCount(0);
  await page.goto('/templates?edit=missing'); await expect(page.getByText('当前项目中没有这个流程。请返回流程列表重新选择。',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'返回流程列表',exact:true})).toBeVisible();
  const templateRequests=requests.filter(url=>new URL(url).pathname==='/api/templates');
  expect(templateRequests).toHaveLength(1);expect(new URL(templateRequests[0]).searchParams.get('projectId')).toBe('p1');
});

test('需求 A→B→A 的迟到读取不能发布旧标题或按钮',async({page},info)=>{
  await mockGanttData(page); await sampleStartup(page);
  await page.route('**/api/requirements/r1',async route=>{await new Promise(r=>setTimeout(r,650));await route.fulfill({json:requirement}).catch(()=>{});});
  await page.route('**/api/requirements/r2',async route=>{await new Promise(r=>setTimeout(r,180));await route.fulfill({json:{...requirement,id:'r2',title:'领先计划流程'}});});
  await page.addInitScript(()=>{
    const frames:Array<{path:string;title:string;project:string}>=[];Object.assign(window,{routeFrames:frames});
    const sample=()=>{frames.push({path:location.pathname,title:document.querySelector('.integrated-page-title h1')?.textContent||'',project:document.querySelector('.project-switcher-name')?.textContent||''});requestAnimationFrame(sample);};requestAnimationFrame(sample);
  });
  await page.goto('/');await expect(page.locator('.gantt-requirement-link')).toHaveCount(2);
  await page.locator('.gantt-requirement-link').filter({hasText:requirement.title}).click();
  await page.getByRole('link',{name:'项目进展',exact:true}).click();
  await page.locator('.gantt-requirement-link').filter({hasText:'领先计划流程'}).click();
  await expect(page.locator('.integrated-page-title h1')).toHaveText('领先计划流程');
  await page.waitForTimeout(700);
  await expect(page.locator('.integrated-page-title h1')).toHaveText('领先计划流程');
  await page.getByRole('link',{name:'项目进展',exact:true}).click();
  await page.locator('.gantt-requirement-link').filter({hasText:requirement.title}).click();
  await expect(page.locator('.integrated-page-title h1')).toHaveText(requirement.title);
  const frames=await page.evaluate(()=>(window as typeof window&{routeFrames:Array<{path:string;title:string}>}).routeFrames);
  await writeFile(info.outputPath('continuous-navigation.json'),JSON.stringify(frames,null,2));
  for(const frame of frames.filter(f=>f.path==='/requirements/r2'))expect(['','领先计划流程']).toContain(frame.title);
  const shell=await page.evaluate(()=>{Object.assign(window,{stopStartupFrames:true});return(window as typeof window&{startupFrames:Frame[]}).startupFrames;});
  expect(new Set(shell.map(f=>f.barId)).size).toBe(1);expect(new Set(shell.map(f=>f.sideId)).size).toBe(1);
});
