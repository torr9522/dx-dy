import { stringify } from "yaml";
import { generateUniversalBase64Subscription } from "../../../packages/proxy-adapter";
import { structuredFamily } from "../../../packages/proxy-adapter/generated/upstream.mjs";
import {
  clientProfiles,
  type RendererFamily,
} from "../../../packages/shared/client-profiles";
import type {
  NodeRecord,
  SubscriptionEntry,
} from "../../../packages/shared/schema";

// Match request contracts, not arbitrary mentions of a core in browser UA text.
// Evidence: CLIENT_MATRIX.md; custom/ambiguous headers deliberately fall back.
export function detectClient(userAgent: string) {
  if (userAgent.length > 512 || /[\r\n]/.test(userAgent))
    return clientProfiles[0];
  const matches = [
    { id: "v2rayn", pattern: /^v2rayN\/\d+(?:\.\d+){1,3}$/i },
    {
      id: "clash-party",
      pattern: /^mihomo\.party\/v\d+(?:\.\d+)+(?:[-+\w.]*)? \(clash\.meta\)$/i,
    },
    {
      id: "clash-verge",
      pattern: /^clash-verge\/v?\d+(?:\.\d+)+(?:[-+\w.]*)?$/i,
    },
    {
      id: "flclash",
      pattern:
        /^FlClash\/v\d+(?:\.\d+)+(?:[-+\w.]*)? clash-verge Platform\/(?:windows|linux|macos|android)$/i,
    },
  ].filter(({ pattern }) => pattern.test(userAgent.trim()));
  return matches.length === 1
    ? clientProfiles.find((profile) => profile.id === matches[0].id)!
    : clientProfiles[0];
}

export type Compatibility = "SUPPORTED" | "UNSUPPORTED" | "LOSSY";
export type ClientDiagnostic = {
  node_id: number;
  source: "global" | "local";
  name: string;
  status: Compatibility;
  reason: string;
};

const common =
  "type name server port tls network sni udp tfo skip-cert-verify client-fingerprint alpn".split(
    " ",
  );
const protocolKeys: Record<string, string[]> = {
  vless:
    "uuid flow encryption packet-encoding _h2 reality-opts ws-opts grpc-opts xhttp-opts".split(
      " ",
    ),
  vmess: "uuid cipher alterId ws-opts grpc-opts".split(" "),
  trojan: ["password", "ws-opts", "grpc-opts"],
  ss: ["cipher", "password"],
  hysteria2: ["password", "obfs", "obfs-password"],
  tuic: "uuid password congestion-controller udp-relay-mode".split(" "),
};
const nestedKeys: Record<string, string[]> = {
  "reality-opts": ["public-key", "short-id"],
  "ws-opts": ["path", "headers", "v2ray-http-upgrade"],
  "grpc-opts": ["grpc-service-name", "_grpc-type"],
  "xhttp-opts": ["path", "host", "mode"],
};
// Parser ownership is broader than renderer support. Reject even owned URI
// options unless their normalized mapping has been audited for these families.
const structuredQueryKeys = new Set(
  "encryption flow security sni peer fp pbk sid type network host path serviceName mode alpn allowInsecure insecure allow_insecure packetEncoding packet-encoding aid scy cipher obfs obfs-password obfs_password congestion_control congestion-controller udp_relay_mode udp-relay-mode udp tfo"
    .toLowerCase()
    .split(" "),
);

