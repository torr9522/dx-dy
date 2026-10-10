import { test, expect } from "@playwright/test";
import {
  fixtures,
  nonRfcVmess,
  nonRfcVmessUuid,
  vless,
  vmess,
} from "../fixtures";
import QRCode from "qrcode";
for (const width of [1440, 768, 390]) {
  test(`subscription row quick actions at ${width}px`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await page
      .getByLabel("密码", { exact: true })
      .fill("Synthetic-e2e-password-123!");
    await page.getByRole("button", { name: "安全登录" }).click();
    await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
    const csrf = (await (await context.request.get("/api/auth/me")).json())
      .csrf;
    const headers = { "X-CSRF-Token": csrf };
    const imported = await (
      await context.request.post("/api/nodes/import", {
        headers,
        data: { items: [{ uri: vless }, { uri: vmess }] },
      })
    ).json();
    const globalNodes = await (await context.request.get("/api/nodes")).json();
    const name = `中文 Mixed & # + ${width}`;
    const profile = await (
      await context.request.post("/api/subscriptions", {
        headers,
        data: { name },
      })
    ).json();
    await context.request.put(`/api/subscriptions/${profile.id}/nodes`, {
      headers,
      data: { node_ids: imported.map((node: { id: number }) => node.id) },
    });
    await page.reload();
    await page.getByRole("button", { name: "订阅", exact: true }).click();
    const row = page.locator(".subscription-row").filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row).toContainText("2 个节点");
    await expect(row.getByRole("switch")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    for (const action of ["复制订阅链接", `二维码 ${name}`, "管理订阅", "删除"])
      await expect(
        row.getByRole("button", { name: action, exact: true }),
      ).toBeVisible();
    await row.getByRole("button", { name: "复制订阅链接" }).click();
    await expect(page.locator(".toast")).toContainText("已复制");
    const url = await page.evaluate(() => navigator.clipboard.readText());
    expect(new URL(url).pathname).toMatch(/^\/s\/[A-Za-z0-9_-]{43}$/);
    await row.getByRole("button", { name: `二维码 ${name}` }).click();
    const qr = page.getByRole("dialog", { name: "订阅二维码" });
    await expect(
      qr.getByRole("img", { name: "通用订阅二维码" }),
    ).toHaveAttribute("data-qr-payload", url);
    await qr.getByRole("button", { name: "Shadowrocket（带名称）" }).click();
    const expectedDeepLink = `shadowrocket://add/sub://${Buffer.from(url).toString("base64")}?remark=${encodeURIComponent(name)}`;
    await expect(
      qr.getByRole("img", { name: "Shadowrocket订阅二维码" }),
    ).toHaveAttribute("data-qr-payload", expectedDeepLink);
    await qr.getByRole("button", { name: "关闭" }).click();
    await row.getByRole("switch").click();
    await expect(page.locator(".toast")).toContainText("订阅已禁用");
    await expect(row.getByRole("switch")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await page.reload();
    await page.getByRole("button", { name: "订阅", exact: true }).click();
    const refreshed = page
      .locator(".subscription-row")
      .filter({ hasText: name });
    await expect(refreshed.getByRole("switch")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `test-results/subscriptions-row-${width}.png`,
      fullPage: true,
    });
    await refreshed.getByRole("button", { name: "删除", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "删除订阅" });
    await expect(dialog).toContainText("独立节点将随订阅删除");
    await dialog.getByRole("button", { name: "取消" }).click();
    await refreshed.getByRole("button", { name: "删除", exact: true }).click();
    await page
      .getByRole("dialog", { name: "删除订阅" })
      .getByRole("button", { name: "确认" })
      .click();
    await expect(refreshed).toHaveCount(0);
    expect(await (await context.request.get(url)).status()).toBe(404);
    expect(await (await context.request.get("/api/nodes")).json()).toEqual(
      globalNodes,
    );
    for (const node of imported)
      await context.request.delete(`/api/nodes/${node.id}`, {
        headers,
        data: { confirm: true },
      });
  });
}

