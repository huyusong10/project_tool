import {mockGanttReport} from './gantt-fixture';
import {closeGraphProperties} from './graph-interactions';
import {chooseOption} from './select-helper';
import {mockApplication,requirement,workItem,secondWorkItem,people} from './inline-edit-fixture';
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { Requirement, WorkItem } from "../../src/client/types";

async function finishPointerDrag(page: Page) {
  await page.mouse.up();
  // dnd-kit 在拖动结束后保留 50ms 的 click 捕获，避免把 mouseup 误当成点击。
  await page.waitForTimeout(60);
}

test("工作项名称行内编辑固定打开版本，后台更新后保留草稿并显式重读", async ({ page }) => {
  await mockApplication(page, []);
  let current = structuredClone(requirement);
  let reads = 0;
  const submissions: Array<Record<string, unknown>> = [];
  await page.route("**/api/requirements/r1", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    reads++;
    return route.fulfill({ json: current });
  });
  await page.route("**/api/work-items/w1", (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    const body = route.request().postDataJSON();
    submissions.push(body);
    const saved = { ...current.workItems[0], ...body, version: current.workItems[0].version + 1 };
    current = { ...current, version: current.version + 1, workItems: [saved, current.workItems[1]] };
    return route.fulfill({ json: saved });
  });

  await page.goto("/requirements/r1?workItemId=w1");
  await page.getByRole('tab', { name: '资料', exact:true }).click();
  const dialog = page.locator('.modal-card-workspace[role=dialog]');
  await dialog.getByRole("button", { name: /工作项名称：设计/ }).click();
  const editor = page.getByLabel("工作项名称", { exact: true });
  await editor.fill("保留的标题草稿");

  current = {
    ...current,
    version: 2,
    workItems: [{ ...current.workItems[0], title: "后台更新的标题", version: 2 }, current.workItems[1]],
  };
  const previousReads = reads;
  await page.evaluate(() => { window.dispatchEvent(new Event("offline")); window.dispatchEvent(new Event("online")); });
  await expect.poll(() => reads).toBeGreaterThan(previousReads);
  await editor.press("Enter");

  expect(submissions).toHaveLength(0);
  await expect(editor).toHaveValue("保留的标题草稿");
  await expect(page.getByText(/工作项已更新/)).toBeVisible();
  await page.getByRole("button", { name: "重新读取工作项", exact: true }).click();
  await expect(editor).toHaveValue("保留的标题草稿");
  await expect(page.getByText(/已读取最新工作项（版本 2）/)).toBeVisible();
  await editor.press("Enter");
  await expect.poll(() => submissions.length).toBe(1);
  expect(submissions[0]).toMatchObject({ title: "保留的标题草稿", expectedVersion: 2 });
});

test('工作项名称响应未知且需求回读失败时关闭浮层仍锁定设置', async ({ page }) => {
  await mockApplication(page, []);
  let failRead = false;
  let submissions = 0;
  await page.route('**/api/requirements/r1', (route) => failRead
    ? route.fulfill({ status: 503, json: { error: '需求读取暂不可用' } })
    : route.fulfill({ json: requirement }));
  await page.route('**/api/work-items/w1', (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    submissions += 1;
    failRead = true;
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });

  await page.goto('/requirements/r1?workItemId=w1');
  const entry = page.getByRole('tab', { name: '资料',exact:true });
  await entry.click();
  const settings = page.locator('.modal-card-workspace[role=dialog]');
  const nameTrigger = settings.getByRole('button', { name: /工作项名称：设计/ });
  await nameTrigger.click();
  const input = page.getByLabel('工作项名称', { exact: true });
  await input.fill('待核对的工作项名称');
  await input.press('Enter');

  await expect(settings.getByRole('alert').filter({ hasText: '提交结果待核对' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新读取工作项', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(nameTrigger).toBeDisabled();
  await nameTrigger.evaluate((button) => (button as HTMLButtonElement).click());
  expect(submissions).toBe(1);

  await settings.getByRole('button', { name: '关闭', exact: true }).click();
  failRead = false;
  await page.goto('/requirements/r1?workItemId=w1');await entry.click();
  await expect(nameTrigger).toBeDisabled();
  await expect(settings.getByRole('button',{name:'编辑',exact:true})).toHaveCount(0);
  expect(submissions).toBe(1);
  await settings.getByRole('button',{name:'核对需求修改',exact:true}).click();
  await expect(page.getByRole('alert').filter({ hasText: '工作项设置结果待核对' })).toBeVisible();
  await page.getByRole('button', { name: '重新读取需求', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '工作项设置结果待核对' })).toHaveCount(0);
  await page.goto('/requirements/r1?workItemId=w1');await entry.click();await expect(nameTrigger).toBeEnabled();
});

test("工作项设置偏差使用需求业务日期", async ({ page }) => {
  await mockApplication(page, [], {
    requirement: { asOfDate: "2026-09-03" },
    workItem: {
      status: "in_progress",
      progress: 50,
      plannedStart: "2026-09-01",
      plannedEnd: "2026-09-02",
      actualStart: "2026-09-01",
    },
  });
  await page.goto("/requirements/r1");
  await page.getByRole('tab', { name: /^工作项 / }).click();
  const firstRow = page.locator('.modal-card-workspace[role=dialog]').locator('.work-arrangement-row').first();
  await expect(firstRow.locator(".work-arrangement-state")).toContainText("延期 1工作日");
});

test("工作项负责人、协作者和日期共用版本快照，重读时保留各自草稿", async ({ page }) => {
  await mockApplication(page, []);
  let current = {
    ...structuredClone(requirement),
    workItems: [structuredClone(workItem), { ...structuredClone(secondWorkItem), status: "in_progress" as const, progress: 20, actualStart: "2026-09-04" }],
  };
  let reads = 0;
  const submissions: Array<Record<string, unknown>> = [];
  await page.route("**/api/requirements/r1", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    reads++;
    return route.fulfill({ json: current });
  });
  await page.route("**/api/work-items/w1", (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    const body = route.request().postDataJSON();
    submissions.push(body);
    const source = current.workItems[0];
    const ownerId = Object.prototype.hasOwnProperty.call(body, "ownerId") ? String(body.ownerId || "") || null : source.ownerId;
    const assigneeIds = Array.isArray(body.assigneeIds) ? body.assigneeIds.map(String) : source.assigneeIds;
    const collaborators = people.filter((person) => assigneeIds.includes(person.id) && person.id !== ownerId);
    const saved = {
      ...source,
      ...body,
      ownerId,
      ownerName: people.find((person) => person.id === ownerId)?.name || null,
      assigneeIds,
      assigneeNames: people.filter((person) => assigneeIds.includes(person.id)).map((person) => person.name),
      collaborators,
      version: source.version + 1,
    };
    current = { ...current, version: current.version + 1, workItems: [saved, current.workItems[1]] };
    return route.fulfill({ json: saved });
  });
  const pushBackgroundUpdate = async (changes: Partial<WorkItem>) => {
    const previousReads = reads;
    current = {
      ...current,
      version: current.version + 1,
      workItems: [{ ...current.workItems[0], ...changes, version: current.workItems[0].version + 1 }, current.workItems[1]],
    };
    await page.evaluate(() => { window.dispatchEvent(new Event("offline")); window.dispatchEvent(new Event("online")); });
    await expect.poll(() => reads).toBeGreaterThan(previousReads);
  };
  const reloadDraft = async (popover: Locator, expectedVersion: number) => {
    await expect(popover.getByText(/工作项已更新/)).toBeVisible();
    await popover.getByRole("button", { name: "重新读取工作项", exact: true }).click();
    await expect(popover.getByText(new RegExp(`已读取最新工作项（版本 ${expectedVersion}）`))).toBeVisible();
  };

  await page.goto("/requirements/r1");
  await page.getByRole('tab', { name: /^工作项 / }).click();
  const dialog = page.locator('.modal-card-workspace[role=dialog]');
  const firstRow = dialog.locator('.work-arrangement-row').first();

  await firstRow.getByRole("button", { name: /主负责人：未分配/ }).click();
  let popover = page.locator(".inline-select-popover");

  await pushBackgroundUpdate({ ownerId: "u2", ownerName: "李四", assigneeIds: ["u2"], assigneeNames: ["李四"] });
  await popover.getByRole("option", {name:/张三/}).click();
  expect(submissions).toHaveLength(0);
  await reloadDraft(popover, 2);
  await popover.getByRole("option", {name:/张三/}).click();
  await expect.poll(() => submissions.length).toBe(1);
  expect(submissions[0]).toMatchObject({ ownerId: "u1", assigneeIds: ["u1"], expectedVersion: 2 });

  await firstRow.getByRole("button", { name: /计划开始：2026-09-01/ }).click();
  popover = page.locator(".inline-date-popover");
  await popover.getByRole("gridcell", { name: "2026-09-02", exact: true }).click();
  await pushBackgroundUpdate({ plannedStart: "2026-09-03" });
  await expect(popover.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  expect(submissions).toHaveLength(1);
  await reloadDraft(popover, 4);
  await expect(popover.getByRole("gridcell", { name: "2026-09-02", exact: true })).toHaveAttribute("aria-selected", "true");
  await popover.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => submissions.length).toBe(2);
  expect(submissions[1]).toMatchObject({ plannedStart: "2026-09-02", expectedVersion: 4 });

  await firstRow.getByRole("button", { name: /协作人员：无协作人员/ }).click();
  popover = page.locator(".inline-multi-popover");
  await popover.getByRole("checkbox", { name: /李四/ }).check();
  await pushBackgroundUpdate({ title: "后台再次更新标题" });
  await expect(popover.getByRole("button", { name: "完成", exact: true })).toBeDisabled();
  expect(submissions).toHaveLength(2);
  await reloadDraft(popover, 6);
  await expect(popover.getByRole("checkbox", { name: /李四/ })).toBeChecked();
  await popover.getByRole("button", { name: "完成", exact: true }).click();
  await expect.poll(() => submissions.length).toBe(3);
  expect(submissions[2]).toMatchObject({ assigneeIds: ["u1", "u2"], expectedVersion: 6 });
});

test("执行中工作项待确认的负责人失效后禁止提交旧人员", async ({ page }) => {
  await mockApplication(page, [], { workItem: { status: "in_progress", actualStart: "2026-09-01" } });
  let availablePeople = [...people];
  let peopleReads = 0;
  const submissions: Array<Record<string, unknown>> = [];
  await page.route("**/api/people?*", (route) => {
    peopleReads++;
    return route.fulfill({ json: availablePeople });
  });
  await page.route("**/api/work-items/w1", (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ json: { ...workItem, status: "in_progress", actualStart: "2026-09-01", ownerId: "u1", ownerName: "张三", assigneeIds: ["u1"], assigneeNames: ["张三"], version: 2 } });
  });
  await page.goto("/requirements/r1");
  await page.getByRole('tab', { name: /^工作项 / }).click();
  const row = page.locator('.modal-card-workspace[role=dialog]').locator('.work-arrangement-row').first();
  await row.getByRole("button", { name: /主负责人：未分配/ }).click();
  const popover = page.locator(".inline-select-popover");

  availablePeople = people.slice(0, 1);
  const previousReads = peopleReads;
  await page.evaluate(() => { window.dispatchEvent(new Event("offline")); window.dispatchEvent(new Event("online")); });
  await expect.poll(() => peopleReads).toBeGreaterThan(previousReads);
  await expect(popover.getByRole("option",{name:/李四/})).toHaveCount(0);

  expect(submissions).toHaveLength(0);
  await popover.getByRole("option", { name: /张三/ }).click();

  await expect.poll(() => submissions).toHaveLength(1);
  expect(submissions[0]).toMatchObject({ ownerId: "u1", assigneeIds: ["u1"], expectedVersion: 1 });
});

