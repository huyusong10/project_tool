import { expect, test, type Page } from '@playwright/test';
import { mockGanttData, requirement, workItem } from './gantt-fixture';

async function fixture(page: Page, total = 145) {
  await mockGanttData(page);
  const state = { total, failPage: 0, failStatus: 503, snapshot: 145, queries: [] as string[] };
  const requirements = Array.from({length: total}, (_, i) => ({...requirement, id: 'r'+i, title: '需求 '+String(i).padStart(3,'0'), planningReasons: [], actionCount: 0, ownerId: 'u1', version: 1, executionMode: 'work_items', groupId: 'g1', groupName: '研发', workItems: [{...workItem, id: 'w'+i, requirementId: 'r'+i}]}));
  const people = Array.from({length: 41}, (_,i) => ({id: 'u'+i, name: '成员'+i, active: 1, jobTitle: i<25?'开发':'测试', projectRole:'member', username:'member'+i}));
  const projects = Array.from({length: 21},(_,i)=>({id:'p'+(i+1),name:'项目'+i,status:'active',canManage:true,projectRole:'manager',createdAt:'2026-09-01',updatedAt:'2026-09-01'}));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    const json = (data: unknown) => route.fulfill({json: data});
    if (path === '/api/projects') return json(projects);
    if (path === '/api/branding') return json({systemName:'项目管理',shortName:'PM',logoUrl:null,updatedAt:'2026-09-01'});
    if (path === '/api/action-items' || path === '/api/issues' || path === '/api/audit/search') {
      state.queries.push(url.search);
      const pageSize = Number(url.searchParams.get('pageSize') || 20), requested = Number(url.searchParams.get('page') || 1);
      if (requested === state.failPage) return route.fulfill({status:state.failStatus,json:{error:'翻页暂时失败'}});
      const total = path === '/api/audit/search' ? Number(url.searchParams.get('snapshot') || state.snapshot) : state.total;
      const pages = Math.max(1,Math.ceil(total/pageSize)), current = Math.min(requested,pages);
      const rows = Array.from({length:Math.min(pageSize,Math.max(0,total-(current-1)*pageSize))},(_,i)=>{
        const n=(current-1)*pageSize+i;
        return { id: 'a'+n, title:'行动 '+n, severity:'high', reasons:[{label:'进度落后'}], targetPath:'/requirements/r1', overdueWorkdays:0, ownerName:'负责人',
          projectId:'p1',scope:'public',status:'in_progress',progress:40,priority:'P1',requirementId:null,version:1,createdAt:'2026-09-01T08:00:00Z',updatedAt:'2026-09-01', summary:'记录 '+n, actorName:'管理员',actorType:'user',action:'update',entityType:'requirement' };
      });
      return json({items: rows,total,pages,page:current,pageSize,snapshot:total,asOfDate:'2026-09-11',summary:{total,high:total,medium:0,low:0,active:total,overdue:0},ownerOptions:[]});
    }
    if (path === '/api/requirements') return json(requirements.slice(0, state.total));
    if (path === '/api/tokens') return json(Array.from({length:21},(_,i)=>({id:'token'+i,name:'客户端'+i,prefix:'test'+i,createdAt:'2026-09-01T08:00:00Z',lastUsedAt:null,expiresAt:null,revokedAt:null})));
    if (path === '/api/backups') return json(Array.from({length:21},(_,i)=>({name:'backup-'+i+'.db',createdAt:'2026-09-01T08:00:00Z',size:1000,restorable:true,fingerprint:'v'+i})));
    if (path === '/api/system/overview') return json({service:{startedAt:'2026-09-01T08:00:00Z'},database:{totalSizeBytes:1000,journalMode:'wal'},backups:{count:21,totalSizeBytes:21000,retentionDays:30,maxCount:50,restorableCount:21,lastCreatedAt:'2026-09-01T08:00:00Z',nextScheduledAt:'2026-09-12T02:00:00Z'}});
    if (/^\/api\/issues\/a\d+$/.test(path)) return json({id:path.split('/').at(-1),projectId:'p1',title:'分页问题',status:'in_progress',scope:'public',priority:'P1',progress:50,version:1,createdAt:'2026-09-01',discoveredAt:'2026-09-01',updates:Array.from({length:21},(_,i)=>({id:'iu'+i,progress:50-i*2,eventType:i===0?'correction':'progress',supersedesId:i===0?'iu20':null,content:'问题进展'+i,createdAt:'2026-09-01T08:00:00Z'}))});
    if (/^\/api\/requirements\/r\d+$/.test(path)) return json({...requirements.find(r=>path.endsWith('/'+r.id)),progressUpdates:Array.from({length:21},(_,i)=>({id:'update'+i,requirementId:'r1',workItemId:'w1',workItemTitle:'开发',workItemPercent:80-i*4,percent:80-i*4,content:'进展记录'+i,eventType:'progress',createdAt:`2026-09-${String(21-i).padStart(2,'0')}T08:00:00Z`,updatedAt:'2026-09-21',createdByName:'成员'}))});
    if (path === '/api/my-work') return json({asOfDate:'2026-09-11',summary:{total,notStarted:0,inProgress:total,overdue:0,completed:0},requirements,items: requirements.map((r,i)=>({...r.workItems[0],projectId:'p1',projectName:'项目',requirementTitle:r.title,requirementStatus:r.status,assignmentType:'owner',overdue:false,plannedEnd:i===total-1?'2026-12-30':'2026-09-10'})),completionTrend:[],upcoming:[],recentProgress:[]});
    if (path === '/api/people' || path.endsWith('/members')) return json(people);
    if (path === '/api/accounts') return json([]);
    if (path === '/api/templates') return json(Array.from({length:21},(_,i)=>({id:'t'+i,projectId:'p1',name:'流程'+i,description:'标准流程',createdAt:'2026-09-01',updatedAt:'2026-09-01',items:[{id:'tw'+i,title:'工作项'+i,startOffsetDays:0,durationDays:3}]})));
    if (path === '/api/archives') return json({projects:[],people:[],requirements:requirements.map((r,i)=>({id:r.id,title:r.title,deletedAt:'2026-09-01T08:00:00Z',workItemCount:i})),templates:[]});
    return route.fallback();
  });
  return state;
}