test("subscription switch rolls back failures and coalesces rapid changes", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page
    .getByLabel("密码", { exact: true })
    .fill("Synthetic-e2e-password-123!");
  await page.getByRole("button", { name: "安全登录" }).click();
  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
  const csrf = (await (await context.request.get("/api/auth/me")).json()).csrf;
  const headers = { "X-CSRF-Token": csrf };
  const profile = await (
    await context.request.post("/api/subscriptions", {
      headers,
      data: { name: "Switch race E2E", enabled: false },
    })
  ).json();
  await page.reload();
  await page.getByRole("button", { name: "订阅", exact: true }).click();
  const row = page
    .locator(".subscription-row")
    .filter({ hasText: profile.name });
  const toggle = row.getByRole("switch");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await page.route(`**/api/subscriptions/${profile.id}`, async (route) => {
    if (route.request().method() === "PATCH")
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: { message: "Synthetic switch failure" },
        }),
      });
    else await route.continue();
  });
  await toggle.click();
  await expect(page.locator(".toast")).toContainText(
    "Synthetic switch failure",
  );
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await page.unroute(`**/api/subscriptions/${profile.id}`);

  let writes = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  await page.route(`**/api/subscriptions/${profile.id}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    writes += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 120));
    await route.continue();
    inFlight -= 1;
  });
  await toggle.click();
  await toggle.click();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".toast")).toContainText("订阅已启用");
  expect(writes).toBeLessThanOrEqual(3);
  expect(maxInFlight).toBe(1);
  await page.reload();
  await page.getByRole("button", { name: "订阅", exact: true }).click();
  await expect(
    page
      .locator(".subscription-row")
      .filter({ hasText: profile.name })
      .getByRole("switch"),
  ).toHaveAttribute("aria-checked", "true");
  await context.request.delete(`/api/subscriptions/${profile.id}`, { headers });
});

test("subscription lists remain usable at 20 subscriptions and 100 nodes", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page
    .getByLabel("密码", { exact: true })
    .fill("Synthetic-e2e-password-123!");
  await page.getByRole("button", { name: "安全登录" }).click();
  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
  const csrf = (await (await context.request.get("/api/auth/me")).json()).csrf;
  const headers = { "X-CSRF-Token": csrf };
  const imported = await (
    await context.request.post("/api/nodes/import", {
      headers,
      data: {
        items: Array.from({ length: 100 }, (_, index) => {
          const suffix = (index + 1).toString(16).padStart(12, "0");
          return {
            name: `Scale Node ${String(index + 1).padStart(3, "0")}`,
            uri: `vless://33333333-3333-4333-8333-${suffix}@scale-${index + 1}.example.com:443?encryption=none&security=tls&type=tcp#Scale`,
          };
        }),
      },
    })
  ).json();
  const profiles: { id: number; name: string }[] = [];
  for (let index = 1; index <= 20; index++)
    profiles.push(
      await (
        await context.request.post("/api/subscriptions", {
          headers,
          data: {
            name:
              index === 20
                ? "超长中文 English Mixed Subscription Name 020"
                : `Scale Subscription ${String(index).padStart(2, "0")}`,
          },
        })
      ).json(),
    );
  await context.request.put(`/api/subscriptions/${profiles[0].id}/nodes`, {
    headers,
    data: { node_ids: imported.map((node: { id: number }) => node.id) },
  });
  await page.reload();
  await page.getByRole("button", { name: "订阅", exact: true }).click();
  await expect(
    page
      .locator(".subscription-row")
      .filter({ hasText: /Scale Subscription|超长中文/ }),
  ).toHaveCount(20);
  await page
    .locator(".subscription-row")
    .filter({ hasText: profiles[0].name })
    .getByRole("button", { name: "管理订阅" })
    .click();
  await expect(page.locator(".subscription-node-row")).toHaveCount(100);
  await page.getByLabel("搜索当前订阅节点").fill("Scale Node 099");
  await expect(page.locator(".subscription-node-row")).toHaveCount(1);
  await expect(page.locator(".subscription-node-row")).toContainText(
    "Scale Node 099",
  );
  await page.getByLabel("搜索当前订阅节点").fill("");
  await expect(page.locator(".subscription-node-row")).toHaveCount(100);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(1440);
  await page.screenshot({
    path: "test-results/subscription-100-nodes.png",
    fullPage: true,
  });
  for (const profile of profiles)
    await context.request.delete(`/api/subscriptions/${profile.id}`, {
      headers,
    });
  for (const node of imported)
    await context.request.delete(`/api/nodes/${node.id}`, {
      headers,
      data: { confirm: true },
    });
});

test("complete browser workflow with synthetic nodes", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page
    .getByLabel("密码", { exact: true })
    .fill("Synthetic-e2e-password-123!");
  await page.getByRole("button", { name: "安全登录" }).click();
  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
  await page.getByRole("button", { name: "节点库", exact: true }).click();
  await page.getByRole("button", { name: "添加 / 批量添加节点" }).click();
  await page
    .getByLabel("节点链接", { exact: true })
    .fill(vless + "\nINVALID\n" + nonRfcVmess);
  await page.getByRole("button", { name: "解析预览", exact: true }).click();
  await expect(
    page.getByText("无法解析此行，请检查格式和必需参数"),
  ).toBeVisible();
  await page.getByLabel("第 1 行名称").fill("E2E VLESS");
  await page.getByLabel("第 3 行名称").fill("E2E VMess");
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "E2E VLESS", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "E2E VLESS", exact: true }).click();
  await page.getByLabel("备注", { exact: true }).fill("Browser edited");
  await page.getByLabel("端口", { exact: true }).fill("8443");
  await page.getByRole("button", { name: "保存更改" }).click();
  await expect(
    page.getByText("example.com:8443", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "订阅", exact: true }).click();
  await page.getByRole("button", { name: "创建订阅", exact: true }).click();
  await page.getByLabel("订阅名称").fill("E2E iPhone");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "创建订阅", exact: true })
    .click();
  await page
    .locator(".subscription-row")
    .filter({ hasText: "E2E iPhone" })
    .getByRole("button", { name: "管理订阅", exact: true })
    .click();
  await expect(page.locator(".picker-node")).toHaveCount(0);
  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  await page.getByRole("button", { name: /从节点库选择节点/ }).click();
  await page
    .locator(".picker-node")
    .filter({ hasText: "E2E VLESS" })
    .getByRole("checkbox")
    .check();
  await expect(page.getByText("有未保存更改", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page
    .getByRole("dialog", { name: "放弃未保存更改？" })
    .getByRole("button", { name: "确认" })
    .click();
  await page.getByRole("button", { name: "返回订阅", exact: true }).click();
  await expect(page.getByText("当前订阅还没有节点")).toBeVisible();
  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  await page.getByRole("button", { name: /从节点库选择节点/ }).click();
  await page
    .locator(".picker-node")
    .filter({ hasText: "E2E VLESS" })
    .getByRole("checkbox")
    .check();
  await page
    .locator(".picker-node")
    .filter({ hasText: "E2E VMess" })
    .getByRole("checkbox")
    .check();
  await page.getByRole("button", { name: "保存并返回" }).click();
  await expect(page.getByRole("heading", { name: /已保存节点/ })).toBeVisible();
  await expect(page.locator(".subscription-node-row")).toHaveCount(2);
  await page.getByLabel("下移 E2E VLESS").click();
  await expect(page.locator(".subscription-node-row").first()).toContainText(
    "E2E VMess",
  );
  await page.getByRole("button", { name: "保存节点与顺序" }).click();
  await expect(page.locator(".toast")).toContainText("节点与顺序已保存");
  const universal = page.locator(".subscription-distribution");
  await universal.getByRole("button", { name: "复制订阅链接" }).click();
  await expect(page.locator(".toast")).toContainText("已复制");
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(url).search).toBe("");
  expect(new URL(url).pathname).toMatch(/^\/s\/[A-Za-z0-9_-]{43}$/);
  const before = await context.request.get(url);
  expect(before.status()).toBe(200);
  const firstRendered = Buffer.from(await before.text(), "base64")
    .toString("utf8")
    .split("\n")[0];
  expect(firstRendered).toMatch(/^vmess:/);
  expect(
    JSON.parse(
      Buffer.from(firstRendered.slice("vmess://".length), "base64").toString(
        "utf8",
      ),
    ).id,
  ).toBe(nonRfcVmessUuid);
  await universal.getByRole("button", { name: "二维码 E2E iPhone" }).click();
  const modules = QRCode.create(url).modules;
  // Browser canvas and Node PNG encoders differ; compare the actual QR module pixels.
  const pixels = await page
    .getByRole("img", { name: "通用订阅二维码" })
    .evaluate(async (element, size) => {
      const img = element as HTMLImageElement;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = img.naturalWidth;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const scale = canvas.width / (size + 4);
      return Array.from({ length: size * size }, (_, i) => {
        const x = Math.floor(((i % size) + 2.5) * scale);
        const y = Math.floor((Math.floor(i / size) + 2.5) * scale);
        return ctx.getImageData(x, y, 1, 1).data[0] < 128 ? 1 : 0;
      });
    }, modules.size);
  expect(pixels).toEqual(Array.from(modules.data));
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "节点库", exact: true }).click();
  await page.getByRole("button", { name: "E2E VLESS", exact: true }).click();
  await page.getByRole("button", { name: "原始链接", exact: true }).click();
  await expect(page.getByRole("textbox").first()).toHaveValue(vless);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.screenshot({
    path: "test-results/dashboard-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/nodes-mobile.png",
    fullPage: true,
  });
  const csrf = (await (await context.request.get("/api/auth/me")).json()).csrf;
  const headers = { "X-CSRF-Token": csrf };
  const profile = (
    await (await context.request.get("/api/subscriptions")).json()
  ).find((item: { name: string }) => item.name === "E2E iPhone");
  await context.request.delete(`/api/subscriptions/${profile.id}`, { headers });
  const nodes = await (await context.request.get("/api/nodes")).json();
  for (const node of nodes.filter((item: { name: string }) =>
    item.name.startsWith("E2E "),
  ))
    await context.request.delete(`/api/nodes/${node.id}`, {
      headers,
      data: { confirm: true },
    });
});

