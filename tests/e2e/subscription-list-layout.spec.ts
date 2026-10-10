import { test, expect } from "@playwright/test";

test("Subscription list is aligned, responsive and keeps every row action", async ({
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
  const names = [
    "dx",
    "family",
    "mobile-test",
    "very-long-subscription-name-example-that-must-truncate-safely",
  ];
  const profiles = [];
  for (const name of names) {
    const response = await context.request.post("/api/subscriptions", {
      headers,
      data: { name },
    });
    expect(response.status()).toBe(201);
    profiles.push(await response.json());
  }

  try {
    await page.reload();
    await page.getByRole("button", { name: "订阅", exact: true }).click();
    await expect(page.locator(".subscription-row")).toHaveCount(4);
    await expect(page.locator(".subscription-list-header")).toContainText(
      "订阅名称状态节点数操作",
    );

    await page.setViewportSize({ width: 1440, height: 900 });
    const headerCells = page.locator(".subscription-list-header > span");
    const firstCells = page
      .locator(".subscription-row")
      .first()
      .locator(":scope > *");
    for (let column = 0; column < 4; column += 1) {
      const header = await headerCells.nth(column).boundingBox();
      const cell = await firstCells.nth(column).boundingBox();
      expect(header).not.toBeNull();
      expect(cell).not.toBeNull();
      expect(Math.abs(header!.x - cell!.x)).toBeLessThanOrEqual(1);
    }
    const desktopRow = await page
      .locator(".subscription-row")
      .first()
      .boundingBox();
    expect(desktopRow!.height).toBeLessThanOrEqual(72);
    await page.screenshot({
      path: "test-results/subscription-list-layout-1440.png",
      fullPage: true,
    });

    const firstRow = page
      .locator(".subscription-row")
      .filter({ hasText: "dx" });
    await firstRow.getByRole("switch").click();
    await expect(firstRow.getByRole("switch")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await firstRow.getByRole("switch").click();
    await expect(page.locator(".toast")).toContainText("订阅已启用");
    await firstRow.getByRole("button", { name: "复制订阅链接" }).click();
    await expect(page.locator(".toast")).toContainText("已复制");
    await firstRow.getByRole("button", { name: "二维码 dx" }).click();
    await expect(
      page.getByRole("dialog", { name: "订阅二维码" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "关闭" }).click();
    await firstRow.getByRole("button", { name: "删除", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "删除订阅" })).toBeVisible();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await firstRow.getByRole("button", { name: "管理订阅" }).click();
    await expect(
      page.getByRole("heading", { name: /已保存节点/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: "返回订阅列表" }).click();
    await page.getByRole("button", { name: "创建订阅", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "创建订阅" })).toBeVisible();
    await page.keyboard.press("Escape");

    for (const width of [768, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(
        page.locator(".subscription-row-actions").first(),
      ).toBeVisible();
      for (const action of ["复制订阅链接", "二维码 dx", "管理订阅", "删除"])
        await expect(
          firstRow.getByRole("button", { name: action, exact: true }),
        ).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      expect(
        await firstRow.evaluate((element) => element.scrollWidth),
      ).toBeLessThanOrEqual(
        await firstRow.evaluate((element) => element.clientWidth),
      );
      await page.screenshot({
        path: `test-results/subscription-list-layout-${width}.png`,
        fullPage: true,
      });
    }
    const longName = page
      .locator(".subscription-row-name strong")
      .filter({ hasText: names[3] });
    await expect(longName).toHaveAttribute("title", names[3]);
    expect(
      await longName.evaluate((element) => element.scrollWidth),
    ).toBeGreaterThan(
      await longName.evaluate((element) => element.clientWidth),
    );
  } finally {
    for (const profile of profiles)
      await context.request.delete(`/api/subscriptions/${profile.id}`, {
        headers,
      });
  }
});
