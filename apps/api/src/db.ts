import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import {
  integrity,
  migrationFiles,
  schemaVersions,
  snapshot,
} from "./database-safety";
import path from "node:path";
import {
  envelopeSchema,
  type Envelope,
  type NodeRecord,
  type Profile,
} from "../../../packages/shared/schema";
export const now = () => new Date().toISOString();
type Row = Record<string, unknown>;
export class Store {
  db: DatabaseSync;
  constructor(public file: string) {
    if (file !== ":memory:")
      mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    this.db.exec(
      "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
    );
  }
  async migrate(dir = path.resolve("migrations")) {
    const supported = migrationFiles(dir);
    if (
      this.get("SELECT name FROM sqlite_master WHERE name='schema_migrations'")
    )
      schemaVersions(this.db, supported);
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
    const pending = supported.filter(
      (f) =>
        !this.db
          .prepare("SELECT version FROM schema_migrations WHERE version=?")
          .get(f),
    );
    if (
      pending.length &&
      this.file !== ":memory:" &&
      this.get("SELECT name FROM sqlite_master WHERE name='nodes'")
    ) {
      const target = path.resolve(
        path.dirname(this.file),
        "backups/pre-migration-" + Date.now() + ".sqlite",
      );
      mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      await snapshot(this.db, target);
    }
    if (pending.length)
      this.transaction(() => {
        for (const f of pending) {
          this.db.exec(readFileSync(path.join(dir, f), "utf8"));
          this.db
            .prepare("INSERT INTO schema_migrations VALUES(?,?)")
            .run(f, now());
        }
        integrity(this.db);
      });
    integrity(this.db);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  all(sql: string, ...params: (string | number)[]): Row[] {
    return this.db.prepare(sql).all(...params) as Row[];
  }
  get(sql: string, ...params: (string | number)[]): Row | undefined {
    return this.db.prepare(sql).get(...params) as Row | undefined;
  }
  run(sql: string, ...params: (string | number | null)[]) {
    return this.db.prepare(sql).run(...params);
  }
  node(row: Row): NodeRecord {
    const envelope = envelopeSchema.parse({
      ...row,
      normalized_config: JSON.parse(String(row.normalized_config)),
      unknown_params: JSON.parse(String(row.unknown_params)),
      parse_warnings: JSON.parse(String(row.parse_warnings)),
      unsupported_fields: JSON.parse(String(row.unsupported_fields)),
    });
    return {
      ...envelope,
      id: Number(row.id),
      name: String(row.name),
      protocol: String(row.protocol),
      remark: String(row.remark),
      enabled: !!row.enabled,
      tags: JSON.parse(String(row.tags)),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
      references: Number(row.references || 0),
      collection_ids: this.all(
        "SELECT collection_id FROM node_collection_members WHERE node_id=? ORDER BY collection_id",
        Number(row.id),
      ).map((r) => Number(r.collection_id)),
    };
  }
  nodes(): NodeRecord[] {
    return this.all(
      'SELECT n.*, (SELECT COUNT(*) FROM subscription_nodes sn WHERE sn.node_id=n.id) AS "references" FROM nodes n ORDER BY n.id DESC',
    ).map((r) => this.node(r));
  }
  findNode(id: number) {
    const r = this.get(
      'SELECT n.*, (SELECT COUNT(*) FROM subscription_nodes sn WHERE sn.node_id=n.id) AS "references" FROM nodes n WHERE n.id=?',
      id,
    );
    return r ? this.node(r) : undefined;
  }
  collections() {
    return this.all(
      "SELECT c.*, (SELECT COUNT(*) FROM node_collection_members m WHERE m.collection_id=c.id) AS node_count FROM node_collections c ORDER BY position,id",
    ).map((r) => ({
      id: Number(r.id),
      name: String(r.name),
      remark: String(r.remark),
      position: Number(r.position),
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
      node_count: Number(r.node_count),
    }));
  }
  setCollections(nodeId: number, ids: number[]) {
    this.run("DELETE FROM node_collection_members WHERE node_id=?", nodeId);
    for (const collectionId of ids)
      this.run(
        "INSERT INTO node_collection_members VALUES(?,?,?)",
        collectionId,
        nodeId,
        now(),
      );
  }
  addNode(e: Envelope, remark = "", tags: string[] = [], enabled = true) {
    const t = now();
    return Number(
      this.run(
        "INSERT INTO nodes(name,remark,protocol,original_uri,normalized_config,unknown_params,parser_name,parser_version,parse_warnings,unsupported_fields,tags,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        e.normalized_config.name,
        remark,
        e.normalized_config.type,
        e.original_uri,
        JSON.stringify(e.normalized_config),
        JSON.stringify(e.unknown_params),
        e.parser_name,
        e.parser_version,
        JSON.stringify(e.parse_warnings),
        JSON.stringify(e.unsupported_fields),
        JSON.stringify(tags),
        Number(enabled),
        t,
        t,
      ).lastInsertRowid,
    );
  }
  updateNode(
    id: number,
    e: Envelope,
    remark: string,
    tags: string[],
    enabled: boolean,
  ) {
    this.run(
      "UPDATE nodes SET name=?,remark=?,protocol=?,original_uri=?,normalized_config=?,unknown_params=?,parse_warnings=?,unsupported_fields=?,tags=?,enabled=?,updated_at=? WHERE id=?",
      e.normalized_config.name,
      remark,
      e.normalized_config.type,
      e.original_uri,
      JSON.stringify(e.normalized_config),
      JSON.stringify(e.unknown_params),
      JSON.stringify(e.parse_warnings),
      JSON.stringify(e.unsupported_fields),
      JSON.stringify(tags),
      Number(enabled),
      now(),
      id,
    );
  }
  profile(r: Row): Profile {
    return {
      id: Number(r.id),
      name: String(r.name),
      remark: String(r.remark),
      enabled: !!r.enabled,
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
      node_ids: this.all(
        "SELECT node_id FROM subscription_nodes WHERE subscription_id=? ORDER BY position",
        Number(r.id),
      ).map((x) => Number(x.node_id)),
    };
  }
  profiles() {
    return this.all("SELECT * FROM subscriptions ORDER BY id DESC").map((r) =>
      this.profile(r),
    );
  }
  assign(id: number, ids: number[]) {
    this.transaction(() => {
      this.run("DELETE FROM subscription_nodes WHERE subscription_id=?", id);
      ids.forEach((nodeId, pos) =>
        this.run(
          "INSERT INTO subscription_nodes VALUES(?,?,?,?)",
          id,
          nodeId,
          pos,
          now(),
        ),
      );
      this.run("UPDATE subscriptions SET updated_at=? WHERE id=?", now(), id);
    });
  }
  authorized(id: number) {
    return this.all(
      "SELECT n.* FROM subscription_nodes sn JOIN nodes n ON n.id=sn.node_id WHERE sn.subscription_id=? AND n.enabled=1 ORDER BY sn.position",
      id,
    ).map((r) => this.node(r));
  }
  settings() {
    return Object.fromEntries(
      this.all("SELECT * FROM settings").map((r) => [
        String(r.key),
        JSON.parse(String(r.value)),
      ]),
    );
  }
  set(key: string, value: unknown) {
    this.run(
      "INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      key,
      JSON.stringify(value),
    );
  }
  close() {
    this.db.close();
  }
}
export function hasDatabase(file: string) {
  return existsSync(file);
}
