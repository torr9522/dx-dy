import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../apps/api/src/app";
import { fixtures, vless, vmess } from "./fixtures";

async function setup() {
  const system = await createApp({
    database: ":memory:",
    masterKey: "1".repeat(64),
    initialPassword: "Synthetic-delete-test-123!",
    adminBase: "http://localhost:3000",
    subscriptionBase: "http://localhost:3000",
  });
  const agent = request.agent(system.app);
  const login = await agent
    .post("/api/auth/login")
    .send({ username: "admin", password: "Synthetic-delete-test-123!" });
  const csrf = login.body.csrf;
  system.store.addNodeGroup("Delete Regression");
  const post = (url: string, body: object) =>
    agent.post(url).set("X-CSRF-Token", csrf).send(body);
  const globals = (
    await post("/api/nodes/import", {
      items: fixtures.slice(0, 3).map(([name, uri]) => ({ name, uri })),
    })
  ).body as { id: number }[];
  const create = async (name: string, ids: number[]) => {
    const p = (await post("/api/subscriptions", { name })).body as {
      id: number;
    };
    await agent
      .put(`/api/subscriptions/${p.id}/nodes`)
      .set("X-CSRF-Token", csrf)
      .send({ node_ids: ids })
      .expect(200);
    return p.id;
  };
  const del = (ids: number[]) =>
    post("/api/nodes/batch-delete", { node_ids: ids, confirm: true });
  const rows = () =>
    Object.fromEntries(
      [
        "nodes",
        "subscriptions",
        "subscription_nodes",
        "subscription_entries",
        "subscription_local_nodes",
        "node_collections",
        "node_collection_members",
      ].map((table) => [
        table,
        system.store.all(`SELECT * FROM ${table} ORDER BY rowid`),
      ]),
    );
  return { ...system, agent, csrf, post, globals, create, del, rows };
}

