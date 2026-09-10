import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {emptyDraftContent,type RequirementDraft} from '../../src/shared/requirement-drafts';

test.use({launchOptions:{args:['--host-resolver-rules=MAP project-manage.test 127.0.0.1','--no-proxy-server']}});
async function fixture(page:Page){
  expect((await page.request.post('/api/login',{data:{username:'admin',password:'41_xc7q0qOjo4Inw!'}})).ok()).toBe(true);
  const session=await(await page.request.get('/api/session')).json();
  const project=await(await page.request.post('/api/projects',{data:{name:'个人草稿 '+Date.now()}})).json();
  await page.addInitScript(({account,id})=>localStorage.setItem(`project-manage:selected-project:${account}`,id),{account:session.accountId,id:project.id});
  return project;
}
const saved=(page:Page)=>expect(page.getByRole('status').filter({hasText:'已保存'})).toBeVisible({timeout:10000});
test('网页完整编辑、来源、拆分合并、拓扑和计划；发布响应丢失后查询回执',async({page},info)=>{
  test.setTimeout(90000);const project=await fixture(page),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/my-work');await expect(page.getByRole('button',{name:'执行工作',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'个人草稿',exact:true}).click();await page.getByRole('button',{name:'新建草稿',exact:true}).click();
  await page.getByRole('dialog').getByLabel('方案标题').fill('日志审核方案');await page.getByRole('button',{name:'创建个人草稿',exact:true}).click();
  await page.getByRole('button',{name:'新增需求',exact:true}).click();await page.getByLabel('需求标题',{exact:true}).fill('查询与详情');await page.getByLabel('验收条件',{exact:true}).fill('按条件查询结果与已知样本一致');
  await page.getByRole('button',{name:'新增工作项',exact:true}).click();await page.getByLabel('工作项标题',{exact:true}).fill('查询接口');
  await page.getByRole('button',{name:'新增工作项',exact:true}).click();await page.getByLabel('工作项标题',{exact:true}).last().fill('详情界面');
  await page.getByRole('button',{name:'新增来源文档',exact:true}).click();await page.getByLabel('来源标题',{exact:true}).fill('LOG 选摘');await page.getByRole('button',{name:'新增条款',exact:true}).click();await page.getByLabel('条款标题',{exact:true}).fill('日志检索');await page.getByLabel('可验证原文',{exact:true}).fill('使用已知时间范围检索日志，结果可核对。');
  await page.getByLabel('来源条款',{exact:true}).selectOption({label:'LOG 选摘 / 日志检索'});await page.getByLabel('落实对象',{exact:true}).selectOption({label:'查询与详情 · 需求'});await page.getByRole('button',{name:'新增落实关联',exact:true}).click();await page.getByLabel('本次落实范围',{exact:true}).fill('检索与详情端到端验证');await saved(page);
  await page.getByRole('button',{name:'拆分需求',exact:true}).click();await page.getByRole('dialog').getByLabel('新需求标题').fill('独立详情');await page.getByRole('dialog').getByLabel('详情界面').check();await page.getByRole('button',{name:'拆分并保留前置',exact:true}).click();await expect(page.getByLabel('需求标题',{exact:true})).toHaveCount(2);
  await page.getByRole('button',{name:'合并需求',exact:true}).last().click();await page.getByRole('button',{name:'合并并保留关系',exact:true}).click();await expect(page.getByLabel('需求标题',{exact:true})).toHaveCount(1);await saved(page);
  await page.getByRole('button',{name:'拓扑',exact:true}).click();await page.getByLabel('前置成果',{exact:true}).selectOption({label:'查询接口'});await page.getByLabel('后置工作',{exact:true}).selectOption({label:'详情界面'});await page.getByRole('button',{name:'添加前置关系',exact:true}).click();await saved(page);
  await page.getByRole('button',{name:'校验已保存方案',exact:true}).click();await expect(page.getByText('该版本校验通过',{exact:true})).toBeVisible();await expect(page.locator('.draft-graph .react-flow__node')).toHaveCount(4);
  await page.screenshot({path:info.outputPath('draft-topology-desktop.png')});
  await page.getByRole('button',{name:'计划',exact:true}).click();await page.getByLabel('工期（工作日）',{exact:true}).first().fill('2');await page.getByLabel('工期（工作日）',{exact:true}).last().fill('1');await saved(page);await page.getByRole('button',{name:'预览完整计划',exact:true}).click();await expect(page.getByRole('heading',{name:'完整项目网络预览'})).toBeVisible();
  expect((await(await page.request.get('/api/requirements?projectId='+project.id)).json())).toHaveLength(0);
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'需求与来源',exact:true}).click();await page.screenshot({path:info.outputPath('draft-mobile.png')});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
  await page.getByRole('button',{name:'校验已保存方案',exact:true}).click();await expect(page.getByText('该版本校验通过',{exact:true})).toBeVisible();
  let intercepted=false;await page.route('**/api/my/requirement-drafts/*/publish',async route=>{if(intercepted){await route.continue();return;}intercepted=true;await route.fetch();await route.abort('failed');});
  await page.getByRole('button',{name:'审核并发布',exact:true}).click();await page.getByRole('button',{name:'确认发布此版本',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('保留原请求');await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'查询发布回执',exact:true}).click();await expect(page.getByText('已发布到正式项目',{exact:true})).toBeVisible();
  const formal=await(await page.request.get('/api/requirements?projectId='+project.id)).json();expect(formal).toHaveLength(1);expect(formal[0].workItems).toHaveLength(2);expect(formal[0].deliveryScope).toBe('candidate');expect(errors).toEqual([]);
});
test('断网恢复及 Agent 并发修改按字段合并，不覆盖新版',async({page})=>{
  test.setTimeout(60000);const project=await fixture(page),c=emptyDraftContent();c.entities=[{id:randomUUID(),entity:'requirement',data:{title:'初始标题',acceptanceCriteria:'样本可验证'}}];
  const d=await(await page.request.post('/api/my/requirement-drafts',{data:{requestId:randomUUID(),projectId:project.id,title:'冲突验证',content:c}})).json() as RequirementDraft;
  await page.goto('/my-work?space=drafts&draft='+d.id);await page.getByLabel('需求标题',{exact:true}).fill('网页标题');
  await page.route('**/api/my/requirement-drafts/'+d.id,route=>route.request().method()==='PUT'?route.abort('failed'):route.continue());
  await expect(page.getByRole('status').filter({hasText:'保存失败'})).toBeVisible();
  const next=structuredClone(c);next.entities[0].data.title='Agent 标题';next.entities[0].data.background='Agent 补充边界';
  expect((await page.request.put('/api/my/requirement-drafts/'+d.id,{data:{requestId:randomUUID(),expectedVersion:1,title:d.title,content:next}})).ok()).toBe(true);
  await page.unroute('**/api/my/requirement-drafts/'+d.id);await page.reload();await page.getByRole('button',{name:'恢复并与服务端合并',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('网页标题');await expect(page.getByRole('dialog')).toContainText('Agent 标题');
  await page.getByRole('dialog').getByText('保留网页输入',{exact:false}).first().click();await page.getByRole('button',{name:'应用选项并继续编辑',exact:true}).click();await saved(page);
  const final=await(await page.request.get('/api/my/requirement-drafts/'+d.id)).json();expect(final.content.entities[0].data.title).toBe('网页标题');expect(final.content.entities[0].data.background).toBe('Agent 补充边界');
});
test('局域网 HTTP 非安全上下文能够创建与自动保存个人草稿',async({page,baseURL})=>{
  const project=await fixture(page),origin=new URL(baseURL!);origin.hostname='project-manage.test';await page.goto(new URL('/my-work?space=drafts',origin).href);
  await page.getByRole('button',{name:'用户登录',exact:true}).first().click();await page.getByRole('dialog').getByLabel('用户名',{exact:true}).fill('admin');await page.getByRole('dialog').getByLabel('密码',{exact:true}).fill('41_xc7q0qOjo4Inw!');await page.getByRole('dialog').getByRole('button',{name:'用户登录',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(()=>isSecureContext)).toBe(false);await page.goto(new URL('/my-work?space=drafts',origin).href);await page.getByRole('button',{name:'新建草稿',exact:true}).click();await page.getByRole('dialog').getByLabel('目标项目').selectOption(project.id);await page.getByRole('button',{name:'创建个人草稿',exact:true}).click();await page.getByLabel('方案标题',{exact:true}).fill('HTTP 自动保存');await saved(page);await page.reload();await expect(page.getByLabel('方案标题',{exact:true})).toHaveValue('HTTP 自动保存');
});
