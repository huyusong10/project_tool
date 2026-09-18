import {expect,test,type Page} from '@playwright/test';
import {phaseFixture} from './phase-fixture';

test('会话存储不可用时关系图仍可浏览，可读的旧排序回执仍能核对',async({page},info)=>{
  const f=await phaseFixture(page),errors:string[]=[],writes:string[]=[];
  const read=async()=>{const response=await page.request.get(f.base+'/path-graph');expect(response.ok()).toBe(true);return response.json();};
  const before=await read(),session=await(await page.request.get('/api/session')).json();
  const track=(target:Page)=>{
    target.on('pageerror',e=>errors.push(e.message));
    target.on('request',r=>{if(r.url().includes('/api/')&&!['GET','HEAD'].includes(r.method()))writes.push(r.method()+' '+new URL(r.url()).pathname);});
  };
  await page.addInitScript(()=>{
    const get=Storage.prototype.getItem,set=Storage.prototype.setItem,remove=Storage.prototype.removeItem;
    const blocked=()=>{throw new DOMException('Session storage unavailable','SecurityError');};
    Storage.prototype.getItem=function(key){return this===window.sessionStorage?blocked():get.call(this,key);};
    Storage.prototype.setItem=function(key,value){return this===window.sessionStorage?blocked():set.call(this,key,value);};
    Storage.prototype.removeItem=function(key){return this===window.sessionStorage?blocked():remove.call(this,key);};
  });
  track(page);
  const url='/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'graph',scopeType:'project'});
  await page.goto(url);await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await page.getByRole('button',{name:'进展表',exact:true}).click();await expect(page.locator('.workspace-gantt')).toBeVisible();
  await page.getByRole('button',{name:'关系图',exact:true}).click();await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await page.getByRole('button',{name:'查看修改与错误',exact:true}).click();
  await expect(page.locator('.canvas-draft-details')).toContainText('浏览器阻止了本机存储访问');
  await expect(page.getByRole('button',{name:'重新核对旧草稿',exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:info.outputPath('storage-unavailable-390.png'),animations:'disabled'});
  await page.reload();await expect(page.locator('.react-flow__node').first()).toBeVisible();await expect(page.getByRole('heading',{name:'页面出现异常',exact:true})).toHaveCount(0);
  const legacy=await page.context().newPage(),key='pm-feature-order-write:'+session.accountId+':'+f.projectId;
  try{
    await legacy.addInitScript(key=>sessionStorage.setItem(key,'旧顺序待核对'),key);track(legacy);
    await legacy.goto(url);const receipt=legacy.getByRole('alert').filter({hasText:'旧排序操作待核对：旧顺序待核对'});
    await expect(receipt).toBeVisible();await expect(legacy.locator('.react-flow__node').first()).toBeVisible();
    await receipt.getByRole('button',{name:'读取最新资料并核对顺序',exact:true}).click();await expect(receipt).toHaveCount(0);
    expect(await legacy.evaluate(key=>sessionStorage.getItem(key),key)).toBeNull();
  }finally{await legacy.close();}
  expect(await read()).toEqual(before);expect(writes).toEqual([]);expect(errors).toEqual([]);
});