test("新增工作项人员刷新失效后保留姓名并要求清理选择", async ({ page }) => {
  await mockApplication(page, []);
  let availablePeople = [...people];
  let peopleReads = 0;
  const submissions: Array<Record<string, unknown>> = [];
  await page.route("**/api/people?*", (route) => {
    peopleReads++;
    return route.fulfill({ json: availablePeople });
  });
  await page.route("**/api/requirements/r1/work-items", (route) => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ json: { ...workItem, id: "w3", title: "人员变化草稿" } });
  });
  await page.goto("/requirements/r1");
  await page.getByRole('tab', { name: /^工作项 / }).click();
  const editor = page.locator('.modal-card-workspace[role=dialog]');
  await editor.getByRole("button", { name: "添加工作项", exact: true }).click();
    await page.getByLabel("新工作项名称", { exact: true }).fill("人员变化草稿");
  await editor.getByRole("button", { name: /新工作项主负责人：未分配/ }).click();
  await page.locator(".inline-select-popover").getByRole("option", { name: /李四/ }).click();
  await editor.getByRole("button", { name: /新工作项协作人员：选择人员/ }).click();
  const collaborators = page.locator(".inline-multi-popover");
  await collaborators.getByRole("checkbox", { name: /张三/ }).check();
  availablePeople = [];
  const previousReads = peopleReads;
  await page.evaluate(() => { window.dispatchEvent(new Event("offline")); window.dispatchEvent(new Event("online")); });
  await expect.poll(() => peopleReads).toBeGreaterThan(previousReads);
  await expect(collaborators.getByRole("checkbox", { name: /张三/ })).toBeChecked();
  await expect(collaborators.getByRole("alert")).toHaveText("张三已不可用，请取消选择后保存。");
  await expect(collaborators.getByRole("button", { name: "完成", exact: true })).toBeDisabled();
  await collaborators.getByRole("checkbox", { name: /张三/ }).click();
  await collaborators.getByRole("button", { name: "完成", exact: true }).click();
  await expect(editor.getByRole("button", { name: /新工作项主负责人：李四（已不可用）/ })).toBeVisible();
  await expect(editor.getByRole("alert")).toHaveText("新增工作项选择的人员已不可用，请重新选择负责人或协作人员。");
  await expect(editor.getByRole("button", { name: '保存工作项', exact: true })).toBeDisabled();
  expect(submissions).toHaveLength(0);
  await editor.getByRole("button", { name: /新工作项主负责人：李四（已不可用）/ }).click();
  await page.locator(".inline-select-popover").getByRole("option", { name: "未分配", exact: true }).click();
  await expect(editor.getByRole("button", { name: '保存工作项', exact: true })).toBeEnabled();
  await editor.getByRole("button", { name: '保存工作项', exact: true }).click();
  await expect.poll(() => submissions).toHaveLength(1);
  expect(submissions[0]).toMatchObject({ title: "人员变化草稿", ownerId: null, assigneeIds: [], expectedVersion: 1 });
});

test("新增工作项显示在列表末尾并自动滚动到草稿", async ({ page }) => {
  const workItems = Array.from({ length: 14 }, (_, index) => ({
    ...structuredClone(workItem),
    id: `append-${index}`,
    templateItemId: null,
    title: `已有工作项${index + 1}`,
    milestoneLabel: null,
    sortOrder: index,
  }));
  await mockApplication(page, [], { requirement: { workItems } });
  await page.goto("/requirements/r1");
  await page.getByRole('tab', { name: /^工作项 / }).click();
  const editor = page.locator('.modal-card-workspace[role=dialog]');
  const scrollArea = editor.locator(".work-editor-scroll");

  await editor.getByRole("button", { name: "添加工作项", exact: true }).click();

  const newRow = editor.locator(".work-create-row");
  await expect(newRow).toHaveCount(1);
  await expect(editor.locator(".work-arrangement-list > :last-child")).toHaveClass(/work-create-row/);
  await expect(newRow.getByRole("textbox", { name: "新工作项名称", exact: true })).toBeFocused();
  await expect.poll(() => scrollArea.evaluate((element) => Math.round(element.scrollTop + element.clientHeight - element.scrollHeight))).toBeGreaterThanOrEqual(-2);
});

test("需求概况显示已评估的中风险", async ({ page }) => {
  await mockApplication(page, [], { requirement: { riskLevel: "medium", riskEvaluated: true, highRisk: false } });
  await page.goto("/requirements/r1");
  await expect(page.locator(".requirement-overview")).toContainText("中风险");
});

test("终态工作项向管理员保留资料修正入口，普通成员只读", async ({ page }) => {
  await mockApplication(page, [], { workItem: { status: "completed", progress: 100, actualStart: "2026-09-01", actualEnd: "2026-09-03" } });
  await page.goto("/requirements/r1?workItemId=w1");
  await page.getByRole('tab', { name: '资料', exact: true }).click();
  const dialog = page.locator('.modal-card-workspace[role=dialog]');
  for (const name of [/工作项名称：设计/, /主负责人：未分配/, /协作人员：无协作人员/, /计划开始：2026-09-01/, /计划完成：2026-09-03/]) {
    await expect(dialog.getByRole("button", { name })).toBeEnabled();
  }
  await page.route('**/api/session', route => route.fulfill({json:{authenticated:true,accountId:'member',username:'member',role:'user',globalRole:'user',personId:'u1',managedProjectIds:[]}}));
  await page.reload();
  await page.getByRole('tab', { name: '资料', exact: true }).click();
  for (const name of [/工作项名称：设计/, /主负责人：未分配/, /协作人员：无协作人员/, /计划开始：2026-09-01/, /计划完成：2026-09-03/]) {
    await expect(dialog.getByRole("button", { name })).toBeDisabled();
  }
});

test("无需原因的负责人选择在后台更新后也先保留所选项再提交", async ({ page }) => {
  await mockApplication(page, []);
  let current = structuredClone(requirement);
  let reads = 0;
  const submissions: Array<Record<string, unknown>> = [];
  await page.route("**/api/requirements/r1", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    reads++;
    return route.fulfill({ json: current });
  });
  await page.route("**/api/work-items/w1", (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ json: { ...current.workItems[0], ownerId: "u1", ownerName: "张三", version: 3 } });
  });
  await page.goto("/requirements/r1");
  await page.getByRole('tab', { name: /^工作项 / }).click();
  const row = page.locator('.modal-card-workspace[role=dialog]').locator('.work-arrangement-row').first();
  await row.getByRole("button", { name: /主负责人：未分配/ }).click();
  current = { ...current, version: 2, workItems: [{ ...current.workItems[0], title: "后台更新", version: 2 }, current.workItems[1]] };
  const previousReads = reads;
  await page.evaluate(() => { window.dispatchEvent(new Event("offline")); window.dispatchEvent(new Event("online")); });
  await expect.poll(() => reads).toBeGreaterThan(previousReads);
  const popover = page.locator(".inline-select-popover");
  await popover.getByRole("option", { name: /张三/ }).click();
  expect(submissions).toHaveLength(0);
  await expect(popover.getByRole("button", { name: "保存所选", exact: true })).toBeDisabled();
  await popover.getByRole("button", { name: "重新读取工作项", exact: true }).click();
  await expect(popover.getByRole("button", { name: "保存所选", exact: true })).toBeEnabled();
  await popover.getByRole("button", { name: "保存所选", exact: true }).click();
  await expect.poll(() => submissions.length).toBe(1);
  expect(submissions[0]).toMatchObject({ ownerId: "u1", assigneeIds: ["u1"], expectedVersion: 2 });
});

