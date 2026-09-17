import { expect, test, type Page } from "@playwright/test";
import { mockGanttData, mockGanttReport, requirement, workItem } from "./gantt-fixture";

const skins = [ ["classic", "经典蓝白"], ["swiss", "瑞士排版"], ["forest", "暖纸森林"], ["midnight", "午夜控制台"], ["soft", "柔彩悬浮"], ["industrial", "工业黄黑"], ["dcim", "杰瑞橙"] ];
async function chooseSkin(page: Page, label: string) {
  if (!await page.getByRole("button", { name: /^切换风格/ }).isVisible()) await page.getByRole("button", { name: /^账号菜单/ }).click();
  await page.getByRole("button", { name: /^切换风格/ }).click();
  await page.getByRole("menuitemradio", { name: new RegExp("^" + label) }).click();
  await page.keyboard.press("Escape");
}

for (const [skin, label] of [...skins, ['system', '跟随系统']]) test(`${label}：矩阵和窄屏顶栏、详情与编辑按钮互不遮挡`, {tag:'@responsive'}, async ({ page }) => {
  await mockGanttData(page);
  for(const viewport of [page.viewportSize()!,{width:390,height:844}]){
    await page.setViewportSize(viewport);await page.goto('/?projectId=p1&workspaceView=progress&scopeType=requirement&scopeId=r1');
    await chooseSkin(page,label);await expect(page.locator('html')).toHaveAttribute('data-theme-preference',skin);
    for(const colorScheme of ['light','dark'] as const){
      await page.emulateMedia({colorScheme,reducedMotion:'reduce'});
      if(viewport.width===390)await expect(page.locator('.sidebar')).toHaveClass(/sidebar-collapsed/);
      await page.getByRole('button',{name:/^账号菜单/}).click({trial:true});await page.locator('.project-switcher-button').click({trial:true});
      expect((await page.locator('.topbar').boundingBox())?.height).toBe(52);
      await page.locator('[data-row-id="r1"] .workspace-row-title').click();
      const detail=page.locator('.modal-card-workspace[role=dialog]');await expect(detail).toBeVisible();
      await detail.getByRole('button',{name:'编辑信息',exact:true}).click();
      const form=page.getByRole('dialog',{name:'编辑需求信息',exact:true});await expect(form.getByLabel('需求标题',{exact:true})).toBeVisible();
      const box=(await form.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(viewport.width);expect(box.y+box.height).toBeLessThanOrEqual(viewport.height);
      await form.getByRole('button',{name:'取消',exact:true}).click();await expect(detail).toBeVisible();await detail.getByRole('button',{name:'关闭',exact:true}).click();
      await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    }
  }
});

for (const [skin, label] of skins) test(`${label}：布局、双轨三种粒度、长标题与完整提示`, {tag:'@responsive'}, async ({ page }, info) => {
  await mockGanttData(page);
  const title = "EPDS-2026-018 设备监控与告警处理：" + "跨模块联动及异常恢复的完整需求说明、".repeat(8);
  const value={...requirement,title,workItems:[workItem,{...workItem,id:'cancelled',title:'已取消的历史工作项',status:'cancelled',cancelledAt:'2026-09-02'}]};
  await mockGanttReport(page,()=>[value]);await page.route('**/api/requirements/r1',route=>route.fulfill({json:value}));
  await page.goto('/?projectId=p1&workspaceView=progress&scopeType=requirement&scopeId=r1');await page.getByRole('button',{name:'展开全部',exact:true}).click();
  const frame=()=>page.locator('.topbar,.page-toolbar,.workspace-gantt,.workspace-row-label').evaluateAll(elements=>elements.map(element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
  const before=await frame();await chooseSkin(page,label);await expect(page.locator('html')).toHaveAttribute('data-theme',skin);expect(await frame()).toEqual(before);
  const row=page.locator('[data-row-id="r1"]'),cancelled=page.locator('[data-row-id="cancelled"]');
  for(const zoom of ['日','周','月']){
    await page.getByRole('button',{name:zoom,exact:true}).click();await expect(row.locator('.gantt-date-plan')).toBeAttached();
    await expect(row.locator('.gantt-date-actual')).toHaveAttribute('data-end','2026-09-03');
    expect(await row.locator('.gantt-date-plan').evaluate(e=>e.getBoundingClientRect().y)).toBeLessThan(await row.locator('.gantt-date-actual').evaluate(e=>e.getBoundingClientRect().y));
    await expect(cancelled.locator('.gantt-date-actual')).toHaveAttribute('data-end','2026-09-02');await expect(cancelled).toHaveAttribute('data-status','cancelled');
  }
  await row.locator('.workspace-row-title').focus();await expect(page.getByRole('tooltip')).toContainText(title);await page.keyboard.press('Escape');
  await page.screenshot({path:info.outputPath(skin+'-split.png'),animations:'disabled'});
  await row.locator('.workspace-row-title').click();const detail=page.locator('.modal-card-workspace[role=dialog]');
  await expect(detail.getByRole('heading',{name:title,exact:true})).toBeVisible();expect(await detail.evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({path:info.outputPath(skin+'-detail.png'),animations:'disabled'});
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme',skin);await expect(detail.getByRole('heading',{name:title,exact:true})).toBeVisible();
});

test("换肤保留编辑草稿、菜单键盘选择不触发提交", async ({ page }) => {
  const writes: string[] = [];
  await mockGanttData(page);
  page.on("request", (request) => { if (request.method() !== "GET") writes.push(request.url()); });
  await page.goto("/requirements/r1");
  // 使用页面现有表单入口，换肤期间不重建表单和输入节点。
  await page.getByRole("button", { name: /编辑信息/ }).click();
  const input = page.getByRole("dialog").getByLabel("需求标题", { exact: true });
  await input.fill("尚未提交的需求草稿");
  await page.evaluate(() => {
    localStorage.setItem("project-manage:theme", "midnight");
    window.dispatchEvent(new StorageEvent("storage", { key: "project-manage:theme", newValue: "midnight" }));
  });
  await expect(input).toHaveValue("尚未提交的需求草稿");
  expect(writes).toEqual([]);
  await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
  if(!await page.getByRole('button',{name:/^切换风格/}).isVisible())await page.getByRole('button',{name:/^账号菜单/}).click();
  const trigger = page.getByRole("button", { name: /^切换风格/ });
  await trigger.focus(); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Home"); await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme-preference", "system");
  await expect(trigger).toBeFocused();
  expect(writes).toEqual([]);
});

test("迁移暗色偏好；存储不可用时仍可切换皮肤", async ({ page }) => {
  await mockGanttData(page);
  await page.addInitScript(() => localStorage.setItem("project-manage:theme", "dark"));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dcim");
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error("blocked storage"); }; });
  await chooseSkin(page, "柔彩悬浮");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "soft");
});

