import {expect,test,type Page} from '@playwright/test';
import {phaseFixture} from './phase-fixture';
import {headerAction} from './topbar-helpers';
import {openGraphDrafts} from './graph-interactions';
import type {WorkItemTemplate} from '../../src/client/types';

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

test('流程本机偏好不可读时仍可打开，保存后清理偏好失败不重复创建',async({page},info)=>{
  const post=async(url:string,data:unknown)=>{const r=await page.request.post(url,{data});expect(r.ok(),await r.text()).toBe(true);return r.json();};
  const session=await post('/api/login',{username:'admin',password:'41_xc7q0qOjo4Inw!'});
  const project=await post('/api/projects',{name:'流程存储恢复 '+Date.now()});
  const list=async():Promise<WorkItemTemplate[]>=>{const r=await page.request.get('/api/templates?projectId='+project.id);expect(r.ok()).toBe(true);return r.json();};
  const before=await list(),existing=before[0],errors:string[]=[],writes:string[]=[];
  await page.addInitScript(()=>{
    const get=Storage.prototype.getItem,set=Storage.prototype.setItem,remove=Storage.prototype.removeItem;
    const mode=()=>get.call(sessionStorage,'mh-storage-mode')||'all';
    const blocked=()=>{throw new DOMException('Local preferences unavailable','SecurityError');};
    Storage.prototype.getItem=function(key){return this===localStorage&&mode()==='all'?blocked():get.call(this,key);};
    Storage.prototype.setItem=function(key,value){return this===localStorage&&(mode()==='all'||mode()==='cleanup'&&key.startsWith('pm-graph-view:'))?blocked():set.call(this,key,value);};
    Storage.prototype.removeItem=function(key){return this===localStorage&&mode()!=='none'?blocked():remove.call(this,key);};
  });
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/')&&!['GET','HEAD'].includes(r.method()))writes.push(r.method()+' '+new URL(r.url()).pathname);});
  const editor=page.locator('.template-flow-workspace');
  await page.goto('/templates?'+new URLSearchParams({projectId:project.id,edit:existing.id}));
  await expect(editor.locator('[data-layout-ready=true]')).toBeVisible();
  await expect(editor.locator('.react-flow__node')).toHaveCount(existing.items.length);
  await expect(page.getByRole('heading',{name:'页面出现异常',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeDisabled();
  await page.goto('/templates?'+new URLSearchParams({projectId:project.id,edit:'new'}));
  await expect(editor.locator('[data-layout-ready=true]')).toBeVisible();
  await expect.poll(()=>new URL(page.url()).searchParams.get('draft')).toBeTruthy();
  const draftId=new URL(page.url()).searchParams.get('draft')!;
  await page.screenshot({path:info.outputPath('template-storage-blocked-1280.png'),animations:'disabled'});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:info.outputPath('template-storage-blocked-390.png'),animations:'disabled'});
  expect(writes).toEqual([]);expect(await list()).toEqual(before);

  await page.evaluate(()=>sessionStorage.setItem('mh-storage-mode','none'));
  await page.reload();await expect(editor.locator('[data-layout-ready=true]')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('draft')).toBe(draftId);
  await headerAction(page,'流程属性');
  await page.getByRole('textbox',{name:'流程名称',exact:true}).fill('偏好不可用仍完成创建');
  await page.getByRole('textbox',{name:'设计说明',exact:true}).fill('保存完成后，不因本机偏好清理失败而再次提交。');
  await page.evaluate(({accountId,projectId,draftId})=>{
    localStorage.setItem('pm-graph-view:'+accountId+':'+projectId+':template:'+draftId,JSON.stringify({x:0,y:0,zoom:1}));
    sessionStorage.setItem('mh-storage-mode','cleanup');
  },{accountId:session.accountId,projectId:project.id,draftId});
  await headerAction(page,'保存修改');
  await expect.poll(async()=>(await list()).filter(t=>t.name==='偏好不可用仍完成创建').length).toBe(1);
  const saved=(await list()).find(t=>t.name==='偏好不可用仍完成创建')!;
  await expect.poll(()=>new URL(page.url()).searchParams.get('edit')).toBe(saved.id);
  await expect(editor.locator('.react-flow__node')).toHaveCount(1);
  await page.screenshot({path:info.outputPath('template-storage-saved-390.png'),animations:'disabled'});
  expect(writes).toEqual(['POST /api/templates']);
  expect((await list()).filter(t=>t.id!==saved.id)).toEqual(before);
  await page.evaluate(()=>sessionStorage.setItem('mh-storage-mode','none'));
  await page.reload();await expect(editor.locator('[data-layout-ready=true]')).toBeVisible();
  expect((await list()).find(t=>t.id===saved.id)).toEqual(saved);
  await headerAction(page,'返回流程列表');
  await page.getByRole('button',{name:'新建流程',exact:true}).click();
  await expect(editor.locator('[data-layout-ready=true]')).toBeVisible();
  if(!await page.getByRole('textbox',{name:'流程名称',exact:true}).isVisible())await headerAction(page,'流程属性');
  await expect(page.getByRole('textbox',{name:'流程名称',exact:true})).toHaveValue('');
  await expect(page.getByRole('textbox',{name:'设计说明',exact:true})).toHaveValue('');
  expect((await list()).find(t=>t.id===saved.id)).toEqual(saved);
  expect(writes).toEqual(['POST /api/templates']);expect(errors).toEqual([]);
});

test('本机编辑状态读取失败可重试，重试不会接管另一页面草稿',async({page,context},info)=>{
  const f=await phaseFixture(page),errors:string[]=[],writes:string[]=[];
  const read=async()=>{const r=await page.request.get('/api/templates?projectId='+f.projectId);expect(r.ok()).toBe(true);return r.json();};
  const before=await read(),url='/templates?'+new URLSearchParams({projectId:f.projectId,edit:f.testing.templateId!});
  const track=(target:Page)=>{target.on('pageerror',e=>errors.push(e.message));target.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/')&&!['GET','HEAD'].includes(r.method()))writes.push(r.method()+' '+new URL(r.url()).pathname);});};
  track(page);await page.goto(url);await expect(page.locator('[data-layout-ready=true]')).toBeVisible();
  await headerAction(page,'流程属性');
  const name=page.getByRole('textbox',{name:'流程名称',exact:true});
  await name.fill('仍由原页面编辑');await name.blur();
  await expect(page.getByText('草稿已保留',{exact:true})).toBeVisible();
  const tab=await context.newPage();track(tab);
  try{
    await tab.addInitScript(()=>{
      const get=Storage.prototype.getItem,set=Storage.prototype.setItem;
      const blocked=(storage:Storage,key:string)=>storage===localStorage&&key.startsWith('pm-editor-lease:')&&get.call(sessionStorage,'mi-allow-lease')!=='1';
      Storage.prototype.getItem=function(key){if(blocked(this,key))throw new DOMException('Lease storage denied','SecurityError');return get.call(this,key);};
      Storage.prototype.setItem=function(key,value){if(blocked(this,key))throw new DOMException('Lease storage denied','SecurityError');return set.call(this,key,value);};
    });
    await tab.goto(url);await expect(tab.locator('[data-layout-ready=true]')).toBeVisible();
    await expect(tab.locator('.page-toolbar-status')).toContainText('编辑状态无法确认');
    await expect(tab.getByRole('button',{name:'保存修改',exact:true})).toBeDisabled();
    await openGraphDrafts(tab);
    await expect(tab.getByRole('alert')).toContainText('无法读取本机编辑状态');
    await tab.getByRole('button',{name:'重新检查编辑状态',exact:true}).click();
    await expect(tab.getByRole('alert')).toContainText('无法读取本机编辑状态');
    await tab.getByRole('button',{name:'接管此草稿',exact:true}).click();
    await expect(tab.getByRole('button',{name:'保存修改',exact:true})).toBeDisabled();
    await expect(tab.getByRole('alert')).toContainText('无法读取本机编辑状态');
    await expect(name).toBeEnabled();
    if(!await tab.getByRole('heading',{name:'草稿与冲突',exact:true}).isVisible()){
      await tab.locator('.page-toolbar-status').getByRole('button',{name:'草稿状态',exact:true}).click();
      await tab.getByRole('dialog',{name:'状态说明',exact:true}).getByRole('button',{name:'查看详情',exact:true}).click();
    }
    await expect(tab.getByRole('alert')).toBeVisible();
    await expect(tab.getByRole('button',{name:'重新检查编辑状态',exact:true})).toBeVisible();
    await tab.screenshot({path:info.outputPath('ownership-unavailable-1280.png'),animations:'disabled'});
    await tab.setViewportSize({width:390,height:844});
    await expect(tab.getByRole('button',{name:'重新检查编辑状态',exact:true})).toBeInViewport();
    await expect(tab.getByRole('button',{name:'接管此草稿',exact:true})).toBeInViewport();
    await tab.screenshot({path:info.outputPath('ownership-unavailable-390.png'),animations:'disabled'});
    await tab.evaluate(()=>sessionStorage.setItem('mi-allow-lease','1'));
    await tab.getByRole('button',{name:'重新检查编辑状态',exact:true}).click();
    await expect(tab.locator('.page-toolbar-status')).toContainText('其他页面编辑中');
    await expect(tab.getByRole('button',{name:'重新检查编辑状态',exact:true})).toHaveCount(0);
    await expect(tab.getByRole('button',{name:'保存修改',exact:true})).toBeDisabled();
    await expect(name).toBeEnabled();await expect(name).toHaveValue('仍由原页面编辑');
    await tab.getByRole('button',{name:'接管此草稿',exact:true}).click();
    await expect(page.locator('.page-toolbar-status')).toContainText('其他页面编辑中');
    await expect(tab.locator('.page-toolbar-status')).not.toContainText('编辑状态无法确认');
    await expect(tab.getByRole('button',{name:'保存修改',exact:true})).toBeEnabled();
    if(!await tab.getByRole('textbox',{name:'流程名称',exact:true}).isVisible())await headerAction(tab,'流程属性');
    await expect(tab.getByRole('textbox',{name:'流程名称',exact:true})).toBeEnabled();
    await expect(tab.getByRole('textbox',{name:'流程名称',exact:true})).toHaveValue('仍由原页面编辑');
    expect(await read()).toEqual(before);expect(writes).toEqual([]);expect(errors).toEqual([]);
  }finally{await tab.close();}
});
