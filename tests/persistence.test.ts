import { it, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { Store } from "../apps/api/src/db";
import { parseNode } from "../packages/proxy-adapter";
import { vless } from "./fixtures";
it("WAL persistence, backup and versioned idempotent migrations", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "psm-test-")),
    file = path.join(dir, "app.sqlite");
  try {
    const s = new Store(file);
    await s.migrate();
    s.addNode(parseNode(vless));
    expect(s.get("PRAGMA foreign_keys")?.foreign_keys).toBe(1);
    expect(s.get("PRAGMA journal_mode")?.journal_mode).toBe("wal");
    await backup(s.db, path.join(dir, "backup.sqlite"));
    s.close();
    const next = new Store(file);
    await next.migrate();
    expect(next.nodes()).toHaveLength(1);
    expect(next.all("SELECT * FROM schema_migrations")).toHaveLength(2);
    next.close();
    const b = new DatabaseSync(path.join(dir, "backup.sqlite"));
    expect(b.prepare("SELECT COUNT(*) AS n FROM nodes").get()?.n).toBe(1);
    b.close();
  } finally {
    rmSync(dir, { recursive: true });
  }
});
it("failed migration rolls back all schema changes", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "psm-migration-"));
  const s = new Store(":memory:");
  try {
    writeFileSync(
      path.join(dir, "001_failure.sql"),
      "CREATE TABLE test(id INTEGER); INVALID SQL;",
    );
    await expect(s.migrate(dir)).rejects.toThrow();
    expect(
      s.get("SELECT name FROM sqlite_master WHERE name='test'"),
    ).toBeUndefined();
    expect(s.all("SELECT * FROM schema_migrations")).toHaveLength(0);
  } finally {
    s.close();
    rmSync(dir, { recursive: true });
  }
});
it("source archive manifest excludes runtime state by construction", () => {
  const source = readFileSync("scripts/source.mjs", "utf8");
  expect(source).not.toContain("'data'");
  expect(source).not.toContain("'.env'");
});
