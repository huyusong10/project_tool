import {expect,test,type Page} from '@playwright/test';
import {headerAction} from './topbar-helpers';
async function setup(page:Page){
  const login=await page.request.post('/api/login',{data:{username:'admin',password:'41_xc7q0qOjo4Inw!'}});expect(login.ok()).toBe(true);const session=await login.json();
  const project=await(await page.request.post('/api/projects',{data:{name:'连续画布 '+Date.now()}})).json();
  const create=async(name:string)=>(await(await page.request.post('/api/projects/'+project.id+'/requirement-groups',{data:{name,sortOrder:999}})).json()).groups.find((g:{name:string})=>g.name===name);
  const a=await create('基础授权'),b=await create('团队协作');
  let req=await(await page.request.post('/api/requirements',{data:{projectId:project.id,title:'角色权限',groupId:a.id}})).json();
  const second=await(await page.request.post('/api/requirements',{data:{projectId:project.id,title:'审计查询',groupId:a.id}})).json();
  const work=await page.request.post('/api/requirements/'+req.id+'/work-items',{data:{expectedVersion:req.version,title:'权限验证'}});expect(work.ok(),await work.text()).toBe(true);
  req=await(await page.request.get('/api/requirements/'+req.id)).json();
  await page.addInitScript(({accountId,projectId})=>localStorage.setItem('project-manage:selected-project:'+accountId,projectId),{accountId:session.accountId,projectId:project.id});
  return {project,session,a,b,req,second};
}
async function ready(page:Page){await expect(page.locator('.dependency-canvas')).toHaveAttribute('data-layout-ready','true');}
const node=(page:Page,id:string)=>page.locator('.react-flow__node[data-id="'+id+'"]');
async function planning(page:Page,a:string,b:string){await headerAction(page,'建立规划关系');const dialog=page.getByRole('dialog');await dialog.getByLabel('前置特性').selectOption(a);await dialog.getByLabel('后续特性').selectOption(b);await dialog.getByLabel('关系说明').fill('先验证基础授权');await dialog.getByRole('button',{name:'加入草稿'}).click();}
test('规划关系、执行依赖和工作项布局连续下钻后一次保存',async({page})=>{
  const {project,a,b,req,second}=await setup(page),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/paths?view=features');await ready(page);await page.getByLabel('编辑画布',{exact:true}).click();await planning(page,a.id,b.id);
  expect((await(await page.request.get('/api/projects/'+project.id+'/feature-relations')).json())).toHaveLength(0);
  await node(page,'feature:'+a.id).locator('strong').dblclick();await expect(page).toHaveURL(/view=feature&/);await ready(page);
  await expect(page.getByRole('navigation',{name:'画布层级'})).toContainText('基础授权');
  await node(page,req.id).getByRole('button',{name:/从.*连接后续/}).first().click();await node(page,second.id).locator('.dependency-card').click();
  await node(page,req.id).locator('strong').dblclick();await expect(page).toHaveURL(/view=requirement&/);await ready(page);
  await expect(page.getByRole('navigation',{name:'画布层级'})).toContainText('角色权限');
  await node(page,req.workItems[0].id).locator('.dependency-card').click();await page.getByLabel('元素名称').fill('权限验证与回归');await page.getByLabel('元素名称').blur();
  await page.locator('.dependency-canvas').focus();await page.keyboard.press('Shift+ArrowRight');
  await page.getByRole('navigation',{name:'画布层级'}).getByRole('button',{name:'特性总览',exact:true}).click();await ready(page);
  await expect(page.getByLabel('保存修改',{exact:true})).toBeEnabled();let writes=0;page.on('request',r=>{if(r.url().endsWith('/dependency-changes/apply'))writes++;});
  await page.getByLabel('保存修改',{exact:true}).click();await expect(page.getByLabel('编辑画布',{exact:true})).toBeVisible();
  const relations=await(await page.request.get('/api/projects/'+project.id+'/feature-relations')).json();expect(relations).toHaveLength(1);
  const analysis=await(await page.request.get('/api/projects/'+project.id+'/path-analysis')).json();expect(analysis.dependencies).toHaveLength(1);expect(analysis.nodes.find((n:{id:string})=>n.id===req.workItems[0].id).title).toBe('权限验证与回归');expect(analysis.layouts.some((l:{scope:string})=>l.scope==='requirement:'+req.id)).toBe(true);expect(writes).toBe(1);expect(errors).toEqual([]);
});
test('根视图并列、旧链接兼容，返回恢复选择与缩放',async({page})=>{
  const {a,req}=await setup(page);await page.goto('/paths?view=features');await ready(page);
  await node(page,'feature:'+a.id).locator('.dependency-card').click();await page.getByLabel('缩小画布',{exact:true}).click();
  const transform=await page.locator('.react-flow__viewport').getAttribute('style');
  await page.getByRole('button',{name:'进入需求图',exact:true}).click();await ready(page);await node(page,req.id).locator('strong').dblclick();await ready(page);
  await page.getByRole('navigation',{name:'画布层级'}).getByRole('button',{name:'特性总览',exact:true}).click();await ready(page);
  await expect(node(page,'feature:'+a.id)).toHaveClass(/selected/);await expect(page.locator('.react-flow__viewport')).toHaveAttribute('style',transform!);
  await page.getByRole('group',{name:'路径根视图'}).getByRole('button',{name:'全部需求'}).click();await ready(page);await expect(page.getByRole('navigation',{name:'画布层级'})).not.toContainText('特性总览');
  await page.goto('/requirements/'+req.id+'?view=path');await expect(page).toHaveURL(/\/paths\?.*view=requirement/);await ready(page);await expect(page.getByRole('navigation',{name:'画布层级'})).toContainText('全部需求');await expect(page.getByRole('navigation',{name:'画布层级'})).not.toContainText('基础授权');
});
