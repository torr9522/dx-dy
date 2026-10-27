import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";

const password = "Synthetic-e2e-password-123!";
const businessPaths = new Set([
  "/api/nodes",
  "/api/subscriptions",
  "/api/settings",
  "/api/node-groups",
]);
const fixtureGroupIds: number[] = [];
const fixtureSubscriptionIds: number[] = [];

async function submitLogin(page: Page) {
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "安全登录", exact: true }).click();
}

async function expectReady(page: Page) {
  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
  await expect(page.locator(".shell")).toBeVisible();
}

async function seedBootstrapFixture(context: BrowserContext) {
  const me = await context.request.get("/api/auth/me");
  const { csrf } = await me.json();
  const headers = { "X-CSRF-Token": csrf };
  const groups: { id: number }[] = [];
  for (const suffix of ["A", "B"])
    groups.push(
      await (
        await context.request.post("/api/node-groups", {
          headers,
          data: { name: `D033-BOOTSTRAP-${suffix}` },
        })
      ).json(),
    );
  fixtureGroupIds.push(...groups.map((group) => group.id));
  for (const [groupIndex, group] of groups.entries())
    await context.request.post("/api/nodes/import", {
      headers,
      data: {
        group_id: group.id,
        items: Array.from({ length: 5 }, (_, index) => ({
          uri: `vless://33333333-3333-4333-8333-${String(groupIndex * 5 + index + 1).padStart(12, "0")}@d033-${groupIndex}-${index}.example.com:443?encryption=none&security=tls&type=tcp#D033`,
        })),
      },
    });
  for (const suffix of ["A", "B", "C"]) {
    const response = await context.request.post("/api/subscriptions", {
      headers,
      data: { name: `D033-BOOTSTRAP-${suffix}` },
    });
    fixtureSubscriptionIds.push(Number((await response.json()).id));
  }
}

async function removeBootstrapFixture(context: BrowserContext) {
  const me = await context.request.get("/api/auth/me");
  const { csrf } = await me.json();
  const headers = { "X-CSRF-Token": csrf };
  for (const subscriptionId of fixtureSubscriptionIds) {
    const response = await context.request.delete(
      `/api/subscriptions/${subscriptionId}`,
      {
        headers,
        data: {},
      },
    );
    expect(response.ok()).toBe(true);
  }
  for (const groupId of fixtureGroupIds) {
    const response = await context.request.delete(
      `/api/node-groups/${groupId}`,
      {
        headers,
        data: { confirm: true },
      },
    );
    expect(response.ok()).toBe(true);
  }
  fixtureSubscriptionIds.length = 0;
  fixtureGroupIds.length = 0;
}

test("AUTH-BOOT-001/002 fresh login waits for atomic business data", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/**", async (route) => {
    if (businessPaths.has(new URL(route.request().url()).pathname)) await gate;
    await route.continue();
  });

  await page.goto("/");
  await submitLogin(page);
  await expect(page.getByText("正在加载工作空间…")).toBeVisible();
  await expect(page.locator(".shell")).toHaveCount(0);
  await expect(page.getByText(/0 个节点|0 个分组|0 份订阅/)).toHaveCount(0);

  release();
  await expectReady(page);
});

test("AUTH-BOOT-003 logout and login does not expose stale empty state", async ({
  page,
}) => {
  await page.goto("/");
  await submitLogin(page);
  await expectReady(page);
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(
    page.getByRole("heading", { name: "登录管理后台" }),
  ).toBeVisible();

  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/**", async (route) => {
    if (businessPaths.has(new URL(route.request().url()).pathname)) await gate;
    await route.continue();
  });
  await submitLogin(page);
  await expect(page.getByText("正在加载工作空间…")).toBeVisible();
  await expect(page.locator(".shell")).toHaveCount(0);
  release();
  await expectReady(page);
});

test("AUTH-BOOT-004 slow session probe remains a data-loading state", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "登录管理后台" }),
  ).toBeVisible();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let holdSession = true;
  await page.route("**/api/auth/me", async (route) => {
    if (holdSession) await gate;
    await route.continue();
  });
  await submitLogin(page);
  await expect(page.getByText("正在加载工作空间…")).toBeVisible();
  await expect(page.locator(".shell")).toHaveCount(0);
  holdSession = false;
  release();
  await expectReady(page);
});

test("AUTH-BOOT-005 slow nodes never renders a zero-node shell", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/nodes", async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto("/");
  await submitLogin(page);
  await expect(page.getByText("正在加载工作空间…")).toBeVisible();
  await expect(page.locator(".shell")).toHaveCount(0);
  release();
  await expectReady(page);
});

test("AUTH-BOOT-006 initial business 401 returns to authentication", async ({
  page,
}) => {
  await page.route("**/api/nodes", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "UNAUTHORIZED", message: "会话已过期" },
      }),
    }),
  );
  await page.goto("/");
  await submitLogin(page);
  await expect(
    page.getByRole("heading", { name: "登录管理后台" }),
  ).toBeVisible();
  await expect(page.locator(".shell")).toHaveCount(0);
});

