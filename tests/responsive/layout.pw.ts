import { expect, test, type Page } from "@playwright/test";

const routes = [
  "/",
  "/analytics",
  "/my-work",
  "/actions",
  "/requirements",
  "/issues",
  "/people",
  "/concurrency",
  "/projects",
  "/resources",
  "/accounts",
  "/archives",
  "/templates",
  "/project-settings",
  "/system",
  "/logs",
];

const internalScrollers = [
  ".project-gantt-scroll",
  ".requirement-gantt-scroll",
  ".human-matrix-scroll",
  ".table-panel",
  ".audit-table",
  ".modal-body",
].join(",");

async function loginAsAdmin(page: Page) {
  const response = await page.context().request.post("/api/login", {
    data: { username: "admin", password: "41_xc7q0qOjo4Inw!" },
  });
  expect(response.ok(), "响应式测试需要可用的管理员测试账号").toBe(true);
  const projects = await (await page.context().request.get("/api/projects")).json() as Array<{ id: string }>;
  if (!projects.length) {
    const created = await page.context().request.post("/api/projects", { data: { name: "响应式测试项目" } });
    expect(created.ok()).toBe(true);
  }
}

async function assertResponsiveLayout(page: Page, route: string) {
  await page.goto(route);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);

  const result = await page.evaluate((allowedScrollerSelector) => {
    const root = document.documentElement;
    const body = document.body;
    const visibleInViewport = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0
        && rect.height > 0
        && rect.bottom > 0
        && rect.top < innerHeight
        && rect.right > 0
        && rect.left < innerWidth
        && style.display !== "none"
        && style.visibility !== "hidden";
    };
    const insideInternalScroller = (element: Element) => Boolean(element.closest(allowedScrollerSelector));
    const describe = (element: Element) => {
      const text = (element.textContent || element.getAttribute("aria-label") || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 60);
      return `${element.tagName.toLowerCase()}.${String(element.className).replace(/\s+/g, ".").slice(0, 60)}:${text}`;
    };

    const escapedControls = [...document.querySelectorAll("button,input,select,textarea,a")]
      .filter(visibleInViewport)
      .filter((element) => !insideInternalScroller(element))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < -1 || rect.right > innerWidth + 1;
      })
      .map(describe);

    const clippedText = [...document.querySelectorAll("button,a,h1,h2,h3,label,th")]
      .filter(visibleInViewport)
      .filter((element) => !insideInternalScroller(element))
      .filter((element) => {
        const style = getComputedStyle(element);
        const intentionallyEllipsized = style.textOverflow === "ellipsis";
        return !intentionallyEllipsized && element.scrollWidth > element.clientWidth + 1;
      })
      .map(describe);

    const tinyText = [...document.querySelectorAll("a,button,label,p,small,span,strong,th,td")]
      .filter(visibleInViewport)
      .filter((element) => !insideInternalScroller(element))
      .filter((element) => (element.textContent || "").trim().length > 0)
      .filter((element) => Number.parseFloat(getComputedStyle(element).fontSize) < 12)
      .map((element) => `${describe(element)}@${getComputedStyle(element).fontSize}`);

    return {
      viewportWidth: root.clientWidth,
      pageWidth: Math.max(root.scrollWidth, body.scrollWidth),
      escapedControls,
      clippedText,
      tinyText,
    };
  }, internalScrollers);

  expect(
    result.pageWidth,
    `${route} must not create page-level horizontal scrolling`,
  ).toBeLessThanOrEqual(result.viewportWidth + 1);
  expect(result.escapedControls, `${route} has controls outside the viewport`).toEqual([]);
  expect(result.clippedText, `${route} has unintentionally clipped labels`).toEqual([]);
  expect(result.tinyText, `${route} contains text smaller than 12px`).toEqual([]);
}

