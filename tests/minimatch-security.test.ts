import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { minimatch, Minimatch } from "minimatch";

const require = createRequire(import.meta.url);
const minimatchPackage = JSON.parse(
  readFileSync(require.resolve("minimatch/package.json"), "utf8"),
) as { version: string };

describe("minimatch GHSA-g3hv-75wg-m249 regression", () => {
  it("resolves the patched release", () => {
    expect(minimatchPackage.version).toBe("11.0.1");
  });

  it("bounds **/.. preprocessing using braceExpandMax", () => {
    const pattern = Array(30).fill("**/../a/b").join("/");
    const matcher = new Minimatch(pattern, {
      optimizationLevel: 2,
      braceExpandMax: 64,
    });

    expect(matcher.set).toHaveLength(64);
  });

  it.each([
    ["src/index.ts", "src/*.ts", true],
    ["src/nested/index.ts", "src/**/*.ts", true],
    ["src/index.js", "src/**/*.ts", false],
    ["a/b/c", "a/**/c", true],
    ["a/.hidden/c", "a/**/c", false],
    ["[literal]", "[[]literal]", true],
    ["src/index.ts", "src/index.ts", true],
  ])("matches %s against %s", (path, pattern, expected) => {
    expect(minimatch(path, pattern)).toBe(expected);
  });

  it("handles nested and repeated patterns with bounded work", () => {
    const patterns = [
      "{src,tests}/**/*.{ts,tsx}",
      "src/**/../src/**/*.ts",
      "src/**/../src/**/*.ts",
    ];

    expect(
      patterns.map((pattern) =>
        minimatch("src/features/admin/index.ts", pattern, {
          optimizationLevel: 2,
          braceExpandMax: 128,
        }),
      ),
    ).toEqual([true, true, true]);
  });

  it("matches the file patterns used by the lint toolchain", () => {
    const matcher = new Minimatch("**/*.{js,mjs,cjs,ts,tsx}", { dot: true });

    expect(matcher.match("apps/api/src/main.ts")).toBe(true);
    expect(matcher.match("apps/web/src/App.tsx")).toBe(true);
    expect(matcher.match("docs/README.md")).toBe(false);
  });

  it("rejects invalid non-string patterns", () => {
    expect(() => new Minimatch(null as unknown as string)).toThrow(TypeError);
  });
});