test("并发编辑工作项时，较早请求失败不覆盖另一行保存结果", async ({ page }) => {
  const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
  await mockApplication(page, patches);
  let firstRequested = false;
  let releaseFirst!: () => void;
  const firstResponse = new Promise<void>((resolve) => { releaseFirst = resolve; });
  await page.route("**/api/work-items/w1", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    firstRequested = true;
    await firstResponse;
    await route.fulfill({ status: 409, json: { error: "第一行保存冲突", code: "STALE_WRITE" } });
  });
  try {
    await page.goto("/requirements/r1");
    await page.getByRole('tab', { name: /^工作项 / }).click();
    const firstRow = page.locator('.work-arrangement-row[data-work-id="w1"]');
    const secondRow = page.locator('.work-arrangement-row[data-work-id="w2"]');
    await firstRow.getByRole("button", { name: /主负责人：未分配/ }).click();
    await page.getByRole('option', {name:/张三/}).click();
    await expect.poll(() => firstRequested).toBe(true);
    await page.keyboard.press('Escape');
    await secondRow.getByRole("button", { name: /主负责人：未分配/ }).click();
    await page.getByRole('option', {name:/李四/}).click();
    await expect.poll(() => patches.some((entry) => entry.path === "/api/work-items/w2")).toBe(true);
    await expect(secondRow.getByRole("button", { name: /主负责人：李四/ })).toBeEnabled();
    releaseFirst();
    await expect(page.getByLabel("第一行保存冲突", { exact: true })).toBeVisible();
    await expect(secondRow.getByRole("button", { name: /主负责人：李四/ })).toBeVisible();
  } finally { releaseFirst(); }
});

for (const firstResult of ['failure', 'success'] as const) {
  test(`迟到的文本保存${firstResult}不抢占其他字段焦点，失败草稿可重试`, async ({ page }) => {
    const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
    await mockApplication(page, patches);
    let firstRequested = false;
    let releaseFirst!: () => void;
    const firstResponse = new Promise<void>((resolve) => { releaseFirst = resolve; });
    await page.route('**/api/work-items/w1', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      firstRequested = true;
      await firstResponse;
      if (firstResult === 'failure') await route.fulfill({ status: 409, json: { error: '设计名称保存冲突', code: 'STALE_WRITE' } });
      else await route.fallback();
    });
    try {
      await page.goto('/requirements/r1?workItemId=w1');
      await page.getByRole('tab', { name: '资料', exact: true }).click();
      const links = page.getByRole('region', {name:'工作项关联链接'});
      await links.getByRole('button', {name:'编辑',exact:true}).click();
      await links.getByRole('button', {name:'添加',exact:true}).click();
      await page.getByRole('button', { name: /工作项名称：设计/ }).click();
      const editor = page.getByRole('textbox', { name: '工作项名称', exact: true });
      await editor.fill('设计修改草稿');
      await editor.press('Enter');
      await expect.poll(() => firstRequested).toBe(true);
      const otherEditor = page.getByRole('textbox',{name:'链接 1 名称',exact:true});
      await otherEditor.fill('链接尚未提交');
      releaseFirst();
      if (firstResult === 'failure') await expect(page.getByLabel('设计名称保存冲突', { exact: true })).toBeVisible();
      else await expect(page.getByRole('button', { name: /工作项名称：设计修改草稿/ })).toBeEnabled();
      await expect(otherEditor).toHaveValue('链接尚未提交');
      await expect(otherEditor).toBeFocused();
      expect(patches.some((entry) => entry.path === '/api/work-items/w2')).toBe(false);
      if (firstResult === 'failure') {
        await page.getByRole('button', { name: /工作项名称：设计/ }).click();
        await expect(editor).toHaveValue('设计修改草稿');
        await editor.press('Escape');
        await page.getByRole('button', { name: /工作项名称：设计/ }).click();
        await expect(editor).toHaveValue('设计');
      }
    } finally { releaseFirst(); }
  });
}

test('必填文本为空时切换编辑器，只保留新浮层且不提交空值', async ({ page }) => {
  const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
  await mockApplication(page, patches);
  await page.goto('/requirements/r1?workItemId=w1');
  await page.getByRole('tab', { name: '资料', exact: true }).click();
  await page.getByRole('button', { name: /工作项名称：设计/ }).click();
  await page.getByRole('textbox', { name: '工作项名称', exact: true }).fill('');
  await page.getByRole('button', { name: /计划开始：2026-09-01/ }).first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.inline-edit-popover')).toHaveCount(1);
  await expect(page.locator('.inline-date-popover')).toBeVisible();
  expect(patches).toHaveLength(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /工作项名称：设计/ }).click();
  const editor = page.getByRole('textbox', { name: '工作项名称', exact: true });
  await expect(editor).toHaveValue('');
  await editor.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('工作项名称不能为空');
  await expect(editor).toBeFocused();
  expect(patches).toHaveLength(0);
});

for (const kind of ['单选', '执行中单选', '日期', '多选'] as const) {
  test(`${kind}提交中关闭仍保持锁定，失败重开保留本次输入`, async ({ page }) => {
    const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
    await mockApplication(page, patches, kind === '执行中单选' || kind === '日期' ? { workItem: { status: 'in_progress', actualStart: '2026-09-01' } } : {});
    let requests = 0;
    let release!: () => void;
    const response = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/api/work-items/w1', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      requests += 1;
      await response;
      await route.fulfill({ status: 409, json: { error: '保存故障模拟', code: 'STALE_WRITE' } });
    });
    try {
      await page.goto('/requirements/r1?workItemId=w1');
      await page.getByRole('tab', { name: '资料', exact: true }).click();
      const trigger = page.getByRole('button', { name: kind === '多选' ? /^协作人员：/ : kind === '日期' ? /^计划开始：/ : /^主负责人：/ }).first();
      await trigger.click();
      if (kind === '多选') {
        await page.getByRole('checkbox', { name: /李四/ }).check();
        await page.locator('.inline-multi-popover').getByRole('button', { name: '完成', exact: true }).click();
      } else if (kind === '日期') {
        await page.getByRole('gridcell', { name: '2026-09-02' }).click();
        await page.locator('.inline-date-popover').getByRole('button', { name: '保存', exact: true }).click();
      } else {
        await page.getByRole('option').filter({ hasText: '张三' }).click();

      }
      await expect.poll(() => requests).toBe(1);
      if (kind === '单选') {
        await page.getByRole('listbox', { name: '主负责人' }).press('ArrowDown');
        await page.getByRole('listbox', { name: '主负责人' }).press('Enter');
      }
      if (kind === '多选') await expect.soft(page.getByRole('checkbox', { name: /张三/ })).toBeDisabled();
      else if (kind === '日期') await expect.soft(page.locator('.inline-date-popover').getByRole('gridcell', { name: '2026-09-03', exact: true })).toBeDisabled();
      else await expect.soft(page.getByRole('option').filter({ hasText: '李四' })).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(page.locator('.inline-edit-popover')).toHaveCount(0);
      await expect.soft(trigger).toBeDisabled();
      expect(requests).toBe(1);
      await page.getByRole('button', { name: /工作项名称：设计/ }).click();
      const otherEditor = page.getByRole('textbox', { name: '工作项名称', exact: true });
      await otherEditor.fill('其他字段尚未提交');
      release();
      await expect(page.getByLabel('保存故障模拟', { exact: true })).toBeVisible();
      await expect(otherEditor).toHaveValue('其他字段尚未提交');
      await expect(otherEditor).toBeFocused();
      expect(patches.some((entry) => entry.path === '/api/work-items/w2')).toBe(false);
      await otherEditor.press('Escape');
      await expect(trigger).toBeEnabled();
      await trigger.click();
      if (kind === '多选') await expect(page.getByRole('checkbox', { name: /李四/ })).toBeChecked();
      else if (kind === '日期') {
        await expect(page.getByRole('gridcell', { name: '2026-09-02' })).toHaveAttribute('aria-selected', 'true');
      } else {
        await expect(page.getByRole('option').filter({ hasText: '张三' })).toHaveAttribute('aria-selected', 'true');
      }
    } finally { release(); }
  });
}

test("需求概况不展示废弃优先级，后台风险更新不写入业务资料", async ({ page }) => {
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  await mockApplication(page, writes);
  let current = {...structuredClone(requirement),riskLevel:'low' as Requirement['riskLevel'],riskEvaluated:true};
  await page.route('**/api/requirements/r1',route=>route.fulfill({json:current}));
  await page.goto('/requirements/r1');
  const overview=page.locator('.requirement-overview');
  await expect(overview).toContainText('低风险');
  await expect(page.getByRole('button',{name:/需求优先级/})).toHaveCount(0);
  await expect(overview).not.toContainText(/P[012]/);
  for(const riskLevel of ['high','medium'] as const){
    current={...current,riskLevel,highRisk:riskLevel==='high'};
    await page.evaluate(()=>{window.dispatchEvent(new Event('offline'));window.dispatchEvent(new Event('online'));});
    await expect(overview).toContainText(riskLevel==='high'?'高风险':'中风险');
  }
  expect(writes).toEqual([]);
});

