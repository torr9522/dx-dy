import { ensureRegressionGroup } from "./group-setup";
import { expect, type Page, type BrowserContext } from "@playwright/test";

export async function cascadingDeleteFlow(page: Page, context: BrowserContext) {
  page.setDefaultTimeout(10000);
  const prefix = `D028-${Date.now()}`;
  const names = [`${prefix}-A`, `${prefix}-B`, `${prefix}-Unused`];
  const uris = names.map(
    (name, index) =>
      `trojan://synthetic-delete-only@delete.example.test:${44000 + index}?sni=delete.example.test#${name}`,
  );
  await page.goto("/", { waitUntil: "networkidle" });
  if (await page.getByRole("button", { name: "安全登录" }).isVisible()) {
    await page
      .getByLabel("用户名", { exact: true })
      .fill(process.env.DXDY_UI_USERNAME || "admin");
    await page
      .getByLabel("密码", { exact: true })
      .fill(process.env.DXDY_UI_PASSWORD || "Synthetic-e2e-password-123!");
    await page.getByRole("button", { name: "安全登录" }).click();
    await ensureRegressionGroup(page);
  }
  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
  const readProfiles = async () =>
    (await (await context.request.get("/api/subscriptions")).json()) as {
      id: number;
      name: string;
      node_count: number;
      enabled: boolean;
    }[];
  const baseline = (await readProfiles()).map((p) => p.id);
  const list = async () => {
    await page.getByRole("link", { name: "订阅", exact: true }).click();
  };
  const library = async () => {
    await page.getByRole("link", { name: "节点库", exact: true }).click();
  };
  await library();
  await page.getByRole("button", { name: "添加 / 批量添加节点" }).click();
  const importer = page.getByRole("dialog", { name: "粘贴节点链接" });
  await importer.getByLabel("节点链接", { exact: true }).fill(uris.join("\n"));
  await importer.getByRole("button", { name: "解析预览", exact: true }).click();
  await importer.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(importer).not.toBeVisible();

  for (let i = 0; i < 15; i++) {
    await list();
    await page.getByRole("button", { name: "创建订阅", exact: true }).click();
    const create = page.getByRole("dialog", { name: "创建订阅" });
    await create
      .getByLabel("订阅名称")
      .fill(`${prefix}-Subscription-${i}-${"long-name-".repeat(5)}`);
    await create.getByRole("button", { name: "创建订阅", exact: true }).click();
    await expect(create).not.toBeVisible();
    const row = page
      .locator(".subscription-row")
      .filter({ hasText: `${prefix}-Subscription-${i}-` });
    await row.getByRole("button", { name: "管理订阅" }).click();
    await page.getByRole("button", { name: "添加节点", exact: true }).click();
    await page.getByRole("button", { name: /从节点库选择节点/ }).click();
    await page.getByLabel("搜索可选节点").fill(prefix);
    await page
      .getByRole("checkbox", { name: `选择订阅节点 ${names[0]}`, exact: true })
      .check();
    if (i === 0)
      await page
        .getByRole("checkbox", {
          name: `选择订阅节点 ${names[1]}`,
          exact: true,
        })
        .check();
    await page.getByRole("button", { name: "保存并返回" }).click();
    if (i === 0) {
      await page.getByRole("button", { name: "添加节点", exact: true }).click();
      await page.getByRole("button", { name: /添加节点链接/ }).click();
      await page.getByLabel("独立节点链接").fill(uris[0]);
      await page.getByRole("button", { name: "解析预览", exact: true }).click();
      await expect(page.getByLabel("导入独立节点第 1 行")).toBeEnabled();
      await page.getByLabel("独立节点第 1 行名称").fill(`${prefix}-Local`);
      await page.getByRole("button", { name: "确认添加" }).click();
      await expect(page.locator(".subscription-node-row")).toHaveCount(3);
    }
  }
  const profiles = (await readProfiles()).filter((p) =>
    p.name.startsWith(prefix),
  );
  expect(profiles).toHaveLength(15);
  const urls = new Map<number, string>();
  for (const p of profiles)
    urls.set(
      p.id,
      (
        await (
          await context.request.get(`/api/subscriptions/${p.id}/url`)
        ).json()
      ).url,
    );
  const feed = async (id: number) => {
    const response = await context.request.get(urls.get(id)!);
    expect(response.status()).toBe(200);
    return Buffer.from(await response.text(), "base64")
      .toString("utf8")
      .split("\n")
      .filter(Boolean);
  };
  const mixed = profiles.find((p) =>
    p.name.startsWith(`${prefix}-Subscription-0-`),
  )!;
  expect(await feed(mixed.id)).toHaveLength(3);
  await library();
  await page.getByLabel("搜索全部节点", { exact: true }).fill(prefix);
  const deleteA = page.getByRole("button", {
    name: `删除 ${names[0]}`,
    exact: true,
  });
  await deleteA.click();
  const single = page.getByRole("dialog", { name: "删除节点", exact: true });
  await expect(single).toContainText("15 个订阅");
  await expect(single).toContainText("15 条订阅节点引用");
  await expect(single).toContainText("+ 11 个");
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      single.getByRole("button", { name: "删除节点并从订阅移除" }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    expect(
      await single.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    expect(
      await single
        .getByRole("button", { name: "删除节点并从订阅移除" })
        .evaluate((element) => element === document.activeElement),
    ).toBe(false);
  }
  await single.getByRole("button", { name: "取消" }).click();
  expect(await feed(mixed.id)).toHaveLength(3);
  await deleteA.click();
  await single.getByRole("button", { name: "删除节点并从订阅移除" }).click();
  await expect(deleteA).toHaveCount(0);
  const remaining = await feed(mixed.id);
  expect(remaining).toHaveLength(2);
  expect(remaining[0]).toContain(":44001");
  expect(remaining[1]).toContain(":44000");
  for (const p of profiles) {
    const after = (await readProfiles()).find((row) => row.id === p.id)!;
    expect(after.enabled).toBe(p.enabled);
    expect(after.node_count).toBe(p.id === mixed.id ? 2 : 0);
    expect(
      (
        await (
          await context.request.get(`/api/subscriptions/${p.id}/url`)
        ).json()
      ).url,
    ).toBe(urls.get(p.id));
    if (p.id !== mixed.id) expect(await feed(p.id)).toEqual([]);
  }
  for (const name of names.slice(1))
    await page
      .getByRole("checkbox", { name: `选择 ${name}`, exact: true })
      .check();
  await page.getByRole("button", { name: "删除已选（2）" }).click();
  const batch = page.getByRole("dialog", { name: "删除已选（2）" });
  await expect(batch).toContainText("2 个节点");
  await expect(batch).toContainText("其中 1 个节点正在被 1 个订阅使用");
  await expect(batch).toContainText("1 条订阅节点引用");
  await batch.getByRole("button", { name: "取消" }).click();
  expect(await feed(mixed.id)).toHaveLength(2);
  await page.getByRole("button", { name: "删除已选（2）" }).click();
  await batch.getByRole("button", { name: "删除节点并从订阅移除" }).click();
  await expect(page.getByRole("button", { name: "删除已选（2）" })).toHaveCount(
    0,
  );
  const final = await feed(mixed.id);
  expect(final).toHaveLength(1);
  expect(final[0]).toContain(":44000");
  await list();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    const row = page
      .locator(".subscription-row")
      .filter({ hasText: mixed.name });
    await expect(
      row.locator(".subscription-row-actions button:visible"),
    ).toHaveCount(5);
  }
  for (const p of profiles) {
    const row = page.locator(".subscription-row").filter({ hasText: p.name });
    await row.getByRole("button", { name: "删除", exact: true }).click();
    await page
      .getByRole("dialog", { name: "删除订阅" })
      .getByRole("button", { name: "确认", exact: true })
      .click();
    await expect(row).toHaveCount(0);
  }
  expect((await readProfiles()).map((p) => p.id)).toEqual(baseline);
}