test("global selector save returns to persisted main view and survives reload", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page
    .getByLabel("密码", { exact: true })
    .fill("Synthetic-e2e-password-123!");
  await page.getByRole("button", { name: "安全登录" }).click();
  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
  const csrf = (await (await context.request.get("/api/auth/me")).json()).csrf;
  const headers = { "X-CSRF-Token": csrf };
  const importResponse = await context.request.post("/api/nodes/import", {
    headers,
    data: {
      items: fixtures.slice(1, 4).map(([name, uri]) => ({
        name: `Persisted ${name}`,
        uri,
      })),
    },
  });
  expect(importResponse.ok()).toBeTruthy();
  const imported = await importResponse.json();
  const profileResponse = await context.request.post("/api/subscriptions", {
    headers,
    data: { name: "Persisted selector E2E" },
  });
  expect(profileResponse.ok()).toBeTruthy();
  const profile = await profileResponse.json();
  await page.reload();
  await page.getByRole("button", { name: "订阅", exact: true }).click();
  await page
    .locator(".subscription-row")
    .filter({ hasText: profile.name })
    .getByRole("button", { name: "管理订阅" })
    .click();
  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  await page.getByRole("button", { name: /从节点库选择节点/ }).click();
  for (const node of imported.slice(0, 2))
    await page
      .getByRole("checkbox", { name: `选择订阅节点 ${node.name}` })
      .check();
  await page.getByRole("button", { name: "保存并返回" }).click();
  await expect(page.getByRole("heading", { name: /已保存节点/ })).toBeVisible();
  await expect(page.locator(".subscription-node-row")).toHaveCount(2);
  expect(
    (
      await (
        await context.request.get(`/api/subscriptions/${profile.id}/entries`)
      ).json()
    ).map((entry: { node: { id: number } }) => entry.node.id),
  ).toEqual(imported.slice(0, 2).map((node: { id: number }) => node.id));
  await page.reload();
  await page.getByRole("button", { name: "订阅", exact: true }).click();
  await page
    .locator(".subscription-row")
    .filter({ hasText: profile.name })
    .getByRole("button", { name: "管理订阅" })
    .click();
  await expect(page.locator(".subscription-node-row")).toHaveCount(2);
  const url = (
    await (
      await context.request.get(`/api/subscriptions/${profile.id}/url`)
    ).json()
  ).url;
  expect(
    Buffer.from(await (await context.request.get(url)).text(), "base64")
      .toString("utf8")
      .split("\n"),
  ).toHaveLength(2);
  await context.request.delete(`/api/subscriptions/${profile.id}`, { headers });
  for (const node of imported)
    await context.request.delete(`/api/nodes/${node.id}`, {
      headers,
      data: { confirm: true },
    });
});