test("AUTH-BOOT-007 business 500 shows error and retry, not empty data", async ({
  page,
}) => {
  const fail = async (route: Route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "INTERNAL", message: "Synthetic bootstrap failure" },
      }),
    });
  await page.route("**/api/nodes", fail);
  await page.goto("/");
  await submitLogin(page);
  await expect(
    page.getByRole("heading", { name: "数据加载失败" }),
  ).toBeVisible();
  await expect(page.getByText("Synthetic bootstrap failure")).toBeVisible();
  await expect(page.locator(".shell")).toHaveCount(0);

  await page.unroute("**/api/nodes", fail);
  await page.getByRole("button", { name: "重试" }).click();
  await expectReady(page);
});

test("AUTH-BOOT-008 one network abort is recovered without false empty", async ({
  page,
}) => {
  let aborted = false;
  await page.route("**/api/nodes", async (route) => {
    if (!aborted) {
      aborted = true;
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });
  await page.goto("/");
  await submitLogin(page);
  await expectReady(page);
  expect(aborted).toBe(true);
  await expect(page.getByText(/0 个节点|0 个分组|0 份订阅/)).toHaveCount(0);
});

test("AUTH-BOOT-009/010 valid refresh restores data and expired session returns login", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await submitLogin(page);
  await expectReady(page);
  await page.reload();
  await expectReady(page);

  const me = await context.request.get("/api/auth/me");
  const { csrf } = await me.json();
  await context.request.post("/api/auth/logout", {
    headers: { "X-CSRF-Token": csrf },
    data: {},
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "登录管理后台" }),
  ).toBeVisible();
  await expect(page.locator(".shell")).toHaveCount(0);
});

test("CONNECT-001/006 cold bootstrap blocks authenticated refresh until ready", async ({
  page,
}) => {
  await page.goto("/");
  await submitLogin(page);
  await expectReady(page);

  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/auth/me", async (route) => {
    await gate;
    await route.continue();
  });
  await page.reload();
  await expect(page.getByText("正在连接 dx-dy…")).toBeVisible();
  await expect(page.locator(".shell")).toHaveCount(0);
  release();
  await expectReady(page);
});

test("CONNECT-004/005 unavailable bootstrap becomes retryable error", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/api/auth/me", async (route) => {
    if (fail) {
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "连接服务器失败" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
  await expect(page.locator(".shell")).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "重试" }).click();
  await expect(
    page.getByRole("heading", { name: "登录管理后台" }),
  ).toBeVisible();
});

test("AUTH-BOOT-011 50 fresh-context logins never expose false empty", async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const baseURL = String(testInfo.project.use.baseURL);
  let falseEmpty = 0;

  for (let cycle = 0; cycle < 50; cycle += 1) {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/nodes", async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto("/");
    await submitLogin(page);
    await expect(page.getByText("正在加载工作空间…")).toBeVisible();
    if (await page.locator(".shell").count()) falseEmpty += 1;
    release();
    await expectReady(page);
    if (cycle === 0) await seedBootstrapFixture(context);
    await page.getByRole("button", { name: "退出登录" }).click();
    await expect(
      page.getByRole("heading", { name: "登录管理后台" }),
    ).toBeVisible();
    await context.close();
  }
  expect(falseEmpty).toBe(0);
});

test("AUTH-BOOT-012 20 logout/login cycles never expose false empty", async ({
  page,
}) => {
  test.setTimeout(120_000);
  let falseEmpty = 0;
  let gate = Promise.resolve();
  await page.route("**/api/nodes", async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto("/");

  for (let cycle = 0; cycle < 20; cycle += 1) {
    let release!: () => void;
    gate = new Promise<void>((resolve) => (release = resolve));
    await submitLogin(page);
    await expect(page.getByText("正在加载工作空间…")).toBeVisible();
    if (await page.locator(".shell").count()) falseEmpty += 1;
    release();
    await expectReady(page);
    await page.getByRole("button", { name: "退出登录" }).click();
    await expect(
      page.getByRole("heading", { name: "登录管理后台" }),
    ).toBeVisible();
  }
  expect(falseEmpty).toBe(0);
});

test("AUTH-BOOT navigation and refresh remains ready for 20 cycles", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await submitLogin(page);
  await expectReady(page);

  for (let cycle = 0; cycle < 20; cycle += 1) {
    await page.getByRole("link", { name: "节点库", exact: true }).click();
    await expect(page.locator(".group-nav-row")).toHaveCount(2);
    await page.getByRole("link", { name: "订阅", exact: true }).click();
    await expect(page.locator(".subscription-row")).toHaveCount(3);
    await page.reload();
    await expect(page).toHaveURL(/\/subscriptions$/);
    await expect(page.locator(".subscription-row")).toHaveCount(3);
  }
  await removeBootstrapFixture(context);
});
