# Clash Meta / Mihomo Source Audit

Audit date: 2026-10-26.

## Upstream identity

- Official core: [MetaCubeX/mihomo](https://github.com/MetaCubeX/mihomo).
  The upstream README describes it as the Mihomo kernel and links MetaCubeXD as
  its first-class dashboard. The project continues the Clash Meta lineage; the
  executable identifies itself as `Mihomo Meta`.
- Latest non-prerelease GitHub Release at audit time:
  [v1.19.33](https://github.com/MetaCubeX/mihomo/releases/tag/v1.19.33),
  published 2026-10-21. Its tag resolves to
  `3f27ef39f8c96bbfbc8b0b9bb10f5c9ef60149d8`.
- Parser gate asset: `mihomo-linux-amd64-v1.19.33.gz`. GitHub Release metadata
  reports SHA-256
  `132f6f3edf9a65e62f04853aed3358472e0b2b7666daa8419edfa2ddf5bb6323`;
  the independently downloaded asset matched it.
- The tagged `main.go` defines `-f` as the configuration file and `-t` as
  configuration validation followed by exit. The validation command used by
  this project is therefore `mihomo -t -f <generated-config>`.

## Subscription User-Agent

Current [MetaCubeX/metacubexd](https://github.com/MetaCubeX/metacubexd) commit
`8bbc8f58fef71148a94fb5c0ff808f79b057337d` sets the remote profile import UA
to the exact literal `clash.meta`, stores it with the profile and reuses it on
refresh (`packages/agent/src/profiles.ts`). Its tests assert the same value.

No upstream evidence was found for a version suffix or broad `clash` match.
dx-dy consequently recognizes only the trimmed exact lowercase contract
`clash.meta`. Values such as `Clash.Meta`, `clash.meta/1.19.33`, browser text
containing the token, and unrelated Clash clients continue to use the Generic
fallback unless they match another independently evidenced profile contract.

## Renderer decision

Clash Meta clients consume the current Mihomo YAML configuration schema. dx-dy
therefore adds a `clash-meta` client profile but maps it to the existing
`mihomo` renderer family. It does not fork a `CLASH_META_YAML` renderer.

The renderer is still guarded by per-node `SUPPORTED`, `UNSUPPORTED` and
`LOSSY` diagnostics. Unsupported or unverified data is not silently dropped and
reported as fully compatible. The canonical `/s/:token` endpoint remains
UA-independent, while `/smart/:token` performs the exact detection and
`/client/clash-meta/:token` fixes the explicit target regardless of request UA.

## Parser matrix

Synthetic fixtures are used exclusively. Official Mihomo v1.19.33 accepted one
generated configuration containing VLESS Reality/Vision, VLESS WS, VLESS gRPC,
VLESS HTTPUpgrade, VLESS XHTTP, VMess TLS/TCP, VMess TLS/WS, Trojan TCP/WS/gRPC, standard Shadowsocks,
Shadowsocks 2022, Hysteria2, TUIC and IPv6. Tests also assert critical scalar,
transport, TLS, Reality, obfuscation and UDP relay fields before invoking the
official parser.

The current dx-dy data model does not normalize a fully audited Shadowsocks
plugin schema or Hysteria2 bandwidth schema for structured output. Such URI
extras remain preserved by Generic output and are marked `LOSSY` for Mihomo
instead of being discarded. This is a deliberate evidence boundary, not a
claim that Mihomo itself lacks those capabilities.
