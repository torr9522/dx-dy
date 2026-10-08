import { describe, it, expect } from "vitest";
import { getField, setField, nodeMatches } from "../apps/web/src/fields";
import { parseNode } from "../packages/proxy-adapter";
import { vless } from "./fixtures";
describe("frontend editor and filters", () => {
  it("nested edit is immutable", () => {
    const n = parseNode(vless).normalized_config;
    const next = setField(n, "reality-opts.short-id", "1234");
    expect(getField(next, "reality-opts.short-id")).toBe("1234");
    expect(getField(n, "reality-opts.short-id")).toBe("abcd");
  });
  it("unset parameter", () => {
    const n = parseNode(vless).normalized_config;
    expect(getField(setField(n, "sni", undefined), "sni")).toBeUndefined();
  });
  it("protocol, server, tag and enabled filtering", () => {
    const c = parseNode(vless).normalized_config;
    const n = {
      name: "Japan",
      protocol: "vless",
      normalized_config: c,
      tags: ["home"],
      enabled: true,
    };
    expect(nodeMatches(n, "example", "vless", "home", "enabled")).toBe(true);
    expect(nodeMatches(n, "home", "", "", "")).toBe(true);
    expect(nodeMatches(n, "VLESS", "", "", "")).toBe(true);
    expect(nodeMatches(n, "", "vmess", "", "")).toBe(false);
    expect(nodeMatches(n, "", "", "work", "")).toBe(false);
    expect(nodeMatches(n, "", "", "", "disabled")).toBe(false);
  });
});
