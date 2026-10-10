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
  type SubscriptionEntry,
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
  node(row: Row, collectionIds?: number[]): NodeRecord {
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
      collection_ids:
        collectionIds ??
        this.all(
          "SELECT collection_id FROM node_collection_members WHERE node_id=? ORDER BY collection_id",
          Number(row.id),
        ).map((r) => Number(r.collection_id)),
    };
  }
  nodes(): NodeRecord[] {
    const memberships = new Map<number, number[]>();
    for (const row of this.all(
      "SELECT node_id,collection_id FROM node_collection_members ORDER BY node_id,collection_id",
    )) {
      const nodeId = Number(row.node_id);
      memberships.set(nodeId, [
        ...(memberships.get(nodeId) || []),
        Number(row.collection_id),
      ]);
    }
    return this.all(
      'SELECT n.*, (SELECT COUNT(*) FROM subscription_nodes sn WHERE sn.node_id=n.id) AS "references" FROM nodes n ORDER BY n.id DESC',
    ).map((r) => this.node(r, memberships.get(Number(r.id)) || []));
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
    this.addCollectionMembers(ids, [nodeId]);
  }
  addCollectionMembers(collectionIds: number[], nodeIds: number[]) {
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO node_collection_members VALUES(?,?,?)",
    );
    const createdAt = now();
    for (const collectionId of collectionIds)
      for (const nodeId of nodeIds) insert.run(collectionId, nodeId, createdAt);
  }
  removeCollectionMembers(collectionIds: number[], nodeIds: number[]) {
    const remove = this.db.prepare(
      "DELETE FROM node_collection_members WHERE collection_id=? AND node_id=?",
    );
    for (const collectionId of collectionIds)
      for (const nodeId of nodeIds) remove.run(collectionId, nodeId);
  }
  replaceCollectionMembers(collectionIds: number[], nodeIds: number[]) {
    const placeholders = nodeIds.map(() => "?").join(",");
    this.run(
      `DELETE FROM node_collection_members WHERE node_id IN (${placeholders})`,
      ...nodeIds,
    );
    this.addCollectionMembers(collectionIds, nodeIds);
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
  setNodeEnabled(id: number, enabled: boolean) {
    this.run(
      "UPDATE nodes SET enabled=?,updated_at=? WHERE id=?",
      Number(enabled),
      now(),
      id,
    );
  }
  localNode(row: Row): NodeRecord {
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
      tags: [],
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
      references: 1,
      collection_ids: [],
    };
  }
  findLocalNode(subscriptionId: number, localNodeId: number) {
    const row = this.get(
      "SELECT * FROM subscription_local_nodes WHERE subscription_id=? AND id=?",
      subscriptionId,
      localNodeId,
    );
    return row ? this.localNode(row) : undefined;
  }
  subscriptionEntries(subscriptionId: number): SubscriptionEntry[] {
    return this.all(
      "SELECT * FROM subscription_entries WHERE subscription_id=? ORDER BY position,id",
      subscriptionId,
    )
      .map((entry) => {
        const source = String(entry.source_type) as "global" | "local";
        const node =
          source === "global"
            ? this.findNode(Number(entry.node_id))
            : this.findLocalNode(subscriptionId, Number(entry.local_node_id));
        return node
          ? {
              id: Number(entry.id),
              subscription_id: subscriptionId,
              source,
              position: Number(entry.position),
              node,
            }
          : undefined;
      })
      .filter((entry): entry is SubscriptionEntry => !!entry);
  }
  private compactEntries(subscriptionId: number) {
    const ids = this.all(
      "SELECT id FROM subscription_entries WHERE subscription_id=? ORDER BY position,id",
      subscriptionId,
    ).map((row) => Number(row.id));
    this.run(
      "UPDATE subscription_entries SET position=position+1000000 WHERE subscription_id=?",
      subscriptionId,
    );
    ids.forEach((entryId, position) =>
      this.run(
        "UPDATE subscription_entries SET position=? WHERE subscription_id=? AND id=?",
        position,
        subscriptionId,
        entryId,
      ),
    );
  }
  private syncGlobalMirror(subscriptionId: number) {
    this.run(
      "DELETE FROM subscription_nodes WHERE subscription_id=?",
      subscriptionId,
    );
    for (const entry of this.all(
      "SELECT node_id,position,created_at FROM subscription_entries WHERE subscription_id=? AND source_type='global' ORDER BY position",
      subscriptionId,
    ))
      this.run(
        "INSERT INTO subscription_nodes VALUES(?,?,?,?)",
        subscriptionId,
        Number(entry.node_id),
        Number(entry.position),
        String(entry.created_at),
      );
  }
  addLocalNode(subscriptionId: number, envelope: Envelope) {
    const timestamp = now();
    return this.transaction(() => {
      const localNodeId = Number(
        this.run(
          "INSERT INTO subscription_local_nodes(subscription_id,name,remark,protocol,original_uri,normalized_config,unknown_params,parser_name,parser_version,parse_warnings,unsupported_fields,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          subscriptionId,
          envelope.normalized_config.name,
          "",
          envelope.normalized_config.type,
          envelope.original_uri,
          JSON.stringify(envelope.normalized_config),
          JSON.stringify(envelope.unknown_params),
          envelope.parser_name,
          envelope.parser_version,
          JSON.stringify(envelope.parse_warnings),
          JSON.stringify(envelope.unsupported_fields),
          1,
          timestamp,
          timestamp,
        ).lastInsertRowid,
      );
      const position = Number(
        this.get(
          "SELECT COALESCE(MAX(position),-1)+1 AS position FROM subscription_entries WHERE subscription_id=?",
          subscriptionId,
        )?.position,
      );
      const entryId = Number(
        this.run(
          "INSERT INTO subscription_entries(subscription_id,source_type,node_id,local_node_id,position,created_at) VALUES(?,'local',NULL,?,?,?)",
          subscriptionId,
          localNodeId,
          position,
          timestamp,
        ).lastInsertRowid,
      );
      return { entryId, localNodeId };
    });
  }
  updateLocalNode(
    subscriptionId: number,
    localNodeId: number,
    envelope: Envelope,
    remark: string,
    enabled: boolean,
  ) {
    this.run(
      "UPDATE subscription_local_nodes SET name=?,remark=?,protocol=?,original_uri=?,normalized_config=?,unknown_params=?,parse_warnings=?,unsupported_fields=?,enabled=?,updated_at=? WHERE subscription_id=? AND id=?",
      envelope.normalized_config.name,
      remark,
      envelope.normalized_config.type,
      envelope.original_uri,
      JSON.stringify(envelope.normalized_config),
      JSON.stringify(envelope.unknown_params),
      JSON.stringify(envelope.parse_warnings),
      JSON.stringify(envelope.unsupported_fields),
      Number(enabled),
      now(),
      subscriptionId,
      localNodeId,
    );
  }
  reorderEntries(subscriptionId: number, entryIds: number[]) {
    this.transaction(() => {
      this.run(
        "UPDATE subscription_entries SET position=position+1000000 WHERE subscription_id=?",
        subscriptionId,
      );
      entryIds.forEach((entryId, position) =>
        this.run(
          "UPDATE subscription_entries SET position=? WHERE subscription_id=? AND id=?",
          position,
          subscriptionId,
          entryId,
        ),
      );
      this.syncGlobalMirror(subscriptionId);
      this.run(
        "UPDATE subscriptions SET updated_at=? WHERE id=?",
        now(),
        subscriptionId,
      );
    });
  }
  replaceSubscriptionEntries(subscriptionId: number, entryIds: number[]) {
    this.transaction(() => {
      const entries = this.all(
        "SELECT id,source_type,local_node_id FROM subscription_entries WHERE subscription_id=? ORDER BY position,id",
        subscriptionId,
      );
      const currentIds = new Set(entries.map((entry) => Number(entry.id)));
      if (
        new Set(entryIds).size !== entryIds.length ||
        entryIds.some((entryId) => !currentIds.has(entryId))
      )
        throw new Error("Invalid subscription entry set");

      const retained = new Set(entryIds);
      this.run(
        "UPDATE subscription_entries SET position=position+1000000 WHERE subscription_id=?",
        subscriptionId,
      );
      for (const entry of entries) {
        const entryId = Number(entry.id);
        if (retained.has(entryId)) continue;
        if (String(entry.source_type) === "local")
          this.run(
            "DELETE FROM subscription_local_nodes WHERE subscription_id=? AND id=?",
            subscriptionId,
            Number(entry.local_node_id),
          );
        else
          this.run(
            "DELETE FROM subscription_entries WHERE subscription_id=? AND id=?",
            subscriptionId,
            entryId,
          );
      }
      entryIds.forEach((entryId, position) =>
        this.run(
          "UPDATE subscription_entries SET position=? WHERE subscription_id=? AND id=?",
          position,
          subscriptionId,
          entryId,
        ),
      );
      this.syncGlobalMirror(subscriptionId);
      this.run(
        "UPDATE subscriptions SET updated_at=? WHERE id=?",
        now(),
        subscriptionId,
      );
    });
  }
  deleteEntry(subscriptionId: number, entryId: number) {
    this.transaction(() => {
      const entry = this.get(
        "SELECT * FROM subscription_entries WHERE subscription_id=? AND id=?",
        subscriptionId,
        entryId,
      );
      if (!entry) return;
      if (String(entry.source_type) === "local")
        this.run(
          "DELETE FROM subscription_local_nodes WHERE subscription_id=? AND id=?",
          subscriptionId,
          Number(entry.local_node_id),
        );
      else
        this.run(
          "DELETE FROM subscription_entries WHERE subscription_id=? AND id=?",
          subscriptionId,
          entryId,
        );
      this.compactEntries(subscriptionId);
      this.syncGlobalMirror(subscriptionId);
      this.run(
        "UPDATE subscriptions SET updated_at=? WHERE id=?",
        now(),
        subscriptionId,
      );
    });
  }
  profile(r: Row): Profile {
    const subscriptionId = Number(r.id);
    return {
      id: subscriptionId,
      name: String(r.name),
      remark: String(r.remark),
      enabled: !!r.enabled,
      created_at: String(r.created_at),
      updated_at: String(r.updated_at),
      node_ids: this.all(
        "SELECT node_id FROM subscription_entries WHERE subscription_id=? AND source_type='global' ORDER BY position",
        subscriptionId,
      ).map((x) => Number(x.node_id)),
      node_count: Number(
        this.get(
          "SELECT COUNT(*) AS count FROM subscription_entries WHERE subscription_id=?",
          subscriptionId,
        )?.count,
      ),
    };
  }
  profiles() {
    return this.all("SELECT * FROM subscriptions ORDER BY id DESC").map((r) =>
      this.profile(r),
    );
  }
  assign(id: number, ids: number[]) {
    this.transaction(() => {
      const selected = new Set(ids);
      for (const row of this.all(
        "SELECT id,node_id FROM subscription_entries WHERE subscription_id=? AND source_type='global'",
        id,
      ))
        if (!selected.has(Number(row.node_id)))
          this.run(
            "DELETE FROM subscription_entries WHERE id=?",
            Number(row.id),
          );
      this.compactEntries(id);
      const remaining = this.subscriptionEntries(id);
      const existingByNodeId = new Map(
        remaining
          .filter((entry) => entry.source === "global")
          .map((entry) => [entry.node.id, entry]),
      );
      const requestedExisting = ids
        .map((nodeId) => existingByNodeId.get(nodeId))
        .filter((entry): entry is SubscriptionEntry => !!entry);
      let position = Number(
        this.get(
          "SELECT COALESCE(MAX(position),-1)+1 AS position FROM subscription_entries WHERE subscription_id=?",
          id,
        )?.position,
      );
      const appendedEntryIds: number[] = [];
      for (const nodeId of ids)
        if (!existingByNodeId.has(nodeId)) {
          appendedEntryIds.push(
            Number(
              this.run(
                "INSERT INTO subscription_entries(subscription_id,source_type,node_id,local_node_id,position,created_at) VALUES(?,'global',?,NULL,?,?)",
                id,
                nodeId,
                position++,
                now(),
              ).lastInsertRowid,
            ),
          );
        }
      let globalIndex = 0;
      const order = remaining.map((entry) =>
        entry.source === "local"
          ? entry.id
          : requestedExisting[globalIndex++]!.id,
      );
      order.push(...appendedEntryIds);
      this.run(
        "UPDATE subscription_entries SET position=position+1000000 WHERE subscription_id=?",
        id,
      );
      order.forEach((entryId, nextPosition) =>
        this.run(
          "UPDATE subscription_entries SET position=? WHERE subscription_id=? AND id=?",
          nextPosition,
          id,
          entryId,
        ),
      );
      this.syncGlobalMirror(id);
      this.run("UPDATE subscriptions SET updated_at=? WHERE id=?", now(), id);
    });
  }
  authorized(id: number) {
    return this.subscriptionEntries(id)
      .map((entry) => entry.node)
      .filter((node) => node.enabled);
  }
  selectedNodes(id: number) {
    return this.subscriptionEntries(id).map((entry) => entry.node);
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
