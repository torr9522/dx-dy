import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
if (existsSync(".env"))
  throw new Error("Environment already exists; refusing to overwrite secrets");
const adminBase = process.env.ADMIN_BASE_URL;
const subscriptionBase = process.env.SUBSCRIPTION_BASE_URL;
const origin = (value) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
};
const normalizedAdminBase = origin(adminBase);
const normalizedSubscriptionBase = origin(subscriptionBase);
if (!normalizedAdminBase || !normalizedSubscriptionBase)
  throw new Error(
    "Set ADMIN_BASE_URL and SUBSCRIPTION_BASE_URL to HTTPS origins (localhost may use HTTP).",
  );
const values = {
  PORT: "3000",
  HOST: "0.0.0.0",
  DATABASE_PATH: "/data/private-subscription-manager.db",
  ADMIN_BASE_URL: normalizedAdminBase,
  SUBSCRIPTION_BASE_URL: normalizedSubscriptionBase,
  COOKIE_SECURE: String(normalizedAdminBase.startsWith("https:")),
  TRUST_PROXY: "1",
  APP_MASTER_KEY: randomBytes(32).toString("hex"),
  ADMIN_USERNAME: "admin",
  ADMIN_INITIAL_PASSWORD: randomBytes(24).toString("base64url"),
};
writeFileSync(
  ".env",
  Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n",
  { mode: 0o600, flag: "wx" },
);
console.log("Root-only environment initialized. Password was not printed.");
