import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";

const password = "Synthetic-e2e-password-123!";
let groupId = 0;
let subscriptionId = 0;
const subscriptionName = "D035-ROUTER-Subscription";

async function submitLogin(page: Page) {
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "安全登录", exact: true }).click();
}

async function loginAt(page: Page, path = "/") {
  await page.goto(path);
  await submitLogin(page);
  await expect(page.locator(".shell")).toBeVisible();
}

async function csrf(context: BrowserContext) {
  const response = await context.request.get("/api/auth/me");
  return { "X-CSRF-Token": String((await response.json()).csrf) };
}

test.describe.serial("v0.3.5 route navigation", () => {
  test.beforeAll(async ({ browser }, testInfo) => {
    const context = await browser.newContext({
      baseURL: String(testInfo.project.use.baseURL),
    });
    const login = await context.request.post("/api/auth/login", {
      data: { username: "admin", password },
    });
    expect(login.ok()).toBe(true);
    const headers = await csrf(context);
    const group = await context.request.post("/api/node-groups", {
      headers,
      data: { name: "D035-ROUTER-Group" },
    });
    groupId = Number((await group.json()).id);
    const subscription = await context.request.post("/api/subscriptions", {
      headers,
      data: { name: subscriptionName },
    });
    subscriptionId = Number((await subscription.json()).id);
    await context.close();
  });

  test.afterAll(async ({ browser }, testInfo) => {
    const context = await browser.newContext({
      baseURL: String(testInfo.project.use.baseURL),
    });
    await context.request.post("/api/auth/login", {
      data: { username: "admin", password },
    });
    const headers = await csrf(context);
    await context.request.delete(`/api/subscriptions/${subscriptionId}`, {
      headers,
      data: {},
    });
    await context.request.delete(`/api/node-groups/${groupId}`, {
      headers,
      data: { confirm: true },
    });
    await context.close();
  });

  test("ROUTE-001 root loads Dashboard", async ({ page }) => {
    await loginAt(page);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
  });

  test("ROUTE-002/003 nodes direct load and refresh preserve content", async ({
    page,
  }) => {
    await loginAt(page, "/nodes");
    await expect(page).toHaveURL(/\/nodes$/);
    await expect(page.getByRole("heading", { name: "节点库" })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/\/nodes$/);
    await expect(page.locator(".node-library")).toBeVisible();
    await page.getByRole("button", { name: /^D035-ROUTER-Group \d+$/ }).click();
    await expect(page).toHaveURL(new RegExp(`/nodes/groups/${groupId}$`));
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/nodes/groups/${groupId}$`));
    await expect(
      page.getByRole("heading", { name: "D035-ROUTER-Group" }),
    ).toBeVisible();
  });

  test("ROUTE-004/005 subscriptions direct load and refresh preserve list", async ({
    page,
  }) => {
    await loginAt(page, "/subscriptions");
    await expect(page).toHaveURL(/\/subscriptions$/);
    await expect(
      page.getByText(subscriptionName, { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/\/subscriptions$/);
    await expect(
      page.getByText(subscriptionName, { exact: true }),
    ).toBeVisible();
  });

  test("ROUTE-006/007 subscription detail direct load and refresh keep stable ID", async ({
    page,
  }) => {
    const path = `/subscriptions/${subscriptionId}`;
    await loginAt(page, path);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByLabel("名称", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByLabel("名称", { exact: true })).toBeVisible();
  });

  test("ROUTE-008/009 browser Back and Forward replay route and page", async ({
    page,
  }) => {
    await loginAt(page);
    await page.getByRole("link", { name: "节点库" }).click();
    await expect(page).toHaveURL(/\/nodes$/);
    await page.getByRole("link", { name: "订阅" }).click();
    await page
      .locator(".subscription-row", { hasText: subscriptionName })
      .getByRole("button", { name: "管理订阅" })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/subscriptions/${subscriptionId}$`),
    );
    await page.getByRole("link", { name: "设置" }).click();
    await expect(page).toHaveURL(/\/settings$/);

    await page.goBack();
    await expect(page).toHaveURL(
      new RegExp(`/subscriptions/${subscriptionId}$`),
    );
    await expect(page.getByLabel("名称", { exact: true })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/subscriptions$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/nodes$/);
    await page.goForward();
    await expect(page).toHaveURL(/\/subscriptions$/);
    await page.goForward();
    await expect(page).toHaveURL(
      new RegExp(`/subscriptions/${subscriptionId}$`),
    );
    await page.goForward();
    await expect(page).toHaveURL(/\/settings$/);
  });

  test("ROUTE-010/011 copied deep link opens same subscription in new tab", async ({
    page,
    context,
  }) => {
    const path = `/subscriptions/${subscriptionId}`;
    await loginAt(page, path);
    const deepLink = page.url();
    const newTab = await context.newPage();
    await newTab.goto(deepLink);
    await expect(newTab).toHaveURL(new RegExp(`${path}$`));
    await expect(newTab.getByLabel("名称", { exact: true })).toBeVisible();
  });

  test("ROUTE-012 unknown subscription is resource Not Found", async ({
    page,
  }) => {
    await loginAt(page, "/subscriptions/999999999");
    await expect(
      page.getByRole("heading", { name: "订阅不存在" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/subscriptions\/999999999$/);
  });

  test("ROUTE-013 unknown route renders explicit 404", async ({ page }) => {
    await loginAt(page, "/abc/def/not-real");
    await expect(
      page.getByRole("heading", { name: "404 · 页面不存在" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/abc\/def\/not-real$/);
  });

  test("ROUTE-014/015 unauthenticated deep link returns after login", async ({
    page,
  }) => {
    const path = `/subscriptions/${subscriptionId}`;
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "登录管理后台" }),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await submitLogin(page);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByLabel("名称", { exact: true })).toBeVisible();
  });

  test("ROUTE-016 logout and browser Back cannot expose protected content", async ({
    page,
  }) => {
    await loginAt(page, "/subscriptions");
    await page
      .locator(".subscription-row", { hasText: subscriptionName })
      .getByRole("button", { name: "管理订阅" })
      .click();
    await page.getByRole("button", { name: "退出登录" }).click();
    await expect(
      page.getByRole("heading", { name: "登录管理后台" }),
    ).toBeVisible();
    await page.goBack();
    await expect(
      page.getByRole("heading", { name: "登录管理后台" }),
    ).toBeVisible();
    await expect(page.locator(".shell")).toHaveCount(0);
  });

  test("ROUTE-017 slow API keeps deep link without false empty", async ({
    page,
  }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/nodes", async (route) => {
      await gate;
      await route.continue();
    });
    const path = `/subscriptions/${subscriptionId}`;
    await page.goto(path);
    await submitLogin(page);
    await expect(page.getByText("正在加载工作空间…")).toBeVisible();
    await expect(page.locator(".shell")).toHaveCount(0);
    release();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByLabel("名称", { exact: true })).toBeVisible();
  });

  test("ROUTE-018 initial 401 preserves deep link behind auth gate", async ({
    page,
  }) => {
    await page.route("**/api/nodes", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "UNAUTHORIZED", message: "expired" },
        }),
      }),
    );
    const path = `/subscriptions/${subscriptionId}`;
    await page.goto(path);
    await submitLogin(page);
    await expect(
      page.getByRole("heading", { name: "登录管理后台" }),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
  });

  test("ROUTE-019 initial 500 shows error at original deep link", async ({
    page,
  }) => {
    const fail = (route: Route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "INTERNAL", message: "D035 synthetic failure" },
        }),
      });
    await page.route("**/api/nodes", fail);
    const path = `/subscriptions/${subscriptionId}`;
    await page.goto(path);
    await submitLogin(page);
    await expect(
      page.getByRole("heading", { name: "数据加载失败" }),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
  });

  test("ROUTE-020 twenty refreshes never lose subscription route", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const path = `/subscriptions/${subscriptionId}`;
    await loginAt(page, path);
    for (let cycle = 0; cycle < 20; cycle += 1) {
      await page.reload();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByLabel("名称", { exact: true })).toBeVisible();
    }
  });

  test("twenty fresh-context deep-link logins never lose route or show false empty", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(120_000);
    const baseURL = String(testInfo.project.use.baseURL);
    const path = `/subscriptions/${subscriptionId}`;
    let routeLost = 0;
    let falseEmpty = 0;
    for (let cycle = 0; cycle < 20; cycle += 1) {
      const context = await browser.newContext({ baseURL });
      const page = await context.newPage();
      await page.goto(path);
      await submitLogin(page);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByLabel("名称", { exact: true })).toHaveValue(
        subscriptionName,
      );
      if (new URL(page.url()).pathname !== path) routeLost += 1;
      if (await page.getByText(/0 个节点|0 个分组|0 份订阅/).count())
        falseEmpty += 1;
      await context.close();
    }
    expect(routeLost).toBe(0);
    expect(falseEmpty).toBe(0);
  });
});
