import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {mockGanttData,requirement} from './gantt-fixture';
import {analysePaths} from '../../src/shared/paths';
import {req,work} from '../fixtures/path-network';

type Box={text:string|null;x:number;y:number;w:number;h:number;bg:string};
type Frame={time:number;theme?:string;header:Box|null;title:Box|null;dot:Box|null;nav:string[]};
type SampleWindow=typeof window & {flashFrames:Frame[];stopFlash?:boolean};

for(const scenario of [
  {width:1912,theme:'classic',role:'admin',url:'/paths?pathInspector=closed'},
  {width:1912,theme:'dcim',role:'admin',url:'/paths?pathInspector=closed'},
  {width:390,theme:'classic',role:'admin',url:'/paths?pathInspector=closed'},
  {width:1912,theme:'classic',role:'member',url:'/requirements/r1'},
])test(`刷新全程 ${scenario.width} ${scenario.theme} ${scenario.role}`,async({page},info)=>{
  await page.setViewportSize({width:scenario.width,height:949});await mockGanttData(page);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const analysis=analysePaths({projectId:'p1',projectName:'DCIM',projectEnd:'2026-12-31',revision:1,asOfDate:'2026-09-11',requirements:[{...req('r1'),projectId:'p1',title:requirement.title}],workItems:[work('w1','r1',2)],dependencies:[]});
  await page.route('**/path-analysis*',async route=>{await new Promise(r=>setTimeout(r,950));await route.fulfill({json:analysis});});
  await page.route('**/api/session',async route=>{await new Promise(r=>setTimeout(r,100));await route.fulfill({json:{authenticated:true,accountId:'admin',username:'admin',role:scenario.role,globalRole:scenario.role,personId:null,mustChangePassword:false,managedProjectIds:scenario.role==='member'?['p1']:[]}});});
  await page.route('**/api/projects',async route=>{await new Promise(r=>setTimeout(r,350));await route.fulfill({json:[{id:'p1',name:'DCIM',canManage:true,projectRole:'manager',status:'active'}]});});
  await page.route('**/api/branding',async route=>{await new Promise(r=>setTimeout(r,550));await route.fulfill({json:{systemName:'DCIM软件',shortName:'DCIM',logoUrl:null}});});
  let release=()=>{};
  let entryGate:Promise<void>;
  await page.route(/\/assets\/index-[^/]+\.js$/,async route=>{await entryGate;await route.continue();});
  await page.addInitScript(theme=>{
    localStorage.setItem('project-manage:theme',theme);
    const frames:Frame[]=[];Object.assign(window,{flashFrames:frames});
    const box=(selector:string):Box|null=>{const n=document.querySelector(selector);if(!n)return null;const r=n.getBoundingClientRect();return{text:n.textContent,x:r.x,y:r.y,w:r.width,h:r.height,bg:getComputedStyle(n).background};};
    const sample=()=>{frames.push({time:performance.now(),theme:document.documentElement.dataset.theme,header:box('.topbar'),title:box('.integrated-page-title h1'),dot:box('.project-switcher .project-dot'),nav:Array.from(document.querySelectorAll('.sidebar-nav a')).map(n=>n.textContent||'')});if(!(window as SampleWindow).stopFlash)requestAnimationFrame(sample);};requestAnimationFrame(sample);
  },scenario.theme);
  for(const entry of ['open','refresh']){
    entryGate=new Promise(resolve=>{release=resolve;});
    if(entry==='open')await page.goto(scenario.url,{waitUntil:'commit'});else await page.reload({waitUntil:'commit'});
    await expect(page.locator('#root:empty')).toBeVisible();
    const initial=await page.evaluate(()=>{
      const root=document.querySelector('#root')!,sidebar=getComputedStyle(root,'::before'),header=getComputedStyle(root,'::after');
      return{theme:document.documentElement.dataset.theme,sidebar:{width:sidebar.width,bg:sidebar.background,content:sidebar.content},header:{left:header.left,height:header.height,bg:header.background,content:header.content}};
    });
    // 主脚本仍被阻止；这张图覆盖 React 挂载之前的真实可见阶段。
    await page.screenshot({path:info.outputPath(`${entry}-before-react.png`)});release();
    if(scenario.url.startsWith('/paths'))await expect(page.locator('[data-layout-ready=true]')).toBeVisible();else await expect(page.locator('.requirement-overview')).toBeVisible();
    await expect(page.locator('.brand-name')).toHaveText('DCIM软件');await page.waitForTimeout(200);
    const final=await page.evaluate(()=>{
      const sidebar=document.querySelector('.sidebar')!,header=document.querySelector('.topbar')!;
      return{sidebar:{width:getComputedStyle(sidebar).width,bg:getComputedStyle(sidebar).background},header:{left:getComputedStyle(header).left,height:getComputedStyle(header).height,bg:getComputedStyle(header).background}};
    });
    const frames=await page.evaluate(()=>{Object.assign(window,{stopFlash:true});return(window as SampleWindow).flashFrames;});
    await writeFile(info.outputPath(`${entry}-frames.json`),JSON.stringify({initial,final,frames},null,2));
    await page.screenshot({path:info.outputPath(`${entry}.png`)});
    expect(initial.theme).toBe(scenario.theme);
    expect(initial.sidebar.content).toBe('""');expect(initial.header.content).toBe('""');
    expect(final.sidebar).toEqual({width:initial.sidebar.width,bg:initial.sidebar.bg});
    expect(final.header).toEqual({left:initial.header.left,height:initial.header.height,bg:initial.header.bg});
    expect([...new Set(frames.filter(f=>f.theme).map(f=>f.theme))]).toEqual([scenario.theme]);
    const titles=frames.flatMap(f=>f.title?[f.title]:[]),visible=titles.filter(t=>t.text);
    expect(visible.length).toBeGreaterThan(1);
    expect(new Set(titles.map(t=>`${t.x}:${t.y}:${t.h}`)).size).toBe(1);
    expect(new Set(visible.map(t=>`${t.text}:${t.w}`)).size).toBe(1);
    expect(new Set(frames.flatMap(f=>f.dot?[`${f.dot.x}:${f.dot.y}`]:[])).size).toBe(1);
    expect(new Set(frames.filter(f=>f.nav.length).map(f=>f.nav.join('|'))).size).toBe(1);
  }
  expect(errors).toEqual([]);
});
