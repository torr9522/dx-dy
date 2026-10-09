# Protocol Compatibility

## Source And Representation

The adapter in [`packages/proxy-adapter`](../packages/proxy-adapter) is based on
the attributed Sub-Store snapshot
`a3e61061e50b40e5c5938969aab915d05d8d7069`. A parsed Node retains:

- `original_uri` for exact source/restore reference;
- `normalized_config` for known editable fields;
- ordered `unknown_params.query` plus `vmessExtra` for lossless private fields.

The current renderer, not an independent per-protocol fingerprint builder, is
the source of connection semantics.

## Supported Schemes

| Protocol | Current representation and notable coverage |
| --- | --- |
| VLESS | UUID, host/port, Reality/TLS/Vision flow, TCP/WS/gRPC/HTTPUpgrade/XHTTP, SNI, fingerprint, public key, short ID, SpiderX, ALPN and private query fields |
| VMess | Base64 JSON including address/port, losslessly preserved 8-4-4-4-12 hexadecimal credential, aid/security, transport/type/host/path, TLS/SNI/ALPN/fingerprint/insecure plus unknown JSON fields |
| Trojan | Password, host/port, TLS/SNI, transport and private query fields |
| Shadowsocks | Standard userinfo cipher/password form, host/port, plugin/query data and display fragment |
| Hysteria2 | `hysteria2://` and `hy2://`, password, host/port, TLS/SNI, bandwidth/obfuscation and retained private fields |
| TUIC | UUID/password, host/port, TLS/SNI and retained congestion/UDP/private options |

IPv6 authorities and percent-encoded values are covered by adapter regressions.
The catch-all normalized schema plus ordered raw sidecar protects unrecognized
fields from silent deletion. Preservation does not claim every private field is
understood by every client.

VMess credentials follow the ecosystem-compatible UUID-shaped representation:
exactly 32 hexadecimal digits in 8-4-4-4-12 hyphenated form, without enforcing
RFC UUID version or variant bits. This is scoped to VMess connection credentials;
VLESS, TUIC and application UUIDs retain strict RFC validation. Arbitrary,
unhyphenated, incorrectly grouped or non-hexadecimal values remain invalid.

## Rendering And Semantic Identity

Universal output renders current share URIs, joins them with LF and standard
Base64-encodes the UTF-8 bytes. URI protocols keep the entire rendered value
except the display fragment when forming a semantic key. VMess decodes JSON,
removes only `ps`, recursively stabilizes JSON object keys and retains all other
fields. A failure to canonicalize gets a unique-per-node fallback and a
development warning; it is not treated as a proven duplicate.

Do not sort/drop unknown query entries, merge duplicate keys, ignore values or
normalize uncertain spellings. Avoiding false-positive suppression has priority.

## Change Evidence

Before changing compatibility behavior:

1. inspect the pinned Sub-Store source and its relevant history;
2. compare mature active implementations;
3. distinguish merged code from issue claims/unmerged proposals;
4. add synthetic round-trip and output regressions;
5. preserve unknown/private fields and Universal alias parity;
6. use physical-client results only as acceptance evidence, never as a reason to
   add an untraced one-client branch.

The detailed evidence ledger is [SUBSCRIPTION_FORMAT.md](SUBSCRIPTION_FORMAT.md).