test("管理表格支持原地编辑、显式状态命令和失败回滚", async ({ page }, _testInfo) => {

  const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
  await mockApplication(page, patches);

  await page.goto("/requirements/r1");
  await expect(page.getByRole("button", {name:/需求优先级/})).toHaveCount(0);
  expect(patches).toEqual([]);

  await page.goto("/requirements/r1");
  await page.getByRole('tab', { name: /^工作项 / }).click();
  await page.getByRole("button", { name: /主负责人：未分配/ }).first().click();
  await page.getByRole("option").filter({ hasText: "张三" }).click();
  await expect.poll(() => patches.some((entry) => entry.path === "/api/work-items/w1" && entry.body.ownerId === "u1")).toBe(true);
  await page.getByRole("button", { name: /协作人员：无协作人员/ }).first().click();
  await page.getByText("李四", { exact: true }).click();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect.poll(() => patches.some((entry) => Array.isArray(entry.body.assigneeIds) && entry.body.assigneeIds.includes("u2"))).toBe(true);
  await page.getByRole("button", { name: /计划开始：2026-09-01/ }).first().click();
  const datePopover = page.locator(".inline-date-popover");
  await expect(datePopover).toBeVisible();
  await datePopover.getByRole("button", { name: "下一个月" }).click();
  await expect.poll(() => patches.some((entry) => entry.path === "/api/work-items/w1" && Object.prototype.hasOwnProperty.call(entry.body, "plannedStart"))).toBe(false);
  await datePopover.getByRole("button", { name: "上一个月" }).click();
  await datePopover.getByRole("gridcell", { name: "2026-09-02" }).click();
  await datePopover.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => patches.some((entry) => entry.path === "/api/work-items/w1" && entry.body.plannedStart === "2026-09-02")).toBe(true);

  await page.goto("/issues");
  await page.locator(".issue-title-button").click();
  const issueDialog = page.getByRole("dialog", { name: "问题详情" });
  await issueDialog.getByLabel("问题标题", { exact: true }).fill("问题冲突");
  await issueDialog.getByRole("button", { name: "保存修改" }).click();
  await expect(issueDialog.getByText("问题标题已存在")).toBeVisible();
  await issueDialog.getByRole("button", { name: "关闭" }).click();
  await page.locator(".issue-status-trigger").click();
  await page.getByRole("button", { name: /已解决.*确认解决/ }).click();

  await expect.poll(() => patches.some((entry) => entry.path === "/api/issues/i1/resolve" && entry.body.content === "")).toBe(true);
  await expect(page.locator(".issue-data-row").getByText("已解决", { exact: true })).toBeVisible();

  await page.goto("/accounts");
  await page.locator(".account-permission-editor").first().getByRole("button").click();
  await expect(page.locator(".account-permission-popover").getByRole("option", { name: "项目经理" })).toHaveCount(0);
  await chooseOption(page.locator(".account-permission-popover select"), "admin");
  await page.getByRole("button", { name: "保存权限" }).click();
  await expect.poll(() => patches.some((entry) => entry.path === "/api/accounts/a1" && entry.body.role === "admin" && entry.body.managedProjectIds === undefined)).toBe(true);

  await page.goto("/projects");
  await expect(page.locator(".project-table").getByText("测试项目", { exact: true })).toBeVisible();
  await expect(page.locator(".project-table .inline-edit-cell")).toHaveCount(0);

  await page.goto("/people");
  await expect(page.getByRole("heading", { name: "前端工程师" })).toBeVisible();
  await expect(page.locator(".person-card .inline-edit-cell")).toHaveCount(0);
});

test("日期翻月不提交，执行中工作项在统一浮窗直接保存", async ({ page }, _testInfo) => {

  const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
  const browserDialogs: string[] = [];
  page.on("dialog", async (dialog) => { browserDialogs.push(dialog.message()); await dialog.dismiss(); });
  await mockApplication(page, patches, { workItem: { status: "in_progress", actualStart: "2026-09-01", ownerId: "u1", ownerName: "张三", assigneeIds: ["u1"], assigneeNames: ["张三"] } });

  await page.goto("/requirements/r1");
  await page.getByRole('tab', { name: /^工作项 / }).click();
  await page.getByRole("button", { name: /主负责人：张三/ }).first().click();
  const ownerPicker = page.locator(".inline-select-popover");
  await ownerPicker.getByRole("option", { name: /李四/ }).click();


  await expect.poll(() => patches.some((entry) => entry.path === "/api/work-items/w1" && entry.body.ownerId === "u2")).toBe(true);
  await page.getByRole("button", { name: /计划开始：2026-09-01/ }).first().click();
  const popover = page.locator(".inline-date-popover");
  await expect(popover).toBeVisible();
  await popover.getByRole("button", { name: "下一个月" }).click();
  await page.waitForTimeout(150);
  expect(patches.some((entry) => entry.path === "/api/work-items/w1" && Object.prototype.hasOwnProperty.call(entry.body, "plannedStart"))).toBe(false);
  expect(browserDialogs).toEqual([]);

  await popover.getByRole("button", { name: "上一个月" }).click();
  await popover.getByRole("gridcell", { name: "2026-09-02" }).click();
  expect(patches.some((entry) => entry.path === "/api/work-items/w1" && Object.prototype.hasOwnProperty.call(entry.body, "plannedStart"))).toBe(false);
  await popover.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => patches.some((entry) => entry.path === "/api/work-items/w1" && entry.body.plannedStart === "2026-09-02")).toBe(true);
  const savedDateButton = page.getByRole("button", { name: /计划开始：2026-09-02/ }).first();
  await expect(savedDateButton.locator(".inline-edit-success")).toBeVisible();
  expect(await savedDateButton.evaluate((button) => {
    const icon = button.querySelector(".inline-edit-success")?.getBoundingClientRect();
    const bounds = button.getBoundingClientRect();
    return Boolean(icon && icon.left >= bounds.left && icon.right <= bounds.right && icon.top >= bounds.top && icon.bottom <= bounds.bottom);
  })).toBe(true);
  expect(browserDialogs).toEqual([]);

  const handles = page.getByRole("button", { name: /拖动.*调整顺序/ });
  const first = await handles.nth(0).boundingBox();
  const second = await handles.nth(1).boundingBox();
  await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2);
  await page.mouse.down();
  await page.mouse.move(second!.x + second!.width / 2, second!.y + second!.height / 2, { steps: 12 });
  await finishPointerDrag(page);
  await expect(page.getByRole("dialog",{name:"调整工作项顺序"})).toHaveCount(0);
  await expect.poll(()=>patches.some(entry=>entry.path.endsWith("/reorder-work-items"))).toBe(true);
  expect(browserDialogs).toEqual([]);
});

test("历史里程碑标签继续显示，工作项设置不再写入嵌入式里程碑", async ({ page }, _testInfo) => {

  const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
  await mockApplication(page, patches);

  await page.goto("/requirements/r1?workItemId=w1");
  await expect(page.getByRole("region",{name:"执行资料"})).toContainText("需求基线");
  await page.getByRole("tab",{name:"资料",exact:true}).click();
  await expect(page.getByRole("button", { name: /里程碑名称：需求基线/ })).toHaveCount(0);
  expect(patches).toEqual([]);
});

