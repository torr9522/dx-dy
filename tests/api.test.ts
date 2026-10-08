import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { createApp, type Options } from "../apps/api/src/app";
import {
  digest,
  decryptToken,
  encryptToken,
  randomToken,
} from "../apps/api/src/security";
import { vless, vmess } from "./fixtures";
import { parseNode } from "../packages/proxy-adapter";
const password = "Synthetic-admin-password-123!";
const options: Options = {
  database: ":memory:",
  masterKey: "1".repeat(64),
  initialPassword: password,
  publicBase: "http://localhost:3000",
};
describe("API and domain regression", () => {
  let system: Awaited<ReturnType<typeof createApp>>,
    agent: ReturnType<typeof request.agent>,
    csrf: string,
    nodes: number[],
    profile: number,
    second: number,
    url: string;
  beforeAll(async () => {
    system = await createApp(options);
    agent = request.agent(system.app);
    const login = await agent
      .post("/api/auth/login")
      .send({ username: "admin", password });
    csrf = login.body.csrf;
  });
  afterAll(() => system.store.close());
  const post = (route: string, body: object) =>
    agent.post(route).set("X-CSRF-Token", csrf).send(body);
  const patch = (route: string, body: object) =>
    agent.patch(route).set("X-CSRF-Token", csrf).send(body);
  it("health contains no secrets", async () => {
    expect((await request(system.app).get("/health")).body).toEqual({
      status: "ok",
      database: "ok",
      version: "0.1.0",
    });
  });
  it("unauthorized admin request fails", async () => {
    expect((await request(system.app).get("/api/nodes")).status).toBe(401);
  });
  it("CSRF and cross-origin mutation fail", async () => {
    expect(
      (await agent.post("/api/nodes/preview").send({ text: vless })).status,
    ).toBe(403);
    expect(
      (
        await post("/api/nodes/preview", { text: vless }).set(
          "Origin",
          "https://evil.example",
        )
      ).status,
    ).toBe(403);
  });
  it("preview does not write and retains errors", async () => {
    const p = await post("/api/nodes/preview", {
      text: vless + "\nbad\n" + vmess,
    });
    expect(p.status).toBe(200);
    expect(p.body[1].status).toBe("failure");
    expect(system.store.nodes()).toHaveLength(0);
  });
  it("atomic batch import, shared nodes and schema metadata", async () => {
    const r = await post("/api/nodes/import", {
      items: [{ uri: vless }, { uri: vmess }],
    });
    expect(r.status).toBe(201);
    nodes = r.body.map((n: { id: number }) => n.id);
    expect(system.store.nodes()).toHaveLength(2);
    expect(r.body[0].parser_name).toBe("Sub-Store");
  });
  it("invalid batch never partially writes", async () => {
    await post("/api/nodes/import", {
      items: [{ uri: vmess }, { uri: "bad" }],
    });
    expect(system.store.nodes()).toHaveLength(2);
  });
  it("create subscription, high entropy encrypted Token, no plaintext DB", async () => {
    const p = await post("/api/subscriptions", {
      name: "Synthetic",
      enabled: true,
    });
    profile = p.body.id;
    const s = await post("/api/subscriptions", {
      name: "Shared",
      enabled: true,
    });
    second = s.body.id;
    const u = await agent.get(`/api/subscriptions/${profile}/url`);
    url = u.body.url;
    const token = url.split("/").at(-1)!;
    expect(token).toMatch(/^[\w-]{43}$/);
    const row = system.store.get(
      "SELECT * FROM subscriptions WHERE id=?",
      profile,
    )!;
    expect(row.token_hash).toBe(digest(token));
    expect(row.token_ciphertext).not.toContain(token);
    expect(
      decryptToken(
        String(row.token_ciphertext),
        Buffer.from(options.masterKey, "hex"),
      ),
    ).toBe(token);
  });
  it("empty explicit authorization NEVER returns all nodes", async () => {
    const r = await request(system.app).get(
      new URL(url).pathname + "?format=raw",
    );
    expect(r.status).toBe(200);
    expect(r.text).toBe("");
  });
  it("many-to-many assignment and pivot order", async () => {
    for (const p of [profile, second])
      expect(
        (
          await agent
            .put(`/api/subscriptions/${p}/nodes`)
            .set("X-CSRF-Token", csrf)
            .send({ node_ids: nodes })
        ).status,
      ).toBe(200);
    expect(system.store.authorized(profile)).toHaveLength(2);
    expect(system.store.authorized(second)).toHaveLength(2);
    expect(system.store.get("SELECT COUNT(*) AS n FROM nodes")?.n).toBe(2);
  });
  it("node update appears in all referencing subscriptions", async () => {
    const n = system.store.findNode(nodes[0])!;
    const config = {
      ...n.normalized_config,
      port: 8443,
      name: "Edited synthetic",
    };
    expect(
      (
        await patch(`/api/nodes/${n.id}`, {
          normalized_config: config,
          remark: "edited",
          tags: ["tag"],
          enabled: true,
        })
      ).status,
    ).toBe(200);
    for (const p of [profile, second])
      expect(system.store.authorized(p)[0].normalized_config.port).toBe(8443);
    expect(system.store.findNode(n.id)?.original_uri).toBe(vless);
  });
  it("raw, V2Ray, Shadowrocket headers and semantic output", async () => {
    const path = new URL(url).pathname;
    const raw = await request(system.app).get(path + "?format=raw");
    expect(raw.text.split("\n")).toHaveLength(2);
    expect(raw.headers["cache-control"]).toBe("private, no-store");
    const v = await request(system.app).get(path + "?format=v2ray");
    expect(Buffer.from(v.text, "base64").toString()).toBe(raw.text);
    const sr = await request(system.app).get(path + "?format=shadowrocket");
    expect(sr.headers["content-type"]).toContain("text/plain");
    const lines = Buffer.from(sr.text, "base64").toString().split("\n");
    expect(lines).toHaveLength(2);
    expect(parseNode(lines[0]).normalized_config["reality-opts"]).toMatchObject(
      { "_spider-x": "/synthetic" },
    );
  });
  it("UA auto detection and explicit format priority", async () => {
    const path = new URL(url).pathname;
    const r = await request(system.app)
      .get(path)
      .set("User-Agent", "Shadowrocket");
    expect(r.headers["x-subscription-format"]).toBe("uri-fallback");
    const raw = await request(system.app)
      .get(path + "?format=raw")
      .set("User-Agent", "Shadowrocket");
    expect(raw.headers["x-subscription-format"]).toBe("raw");
  });
  it("reorder is persisted without names", async () => {
    const result = await agent
      .put(`/api/subscriptions/${profile}/nodes`)
      .set("X-CSRF-Token", csrf)
      .send({ node_ids: [...nodes].reverse() });
    expect(result.status).toBe(200);
    expect(system.store.authorized(profile)[0].id).toBe(nodes[1]);
  });
  it("duplicate or nonexistent assignment cannot change existing links", async () => {
    for (const list of [[nodes[0], nodes[0]], [999999]])
      expect(
        (
          await agent
            .put(`/api/subscriptions/${profile}/nodes`)
            .set("X-CSRF-Token", csrf)
            .send({ node_ids: list })
        ).status,
      ).toBe(400);
    expect(system.store.authorized(profile)).toHaveLength(2);
  });
  it("disabled node excluded from both profiles", async () => {
    const n = system.store.findNode(nodes[0])!;
    await patch(`/api/nodes/${n.id}`, {
      normalized_config: n.normalized_config,
      enabled: false,
      remark: n.remark,
      tags: n.tags,
    });
    for (const p of [profile, second])
      expect(system.store.authorized(p)).toHaveLength(1);
  });
  it("reimport preview, confirmed reimport and original restore", async () => {
    const n = nodes[0];
    const p = await post(`/api/nodes/${n}/reimport-preview`, { uri: vless });
    expect(p.body.diff.some((d: { field: string }) => d.field === "port")).toBe(
      true,
    );
    expect(
      (await post(`/api/nodes/${n}/reimport`, { uri: vless })).status,
    ).toBe(400);
    await post(`/api/nodes/${n}/reimport`, { uri: vless, confirm: true });
    expect(system.store.findNode(n)?.normalized_config.port).toBe(443);
    await post(`/api/nodes/${n}/restore`, { confirm: true });
    expect(system.store.findNode(n)?.remark).toBe("edited");
  });
  it("rotate immediately revokes old URL and retains decryptable new URL", async () => {
    expect(
      (await post(`/api/subscriptions/${profile}/rotate`, {})).status,
    ).toBe(200);
    expect((await request(system.app).get(new URL(url).pathname)).status).toBe(
      404,
    );
    url = (await agent.get(`/api/subscriptions/${profile}/url`)).body.url;
    expect((await request(system.app).get(new URL(url).pathname)).status).toBe(
      200,
    );
  });
  it("disabled subscription is unavailable", async () => {
    await patch(`/api/subscriptions/${profile}`, {
      name: "Synthetic",
      enabled: false,
    });
    expect((await request(system.app).get(new URL(url).pathname)).status).toBe(
      404,
    );
    await patch(`/api/subscriptions/${profile}`, {
      name: "Synthetic",
      enabled: true,
    });
  });
  it("wrong Token does not disclose internals", async () => {
    const r = await request(system.app).get("/s/" + randomToken());
    expect(r.status).toBe(404);
    expect(r.body).toEqual({
      error: { code: "NOT_FOUND", message: "订阅不可用" },
    });
  });
  it("referenced node deletion requires confirmation and cascades", async () => {
    expect(
      (
        await agent
          .delete(`/api/nodes/${nodes[0]}`)
          .set("X-CSRF-Token", csrf)
          .send({})
      ).status,
    ).toBe(409);
    await agent
      .delete(`/api/nodes/${nodes[0]}`)
      .set("X-CSRF-Token", csrf)
      .send({ confirm: true });
    expect(system.store.authorized(profile)).toHaveLength(1);
    expect(system.store.authorized(second)).toHaveLength(1);
  });
  it("delete subscription revokes token without deleting global nodes", async () => {
    await agent
      .delete(`/api/subscriptions/${profile}`)
      .set("X-CSRF-Token", csrf);
    expect((await request(system.app).get(new URL(url).pathname)).status).toBe(
      404,
    );
    expect(system.store.nodes()).toHaveLength(1);
  });
  it("security headers and administrator settings", async () => {
    const h = await agent.get("/api/settings");
    expect(h.headers["referrer-policy"]).toBe("no-referrer");
    expect(h.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(h.headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(
      (
        await agent
          .put("/api/settings")
          .set("X-CSRF-Token", csrf)
          .send({
            site_name: "测试",
            public_base_url: "http://localhost:3000",
            default_format: "raw",
          })
      ).status,
    ).toBe(200);
  });
  it("password hash and session not stored in plaintext", () => {
    expect(
      String(
        system.store.get("SELECT password_hash FROM admins")?.password_hash,
      ),
    ).toMatch(/^\$argon2id\$/);
    const row = system.store.get("SELECT * FROM admin_sessions")!;
    expect(String(row.session_hash)).toMatch(/^[a-f0-9]{64}$/);
  });
  it("password change revokes all sessions", async () => {
    expect(
      (
        await post("/api/auth/password", {
          current: password,
          password: "New-synthetic-password-123!",
        })
      ).status,
    ).toBe(200);
    expect((await agent.get("/api/nodes")).status).toBe(401);
  });
});
describe("isolated rate limits and token AEAD", () => {
  it("login limit", async () => {
    const s = await createApp({ ...options, loginLimit: 2 });
    for (let i = 0; i < 2; i++)
      expect(
        (
          await request(s.app)
            .post("/api/auth/login")
            .send({ username: "bad", password: "bad" })
        ).status,
      ).toBe(401);
    expect(
      (
        await request(s.app)
          .post("/api/auth/login")
          .send({ username: "bad", password: "bad" })
      ).status,
    ).toBe(429);
    s.store.close();
  });
  it("subscription limit", async () => {
    const s = await createApp({ ...options, subscriptionLimit: 2 });
    for (let i = 0; i < 2; i++) await request(s.app).get("/s/" + randomToken());
    expect((await request(s.app).get("/s/" + randomToken())).status).toBe(429);
    s.store.close();
  });
  it("tampered ciphertext rejected", () => {
    const key = Buffer.from(options.masterKey, "hex");
    const ciphertext = encryptToken("synthetic", key);
    expect(() => decryptToken(ciphertext.slice(0, -2) + "aa", key)).toThrow();
  });
});