test('服务端分页数量边界、每页设置及失败回退', async ({page}) => {
  const state=await fixture(page);
  for (const total of [0,1,10,20,21,145,1000]) {
    state.total=total; await page.goto('/actions?page=1&pageSize=10');
    const pager=page.getByRole('navigation',{name:'待处理事项分页'});
    await expect(pager).toContainText(`共 ${total} 条`);
    await expect(page.locator('.action-item')).toHaveCount(Math.min(total,10));
    await expect(pager.getByRole('button',{name:'下一页',exact:true})).toHaveCount(total>10?1:0);
  }
  const pager=page.getByRole('navigation',{name:'待处理事项分页'});
  await pager.getByRole('button',{name:'下一页',exact:true}).click();
  await expect(page.locator('.action-item').first()).toContainText('行动 10');
  state.failPage=3;
  await pager.getByRole('button',{name:'下一页',exact:true}).click();
  await expect(page.getByText('行动项刷新失败', {exact:false})).toBeVisible();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator('.action-item').first()).toContainText('行动 10');
  state.failPage=0;
  await pager.getByLabel('每页数量').selectOption('50');
  await expect(page.locator('.action-item')).toHaveCount(50);
  await expect(page).toHaveURL(/page=1/);
});

test('快速翻页只接受当前请求，拒绝访问后不能回退展示旧页', async ({page}) => {
  const state=await fixture(page);
  await page.goto('/actions');
  const pager=page.getByRole('navigation',{name:'待处理事项分页'});
  await expect(page.locator('.action-item')).toHaveCount(10);
  let release!: () => void;
  const gate=new Promise<void>(resolve=>release=resolve);
  await page.route('**/api/action-items?**',async route=>{
    if (new URL(route.request().url()).searchParams.get('page')==='2') await gate;
    return route.fallback();
  });
  await pager.getByRole('button',{name:'下一页',exact:true}).click();
  await expect(pager.getByRole('button',{name:'下一页',exact:true})).toBeDisabled();
  await pager.getByRole('button',{name:'下一页',exact:true}).evaluate((button:HTMLButtonElement)=>button.click());
  await expect(page.locator('.action-item').first()).toContainText('行动 0');
  release();
  await expect(page.locator('.action-item').first()).toContainText('行动 10');
  await expect(page.locator('.action-item')).toHaveCount(10);
  expect(state.queries.filter(query=>new URLSearchParams(query).get('page')==='2')).toHaveLength(1);
  state.failPage=3; state.failStatus=403;
  await pager.getByRole('button',{name:'下一页',exact:true}).click();
  await expect(page.getByText('行动项加载失败',{exact:true})).toBeVisible();
  await expect(page.locator('.action-item')).toHaveCount(0);
  state.failStatus=503;
  await page.getByRole('button',{name:'重新加载',exact:true}).click();
  await expect(page.getByRole('button',{name:'重新加载',exact:true})).toBeEnabled();
  await expect(page.locator('.action-item')).toHaveCount(0);
});

