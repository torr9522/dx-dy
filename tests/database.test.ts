import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import request from "supertest";
import { Store } from "../apps/api/src/db";
import { createApp } from "../apps/api/src/app";
import { digest, encryptToken } from "../apps/api/src/security";
import { databaseLock } from "../apps/api/src/database-lock";
import {
  integrity,
  snapshot,
  validateDatabase,
  schemaVersions,
} from "../apps/api/src/database-safety";
import {
  nonRfcVmess,
  nonRfcVmessUuid,
  vless,
} from "./fixtures";
import { parseNode } from "../packages/proxy-adapter";
const key = "4".repeat(64),
  password = "Synthetic-portable-password-123!";
const run = (args: string[], env: Record<string, string>) =>
  execFileSync("pnpm", ["exec", "tsx", "scripts/database.ts", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
describe("database migration and portability", () => {
  it("bootstraps the subscription domain once and keeps the database value", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "psm-domain-"));
    const database = path.join(root, "domain.db");
    const first = await createApp({
      database,
      masterKey: key,
      initialPassword: password,
      adminBase: "https://admin.test",
      subscriptionBase: "https://first-sub.test/",
    });
    expect(first.store.settings().subscription_base_url).toBe(
      "https://first-sub.test",
    );
    first.store.set("subscription_base_url", "https://saved-sub.test");
    first.store.close();
    const restarted = await createApp({
      database,
      masterKey: key,
      initialPassword: password,
      adminBase: "https://new-admin.test",
      subscriptionBase: "https://ignored-env.test",
    });
    try {
      expect(restarted.store.settings().subscription_base_url).toBe(
        "https://saved-sub.test",
      );
    } finally {
      restarted.store.close();
    }
  });
  it("upgrades a 0.1.3 schema transactionally and guards newer/failing schemas", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "psm-migrate-")),
      oldDir = path.join(root, "old"),
      allDir = path.join(root, "all");
    mkdirSync(oldDir);
    mkdirSync(allDir);
    cpSync("migrations/001_initial.sql", path.join(oldDir, "001_initial.sql"));
    cpSync("migrations/001_initial.sql", path.join(allDir, "001_initial.sql"));
    cpSync(
      "migrations/002_node_collections.sql",
      path.join(allDir, "002_node_collections.sql"),
    );
    const file = path.join(root, "old.db"),
      old = new Store(file);
    await old.migrate(oldDir);
    const timestamp = "2026-10-08T00:00:00.000Z";
    old.run(
      "INSERT INTO admins VALUES(1,?,?,?,?)",
      "admin",
      "$argon2id$synthetic-preserved-hash",
      timestamp,
      timestamp,
    );
    const nodeId = old.addNode(parseNode(vless), "legacy", ["preserved"]);
    const token = "A".repeat(43);
    const subscriptionId = Number(
      old.run(
        "INSERT INTO subscriptions(name,remark,token_hash,token_ciphertext,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
        "Legacy profile",
        "preserved",
        digest(token),
        encryptToken(token, Buffer.from(key, "hex")),
        1,
        timestamp,
        timestamp,
      ).lastInsertRowid,
    );
    old.run(
      "INSERT INTO subscription_nodes VALUES(?,?,0,?)",
      subscriptionId,
      nodeId,
      timestamp,
    );
    old.run(
      "INSERT INTO settings VALUES(?,?)",
      "preserved",
      JSON.stringify("yes"),
    );
    const preservedTables = [
      "admins",
      "nodes",
      "subscriptions",
      "subscription_nodes",
      "settings",
    ];
    const before = Object.fromEntries(
      preservedTables.map((table) => [
        table,
        old.all(`SELECT * FROM ${table} ORDER BY rowid`),
      ]),
    );
    old.close();
    const upgraded = new Store(file);
    await upgraded.migrate(allDir);
    expect(upgraded.settings().preserved).toBe("yes");
    for (const table of preservedTables)
      expect(upgraded.all(`SELECT * FROM ${table} ORDER BY rowid`)).toEqual(
        before[table],
      );
    expect(
      upgraded.get(
        "SELECT name FROM sqlite_master WHERE name='node_collections'",
      ),
    ).toBeDefined();
    await upgraded.migrate(allDir);
    expect(upgraded.all("SELECT * FROM schema_migrations")).toHaveLength(2);
    integrity(upgraded.db);
    upgraded.run(
      "INSERT INTO schema_migrations VALUES(?,?)",
      "999_future.sql",
      new Date().toISOString(),
    );
    upgraded.close();
    const newer = new Store(file);
    await expect(newer.migrate(allDir)).rejects.toThrow(
      "newer than this application",
    );
    expect(() => schemaVersions(newer.db, ["001_initial.sql"])).toThrow(
      "newer than this application",
    );
    newer.close();
    const failFile = path.join(root, "failure.db"),
      initial = new Store(failFile);
    await initial.migrate(oldDir);
    initial.close();
    const failDir = path.join(root, "fail");
    mkdirSync(failDir);
    for (const f of readdirSync(allDir))
      cpSync(path.join(allDir, f), path.join(failDir, f));
    writeFileSync(
      path.join(failDir, "003_failure.sql"),
      "CREATE TABLE rolled_back(id); SELECT missing FROM impossible;",
    );
    const failing = new Store(failFile);
    await expect(failing.migrate(failDir)).rejects.toThrow();
    expect(
      failing.get(
        "SELECT name FROM sqlite_master WHERE name='node_collections'",
      ),
    ).toBeUndefined();
    failing.close();
    expect(
      readdirSync(path.join(root, "backups")).some((f) =>
        f.startsWith("pre-migration-"),
      ),
    ).toBe(true);
  });
  it("creates WAL-safe database and encrypted full backups and restores token continuity", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "psm-portable-")),
      source = path.join(root, "a.db"),
      bundle = path.join(root, "instance.psmbackup"),
      portable = path.join(root, "portable.db"),
      target = path.join(root, "b.db"),
      envFile = path.join(root, "instance.env");
    const options = {
      database: source,
      masterKey: key,
      initialPassword: password,
      adminBase: "https://stable-sub.test",
      subscriptionBase: "https://stable-sub.test",
    };
    const a = await createApp(options),
      agent = request.agent(a.app),
      login = await agent
        .post("/api/auth/login")
        .send({ username: "admin", password }),
      csrf = login.body.csrf;
    const imported = (
      await agent
        .post("/api/nodes/import")
        .set("X-CSRF-Token", csrf)
        .send({ items: [{ uri: vless }, { uri: nonRfcVmess }] })
    ).body;
    const collection = (
      await agent
        .post("/api/collections")
        .set("X-CSRF-Token", csrf)
        .send({ name: "Portable", remark: "test" })
    ).body;
    for (const n of imported)
      await agent
        .patch(`/api/nodes/${n.id}`)
        .set("X-CSRF-Token", csrf)
        .send({
          normalized_config: n.normalized_config,
          remark: n.remark,
          tags: ["portable"],
          enabled: true,
          collection_ids: [collection.id],
        });
    const profile = (
      await agent
        .post("/api/subscriptions")
        .set("X-CSRF-Token", csrf)
        .send({ name: "Portable profile" })
    ).body;
    await agent
      .put(`/api/subscriptions/${profile.id}/nodes`)
      .set("X-CSRF-Token", csrf)
      .send({ node_ids: imported.map((n: { id: number }) => n.id).reverse() });
    a.store.set("migration_setting", "preserved");
    const url = (await agent.get(`/api/subscriptions/${profile.id}/url`)).body
        .url,
      body = (await request(a.app).get(new URL(url).pathname)).text,
      bodyHash = createHash("sha256").update(body).digest("hex"),
      sourceNodes = a.store.nodes();
    await snapshot(a.store.db, portable, true);
    const independent = new DatabaseSync(portable, { readOnly: true });
    expect(validateDatabase(independent)).toHaveLength(2);
    expect(
      independent.prepare("SELECT COUNT(*) n FROM admin_sessions").get()?.n,
    ).toBe(0);
    const portableVmess = independent
      .prepare("SELECT normalized_config FROM nodes WHERE protocol='vmess'")
      .get() as { normalized_config: string };
    expect(JSON.parse(portableVmess.normalized_config).uuid).toBe(
      nonRfcVmessUuid,
    );
    integrity(independent);
    independent.close();
    run(["bundle", bundle], {
      DATABASE_PATH: source,
      APP_MASTER_KEY: key,
      BACKUP_PASSWORD: "Synthetic-backup-password-123!",
    });
    a.store.close();
    writeFileSync(envFile, "ADMIN_BASE_URL=https://admin-b.test\n", {
      mode: 0o600,
    });
    run(["restore", bundle], {
      DATABASE_PATH: target,
      BACKUP_PASSWORD: "Synthetic-backup-password-123!",
      INSTANCE_ENV_FILE: envFile,
    });
    const restoredKey = readFileSync(envFile, "utf8").match(
      /^APP_MASTER_KEY=(.+)$/m,
    )?.[1];
    expect(restoredKey).toBe(key);
    const b = await createApp({
      ...options,
      database: target,
      masterKey: restoredKey!,
      subscriptionBase: "https://ignored-after-restore.test",
    });
    try {
      expect(b.store.settings().subscription_base_url).toBe(
        "https://stable-sub.test",
      );
      expect(b.store.settings().migration_setting).toBe("preserved");
      expect(b.store.nodes()).toEqual(sourceNodes);
      expect(
        b.store.nodes().find((node) => node.protocol === "vmess")
          ?.normalized_config.uuid,
      ).toBe(nonRfcVmessUuid);
      expect(b.store.collections()[0].name).toBe("Portable");
      expect(
        b.store
          .nodes()
          .every(
            (n) =>
              n.collection_ids.includes(collection.id) &&
              n.tags.includes("portable"),
          ),
      ).toBe(true);
      expect(b.store.profiles()[0].node_ids).toEqual(
        imported.map((n: { id: number }) => n.id).reverse(),
      );
      const restoredBody = (await request(b.app).get(new URL(url).pathname))
        .text;
      expect(createHash("sha256").update(restoredBody).digest("hex")).toBe(
        bodyHash,
      );
      expect(b.store.all("SELECT * FROM admin_sessions")).toHaveLength(0);
      const restoredAgent = request.agent(b.app);
      const restoredLogin = await restoredAgent
        .post("/api/auth/login")
        .send({ username: "admin", password });
      expect(restoredLogin.status).toBe(200);
      expect(
        (await restoredAgent.get(`/api/subscriptions/${profile.id}/url`)).body
          .url,
      ).toBe(url);
      expect(b.store.all("SELECT * FROM admin_sessions")).toHaveLength(1);
    } finally {
      b.store.close();
    }
    writeFileSync(path.join(root, "corrupt.db"), "not sqlite");
    expect(() =>
      run(["restore", path.join(root, "corrupt.db")], {
        DATABASE_PATH: path.join(root, "bad.db"),
        APP_MASTER_KEY: key,
      }),
    ).toThrow();
    expect(existsSync(target)).toBe(true);
    run(["restore", portable], { DATABASE_PATH: target, APP_MASTER_KEY: key });
    expect(
      readdirSync(path.join(root, "backups")).some((f) =>
        f.startsWith("pre-restore-"),
      ),
    ).toBe(true);
    expect(() =>
      run(["restore", portable], {
        DATABASE_PATH: path.join(root, "wrong-key.db"),
        APP_MASTER_KEY: "5".repeat(64),
      }),
    ).toThrow();
    expect(() =>
      run(["restore", bundle], {
        DATABASE_PATH: path.join(root, "wrong-password.db"),
        BACKUP_PASSWORD: "Wrong-backup-password-456!",
        INSTANCE_ENV_FILE: path.join(root, "wrong.env"),
      }),
    ).toThrow();
    const unsupported = path.join(root, "future.psmbackup"),
      outer = JSON.parse(readFileSync(bundle, "utf8"));
    outer.manifest.format_version = 2;
    writeFileSync(unsupported, JSON.stringify(outer));
    expect(() =>
      run(["restore", unsupported], {
        DATABASE_PATH: path.join(root, "future.db"),
        BACKUP_PASSWORD: "Synthetic-backup-password-123!",
        INSTANCE_ENV_FILE: path.join(root, "future.env"),
      }),
    ).toThrow();
    const release = await databaseLock(target);
    try {
      expect(() =>
        run(["restore", portable], {
          DATABASE_PATH: target,
          APP_MASTER_KEY: key,
        }),
      ).toThrow();
    } finally {
      release();
    }
  });
});
