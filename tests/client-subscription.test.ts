import { describe, it, expect } from "vitest";
import request from "supertest";
import { parse as parseYaml } from "yaml";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../apps/api/src/app";
import {
  detectClient,
  renderClient,
} from "../apps/api/src/client-subscription";
import {
  parseNode,
  generateUniversalBase64Subscription,
} from "../packages/proxy-adapter";
import type { SubscriptionEntry } from "../packages/shared/schema";
import { fixtures, uuid } from "./fixtures";

function entry(uri: string, id = 1, group = 1): SubscriptionEntry {
  const envelope = parseNode(uri);
  return {
    id,
    subscription_id: 1,
    source: "global",
    position: id - 1,
    node: {
      ...envelope,
      id,
      group_id: group,
      group_name: `Group ${group}`,
      name: envelope.normalized_config.name,
      protocol: envelope.normalized_config.type,
      remark: "",
      tags: [],
      enabled: true,
      created_at: "",
      updated_at: "",
      references: 0,
      collection_ids: [],
    },
  };
}

describe("source-evidenced client detection", () => {
  it.each([
    ["v2rayN/7.15.0", "v2rayn"],
    ["Mozilla v2rayN/7.15.0", "generic"],
    ["clash-verge/v2.4.4", "clash-verge"],
    ["FlClash/v0.8.0 clash-verge Platform/windows", "flclash"],
    ["mihomo.party/v1.9.0 (clash.meta)", "clash-party"],
    ["", "generic"],
    ["curl/8.0", "generic"],
    ["Mozilla/5.0 clash-verge/v2.4.4", "generic"],
    ["clash-verge/v2.4.4 sing-box", "generic"],
    ["HiddifyNext/2.0 (windows) like ClashMeta v2ray sing-box", "generic"],
    ["sing-box/1.12", "generic"],
    ["clash-verge/v2.4.4\r\n", "generic"],
  ])("resolves %j conservatively", (ua, profile) => {
    expect(detectClient(ua).id).toBe(profile);
  });
});

