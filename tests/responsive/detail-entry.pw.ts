import {test,expect} from '@playwright/test';
import {phaseFixture} from './phase-fixture';

for(const width of [1912,390])test(`详情加载期间保持正文和弹窗矩形 ${width}`,{tag:'@responsive'},async({page},info)=>{
  const f=await phaseFixture(page);await page.setViewportSize({width,height:949});await page.goto('/?'+new URLSearchParams({projectId:f.projectId,workspaceView:'progress',scopeType:'project'}));
  const row=page.locator('[data-row-id="'+f.testing.id+'"]');await expect(row).toBeVisible();
  const before=await page.getByRole('treegrid').boundingBox(),title=await page.locator('.integrated-page-title').textContent(),project=await page.locator('.project-switcher-name').textContent();
  let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/requirements/'+f.testing.id,async route=>{await gate;await route.continue();});
  await row.getByRole('button',{name:'更新进展',exact:true}).click();const modal=page.getByRole('dialog');await expect(modal.getByRole('status')).toContainText('正在读取需求');const frame=await modal.boundingBox();
  expect(await page.getByRole('treegrid').boundingBox()).toEqual(before);expect(await page.locator('.project-switcher-name').textContent()).toBe(project);expect(await page.locator('.integrated-page-title').textContent()).toBe(title);
  release();await expect(modal.getByRole('tablist')).toBeVisible();expect(await modal.boundingBox()).toEqual(frame);expect(await page.getByRole('treegrid').boundingBox()).toEqual(before);await page.screenshot({path:info.outputPath('stable-detail-load.png'),animations:'disabled'});
});

test('跨项目旧需求链接先确定归属，再显示统一工作区和详情',async({page})=>{
  const first=await phaseFixture(page),second=await phaseFixture(page);await page.goto('/?'+new URLSearchParams({projectId:first.projectId,workspaceView:'list',scopeType:'project'}));
  await page.goto('/requirements/'+second.testing.id);const modal=page.getByRole('dialog');await expect(modal.getByRole('tablist',{name:'需求详情内容'})).toBeVisible();expect(new URL(page.url()).searchParams.get('projectId')).toBe(second.projectId);expect(new URL(page.url()).searchParams.get('detailId')).toBe(second.testing.id);await expect(modal).toContainText(second.testing.title);await expect(page.getByRole('dialog')).toHaveCount(1);
});
