import { test, expect } from "@playwright/test";

test("DOM import preserves equal Global and Local VMess in separate namespaces", async ({
  page,
  context,
}) => {
  const name = `Namespace-${Date.now()}`;
  const uri = `vmess://${Buffer.from(JSON.stringify({ v: "2", ps: name, add: "namespace.example.test", port: "443", id: "00000000-0000-0000-0000-000000000026", aid: "0", scy: "auto", net: "tcp", type: "none", host: "", path: "", tls: "tls" })).toString("base64")}`;
  await page.goto("/");
  await page
    .getByLabel("密码", { exact: true })
    .fill("Synthetic-e2e-password-123!");
  await page.getByRole("button", { name: "安全登录" }).click();
  await page.getByRole("button", { name: "节点库", exact: true }).click();
  await page.getByRole("button", { name: "添加 / 批量添加节点" }).click();
  const dialog = page.getByRole("dialog", { name: "粘贴节点链接" });
  await dialog.getByLabel("节点链接", { exact: true }).fill(uri);
  await dialog.getByRole("button", { name: "解析预览", exact: true }).click();
  await dialog.getByRole("button", { name: "确认导入", exact: true }).click();
  await page.getByRole("button", { name: "订阅", exact: true }).click();
  await page.getByRole("button", { name: "创建订阅", exact: true }).click();
  const create = page.getByRole("dialog", { name: "创建订阅" });
  await create.getByLabel("订阅名称").fill(name);
  await create.getByRole("button", { name: "创建订阅", exact: true }).click();
  const row = page.locator(".subscription-row").filter({ hasText: name });
  await row.getByRole("button", { name: "管理订阅" }).click();
  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  await page.getByRole("button", { name: /从节点库选择节点/ }).click();
  await page.getByLabel("搜索可选节点").fill(name);
  await page.getByRole("checkbox", { name: `选择订阅节点 ${name}` }).check();
  await page.getByRole("button", { name: "保存并返回" }).click();
  const preview = async () => {
    await page.getByRole("button", { name: "添加节点", exact: true }).click();
    await page.getByRole("button", { name: /添加节点链接/ }).click();
    await page.getByLabel("独立节点链接").fill(uri);
    await page.getByRole("button", { name: "解析预览" }).click();
  };
  await preview();
  await expect(page.getByLabel("导入独立节点第 1 行")).toBeEnabled();
  await expect(page.getByText("与当前订阅已有独立节点重复")).toHaveCount(0);
  await page.getByLabel("独立节点第 1 行名称").fill(`${name} Local`);
  await page.getByRole("button", { name: "确认添加" }).click();
  await expect(page.locator(".subscription-node-row")).toHaveCount(2);
  await page.reload();
  await page.getByRole("button", { name: "订阅", exact: true }).click();
  await row.getByRole("button", { name: "管理订阅" }).click();
  await expect(page.locator(".subscription-node-row")).toHaveCount(2);
  const profiles = await (
    await context.request.get("/api/subscriptions")
  ).json();
  const profile = profiles.find((item: { name: string }) => item.name === name);
  const { url } = await (
    await context.request.get(`/api/subscriptions/${profile.id}/url`)
  ).json();
  const output = await context.request.get(url);
  expect(
    Buffer.from(await output.text(), "base64")
      .toString("utf8")
      .split("\n")
      .filter(Boolean),
  ).toHaveLength(2);
  await preview();
  await expect(page.getByText("与当前订阅已有独立节点重复")).toBeVisible();
  await expect(page.getByLabel("导入独立节点第 1 行")).toBeDisabled();
});
