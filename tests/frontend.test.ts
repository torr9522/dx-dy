import { describe, it, expect } from "vitest";
import { getField, setField, nodeMatches } from "../apps/web/src/fields";
import { parseNode } from "../packages/proxy-adapter";
import { vless } from "./fixtures";
import {
  selectedNodes,
  setRangeSelection,
  setVisibleSelection,
  visibleSelectionState,
  setGroupedSelection,
  semanticDuplicateOf,
} from "../apps/web/src/nodeSelection";
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

describe("shared node selection", () => {
  it("keeps the first visible semantic group and blocks selected/cross-source duplicates", () => {
    const keys = new Map([
      [1, "a"],
      [2, "b"],
      [3, "b"],
      [4, "c"],
    ]);
    const group = (id: number) => keys.get(id)!;
    const first = setGroupedSelection(
      new Set<number>(),
      [1, 2, 3, 4],
      true,
      group,
    );
    expect([...first.selected]).toEqual([1, 2, 4]);
    expect(first.blocked).toEqual([3]);
    const crossSource = setGroupedSelection(first.selected, [3], true, group);
    expect([...crossSource.selected]).toEqual([1, 2, 4]);
    expect(semanticDuplicateOf(3, first.selected, group)).toBe(2);
  });
  it("toggles one node with Set semantics", () => {
    const selected = setVisibleSelection(new Set([1]), [2], true);
    expect([...selected]).toEqual([1, 2]);
    expect([...setVisibleSelection(selected, [1], false)]).toEqual([2]);
  });

  it("selects and deselects only visible results", () => {
    const selected = setVisibleSelection(new Set([10, 11]), [1, 2, 3], true);
    expect([...selected]).toEqual([10, 11, 1, 2, 3]);
    expect([...setVisibleSelection(selected, [1, 2, 3], false)]).toEqual([
      10, 11,
    ]);
  });

  it("reports unchecked, partial and checked visible states", () => {
    expect(visibleSelectionState(new Set(), [1, 2])).toMatchObject({
      all: false,
      some: false,
    });
    expect(visibleSelectionState(new Set([1]), [1, 2])).toMatchObject({
      all: false,
      some: true,
    });
    expect(visibleSelectionState(new Set([1, 2, 9]), [1, 2])).toMatchObject({
      all: true,
      some: false,
    });
  });

  it("preserves earlier selections when filters change", () => {
    const japan = setVisibleSelection(new Set<number>(), [1, 2], true);
    const unitedStates = setVisibleSelection(japan, [3], true);
    expect([...unitedStates]).toEqual([1, 2, 3]);
  });

  it("selects a visible shift range", () => {
    expect([...setRangeSelection(new Set(), [2, 5, 8, 9], 2, 8)]).toEqual([
      2, 5, 8,
    ]);
  });

  it("skips disabled nodes in a shift range", () => {
    expect([
      ...setRangeSelection(new Set(), [1, 2, 3, 4], 1, 4, new Set([2, 3])),
    ]).toEqual([1, 4]);
  });

  it("treats a reset anchor as a single-node selection", () => {
    expect([...setRangeSelection(new Set([9]), [1, 2, 3], null, 2)]).toEqual([
      9, 2,
    ]);
  });

  it("filters a selected-only review without changing source order", () => {
    expect(
      selectedNodes([{ id: 1 }, { id: 2 }, { id: 3 }], new Set([3, 1])),
    ).toEqual([{ id: 1 }, { id: 3 }]);
  });
});
