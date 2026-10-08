import { describe, it, expect } from "vitest";
import {
  parseNode,
  generateURI,
  preview,
  generateShadowrocket,
  editConfig,
} from "../packages/proxy-adapter";
import { fixtures, vless, vmess, uuid } from "./fixtures";
import { parse as parseYaml } from "yaml";
describe("protocol adapter", () => {
  it("VMess unknown query survives edit and second parse", () => {
    const e = parseNode(vmess + "?foo=1&foo=2");
    e.normalized_config.port = 8443;
    const out = generateURI(e);
    expect(out).toContain("?foo=1&foo=2");
    expect(parseNode(out).normalized_config.port).toBe(8443);
  });
  it("within-batch duplicates are flagged without dropping either line", () => {
    const p = preview(vless + "\n" + vless);
    expect(p).toHaveLength(2);
    expect(p[1].duplicate).toBe(true);
  });
  it("name alone is not node identity but unknown parameters distinguish assets", () => {
    const e = parseNode(vless);
    expect(
      preview(vless.replace("#日本%20测试", "#Renamed"), [e])[0].duplicate,
    ).toBe(true);
    expect(
      preview(vless.replace("#", "&vendor=different#"), [e])[0].duplicate,
    ).toBe(false);
  });
  for (const [name, uri] of fixtures)
    it(name + " semantic round trip", () => {
      const e = parseNode(uri),
        again = parseNode(generateURI(e));
      expect(again.normalized_config.type).toBe(e.normalized_config.type);
      expect(again.normalized_config.server).toBe(e.normalized_config.server);
      expect(again.normalized_config.port).toBe(e.normalized_config.port);
      for (const key of ["uuid", "password", "sni", "flow", "tls", "network"])
        expect(again.normalized_config[key]).toEqual(e.normalized_config[key]);
    });
  it("Reality/SpiderX and Unicode fragment", () => {
    const e = parseNode(vless);
    expect(e.normalized_config.name).toBe("日本 测试");
    expect(e.normalized_config["reality-opts"]).toMatchObject({
      "public-key": "fake-public-key",
      "short-id": "abcd",
      "_spider-x": "/synthetic",
    });
  });
  it("unknown ordered duplicate and raw encoding survive editing", () => {
    const e = parseNode(
      vless.replace("#", "&x-vendor=keep%20me&foo=1&foo=2&MiXeD=%2B#"),
    );
    const updated = editConfig(e, {
      ...e.normalized_config,
      port: 8443,
      sni: "new.example.com",
    });
    const out = generateURI(updated);
    expect(out).toContain(":8443?");
    expect(out).toContain("sni=new.example.com");
    expect(out).not.toContain("sni=example.com");
    expect(out).toContain("x-vendor=keep%20me&foo=1&foo=2&MiXeD=%2B");
    expect(updated.original_uri).toBe(e.original_uri);
  });
  it("known key cannot be overridden by a forged sidecar", () => {
    const e = parseNode(vless);
    e.unknown_params.query.push({
      rawKey: "sni",
      decodedKey: "sni",
      rawValue: "old.example.com",
      decodedValue: "old.example.com",
      hasEquals: true,
      owned: false,
    });
    e.normalized_config.sni = "new.example.com";
    expect(generateURI(e)).not.toContain("old.example.com");
  });
  it("TUIC unknown spelling remains exact without normalized duplicates", () => {
    const e = parseNode(
      fixtures[10][1].replace("#", "&x-vendor=value&x-vendor=two#"),
    );
    expect(generateURI(e)).toContain("x-vendor=value&x-vendor=two");
    expect(generateURI(e)).not.toContain("x_vendor");
  });
  it("VMess private JSON fields survive known edits", () => {
    const json = JSON.parse(Buffer.from(vmess.slice(8), "base64").toString());
    json.vendor = { feature: "synthetic" };
    const e = parseNode(
      "vmess://" + Buffer.from(JSON.stringify(json)).toString("base64"),
    );
    e.normalized_config.port = 8443;
    const out = JSON.parse(
      Buffer.from(generateURI(e).slice(8), "base64").toString(),
    );
    expect(out.vendor).toEqual(json.vendor);
    expect(out.port).toBe("8443");
  });
  it("special password chars and URI encoding", () => {
    const e = parseNode(
      "trojan://test%3A%2B%25@example.com:443#%E6%B5%8B%E8%AF%95",
    );
    expect(parseNode(generateURI(e)).normalized_config.password).toBe(
      e.normalized_config.password,
    );
  });
  it("invalid input, invalid UUID and blank are errors", () => {
    for (const s of [
      "",
      "bad",
      "vless://bad@example.com:443",
      "vless://" + uuid + "@example.com:99999",
    ])
      expect(() => parseNode(s)).toThrow();
  });
  it("mixed multiline failures are retained", () => {
    const p = preview(vless + "\nINVALID\n\n" + vmess);
    expect(p).toHaveLength(3);
    expect(p[1].status).toBe("failure");
    expect(p[2].envelope?.normalized_config.type).toBe("vmess");
  });
  it("duplicate hint requires explicit selection, not silent collapse", () => {
    const e = parseNode(vless);
    const p = preview(vless, [e]);
    expect(p[0].duplicate).toBe(true);
    expect(p[0].envelope).not.toBeNull();
  });
  it("Shadowrocket native producer retains Reality and TLS", () => {
    const p = generateShadowrocket([
      parseNode(vless.replace("&spx=%2Fsynthetic", "")),
      parseNode(vmess),
    ]);
    expect(p.mode).toBe("sub-store-shadowrocket");
    const out = parseYaml(p.body);
    expect(out.proxies).toHaveLength(2);
    expect(out.proxies[0]["reality-opts"]["public-key"]).toBe(
      "fake-public-key",
    );
    expect(out.proxies[1].tls).toBe(true);
  });
  it("SpiderX uses lossless fallback rather than stripped Shadowrocket YAML", () => {
    const p = generateShadowrocket([parseNode(vless)]);
    expect(p.mode).toBe("uri-fallback");
    expect(Buffer.from(p.body, "base64").toString()).toContain(
      "spx=%2Fsynthetic",
    );
  });
  it("Shadowrocket unknown/XHTTP uses explicit lossless URI fallback", () => {
    const n = parseNode(vless.replace("#", "&vendor=x#"));
    const out = generateShadowrocket([n]);
    expect(out.mode).toBe("uri-fallback");
    expect(Buffer.from(out.body, "base64").toString()).toContain("vendor=x");
  });
  it("empty Shadowrocket is an empty list", () =>
    expect(parseYaml(generateShadowrocket([]).body).proxies).toEqual([]));
});