test("all primary pages obey the responsive layout contract", async ({ page }) => {
  await loginAsAdmin(page);
  for (const route of routes) await assertResponsiveLayout(page, route);

  const projects = await (await page.context().request.get("/api/projects")).json() as Array<{ id: string }>;
  if (projects[0]?.id) {
    const response = await page.context().request.get(`/api/requirements?projectId=${encodeURIComponent(projects[0].id)}`);
    if (response.ok()) {
      const requirements = await response.json() as Array<{ id: string }>;
      if (requirements[0]?.id) {
        await assertResponsiveLayout(page, `/requirements/${requirements[0].id}`);
      }
    }
  }
});

test("the login dialog remains inside the viewport", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "用户登录" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const rect = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(rect).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.y).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(viewport!.width);
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(viewport!.height);
});

test("project members can be searched and added from project settings", async ({ page }) => {
  await loginAsAdmin(page);
  const candidateName = `界面候选${Date.now()}${Math.floor(Math.random() * 10_000)}`;
  const created = await page.context().request.post("/api/people", {
    data: { name: candidateName, jobTitle: "测试工程师" },
  });
  expect(created.ok(), "测试候选人员应创建成功").toBe(true);

  await page.goto("/project-settings");
  await page.getByRole("button", { name: "添加成员" }).click();
  const dialog = page.getByRole("dialog", { name: "添加项目成员" });
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder("搜索姓名或岗位").fill(candidateName);
  await dialog.getByRole("button", { name: new RegExp(candidateName) }).click();
  await dialog.getByRole("button", { name: "添加到项目" }).click();

  await expect(dialog).toBeHidden();
  await expect(page.locator(".project-member-row", { hasText: candidateName })).toBeVisible();
});

test("lightweight requirements and the action center remain usable", async ({ page }) => {
  await loginAsAdmin(page);
  const projects = await (await page.context().request.get("/api/projects")).json() as Array<{ id: string }>;
  const title = `响应式待规划需求-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const created = await page.context().request.post("/api/requirements", {
    data: { projectId: projects[0].id, title },
  });
  expect(created.ok(), "应允许仅填写标题创建待规划需求").toBe(true);

  await page.goto("/actions");
  await expect(page.getByRole("heading", { name: "异常行动中心" })).toBeVisible();
  await expect(page.locator(".action-item", { hasText: title })).toBeVisible();
  await page.getByLabel("行动原因").selectOption("planning");
  await expect(page.locator(".action-item", { hasText: title })).toContainText("待规划");

  await page.goto("/requirements");
  await page.getByRole("button", { name: "新建需求" }).click();
  const dialog = page.getByRole("dialog", { name: "新建需求" });
  await expect(dialog.getByLabel("需求标题")).toBeVisible();
  await expect(dialog.getByLabel("优先级")).toHaveValue("P2");
  await expect(dialog.getByLabel("需求负责人（可稍后指定）")).toBeVisible();
  await expect(dialog.getByLabel("流程设计")).toBeHidden();
  await expect(dialog.getByLabel("需求背景")).toBeHidden();
  await dialog.getByRole("button", { name: /立即规划/ }).click();
  await expect(dialog.getByLabel("流程设计")).toBeVisible();
  await dialog.getByRole("button", { name: /补充信息/ }).click();
  await expect(dialog.getByLabel("需求背景")).toBeVisible();

  const bounds = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(bounds).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.width);
});

test("analytics dashboard becomes a single column on mobile", async ({ page }) => {
  await loginAsAdmin(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/analytics");
  await page.waitForLoadState("networkidle");
  const layout = await page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>(".analytics-grid");
    const cards = [...document.querySelectorAll<HTMLElement>(".analytics-grid-item")].slice(0, 4);
    return {
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      gridWidth: Math.round(grid?.getBoundingClientRect().width || 0),
      cards: cards.map((card) => ({ width: Math.round(card.getBoundingClientRect().width), top: Math.round(card.getBoundingClientRect().top) })),
    };
  });
  expect(layout.overflow).toBe(false);
  expect(layout.cards).toHaveLength(4);
  expect(layout.cards.every((card) => card.width === layout.gridWidth)).toBe(true);
  expect(new Set(layout.cards.map((card) => card.top)).size).toBe(4);
});