test("删除工作项成功后关闭确认并保留设置窗口，不产生重复删除", async ({ page }) => {
  await mockApplication(page, []);
  let current = structuredClone(requirement);
  const submissions: Array<Record<string, unknown>> = [];
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: current }));
  await page.route('**/api/work-items/w1', (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    submissions.push(route.request().postDataJSON());
    current = { ...current, version: 2, workItems: current.workItems.filter((item) => item.id !== 'w1') };
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('tab', { name: /^工作项 / }).click();
  await page.locator('.work-arrangement-row[data-work-id="w1"]').getByRole('button', { name: '删除', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除工作项', exact: true });
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.modal-card-workspace[role=dialog]')).toBeVisible();
  await expect(page.locator('.work-arrangement-row')).toHaveCount(1);
  await expect(page.locator('.work-arrangement-list')).toContainText('开发');
  expect(submissions).toEqual([{ expectedVersion: 1 }]);
});

test("删除工作项已落库但响应异常时核对列表并避免重复删除", async ({ page }) => {
  await mockApplication(page, []);
  let current = structuredClone(requirement);
  let submissions = 0;
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: current }));
  await page.route('**/api/work-items/w1', (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    submissions += 1;
    current = { ...current, version: 2, workItems: current.workItems.filter((item) => item.id !== 'w1') };
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'deleted' });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('tab', { name: /^工作项 / }).click();
  await page.locator('.work-arrangement-row[data-work-id="w1"]').getByRole('button', { name: '删除', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除工作项', exact: true });
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(dialog).toContainText('删除结果待核对');
  await expect(dialog.getByRole('button',{name:'确认删除',exact:true})).toBeDisabled();
  await expect(page.locator('.modal-card-workspace[role=dialog]')).toBeVisible();
  await expect(page.locator('.work-arrangement-list')).not.toContainText('设计');
  expect(submissions).toBe(1);
});

test('删除工作项响应未知且需求回读失败时关闭确认仍锁定设置', async ({ page }) => {
  await mockApplication(page, []);
  let failRead = false;
  let submissions = 0;
  await page.route('**/api/requirements/r1', (route) => failRead
    ? route.fulfill({ status: 503, json: { error: '需求读取暂不可用' } })
    : route.fulfill({ json: requirement }));
  await page.route('**/api/work-items/w1', (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    submissions += 1;
    failRead = true;
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'deleted' });
  });

  await page.goto('/requirements/r1');
  const entry = page.getByRole('tab', { name: /^工作项 / });
  await entry.click();
  const settings = page.locator('.modal-card-workspace[role=dialog]');
  const remove = settings.locator('.work-arrangement-row[data-work-id="w1"]').getByRole('button', { name: '删除', exact: true });
  await remove.click();
  const confirm = page.getByRole('dialog', { name: '删除工作项', exact: true });
  await confirm.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(confirm).toContainText('删除结果待核对');
  await expect(confirm).toContainText('需求读取暂不可用');
  await confirm.getByRole('button', { name: '取消', exact: true }).click();

  await expect(confirm).toHaveCount(0);
  await expect(remove).toHaveCount(0);
  await expect(settings.getByRole('button',{name:'添加工作项',exact:true})).toBeDisabled();
  expect(submissions).toBe(1);
  await settings.getByRole('button', { name: '关闭', exact: true }).click();
  failRead=false;
  await page.goto('/requirements/r1');
  await page.getByRole('tab',{name:'概况',exact:true}).click();
  await expect(page.getByRole('alert').filter({ hasText: '工作项设置结果待核对' })).toBeVisible();
  await entry.click();
  await expect(settings.getByRole('button',{name:'添加工作项',exact:true})).toBeDisabled();
  await settings.getByRole('tab',{name:'概况',exact:true}).click();

  failRead = false;
  await page.getByRole('button', { name: '重新读取需求', exact: true }).click();
  await expect(entry).toBeEnabled();
});

for (const change of ['renamed', 'started', 'noted', 'removed', 'locked'] as const) {
  test(`删除确认期间工作项${change}后不再允许使用旧确认继续删除`, async ({ page }) => {
    await mockApplication(page, []);
    let current = structuredClone(requirement);
    let reads = 0;
    const submissions: Array<Record<string, unknown>> = [];
    await page.route('**/api/requirements/r1', (route) => { reads++; return route.fulfill({ json: current }); });
    await page.route('**/api/work-items/w1', (route) => {
      submissions.push(route.request().postDataJSON());
      return route.fulfill({ status: 409, json: { error: '工作项已变化', code: 'STALE_WRITE' } });
    });
    await page.goto('/requirements/r1');
    await page.getByRole('tab', { name: /^工作项 / }).click();
    await page.locator('.work-arrangement-row[data-work-id="w1"]').getByRole('button', { name: '删除', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '删除工作项', exact: true });
    if (change === 'noted') current = { ...current, progressUpdates: [{
      id: 'note1', requirementId: 'r1', workItemId: 'w1', workItemTitle: '设计', percent: 0, workItemPercent: null,
      content: '补充说明', eventType: 'note', supersedesId: null, createdByAccountId: 'admin', createdByName: 'admin',
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    }] };
    else if (change === 'removed') current = { ...current, version: 2, workItems: [secondWorkItem] };
    else if (change === 'locked') current = { ...current, version: 2, status: 'cancelled' };
    else current = { ...current, version: 2, workItems: current.workItems.map((item) => item.id === 'w1' ? {
      ...item, version: 2, ...(change === 'renamed' ? { title: '其他人调整的设计' } : { status: 'in_progress', actualStart: '2026-09-01', progress: 10 }),
    } : item) };
    const previousReads = reads;
    await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
    await expect.poll(() => reads).toBeGreaterThan(previousReads);
    await expect(dialog.getByRole('button', { name: '确认删除', exact: true })).toBeDisabled();await expect(dialog).toContainText('设计');
    expect(submissions).toHaveLength(0);
  });
}

