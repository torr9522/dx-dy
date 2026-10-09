# dx-dy Capability Tree

## Core Data And UX

- Node Library, tags/status/order: [`db.ts`](../apps/api/src/db.ts), [`NodeLibrary.tsx`](../apps/web/src/NodeLibrary.tsx), [`api.test.ts`](../tests/api.test.ts).
- Ordered Subscription many-to-many: [`001_initial.sql`](../migrations/001_initial.sql), `subscription_nodes.position`.
- Collections many-to-many and bulk membership: [`002_node_collections.sql`](../migrations/002_node_collections.sql). Membership never deletes Nodes and means **NO AUTO SUBSCRIPTION**.
- Tri-state/filter persistence/review/Shift range/row selection/disabled skip: [`nodeSelection.tsx`](../apps/web/src/nodeSelection.tsx), [`frontend.test.ts`](../tests/frontend.test.ts), Playwright.

## Protocol, Import And Subscription

- VLESS, VMess, Trojan, Shadowsocks, Hysteria2 and TUIC: [`proxy-adapter`](../packages/proxy-adapter), [`adapter.test.ts`](../tests/adapter.test.ts).
- Reality, Vision, TLS, TCP, WS, gRPC, HTTPUpgrade, XHTTP, IPv6, URL encoding and unknown/private parameters: normalized config plus lossless sidecar; see [Protocol Compatibility](PROTOCOL_COMPATIBILITY.md).
- Complete URI/multiline preview, `original_uri`, normalized config and unknown sidecar: adapter/API tests.
- Standard Universal Base64, LF/UTF-8, canonical `/s/:token`, authenticated raw view and legacy aliases: [`app.ts`](../apps/api/src/app.ts).
- Hashed/encrypted Tokens and runtime Semantic duplicate protection: [`security.ts`](../apps/api/src/security.ts), adapter/API/E2E tests.

## Backup And Domains

- WAL-safe Portable DB and encrypted Full Migration (scrypt N=32768/r=8/p=1 + AES-256-GCM): [`database.ts`](../scripts/database.ts), [`database.test.ts`](../tests/database.test.ts).
- Single/dual host isolation and native Caddy: [`deploy/native`](../deploy/native), app/API/ops tests.

## Native Installation And Operations

- Debian 12, Ubuntu 22.04/24.04, amd64/arm64: [`install.sh`](../install.sh), [`ops.test.ts`](../tests/ops.test.ts).
- Bundled Node 26.10.0, architecture-specific production dependencies and artifacts: [`build-native-artifact.mjs`](../scripts/build-native-artifact.mjs).
- systemd lifecycle, journal logs, admin recovery, domain, backup/restore, doctor, uninstall, atomic update/rollback and legacy migration: [`ops/dx-dy`](../ops/dx-dy).
- Docker/Compose/GHCR: deprecated 0.1.8 migration/history and optional CI tooling only; not the 0.2.4 runtime.

## Security And Release

- Single admin, Argon2id, hashed sessions, CSRF/origin, secure cookies, no secret logs: API/security tests and [Security Model](SECURITY_MODEL.md).
- Service is non-root and localhost-only; secret env is root `0600`; Web has no privileged operations surface.
- Direct tags, source archive, amd64/arm64 artifacts, manifest/checksums, public privacy and Gitleaks gates: [Testing and Release](TESTING_AND_RELEASE.md), [workflows](../.github/workflows).