test('需求分页、跨页选择和详情往返保留页码与列表滚动', async ({page}) => {
  await fixture(page);
  await page.goto('/requirements?sort=title&direction=asc');
  const pager=page.getByRole('navigation',{name:'需求列表分页'});
  await expect(page.locator('.requirements-table tbody tr')).toHaveCount(20);
  await page.getByLabel('选择需求 需求 000',{exact:true}).check();
  await pager.getByRole('button',{name:'下一页',exact:true}).click();
  await page.getByLabel('选择需求 需求 020',{exact:true}).check();
  await expect(page.getByText('已选择 2 项')).toBeVisible();
  const body=page.locator('.requirements-table-panel .paged-body');
  await body.evaluate(el=>el.scrollTop=250);
  const target=page.getByRole('link',{name:'需求 024',exact:true});
  await target.click(); await expect(page.locator('.requirement-page')).toBeVisible();
  await page.goBack(); await expect(page).toHaveURL(/page=2/);
  await expect.poll(()=>body.evaluate(el=>el.scrollTop)).toBeGreaterThan(100);
  await page.reload(); await expect(page.locator('.requirements-table tbody tr').first()).toContainText('需求 020');
  await page.getByPlaceholder('搜索需求或负责人').fill('需求 144');
  await expect(page.locator('.requirements-table tbody tr')).toHaveCount(1);
  await expect(page).toHaveURL(/page=1/);
});

test('我的工作两个分页独立，翻页不改变甘特日期范围', async ({page}) => {
  await fixture(page);
  await page.goto('/my-work');
  const work=page.getByRole('navigation',{name:'分配给我的工作分页'}), owned=page.getByRole('navigation',{name:'我负责的需求分页'});
  await expect(page.locator('.my-work-list .requirement-gantt-row')).toHaveCount(20);
  const dates=await page.locator('.my-work-list .gantt-visible-range').textContent();
  await work.getByRole('button',{name:'下一页',exact:true}).click();
  await expect(page.locator('.my-work-list .requirement-gantt-row').first()).toHaveAttribute('data-work-item-id','w20');
  await expect(page.locator('.my-work-list .gantt-visible-range')).toHaveText(dates!);
  await expect(owned.getByRole('button',{name:'上一页',exact:true})).toBeDisabled();
  await owned.getByRole('button',{name:'下一页',exact:true}).click();
  await page.reload();
  await expect(page.locator('.my-work-list .requirement-gantt-row').first()).toHaveAttribute('data-work-item-id','w20');
  await expect(page.locator('.my-owned-requirement-card').first()).toContainText('需求 020');
  await page.locator('.my-work-list').getByRole('button',{name:'更多工作项操作'}).first().click();
  await expect(work.getByRole('button',{name:'下一页',exact:true})).toBeDisabled();
  await expect(owned.getByRole('button',{name:'下一页',exact:true})).toBeEnabled();
});