function capability(
  node: NodeRecord,
  family: RendererFamily,
): { status: Compatibility; reason: string } {
  if (family === "generic")
    return { status: "SUPPORTED", reason: "Generic lossless URI" };
  const config = node.normalized_config;
  if (
    node.unknown_params.query.some(
      (entry) =>
        !entry.owned ||
        !structuredQueryKeys.has(entry.decodedKey.toLowerCase()),
    ) ||
    Object.keys(node.unknown_params.vmessExtra).length
  )
    return {
      status: "LOSSY",
      reason: "未知或私有参数无法在目标格式中证明无损表达",
    };
  const allowed = new Set([...common, ...(protocolKeys[config.type] || [])]);
  if (Object.keys(config).some((key) => !allowed.has(key)))
    return { status: "LOSSY", reason: "存在尚未验证的目标格式参数" };
  for (const [key, fields] of Object.entries(nestedKeys)) {
    const value = config[key];
    if (
      value &&
      (typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).some((field) => !fields.includes(field)))
    )
      return { status: "LOSSY", reason: "传输或安全参数超出已验证的目标能力" };
  }
  if (config._h2)
    return { status: "UNSUPPORTED", reason: "目标配置未验证此 HTTP/2 语义" };
  const grpc = config["grpc-opts"] as Record<string, unknown> | undefined;
  if (grpc?.["_grpc-type"] && grpc["_grpc-type"] !== "gun")
    return { status: "LOSSY", reason: "目标格式不能保留此 gRPC 模式" };
  if (
    family === "singbox" &&
    ["hysteria2", "tuic"].includes(config.type) &&
    config["client-fingerprint"]
  )
    return { status: "LOSSY", reason: "目标协议不支持此客户端指纹" };
  if (config.encryption && config.encryption !== "none")
    return {
      status: "UNSUPPORTED",
      reason: "目标格式未验证此 VLESS encryption",
    };
  if (config.flow && config.flow !== "xtls-rprx-vision")
    return { status: "UNSUPPORTED", reason: "目标格式不支持此 flow" };
  const network = config.network || "tcp";
  if (
    ![
      "tcp",
      "ws",
      "grpc",
      ...(family === "mihomo" && config.type === "vless" ? ["xhttp"] : []),
    ].includes(network)
  )
    return { status: "UNSUPPORTED", reason: "目标格式不支持此传输" };
  if (
    config.type === "tuic" &&
    config["udp-relay-mode"] &&
    !["native", "quic"].includes(String(config["udp-relay-mode"]))
  )
    return { status: "UNSUPPORTED", reason: "目标格式不支持此 UDP relay mode" };
  return { status: "SUPPORTED", reason: "已验证的共享格式转换" };
}

export function renderClient(
  entries: SubscriptionEntry[],
  family: RendererFamily,
) {
  const diagnostics: ClientDiagnostic[] = [];
  const rendered: Record<string, unknown>[] = [];
  const generic: NodeRecord[] = [];
  const usedNames = new Set(["dx-dy-select"]);
  for (const entry of entries) {
    const node = entry.node;
    let decision = node.enabled
      ? capability(node, family)
      : { status: "UNSUPPORTED" as const, reason: "节点已禁用" };
    if (decision.status === "SUPPORTED") {
      if (family === "generic") generic.push(node);
      else {
        const identity = `${entry.source === "global" ? "G" : "L"}${node.id}`;
        const base = `${node.name} [${node.group_name || "Local"}]`;
        let name = base;
        if (usedNames.has(name)) name = `${base} #${identity}`;
        while (usedNames.has(name)) name += ` #${identity}`;
        try {
          const converted = structuredFamily(
            [{ ...node.normalized_config, name }],
            family,
          );
          if (converted.warnings.length || converted.output.length !== 1)
            decision = {
              status: "UNSUPPORTED",
              reason: "共享转换器拒绝或警告此参数组合",
            };
          else {
            usedNames.add(name);
            rendered.push(converted.output[0]);
          }
        } catch {
          decision = {
            status: "UNSUPPORTED",
            reason: "共享转换器无法安全表达此节点",
          };
        }
      }
    }
    diagnostics.push({
      node_id: node.id,
      source: entry.source,
      name: node.name,
      ...decision,
    });
  }
  const emitted = family === "generic" ? generic.length : rendered.length;
  const counts = {
    total: entries.length,
    rendered: emitted,
    skipped: entries.length - emitted,
    lossy: diagnostics.filter((d) => d.status === "LOSSY").length,
  };
  const names = rendered.map((node) =>
    String(family === "mihomo" ? node.name : node.tag),
  );
  const body =
    family === "generic"
      ? generateUniversalBase64Subscription(generic)
      : family === "mihomo"
        ? stringify({
            "mixed-port": 7890,
            "allow-lan": false,
            mode: "rule",
            proxies: rendered,
            "proxy-groups": [
              { name: "dx-dy-select", type: "select", proxies: names },
            ],
            rules: ["MATCH,dx-dy-select"],
          })
        : JSON.stringify(
            {
              outbounds: [
                { type: "selector", tag: "dx-dy-select", outbounds: names },
                ...rendered,
              ],
              route: { final: "dx-dy-select" },
            },
            null,
            2,
          );
  return {
    body,
    counts,
    diagnostics,
    available: emitted > 0,
    contentType:
      family === "mihomo"
        ? "application/yaml; charset=utf-8"
        : family === "singbox"
          ? "application/json; charset=utf-8"
          : "text/plain; charset=utf-8",
  };
}
