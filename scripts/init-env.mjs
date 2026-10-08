import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
if (existsSync(".env"))
  throw new Error("Environment already exists; refusing to overwrite secrets");
const publicBase = process.env.PUBLIC_BASE_URL;
if (!publicBase || !/^https?:\/\//.test(publicBase))
  throw new Error(
    "Set PUBLIC_BASE_URL to your own HTTP/HTTPS origin before initializing.",
  );
const values = {
  PORT: "3000",
  HOST: "0.0.0.0",
  DATABASE_PATH: "/data/app.sqlite",
  PUBLIC_BASE_URL: publicBase,
  COOKIE_SECURE: String(publicBase.startsWith("https:")),
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