test('普通列表统一接入，流程概览默认可见且详情独立预览', async ({page}) => {
  await fixture(page);
  for (const [url,label,selector,count] of [
    ['/projects','项目列表分页','.project-table tbody tr',20],
    ['/resources','人员与权限分页','.account-data-row',20],
    ['/archives','归档列表分页','.archive-table tbody tr',20],
    ['/templates','流程列表分页','.template-card',20],
    ['/issues','问题列表分页','.issue-data-row',20],
    ['/requirements/r1','需求进展分页','.progress-feed > article',10],
    ['/project-settings','项目成员分页','.project-member-row',20],
    ['/settings','Token 列表分页','.personal-token-row',20],
    ['/system','备份列表分页','.system-backup-table tbody tr',20],
  ] as const) {
    await page.goto(url); const pager=page.getByRole('navigation',{name:label});
    await expect(pager).toBeVisible(); await expect(page.locator(selector)).toHaveCount(count);
    await pager.getByRole('button',{name:'下一页',exact:true}).click();
    if (url==='/templates') { await expect(page.locator('.template-card')).toHaveCount(1); await expect(page.getByText('工作项20',{exact:true})).toBeVisible(); await page.getByRole('button',{name:'查看流程 流程20',exact:true}).click(); await expect(page.getByRole('dialog',{name:'流程详情'})).toContainText('工作项20'); await page.keyboard.press('Escape'); }
    else if (url==='/requirements/r1') await expect(page.locator('.progress-feed > article').first()).toContainText('36 → 40%');
  }
});

test('日志翻页和刷新保留同一查询快照', async ({page}) => {
  const state=await fixture(page); await page.goto('/logs');
  const pager=page.getByRole('navigation',{name:'日志分页'});
  await expect(page).toHaveURL(/snapshot=145/);
  state.snapshot=160;
  await pager.getByRole('button',{name:'下一页',exact:true}).click();
  await expect(page.locator('.audit-table')).toContainText('记录 50');
  await page.reload(); await expect(pager).toContainText('共 145 条');
  expect(state.queries.at(-1)).toContain('snapshot=145');
  await pager.getByLabel('每页数量').selectOption('20');
  await expect(page.locator('.audit-table > div:not(.audit-head)')).toHaveCount(20);
  await page.getByRole('button',{name:'刷新',exact:true}).click();
  await expect(pager).toContainText('共 160 条');
});

test('分页适配窄容器、高分屏、侧栏和低高度窗口', async ({page}, testInfo) => {
  await fixture(page); await page.goto('/actions');
  for (const width of [390,768,1280,1366,1536,1920,2560]) {
    await page.setViewportSize({width,height:900});
    const pager=page.getByRole('navigation',{name:'待处理事项分页'});
    await expect(pager).toBeVisible();
    if (width === 390) {
      await pager.getByLabel('跳转页码').fill('3');
      await pager.getByLabel('跳转页码').press('Enter');
    }
    await expect(page.locator('.action-item').first()).toContainText('行动 20');
    const problems=await pager.evaluate(el=>{
      const bounds=el.getBoundingClientRect();
      return [...el.querySelectorAll('button,select,input')].filter(control=>{
        const r=control.getBoundingClientRect(); return r.width>0 && (r.left<bounds.left-1 || r.right>bounds.right+1 || r.height<36);
      }).map(control=>control.getAttribute('aria-label'));
    });
    expect(problems).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (width === 390 || width === 1280) {
      await pager.scrollIntoViewIfNeeded();
      await page.screenshot({path:testInfo.outputPath(`pagination-${width}.png`)});
    }
  }
  await page.getByRole('button',{name:/^(展开|收起)侧边栏$/}).click();
  await expect(page.locator('.action-item').first()).toContainText('行动 20');
  await page.setViewportSize({width:1280,height:600});
  expect(await page.locator('.action-items').evaluate(el=>el.scrollHeight-el.clientHeight)).toBeLessThanOrEqual(1);
});

