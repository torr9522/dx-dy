import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const password = "Synthetic-e2e-password-123!";
const prefix = "Saved Batch E2E";

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "安全登录" }).click();
  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
}

async function selectSavedNode(page: Page, name: string) {
  await page.getByLabel("搜索当前订阅节点").fill(name);
  await page.getByRole("checkbox", { name: `选择 ${name}` }).check();
}

async function subscriptionLines(request: APIRequestContext, url: string) {
  const separator = url.includes("?") ? "&" : "?";
  const body = await (await request.get(`${url}${separator}format=raw`)).text();
  return body.split("\n").filter(Boolean);
}

test("saved-node batch removal is a cross-search mixed draft until save", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await login(page);

  await page.getByRole("button", { name: "节点库", exact: true }).click();
  await page.getByRole("button", { name: "添加 / 批量添加节点" }).click();
  const globalUris = Array.from({ length: 6 }, (_, index) => {
    const sequence = index + 1;
    const suffix = sequence.toString(16).padStart(12, "0");
    return `vless://44444444-4444-4444-8444-${suffix}@saved-batch-${sequence}.example.com:443?encryption=none&security=tls&type=tcp#${encodeURIComponent(`${prefix} G${sequence}`)}`;
  });
  await page
    .getByLabel("节点链接", { exact: true })
    .fill(globalUris.join("\n"));
  await page.getByRole("button", { name: "解析预览", exact: true }).click();
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(page.getByText(`${prefix} G1`, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "订阅", exact: true }).click();
  await page.getByRole("button", { name: "创建订阅", exact: true }).click();
  await page.getByLabel("订阅名称").fill(prefix);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "创建订阅", exact: true })
    .click();
  await page
    .locator(".subscription-row")
    .filter({ hasText: prefix })
    .getByRole("button", { name: "管理订阅" })
    .click();
  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  await page.getByRole("button", { name: /从节点库选择节点/ }).click();
  await page.getByLabel("搜索可选节点").fill(prefix);
  await page.getByRole("checkbox", { name: "全选当前筛选节点" }).check();
  await page.getByRole("button", { name: "保存并返回" }).click();
  await expect(page.locator(".subscription-node-row")).toHaveCount(6);

  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  await page.getByRole("button", { name: /添加节点链接/ }).click();
  const localUris = [1, 2].map(
    (sequence) =>
      `trojan://synthetic-${sequence}@saved-local-${sequence}.example.com:443?security=tls&sni=saved-local-${sequence}.example.com#${encodeURIComponent(`${prefix} L${sequence}`)}`,
  );
  await page.getByLabel("独立节点链接").fill(localUris.join("\n"));
  await page.getByRole("button", { name: "解析预览" }).click();
  await page.getByRole("button", { name: "确认添加" }).click();
  await expect(page.locator(".subscription-node-row")).toHaveCount(8);

  await page
    .locator(".subscription-distribution")
    .getByRole("button", { name: "复制订阅链接" })
    .click();
  const subscriptionUrl = await page.evaluate(() =>
    navigator.clipboard.readText(),
  );
  const profileId = Number(
    (await (await context.request.get("/api/subscriptions")).json()).find(
      (profile: { id: number; name: string }) => profile.name === prefix,
    ).id,
  );

  await selectSavedNode(page, `${prefix} G1`);
  await selectSavedNode(page, `${prefix} L1`);
  await selectSavedNode(page, `${prefix} G2`);
  await expect(page.getByText("已选择 3 个", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "删除已选 3 个节点" }).click();
  const confirmation = page.getByRole("dialog", { name: "删除已选（3）" });
  await expect(confirmation).toContainText("2 个节点库节点");
  await expect(confirmation).toContainText("1 个独立节点");
  await confirmation.getByRole("button", { name: "从当前订阅移除" }).click();
  await page.getByLabel("搜索当前订阅节点").fill("");
  await expect(page.locator(".subscription-node-row")).toHaveCount(5);
  await expect(page.getByRole("heading", { name: "当前节点 5" })).toBeVisible();
  expect(
    await (
      await context.request.get(`/api/subscriptions/${profileId}/entries`)
    ).json(),
  ).toHaveLength(8);
  expect(
    await subscriptionLines(context.request, subscriptionUrl),
  ).toHaveLength(8);

  await page.getByRole("button", { name: "放弃更改" }).click();
  await expect(page.locator(".subscription-node-row")).toHaveCount(8);
  await expect(
    page.getByRole("heading", { name: "已保存节点 8" }),
  ).toBeVisible();

  await selectSavedNode(page, `${prefix} G1`);
  await selectSavedNode(page, `${prefix} L1`);
  await selectSavedNode(page, `${prefix} G2`);
  await page.getByRole("button", { name: "删除已选 3 个节点" }).click();
  await page
    .getByRole("dialog", { name: "删除已选（3）" })
    .getByRole("button", { name: "从当前订阅移除" })
    .click();
  await page.getByRole("button", { name: "保存节点与顺序" }).click();
  await expect(page.locator(".toast")).toContainText("节点与顺序已保存");
  await page.reload();
  await page.getByRole("button", { name: "订阅", exact: true }).click();
  await page
    .locator(".subscription-row")
    .filter({ hasText: prefix })
    .getByRole("button", { name: "管理订阅" })
    .click();
  await expect(page.locator(".subscription-node-row")).toHaveCount(5);
  expect(
    await (
      await context.request.get(`/api/subscriptions/${profileId}/entries`)
    ).json(),
  ).toHaveLength(5);
  expect(
    await subscriptionLines(context.request, subscriptionUrl),
  ).toHaveLength(5);

  await page.getByRole("button", { name: "节点库", exact: true }).click();
  await page.getByLabel("搜索全部节点", { exact: true }).fill(`${prefix} G`);
  await expect(page.locator("tbody tr")).toHaveCount(6);

  await page.getByRole("button", { name: "订阅", exact: true }).click();
  const subscriptionRow = page
    .locator(".subscription-row")
    .filter({ hasText: prefix });
  await subscriptionRow
    .getByRole("button", { name: "删除", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "删除订阅" })
    .getByRole("button", { name: "确认" })
    .click();
  await page.getByRole("button", { name: "节点库", exact: true }).click();
  await page.getByLabel("搜索全部节点", { exact: true }).fill(`${prefix} G`);
  await page.getByRole("checkbox", { name: "全选当前节点" }).check();
  await page.getByRole("button", { name: /删除已选（6）/ }).click();
  await page
    .getByRole("dialog", { name: "删除已选（6）" })
    .getByRole("button", { name: "确认" })
    .click();
});