describe("shared structured renderer contracts", () => {
  const safeVless = `vless://${uuid}@example.com:443?security=tls&type=tcp#Same`;
  it("validates representative configs with real cores when parser binaries are configured", () => {
    const cores = {
      mihomo: process.env.DXDY_MIHOMO_BINARY,
      singbox: process.env.DXDY_SINGBOX_BINARY,
    };
    if (!cores.mihomo || !cores.singbox) return;
    const directory = mkdtempSync(path.join(tmpdir(), "dxdy-core-contract-"));
    try {
      const reality = fixtures[0][1]
        .replace("&spx=%2Fsynthetic", "")
        .replace("fake-public-key", Buffer.alloc(32, 7).toString("base64url"));
      const ss2022 = `ss://${Buffer.from(`2022-blake3-aes-128-gcm:${Buffer.alloc(16, 9).toString("base64")}`).toString("base64url")}@example.com:8388#SS2022`;
      const nodes = [
        safeVless,
        ...fixtures.slice(6).map((f) => f[1]),
        ...[1, 2, 3, 5].map((i) => fixtures[i][1]),
        reality,
        ss2022,
      ].map((uri, index) => entry(uri, index + 1));
      for (const family of ["mihomo", "singbox"] as const) {
        const result = renderClient(nodes, family);
        expect(result.counts.rendered).toBe(nodes.length);
        const file = path.join(
          directory,
          family === "mihomo" ? "config.yaml" : "config.json",
        );
        writeFileSync(file, result.body);
        execFileSync(
          cores[family]!,
          family === "mihomo" ? ["-t", "-f", file] : ["check", "-c", file],
          { stdio: "pipe" },
        );
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it.each(["mihomo", "singbox"] as const)(
    "renders all six protocols for %s without reordering",
    (family) => {
      const nodes = [safeVless, ...fixtures.slice(6).map((f) => f[1])].map(
        (uri, i) => entry(uri, i + 1),
      );
      const result = renderClient(nodes, family);
      expect(result.counts).toEqual({
        total: 6,
        rendered: 6,
        skipped: 0,
        lossy: 0,
      });
      const output =
        family === "mihomo"
          ? parseYaml(result.body).proxies
          : JSON.parse(result.body).outbounds.slice(1);
      expect(output.map((n: Record<string, unknown>) => n.type)).toEqual(
        family === "mihomo"
          ? ["vless", "vmess", "trojan", "ss", "hysteria2", "tuic"]
          : ["vless", "vmess", "trojan", "shadowsocks", "hysteria2", "tuic"],
      );
    },
  );
  it.each(["mihomo", "singbox"] as const)(
    "preserves cross-group duplicates and stable unique names in %s",
    (family) => {
      const nodes = [
        entry(safeVless, 1, 1),
        entry(safeVless, 2, 2),
        entry(safeVless, 3, 2),
      ];
      const result = renderClient(nodes, family);
      expect(result.counts.rendered).toBe(3);
      expect(renderClient(nodes, family).body).toBe(result.body);
      const output =
        family === "mihomo"
          ? parseYaml(result.body).proxies
          : JSON.parse(result.body).outbounds.slice(1);
      expect(
        new Set(output.map((n: Record<string, unknown>) => n.name || n.tag))
          .size,
      ).toBe(3);
      expect(nodes[0].node.name).toBe("Same");
    },
  );
  it("preserves Generic sidecars and rejects private or ignored structured parameters", () => {
    for (const suffix of [
      "&private_option=secret",
      "&spx=%2Fprivate",
      "&heartbeat=77",
      "&upmbps=20",
    ]) {
      const node = entry(safeVless.replace("#Same", `${suffix}#Same`));
      expect(renderClient([node], "generic").body).toBe(
        generateUniversalBase64Subscription([node.node]),
      );
      for (const family of ["mihomo", "singbox"] as const) {
        const result = renderClient([node], family);
        expect(result.available).toBe(false);
        expect(result.counts.lossy).toBe(1);
        expect(JSON.stringify(result.diagnostics)).not.toContain("secret");
      }
    }
  });
  it.each(["mihomo", "singbox"] as const)(
    "covers IPv6, WS, gRPC and HTTPUpgrade in %s",
    (family) => {
      for (const index of [1, 2, 3, 5]) {
        const result = renderClient([entry(fixtures[index][1])], family);
        expect(result.counts.rendered, `${family}: ${fixtures[index][0]}`).toBe(
          1,
        );
      }
      const reality = entry(fixtures[0][1].replace("&spx=%2Fsynthetic", ""));
      expect(renderClient([reality], family).counts.rendered).toBe(1);
      const xhttp = renderClient([entry(fixtures[4][1])], family);
      expect(xhttp.counts.rendered).toBe(family === "mihomo" ? 1 : 0);
    },
  );
});

describe("subscription route isolation", () => {
  it("keeps legacy output independent of UA, shares token, and isolates cache and explicit targets", async () => {
    const s = await createApp({
      database: ":memory:",
      masterKey: "3".repeat(64),
      initialPassword: "Synthetic-client-password-123!",
      adminBase: "http://localhost:3000",
      subscriptionBase: "http://localhost:3000",
    });
    try {
      const agent = request.agent(s.app);
      const login = await agent.post("/api/auth/login").send({
        username: "admin",
        password: "Synthetic-client-password-123!",
      });
      const csrf = login.body.csrf;
      const group = s.store.addNodeGroup("Group 1");
      const node = s.store.addNode(
        parseNode(
          `vless://${uuid}@example.com:443?security=tls&type=tcp#Synthetic`,
        ),
        "",
        [],
        true,
        group,
      );
      const profile = await agent
        .post("/api/subscriptions")
        .set("X-CSRF-Token", csrf)
        .send({ name: "Client fixture" })
        .expect(201);
      await agent
        .put(`/api/subscriptions/${profile.body.id}/nodes`)
        .set("X-CSRF-Token", csrf)
        .send({ node_ids: [node] })
        .expect(200);
      const preview = (
        await agent
          .get(`/api/subscriptions/${profile.body.id}/clients`)
          .expect(200)
      ).body;
      const legacy = new URL(preview.legacy_url).pathname;
      const smart = new URL(preview.smart_url).pathname;
      const body = (await request(s.app).get(legacy)).text;
      for (const ua of [
        "clash-verge/v2.4.4",
        "FlClash/v0.8.0 clash-verge Platform/windows",
        "",
        "sing-box/1.12",
      ]) {
        expect(
          (await request(s.app).get(legacy).set("User-Agent", ua)).text,
        ).toBe(body);
      }
      for (const ua of ["curl/8", "", "ClashMeta sing-box"]) {
        const response = await request(s.app)
          .get(smart)
          .set("User-Agent", ua)
          .expect(200);
        expect(response.text).toBe(body);
        expect(response.headers.vary).toContain("User-Agent");
        expect(response.headers["cache-control"]).toContain("no-store");
      }
      const detected = await request(s.app)
        .get(smart)
        .set("User-Agent", "clash-verge/v2.4.4")
        .expect(200);
      expect(detected.headers["x-subscription-format"]).toBe("mihomo");
      expect(parseYaml(detected.text).proxies).toHaveLength(1);
      for (const p of preview.profiles) {
        expect(new URL(p.url).pathname.split("/").at(-1)).toBe(
          legacy.split("/").at(-1),
        );
        const response = await request(s.app)
          .get(new URL(p.url).pathname)
          .set("User-Agent", "clash-verge/v2.4.4")
          .expect(200);
        expect(response.headers["x-subscription-format"]).toBe(p.family);
        expect(response.headers["x-subscription-rendered"]).toBe("1");
      }
      await agent
        .patch(`/api/subscriptions/${profile.body.id}`)
        .set("X-CSRF-Token", csrf)
        .send({ name: "Client fixture", enabled: false })
        .expect(200);
      await request(s.app).get(smart).expect(404);
      await request(s.app).get("/smart/invalid").expect(404);
    } finally {
      s.store.close();
    }
  });
});