test("single local link returns to main, persists and stays out of Global Library", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page
    .getByLabel("密码", { exact: true })
    .fill("Synthetic-e2e-password-123!");
  await page.getByRole("button", { name: "安全登录" }).click();
  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
  const csrf = (await (await context.request.get("/api/auth/me")).json()).csrf;
  const headers = { "X-CSRF-Token": csrf };
  const profile = await (
    await context.request.post("/api/subscriptions", {
      headers,
      data: { name: "Single Local E2E" },
    })
  ).json();
  await page.reload();
  await page.getByRole("button", { name: "订阅", exact: true }).click();
  await page
    .locator(".subscription-row")
    .filter({ hasText: profile.name })
    .getByRole("button", { name: "管理订阅" })
    .click();
  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  await page.getByRole("button", { name: /添加节点链接/ }).click();
  await page.getByLabel("独立节点链接").fill(nonRfcVmess);
  await page.getByRole("button", { name: "解析预览" }).click();
  await page.getByLabel("独立节点第 1 行名称").fill("Single Local VMess");
  await page.getByRole("button", { name: "确认添加" }).click();
  await expect(page.getByRole("heading", { name: /已保存节点/ })).toBeVisible();
  await expect(page.locator(".subscription-node-row")).toHaveCount(1);
  await expect(page.locator(".subscription-node-row")).toContainText(
    "独立节点",
  );
  await page.reload();
  await page.getByRole("button", { name: "订阅", exact: true }).click();
  await page
    .locator(".subscription-row")
    .filter({ hasText: profile.name })
    .getByRole("button", { name: "管理订阅" })
    .click();
  await expect(
    page.getByText("Single Local VMess", { exact: true }),
  ).toBeVisible();
  const url = (
    await (
      await context.request.get(`/api/subscriptions/${profile.id}/url`)
    ).json()
  ).url;
  expect(
    Buffer.from(await (await context.request.get(url)).text(), "base64")
      .toString("utf8")
      .split("\n"),
  ).toHaveLength(1);
  await page.getByRole("button", { name: "节点库", exact: true }).click();
  await page
    .getByLabel("搜索全部节点", { exact: true })
    .fill("Single Local VMess");
  await expect(page.getByText("没有匹配的节点")).toBeVisible();
  await context.request.delete(`/api/subscriptions/${profile.id}`, { headers });
});

test("Node Library delete and enabled Switch are transactional and responsive", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page
    .getByLabel("密码", { exact: true })
    .fill("Synthetic-e2e-password-123!");
  await page.getByRole("button", { name: "安全登录" }).click();
  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
  const csrf = (await (await context.request.get("/api/auth/me")).json()).csrf;
  const headers = { "X-CSRF-Token": csrf };
  const imported = await (
    await context.request.post("/api/nodes/import", {
      headers,
      data: {
        items: fixtures.slice(1, 5).map(([name, uri], index) => ({
          name: `Node Ops ${index + 1} ${name}`,
          uri: uri.replace(
            "@example.com",
            `@node-ops-${index + 1}.example.com`,
          ),
        })),
      },
    })
  ).json();
  const collection = await (
    await context.request.post("/api/collections", {
      headers,
      data: { name: "Node Ops Collection" },
    })
  ).json();
  await context.request.post(`/api/collections/${collection.id}/nodes`, {
    headers,
    data: { node_ids: imported.map((node: { id: number }) => node.id) },
  });
  const profile = await (
    await context.request.post("/api/subscriptions", {
      headers,
      data: { name: "Node Ops Reference" },
    })
  ).json();
  await context.request.put(`/api/subscriptions/${profile.id}/nodes`, {
    headers,
    data: { node_ids: [imported[1].id] },
  });
  await page.reload();
  await page.getByRole("button", { name: "节点库", exact: true }).click();
  await page.getByLabel("搜索全部节点", { exact: true }).fill("Node Ops");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page
      .locator("tr")
      .filter({ hasText: imported[0].name })
      .getByRole("switch"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: `删除 ${imported[0].name}` }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1280, height: 900 });

  const firstRow = page.locator("tr").filter({ hasText: imported[0].name });
  const firstSwitch = firstRow.getByRole("switch");
  await firstSwitch.click();
  await expect(page.locator(".toast")).toContainText("节点已禁用");
  await page.reload();
  await page.getByRole("button", { name: "节点库", exact: true }).click();
  await page.getByLabel("搜索全部节点", { exact: true }).fill("Node Ops");
  const refreshedSwitch = page
    .locator("tr")
    .filter({ hasText: imported[0].name })
    .getByRole("switch");
  await expect(refreshedSwitch).toHaveAttribute("aria-checked", "false");
  await page.getByLabel("搜索全部节点状态").selectOption("disabled");
  await expect(refreshedSwitch).toBeVisible();
  await page.getByLabel("搜索全部节点状态").selectOption("");
  await page.route(`**/api/nodes/${imported[0].id}/enabled`, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: { message: "Synthetic node switch failure" },
      }),
    }),
  );
  await refreshedSwitch.click();
  await expect(page.locator(".toast")).toContainText(
    "Synthetic node switch failure",
  );
  await expect(refreshedSwitch).toHaveAttribute("aria-checked", "false");
  await page.unroute(`**/api/nodes/${imported[0].id}/enabled`);
  let writes = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  await page.route(`**/api/nodes/${imported[0].id}/enabled`, async (route) => {
    writes += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.continue();
    inFlight -= 1;
  });
  await refreshedSwitch.click();
  await refreshedSwitch.click();
  await refreshedSwitch.click();
  await expect(page.locator(".toast")).toContainText("节点已启用");
  expect(writes).toBeLessThanOrEqual(3);
  expect(maxInFlight).toBe(1);
  await page.unroute(`**/api/nodes/${imported[0].id}/enabled`);
  await page.getByLabel("搜索全部节点状态").selectOption("disabled");
  await expect(
    page.locator("tr").filter({ hasText: imported[0].name }),
  ).toHaveCount(0);
  await page.getByLabel("搜索全部节点状态").selectOption("");

  const thirdRow = page.locator("tr").filter({ hasText: imported[2].name });
  await thirdRow
    .getByRole("button", { name: `删除 ${imported[2].name}` })
    .click();
  await page
    .getByRole("dialog", { name: "删除节点" })
    .getByRole("button", { name: "取消" })
    .click();
  await expect(thirdRow).toBeVisible();
  await thirdRow
    .getByRole("button", { name: `删除 ${imported[2].name}` })
    .click();
  await page
    .getByRole("dialog", { name: "删除节点" })
    .getByRole("button", { name: "确认" })
    .click();
  await expect(thirdRow).toHaveCount(0);
  expect(
    (await (await context.request.get("/api/collections")).json()).find(
      (item: { id: number }) => item.id === collection.id,
    ).node_count,
  ).toBe(3);

  for (const node of [imported[0], imported[1], imported[3]])
    await page.getByRole("checkbox", { name: `选择 ${node.name}` }).check();
  await page.getByRole("button", { name: "删除已选（3）" }).click();
  await page
    .getByRole("dialog", { name: "删除已选（3）" })
    .getByRole("button", { name: "确认" })
    .click();
  await expect(page.locator(".toast")).toContainText("1 个节点仍被订阅使用");
  await expect(
    page.getByText("已选择 3 个节点", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "删除已选（3）" })
    .getByRole("button", { name: "取消" })
    .click();
  await context.request.put(`/api/subscriptions/${profile.id}/nodes`, {
    headers,
    data: { node_ids: [] },
  });
  await page.getByRole("button", { name: "删除已选（3）" }).click();
  await page
    .getByRole("dialog", { name: "删除已选（3）" })
    .getByRole("button", { name: "确认" })
    .click();
  await expect(page.getByText("已选择 3 个节点", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText("没有匹配的节点")).toBeVisible();

  await context.request.delete(`/api/subscriptions/${profile.id}`, { headers });
  await context.request.delete(`/api/collections/${collection.id}`, {
    headers,
  });
});

