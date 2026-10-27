import { expect, type Page, type BrowserContext } from "@playwright/test";
import { createHash } from "node:crypto";

const prefix = "D029-GROUP-DELETE-";
type Hook = () => Promise<void>;
export async function groupDeleteAcceptance(
  page: Page,
  context: BrowserContext,
  beforeDelete?: Hook,
) {
  page.setDefaultTimeout(20000);
  const read = async (route: string) => {
    const response = await context.request.get(route);
    expect(response.status()).toBe(200);
    return response.json();
  };
  const hash = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const snapshot = async () => {
    const groups = await read("/api/node-groups");
    const nodes = await read("/api/nodes");
    const collections = await read("/api/collections");
    const subscriptions = await read("/api/subscriptions");
    const details = [];
    for (const sub of subscriptions) {
      const entries = await read(`/api/subscriptions/${sub.id}/entries`);
      const clients = await read(`/api/subscriptions/${sub.id}/clients`);
      const output = await context.request.get(
        new URL(clients.legacy_url).pathname,
      );
      details.push({
        entries,
        clients,
        output: hash(await output.text()),
        status: output.status(),
      });
    }
    return hash({ groups, nodes, collections, subscriptions, details });
  };
  const initial = await snapshot();
  const csrf = (await read("/api/auth/me")).csrf;
  const headers = { "X-CSRF-Token": csrf };
  const target = prefix + "Target-" + "Long-Group-Name-".repeat(4);
  const keeper = prefix + "Keeper";
  const names = ["A", "B", "C"].map((n) => prefix + n);
  const uri = (letter: string) =>
    `trojan://synthetic-group-delete-${letter}@group-delete-${letter.toLowerCase()}.example.test:443?sni=group-delete-${letter.toLowerCase()}.example.test#${prefix}${letter}`;
  const library = async (name?: string) => {
    await page.getByRole("link", { name: "节点库", exact: true }).click();
    if (name)
      await page
        .getByRole("button", { name: new RegExp(`^${name}\\s`) })
        .click();
  };
  const refresh = async () => {
    const path = new URL(page.url()).pathname;
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}$`));
    await expect(page.locator(".shell")).toBeVisible();
  };
  const createGroup = async (name: string) => {
    await library();
    await page.getByRole("button", { name: "新建分组", exact: true }).click();
    const d = page.getByRole("dialog", { name: "创建分组" });
    await d.getByLabel("分组名称").fill(name);
    await d.getByRole("button", { name: "保存分组" }).click();
    await expect(d).not.toBeVisible();
  };
  const importNodes = async (group: string, letters: string[]) => {
    await library(group);
    await page.getByRole("button", { name: "添加 / 批量添加节点" }).click();
    const d = page.getByRole("dialog", { name: "粘贴节点链接" });
    await d
      .getByLabel("节点链接", { exact: true })
      .fill(letters.map(uri).join("\n"));
    await d.getByRole("button", { name: "解析预览", exact: true }).click();
    await d.getByRole("button", { name: "确认导入", exact: true }).click();
    await expect(d).not.toBeVisible();
  };
  const subRow = (name: string) =>
    page
      .locator(".subscription-row")
      .filter({ has: page.getByText(name, { exact: true }) });
  const createSub = async (name: string, selections: [string, string[]][]) => {
    await page.getByRole("link", { name: "订阅", exact: true }).click();
    await page.getByRole("button", { name: "创建订阅", exact: true }).click();
    const d = page.getByRole("dialog", { name: "创建订阅" });
    await d.getByLabel("订阅名称").fill(name);
    await d.getByRole("button", { name: "创建订阅", exact: true }).click();
    await expect(d).not.toBeVisible();
    await subRow(name)
      .getByRole("button", { name: "管理订阅", exact: true })
      .click();
    await page.getByRole("button", { name: "添加节点", exact: true }).click();
    await page.getByRole("button", { name: /从节点库选择节点/ }).click();
    for (const [group, letters] of selections) {
      await page
        .getByLabel("节点来源")
        .getByRole("button", { name: new RegExp(`^${group}\\s`) })
        .click();
      for (const letter of letters)
        await page
          .getByRole("checkbox", {
            name: `选择订阅节点 ${prefix}${letter}`,
            exact: true,
          })
          .check();
    }
    await page.getByRole("button", { name: "保存并返回", exact: true }).click();
    await expect(page.locator(".subscription-node-row").first()).toBeVisible();
    return (await read("/api/subscriptions")).find(
      (s: { name: string }) => s.name === name,
    );
  };
  await createGroup(target);
  await importNodes(target, ["A", "B", "C"]);
  await createGroup(keeper);
  await importNodes(keeper, ["A"]);
  const mixed = await createSub(prefix + "Mixed", [
    [target, ["A", "B"]],
    [keeper, ["A"]],
  ]);
  await page.getByRole("button", { name: "添加节点", exact: true }).click();
  await page.getByRole("button", { name: /添加节点链接/ }).click();
  await page.getByLabel("独立节点链接").fill(uri("A"));
  await page.getByRole("button", { name: "解析预览", exact: true }).click();
  await page.getByRole("button", { name: "确认添加", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const empty = await createSub(prefix + "Empty", [[target, ["A", "C"]]]);
  const another = await createSub(prefix + "Another", [
    [target, ["A"]],
    [keeper, ["A"]],
  ]);
  const collectionName = prefix + "Collection";
  const membershipNodes = await read("/api/nodes");
  const targetNodes = membershipNodes.filter(
    (n: { group_name: string }) => n.group_name === target,
  );
  const keptNode = membershipNodes.find(
    (n: { group_name: string }) => n.group_name === keeper,
  );
  const collectionResponse = await context.request.post("/api/collections", {
    headers,
    data: { name: collectionName },
  });
  expect(collectionResponse.status()).toBe(201);
  expect(collectionResponse.headers()["deprecation"]).toBe("true");
  const collection = await collectionResponse.json();
  const membershipResponse = await context.request.post(
    `/api/collections/${collection.id}/nodes`,
    {
      headers,
      data: { node_ids: [targetNodes[0].id, keptNode.id] },
    },
  );
  expect(membershipResponse.status()).toBe(200);
  expect(membershipResponse.headers()["deprecation"]).toBe("true");
  const allNodes = await read("/api/nodes");
  const saved = [];
  for (const sub of [mixed, empty, another]) {
    const entries = await read(`/api/subscriptions/${sub.id}/entries`);
    const clients = await read(`/api/subscriptions/${sub.id}/clients`);
    saved.push({ sub, entries, clients });
  }
  const prepared = await snapshot();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await library(target);
    const button = page.getByRole("button", {
      name: `删除分组 ${target}`,
      exact: true,
    });
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeInViewport();
    await button.click();
    const d = page.getByRole("dialog", { name: "删除分组", exact: true });
    await expect(d).toContainText(target);
    await expect(d).toContainText("Global Nodes：3");
    await expect(d).toContainText("受影响订阅：3");
    await expect(d).toContainText("将移除订阅节点引用：5");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(await d.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    await expect(
      d.getByRole("button", { name: "删除分组及其全部节点" }),
    ).toBeInViewport();
    await d.getByRole("button", { name: "取消", exact: true }).click();
    await expect(d).not.toBeVisible();
    await refresh();
    expect((await snapshot()) === prepared).toBe(true);
  }
  if (beforeDelete) await beforeDelete();
  await library(target);
  await page
    .getByRole("button", { name: `删除分组 ${target}`, exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "删除分组", exact: true })
    .getByRole("button", { name: "删除分组及其全部节点" })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await refresh();
  const remainingNodes = await read("/api/nodes");
  expect(hash(remainingNodes)).toBe(
    hash(
      allNodes.filter(
        (n: { id: number }) =>
          !targetNodes.some((t: { id: number }) => t.id === n.id),
      ),
    ),
  );
  expect(
    (await read("/api/node-groups")).some(
      (g: { name: string }) => g.name === target,
    ),
  ).toBe(false);
  for (const old of saved) {
    const sub = (await read("/api/subscriptions")).find(
      (s: { id: number }) => s.id === old.sub.id,
    );
    const clients = await read(`/api/subscriptions/${sub.id}/clients`);
    expect(hash(clients.profiles.map((p: { url: string }) => p.url))).toBe(
      hash(old.clients.profiles.map((p: { url: string }) => p.url)),
    );
    expect(
      hash([
        clients.legacy_url,
        clients.smart_url,
        sub.name,
        sub.remark,
        sub.enabled,
      ]),
    ).toBe(
      hash([
        old.clients.legacy_url,
        old.clients.smart_url,
        old.sub.name,
        old.sub.remark,
        old.sub.enabled,
      ]),
    );
    const entries = await read(`/api/subscriptions/${sub.id}/entries`);
    const expected = old.entries
      .filter(
        (e: { source: string; node: { id: number } }) =>
          e.source === "local" || e.node.id === keptNode.id,
      )
      .map((e: object, position: number) => ({ ...e, position }));
    expect(hash(entries)).toBe(hash(expected));
    const output = await context.request.get(
      new URL(clients.legacy_url).pathname,
    );
    expect(output.status()).toBe(200);
    const lines = Buffer.from(await output.text(), "base64")
      .toString()
      .split("\n")
      .filter(Boolean);
    expect(lines).toHaveLength(expected.length);
    expect(
      lines.every(
        (line) => decodeURIComponent(line.split("#").at(-1)!) === names[0],
      ),
    ).toBe(true);
    for (const client of clients.profiles) {
      const response = await context.request.get(new URL(client.url).pathname);
      expect(response.status()).toBe(expected.length ? 200 : 422);
      expect(Number(response.headers()["x-subscription-rendered"])).toBe(
        expected.length,
      );
    }
    await page.getByRole("link", { name: "订阅", exact: true }).click();
    await subRow(sub.name)
      .getByRole("button", { name: "管理订阅", exact: true })
      .click();
    await expect(page.locator(".subscription-node-row")).toHaveCount(
      expected.length,
    );
    await refresh();
  }
  expect(
    (await read("/api/collections")).find(
      (c: { name: string }) => c.name === collectionName,
    ).node_count,
  ).toBe(1);
  for (const sub of [mixed, empty, another]) {
    await page.getByRole("link", { name: "订阅", exact: true }).click();
    await subRow(sub.name)
      .getByRole("button", { name: "删除", exact: true })
      .click();
    const d = page.getByRole("dialog", { name: "删除订阅", exact: true });
    await d.getByRole("button", { name: "确认", exact: true }).click();
    await expect(d).not.toBeVisible();
  }
  await library(keeper);
  await page
    .getByRole("button", { name: `删除分组 ${keeper}`, exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "删除分组", exact: true })
    .getByRole("button", { name: "删除分组及其全部节点" })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await createGroup(prefix + "Empty-Group");
  await page
    .getByRole("button", { name: `删除分组 ${prefix}Empty-Group`, exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: `删除分组 ${prefix}Empty-Group`,
      exact: true,
    }),
  ).not.toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  const collectionDelete = await context.request.delete(
    `/api/collections/${collection.id}`,
    { headers },
  );
  expect(collectionDelete.status()).toBe(200);
  expect(collectionDelete.headers()["deprecation"]).toBe("true");
  await refresh();
  expect((await snapshot()) === initial).toBe(true);
  return {
    status: "PASS",
    targetNodes: 3,
    affectedSubscriptions: 3,
    removedReferences: 5,
    beforeEntries: [4, 2, 2],
    afterEntries: [2, 0, 1],
    responsive: [1440, 768, 390],
    originalData: "unchanged",
    cleanup: "UI only",
  };
}