describe("Global cascading detach delete", () => {
  it("batch-removes two Globals from one mixed subscription and preserves every Local row", async () => {
    const s = await setup();
    try {
      const ids = s.globals.map((node) => node.id);
      const id = await s.create("Mixed batch", ids);
      await s
        .post(`/api/subscriptions/${id}/local-nodes/import`, {
          items: [
            { uri: vless, name: "Local overlap" },
            { uri: vmess, name: "Other Local" },
          ],
        })
        .expect(201);
      const e = s.store.subscriptionEntries(id);
      s.store.reorderEntries(id, [e[0].id, e[3].id, e[1].id, e[4].id, e[2].id]);
      const before = s.rows().subscription_local_nodes;
      const preview = await s
        .post("/api/nodes/delete-impact", { node_ids: [ids[0], ids[2]] })
        .expect(200);
      expect(preview.body).toMatchObject({
        referencedNodeCount: 2,
        subscriptionCount: 1,
        relationshipCount: 2,
      });
      const result = await s.del([ids[0], ids[2]]).expect(200);
      expect(result.body).toMatchObject({
        subscriptionCount: 1,
        relationshipCount: 2,
      });
      expect(s.rows().subscription_local_nodes).toEqual(before);
      expect(
        s.store
          .subscriptionEntries(id)
          .map((entry) => [entry.source, entry.position]),
      ).toEqual([
        ["local", 0],
        ["global", 1],
        ["local", 2],
      ]);
      expect(
        s.store.all(
          "SELECT node_id,position FROM subscription_nodes WHERE subscription_id=?",
          id,
        ),
      ).toEqual([{ node_id: ids[1], position: 1 }]);
    } finally {
      s.store.close();
    }
  });
  it("detaches from 15 subscriptions by ID, preserves equal Local, tokens and renderer order", async () => {
    const s = await setup();
    try {
      const ids = s.globals.map((node) => node.id);
      const subscriptions: number[] = [];
      for (let i = 0; i < 15; i++)
        subscriptions.push(await s.create(`Many-${i}`, ids));
      const mixed = subscriptions[0];
      await s
        .post(`/api/subscriptions/${mixed}/local-nodes/import`, {
          items: [
            { uri: vless, name: "Local same as deleted Global" },
            { uri: vmess, name: "Local same as kept Global" },
          ],
        })
        .expect(201);
      const entries = s.store.subscriptionEntries(mixed);
      s.store.reorderEntries(mixed, [
        entries[0].id,
        entries[3].id,
        entries[1].id,
        entries[4].id,
        entries[2].id,
      ]);
      const before = s.rows();
      const beforeFeed = (await s.agent.get(`/api/subscriptions/${mixed}/url`))
        .body.url as string;
      const decode = async () =>
        Buffer.from(
          (await request(s.app).get(new URL(beforeFeed).pathname)).text,
          "base64",
        )
          .toString("utf8")
          .split("\n")
          .filter(Boolean);
      expect(await decode()).toHaveLength(5);
      const impact = (
        await s
          .post("/api/nodes/delete-impact", { node_ids: [ids[0]] })
          .expect(200)
      ).body;
      expect(impact).toMatchObject({
        subscriptionCount: 15,
        relationshipCount: 15,
        referencedNodeCount: 1,
        entryCount: 15,
        legacyRelationshipCount: 15,
      });
      const result = await s.agent
        .delete(`/api/nodes/${ids[0]}`)
        .set("X-CSRF-Token", s.csrf)
        .send({ confirm: true })
        .expect(200);
      expect(result.body.subscriptionCount).toBe(15);
      expect(s.store.findNode(ids[0])).toBeUndefined();
      expect(s.rows().subscription_local_nodes).toEqual(
        before.subscription_local_nodes,
      );
      expect(
        s.rows().subscriptions.map(({ updated_at: _time, ...row }) => row),
      ).toEqual(
        before.subscriptions.map(({ updated_at: _time, ...row }) => row),
      );
      expect(
        (await s.agent.get(`/api/subscriptions/${mixed}/url`)).body.url,
      ).toBe(beforeFeed);
      for (const id of subscriptions) {
        const remaining = s.store.subscriptionEntries(id);
        expect(remaining.map((entry) => entry.position)).toEqual(
          remaining.map((_, i) => i),
        );
        expect(
          s.store.all(
            "SELECT node_id,position FROM subscription_nodes WHERE subscription_id=? ORDER BY position",
            id,
          ),
        ).toEqual(
          remaining
            .filter((entry) => entry.source === "global")
            .map((entry) => ({
              node_id: entry.node.id,
              position: entry.position,
            })),
        );
      }
      expect(
        s.store.subscriptionEntries(mixed).map((entry) => entry.source),
      ).toEqual(["local", "global", "local", "global"]);
      expect(await decode()).toHaveLength(4);
      expect(s.store.all("PRAGMA foreign_key_check")).toEqual([]);
    } finally {
      s.store.close();
    }
  });

  it("counts overlapping batch impact once, recalculates after preview, and preserves empty subscriptions", async () => {
    const s = await setup();
    try {
      const ids = s.globals.map((node) => node.id);
      const one = await s.create("Empty after delete", [ids[0]]);
      const two = await s.create("Mixed", [ids[0], ids[1]]);
      const before = s.rows().subscriptions;
      const preview = (
        await s.post("/api/nodes/delete-impact", { node_ids: ids }).expect(200)
      ).body;
      expect(preview).toMatchObject({
        nodeCount: 3,
        referencedNodeCount: 2,
        subscriptionCount: 2,
        relationshipCount: 3,
      });
      await s.agent
        .put(`/api/subscriptions/${two}/nodes`)
        .set("X-CSRF-Token", s.csrf)
        .send({ node_ids: ids })
        .expect(200);
      const result = await s.del(ids).expect(200);
      expect(result.body).toMatchObject({
        deleted: 3,
        subscriptionCount: 2,
        relationshipCount: 4,
      });
      expect(
        s.rows().subscriptions.map(({ updated_at: _time, ...row }) => row),
      ).toEqual(before.map(({ updated_at: _time, ...row }) => row));
      expect(s.store.subscriptionEntries(one)).toEqual([]);
      const url = (await s.agent.get(`/api/subscriptions/${one}/url`)).body.url;
      const empty = await request(s.app).get(new URL(url).pathname).expect(200);
      expect(empty.text).toBe("");
      expect(s.store.all("PRAGMA integrity_check")).toEqual([
        { integrity_check: "ok" },
      ]);
    } finally {
      s.store.close();
    }
  });

  it("rolls back nodes, relations, entries, positions and collections on a mid-batch failure", async () => {
    const s = await setup();
    try {
      const ids = s.globals.map((node) => node.id);
      await s.create("Rollback", ids);
      const c = (
        await s.post("/api/collections", { name: "Rollback collection" })
      ).body;
      await s
        .post(`/api/collections/${c.id}/nodes`, { node_ids: ids })
        .expect(200);
      const before = s.rows();
      s.store.db.exec(
        `CREATE TRIGGER fail_delete BEFORE DELETE ON nodes WHEN OLD.id=${ids[1]} BEGIN SELECT RAISE(ABORT,'injected failure'); END`,
      );
      expect(() => s.store.deleteGlobalNodes(ids)).toThrow("injected failure");
      expect(s.rows()).toEqual(before);
      s.store.db.exec("DROP TRIGGER fail_delete");
      s.store.db.exec(
        "CREATE TRIGGER fail_normalize BEFORE UPDATE OF position ON subscription_entries BEGIN SELECT RAISE(ABORT,'normalize failure'); END",
      );
      expect(() => s.store.deleteGlobalNodes([ids[0]])).toThrow(
        "normalize failure",
      );
      expect(s.rows()).toEqual(before);
      s.store.db.exec("DROP TRIGGER fail_normalize");
      await s.del(ids).expect(200);
      expect(s.rows().node_collection_members).toEqual([]);
      expect(s.rows().node_collections).toHaveLength(1);
    } finally {
      s.store.close();
    }
  });

  it("handles target-only legacy relations but refuses unrelated mirror corruption atomically", async () => {
    const s = await setup();
    try {
      const ids = s.globals.map((node) => node.id);
      const id = await s.create("Historical", ids);
      s.store.run(
        "DELETE FROM subscription_entries WHERE subscription_id=? AND node_id=?",
        id,
        ids[0],
      );
      expect(s.store.deleteGlobalNodes([ids[0]]).relationshipCount).toBe(1);
      s.store.run(
        "DELETE FROM subscription_nodes WHERE subscription_id=? AND node_id=?",
        id,
        ids[2],
      );
      const before = s.rows();
      expect(() => s.store.deleteGlobalNodes([ids[1]])).toThrow(
        "mirror is inconsistent",
      );
      expect(s.rows()).toEqual(before);
      const conflict = await s.del([ids[1]]).expect(409);
      expect(conflict.body.error.code).toBe("REFERENCE_INCONSISTENCY");
      expect(s.rows()).toEqual(before);
    } finally {
      s.store.close();
    }
  });

  it("keeps impact and destructive endpoints authenticated and validates selections", async () => {
    const s = await setup();
    try {
      await request(s.app)
        .post("/api/nodes/delete-impact")
        .send({ node_ids: [s.globals[0].id] })
        .expect(401);
      await s
        .post("/api/nodes/delete-impact", { node_ids: [999999] })
        .expect(400);
      await s.del([s.globals[0].id, s.globals[0].id]).expect(400);
      await s.agent
        .delete(`/api/nodes/${s.globals[0].id}`)
        .set("X-CSRF-Token", s.csrf)
        .send({})
        .expect(400);
      await s.agent
        .delete(`/api/nodes/${s.globals[0].id}`)
        .set("X-CSRF-Token", s.csrf)
        .send({ confirm: true })
        .expect(200);
      expect(s.store.nodes()).toHaveLength(2);
    } finally {
      s.store.close();
    }
  });
});