test("filtered selection accumulates, supports rows and visible shift ranges", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page
    .getByLabel("密码", { exact: true })
    .fill("Synthetic-e2e-password-123!");
  await page.getByRole("button", { name: "安全登录" }).click();
  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
  const csrf = (await (await context.request.get("/api/auth/me")).json()).csrf;
  const headers = { "X-CSRF-Token": csrf };
  const imported = await (
    await context.request.post("/api/nodes/import", {
      headers,
      data: {
        items: fixtures.slice(0, 6).map(([, uri], index) => ({
          uri,
          name: `Selection ${index < 3 ? "JP" : "US"} ${index + 1}`,
        })),
      },
    })
  ).json();
  await page.reload();
  await page.getByRole("button", { name: "节点库", exact: true }).click();
  const search = page.getByLabel("搜索全部节点", { exact: true });
  await search.fill("Selection JP");
  await page.getByRole("checkbox", { name: "全选当前节点" }).check();
  await expect(
    page.getByText("已选择 3 个节点", { exact: true }),
  ).toBeVisible();
  await search.fill("Selection US");
  await page
    .locator("tr.selectable-row")
    .filter({ hasText: "Selection US 4" })
    .locator("td")
    .nth(2)
    .click();
  await expect(
    page.getByText("已选择 4 个节点", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "查看已选择 4 个" }).click();
  const review = page.getByRole("dialog", { name: "查看已选择节点" });
  await expect(
    review.getByText("Selection JP 1", { exact: true }),
  ).toBeVisible();
  await expect(
    review.getByText("Selection US 4", { exact: true }),
  ).toBeVisible();
  await review.getByRole("button", { name: "关闭" }).click();
  await search.fill("");
  const master = page.getByRole("checkbox", { name: "全选当前节点" });
  await expect(master).not.toBeChecked();
  expect(
    await master.evaluate((input: HTMLInputElement) => input.indeterminate),
  ).toBe(true);
  await page.getByRole("button", { name: "清空选择" }).click();

  const rows = page.locator("tr.selectable-row");
  await rows.nth(0).getByRole("checkbox").check();
  await rows
    .nth(4)
    .getByRole("checkbox")
    .click({ modifiers: ["Shift"] });
  for (let index = 0; index < 5; index++)
    await expect(rows.nth(index).getByRole("checkbox")).toBeChecked();
  const sixthCheckbox = rows.nth(5).getByRole("checkbox");
  await expect(sixthCheckbox).not.toBeChecked();
  await rows
    .nth(5)
    .getByRole("button", { name: /管理 .* 的节点集合/ })
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "关闭" }).click();
  await expect(sixthCheckbox).not.toBeChecked();
  await rows.nth(5).locator("td").nth(2).click();
  await expect(sixthCheckbox).toBeChecked();
  await sixthCheckbox.uncheck();
  await expect(sixthCheckbox).not.toBeChecked();
  await expect(
    page.getByText("已选择 5 个节点", { exact: true }),
  ).toBeVisible();

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const bulk = page.getByRole("toolbar", { name: "节点批量操作" });
    const box = await bulk.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    await expect(page.getByRole("button", { name: "清空选择" })).toBeVisible();
    await page.screenshot({
      path: `test-results/selection-${width}.png`,
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "清空选择" }).click();
  for (const node of imported)
    await context.request.delete(`/api/nodes/${node.id}`, {
      headers,
      data: { confirm: true },
    });
});

