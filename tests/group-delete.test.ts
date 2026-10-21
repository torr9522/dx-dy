import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../apps/api/src/app";
import { fixtures, vless, vmess } from "./fixtures";

async function setup(name = "Group delete") {
  const s = await createApp({
    database: ":memory:",
    masterKey: "1".repeat(64),
    initialPassword: "Synthetic-group-delete-123!",
    adminBase: "http://localhost:3000",
    subscriptionBase: "http://localhost:3000",
  });
  const agent = request.agent(s.app);
  const login = await agent
    .post("/api/auth/login")
    .send({ username: "admin", password: "Synthetic-group-delete-123!" });
  const write = (
    url: string,
    body: object = {},
    method: "post" | "put" | "delete" | "patch" = "post",
  ) => agent[method](url).set("X-CSRF-Token", login.body.csrf).send(body);
  const group = (await write("/api/node-groups", { name }).expect(201)).body;
  const other = (await write("/api/node-groups", { name: "Other" }).expect(201))
    .body;
  const importTo = async (group_id: number, uris: string[]) =>
    (
      await write("/api/nodes/import", {
        group_id,
        items: uris.map((uri) => ({ uri })),
      }).expect(201)
    ).body as { id: number }[];
  const nodes = await importTo(group.id, [vless, vmess, fixtures[7][1]]);
  const kept = await importTo(other.id, [vless]);
  const sub = async (name: string, ids: number[]) => {
    const p = (
      await write("/api/subscriptions", { name, remark: "preserve" }).expect(
        201,
      )
    ).body;
    await write(
      `/api/subscriptions/${p.id}/nodes`,
      { node_ids: ids },
      "put",
    ).expect(200);
    return p.id as number;
  };
  const mixed = await sub("Mixed", [nodes[0].id, nodes[1].id, kept[0].id]);
  await write(`/api/subscriptions/${mixed}/local-nodes/import`, {
    items: [{ uri: vless }],
  }).expect(201);
  const e = s.store.subscriptionEntries(mixed);
  s.store.reorderEntries(mixed, [e[0].id, e[3].id, e[1].id, e[2].id]);
  const empty = await sub("Becomes empty", [nodes[0].id, nodes[2].id]);
  const collection = (
    await write("/api/collections", { name: "Collection" }).expect(201)
  ).body;
  await write(`/api/collections/${collection.id}/nodes`, {
    node_ids: [...nodes, ...kept].map((n) => n.id),
  }).expect(200);
  const rows = () =>
    Object.fromEntries(
      [
        "node_groups",
        "nodes",
        "subscriptions",
        "subscription_entries",
        "subscription_nodes",
        "subscription_local_nodes",
        "node_collections",
        "node_collection_members",
        "settings",
      ].map((table) => [
        table,
        s.store.all(`SELECT * FROM ${table} ORDER BY rowid`),
      ]),
    );
  const del = (confirm = true) =>
    write(`/api/node-groups/${group.id}`, { confirm }, "delete");
  return {
    ...s,
    agent,
    write,
    group,
    other,
    nodes,
    kept,
    mixed,
    empty,
    sub,
    importTo,
    rows,
    del,
  };
}