test('删除工作项请求未结束时不能关闭确认或重复提交', async ({ page }) => {
  await mockApplication(page, []);
  let release!: () => void;
  let requests = 0;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/work-items/w1', async (route) => {
    requests++;
    await waiting;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('tab', { name: /^工作项 / }).click();
  await page.locator('.work-arrangement-row[data-work-id="w1"]').getByRole('button', { name: '删除', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除工作项', exact: true });
  try {
    await dialog.getByRole('button', { name: '确认删除', exact: true }).dblclick();
    await expect.poll(() => requests).toBe(1);
    await expect(dialog.getByRole('button', { name: '处理中…', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
  } finally { release(); }
  await expect(dialog).toHaveCount(0);
  expect(requests).toBe(1);
});

test('删除工作项冲突后重读失败禁止重试，成功读取后使用新版本', async ({ page }, testInfo) => {
  await mockApplication(page, []);
  let current = structuredClone(requirement);
  let failRead = false;
  const submissions: Array<Record<string, unknown>> = [];
  await page.route('**/api/requirements/r1', (route) => failRead
    ? route.fulfill({ status: 503, json: { error: '读取暂不可用' } }) : route.fulfill({ json: current }));
  await page.route('**/api/work-items/w1', (route) => {
    submissions.push(route.request().postDataJSON());
    if (submissions.length === 1) {
      failRead = true;
      current = { ...current, version: 2, workItems: [{ ...workItem, version: 2, title: '新设计' }, secondWorkItem] };
      return route.fulfill({ status: 409, json: { error: '工作项已变化', code: 'STALE_WRITE' } });
    }
    current = { ...current, version: 3, workItems: [secondWorkItem] };
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('tab', { name: /^工作项 / }).click();
  await page.locator('.work-arrangement-row[data-work-id="w1"]').getByRole('button', { name: '删除', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除工作项', exact: true });
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(dialog).toContainText('读取暂不可用');
  await expect(dialog.getByRole('button', { name: '确认删除', exact: true })).toBeDisabled();
  expect(submissions).toEqual([{ expectedVersion: 1 }]);
  if (process.env.ROUND24_SCREENSHOTS && testInfo.project.name === 'office-1280') await page.screenshot({ path: testInfo.outputPath('deletion-conflict-1280.png') });
  failRead = false;
  await dialog.getByRole('button', { name: '重新读取工作项', exact: true }).click();
  await expect(dialog).toContainText('新设计');
  await expect(dialog.getByRole('button', { name: '确认删除', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(submissions).toEqual([{ expectedVersion: 1 }, { expectedVersion: 2 }]);
});

for (const status of [403, 404]) {
  test(`删除工作项后${status}拒绝读取，不再显示旧确认窗口`, async ({ page }) => {
    await mockApplication(page, []);
    let denied = false;
    await page.route('**/api/requirements/r1', (route) => denied
      ? route.fulfill({ status, json: { error: '需求不可访问' } }) : route.fulfill({ json: requirement }));
    await page.route('**/api/work-items/w1', (route) => {
      denied = true;
      return route.fulfill({ status, json: { error: '工作项不可访问' } });
    });
    await page.goto('/requirements/r1');
    await page.getByRole('tab', { name: /^工作项 / }).click();
    await page.locator('.work-arrangement-row[data-work-id="w1"]').getByRole('button', { name: '删除', exact: true }).click();
    await page.getByRole('dialog', { name: '删除工作项', exact: true }).getByRole('button', { name: '确认删除', exact: true }).click();
    await expect(page.getByRole('status').filter({hasText:'需求不可访问'})).toBeVisible();
    await expect(page.getByRole('dialog',{name:'删除工作项',exact:true})).toHaveCount(0);
    await expect(page.locator('.work-arrangement-row')).toHaveCount(0);
  });
}

test('工作项删除入口对已有说明或阻塞信息禁用', async ({ page }) => {
  await mockApplication(page, []);
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: {
    ...requirement, workItems: [workItem, { ...secondWorkItem, blockedReason: '等待外部确认' }], progressUpdates: [{
      id: 'note1', requirementId: 'r1', workItemId: 'w1', workItemTitle: '设计', percent: 0, workItemPercent: null,
      content: '补充说明', eventType: 'note', supersedesId: null, createdByAccountId: 'admin', createdByName: 'admin',
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    }],
  } }));
  await page.goto('/requirements/r1');
  await page.getByRole('tab', { name: /^工作项 / }).click();
  await expect(page.locator('.work-arrangement-row[data-work-id="w1"]').getByRole('button', { name: '删除', exact: true })).toBeDisabled();
  await expect(page.locator('.work-arrangement-row[data-work-id="w2"]').getByRole('button', { name: '删除', exact: true })).toBeDisabled();
});

test('新增草稿期间需求更新后不能携带新版本提交旧内容', async ({ page }, testInfo) => {
  await mockApplication(page, []);
  let current = structuredClone(requirement);
  let reads = 0;
  const submissions: Array<Record<string, unknown>> = [];
  await page.route('**/api/requirements/r1', (route) => { reads++; return route.fulfill({ json: current }); });
  await page.route('**/api/requirements/r1/work-items', (route) => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ json: workItem });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('tab', { name: /^工作项 / }).click();
  await page.getByRole('button', { name: '添加工作项', exact: true }).click();
    await page.getByLabel('新工作项名称', { exact: true }).fill('草稿任务');
  current = { ...current, version: 2, title: '后台更新的需求' };
  const previousReads = reads;
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await expect.poll(() => reads).toBeGreaterThan(previousReads);
  await expect(page.getByRole('button', { name: '保存工作项', exact: true })).toBeDisabled();
  await expect(page.getByText('需求已更新', { exact: false })).toBeVisible();
  if (process.env.ROUND25_SCREENSHOTS && testInfo.project.name === 'office-1280') await page.screenshot({ path: testInfo.outputPath('create-conflict-1280.png') });
  expect(submissions).toHaveLength(0);
});

test('执行中新增填写期间需求更新后不能提交旧草稿', async ({ page }) => {
  await mockApplication(page, []);
  let current = { ...structuredClone(requirement), workItems: [{ ...workItem, status: 'in_progress', actualStart: '2026-09-01' }, secondWorkItem] };
  let reads = 0;
  const submissions: Array<Record<string, unknown>> = [];
  await page.route('**/api/requirements/r1', (route) => { reads++; return route.fulfill({ json: current }); });
  await page.route('**/api/requirements/r1/work-items', (route) => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ json: workItem });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('tab', { name: /^工作项 / }).click();
  await page.getByRole('button', { name: '添加工作项', exact: true }).click();
    await page.getByLabel('新工作项名称', { exact: true }).fill('执行中新增草稿');

  const dialog = page.locator('.modal-card-workspace[role=dialog]');
  current = { ...current, version: 2, title: '后台更新的需求' };
  const previousReads = reads;
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await expect.poll(() => reads).toBeGreaterThan(previousReads);
  await expect(dialog.getByRole('button', { name: '保存工作项', exact: true })).toBeDisabled();
  expect(submissions).toHaveLength(0);
});

test('新增工作项提交期间锁定草稿和工作项设置窗口', async ({ page }) => {
  await mockApplication(page, []);
  let release!: () => void;
  let requests = 0;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/requirements/r1/work-items', async (route) => {
    requests++;
    await waiting;
    return route.fulfill({ json: { ...workItem, id: 'w3', title: '等待保存' } });
  });
  await page.goto('/requirements/r1');
  const editor = page.locator('.modal-card-workspace[role=dialog]');
  await page.getByRole('tab', { name: /^工作项 / }).click();
  await page.getByRole('button', { name: '添加工作项', exact: true }).click();
    await page.getByLabel('新工作项名称', { exact: true }).fill('等待保存');
  try {
    await page.getByRole('button', { name: '保存工作项', exact: true }).evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await expect.poll(() => requests).toBe(1);
    await expect(page.getByRole('button', { name: '取消', exact: true })).toBeDisabled();
    await expect(editor).toBeVisible();
  } finally { release(); }
  await expect(editor).toBeVisible();
  await expect.poll(() => page.getByRole('textbox',{name:'新工作项名称',exact:true}).count()).toBe(0);
});

test('执行中新增提交期间锁定当前窗口且仅提交一次', async ({ page }) => {
  await mockApplication(page, [], { workItem: { status: 'in_progress', actualStart: '2026-09-01' } });
  let release!: () => void;
  let requests = 0;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/requirements/r1/work-items', async (route) => {
    requests++;
    await waiting;
    return route.fulfill({ json: { ...workItem, id: 'w3', title: '执行中新增' } });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('tab', { name: /^工作项 / }).click();
  await page.getByRole('button', { name: '添加工作项', exact: true }).click();
    await page.getByLabel('新工作项名称', { exact: true }).fill('执行中新增');

  const dialog = page.locator('.modal-card-workspace[role=dialog]');
  try {
    await dialog.getByRole('button', { name: '保存工作项', exact: true }).evaluate(button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click();});
    await expect.poll(() => requests).toBe(1);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
  } finally { release(); }
  await expect(dialog.getByRole('textbox',{name:'新工作项名称',exact:true})).toHaveCount(0);
  await expect(page.locator('.modal-card-workspace[role=dialog]')).toBeVisible();
});



test('新增草稿显式重读后保留内容并使用新版本提交', async ({ page }) => {
  await mockApplication(page, []);
  let current = structuredClone(requirement);
  const submissions: Array<Record<string, unknown>> = [];
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: current }));
  await page.route('**/api/requirements/r1/work-items', (route) => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ json: { ...workItem, id: 'w3', title: '保留的新增草稿' } });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('tab', { name: /^工作项 / }).click();
  await page.getByRole('button', { name: '添加工作项', exact: true }).click();
    await page.getByLabel('新工作项名称', { exact: true }).fill('保留的新增草稿');
  current = { ...current, version: 2, title: '后台更新的需求' };
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await page.getByRole('button', { name: '重新读取需求', exact: true }).click();
  await expect(page.getByText('新增草稿保持不变', { exact: false })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-card-workspace[role=dialog]')).toHaveCount(0);
  await page.goto('/requirements/r1');
  await page.getByRole('tab', { name: /^工作项 / }).click();
  await expect(page.locator('.modal-card-workspace[role=dialog]')).toBeVisible();
  await expect(page.getByRole('textbox', { name: '新工作项名称', exact:true })).toHaveValue('保留的新增草稿');
  await page.getByRole('button', { name: '保存工作项', exact: true }).click();
  await expect.poll(() => submissions).toHaveLength(1);
  expect(submissions[0]).toMatchObject({ title: '保留的新增草稿', expectedVersion: 2 });
});

test('新增工作项已落库但响应异常时按完整草稿核对且不重复创建', async ({ page }) => {
  await mockApplication(page, []);
  let current = structuredClone(requirement);
  const submissions: Array<Record<string, unknown>> = [];
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: current }));
  await page.route('**/api/requirements/r1/work-items', (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    submissions.push(body);
    const created = {
      ...workItem,
      id: 'w3',
      title: String(body.title).replace(/\s+/gu, ' ').trim(),
      milestoneLabel: body.milestoneLabel as string | null,
      ownerId: body.ownerId as string | null,
      ownerName: null,
      assigneeIds: body.assigneeIds as string[],
      assigneeNames: [],
      plannedStart: body.plannedStart as string | null,
      plannedEnd: body.plannedEnd as string | null,
    };
    current = { ...current, version: 2, workItems: [...current.workItems, created] };
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'created' });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('tab', { name: /^工作项 / }).click();
  await page.getByRole('button', { name: '添加工作项', exact: true }).click();
    await page.getByLabel('新工作项名称', { exact: true }).fill('异常  响应后新增');
  await page.getByRole('button', { name: '保存工作项', exact: true }).click();

  await expect(page.getByRole('dialog')).toContainText('提交结果待核对');
  await expect(page.locator('.work-arrangement-list')).toContainText('异常 响应后新增');
  await expect(page.getByRole('textbox',{name:'新工作项名称',exact:true})).toBeVisible();
  expect(submissions).toHaveLength(1);
});

test('新增工作项响应未知且需求回读失败时关闭设置仍锁定入口', async ({ page }) => {
  await mockApplication(page, []);
  let failRead = false;
  let submissions = 0;
  await page.route('**/api/requirements/r1', (route) => failRead
    ? route.fulfill({ status: 503, json: { error: '需求读取暂不可用' } })
    : route.fulfill({ json: requirement }));
  await page.route('**/api/requirements/r1/work-items', (route) => {
    submissions += 1;
    failRead = true;
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'created' });
  });

  await page.goto('/requirements/r1');
  let entry = page.getByRole('tab', { name: /^工作项 / });
  await entry.click();
  const editor = page.locator('.modal-card-workspace[role=dialog]');
  await editor.getByRole('button', { name: '添加工作项', exact: true }).click();
    await page.getByLabel('新工作项名称', { exact: true }).fill('待核对的新工作项');
  await editor.getByRole('button', { name: '保存工作项', exact: true }).click();

  await expect(editor.getByRole('alert')).toContainText('提交结果待核对');
  await expect(editor).toContainText('需求读取暂不可用');
  await editor.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(submissions).toBe(1);
  failRead=false;
  await page.goto('/requirements/r1');
  await page.getByRole('tab',{name:'概况',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'工作项设置结果待核对'})).toBeVisible();
  entry=page.getByRole('tab',{name:/^工作项 /});await entry.click();
  await expect(page.getByRole('textbox',{name:'新工作项名称',exact:true})).toHaveValue('待核对的新工作项');
  await expect(page.getByRole('button',{name:'保存工作项',exact:true})).toBeDisabled();
  expect(submissions).toBe(1);
  await page.getByRole('tab',{name:'概况',exact:true}).click();
  failRead = false;
  await page.getByRole('button', { name: '重新读取需求', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '工作项设置结果待核对' })).toHaveCount(0);
  await expect(entry).toBeEnabled();
  expect(submissions).toBe(1);
});