test("node collections organize nodes without becoming subscription authority", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page
    .getByLabel("密码", { exact: true })
    .fill("Synthetic-e2e-password-123!");
  await page.getByRole("button", { name: "安全登录" }).click();
  await expect(
    page.getByRole("heading", { name: "总览", exact: true }),
  ).toBeVisible();
  const csrf = (await (await context.request.get("/api/auth/me")).json()).csrf,
    headers = { "X-CSRF-Token": csrf };
  const imported = await (
    await context.request.post("/api/nodes/import", {
      headers,
      data: {
        items: [
          { uri: vless, name: "Collection VLESS" },
          { uri: vmess, name: "Collection VMess" },
        ],
      },
    })
  ).json();
  for (const [index, node] of imported.entries()) {
    const full = (await (await context.request.get(`/api/nodes`)).json()).find(
      (item: { id: number }) => item.id === node.id,
    );
    await context.request.patch(`/api/nodes/${node.id}`, {
      headers,
      data: {
        normalized_config: full.normalized_config,
        remark: full.remark,
        tags: [index ? "日本" : "美国", index ? "测试" : "AI"],
        enabled: true,
      },
    });
  }
  await page.reload();
  await page.getByRole("button", { name: "节点库", exact: true }).click();
  for (const name of ["E2E-G", "E2E-A"]) {
    await page.getByRole("button", { name: "新建集合" }).click();
    await page.getByLabel("集合名称").fill(name);
    await page.getByLabel("集合备注").fill("E2E collection");
    await page.getByRole("button", { name: "保存集合" }).click();
    await expect(
      page.getByRole("button", { name: new RegExp(name) }).first(),
    ).toBeVisible();
  }
  await expect(page.getByText("节点库", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("节点集合", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /E2E-G 0/ }).click();
  await expect(
    page.getByRole("heading", { name: "E2E-G 还没有节点" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "从节点库添加节点" }).last().click();
  await page.getByLabel("搜索节点库", { exact: true }).fill("Collection");
  await page.getByLabel("搜索节点库协议").selectOption("vless");
  await page.getByLabel("搜索节点库标签").selectOption("AI");
  await page.getByRole("checkbox", { name: "全选当前可选节点" }).check();
  await page.getByLabel("搜索节点库协议").selectOption("");
  await page.getByLabel("搜索节点库标签").selectOption("");
  await page.getByRole("checkbox", { name: "全选当前可选节点" }).check();
  await page.getByRole("button", { name: "添加 2 个节点" }).click();
  await expect(page.getByRole("button", { name: /E2E-G 2/ })).toBeVisible();
  await page.getByLabel("搜索 E2E-G 中节点", { exact: true }).fill("VLESS");
  await expect(
    page.getByRole("button", { name: "Collection VLESS", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "从 E2E-G 移除" }).click();
  await page.getByRole("button", { name: /全部节点/ }).click();
  await expect(
    page.getByRole("button", { name: "Collection VLESS", exact: true }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: "选择 Collection VLESS" }).check();
  await page.getByRole("checkbox", { name: "选择 Collection VMess" }).check();
  await page.getByRole("button", { name: "加入集合", exact: true }).click();
  await page.getByRole("checkbox", { name: /E2E-A/ }).check();
  await page
    .getByRole("button", { name: "加入集合", exact: true })
    .last()
    .click();
  await expect(
    page.locator(".collection-chips").filter({ hasText: "E2E-A" }),
  ).toHaveCount(2);
  await page.getByRole("checkbox", { name: "选择 Collection VLESS" }).check();
  await page.getByRole("checkbox", { name: "选择 Collection VMess" }).check();
  await page.getByRole("button", { name: "移出集合", exact: true }).click();
  await page.getByRole("checkbox", { name: /E2E-A/ }).check();
  await page
    .getByRole("button", { name: "移出集合", exact: true })
    .last()
    .click();
  await expect(
    page.locator(".collection-chips").filter({ hasText: "E2E-A" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /E2E-G 1/ }).click();
  await page.getByRole("button", { name: "从节点库添加节点" }).click();
  await expect(page.getByText("已在 E2E-G 中")).toBeVisible();
  await page.getByLabel("搜索节点库", { exact: true }).fill("Collection");
  await page.getByRole("checkbox", { name: "全选当前可选节点" }).check();
  await expect(
    page.getByText("已选择 1 个节点", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "添加 1 个节点" }).click();
  await page.screenshot({
    path: "test-results/collections-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".collection-sidebar")).toBeVisible();
  await page.screenshot({
    path: "test-results/collections-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  const profile = await (
    await context.request.post("/api/subscriptions", {
      headers,
      data: { name: "Collection selector E2E" },
    })
  ).json();
  await page.reload();
  await page.getByRole("button", { name: "订阅", exact: true }).click();
  await page
    .locator(".subscription-row")
    .filter({ hasText: profile.name })
    .getByRole("button", { name: "管理订阅" })
    .click();
  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  await page.getByRole("button", { name: /从节点库选择节点/ }).click();
  await expect(
    page.getByLabel("节点来源").getByRole("button", { name: /全部节点/ }),
  ).toBeVisible();
  await page
    .getByLabel("节点来源")
    .getByRole("button", { name: /全部节点/ })
    .click();
  await page.getByLabel("搜索可选节点").fill("Collection VLESS");
  await page.getByRole("checkbox", { name: "全选当前筛选节点" }).check();
  await page
    .getByLabel("节点来源")
    .getByRole("button", { name: /E2E-G/ })
    .click();
  await page.getByLabel("搜索可选节点").fill("Collection VMess");
  await page.getByRole("checkbox", { name: "全选当前筛选节点" }).check();
  await page.getByRole("button", { name: "查看已选", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("Collection VLESS", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("Collection VMess", { exact: true }),
  ).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "关闭" }).click();
  await page
    .getByLabel("节点来源")
    .getByRole("button", { name: /全部节点/ })
    .click();
  await page.getByLabel("搜索可选节点").fill("Collection VLESS");
  await expect(
    page.getByRole("checkbox", { name: "选择订阅节点 Collection VLESS" }),
  ).toBeChecked();
  await page.getByRole("button", { name: "保存并返回" }).click();
  const canonicalUrl = (
    await (
      await context.request.get(`/api/subscriptions/${profile.id}/url`)
    ).json()
  ).url;
  const canonicalBody = await (await context.request.get(canonicalUrl)).text();
  const collections = await (
    await context.request.get("/api/collections")
  ).json();
  const collectionG = collections.find(
      (c: { name: string }) => c.name === "E2E-G",
    ),
    collectionA = collections.find((c: { name: string }) => c.name === "E2E-A");
  await context.request.delete(`/api/collections/${collectionG.id}/nodes`, {
    headers,
    data: { node_ids: [imported[1].id] },
  });
  expect(
    (await (await context.request.get(`/api/subscriptions`)).json()).find(
      (s: { id: number }) => s.id === profile.id,
    ).node_ids,
  ).toEqual(imported.map((n: { id: number }) => n.id));
  expect(await (await context.request.get(canonicalUrl)).text()).toBe(
    canonicalBody,
  );
  await context.request.delete(`/api/collections/${collectionG.id}`, {
    headers,
  });
  expect(
    (await (await context.request.get(`/api/subscriptions`)).json()).find(
      (s: { id: number }) => s.id === profile.id,
    ).node_ids,
  ).toEqual(imported.map((n: { id: number }) => n.id));
  expect(await (await context.request.get(canonicalUrl)).text()).toBe(
    canonicalBody,
  );
  await page.reload();
  await page.getByRole("button", { name: "节点库", exact: true }).click();
  await page
    .getByRole("button", { name: new RegExp(`编辑集合 ${collectionA.name}`) })
    .click();
  await page.getByRole("button", { name: "删除集合" }).click();
  await expect(page.getByRole("dialog")).toContainText("不会影响已有订阅");
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Collection VLESS", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Collection VMess", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByLabel("Admin Base URL")).toHaveValue(
    "http://127.0.0.1:3100",
  );
  await expect(page.getByLabel("订阅域名")).toHaveValue(
    "http://127.0.0.1:3100",
  );
  await page.getByLabel("订阅域名").fill("http://localhost:3999/");
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(page.locator(".toast")).toContainText("订阅域名已更新");
  await expect(page.getByLabel("订阅域名")).toHaveValue(
    "http://localhost:3999",
  );
  await page.getByRole("button", { name: "订阅", exact: true }).click();
  const card = page
    .locator(".subscription-row")
    .filter({ hasText: profile.name });
  await card.getByRole("button", { name: "复制订阅链接", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("已复制");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
    /^http:\/\/localhost:3999\/s\//,
  );
  await card.getByRole("button", { name: `二维码 ${profile.name}` }).click();
  await expect(page.getByAltText("通用订阅二维码")).toHaveAttribute(
    "data-qr-payload",
    /^http:\/\/localhost:3999\/s\//,
  );
  await page.getByRole("button", { name: "关闭" }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("订阅域名").fill("http://127.0.0.1:3100");
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(page.locator(".toast")).toContainText("订阅域名已更新");
  await context.request.delete(`/api/subscriptions/${profile.id}`, { headers });
  for (const n of imported)
    await context.request.delete(`/api/nodes/${n.id}`, {
      headers,
      data: { confirm: true },
    });
});

test("subscription local nodes stay isolated and share persisted ordering", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page
    .getByLabel("密码", { exact: true })
    .fill("Synthetic-e2e-password-123!");
  await page.getByRole("button", { name: "安全登录" }).click();
  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
  const csrf = (await (await context.request.get("/api/auth/me")).json()).csrf;
  const headers = { "X-CSRF-Token": csrf };
  const global = (
    await (
      await context.request.post("/api/nodes/import", {
        headers,
        data: { items: [{ uri: fixtures[1][1], name: "Global Library WS" }] },
      })
    ).json()
  )[0];
  const profile = await (
    await context.request.post("/api/subscriptions", {
      headers,
      data: { name: "Local Node E2E" },
    })
  ).json();
  const other = await (
    await context.request.post("/api/subscriptions", {
      headers,
      data: { name: "Local Isolation E2E" },
    })
  ).json();
  await page.reload();
  await page.getByRole("button", { name: "订阅", exact: true }).click();
  await page
    .locator(".subscription-row")
    .filter({ hasText: profile.name })
    .getByRole("button", { name: "管理订阅" })
    .click();
  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  await page.getByRole("button", { name: /添加节点链接/ }).click();
  const localFixtures = [fixtures[0], ...fixtures.slice(6)];
  await page
    .getByLabel("独立节点链接")
    .fill(localFixtures.map(([, uri]) => uri).join("\n"));
  await page.getByRole("button", { name: "解析预览" }).click();
  await expect(page.getByText("6 成功 · 0 警告 · 0 失败")).toBeVisible();
  const names = [
    "Local VLESS",
    "Local VMess",
    "Local Trojan",
    "Local SS",
    "Local HY2",
    "Local TUIC",
  ];
  for (let index = 0; index < names.length; index++)
    await page.getByLabel(`独立节点第 ${index + 1} 行名称`).fill(names[index]);
  await page.getByRole("button", { name: "确认添加" }).click();
  await expect(page.locator(".toast")).toContainText("已添加 6 个独立节点");
  await expect(page.getByRole("heading", { name: /已保存节点/ })).toBeVisible();
  await expect(page.locator(".subscription-node-row")).toHaveCount(6);
  for (const name of names)
    await expect(
      page.locator(".subscription-node-row").filter({ hasText: name }),
    ).toContainText("独立节点");

  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  await page.getByRole("button", { name: /从节点库选择节点/ }).click();
  await page
    .getByRole("checkbox", { name: "选择订阅节点 Global Library WS" })
    .check();
  await page.getByRole("button", { name: "保存并返回" }).click();
  await expect(page.getByRole("heading", { name: /已保存节点/ })).toBeVisible();
  await expect(page.locator(".subscription-node-row")).toHaveCount(7);
  await page.getByLabel("上移 Global Library WS").click();
  await page.getByLabel("上移 Global Library WS").click();
  await page.getByRole("button", { name: "保存节点与顺序" }).click();
  await expect(page.locator(".toast")).toContainText("节点与顺序已保存");
  const visibleOrder = await page
    .locator(".subscription-node-row .subscription-node-main strong")
    .allTextContents();
  expect(visibleOrder).toEqual([
    "Local VLESS",
    "Local VMess",
    "Local Trojan",
    "Local SS",
    "Global Library WS",
    "Local HY2",
    "Local TUIC",
  ]);
  await page.getByRole("button", { name: "复制订阅链接" }).first().click();
  await expect(page.locator(".toast")).toContainText("已复制");
  const url = (
    await (
      await context.request.get(`/api/subscriptions/${profile.id}/url`)
    ).json()
  ).url;
  const response = await context.request.get(url);
  expect(response.status()).toBe(200);
  const rendered = Buffer.from(await response.text(), "base64")
    .toString("utf8")
    .split("\n");
  expect(rendered).toHaveLength(7);
  expect(rendered[4]).toContain("Global%20Library%20WS");

  await page.getByLabel("编辑 Local VMess").click();
  await page.getByLabel("节点名称").fill("Local VMess Edited");
  await page.getByRole("button", { name: "保存更改" }).click();
  await expect(page.locator(".toast")).toContainText("独立节点已更新");
  await expect(
    page.getByText("Local VMess Edited", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("编辑 Global Library WS")).toHaveCount(0);

  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  await page.getByRole("button", { name: /添加节点链接/ }).click();
  await page.getByLabel("独立节点链接").fill(fixtures[1][1]);
  await page.getByRole("button", { name: "解析预览" }).click();
  await expect(page.getByText("1 成功 · 0 警告 · 0 失败")).toBeVisible();
  await expect(page.getByLabel("导入独立节点第 1 行")).toBeEnabled();
  await page.getByLabel("独立节点第 1 行名称").fill("Local matches Global");
  await page.getByRole("button", { name: "确认添加" }).click();
  await expect(page.locator(".toast")).toContainText("已添加 1 个独立节点");
  await expect(
    page
      .locator(".subscription-node-row")
      .filter({ hasText: "Global Library WS" }),
  ).toContainText("节点库");
  await expect(
    page
      .locator(".subscription-node-row")
      .filter({ hasText: "Local matches Global" }),
  ).toContainText("独立节点");
  await page.reload();
  await page.getByRole("button", { name: "订阅", exact: true }).click();
  await page
    .locator(".subscription-row")
    .filter({ hasText: profile.name })
    .getByRole("button", { name: "管理订阅" })
    .click();
  await expect(page.locator(".subscription-node-row")).toHaveCount(8);

  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  await page.getByRole("button", { name: /添加节点链接/ }).click();
  await page.getByLabel("独立节点链接").fill(fixtures[1][1]);
  await page.getByRole("button", { name: "解析预览" }).click();
  await expect(page.getByText("与当前订阅已有独立节点重复")).toBeVisible();
  await expect(page.getByLabel("导入独立节点第 1 行")).toBeDisabled();
  await expect(page.getByRole("button", { name: "确认添加" })).toBeDisabled();
  await page.getByRole("button", { name: "返回添加节点" }).click();
  await page.getByRole("button", { name: "返回订阅" }).click();
  await page.getByLabel("移除 Local Trojan").click();
  await page
    .getByRole("dialog", { name: "删除独立节点" })
    .getByRole("button", { name: "从草稿移除" })
    .click();
  await expect(page.getByText("Local Trojan", { exact: true })).toHaveCount(0);
  expect(
    await (
      await context.request.get(`/api/subscriptions/${profile.id}/entries`)
    ).json(),
  ).toHaveLength(8);
  await page.getByRole("button", { name: "保存节点与顺序" }).click();
  await expect(page.locator(".toast")).toContainText("节点与顺序已保存");

  await page.getByRole("button", { name: "节点库", exact: true }).click();
  await page
    .getByLabel("搜索全部节点", { exact: true })
    .fill("Local VMess Edited");
  await expect(page.getByText("没有匹配的节点")).toBeVisible();
  await page.getByRole("button", { name: "订阅", exact: true }).click();
  await page
    .locator(".subscription-row")
    .filter({ hasText: other.name })
    .getByRole("button", { name: "管理订阅" })
    .click();
  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  await page.getByRole("button", { name: /从节点库选择节点/ }).click();
  await page.getByLabel("搜索可选节点").fill("Local VMess Edited");
  await expect(page.getByText("0 个候选")).toBeVisible();

  await context.request.delete(`/api/subscriptions/${profile.id}`, { headers });
  await context.request.delete(`/api/subscriptions/${other.id}`, { headers });
  await context.request.delete(`/api/nodes/${global.id}`, {
    headers,
    data: { confirm: true },
  });
});

test("Global Library still blocks semantic duplicates", async ({ page }) => {
  await page.goto("/");
  await page
    .getByLabel("密码", { exact: true })
    .fill("Synthetic-e2e-password-123!");
  await page.getByRole("button", { name: "安全登录" }).click();
  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
  await page.getByRole("button", { name: "节点库", exact: true }).click();
  await page.getByRole("button", { name: "添加 / 批量添加节点" }).click();
  await page.getByLabel("节点链接", { exact: true }).fill(vmess);
  await page.getByRole("button", { name: "解析预览", exact: true }).click();
  await page.getByLabel("第 1 行名称").fill("Namespace Global");
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(
    page.getByText("Namespace Global", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "添加 / 批量添加节点" }).click();
  await page.getByLabel("节点链接", { exact: true }).fill(vmess);
  await page.getByRole("button", { name: "解析预览", exact: true }).click();
  await expect(page.getByText("与节点库已有节点重复")).toBeVisible();
  await expect(page.getByLabel("导入第 1 行")).toBeDisabled();
  await expect(page.getByRole("button", { name: "确认导入" })).toBeDisabled();
});
