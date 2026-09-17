import { expect,type Locator,type Page } from '@playwright/test';

const scopes=new WeakMap<Page,{projectId:string;featureId:string}>();
const propertyNodes=new WeakMap<Page,string>();
export function setGraphScope(page:Page,projectId:string,featureId:string){scopes.set(page,{projectId,featureId});}
/** Legacy test intents are expressed with explicit current workspace scopes. */
export async function openGraph(page:Page,path:string){
  const url=new URL(path,'http://workspace.test'),scope=scopes.get(page);
  const requirement=url.pathname.match(/^\/requirements\/([^/]+)$/)?.[1];
  if(requirement&&!url.searchParams.has('draftProject')){
    url.pathname='/';url.searchParams.set('workspaceView','graph');url.searchParams.set('scopeType','requirement');url.searchParams.set('scopeId',requirement);
    if(scope)url.searchParams.set('projectId',scope.projectId);
  }else if(scope&&url.pathname==='/paths'&&(!url.searchParams.has('view')||url.searchParams.get('view')==='project')){
    url.pathname='/';url.searchParams.set('projectId',scope.projectId);url.searchParams.set('workspaceView','graph');url.searchParams.set('scopeType','feature');url.searchParams.set('scopeId',scope.featureId);
  }
  await page.goto(url.pathname+url.search);
}
export async function closeGraphProperties(page:Page){
  const modal=page.locator('.modal-card-workspace[role=dialog]');
  if(await modal.isVisible()){await modal.getByRole('button',{name:'关闭',exact:true}).click();await expect(modal).toHaveCount(0);}
}
export async function graphProperties(page:Page,card:Locator){
  await closeGraphProperties(page);
  const node=card.locator('xpath=ancestor-or-self::*[@data-id][1]'),title=node.locator('.graph-title');
  const id=await node.getAttribute('data-id');if(id)propertyNodes.set(page,id);
  if(await title.count())await title.click();else await card.click();
}
export async function openGraphDrafts(page:Page){
  const node=page.locator('.react-flow__node.selected').first();if(await node.count()){const id=await node.getAttribute('data-id');if(id)propertyNodes.set(page,id);}
  await closeGraphProperties(page);
  const status=page.locator('.graph-footer').getByRole('button',{name:'草稿状态',exact:true}).or(page.locator('.page-toolbar').getByRole('button',{name:'草稿状态',exact:true})).last();
  if(!await status.isVisible())await page.getByRole('button',{name:'更多操作',exact:true}).click();
  if(await page.getByRole('button',{name:'接管此草稿',exact:true}).isVisible())return;
  await status.click();
  const explanation=page.getByRole('dialog',{name:'状态说明',exact:true});
  if(await explanation.isVisible())await explanation.getByRole('button',{name:'查看详情',exact:true}).click();
}
export async function reopenGraphProperties(page:Page){
  const id=propertyNodes.get(page);if(!id)throw Error('No selected property node to reopen');
  const panel=page.locator('.graph-auxiliary');
  if(await panel.isVisible())await panel.getByRole('button',{name:'关闭',exact:true}).click();
  await graphProperties(page,page.locator('.react-flow__node[data-id="'+id+'"] .dependency-card'));
}
export async function graphToolbar(page:Page,name:string){
  await page.bringToFront();
  const wasOpen=await page.getByRole('dialog').filter({has:page.getByRole('tablist',{name:'关系图详情内容'})}).isVisible();
  const selected=page.locator('.react-flow__node.selected').first(),id=await selected.count()?await selected.getAttribute('data-id'):null;
  const edge=page.locator('.react-flow__edge.selected').first(),edgeId=await edge.count()?await edge.getAttribute('data-id'):null;
  await closeGraphProperties(page);
  const control=page.getByLabel(name,{exact:true});
  if(['撤销','重做'].includes(name)&&!await control.isVisible()){
    await page.getByRole('button',{name:'更多操作',exact:true}).click();
    await page.getByRole('button',{name:name+'修改',exact:true}).click();
  }else await control.click();
  if(wasOpen&&id&&['撤销','重做'].includes(name)){
    await expect(page.locator('.dependency-canvas')).toHaveAttribute('data-layout-ready','true');
    const node=page.locator('.react-flow__node[data-id="'+id+'"] .dependency-card');
    // Undoing creation removes the selected node; only restore a surviving selection.
    if(await node.count()&&await node.locator('.business-handle').count())await graphProperties(page,node);
  }else if(wasOpen&&edgeId&&['撤销','重做'].includes(name)){
    const edge=page.locator('.react-flow__edge[data-id="'+edgeId+'"] .dependency-edge-label');
    if(await edge.count())await edge.click();
  }
}
export async function focusGraph(page:Page){await closeGraphProperties(page);await page.locator('.dependency-canvas').focus();}
