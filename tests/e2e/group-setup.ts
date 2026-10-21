import { expect, type Page } from "@playwright/test";
import { chmodSync } from "node:fs";

// Existing regression flows share one explicit ownership namespace. Group
// creation uses the same DOM path as an administrator, never an implicit DB seed.
export async function ensureRegressionGroup(page: Page) {
  await page.getByRole("button", { name: "节点库", exact: true }).click();
  const group = page.getByRole("button", {
    name: /^Regression Library\s*\d*$/,
  });
  if (!(await group.count())) {
    await page.getByRole("button", { name: "新建分组", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "创建分组" });
    await dialog.getByLabel("分组名称").fill("Regression Library");
    await dialog.getByRole("button", { name: "保存分组", exact: true }).click();
    await expect(dialog).not.toBeVisible();
  }
  await group.click();
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await page
    .context()
    .storageState({ path: "test-results/regression-auth.json" });
  chmodSync("test-results/regression-auth.json", 0o600);
}
