import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { createApp, type Options } from "../apps/api/src/app";
import {
  digest,
  decryptToken,
  encryptToken,
  randomToken,
} from "../apps/api/src/security";
import { vless, vmess, fixtures } from "./fixtures";
import { parseNode, generateURI } from "../packages/proxy-adapter";
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
      version: "0.1.1",
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
    expect(sr.text).toBe(v.text);
    expect(sr.text).toMatch(/^[A-Za-z0-9+/]*={0,2}$/);
    expect(Buffer.from(lines.join("\n")).toString("base64")).toBe(sr.text);
    expect(lines.join("\n")).not.toMatch(/^proxies:/);
    expect(lines).toHaveLength(2);
    expect(parseNode(lines[0]).normalized_config["reality-opts"]).toMatchObject(
      { "_spider-x": "/synthetic" },
    );
    const expected = system.store.authorized(profile);
    expect(lines.map((line) => parseNode(line).normalized_config)).toEqual(
      expected.map((node) => node.normalized_config),
    );
  });
  it("canonical format and explicit raw debug override", async () => {
    const path = new URL(url).pathname;
    const r = await request(system.app)
      .get(path)
      .set("User-Agent", "Shadowrocket");
    expect(r.headers["x-subscription-format"]).toBe("universal-base64");
    const raw = await request(system.app)
      .get(path + "?format=raw")
      .set("User-Agent", "Shadowrocket");
    expect(raw.headers["x-subscription-format"]).toBe("raw");
  });
  it.each(["Shadowrocket/2.2.60", "shadowrocket/3.0", "SHADOWROCKET"])(
    "version-independent UA %s uses Base64 without admin cookies",
    async (ua) => {
      const path = new URL(url).pathname;
      const automatic = await request(system.app)
        .get(path)
        .set("User-Agent", ua);
      const explicit = await request(system.app).get(
        path + "?format=shadowrocket",
      );
      const override = await request(system.app)
        .get(path + "?format=v2ray")
        .set("User-Agent", ua);
      expect(automatic.status).toBe(200);
      expect(automatic.headers.location).toBeUndefined();
      expect(automatic.text).toBe(explicit.text);
      expect(override.text).toBe(explicit.text);
      expect(override.headers["x-subscription-format"]).toBe(
        "universal-base64",
      );
    },
  );
  it.each(["", "?format=auto", "?format=v2ray", "?format=shadowrocket"])(
    "canonical/legacy %s is byte-identical across UAs and ignores old settings",
    async (query) => {
      system.store.set("default_format", "raw");
      const path = new URL(url).pathname;
      const expected = await request(system.app).get(path + "?format=v2ray");
      for (const ua of [
        "Shadowrocket/2.2.92",
        "shadowrocket/unknown",
        "v2rayN",
        "v2rayNG",
        "Mozilla/5.0",
        "curl/8",
        "Unknown-iOS-networking",
      ]) {
        const r = await request(system.app)
          .get(path + query)
          .set("User-Agent", ua)
          .set("Accept", "text/html");
        expect(r.status).toBe(200);
        expect(r.headers.location).toBeUndefined();
        expect(r.headers["content-type"]).toBe("text/plain; charset=utf-8");
        expect(r.headers["cache-control"]).toBe("private, no-store");
        expect(r.headers["content-encoding"]).toBeUndefined();
        expect(r.text).toBe(expected.text);
        expect(r.headers["x-subscription-format"]).toBe("universal-base64");
      }
    },
  );
  it("canonical empty profile and authenticated decoded summary", async () => {
    const p = await post("/api/subscriptions", { name: "Empty universal" });
    const path = new URL(
      (await agent.get(`/api/subscriptions/${p.body.id}/url`)).body.url,
    ).pathname;
    for (const query of [
      "",
      "?format=auto",
      "?format=v2ray",
      "?format=shadowrocket",
      "?format=raw",
    ])
      expect((await request(system.app).get(path + query)).text).toBe("");
    const preview = await agent.get(`/api/subscriptions/${profile}/preview`);
    expect(preview.body.mode).toBe("universal-base64");
    expect(preview.body.nodes).toEqual(
      system.store.authorized(profile).map((n) => ({
        name: n.normalized_config.name,
        protocol: n.normalized_config.type,
      })),
    );
    expect(preview.body.decoded).toBe(
      Buffer.from(preview.body.body, "base64").toString("utf8"),
    );
    expect(
      (await request(system.app).get(`/api/subscriptions/${profile}/preview`))
        .status,
    ).toBe(401);
    await agent
      .delete(`/api/subscriptions/${p.body.id}`)
      .set("X-CSRF-Token", csrf);
  });
  it("simple VMess and empty feeds never expose structured producer output", async () => {
    const p = await post("/api/subscriptions", { name: "Format regression" });
    const path = new URL(
      (await agent.get(`/api/subscriptions/${p.body.id}/url`)).body.url,
    ).pathname;
    const empty = await request(system.app).get(path + "?format=shadowrocket");
    expect(empty.status).toBe(200);
    expect(empty.text).toBe("");
    expect(empty.headers["content-type"]).toContain("text/plain");
    await agent
      .put(`/api/subscriptions/${p.body.id}/nodes`)
      .set("X-CSRF-Token", csrf)
      .send({ node_ids: [nodes[1]] });
    const vm = await request(system.app).get(path + "?format=shadowrocket");
    expect(vm.status).toBe(200);
    expect(vm.text).not.toMatch(/^proxies:/);
    expect(
      parseNode(Buffer.from(vm.text, "base64").toString()).normalized_config
        .type,
    ).toBe("vmess");
    await agent
      .delete(`/api/subscriptions/${p.body.id}`)
      .set("X-CSRF-Token", csrf);
  });
  it("invalid subscription never falls through to SPA HTML", async () => {
    const result = await request(system.app)
      .get("/s/" + randomToken())
      .set("Accept", "text/html");
    expect(result.status).toBe(404);
    expect(result.headers.location).toBeUndefined();
    expect(result.headers["content-type"]).toContain("application/json");
    expect(result.text).not.toMatch(/<!doctype|<html/i);
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
    const sr = await request(system.app).get(
      new URL(url).pathname + "?format=shadowrocket",
    );
    expect(Buffer.from(sr.text, "base64").toString().split("\n")).toHaveLength(
      1,
    );
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
    expect(
      (
        await request(system.app).get(
          new URL(url).pathname + "?format=shadowrocket",
        )
      ).status,
    ).toBe(404);
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
    const sr = await request(system.app).get(
      new URL(url).pathname + "?format=shadowrocket",
    );
    expect(sr.status).toBe(404);
    expect(sr.text).not.toMatch(/^proxies:|<!doctype|<html/i);
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
        await agent.put("/api/settings").set("X-CSRF-Token", csrf).send({
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
  it("six-protocol canonical feed uses current config, ordered duplicate sidecars and Unicode", async () => {
    const s = await createApp(options);
    try {
      const selected = [
        fixtures[0][1].replace("#", "&vendor=%2f&vendor=second&flag#"),
        fixtures[6][1],
        ...fixtures.slice(7).map((f) => f[1]),
      ];
      const envelopes = selected.map(parseNode);
      envelopes[0].normalized_config.port = 8443;
      const ids = envelopes.map((n) => s.store.addNode(n));
      const a = request.agent(s.app);
      const login = await a
        .post("/api/auth/login")
        .send({ username: "admin", password });
      const p = await a
        .post("/api/subscriptions")
        .set("X-CSRF-Token", login.body.csrf)
        .send({ name: "六协议虚构订阅" });
      await a
        .put(`/api/subscriptions/${p.body.id}/nodes`)
        .set("X-CSRF-Token", login.body.csrf)
        .send({ node_ids: [...ids].reverse() });
      const path = new URL(
        (await a.get(`/api/subscriptions/${p.body.id}/url`)).body.url,
      ).pathname;
      const r = await request(s.app).get(path).set("Accept", "text/html");
      expect(r.status).toBe(200);
      expect(r.text).toMatch(
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
      );
      const decoded = Buffer.from(r.text, "base64").toString("utf8");
      expect(Buffer.from(decoded, "utf8").toString("base64")).toBe(r.text);
      const lines = decoded.split("\n");
      expect(lines).toEqual([...envelopes].reverse().map(generateURI));
      expect(
        lines.map((line) => parseNode(line).normalized_config.type),
      ).toEqual(["tuic", "hysteria2", "ss", "trojan", "vmess", "vless"]);
      expect(decoded).not.toMatch(/\r|\uFEFF|proxies:|<!doctype|<html/i);
      const vl = new URL(lines[5]);
      expect(vl.port).toBe("8443");
      expect(decodeURIComponent(vl.hash.slice(1))).toBe("日本 测试");
      expect(vl.searchParams.getAll("vendor")).toEqual(["/", "second"]);
      expect(lines[5]).toContain("vendor=%2f&vendor=second&flag");
      for (const [field, value] of Object.entries({
        encryption: "none",
        security: "reality",
        flow: "xtls-rprx-vision",
        type: "tcp",
        headerType: "none",
        sni: "example.com",
        fp: "chrome",
        pbk: "fake-public-key",
        sid: "abcd",
        spx: "/synthetic",
      }))
        expect(vl.searchParams.get(field)).toBe(value);
      const vm = JSON.parse(
        Buffer.from(lines[4].slice(8), "base64").toString("utf8"),
      );
      expect(vm).toMatchObject({
        v: "2",
        ps: "虚构 VMess",
        add: "example.com",
        id: envelopes[1].normalized_config.uuid,
        net: "tcp",
        tls: "tls",
        sni: "example.com",
      });
      expect(Number(vm.port)).toBe(443);
      expect(Number(vm.aid)).toBe(0);
      // Pinned Sub-Store uses an empty type for plain TCP; other producers use none.
      expect(["", "none"]).toContain(vm.type);
      for (const format of ["v2ray", "shadowrocket", "auto"])
        expect(
          (await request(s.app).get(path + "?format=" + format)).text,
        ).toBe(r.text);
    } finally {
      s.store.close();
    }
  });
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
