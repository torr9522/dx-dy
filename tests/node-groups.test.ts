import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../apps/api/src/app";
import { Store } from "../apps/api/src/db";
import { integrity, validateDatabase } from "../apps/api/src/database-safety";
import { fixtures, vless, vmess } from "./fixtures";
import {
  parseNode,
  generateUniversalBase64Subscription,
} from "../packages/proxy-adapter";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

async function setup() {
  const system = await createApp({
    database: ":memory:",
    masterKey: "1".repeat(64),
    initialPassword: "Synthetic-groups-password-123!",
    adminBase: "http://localhost:3000",
    subscriptionBase: "http://localhost:3000",
  });
  const agent = request.agent(system.app);
  const login = await agent
    .post("/api/auth/login")
    .send({ username: "admin", password: "Synthetic-groups-password-123!" });
  const mutate = (route: string, body: object, method = "post") =>
    agent[method as "post"](route)
      .set("X-CSRF-Token", login.body.csrf)
      .send(body);
  return { ...system, agent, mutate };
}

describe("isolated Node Group ownership", () => {
  it("starts empty, requires ownership, validates names, and requires confirmation for populated groups", async () => {
    const s = await setup();
    try {
      expect((await s.agent.get("/api/node-groups")).body).toEqual([]);
      expect(s.store.nodes()).toEqual([]);
      await s
        .mutate("/api/nodes/import", { items: [{ uri: vless }] })
        .expect(400);
      await s.mutate("/api/node-groups", { name: "   " }).expect(400);
      const g = (
        await s.mutate("/api/node-groups", { name: "  Group A  " }).expect(201)
      ).body;
      expect(g.name).toBe("Group A");
      await s.mutate("/api/node-groups", { name: "group a" }).expect(409);
      await s
        .mutate(`/api/node-groups/${g.id}`, { name: "Renamed" }, "patch")
        .expect(200);
      const n = (
        await s
          .mutate("/api/nodes/import", {
            group_id: g.id,
            items: [{ uri: vless }],
          })
          .expect(201)
      ).body[0];
      expect(n.group_id).toBe(g.id);
      expect(n.group_name).toBe("Renamed");
      await s.mutate(`/api/node-groups/${g.id}`, {}, "delete").expect(409);
      expect(() =>
        s.store.run("UPDATE nodes SET group_id=NULL WHERE id=?", n.id),
      ).toThrow();
      expect(() =>
        s.store.run("UPDATE nodes SET group_id=999 WHERE id=?", n.id),
      ).toThrow();
      await s
        .mutate(`/api/nodes/${n.id}`, { confirm: true }, "delete")
        .expect(200);
      await s.mutate(`/api/node-groups/${g.id}`, {}, "delete").expect(200);
      expect(s.store.nodeGroups()).toHaveLength(0);
    } finally {
      s.store.close();
    }
  });

  it("blocks only within a Group, copies losslessly to independent IDs, and detaches by ID", async () => {
    const s = await setup();
    try {
      const groups = [];
      for (const name of ["Group 1", "Group 2", "Group 3"])
        groups.push((await s.mutate("/api/node-groups", { name })).body);
      const items = [vless, vmess, fixtures[7][1]].map((uri) => ({ uri }));
      const first = (
        await s
          .mutate("/api/nodes/import", { group_id: groups[0].id, items })
          .expect(201)
      ).body;
      const second = (
        await s
          .mutate("/api/nodes/import", {
            group_id: groups[1].id,
            items: items.slice(0, 2),
          })
          .expect(201)
      ).body;
      await s
        .mutate("/api/nodes/import", {
          group_id: groups[0].id,
          items: items.slice(0, 1),
        })
        .expect(422);
      const preview = (
        await s.mutate("/api/nodes/preview", {
          group_id: groups[1].id,
          text: items.map((i) => i.uri).join("\n"),
        })
      ).body;
      expect(
        preview.map((row: { duplicate: boolean }) => Boolean(row.duplicate)),
      ).toEqual([true, true, false]);
      await s
        .mutate(`/api/node-groups/${groups[1].id}/copy`, {
          node_ids: [first[0].id, first[2].id],
        })
        .expect(422);
      expect(s.store.nodeGroups()[1].node_count).toBe(2);
      const copy = (
        await s
          .mutate(`/api/node-groups/${groups[1].id}/copy`, {
            node_ids: [first[2].id],
          })
          .expect(201)
      ).body[0];
      expect(copy.id).not.toBe(first[2].id);
      for (const field of [
        "original_uri",
        "normalized_config",
        "unknown_params",
        "parser_name",
        "parser_version",
        "parse_warnings",
        "unsupported_fields",
        "enabled",
        "name",
        "remark",
        "tags",
      ])
        expect(copy[field]).toEqual(first[2][field]);
      const sub = (
        await s.mutate("/api/subscriptions", { name: "Cross-Group" })
      ).body;
      await s
        .mutate(
          `/api/subscriptions/${sub.id}/nodes`,
          { node_ids: [first[0].id, second[0].id, copy.id] },
          "put",
        )
        .expect(200);
      const url = (await s.agent.get(`/api/subscriptions/${sub.id}/url`)).body
        .url;
      const before = (await request(s.app).get(new URL(url).pathname)).text;
      expect(Buffer.from(before, "base64").toString().split("\n")).toHaveLength(
        3,
      );
      await s
        .mutate(`/api/nodes/${first[0].id}`, { confirm: true }, "delete")
        .expect(200);
      expect(s.store.findNode(second[0].id)).toBeDefined();
      expect(
        s.store.subscriptionEntries(sub.id).map((entry) => entry.node.id),
      ).toEqual([second[0].id, copy.id]);
      expect(
        (await s.agent.get(`/api/subscriptions/${sub.id}/url`)).body.url,
      ).toBe(url);
      const current = s.store.findNode(first[2].id)!;
      await s
        .mutate(
          `/api/nodes/${current.id}`,
          {
            normalized_config: { ...current.normalized_config, port: 8443 },
            remark: "changed",
            enabled: false,
            tags: [],
          },
          "patch",
        )
        .expect(200);
      expect(s.store.findNode(copy.id)!.normalized_config.port).toBe(
        copy.normalized_config.port,
      );
      expect(s.store.findNode(copy.id)!.enabled).toBe(true);
      integrity(s.store.db);
      expect(validateDatabase(s.store.db)).toHaveLength(4);
    } finally {
      s.store.close();
    }
  });

  for (const populated of [false, true])
    it(`migrates real released schema 003 (${populated ? "populated" : "empty"}) without rewriting data`, async () => {
      const dir = mkdtempSync(path.join(tmpdir(), "dxdy-groups-"));
      const s = new Store(path.join(dir, "upgrade.db"));
      try {
        s.db.exec(
          "CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,applied_at TEXT NOT NULL)",
        );
        for (const file of [
          "001_initial.sql",
          "002_node_collections.sql",
          "003_subscription_local_nodes.sql",
        ]) {
          s.db.exec(readFileSync(`migrations/${file}`, "utf8"));
          s.run(
            "INSERT INTO schema_migrations VALUES(?,?)",
            file,
            "2026-01-01",
          );
        }
        if (populated) {
          const e = parseNode(vless);
          s.run(
            "INSERT INTO nodes(name,remark,protocol,original_uri,normalized_config,unknown_params,parser_name,parser_version,parse_warnings,unsupported_fields,tags,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            e.normalized_config.name,
            "legacy",
            "vless",
            e.original_uri,
            JSON.stringify(e.normalized_config),
            JSON.stringify(e.unknown_params),
            e.parser_name,
            e.parser_version,
            "[]",
            "[]",
            "[]",
            1,
            "2026-01-01",
            "2026-01-01",
          );
          s.run(
            "INSERT INTO subscriptions VALUES(1,'Legacy','','synthetic-hash','synthetic-cipher',1,'2026-01-01','2026-01-01')",
          );
          s.run("INSERT INTO subscription_nodes VALUES(1,1,0,'2026-01-01')");
          s.run(
            "INSERT INTO subscription_entries VALUES(1,1,'global',1,NULL,0,'2026-01-01')",
          );
          s.run(
            "INSERT INTO node_collections VALUES(1,'Legacy Collection','',0,'2026-01-01','2026-01-01')",
          );
          s.run("INSERT INTO node_collection_members VALUES(1,1,'2026-01-01')");
        }
        const tables = [
          "subscriptions",
          "subscription_nodes",
          "subscription_entries",
          "node_collections",
          "node_collection_members",
        ];
        const before = tables.map((table) =>
          s.all(`SELECT * FROM ${table} ORDER BY rowid`),
        );
        const oldNodes = s.all("SELECT * FROM nodes ORDER BY id");
        await s.migrate();
        expect(
          tables.map((table) => s.all(`SELECT * FROM ${table} ORDER BY rowid`)),
        ).toEqual(before);
        expect(s.nodeGroups()).toHaveLength(populated ? 1 : 0);
        if (populated) {
          expect(s.nodeGroups()[0].name).toBe("原节点库");
          expect(
            s
              .all("SELECT * FROM nodes")
              .map(({ group_id: _group, ...row }) => row),
          ).toEqual(oldNodes);
          expect(generateUniversalBase64Subscription(s.authorized(1))).toBe(
            generateUniversalBase64Subscription([parseNode(vless)]),
          );
          const migratedGroupId = s.nodeGroups()[0].id;
          expect(s.deleteNodeGroup(migratedGroupId, true)?.deleted).toBe(1);
          expect(s.nodeGroups()).toEqual([]);
          expect(s.nodes()).toEqual([]);
          expect(s.all("SELECT id FROM subscriptions")).toEqual([{ id: 1 }]);
          expect(s.all("SELECT id FROM node_collections")).toEqual([{ id: 1 }]);
          await s.migrate();
          expect(s.nodeGroups()).toEqual([]);
        }
        integrity(s.db);
      } finally {
        s.close();
        rmSync(dir, { recursive: true, force: true });
      }
    });
});
