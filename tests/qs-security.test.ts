import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const rootRequire = createRequire(import.meta.url);
const expressRequire = createRequire(rootRequire.resolve("express"));
const qs = expressRequire("qs") as {
  stringify: (value: unknown, options?: Record<string, unknown>) => string;
};
const qsVersion = (expressRequire("qs/package.json") as { version: string })
  .version;

describe("GHSA-6pq8-jhm2-2vcw", () => {
  test("all Express dependency paths resolve the patched qs release", () => {
    expect(qsVersion).toBe("6.16.1");
  });

  test("comma arrays safely serialize an own non-callable toString", () => {
    const payload = JSON.parse('{"a":[{"toString":"x"}]}');

    expect(qs.stringify(payload, { arrayFormat: "comma" })).toBe(
      "a=%5Bobject%20Object%5D",
    );
    expect(
      qs.stringify(payload, {
        arrayFormat: "comma",
        encodeValuesOnly: true,
      }),
    ).toBe("a=%5Bobject%20Object%5D");
  });

  test("normal comma serialization remains compatible", () => {
    expect(qs.stringify({ a: ["b", "c"] }, { arrayFormat: "comma" })).toBe(
      "a=b%2Cc",
    );
    expect(
      qs.stringify(
        { a: ["b", "c"] },
        { arrayFormat: "comma", encodeValuesOnly: true },
      ),
    ).toBe("a=b,c");
    expect(qs.stringify({ a: [{ b: 1 }] }, { arrayFormat: "comma" })).toBe(
      "a=%5Bobject%20Object%5D",
    );
  });

  test("comma serialization handles nullish and nested values", () => {
    expect(
      qs.stringify({ a: [null, undefined, "x"] }, { arrayFormat: "comma" }),
    ).toBe("a=%2C%2Cx");
    expect(
      qs.stringify(
        { a: [[1, [{ toString: "x" }]], "y"] },
        { arrayFormat: "comma", encode: false },
      ),
    ).toBe("a=1,[object Object],y");
    expect(
      qs.stringify(
        { a: [[1, [{ toString: "x" }]], "y"] },
        { arrayFormat: "comma", encodeValuesOnly: true },
      ),
    ).toBe("a=1%2C%5Bobject%20Object%5D,y");
  });

  test("indices and ordinary query serialization are unchanged", () => {
    expect(qs.stringify({ a: ["b", "c"] }, { arrayFormat: "indices" })).toBe(
      "a%5B0%5D=b&a%5B1%5D=c",
    );
    expect(qs.stringify({ search: "node", enabled: true, page: 2 })).toBe(
      "search=node&enabled=true&page=2",
    );
  });
});
