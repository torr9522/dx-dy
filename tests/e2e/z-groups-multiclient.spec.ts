import { test, expect, type Page } from "@playwright/test";
import { existsSync, chmodSync } from "node:fs";

const authState = "test-results/regression-auth.json";
test.use({ storageState: authState });
test.beforeAll(async ({ browser }) => {
  if (existsSync(authState)) return;
  const page = await browser.newPage({
    baseURL: "http://127.0.0.1:3100",
    storageState: undefined,
  });
  await page.goto("/");
  await page
    .getByLabel("密码", { exact: true })
    .fill("Synthetic-e2e-password-123!");
  await page.getByRole("button", { name: "安全登录" }).click();
  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
  await page.context().storageState({ path: authState });
  chmodSync(authState, 0o600);
  await page.close();
});

async function createGroup(page: Page, name: string) {
  await page.getByRole("button", { name: "新建分组", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "创建分组" });
  await dialog.getByLabel("分组名称").fill(name);
  await dialog.getByRole("button", { name: "保存分组" }).click();
  await expect(dialog).not.toBeVisible();
}
async function importNodes(page: Page, names: string[]) {
  await page.getByRole("button", { name: "添加 / 批量添加节点" }).click();
  const dialog = page.getByRole("dialog", { name: "粘贴节点链接" });
  await dialog
    .getByLabel("节点链接", { exact: true })
    .fill(
      names
        .map(
          (name, i) =>
            `trojan://synthetic-group-${i}@group.example.test:${4400 + i}?sni=group.example.test#${name}`,
        )
        .join("\n"),
    );
  await dialog.getByRole("button", { name: "解析预览", exact: true }).click();
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

test("existing subscription selection cannot open before persisted entries load", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
  await page.getByRole("button", { name: "节点库", exact: true }).click();
  const group = "D029-DESTRUCT-Load-Race";
  const names = ["D029-DESTRUCT-Load-A", "D029-DESTRUCT-Load-B"];
  await createGroup(page, group);
  await importNodes(page, names);
  await page.getByRole("button", { name: "订阅", exact: true }).click();
  await page.getByRole("button", { name: "创建订阅", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "创建订阅" });
  await dialog.getByLabel("订阅名称").fill(group);
  await dialog.getByRole("button", { name: "创建订阅", exact: true }).click();
  const subscription = (
    await (await context.request.get("/api/subscriptions")).json()
  ).find((s: { name: string }) => s.name === group);
  const row = page.locator(".subscription-row").filter({ hasText: group });
  await row.getByRole("button", { name: "管理订阅", exact: true }).click();
  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  await page.getByRole("button", { name: /从节点库选择节点/ }).click();
  await page
    .getByLabel("节点来源")
    .getByRole("button", { name: new RegExp(`^${group}\\s`) })
    .click();
  await page
    .getByRole("checkbox", { name: `选择订阅节点 ${names[0]}`, exact: true })
    .check();
  await page.getByRole("button", { name: "保存并返回", exact: true }).click();
  await expect(page.locator(".subscription-node-row")).toHaveCount(1);
  await page.getByRole("button", { name: "返回订阅列表", exact: true }).click();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let intercepted = false;
  await page.route(
    `**/api/subscriptions/${subscription.id}/entries`,
    async (route) => {
      if (!intercepted) {
        intercepted = true;
        await held;
      }
      await route.continue();
    },
  );
  try {
    await row.getByRole("button", { name: "管理订阅", exact: true }).click();
    await expect.poll(() => intercepted).toBe(true);
    await expect(
      page.getByRole("button", { name: "添加节点", exact: true }),
    ).not.toBeVisible();
    await expect(
      page.getByText("正在读取订阅节点…", { exact: true }),
    ).toBeVisible();
  } finally {
    release();
  }
  await expect(page.locator(".subscription-node-row")).toHaveCount(1);
  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  await page.getByRole("button", { name: /从节点库选择节点/ }).click();
  await page
    .getByLabel("节点来源")
    .getByRole("button", { name: new RegExp(`^${group}\\s`) })
    .click();
  await expect(
    page.getByRole("checkbox", {
      name: `选择订阅节点 ${names[0]}`,
      exact: true,
    }),
  ).toBeChecked();
  await page
    .getByRole("checkbox", { name: `选择订阅节点 ${names[1]}`, exact: true })
    .check();
  await page.getByRole("button", { name: "保存并返回", exact: true }).click();
  await expect(page.locator(".subscription-node-row")).toHaveCount(2);
  await page.reload();
  const entries = await (
    await context.request.get(`/api/subscriptions/${subscription.id}/entries`)
  ).json();
  expect(
    entries.map((entry: { node: { name: string } }) => entry.node.name),
  ).toEqual(names);
  await page.getByRole("button", { name: "订阅", exact: true }).click();
  await page.unroute(`**/api/subscriptions/${subscription.id}/entries`);
  let failOnce = true;
  await page.route(
    `**/api/subscriptions/${subscription.id}/entries`,
    async (route) => {
      if (failOnce) {
        failOnce = false;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "TEMPORARY", message: "Synthetic read unavailable" },
          }),
        });
      } else await route.continue();
    },
  );
  await row.getByRole("button", { name: "管理订阅", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("无法读取订阅节点");
  await expect(
    page.getByRole("button", { name: "添加节点", exact: true }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(page.locator(".subscription-node-row")).toHaveCount(2);
  expect(
    (
      await (
        await context.request.get(
          `/api/subscriptions/${subscription.id}/entries`,
        )
      ).json()
    ).map((entry: { node: { name: string } }) => entry.node.name),
  ).toEqual(names);
});

for (const width of [1440, 768, 390]) {
  test(`isolated Groups, independent copy, multi-group draft and client links at ${width}`, async ({
    page,
    context,
  }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 900 });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
    await page.getByRole("button", { name: "节点库", exact: true }).click();
    const prefix = `G029-${width}`;
    const groups = [1, 2, 3].map((n) => `${prefix}-${n}`);
    const names = ["A", "B", "C"].map((n) => `${prefix}-${n}`);
    await createGroup(page, groups[0]);
    await importNodes(page, names);
    await createGroup(page, groups[1]);
    await expect(page.locator(".node-library tbody tr")).toHaveCount(0);
    await importNodes(page, names.slice(0, 2));
    await page
      .getByRole("button", { name: "从其他分组添加", exact: true })
      .click();
    const copy = page.getByRole("dialog", { name: "从其他分组添加" });
    const groupData = await (
      await context.request.get("/api/node-groups")
    ).json();
    const firstGroup = groupData.find(
      (g: { name: string }) => g.name === groups[0],
    );
    await copy.getByLabel("来源分组").selectOption(String(firstGroup.id));
    for (const name of names.slice(0, 2))
      await expect(
        copy.getByRole("checkbox", { name: `复制 ${name}`, exact: true }),
      ).toBeDisabled();
    await copy
      .getByRole("checkbox", { name: `复制 ${names[2]}`, exact: true })
      .check();
    await copy.getByRole("button", { name: "确认复制" }).click();
    await expect(copy).not.toBeVisible();
    await expect(page.locator(".node-library tbody tr")).toHaveCount(3);
    await createGroup(page, groups[2]);
    await importNodes(page, names.slice(0, 1));
    const records = await (await context.request.get("/api/nodes")).json();
    const selected = records.filter(
      (n: { name: string; group_name: string }) =>
        n.name === names[0] && groups.includes(n.group_name),
    );
    expect(selected).toHaveLength(3);
    expect(new Set(selected.map((n: { id: number }) => n.id)).size).toBe(3);
    await page.getByRole("button", { name: "订阅", exact: true }).click();
    await page.getByRole("button", { name: "创建订阅", exact: true }).click();
    const create = page.getByRole("dialog", { name: "创建订阅" });
    await create.getByLabel("订阅名称").fill(prefix);
    await create.getByRole("button", { name: "创建订阅", exact: true }).click();
    const row = page.locator(".subscription-row").filter({ hasText: prefix });
    await row.getByRole("button", { name: "管理订阅" }).click();
    await page.getByRole("button", { name: "添加节点", exact: true }).click();
    await page.getByRole("button", { name: /从节点库选择节点/ }).click();
    for (const group of groups) {
      await page
        .getByLabel("节点来源")
        .getByRole("button", { name: new RegExp(`^${group}\\s`) })
        .click();
      await page
        .getByRole("checkbox", {
          name: `选择订阅节点 ${names[0]}`,
          exact: true,
        })
        .check();
    }
    await page.getByRole("button", { name: "保存并返回" }).click();
    await expect(page.locator(".subscription-node-row")).toHaveCount(3);
    for (const group of groups)
      await expect(
        page.locator(".subscription-node-row").filter({ hasText: group }),
      ).toHaveCount(1);
    // Switching Groups and abandoning a new candidate must not write it.
    await page.getByRole("button", { name: "添加节点", exact: true }).click();
    await page.getByRole("button", { name: /从节点库选择节点/ }).click();
    await page
      .getByLabel("节点来源")
      .getByRole("button", { name: new RegExp(`^${groups[0]}\\s`) })
      .click();
    await page
      .getByRole("checkbox", { name: `选择订阅节点 ${names[1]}`, exact: true })
      .check();
    await page.getByRole("button", { name: "返回", exact: true }).click();
    await page
      .getByRole("dialog", { name: "放弃未保存更改？" })
      .getByRole("button", { name: "确认", exact: true })
      .click();
    await page.getByRole("button", { name: "返回订阅", exact: true }).click();
    await expect(page.locator(".subscription-node-row")).toHaveCount(3);
    await page.getByRole("button", { name: "订阅", exact: true }).click();
    await row.getByRole("button", { name: "多客户端", exact: true }).click();
    const clients = page.getByRole("dialog", { name: "多客户端订阅" });
    await expect(
      clients.getByText("兼容 3/3", { exact: false }).first(),
    ).toBeVisible();
    await clients
      .getByRole("button", { name: "复制智能订阅", exact: true })
      .click();
    const smart = await page.evaluate(() => navigator.clipboard.readText());
    const generic = await context.request.get(smart, {
      headers: { "User-Agent": "unknown" },
    });
    expect(
      Buffer.from(await generic.text(), "base64")
        .toString()
        .split("\n"),
    ).toHaveLength(3);
    const mihomo = await context.request.get(smart, {
      headers: { "User-Agent": "clash-verge/v2.4.4" },
    });
    expect(mihomo.headers()["x-subscription-rendered"]).toBe("3");
    expect(mihomo.headers()["vary"]).toContain("User-Agent");
    const clashMeta = await context.request.get(smart, {
      headers: { "User-Agent": "clash.meta" },
    });
    expect(clashMeta.headers()["x-subscription-client"]).toBe("clash-meta");
    expect(clashMeta.headers()["x-subscription-format"]).toBe("mihomo");
    expect(clashMeta.headers()["x-subscription-rendered"]).toBe("3");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `test-results/multiclient-${width}.png`,
      fullPage: true,
    });
    await clients.getByRole("button", { name: "关闭", exact: true }).click();
    if (width === 1440) {
      await page.getByRole("button", { name: "节点库", exact: true }).click();
      await page
        .getByRole("button", { name: new RegExp(`^${groups[0]}\\s`) })
        .click();
      await page
        .getByRole("button", { name: `删除 ${names[0]}`, exact: true })
        .click();
      const deletion = page.getByRole("dialog", {
        name: "删除节点",
        exact: true,
      });
      await expect(deletion).toContainText("1 条订阅节点引用");
      await deletion.getByRole("button", { name: "取消", exact: true }).click();
      expect(
        Buffer.from(await (await context.request.get(smart)).text(), "base64")
          .toString()
          .split("\n"),
      ).toHaveLength(3);
      await page
        .getByRole("button", { name: `删除 ${names[0]}`, exact: true })
        .click();
      await deletion
        .getByRole("button", { name: "删除节点并从订阅移除" })
        .click();
      await expect(
        page.getByRole("button", { name: `删除 ${names[0]}`, exact: true }),
      ).toHaveCount(0);
      const remaining = await (await context.request.get("/api/nodes")).json();
      expect(
        remaining.filter(
          (n: { name: string; group_name: string }) =>
            n.name === names[0] && groups.includes(n.group_name),
        ),
      ).toHaveLength(2);
      expect(
        Buffer.from(await (await context.request.get(smart)).text(), "base64")
          .toString()
          .split("\n"),
      ).toHaveLength(2);
    }
  });
}
