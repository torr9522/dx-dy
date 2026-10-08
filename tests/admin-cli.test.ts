import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../apps/api/src/app";

const roots: string[] = [];
const key = "4".repeat(64);

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

async function open(database: string, password: string) {
  return createApp({
    database,
    masterKey: key,
    initialPassword: password,
    adminBase: "http://localhost:3000",
    subscriptionBase: "http://localhost:3000",
  });
}

function adminCli(database: string, command: string, value: string) {
  const result = spawnSync(
    path.resolve("node_modules/.bin/tsx"),
    ["scripts/admin-cli.ts", command],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_PATH: database },
      input: value + "\n",
      encoding: "utf8",
    },
  );
  if (result.status !== 0) throw new Error("Administrator CLI failed");
  return result.stdout;
}

function domainCli(database: string, origin: string) {
  const result = spawnSync(
    path.resolve("node_modules/.bin/tsx"),
    ["scripts/domain-cli.ts", "set-subscription"],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_PATH: database },
      input: origin + "\n",
      encoding: "utf8",
    },
  );
  if (result.status !== 0) throw new Error("Domain CLI failed");
  return result.stdout;
}

describe("application-owned administrator recovery CLI", () => {
  it("initializes a blank database entirely from stdin", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "dxdy-admin-cli-"));
    roots.push(root);
    const database = path.join(root, "instance.db");
    expect(
      adminCli(database, "init", "operator\nSynthetic-initial-password-123!"),
    ).toContain("initialized");
    const system = await open(database, "Unused-bootstrap-password-123!");
    await request(system.app)
      .post("/api/auth/login")
      .send({
        username: "operator",
        password: "Synthetic-initial-password-123!",
      })
      .expect(200);
    system.store.close();
  });

  it("reads credentials from stdin and invalidates sessions", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "dxdy-admin-cli-"));
    roots.push(root);
    const database = path.join(root, "instance.db");
    const original = "Synthetic-original-password-123!";
    const replacement = "Synthetic-replacement-password-456!";
    let system = await open(database, original);
    const session = request.agent(system.app);
    await session
      .post("/api/auth/login")
      .send({ username: "admin", password: original })
      .expect(200);
    expect(system.store.all("SELECT * FROM admin_sessions")).toHaveLength(1);
    system.store.close();

    expect(adminCli(database, "reset-password", replacement)).toContain(
      "sessions invalidated",
    );
    system = await open(database, original);
    expect(system.store.all("SELECT * FROM admin_sessions")).toHaveLength(0);
    await request(system.app)
      .post("/api/auth/login")
      .send({ username: "admin", password: original })
      .expect(401);
    await request(system.app)
      .post("/api/auth/login")
      .send({ username: "admin", password: replacement })
      .expect(200);
    system.store.close();

    expect(adminCli(database, "change-username", "operator_1")).toContain(
      "sessions invalidated",
    );
    system = await open(database, original);
    await request(system.app)
      .post("/api/auth/login")
      .send({ username: "admin", password: replacement })
      .expect(401);
    await request(system.app)
      .post("/api/auth/login")
      .send({ username: "operator_1", password: replacement })
      .expect(200);
    system.store.close();
  });

  it("rejects unsafe usernames and short passwords", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "dxdy-admin-cli-"));
    roots.push(root);
    const database = path.join(root, "instance.db");
    const system = await open(database, "Synthetic-original-password-123!");
    system.store.close();
    expect(() => adminCli(database, "reset-password", "short")).toThrow();
    expect(() => adminCli(database, "change-username", "bad name")).toThrow();
  });

  it("updates the canonical subscription origin and preserves the old host", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "dxdy-domain-cli-"));
    roots.push(root);
    const database = path.join(root, "instance.db");
    const system = await open(database, "Synthetic-original-password-123!");
    system.store.close();
    expect(domainCli(database, "https://sub.example.com")).toContain(
      "subscription_domain_updated",
    );
    const reopened = await open(database, "Unused-bootstrap-password-123!");
    expect(reopened.store.settings().subscription_base_url).toBe(
      "https://sub.example.com",
    );
    expect(reopened.store.settings().subscription_legacy_hosts).toContain(
      "localhost:3000",
    );
    reopened.store.close();
    expect(() => domainCli(database, "http://sub.example.com")).toThrow();
  });
});
