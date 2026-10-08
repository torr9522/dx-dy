import { test, expect } from "@playwright/test";
import { fixtures, vless, vmess } from "../fixtures";
import QRCode from "qrcode";
for (const width of [1280, 390, 320]) {
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
    const keeper = await (
      await context.request.post("/api/subscriptions", {
        headers,
        data: { name: `Shared keeper ${width}` },
      })
    ).json();
    await context.request.put(`/api/subscriptions/${keeper.id}/nodes`, {
      headers,
      data: { node_ids: imported.map((n: { id: number }) => n.id) },
    });
    const globalNodes = await (await context.request.get("/api/nodes")).json();
    for (const [label, count] of [
      ["Empty", 0],
      ["Mixed", 2],
      ["Disabled", 2],
    ] as const) {
      const name = `${label} quick ${width}`;
      const p = await (
        await context.request.post("/api/subscriptions", {
          headers,
          data: { name, enabled: label !== "Disabled" },
        })
      ).json();
      if (count)
        await context.request.put(`/api/subscriptions/${p.id}/nodes`, {
          headers,
          data: { node_ids: imported.map((n: { id: number }) => n.id) },
        });
      await page.reload();
      await page.getByRole("button", { name: "订阅", exact: true }).click();
      const card = page.locator(".profile-card").filter({ hasText: name });
      await expect(card).toBeVisible();
      for (const action of ["复制订阅链接", "二维码", "删除订阅", "管理订阅"])
        await expect(
          card.getByRole("button", { name: action, exact: true }),
        ).toBeVisible();
      await expect(
        card.getByRole("button", { name: "预览", exact: true }),
      ).toHaveCount(0);
      await expect(card.getByRole("group").getByRole("button")).toHaveText([
        "复制订阅",
        "二维码",
        "删除订阅",
      ]);
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
      const response = await context.request.get(url);
      const body = await response.text();
      if (label === "Disabled") expect(response.status()).toBe(404);
      else
        expect(
          count
            ? Buffer.from(body, "base64").toString("utf8").split("\n").length
            : body,
        ).toBe(count || "");
      await card.getByRole("button", { name: "二维码", exact: true }).click();
      await expect(
        page.getByRole("dialog").getByRole("link", { name: "订阅链接" }),
      ).toHaveAttribute("href", url);
      await expect(
        page.getByRole("img", { name: "订阅二维码" }),
      ).toHaveAttribute("src", /^data:image\/png;base64,/);
      await page.getByRole("button", { name: "关闭", exact: true }).click();
      await expect(
        card.getByRole("button", { name: "二维码", exact: true }),
      ).toBeFocused();
      const box = await card.boundingBox();
      expect(box).not.toBeNull();
      for (const button of await card.getByRole("button").all()) {
        const b = await button.boundingBox();
        expect(b).not.toBeNull();
        expect(b!.x).toBeGreaterThanOrEqual(box!.x);
        expect(b!.x + b!.width).toBeLessThanOrEqual(box!.x + box!.width + 1);
        expect(b!.height).toBeGreaterThanOrEqual(36);
      }
      const quick = await card.getByRole("group").getByRole("button").all();
      const boxes = await Promise.all(quick.map((b) => b.boundingBox()));
      expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x);
      expect(boxes[1]!.x).toBeLessThan(boxes[2]!.x);
      expect(boxes[0]!.y).toBe(boxes[2]!.y);
      await page.screenshot({
        path: `test-results/subscriptions-${label}-${width}.png`,
        fullPage: true,
      });
      await card.getByRole("button", { name: "管理订阅", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "订阅分发" }),
      ).toBeVisible();
      const preview = page.getByRole("button", { name: "预览", exact: true });
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
      await page.getByRole("button", { name: "← 返回订阅列表" }).click();
      const deletion = card.getByRole("button", {
        name: "删除订阅",
        exact: true,
      });
      await deletion.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText(name);
      await expect(dialog).toContainText("当前订阅链接立即失效");
      await expect(dialog).toContainText("全局节点本身不会被删除");
      await page.getByRole("button", { name: "取消", exact: true }).click();
      await expect(deletion).toBeFocused();
      await expect(card).toBeVisible();
      expect(
        (await (await context.request.get("/api/subscriptions")).json()).some(
          (s: { id: number }) => s.id === p.id,
        ),
      ).toBeTruthy();
      await deletion.click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "确认", exact: true })
        .click();
      await expect(card).toHaveCount(0);
      await expect(page.locator(".toast")).toContainText("订阅已删除");
      await expect(
        page.getByRole("button", { name: "订阅", exact: true }),
      ).toBeFocused();
      const remaining = await (
        await context.request.get("/api/subscriptions")
      ).json();
      expect(remaining.some((s: { id: number }) => s.id === p.id)).toBeFalsy();
      expect(
        remaining.find((s: { id: number }) => s.id === keeper.id).node_ids,
      ).toEqual(imported.map((n: { id: number }) => n.id));
      expect(await (await context.request.get("/api/nodes")).json()).toEqual(
        globalNodes,
      );
      expect((await context.request.get(url)).status()).toBe(404);
      await page.getByRole("button", { name: "节点库", exact: true }).click();
      for (const node of imported)
        await expect(page.locator("table")).toContainText(node.name);
      await page.getByRole("button", { name: "订阅", exact: true }).click();
    }
    expect(links[0]).not.toBe(links[1]);
    await context.request.delete(`/api/subscriptions/${keeper.id}`, {
      headers,
    });
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
  await page.getByLabel("下移 E2E VLESS").click();
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
  await expect(page.locator(".toast")).toContainText("已复制到剪贴板");
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
    .locator(".profile-card")
    .filter({ hasText: profile.name })
    .getByRole("button", { name: "管理订阅" })
    .click();
  await expect(page.getByLabel("节点来源").getByText("节点库")).toBeVisible();
  await expect(page.getByLabel("节点来源").getByText("节点集合")).toBeVisible();
  await page
    .getByLabel("节点来源")
    .getByRole("button", { name: /全部节点/ })
    .click();
  await page.getByLabel("搜索可选节点").fill("Collection VLESS");
  await page.getByRole("checkbox", { name: "全选当前候选节点" }).check();
  await page
    .getByLabel("节点来源")
    .getByRole("button", { name: /E2E-G/ })
    .click();
  await page.getByLabel("搜索可选节点").fill("Collection VMess");
  await page.getByRole("checkbox", { name: "全选当前候选节点" }).check();
  await page.getByRole("button", { name: "查看已选择 2 个" }).click();
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
  await page.getByRole("button", { name: "保存节点与顺序" }).click();
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
  const card = page.locator(".profile-card").filter({ hasText: profile.name });
  await card.getByRole("button", { name: "复制订阅链接", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
    /^http:\/\/localhost:3999\/s\//,
  );
  await card.getByRole("button", { name: "二维码", exact: true }).click();
  await expect(page.getByAltText("订阅二维码")).toHaveAttribute(
    "data-subscription-url",
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
