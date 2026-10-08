import type { Json, NormalizedNode } from "../../../packages/shared/schema";
export function getField(
  object: NormalizedNode,
  key: string,
): Json | undefined {
  let value: unknown = object;
  for (const part of key.split(".")) {
    if (!value || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value as Json | undefined;
}
export function setField(
  object: NormalizedNode,
  key: string,
  value: Json | undefined,
): NormalizedNode {
  const copy = structuredClone(object);
  const parts = key.split(".");
  let cursor: Record<string, unknown> = copy;
  for (const p of parts.slice(0, -1)) {
    if (!cursor[p] || typeof cursor[p] !== "object") cursor[p] = {};
    cursor = cursor[p] as Record<string, unknown>;
  }
  if (value === undefined) delete cursor[parts.at(-1)!];
  else cursor[parts.at(-1)!] = value;
  return copy;
}
export function nodeMatches(
  n: {
    name: string;
    protocol: string;
    normalized_config: NormalizedNode;
    tags: string[];
    enabled: boolean;
  },
  search: string,
  protocol: string,
  tag: string,
  status: string,
) {
  return (
    (!search ||
      `${n.name} ${n.normalized_config.server} ${n.protocol} ${n.tags.join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase())) &&
    (!protocol || n.protocol === protocol) &&
    (!tag || n.tags.includes(tag)) &&
    (!status || n.enabled === (status === "enabled"))
  );
}
