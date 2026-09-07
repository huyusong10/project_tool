import { expect, test, type Page } from "@playwright/test";

async function loginAsAdmin(page: Page) {
  const response = await page.context().request.post("/api/login", {
    data: { username: "admin", password: "41_xc7q0qOjo4Inw!" },
  });
  expect(response.ok()).toBe(true);
}

async function createProject(page: Page, name: string) {
  const response = await page.context().request.post("/api/projects", { data: { name } });
  expect(response.ok()).toBe(true);
  return response.json() as Promise<{ id: string; defaultTemplateId: string }>;
}

async function selectProject(page: Page, name: string) {
  await page.locator(".project-switcher-button").click();
  await page.getByRole("option", { name }).click();
  await expect(page.locator(".project-switcher-name")).toHaveText(name);
}

test("project selection persists and respects page scope", async ({ page }) => {
  await loginAsAdmin(page);
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const firstName = `项目选择甲-${suffix}`;
  const secondName = `项目选择乙-${suffix}`;
  const first = await createProject(page, firstName);
  const second = await createProject(page, secondName);

  await page.goto("/");
  await selectProject(page, firstName);
  await page.reload();
  await expect(page.locator(".project-switcher-name")).toHaveText(firstName);
  const dashboardSwitcherLeft = await page.locator(".project-switcher").evaluate((element) => element.getBoundingClientRect().left);

  await page.goto("/my-work");
  await expect(page.locator(".project-scope-indicator")).toHaveText("跨项目");
  await expect(page.locator(".project-switcher-button")).toHaveCount(0);

  await page.goto("/projects");
  await expect(page.locator(".project-scope-indicator")).toHaveText("平台范围");
  await expect(page.locator(".project-switcher-button")).toHaveCount(0);

  await page.goto("/issues?status=in_progress&ownerId=old-person&requirementId=old-requirement&issueId=old-issue");
  await selectProject(page, secondName);
  const params = new URL(page.url()).searchParams;
  expect(params.get("status")).toBe("in_progress");
  expect(params.has("ownerId")).toBe(false);
  expect(params.has("requirementId")).toBe(false);
  expect(params.has("issueId")).toBe(false);

  const requirementTitle = `非常长的需求详情标题用于验证顶栏项目切换位置保持稳定-${suffix}`;
  const requirementResponse = await page.context().request.post("/api/requirements", {
    data: {
      projectId: first.id,
      title: requirementTitle,
      priority: "P2",
      plannedStart: "2026-09-03",
      templateId: first.defaultTemplateId,
    },
  });
  expect(requirementResponse.ok()).toBe(true);
  const requirement = await requirementResponse.json() as { id: string };
  const issueTitle = `跨项目问题详情-${suffix}`;
  const issueResponse = await page.context().request.post("/api/issues", {
    data: { projectId: first.id, requirementId: requirement.id, title: issueTitle },
  });
  expect(issueResponse.ok()).toBe(true);
  const issue = await issueResponse.json() as { id: string };
  const oldPersonResponse = await page.context().request.post("/api/people", {
    data: { projectId: second.id, name: `旧项目负责人-${suffix}` },
  });
  expect(oldPersonResponse.ok()).toBe(true);
  const oldPerson = await oldPersonResponse.json() as { id: string };
  const oldRequirementResponse = await page.context().request.post("/api/requirements", {
    data: { projectId: second.id, title: `旧项目筛选需求-${suffix}` },
  });
  expect(oldRequirementResponse.ok()).toBe(true);
  const oldRequirement = await oldRequirementResponse.json() as { id: string };

  await page.goto(`/requirements/${requirement.id}`);
  await expect(page.locator(".project-switcher-name")).toHaveText(firstName);
  await expect(page.locator(".integrated-page-title h1")).toHaveAttribute("title", requirementTitle);
  const detailSwitcherLeft = await page.locator(".project-switcher").evaluate((element) => element.getBoundingClientRect().left);
  expect(Math.abs(detailSwitcherLeft - dashboardSwitcherLeft)).toBeLessThanOrEqual(1);
  expect(await page.locator(".integrated-page-title h1").evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await selectProject(page, secondName);
  await expect(page).toHaveURL(/\/requirements$/);
  await expect(page.locator(".project-switcher-name")).toHaveText(secondName);

  await page.goto(`/issues?issueId=${issue.id}&ownerId=${oldPerson.id}&requirementId=${oldRequirement.id}`);
  await expect(page.locator(".project-switcher-name")).toHaveText(firstName);
  await expect(page.getByRole("dialog", { name: "问题详情" }).getByRole("heading", { name: issueTitle })).toBeVisible();
  await expect.poll(() => {
    const query = new URL(page.url()).searchParams;
    return { issueId: query.get("issueId"), owner: query.has("ownerId"), requirement: query.has("requirementId") };
  }).toEqual({ issueId: issue.id, owner: false, requirement: false });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "问题详情" })).toBeHidden();
  await expect(page.locator(".issue-title-button", { hasText: issueTitle })).toBeVisible();

  expect(second.id).not.toBe(first.id);
});