test('行内编辑只锁定所属分页，分组在跨页后显示完整匹配数量', async ({page}) => {
  await fixture(page,21);
  await page.goto('/resources');
  const pager=page.getByRole('navigation',{name:'人员与权限分页'});
  await page.locator('.account-data-row .inline-edit-trigger').first().click();
  await expect(pager.getByRole('button',{name:'下一页',exact:true})).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(pager.getByRole('button',{name:'下一页',exact:true})).toBeEnabled();
  await page.goto('/requirements?grouped=1');
  await expect(page.locator('.intake-group-heading')).toContainText('研发 · 21 项');
  await page.getByRole('navigation',{name:'需求列表分页'}).getByRole('button',{name:'下一页',exact:true}).click();
  await expect(page.locator('.intake-group-heading')).toContainText('研发 · 21 项');
  await expect(page.locator('.requirements-table tbody tr:not(.intake-group-heading)')).toHaveCount(1);
});

test('窄屏普通列表使用页面纵向滚动，分页和表格不撑宽页面', async ({page}) => {
  await fixture(page);
  await page.setViewportSize({width:390,height:844});
  for (const url of ['/requirements','/projects','/resources','/archives','/templates','/issues','/project-settings','/settings','/system','/logs','/requirements/r1']) {
    await page.goto(url);
    const pager=page.locator('.table-pagination').first();
    await expect(pager).toBeAttached();
    await expect(pager.getByLabel('每页数量')).toHaveValue(url === '/logs' ? '50' : url === '/requirements/r1' ? '10' : '20');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth),url).toBeLessThanOrEqual(390);
    for (const body of await page.locator('.paged-body').all()) {
      expect(await body.evaluate(el=>el.scrollHeight-el.clientHeight),url).toBeLessThanOrEqual(1);
    }
  }
});

test('列表减少时回到有效末页；问题历史引用保留；人员搜索自动展开', async ({page}) => {
  const state=await fixture(page,21);
  await page.goto('/requirements?page=2');
  await expect(page.locator('.requirements-table tbody tr')).toHaveCount(1);
  state.total=20;
  await page.reload();
  await expect(page).toHaveURL(/page=1/);
  await expect(page.locator('.requirements-table tbody tr')).toHaveCount(20);
  await page.goto('/issues?issueId=a0');
  const history=page.getByRole('navigation',{name:'问题进展分页'});
  await expect(page.locator('.issue-update-setting-row')).toHaveCount(10);
  await expect(page.locator('.issue-correction-reference')).not.toContainText('原记录不可用');
  await history.getByRole('button',{name:'下一页',exact:true}).click();
  await expect(page.locator('.issue-update-setting-row').first()).toContainText('问题进展10');
  await page.goto('/people');
  await page.getByRole('button',{name:/开发/}).click();
  await expect(page.locator('.people-role-group').filter({hasText:'开发'}).locator('.people-role-members')).toBeHidden();
  await page.getByPlaceholder('搜索姓名、岗位或拼音').fill('成员2');
  await expect(page.locator('.people-role-group').filter({hasText:'开发'}).locator('.people-role-members')).toBeVisible();
  await page.getByLabel('岗位筛选',{exact:true}).selectOption('测试');
  await expect(page.locator('.people-role-group')).toHaveCount(1);
});
