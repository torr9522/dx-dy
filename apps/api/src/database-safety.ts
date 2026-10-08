import { DatabaseSync, backup } from "node:sqlite";
import { existsSync, mkdirSync, chmodSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
export const migrationFiles = (dir = path.resolve("migrations")) =>
  readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
export function integrity(db: DatabaseSync) {
  const rows = db.prepare("PRAGMA integrity_check").all();
  if (rows.length !== 1 || rows[0].integrity_check !== "ok")
    throw new Error("Database integrity check failed");
  if (db.prepare("PRAGMA foreign_key_check").all().length)
    throw new Error("Database foreign key check failed");
}
export function schemaVersions(db: DatabaseSync, supported = migrationFiles()) {
  if (
    !db
      .prepare("SELECT name FROM sqlite_master WHERE name='schema_migrations'")
      .get()
  )
    throw new Error("Unrecognized database: schema_migrations missing");
  const versions = db
    .prepare("SELECT version FROM schema_migrations ORDER BY version")
    .all()
    .map((r) => String(r.version));
  if (versions.some((v) => !supported.includes(v)))
    throw new Error("Database schema is newer than this application version.");
  if (versions.some((v, i) => v !== supported[i]))
    throw new Error("Database migration history is not a recognized prefix");
  return versions;
}
export function validateDatabase(
  db: DatabaseSync,
  supported = migrationFiles(),
) {
  integrity(db);
  const versions = schemaVersions(db, supported);
  if (!versions.length) throw new Error("Unrecognized empty database schema");
  const required: Record<string, string[]> = {
    admins: ["id", "username", "password_hash"],
    admin_sessions: ["session_hash", "csrf_token"],
    nodes: [
      "id",
      "original_uri",
      "normalized_config",
      "unknown_params",
      "tags",
    ],
    subscriptions: ["id", "token_hash", "token_ciphertext"],
    subscription_nodes: ["subscription_id", "node_id", "position"],
    settings: ["key", "value"],
  };
  if (versions.includes("002_node_collections.sql"))
    Object.assign(required, {
      node_collections: ["id", "name", "remark", "position"],
      node_collection_members: ["collection_id", "node_id"],
    });
  for (const [table, columns] of Object.entries(required)) {
    const actual = db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((r) => String(r.name));
    if (columns.some((c) => !actual.includes(c)))
      throw new Error("Unrecognized database table structure: " + table);
  }
  return versions;
}
export async function snapshot(
  db: DatabaseSync,
  target: string,
  clearSessions = false,
) {
  if (existsSync(target)) throw new Error("Backup destination already exists");
  integrity(db);
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  try {
    await backup(db, target);
    chmodSync(target, 0o600);
    const copy = new DatabaseSync(target);
    try {
      copy.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE;");
      if (
        clearSessions &&
        copy
          .prepare("SELECT name FROM sqlite_master WHERE name='admin_sessions'")
          .get()
      )
        copy.exec("DELETE FROM admin_sessions");
      integrity(copy);
    } finally {
      copy.close();
    }
  } catch (error) {
    rmSync(target, { force: true });
    rmSync(target + "-wal", { force: true });
    rmSync(target + "-shm", { force: true });
    throw error;
  }
}
