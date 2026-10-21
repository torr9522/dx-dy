import { test, expect } from "@playwright/test";
import { groupDeleteAcceptance } from "./group-delete-flow";

test("Group cascading delete preserves other namespaces, identities and Local entries", async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
  await page.goto("/");
  await page
    .getByLabel("密码", { exact: true })
    .fill("Synthetic-e2e-password-123!");
  await page.getByRole("button", { name: "安全登录" }).click();
  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
  await groupDeleteAcceptance(page, context);
});
