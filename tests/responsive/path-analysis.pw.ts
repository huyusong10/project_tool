import fs from 'node:fs';
import {test,expect,type Page} from '@playwright/test';
import {analysePaths,type PathInput,type PathAnalysis} from '../../src/shared/paths';
import type {Requirement,WorkItemTemplate} from '../../src/client/types';
import {addBusinessDays,todayIso} from '../../src/shared/domain';
import {req,work} from '../fixtures/path-network';
import {themes} from '../../src/client/theme';
async function fixture(page:Page){
 const login=await page.request.post('/api/login',{data:{username:'admin',password:'41_xc7q0qOjo4Inw!'}});expect(login.ok()).toBe(true);
 const session=await(await page.request.get('/api/session')).json();const name=`图验证${Date.now()}`;
 const project=await(await page.request.post('/api/projects',{data:{name,plannedEnd:addBusinessDays(todayIso(),3)}})).json();
 const owner=await(await page.request.post('/api/people',{data:{projectId:project.id,name:`负责人${Date.now()}`}})).json();
 const template=await(await page.request.post('/api/templates',{data:{projectId:project.id,name:'依赖流程',dependencyMode:'dependencies',items:[{clientKey:'a',title:'方案交付',durationDays:2,startOffsetDays:0,sortOrder:0,predecessorKeys:[]},{clientKey:'b',title:'集成验证',durationDays:3,startOffsetDays:2,sortOrder:1,predecessorKeys:['a']}]}})).json() as WorkItemTemplate;
 const create=async(title:string)=>await(await page.request.post('/api/requirements',{data:{projectId:project.id,templateId:template.id,ownerId:owner.id,title,plannedStart:addBusinessDays(todayIso(),0)}})).json() as Requirement;
 const a=await create('接口基础交付'),b=await create('订单交付');
 const analysis=async()=>await(await page.request.get(`/api/projects/${project.id}/path-analysis`)).json() as PathAnalysis;
 await page.request.post(`/api/projects/${project.id}/dependencies`,{data:{sourceRequirementId:a.id,sourceWorkItemId:a.workItems[0].id,targetRequirementId:b.id,targetWorkItemId:b.workItems[1].id,expectedRevision:(await analysis()).revision}});
 await page.addInitScript(({account,id})=>localStorage.setItem(`project-manage:selected-project:${account}`,id),{account:session.accountId,id:project.id});
 return {project,a,b,analysis};
}
const ready=(page:Page)=>expect(page.locator('[data-layout-ready="true"]')).toBeVisible({timeout:20000});
test('全局→需求→外部交付→返回，刷新保留目标、选择及筛选',async({page})=>{
 const {a,b,analysis}=await fixture(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/paths?pathScope=all');await ready(page);await page.locator('.path-node-list button').filter({hasText:b.title}).click();
 const globalUrl=page.url();const risk=(await analysis()).risks[b.id];
 await page.getByRole('button',{name:'进入需求路径',exact:true}).click();await ready(page);await expect(page).toHaveURL(/target=project/);await expect(page.getByLabel('分析目标',{exact:true})).toHaveValue('project');
 await page.reload();await ready(page);await expect(page.getByLabel('分析目标',{exact:true})).toHaveValue('project');
 const local=await(await page.request.get(`/api/requirements/${b.id}/path-analysis`)).json() as PathAnalysis;expect(local.target).toBe(`acceptance:${b.id}`);expect(local.risks[b.id]).toEqual(risk);
 await page.locator(`.path-node-list button`).filter({hasText:'方案交付'}).last().click();
 // Select the actual external delivery card, independently of ordering in the node list.
 await page.locator(`.react-flow__node[data-id="${a.workItems[0].id}"]`).click();await page.getByRole('button',{name:'进入需求路径',exact:true}).click();await ready(page);await expect(page).toHaveURL(new RegExp(a.id));
 await page.getByRole('link',{name:'返回全局分析'}).click();await ready(page);expect(page.url()).toBe(globalUrl);expect(errors).toEqual([]);
});
test('通过真实接口增删关系后图动态更新，旧确认不会误提交',async({page})=>{
 const {a,b,analysis}=await fixture(page);await page.goto(`/requirements/${b.id}?view=path`);await ready(page);const before=(await analysis()).dependencies.length;
 await page.getByRole('button',{name:'配置前置',exact:true}).click();const modal=page.getByRole('dialog');await modal.getByLabel('前置需求',{exact:true}).selectOption(a.id);await modal.getByLabel('前置交付点').selectOption(a.workItems[1].id);await modal.getByLabel('后续工作').selectOption(b.workItems[1].id);await modal.getByRole('button',{name:'保存',exact:true}).click();await expect(modal).toHaveCount(0);await ready(page);expect((await analysis()).dependencies).toHaveLength(before+1);
 const relation=page.locator('.path-relation').filter({hasText:'集成验证 → 集成验证'});await relation.getByRole('button',{name:'移除',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'确认移除'}).click();await ready(page);await expect.poll(async()=>(await analysis()).dependencies.length).toBe(before);
 await page.locator(`.react-flow__node[data-id="${b.workItems[0].id}"]`).click();await page.getByRole('button',{name:'工期与预测'}).click();await page.getByRole('dialog').getByRole('spinbutton').fill('4');await page.getByRole('dialog').getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await ready(page);
});
test('所有主题和窄屏都有完整画布，颜色变化不移动节点',async({page},testInfo)=>{
 const {b}=await fixture(page);await page.goto(`/requirements/${b.id}?view=path`);await ready(page);
 const positions=()=>page.locator('.react-flow__node').evaluateAll(nodes=>nodes.map(n=>({id:n.getAttribute('data-id'),transform:(n as HTMLElement).style.transform})).sort((a,b)=>a.id!.localeCompare(b.id!)));
 const baseline=await positions();for(const theme of themes){await page.getByRole('button',{name:/切换风格/}).click();await page.getByRole('menuitemradio',{name:new RegExp('^'+theme.label)}).click();await expect(page.locator('html')).toHaveAttribute('data-theme',theme.id);await ready(page);expect(await positions()).toEqual(baseline);}
 await page.getByRole('button',{name:/切换风格/}).click();await page.getByRole('menuitemradio',{name:/跟随系统/}).click();await page.emulateMedia({colorScheme:'dark'});await expect(page.locator('html')).toHaveAttribute('data-theme','dcim');await page.emulateMedia({colorScheme:'light'});await expect(page.locator('html')).toHaveAttribute('data-theme','classic');
 await page.setViewportSize({width:390,height:844});await ready(page);const box=await page.locator('.dependency-canvas').boundingBox();expect(box!.width).toBeGreaterThan(240);await page.screenshot({path:testInfo.outputPath('paths-narrow.png'),fullPage:true});
 const clipped=await page.locator('.requirement-path-panel').evaluate(n=>n.scrollHeight>n.clientHeight+4);expect(clipped).toBe(false);
});

test('20/80/200 个可见节点真实 Worker 布局，200 节点 600 边 p95 不超过 2 秒',async({page},testInfo)=>{
 test.skip(testInfo.project.name!=='office-1280','性能采样固定同一视口');test.setTimeout(240000);
 const {project}=await fixture(page);const samples:number[]=[];
 for(const count of [20,80,200])for(let sample=0;sample<(count===200?20:1);sample++){
  const requirements=Array.from({length:count},(_,i)=>({...req(`r${i}`),projectId:project.id,title:`交付需求 ${i+1}`}));
  const workItems=requirements.map((r,i)=>work(`w${i}`,r.id,1));const dependencies:PathInput['dependencies']=[];
  for(let i=1;i<count;i++)for(const delta of [1,3,7])if(i>=delta)dependencies.push({id:`e${i}-${delta}`,projectId:project.id,sourceRequirementId:`r${i-delta}`,sourceWorkItemId:`w${i-delta}`,targetRequirementId:`r${i}`,targetWorkItemId:`w${i}`,origin:'manual'});
  for(let i=12;dependencies.length<count*3;i++)dependencies.push({id:`extra${i}`,projectId:project.id,sourceRequirementId:`r${(i-11)%(count-11)}`,sourceWorkItemId:`w${(i-11)%(count-11)}`,targetRequirementId:`r${(i-11)%(count-11)+11}`,targetWorkItemId:`w${(i-11)%(count-11)+11}`,origin:'manual'});
  const input:PathInput={projectId:project.id,projectName:project.name,revision:sample,projectEnd:null,asOfDate:'2026-09-07',requirements,workItems,dependencies};const result=analysePaths(input);
  await page.route(`**/api/projects/${project.id}/path-analysis`,route=>route.fulfill({json:result}));await page.goto('/paths?pathScope=all');await ready(page);await expect(page.locator('.react-flow__node')).toHaveCount(count);
  const elapsed=await page.evaluate(()=>performance.getEntriesByName('pm-path-layout').at(-1)!.duration);if(count===200)samples.push(elapsed);
  if(sample===0){await page.locator('.dependency-canvas').screenshot({path:testInfo.outputPath(`graph-${count}.png`)});const overlaps=await page.locator('.dependency-canvas').evaluate(root=>{
   const nodes=Array.from(root.querySelectorAll('.react-flow__node')).map(n=>n.getBoundingClientRect());const labels=Array.from(root.querySelectorAll('.dependency-edge-label rect')).map(n=>n.getBoundingClientRect());
   return labels.filter(a=>nodes.some(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)).length;
  });expect(overlaps).toBe(0);}
  await page.unroute(`**/api/projects/${project.id}/path-analysis`);
 }
 const sorted=[...samples].sort((a,b)=>a-b);const result={samples:samples.length,p50Ms:sorted[10],p95Ms:sorted[18],maxMs:sorted[19],browser:testInfo.project.use.channel,nodes:200,edges:600};fs.mkdirSync('.preview/qa',{recursive:true});fs.writeFileSync('.preview/qa/browser-layout.json',JSON.stringify(result,null,2));expect(result.p95Ms).toBeLessThanOrEqual(2000);
});
