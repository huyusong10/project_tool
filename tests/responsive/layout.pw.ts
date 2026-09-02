import { expect, test, type Page } from "@playwright/test";

const routes = [
  "/",
  "/requirements",
  "/people",
  "/concurrency",
  "/projects",
  "/templates",
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

test("all primary pages obey the responsive layout contract", async ({ page, request }) => {
  for (const route of routes) await assertResponsiveLayout(page, route);

  const response = await request.get("/api/requirements");
  if (response.ok()) {
    const requirements = await response.json() as Array<{ id: string }>;
    if (requirements[0]?.id) {
      await assertResponsiveLayout(page, `/requirements/${requirements[0].id}`);
    }
  }
});

test("the login dialog remains inside the viewport", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "用户登录" }).click();
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