test("全部配色切换复用图表画布，保留进展记录", async ({ page }) => {
  await mockGanttData(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/requirements/r1", (route) => route.fulfill({ json: {
    ...requirement, progressUpdates: [{ id: "update-1", requirementId: "r1", workItemId: "w1", percent: 40, workItemPercent: 40, content: "已经完成接口校验", eventType: "progress", createdAt: "2026-09-02T10:00:00Z", updatedAt: "2026-09-02T10:00:00Z" }],
  } }));
  await page.goto("/requirements/r1");
  await page.getByRole('tab',{name:'记录',exact:true}).click();
  const chart = page.getByRole("img", { name: "需求计划与实际进度趋势", exact: true });
  await expect(chart.locator("canvas")).toBeAttached();
  const canvas = await chart.locator("canvas").elementHandle();
  for (const [skin] of skins) {
    await page.evaluate(value=>{localStorage.setItem('project-manage:theme',value);window.dispatchEvent(new StorageEvent('storage',{key:'project-manage:theme',newValue:value}));},skin);
    await expect(chart).toHaveAttribute("data-chart-theme", skin);
    expect(await canvas!.evaluate((element) => element.isConnected)).toBe(true);
    await expect(page.locator(".progress-feed")).toContainText("已经完成接口校验");
  }
  expect(errors).toEqual([]);
});

test("甘特视图偏好按账号隔离", async ({ page }) => {
  await mockGanttData(page);
  await page.goto("/my-work");
  await page.getByRole("button", { name: /^甘特显示方式/ }).click();
  await page.getByRole("button", { name: "计划·实际双轨", exact: true }).click();
  await page.route("**/api/session", (route) => route.fulfill({ json: { authenticated: true, accountId: "another-admin", username: "another-admin", role: "admin", globalRole: "admin", personId: null, mustChangePassword: false, managedProjectIds: [] } }));
  await page.reload();
  await expect(page.getByRole("button", { name: /^甘特显示方式/ })).toHaveAttribute("aria-label", "甘特显示方式，当前现有视图");
});

test("我的工作复用双轨与皮肤，百分比不改变执行日期跨度", {tag:'@responsive'},async ({ page }) => {
  await mockGanttData(page);
  await page.route("**/api/my-work", (route) => route.fulfill({ json: {
    asOfDate: "2026-09-03", summary: { total: 2, notStarted: 0, inProgress: 2, blocked: 0, completed: 0, overdue: 0 }, requirements: [],
    items: [workItem, { ...workItem, id: "another", title: "同日期不同进度", progress: 80 }].map((item) => ({ ...item, projectId: "p1", projectName: "测试项目", requirementTitle: "统一甘特样式", requirementStatus: "in_progress", assignmentType: "owner", overdue: false })),
    completionTrend: [{ week: "2026-09-01", completed: 2 }], upcoming: [{ date: "2026-09-03", count: 2 }], recentProgress: [],
  } }));
  await page.goto("/my-work");
  await page.getByRole("button", { name: /^甘特显示方式/ }).click();
  await page.getByRole("button", { name: "计划·实际双轨", exact: true }).click();
  const bars = page.locator(".gantt-date-actual");
  await expect(bars).toHaveCount(2);
  const widths = await bars.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
  expect(widths[0]).toBe(widths[1]);
  await expect(page.locator(".gantt-date-progress")).toHaveText(["完成 40%", "完成 80%"]);
  await chooseSkin(page, "午夜控制台");
  await expect(page.locator(".themed-chart")).toHaveCount(2);
  await expect(bars.first()).toHaveAttribute("data-end", "2026-09-03");
});

test("实际点击换肤菜单不会触发人员姓名编辑器的离开提交", async ({ page }) => {
  await mockGanttData(page);
  const writes: string[] = [];
  page.on("request", (request) => { if (request.method() !== "GET") writes.push(request.url()); });
  await page.route("**/api/people", (route) => route.fulfill({ json: [{ id: "u1", name: "张三", jobTitle: "工程师", active: 1, createdAt: "2026-09-01", updatedAt: "2026-09-01" }] }));
  await page.route("**/api/accounts", (route) => route.fulfill({ json: [] }));
  await page.goto("/resources");
  await page.getByRole("button", { name: /^人员姓名：张三/ }).click();
  const input = page.getByRole("textbox", { name: "人员姓名", exact: true });
  await input.fill("姓名草稿");
  await chooseSkin(page, "柔彩悬浮");
  await expect(input).toBeVisible();
  await expect(input).toHaveValue("姓名草稿");
  expect(writes).toEqual([]);
});
