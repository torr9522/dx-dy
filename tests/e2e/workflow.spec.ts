import { test, expect } from "@playwright/test";
import { vless, vmess } from "../fixtures";
import QRCode from "qrcode";
for (const width of [1280, 390]) {
  test(`subscription card quick actions at ${width}px`, async ({
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
    const links: string[] = [];
    const profileIds: number[] = [];
    for (const [label, count] of [
      ["Empty", 0],
      ["Mixed", 2],
    ] as const) {
      const name = `${label} quick ${width}`;
      const p = await (
        await context.request.post("/api/subscriptions", {
          headers,
          data: { name },
        })
      ).json();
      profileIds.push(p.id);
      if (count)
        await context.request.put(`/api/subscriptions/${p.id}/nodes`, {
          headers,
          data: { node_ids: imported.map((n: { id: number }) => n.id) },
        });
      await page.reload();
      await page.getByRole("button", { name: "订阅", exact: true }).click();
      const card = page.locator(".profile-card").filter({ hasText: name });
      await expect(card).toBeVisible();
      for (const action of ["复制订阅链接", "预览", "二维码", "管理订阅"])
        await expect(
          card.getByRole("button", { name: action, exact: true }),
        ).toBeVisible();
      await card
        .getByRole("button", { name: "复制订阅链接", exact: true })
        .click();
      await expect(page.locator(".toast")).toContainText("已复制");
      const url = await page.evaluate(() => navigator.clipboard.readText());
      expect(new URL(url).search).toBe("");
      expect(new URL(url).pathname).toMatch(/^\/s\/[A-Za-z0-9_-]{43}$/);
      const expectedUrl = (
        await (
          await context.request.get(`/api/subscriptions/${p.id}/url`)
        ).json()
      ).url;
      expect(url).toBe(expectedUrl);
      links.push(url);
      const body = await (await context.request.get(url)).text();
      expect(
        count
          ? Buffer.from(body, "base64").toString("utf8").split("\n").length
          : body,
      ).toBe(count || "");
      const preview = card.getByRole("button", { name: "预览", exact: true });
      await preview.focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("heading", { name: "通用订阅预览" }),
      ).toBeVisible();
      await expect(
        page.getByText(`节点数量：${count}`, { exact: true }),
      ).toBeVisible();
      if (!count) {
        await page
          .getByText("高级：查看解码后的 URI（含凭据）", { exact: true })
          .click();
        await expect(
          page.getByText("（空订阅）", { exact: true }),
        ).toBeVisible();
      }
      await page.getByRole("button", { name: "关闭", exact: true }).click();
      await expect(preview).toBeFocused();
      await card.getByRole("button", { name: "二维码", exact: true }).click();
      await expect(
        page.getByRole("dialog").getByRole("link", { name: "订阅链接" }),
      ).toHaveAttribute("href", url);
      await expect(
        page.getByRole("img", { name: "订阅二维码" }),
      ).toHaveAttribute("src", /^data:image\/png;base64,/);
      await page.getByRole("button", { name: "关闭", exact: true }).click();
      const box = await card.boundingBox();
      expect(box).not.toBeNull();
      for (const button of await card.getByRole("button").all()) {
        const b = await button.boundingBox();
        expect(b).not.toBeNull();
        expect(b!.x).toBeGreaterThanOrEqual(box!.x);
        expect(b!.x + b!.width).toBeLessThanOrEqual(box!.x + box!.width + 1);
        expect(b!.height).toBeGreaterThanOrEqual(36);
      }
      await page.screenshot({
        path: `test-results/subscriptions-${label}-${width}.png`,
        fullPage: true,
      });
      await card.getByRole("button", { name: "管理订阅", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "订阅分发" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "← 返回订阅列表" }).click();
    }
    expect(links[0]).not.toBe(links[1]);
    for (const id of profileIds)
      await context.request.delete(`/api/subscriptions/${id}`, { headers });
    for (const node of imported)
      await context.request.delete(`/api/nodes/${node.id}`, {
        headers,
        data: { confirm: true },
      });
  });
}
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
    .fill(vless + "\nINVALID\n" + vmess);
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
  await page.getByRole("button", { name: "管理订阅", exact: true }).click();
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
  const a = page.getByLabel("拖动 E2E VLESS"),
    b = page.getByLabel("拖动 E2E VMess");
  const first = await a.boundingBox(),
    second = await b.boundingBox();
  if (!first || !second) throw new Error("Missing handles");
  await page.mouse.move(first.x + 8, first.y + 8);
  await page.mouse.down();
  await page.mouse.move(second.x + 8, second.y + second.height + 6, {
    steps: 15,
  });
  await page.mouse.up();
  await expect(page.locator(".selected-node").first()).toContainText(
    "E2E VMess",
  );
  await page.getByRole("button", { name: "保存节点与顺序" }).click();
  await expect(page.locator(".toast")).toContainText("节点关联与顺序已保存");
  const universal = page.locator(".link-row").filter({ hasText: "通用订阅" });
  await expect(page.locator(".link-row")).toHaveCount(1);
  await expect(page.getByText("Raw URI", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Shadowrocket", { exact: true })).toHaveCount(0);
  await universal.getByRole("button", { name: "复制订阅链接" }).click();
  await expect(page.locator(".toast")).toContainText("已复制");
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(url).search).toBe("");
  expect(new URL(url).pathname).toMatch(/^\/s\/[A-Za-z0-9_-]{43}$/);
  const before = await context.request.get(url);
  expect(before.status()).toBe(200);
  expect(
    Buffer.from(await before.text(), "base64")
      .toString("utf8")
      .split("\n")[0],
  ).toMatch(/^vmess:/);
  await universal.getByRole("button", { name: "二维码" }).click();
  await expect(
    page.getByRole("dialog").getByRole("link", { name: "订阅链接" }),
  ).toHaveAttribute("href", url);
  const modules = QRCode.create(url).modules;
  // Browser canvas and Node PNG encoders differ; compare the actual QR module pixels.
  const pixels = await page
    .getByRole("img", { name: "订阅二维码" })
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
  await universal.getByRole("button", { name: "预览" }).click();
  await expect(
    page.getByRole("heading", { name: "通用订阅预览" }),
  ).toBeVisible();
  await expect(page.getByText("节点数量：2", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("list", { name: "订阅节点顺序" }).locator("li").first(),
  ).toHaveText("VMESS · E2E VMess");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "重新生成 Token" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(page.locator(".toast")).toContainText("操作已完成");
  expect((await context.request.get(url)).status()).toBe(404);
  await page.getByLabel("启用订阅", { exact: true }).uncheck();
  await page.getByRole("button", { name: "保存信息" }).click();
  await universal.getByRole("button", { name: "复制订阅链接" }).click();
  const rotated = await page.evaluate(() => navigator.clipboard.readText());
  expect(rotated).not.toBe(url);
  expect(new URL(rotated).search).toBe("");
  expect((await context.request.get(rotated)).status()).toBe(404);
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
});
