import {expect,test} from '@playwright/test';
import {mockGanttData} from './gantt-fixture';

for(const resource of ['dashboard','path-graph'] as const)test(`工作区${resource}后台失败保留输入并可重试`,async({page})=>{
  await mockGanttData(page);
  let status=0,reads=0,hold:Promise<void>|undefined;
  const writes:string[]=[];
  page.on('request',request=>{if(request.url().includes('/api/')&&request.method()!=='GET')writes.push(request.url());});
  await page.route(resource==='dashboard'?'**/api/dashboard?**':'**/api/projects/p1/path-graph*',async route=>{
    reads++;if(hold)await hold;
    if(status)return route.fulfill({status,json:{error:status===403?'项目权限已移除':'临时读取失败'}});
    return route.fallback();
  });
  const refresh=()=>page.evaluate(()=>{window.dispatchEvent(new Event('offline'));window.dispatchEvent(new Event('online'));});
  await page.goto('/execution');const surface=page.locator('.workspace-gantt-scroll');await expect(surface).toHaveAttribute('data-gantt-ready','true');
  await page.getByRole('button',{name:'展开全部',exact:true}).click();
  await surface.locator('[data-row-id="w1"]').getByRole('button',{name:'更新 接口开发 进度',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'更新工作项进度',exact:true}),field=dialog.getByRole('textbox',{name:/^说明/});
  await field.fill('读取失败时保留这段说明');
  status=503;await refresh();
  const notice=page.locator('.unified-workspace .query-refresh-notice');
  await expect(notice).toContainText('刷新失败');await expect(surface).toBeVisible();await expect(field).toHaveValue('读取失败时保留这段说明');
  status=0;await refresh();await expect(notice).toHaveCount(0);await expect(field).toHaveValue('读取失败时保留这段说明');
  await dialog.getByRole('button',{name:'关闭',exact:true}).click();
  status=503;await refresh();await expect(notice).toBeVisible();
  status=0;let release!:()=>void;hold=new Promise<void>(resolve=>{release=resolve;});
  const before=reads;await notice.getByRole('button',{name:'重新加载',exact:true}).click();
  await expect.poll(()=>reads).toBeGreaterThan(before);await expect(notice.getByRole('button',{name:'重新加载中…',exact:true})).toBeDisabled();
  release();hold=undefined;await expect(notice).toHaveCount(0);await expect(surface.locator('.kind-work')).toHaveCount(6);
  await page.getByRole('button',{name:'清单',exact:true}).click();status=503;await refresh();await expect(notice).toBeVisible();
  await page.setViewportSize({width:390,height:844});await expect(notice.getByRole('button',{name:'重新加载',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:`.preview/qa/continuous-goal/workspace-refresh-${resource}-390.png`});
  status=0;await notice.getByRole('button',{name:'重新加载',exact:true}).click();await expect(notice).toHaveCount(0);
  status=403;await refresh();await expect(page.getByText('项目权限已移除',{exact:true})).toBeVisible();await expect(page.locator('.unified-workspace')).toHaveCount(0);
  status=503;await page.getByRole('button',{name:'重新读取',exact:true}).click();await expect(page.getByText('临时读取失败',{exact:true})).toBeVisible();await expect(page.locator('.unified-workspace')).toHaveCount(0);
  status=0;await page.getByRole('button',{name:'重新读取',exact:true}).click();await expect(page.locator('.unified-workspace')).toBeVisible();expect(writes).toEqual([]);
});
