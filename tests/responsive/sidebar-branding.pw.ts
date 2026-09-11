import { expect, test } from "@playwright/test";

async function loginAsAdmin(page: import("@playwright/test").Page) {
  const response = await page.context().request.post("/api/login", {
    data: { username: "admin", password: "41_xc7q0qOjo4Inw!" },
  });
  expect(response.ok()).toBe(true);
  const projects = await (await page.context().request.get("/api/projects")).json() as Array<{ id: string }>;
  if (!projects.length) {
    const created = await page.context().request.post("/api/projects", { data: { name: "导航测试项目" } });
    expect(created.ok()).toBe(true);
  }
}

test('窄屏默认收起导航，选择页面后收起，桌面展开偏好不被改写', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('project-manage:sidebar-collapsed', 'false'));
  await page.reload();
  const sidebar = page.locator('.sidebar');
  await expect(sidebar).not.toHaveClass(/sidebar-collapsed/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(sidebar).toHaveClass(/sidebar-collapsed/);
  await page.getByRole('button', { name: '展开侧边栏', exact: true }).click();
  await expect(sidebar).not.toHaveClass(/sidebar-collapsed/);
  await sidebar.getByRole('link', { name: '需求管理', exact: true }).click();
  await expect(page).toHaveURL(/\/requirements$/);
  await expect(sidebar).toHaveClass(/sidebar-collapsed/);
  expect(await page.evaluate(() => localStorage.getItem('project-manage:sidebar-collapsed'))).toBe('false');
  const context = (await page.locator('.topbar-context').boundingBox())!;
  const actions = (await page.locator('.top-actions').boundingBox())!;
  expect(context.y + context.height).toBeLessThanOrEqual(actions.y + 1);
  expect((await page.locator('.topbar').boundingBox())?.height).toBe(88);
  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(sidebar).not.toHaveClass(/sidebar-collapsed/);
  expect((await page.locator('.topbar').boundingBox())?.height).toBe(64);
  await page.getByRole('button', { name: '收起侧边栏', exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('project-manage:sidebar-collapsed'))).toBe('true');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '展开侧边栏', exact: true }).click();
  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(sidebar).toHaveClass(/sidebar-collapsed/);
});

test("折叠侧边栏保留完整导航并共用同一品牌标识", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("project-manage:sidebar-collapsed", "false"));
  await page.reload();
  await expect(page.locator(".topbar-account-name")).toContainText("admin");

  const sidebar = page.locator(".sidebar");
  const logo = sidebar.locator(".brand-logo");
  const expandedLogo = await logo.boundingBox();
  expect(expandedLogo?.width).toBe(40);
  expect(expandedLogo?.height).toBe(40);
  const linkCount = await sidebar.locator(".sidebar-nav a").count();
  expect(linkCount).toBeGreaterThan(10);

  await page.getByRole("button", { name: "收起侧边栏" }).click();
  await expect(sidebar).toHaveClass(/sidebar-collapsed/);
  await expect(page.getByRole("button", { name: "展开侧边栏" })).toBeVisible();
  await expect(sidebar.locator(".sidebar-nav a")).toHaveCount(linkCount);
  const collapsedLogo = await logo.boundingBox();
  expect(collapsedLogo?.width).toBe(40);
  expect(collapsedLogo?.height).toBe(40);

  const requirements = sidebar.getByRole("link", { name: "需求管理" });
  await requirements.hover();
  await expect(page.getByRole("tooltip")).toContainText("需求管理");
  await expect(page.getByRole("tooltip")).toContainText("项目空间");
  await requirements.click();
  await expect(page).toHaveURL(/\/requirements$/);
  await expect(requirements).toHaveClass(/active/);
});

test("管理员可配置品牌并即时更新侧边栏", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/system");
  const panel = page.locator(".system-branding-panel");
  await expect(panel.getByRole("heading", { name: "品牌设置" })).toBeVisible();
  await panel.getByLabel("系统名称").fill("研发项目管理");
  await panel.getByLabel("系统简称").fill("RDM");
  await panel.locator('input[type="file"]').setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  });
  await panel.getByRole("button", { name: "保存品牌设置" }).click();
  await expect(panel).toContainText("品牌设置已保存");
  await expect(page.locator(".brand-name")).toHaveText("研发项目管理");
  await expect(page.locator(".sidebar .brand-logo img")).toBeVisible();
  await expect(page).toHaveTitle("研发项目管理");
  const favicon = page.locator('head link[rel~="icon"]');
  await expect(favicon).toHaveAttribute('href', /^data:image\/png;base64,/);
  expect(await favicon.evaluate(async element => {
    const image = new Image();
    image.src = (element as HTMLLinkElement).href;
    await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  })).toEqual([64, 64]);

  await panel.getByRole("button", { name: "恢复默认值" }).click();
  await panel.getByRole("button", { name: "保存品牌设置" }).click();
  await expect(page.locator(".brand-name")).toHaveText("项目管理");
  await expect(page.locator(".sidebar .brand-logo img")).toHaveAttribute("src", "/project-management-logo.png");
  await expect(favicon).toHaveAttribute('href', '/project-management-logo.png');
  await expect(page).toHaveTitle("项目管理");
  await expect(page.locator('head link[rel~="icon"]')).toHaveAttribute("href", "/project-management-logo.png");
});