describe("atomic Group cascading detach delete", () => {
  it("atomically deletes a 100-node Group with no subscription references", async () => {
    const s = await setup();
    try {
      const group = (await s.write("/api/node-groups", { name: "100 nodes" }))
        .body;
      await s.importTo(
        group.id,
        Array.from(
          { length: 100 },
          (_, i) =>
            `trojan://synthetic-${i}@scale.example.test:${10000 + i}?sni=scale.example.test#Scale-${i}`,
        ),
      );
      const before = s.rows();
      const result = await s
        .write(`/api/node-groups/${group.id}`, { confirm: true }, "delete")
        .expect(200);
      expect(result.body).toMatchObject({
        deleted: 100,
        subscriptionCount: 0,
        relationshipCount: 0,
      });
      expect(s.rows()).toEqual({
        ...before,
        node_groups: before.node_groups.filter((g) => g.id !== group.id),
        nodes: before.nodes.filter((n) => n.group_id !== group.id),
      });
    } finally {
      s.store.close();
    }
  });
  it("rejects unrelated reference mirror corruption without committing any Group deletion", async () => {
    const s = await setup();
    try {
      s.store.run(
        "DELETE FROM subscription_entries WHERE subscription_id=? AND node_id=?",
        s.mixed,
        s.kept[0].id,
      );
      const before = s.rows();
      await s.del().expect(409);
      expect(s.rows()).toEqual(before);
    } finally {
      s.store.close();
    }
  });
  for (const name of ["Group delete", "原节点库"])
    it(`deletes ${name} by ownership, preserving identities, Local and equal-semantic other Group records`, async () => {
      const s = await setup(name);
      try {
        const before = s.rows();
        const urls = await Promise.all(
          [s.mixed, s.empty].map(
            async (id) =>
              (await s.agent.get(`/api/subscriptions/${id}/url`)).body.url,
          ),
        );
        const preview = await s.agent
          .get(`/api/node-groups/${s.group.id}/delete-impact`)
          .expect(200);
        expect(preview.body).toMatchObject({
          groupName: name,
          nodeCount: 3,
          referencedNodeCount: 3,
          subscriptionCount: 2,
          relationshipCount: 4,
          collectionMembershipCount: 3,
        });
        await s.del(false).expect(409);
        expect(s.rows()).toEqual(before);
        await s
          .write(
            `/api/node-groups/${s.group.id}`,
            { name: name + " renamed" },
            "patch",
          )
          .expect(200);
        const result = await s.del().expect(200);
        expect(result.body).toMatchObject({
          deleted: 3,
          subscriptionCount: 2,
          relationshipCount: 4,
        });
        const after = s.rows();
        expect(after.node_groups).toEqual(
          before.node_groups.filter((r) => r.id !== s.group.id),
        );
        expect(after.nodes).toEqual(
          before.nodes.filter((r) => r.group_id !== s.group.id),
        );
        for (const table of [
          "subscription_local_nodes",
          "node_collections",
          "settings",
        ])
          expect(after[table]).toEqual(before[table]);
        expect(
          after.subscriptions.map(({ updated_at: _time, ...r }) => r),
        ).toEqual(before.subscriptions.map(({ updated_at: _time, ...r }) => r));
        expect(after.node_collection_members).toEqual(
          before.node_collection_members.filter(
            (r) => r.node_id === s.kept[0].id,
          ),
        );
        expect(
          s.store
            .subscriptionEntries(s.mixed)
            .map((e) => [e.source, e.node.id, e.position]),
        ).toEqual([
          ["local", Number(before.subscription_local_nodes[0].id), 0],
          ["global", s.kept[0].id, 1],
        ]);
        expect(s.store.subscriptionEntries(s.empty)).toEqual([]);
        for (const [i, id] of [s.mixed, s.empty].entries())
          expect(
            (await s.agent.get(`/api/subscriptions/${id}/url`)).body.url,
          ).toBe(urls[i]);
        const output = await request(s.app)
          .get(new URL(urls[0]).pathname)
          .expect(200);
        expect(
          Buffer.from(output.text, "base64").toString().split("\n"),
        ).toHaveLength(2);
        expect(
          (await request(s.app).get(new URL(urls[1]).pathname).expect(200))
            .text,
        ).toBe("");
        expect(s.store.all("PRAGMA foreign_key_check")).toEqual([]);
        expect(s.store.get("PRAGMA integrity_check")).toEqual({
          integrity_check: "ok",
        });
        await s.del().expect(404);
        await s.agent
          .get(`/api/node-groups/${s.group.id}/delete-impact`)
          .expect(404);
        expect(s.rows()).toEqual(after);
      } finally {
        s.store.close();
      }
    });

  for (const fault of ["relation", "node", "group", "position", "mirror"])
    it(`rolls back every table when ${fault} fails, including after Group deletion`, async () => {
      const s = await setup();
      try {
        const before = s.rows();
        const trigger = {
          relation: "AFTER DELETE ON subscription_entries",
          node: `BEFORE DELETE ON nodes WHEN OLD.id=${s.nodes[1].id}`,
          group: "AFTER DELETE ON node_groups",
          position: "BEFORE UPDATE OF position ON subscription_entries",
          mirror: "BEFORE INSERT ON subscription_nodes",
        }[fault]!;
        s.store.db.exec(
          `CREATE TRIGGER inject_failure ${trigger} BEGIN SELECT RAISE(ABORT,'isolated injected failure'); END`,
        );
        expect(() => s.store.deleteNodeGroup(s.group.id, true)).toThrow(
          "isolated injected failure",
        );
        expect(s.rows()).toEqual(before);
        s.store.db.exec("DROP TRIGGER inject_failure");
        await s.del().expect(200);
        expect(s.store.all("PRAGMA foreign_key_check")).toEqual([]);
      } finally {
        s.store.close();
      }
    });

  it("recomputes stale previews and rejects stale writes/copies after atomic deletion", async () => {
    const s = await setup();
    try {
      const preview = (
        await s.agent.get(`/api/node-groups/${s.group.id}/delete-impact`)
      ).body;
      const laterNodes = await s.importTo(s.group.id, [fixtures[8][1]]);
      const later = await s.sub("New reference after preview", [
        s.nodes[0].id,
        laterNodes[0].id,
        s.kept[0].id,
      ]);
      const results = await Promise.all([s.del(), s.del()]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
      expect(results.find((r) => r.status === 200)!.body).toMatchObject({
        deleted: preview.nodeCount + 1,
        subscriptionCount: 3,
        relationshipCount: 6,
      });
      expect(s.store.subscriptionEntries(later).map((e) => e.node.id)).toEqual([
        s.kept[0].id,
      ]);
      const before = s.rows();
      await s
        .write(
          `/api/subscriptions/${later}/nodes`,
          { node_ids: [s.nodes[0].id] },
          "put",
        )
        .expect(400);
      await s
        .write(`/api/node-groups/${s.group.id}/copy`, {
          node_ids: [s.kept[0].id],
        })
        .expect(404);
      expect(s.rows()).toEqual(before);
    } finally {
      s.store.close();
    }
  });

  it("deletes empty/single-node groups and rejects an empty-group preview that becomes populated without confirmation", async () => {
    const s = await setup();
    try {
      const empty = (await s.write("/api/node-groups", { name: "Empty" })).body;
      expect(s.store.groupDeleteImpact(empty.id)).toMatchObject({
        nodeCount: 0,
        subscriptionCount: 0,
        relationshipCount: 0,
      });
      const before = s.rows();
      await s.write(`/api/node-groups/${empty.id}`, {}, "delete").expect(200);
      expect(s.rows()).toEqual({
        ...before,
        node_groups: before.node_groups.filter((g) => g.id !== empty.id),
      });
      const one = (await s.write("/api/node-groups", { name: "One" })).body;
      await s.importTo(one.id, [vless]);
      const populated = s.rows();
      await s.write(`/api/node-groups/${one.id}`, {}, "delete").expect(409);
      expect(s.rows()).toEqual(populated);
      await s
        .write(`/api/node-groups/${one.id}`, { confirm: true }, "delete")
        .expect(200);
      expect(s.store.nodes().some((n) => n.group_id === one.id)).toBe(false);
    } finally {
      s.store.close();
    }
  });
});
