import { test, expect } from "@playwright/test";

test("subscription distribution reuses the list multi-client dialog at all widths", async ({
  page,
  context,
  baseURL,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  const existing = process.env.DXDY_ACCEPTANCE_EXISTING === "1";
  if (!existing) {
    await page
      .getByLabel("密码", { exact: true })
      .fill("Synthetic-e2e-password-123!");
    await page.getByRole("button", { name: "安全登录" }).click();
  }
  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
  await page.getByRole("link", { name: "订阅", exact: true }).click();
  if (!existing) {
    await page.getByRole("button", { name: "创建订阅", exact: true }).click();
    const create = page.getByRole("dialog", { name: "创建订阅" });
    await create.getByLabel("订阅名称").fill("UI distribution fixture");
    await create.getByRole("button", { name: "创建订阅", exact: true }).click();
    await expect(create).not.toBeVisible();
    await page.getByRole("button", { name: "管理订阅", exact: true }).click();
    await page.getByRole("button", { name: "添加节点", exact: true }).click();
    await page.getByRole("button", { name: /添加节点链接/ }).click();
    await page
      .getByLabel("独立节点链接")
      .fill("trojan://synthetic-ui@ui.example.test:443#UI-fixture");
    await page.getByRole("button", { name: "解析预览", exact: true }).click();
    await page.getByRole("button", { name: "确认添加", exact: true }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await page
      .getByRole("button", { name: "返回订阅列表", exact: true })
      .click();
  }
  const subscriptions = await (
    await context.request.get("/api/subscriptions")
  ).json();
  const profile = subscriptions.find(
    (s: { node_count: number }) => s.node_count > 0,
  );
  expect(Boolean(profile)).toBe(true);
  const read = async (route: string) =>
    (await context.request.get(route)).json();
  const clients = await read(`/api/subscriptions/${profile.id}/clients`);
  const clashMeta = clients.profiles.find(
    (client: { id: string }) => client.id === "clash-meta",
  );
  expect(clashMeta).toMatchObject({
    name: "Clash Meta / Mihomo",
    family: "mihomo",
  });
  const preview = await read(`/api/subscriptions/${profile.id}/preview`);
  const before = await read(`/api/subscriptions/${profile.id}/entries`);
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
  const row = () =>
    page
      .locator(".subscription-row")
      .filter({ has: page.getByText(profile.name, { exact: true }) });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await row().getByRole("button", { name: "多客户端", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "多客户端订阅",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText("Clash Meta / Mihomo", { exact: true }),
    ).toBeVisible();
    const listText = await dialog.innerText();
    await dialog
      .getByRole("button", { name: "复制智能订阅", exact: true })
      .click();
    await expect
      .poll(async () => (await clipboard()) === clients.smart_url)
      .toBe(true);
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await row().getByRole("button", { name: "管理订阅", exact: true }).click();
    const distribution = page.locator(".subscription-distribution");
    await expect(
      distribution.getByRole("heading", { name: "订阅分发" }),
    ).toBeVisible();
    const button = distribution.getByRole("button", {
      name: "多客户端",
      exact: true,
    });
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await button.click();
    await expect(dialog).toBeVisible();
    expect(await dialog.innerText()).toBe(listText);
    await dialog
      .getByRole("button", { name: "复制现有通用订阅", exact: true })
      .click();
    await expect
      .poll(async () => (await clipboard()) === clients.legacy_url)
      .toBe(true);
    await dialog
      .getByRole("button", { name: "复制智能订阅", exact: true })
      .click();
    await expect
      .poll(async () => (await clipboard()) === clients.smart_url)
      .toBe(true);
    for (const client of clients.profiles) {
      const copy = dialog.getByRole("button", {
        name: `复制 ${client.name}`,
        exact: true,
      });
      if (client.counts.rendered === 0) await expect(copy).toBeDisabled();
      else {
        await copy.scrollIntoViewIfNeeded();
        await copy.click();
        await expect
          .poll(async () => (await clipboard()) === client.url)
          .toBe(true);
      }
    }
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await distribution
      .getByRole("button", { name: "复制订阅链接", exact: true })
      .click();
    await expect
      .poll(async () => (await clipboard()) === clients.legacy_url)
      .toBe(true);
    await distribution
      .getByRole("button", { name: "复制解码预览", exact: true })
      .click();
    await expect
      .poll(async () => (await clipboard()) === preview.decoded)
      .toBe(true);
    await distribution
      .getByRole("button", { name: `二维码 ${profile.name}`, exact: true })
      .click();
    const qr = page.getByRole("dialog", { name: "订阅二维码", exact: true });
    await expect(qr.getByRole("img")).toBeVisible();
    await qr.getByRole("button", { name: "关闭", exact: true }).click();
    await page
      .getByRole("button", { name: "返回订阅列表", exact: true })
      .click();
  }
  expect(await read(`/api/subscriptions/${profile.id}/entries`)).toEqual(
    before,
  );
  expect(await read("/api/subscriptions")).toEqual(subscriptions);
  expect(new URL(clients.legacy_url).origin).toBe(baseURL);
});