test('新增工作项被拒绝访问后清除工作项设置与草稿', async ({ page }) => {
  await mockApplication(page, []);
  let denied = false;
  await page.route('**/api/requirements/r1', (route) => denied
    ? route.fulfill({ status: 403, json: { error: '需求不可访问' } }) : route.fulfill({ json: requirement }));
  await page.route('**/api/requirements/r1/work-items', (route) => {
    denied = true;
    return route.fulfill({ status: 403, json: { error: '不能新增工作项' } });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('tab', { name: /^工作项 / }).click();
  await page.getByRole('button', { name: '添加工作项', exact: true }).click();
    await page.getByLabel('新工作项名称', { exact: true }).fill('不应继续显示的草稿');
  await page.getByRole('button', { name: '保存工作项', exact: true }).click();
  await expect(page.getByRole('status').filter({hasText:'需求不可访问'})).toBeVisible();
  await expect(page.locator('.work-arrangement-row,.work-create-row')).toHaveCount(0);
  await expect(page.getByText('不应继续显示的草稿')).toHaveCount(0);
});

test('新增工作项冲突后重读失败保留草稿，成功读取后使用新版本', async ({ page }) => {
  await mockApplication(page, []);
  let current = structuredClone(requirement);
  let failRead = false;
  const submissions: Array<Record<string, unknown>> = [];
  await page.route('**/api/requirements/r1', (route) => failRead
    ? route.fulfill({ status: 503, json: { error: '读取暂不可用' } }) : route.fulfill({ json: current }));
  await page.route('**/api/requirements/r1/work-items', (route) => {
    submissions.push(route.request().postDataJSON());
    if (submissions.length === 1) {
      failRead = true;
      current = { ...current, version: 2, title: '后台更新的需求' };
      return route.fulfill({ status: 409, json: { error: '需求已变化', code: 'STALE_WRITE' } });
    }
    return route.fulfill({ json: { ...workItem, id: 'w3', title: '冲突后保留草稿' } });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('tab', { name: /^工作项 / }).click();
  await page.getByRole('button', { name: '添加工作项', exact: true }).click();
    await page.getByLabel('新工作项名称', { exact: true }).fill('冲突后保留草稿');
  await page.getByRole('button', { name: '保存工作项', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存工作项', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重新读取需求', exact: true }).click();
  await expect(page.getByText('读取暂不可用', { exact: true })).toBeVisible();
  expect(submissions).toEqual([expect.objectContaining({ title: '冲突后保留草稿', expectedVersion: 1 })]);
  failRead = false;
  await page.getByRole('button', { name: '重新读取需求', exact: true }).click();
  await page.getByRole('button', { name: '保存工作项', exact: true }).click();
  await expect.poll(() => submissions).toHaveLength(2);
  expect(submissions[1]).toMatchObject({ title: '冲突后保留草稿', expectedVersion: 2 });
});

test('排序冲突后重读失败保留操作锁，成功读取后使用新版本', async ({ page }) => {
  await mockApplication(page, []);
  let current = { ...structuredClone(requirement), workItems: [{ ...workItem, status: 'in_progress', actualStart: '2026-09-01' }, secondWorkItem] };
  let failRead = false;
  const submissions: Array<Record<string, unknown>> = [];
  await page.route('**/api/requirements/r1', (route) => failRead
    ? route.fulfill({ status: 503, json: { error: '读取暂不可用' } }) : route.fulfill({ json: current }));
  await page.route('**/api/requirements/r1/reorder-work-items', (route) => {
    submissions.push(route.request().postDataJSON());
    if (submissions.length === 1) {
      failRead = true;
      current = { ...current, version: 2, title: '后台更新的需求' };
      return route.fulfill({ status: 409, json: { error: '需求已变化', code: 'STALE_WRITE' } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('tab', { name: /^工作项 / }).click();
  const drag=async()=>{
  const handles = page.getByRole('button', { name: /拖动.*调整顺序/ });
  const first = await handles.nth(0).boundingBox();
  const second = await handles.nth(1).boundingBox();
  await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2);
  await page.mouse.down();
  await page.mouse.move(second!.x + second!.width / 2, second!.y + second!.height / 2, { steps: 12 });
  await finishPointerDrag(page);
  };
  await drag();
  const dialog = page.locator('.modal-card-workspace[role=dialog]');

  await expect(dialog.getByRole("button",{name:/拖动.*调整顺序/}).first()).toBeDisabled();
  await dialog.getByRole('button', { name: '重新读取需求', exact: true }).click();
  await expect(dialog).toContainText('读取暂不可用');
  expect(submissions).toEqual([{ ids: ['w2', 'w1'], expectedVersion: 1 }]);
  failRead = false;
  await dialog.getByRole('button', { name: '重新读取需求', exact: true }).click();
  await expect(dialog.getByRole('button',{name:/拖动.*调整顺序/}).first()).toBeEnabled();
  await drag();
  await expect.poll(() => submissions).toHaveLength(2);
  expect(submissions[1]).toEqual({ ids: ['w2', 'w1'], expectedVersion: 2 });
});

for(const executing of [false,true]) {
test(`直接排序冲突后必须重读再拖动：执行中 ${executing}`, async ({ page }) => {
  await mockApplication(page, []);
  let current = {...structuredClone(requirement),workItems:[{...workItem,...(executing?{status:"in_progress",actualStart:"2026-09-01"}:{})},secondWorkItem]};
  const submissions: Array<Record<string, unknown>> = [];
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: current }));
  await page.route('**/api/requirements/r1/reorder-work-items', (route) => {
    submissions.push(route.request().postDataJSON());
    if (submissions.length === 1) {
      current = { ...current, title: '后台调整后的需求', version: 2 };
      return route.fulfill({ status: 409, json: { error: '需求已变化', code: 'STALE_WRITE' } });
    }
    return route.fulfill({ json: current });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('tab', { name: /^工作项 / }).click();
  const editor = page.locator('.modal-card-workspace[role=dialog]');
  const drag = async () => {
    const handles = editor.getByRole('button', { name: /拖动.*调整顺序/ });
    const first = await handles.nth(0).boundingBox();
    const second = await handles.nth(1).boundingBox();
    await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2);
    await page.mouse.down();
    await page.mouse.move(second!.x + second!.width / 2, second!.y + second!.height / 2, { steps: 12 });
    await finishPointerDrag(page);
  };

  await drag();
  await expect.poll(() => submissions).toHaveLength(1);
  expect(submissions[0]).toEqual({ ids: ['w2', 'w1'], expectedVersion: 1 });
  await expect(editor.locator('.warning-banner')).toContainText('工作项顺序未保存，请重新读取需求后再拖动排序。');
  for (const handle of await editor.getByRole('button', { name: /拖动.*调整顺序/ }).all()) await expect(handle).toBeDisabled();
  await editor.getByRole('button', { name: '重新读取需求', exact: true }).click();
  await expect(editor.getByRole('button',{name:/拖动.*调整顺序/}).first()).toBeEnabled();
  await expect(editor.locator('.warning-banner')).toHaveCount(0);
  await drag();
  await expect.poll(() => submissions).toHaveLength(2);
  expect(submissions[1]).toEqual({ ids: ['w2', 'w1'], expectedVersion: 2 });
});
}

test('工作项顺序已落库但响应异常时核对完整顺序且不重复提交', async ({ page }) => {
  await mockApplication(page, []);
  let current = structuredClone(requirement);
  const submissions: Array<Record<string, unknown>> = [];
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: current }));
  await page.route('**/api/requirements/r1/reorder-work-items', (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    submissions.push(body);
    const ids = body.ids as string[];
    current = {
      ...current,
      version: 2,
      workItems: ids.map((id, index) => ({ ...current.workItems.find((item) => item.id === id)!, sortOrder: index, version: 2 })),
    };
    return route.fulfill({ status: 200, contentType: 'text/html', body: 'saved' });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('tab', { name: /^工作项 / }).click();
  const editor = page.locator('.modal-card-workspace[role=dialog]');
  const handles = editor.getByRole('button', { name: /拖动.*调整顺序/ });
  const first = await handles.nth(0).boundingBox();
  const second = await handles.nth(1).boundingBox();
  await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2);
  await page.mouse.down();
  await page.mouse.move(second!.x + second!.width / 2, second!.y + second!.height / 2, { steps: 12 });
  await finishPointerDrag(page);

  await expect(editor).toContainText('提交结果待核对');
  await expect(editor.locator('.work-arrangement-row').first()).toContainText('开发');
  await expect(editor.getByRole('button',{name:/拖动.*调整顺序/}).first()).toBeDisabled();
  expect(submissions).toHaveLength(1);
  expect(submissions[0].ids).toEqual(['w2', 'w1']);
});

test('排序被拒绝访问后关闭工作项设置', async ({ page }) => {
  await mockApplication(page, []);
  let denied = false;
  const executing = { ...requirement, workItems: [{ ...workItem, status: 'in_progress', actualStart: '2026-09-01' }, secondWorkItem] };
  await page.route('**/api/requirements/r1', (route) => denied
    ? route.fulfill({ status: 403, json: { error: '需求不可访问' } }) : route.fulfill({ json: executing }));
  await page.route('**/api/requirements/r1/reorder-work-items', (route) => {
    denied = true;
    return route.fulfill({ status: 403, json: { error: '不能调整顺序' } });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('tab', { name: /^工作项 / }).click();
  const handles = page.getByRole('button', { name: /拖动.*调整顺序/ });
  const first = await handles.nth(0).boundingBox();
  const second = await handles.nth(1).boundingBox();
  await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2);
  await page.mouse.down();
  await page.mouse.move(second!.x + second!.width / 2, second!.y + second!.height / 2, { steps: 12 });
  await finishPointerDrag(page);
  await expect(page.getByRole('status').filter({hasText:'需求不可访问'})).toBeVisible();
  await expect(page.locator('.work-arrangement-row,.work-create-row')).toHaveCount(0);

});

test('拖动期间工作项列表变化时取消当前排序且不提交', async ({ page }) => {
  await mockApplication(page, []);
  let current = { ...structuredClone(requirement), workItems: [{ ...workItem, status: 'in_progress', actualStart: '2026-09-01' }, secondWorkItem] };
  const submissions: Array<Record<string, unknown>> = [];
  await page.route('**/api/requirements/r1', (route) => route.fulfill({ json: current }));
  await page.route('**/api/requirements/r1/reorder-work-items', (route) => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ json: [] });
  });
  await page.goto('/requirements/r1');
  await page.getByRole('tab', { name: /^工作项 / }).click();
  const handles = page.getByRole('button', { name: /拖动.*调整顺序/ });
  const first = await handles.nth(0).boundingBox();
  const second = await handles.nth(1).boundingBox();
  await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2);
  await page.mouse.down();
  await page.mouse.move(second!.x + second!.width / 2, second!.y + second!.height / 2, { steps: 4 });
  current = { ...current, version: 2, workItems: [...current.workItems, { ...secondWorkItem, id: 'w3', title: '后台新增项', sortOrder: 2 }] };
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await expect(page.getByRole('button', { name: '拖动后台新增项调整顺序' })).toBeVisible();
  await finishPointerDrag(page);
  await expect(page.getByRole('dialog', { name: '调整工作项顺序', exact: true })).toHaveCount(0);
  expect(submissions).toHaveLength(0);
});

test("工作项使用统一拖动手柄调整顺序", async ({ page }, _testInfo) => {

  const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
  await mockApplication(page, patches);
  await page.goto("/requirements/r1");
  await page.getByRole('tab', { name: /^工作项 / }).click();

  const handles = page.getByRole("button", { name: /拖动.*调整顺序/ });
  await expect(handles).toHaveCount(2);
  await expect(page.getByRole("button", { name: /上移|下移/ })).toHaveCount(0);
  const first = await handles.nth(0).boundingBox();
  const second = await handles.nth(1).boundingBox();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  await page.mouse.move(first!.x + first!.width / 2, first!.y + first!.height / 2);
  await page.mouse.down();
  await page.mouse.move(second!.x + second!.width / 2, second!.y + second!.height / 2, { steps: 12 });
  await finishPointerDrag(page);

  await expect.poll(() => patches.find((entry) => entry.path.endsWith("/reorder-work-items"))?.body.ids).toEqual(["w2", "w1"]);
  await expect(page.locator(".work-arrangement-row").nth(0)).toContainText("开发");
});

test("流程编辑进入共享画布，工作项可选中并返回列表", async ({ page }) => {
  await mockApplication(page, []);
  await page.goto('/templates');
  await page.getByRole('button', {name:'编辑流程 研发流程'}).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(2);
  await page.locator('.react-flow__node').filter({hasText:'设计'}).click();
  await expect(page.getByLabel('元素名称')).toHaveValue('设计');
  await closeGraphProperties(page);
  await page.getByRole('button',{name:'返回流程列表'}).click();
  await expect(page.getByRole('button',{name:'编辑流程 研发流程'})).toBeVisible();
});

test("当前需求筛选同时排除已完成和已取消需求", async ({ page }) => {
  await mockApplication(page, []);
  const requirements = [
    { ...structuredClone(requirement), id: "r-active", title: "当前执行需求", status: "in_progress" as const },
    { ...structuredClone(requirement), id: "r-completed", title: "已经完成需求", status: "completed" as const },
    { ...structuredClone(requirement), id: "r-cancelled", title: "已经取消需求", status: "cancelled" as const },
  ];
  await mockGanttReport(page,()=>requirements.map(r=>({...r,executionMode:'direct',workItems:[]})));
  await page.goto('/?projectId=p1&workspaceView=progress&scopeType=project');
  await page.getByRole('button',{name:'展开全部',exact:true}).click();
  const rows=page.locator('.workspace-gantt-row.kind-requirement');
  await expect(rows).toHaveCount(3);
  await page.getByRole('button',{name:'筛选执行状态',exact:true}).click();
  await page.getByRole('button',{name:'尚未结束 排除已完成、已取消',exact:true}).click();
  await expect(rows).toHaveCount(1);await expect(rows).toContainText('当前执行需求');
  await page.getByRole('button',{name:'筛选执行状态',exact:true}).click();
  await page.getByRole('checkbox',{name:'进行中',exact:true}).uncheck();
  await page.getByRole('checkbox',{name:'未开始',exact:true}).uncheck();
  await page.getByRole('checkbox',{name:'已取消',exact:true}).check();
  await page.getByLabel('执行状态筛选').getByRole('button',{name:'关闭',exact:true}).click();
  await expect(rows).toHaveCount(1);await expect(rows).toContainText('已经取消需求');
});

test("问题详情切换记录后保留未提交的资料", async ({ page }, _testInfo) => {

  const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
  await mockApplication(page, patches, { issue: {
    dueDate: "2026-08-25",
    overdue: true,
    updates: [{
      id: "iu1", issueId: "i1", progress: 50, content: "历史进展内容应当可以完整滚动查看", eventType: "progress",
      createdByAccountId: "admin", createdByName: "管理员", createdAt: "2026-09-02T08:00:00.000Z", updatedAt: "2026-09-02T08:00:00.000Z",
    }],
  } });
  await page.goto("/issues");

  await expect(page.locator('.issue-data-row:first-child .issue-data-due .data-cell-secondary').filter({hasText:'已逾期'})).toBeVisible();
  await page.locator('.issue-title-button').click();
  const dialog=page.getByRole('dialog',{name:'问题详情'});
  await dialog.getByLabel("问题标题", { exact: true }).fill("保留中的问题草稿");
  await dialog.getByRole("tab", { name: /^记录 / }).click();
  await expect(dialog.locator('.issue-update-setting-row').first()).toContainText('历史进展内容应当可以完整滚动查看');
  await dialog.getByRole("tab", { name: "基本信息" }).click();
  await expect(dialog.getByLabel("问题标题", { exact: true })).toHaveValue("保留中的问题草稿");
});

test("问题范围在收起、展开和保存后使用一致名称", async ({ page }, _testInfo) => {

  const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
  await mockApplication(page, patches, { issue: { requirementId: null, requirementTitle: null, sourceRef: "DCIM-36" } });
  await page.goto("/issues");

  await expect(page.locator(".issue-data-scope .issue-scope")).toHaveText("DCIM-36");
  await page.locator(".issue-data-scope .inline-edit-trigger").click();
  const picker = page.locator(".inline-select-popover");
  await expect(picker.getByRole("option", { name: "公共问题", exact: true })).toBeVisible();
  await expect(picker.getByRole("option", { name: "DCIM-36", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(picker.getByText("公共问题 · DCIM-36", { exact: true })).toHaveCount(0);

  await picker.getByRole("option", { name: "公共问题", exact: true }).click();
  await expect.poll(() => patches.some((entry) => entry.path === "/api/issues/i1" && entry.body.requirementId === null && entry.body.sourceRef === null)).toBe(true);
  await expect(page.locator(".issue-data-scope .issue-scope")).toHaveText("公共问题");
});

test.describe("北京时间业务日期", () => {
  test.use({ timezoneId: "America/Los_Angeles" });

  test("内联日期选择器跨北京时间午夜更新今天", async ({ page }, _testInfo) => {

    await page.clock.install({ time: new Date("2026-09-05T15:59:30.000Z") });
    const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
    await mockApplication(page, patches);

    await page.goto("/requirements/r1");
    await page.getByRole('tab', { name: /^工作项 / }).click();
    await page.getByRole("button", { name: /计划开始：2026-09-01/ }).first().click();
    const popover = page.locator(".inline-date-popover");
    await expect(popover.getByRole("gridcell", { name: "2026-09-05" })).toHaveClass(/is-today/);

    await page.clock.fastForward(90_000);
    await expect(popover.getByRole("gridcell", { name: "2026-09-06" })).toHaveClass(/is-today/);
    await expect(popover.getByRole("gridcell", { name: "2026-09-05" })).not.toHaveClass(/is-today/);

    await popover.getByRole("button", { name: "今天", exact: true }).click();
    await popover.getByRole("button", { name: "保存", exact: true }).click();
    await expect.poll(() => patches.some((entry) => entry.path === "/api/work-items/w1" && entry.body.plannedStart === "2026-09-06")).toBe(true);
  });

  test("历史补录在跨北京时间午夜后即时解锁", async ({ page }, _testInfo) => {

    await page.clock.install({ time: new Date("2026-09-05T15:59:30.000Z") });
    await mockApplication(page, [], { workItem: { plannedStart: "2026-09-05", plannedEnd: "2026-09-06" } });

    await page.goto("/requirements/r1");
    await page.getByRole('tab',{name:/^工作项 /}).click();
    await page.getByRole("button", { name: "按期完成（历史补录）", exact: true }).first().click();
    const action = page.getByRole("dialog",{name:"按期完成（历史补录）",exact:true});
    await expect(action.getByRole("alert")).toHaveText("计划尚未结束，暂不能补录完成。");
    await expect(action.getByRole("button", { name: "确认补录完成", exact: true })).toBeDisabled();

    await page.clock.fastForward(90_000);
    await expect(action.getByRole("alert")).toHaveCount(0);
    await expect(action.getByRole("button", { name: "确认补录完成", exact: true })).toBeEnabled();
  });
});
