import fs from 'node:fs';
import {test,expect,type Page} from '@playwright/test';
import {analysePaths} from '../../src/shared/paths';
import {largeGraphInput} from './large-graph-fixture';
import {graphFixture as fixture} from './graph-fixture';
import {mockGraphAnalysis} from './graph-analysis-fixture';
import {openGraph,closeGraphProperties,graphToolbar} from './graph-interactions';
import {headerAction as toolbarAction} from './topbar-helpers';
const headerAction=async(page:Page,name:string)=>{await closeGraphProperties(page);await toolbarAction(page,name);};
const ready=(page:Page)=>expect(page.locator('.dependency-canvas')).toHaveAttribute('data-layout-ready','true',{timeout:20000});
async function locateNode(page:Page,title:string){
 await closeGraphProperties(page);
 if(!await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();
 await page.getByRole('button',{name:/^节点 \d/}).click();
 await page.getByLabel('筛选图中节点').fill(title);
 const row=page.locator('.graph-list-row').filter({has:page.getByRole('button',{name:new RegExp('^'+title+' ')} )});
 await row.locator('button').first().click();
 await row.getByRole('button',{name:'定位',exact:true}).click();
 await page.getByLabel('筛选图中节点').fill('');
 await page.locator('.graph-auxiliary').getByRole('button',{name:'关闭',exact:true}).click();
 if(await page.locator('.graph-finder').isVisible())await page.getByRole('button',{name:'查找与筛选',exact:true}).click();
 await page.waitForTimeout(280);
}
async function readableZoom(page:Page){
 const scale=page.locator('.graph-view-controls>span').last();
 for(let i=0;i<24&&parseInt(await scale.innerText())<75;i++)await page.getByRole('button',{name:'放大画布',exact:true}).click();
 expect(parseInt(await scale.innerText())).toBeGreaterThanOrEqual(75);
 await page.getByRole('button',{name:'定位所选节点',exact:true}).click();await page.waitForTimeout(280);
}

test('20/80/200 个可见节点真实 Worker 布局，每次布局不超过 2 秒',{tag:'@performance'}, async({page},testInfo)=>{
 test.setTimeout(480000);
 const {project}=await fixture(page);const samples:Array<{nodes:number;sample:number;elapsed:number}>=[],motionSamples:Array<{nodes:number;sample:number;p95FrameMs:number;feedback:{p95Ms:number}}>=[];
 for(const count of [20,80,200])for(let sample=0;sample<6;sample++){
  const input=largeGraphInput(project,count,count*100+sample*2),result=analysePaths(input);
  await mockGraphAnalysis(page,project.id,result);await openGraph(page,'/paths?pathScope=all');await ready(page);await expect(page.locator('.react-flow__node')).toHaveCount(count);await graphToolbar(page,'适配视图');await page.waitForTimeout(280);
  const elapsed=await page.evaluate(()=>performance.getEntriesByName('pm-path-layout').at(-1)!.duration);if(sample>0){samples.push({nodes:count,sample,elapsed});expect(elapsed).toBeLessThanOrEqual(2000);}
  {
   const changed=analysePaths({...input,revision:input.revision+1,dependencies:Array.from({length:count-1},(_,i)=>({id:'fan'+i,projectId:project.id,sourceRequirementId:'r0',sourceWorkItemId:'w0',targetRequirementId:'r'+(i+1),targetWorkItemId:'w'+(i+1),origin:'manual'}))});
   await page.unroute(`**/api/projects/${project.id}/path-graph**`);await mockGraphAnalysis(page,project.id,changed);
   await headerAction(page,'分析说明');
   const observation=page.evaluate(async()=>{const positions=new Set<string>(),intervals:number[]=[];let active=false,last=performance.now();await new Promise<void>((resolve,reject)=>{setTimeout(()=>reject(new Error('未检测到自动整理完成')),8000);const tick=(now:number)=>{const phase=document.querySelector('.dependency-canvas')!.getAttribute('data-layout-phase');if(phase==='moving')active=true;if(phase==='moving'){positions.add([...document.querySelectorAll<HTMLElement>('.react-flow__node')].map(n=>n.style.transform).join('|'));intervals.push(now-last);}last=now;if(active&&phase==='ready')resolve();else requestAnimationFrame(tick);};requestAnimationFrame(tick);});intervals.sort((a,b)=>a-b);return {frames:positions.size,p95FrameMs:intervals[Math.max(0,Math.ceil(intervals.length*.95)-1)]||0,maxFrameMs:Math.max(0,...intervals),waitMs:performance.getEntriesByName('pm-path-layout-wait').at(-1)!.duration,layoutMs:performance.getEntriesByName('pm-path-layout').at(-1)!.duration,transitionMs:performance.getEntriesByName('pm-path-transition').at(-1)!.duration};});
   await page.getByRole('button',{name:'刷新分析',exact:true}).click();await ready(page);await graphToolbar(page,'编辑画布');await graphToolbar(page,'自动整理');const motion=await observation;expect(motion.frames).toBeGreaterThan(3);
   await page.locator('.graph-auxiliary').getByRole('button',{name:'关闭',exact:true}).click();await page.waitForTimeout(210);
   // Preserve the original overview-scale benchmark; selection setup is outside the timed feedback.
   await page.locator('.react-flow__node[data-id="r1"] .graph-title').dispatchEvent('click');
   await expect(page.locator('.modal-card-workspace').getByRole('button',{name:'聚焦分支',exact:true})).toBeVisible();
   const feedback=await page.evaluate(async()=>{const values:number[]=[];for(let i=0;i<20;i++){
    const card=document.querySelector<HTMLElement>('.react-flow__node[data-id="r2"] .dependency-card')!,before=Number(getComputedStyle(card).opacity);
    const button=[...document.querySelectorAll<HTMLButtonElement>('.modal-card-workspace button')].find(b=>['聚焦分支','退出聚焦'].includes(b.getAttribute('aria-label')||b.textContent||''))!;
    const start=performance.now();button.click();await new Promise<void>(resolve=>{const tick=()=>{if(Math.abs(Number(getComputedStyle(card).opacity)-before)>.001||performance.now()-start>1500)resolve();else requestAnimationFrame(tick);};requestAnimationFrame(tick);});values.push(performance.now()-start);await new Promise(r=>setTimeout(r,210));
   }values.sort((a,b)=>a-b);return {samples:values.length,p95Ms:values[18],maxMs:values[19]};});
   if(sample>0)motionSamples.push({nodes:count,sample,...motion,feedback});fs.mkdirSync('.preview/qa',{recursive:true});fs.writeFileSync('.preview/qa/canvas-motion.json',JSON.stringify(motionSamples,null,2));expect(feedback.p95Ms).toBeLessThanOrEqual(100);expect(motion.p95FrameMs).toBeLessThanOrEqual(33);
   await expect(page.locator('.react-flow__edge')).toHaveCount(count-1);await headerAction(page,'放弃修改');if(await page.getByRole('dialog').count())await page.getByRole('button',{name:'放弃草稿',exact:true}).click();await ready(page);
  }
  await page.unroute(`**/api/projects/${project.id}/path-graph**`);
 }
 const result=[20,80,200].map(nodes=>({nodes,edges:nodes*3,browser:testInfo.project.use.channel,layout:stats(samples.filter(s=>s.nodes===nodes).map(s=>s.elapsed)),motionFrames:stats(motionSamples.filter(s=>s.nodes===nodes).map(s=>s.p95FrameMs)),focusFeedback:stats(motionSamples.filter(s=>s.nodes===nodes).map(s=>s.feedback.p95Ms))}));
 fs.mkdirSync('.preview/qa',{recursive:true});fs.writeFileSync('.preview/qa/browser-layout.json',JSON.stringify(result,null,2));fs.writeFileSync('.preview/qa/canvas-motion.json',JSON.stringify(motionSamples,null,2));await testInfo.attach('layout-performance',{body:JSON.stringify(result),contentType:'application/json'});
});



test('20/80/200 节点拖动反馈与预览箭头保持响应，取消不修改布局',{tag:'@performance'}, async({page},info)=>{
 test.setTimeout(480000);const {project}=await fixture(page),results:Array<{nodes:number;sample:number;edges:number;p95FrameMs:number;p95FeedbackMs:number}>=[];
 for(const count of [20,80,200])for(let sample=0;sample<6;sample++){
  const input=largeGraphInput(project,count,count*100+sample),data=analysePaths(input),dependencies=input.dependencies;const pattern=`**/api/projects/${project.id}/path-graph**`;await mockGraphAnalysis(page,project.id,data);await openGraph(page,'/paths?pathScope=all');await ready(page);if(await page.getByLabel('编辑画布',{exact:true}).isVisible())await graphToolbar(page,'编辑画布');
  await locateNode(page,'交付需求 1');
  await readableZoom(page);
  const node=page.locator('.react-flow__node[data-id=r0]');await node.locator('.dependency-card').click();await page.waitForTimeout(220);
  const before=await node.getAttribute('style'),box=(await node.boundingBox())!,x=box.x+box.width*.35,y=box.y+12;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+12,y,{steps:2});await expect(page.locator('.graph-pending-route').first()).toBeVisible();
  const observation=page.evaluate(async()=>{const intervals:number[]=[],latency:number[]=[];let moving=false,active=true,last=performance.now(),frame=0;const node=document.querySelector<HTMLElement>('.react-flow__node[data-id=r0]')!;
   let displayed=node.style.transform;const move=(e:PointerEvent)=>{if(e.buttons!==1)return;moving=true;const began=performance.now();requestAnimationFrame(()=>{if(node.style.transform!==displayed&&document.querySelector('.graph-pending-route[marker-end]')){latency.push(performance.now()-began);displayed=node.style.transform;}});};
   const tick=(now:number)=>{if(!active)return;if(moving)intervals.push(now-last);last=now;frame=requestAnimationFrame(tick);};document.addEventListener('pointermove',move,true);frame=requestAnimationFrame(tick);
   await new Promise<void>(resolve=>document.addEventListener('pointerup',()=>resolve(),{once:true}));active=false;document.removeEventListener('pointermove',move,true);cancelAnimationFrame(frame);const p95=(values:number[])=>[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*.95)-1)]||0;return {frameSamples:intervals.length,feedbackSamples:latency.length,p95FrameMs:p95(intervals),p95FeedbackMs:p95(latency)};
  });
  await page.mouse.move(x+332,y,{steps:40});await page.keyboard.press('Escape');await page.mouse.up();const measured=await observation;await info.attach('drag-'+count,{body:JSON.stringify(measured),contentType:'application/json'});await ready(page);expect(await node.getAttribute('style')).toBe(before);await expect(page.locator('.graph-pending-route')).toHaveCount(0);expect(measured.frameSamples).toBeGreaterThan(20);expect(measured.feedbackSamples).toBeGreaterThan(20);expect(measured.p95FeedbackMs).toBeLessThanOrEqual(100);expect(measured.p95FrameMs).toBeLessThanOrEqual(33);if(sample>0)results.push({nodes:count,sample,edges:dependencies.length,...measured});await page.unroute(pattern);
 }
 fs.mkdirSync('.preview/qa',{recursive:true});fs.writeFileSync('.preview/qa/gesture-drag-performance.json',JSON.stringify(results,null,2));const summary=[20,80,200].map(nodes=>({nodes,frame:stats(results.filter(s=>s.nodes===nodes).map(s=>s.p95FrameMs)),feedback:stats(results.filter(s=>s.nodes===nodes).map(s=>s.p95FeedbackMs))}));fs.writeFileSync('.preview/qa/gesture-drag-summary.json',JSON.stringify(summary,null,2));await info.attach('drag-performance',{body:JSON.stringify(summary),contentType:'application/json'});
});

function stats(samples:number[]){const sorted=[...samples].sort((a,b)=>a-b);expect(samples).toHaveLength(5);return {samples,median:sorted[2],max:sorted.at(-1)};}
