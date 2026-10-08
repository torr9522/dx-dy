# dx-dy Capability Tree

This map connects product capabilities to their implementation and primary
regressions.

## Core Data

- Node Library: lossless envelopes in [`schema.ts`](../packages/shared/schema.ts)
  and CRUD in [`db.ts`](../apps/api/src/db.ts); API coverage in
  [`api.test.ts`](../tests/api.test.ts).
- Subscriptions and ordered `subscription_nodes`: schema in
  [`001_initial.sql`](../migrations/001_initial.sql), routes/rendering in
  [`app.ts`](../apps/api/src/app.ts).
- Tags, enabled status and ordering: UI in
  [`NodeLibrary.tsx`](../apps/web/src/NodeLibrary.tsx), persistence in `db.ts`.
- Collections and many-to-many membership:
  [`002_node_collections.sql`](../migrations/002_node_collections.sql); bulk and
  boundary tests in `api.test.ts` and [`workflow.spec.ts`](../tests/e2e/workflow.spec.ts).

## Protocol Handling

- VLESS, VMess, Trojan, Shadowsocks, Hysteria2 and TUIC share the pinned adapter
  in [`proxy-adapter/index.ts`](../packages/proxy-adapter/index.ts).
- Reality, Vision, TLS, TCP, WS, gRPC, HTTPUpgrade, XHTTP, IPv6, URL encoding and
  unknown/private parameters are preserved through normalized config plus the
  ordered sidecar; see [`adapter.test.ts`](../tests/adapter.test.ts).
- Exact supported/preserved behavior and evidence rules are documented in
  [Protocol Compatibility](PROTOCOL_COMPATIBILITY.md).

## Import

- Complete share URI and multiline preview/import: parser and `preview()` in
  `proxy-adapter/index.ts`; API/UI flows in `app.ts` and `NodeLibrary.tsx`.
- Lossless representation: `original_uri`, `normalized_config` and
  `unknown_params` are defined in `schema.ts` and round-trip tested in
  `adapter.test.ts`.
- Preview reports parser warnings and raw/semantic duplicates without using
  real credentials.

## Subscription

- Universal output: UTF-8 URI lines joined with LF, standard Base64 in
  `generateUniversalBase64Subscription()`.
- Canonical `/s/:token`, raw admin preview and byte-identical legacy aliases:
  `app.ts`, covered by `api.test.ts`.
- Token safety: hash/encryption primitives in
  [`security.ts`](../apps/api/src/security.ts).
- Semantic duplicate protection: current rendered URI; URI fragment removed,
  VMess `ps` removed through deterministic JSON, other fields retained,
  conservative per-node fallback. See `getNodeSemanticKey()` and dedupe tests in
  `adapter.test.ts`, `api.test.ts` and Playwright.

## Selection UX

- Tri-state current-result selection, persistence across filters, selected
  review, Shift ranges, row clicks and disabled-row skipping:
  [`nodeSelection.tsx`](../apps/web/src/nodeSelection.tsx) and
  [`frontend.test.ts`](../tests/frontend.test.ts).
- Manual, filtered select-all, Shift and cross-source semantic conflict handling
  is exercised by [`workflow.spec.ts`](../tests/e2e/workflow.spec.ts).

## Collections

- Many-to-many and bulk membership operations are transactional in `db.ts`.
- Removing membership never deletes a Node. Collections never auto-populate a
  Subscription: **NO AUTO SUBSCRIPTION**.
- Regression coverage: `api.test.ts`, `persistence.test.ts` and Playwright.

## Backup

- WAL-safe portable DB: [`database-safety.ts`](../apps/api/src/database-safety.ts)
  and [`database.ts`](../scripts/database.ts).
- Full Migration: scrypt (`N=32768`, `r=8`, `p=1`) + AES-256-GCM bundle carrying
  the DB and `APP_MASTER_KEY`; tests in [`database.test.ts`](../tests/database.test.ts).
- Restore, Token continuity, forward migration and failure safety are documented
  in [Backup and Recovery](BACKUP_AND_RECOVERY.md).

## Domains

- Single/dual-domain Caddy templates: [`deploy`](../deploy).
- Admin host compatibility and subscription-only isolation: `app.ts`, templates
  and `api.test.ts`.
- Root-coordinated DNS/TLS/domain changes: `ops/dx-dy`; database origin command:
  [`domain-cli.ts`](../scripts/domain-cli.ts).

## Installation

- Debian 12, Ubuntu 22.04/24.04 and amd64/arm64 preflight:
  [`install.sh`](../install.sh).
- Docker Engine/Compose bootstrap, secure config, Caddy and idempotence tests:
  [`ops.test.ts`](../tests/ops.test.ts).

## Operations

- Interactive/non-interactive manager: [`ops/dx-dy`](../ops/dx-dy).
- Status, lifecycle, update, admin recovery, domain, backup, migration, restore,
  bounded logs, doctor and protected uninstall are tested in `ops.test.ts`.
- Application-owned credential mutation: [`admin-cli.ts`](../scripts/admin-cli.ts)
  and [`admin-cli.test.ts`](../tests/admin-cli.test.ts).

## Security

- Single admin, Argon2id password hash, hashed sessions, CSRF/origin validation,
  rate limits and secure cookies: `app.ts`, `admin-service.ts`, `security.ts`.
- Hashed/encrypted subscription Tokens; no secret logging; protected config
  modes; no Docker socket/privileged web container.
- Host isolation, backup sensitivity and Git privacy are detailed in
  [Security Model](SECURITY_MODEL.md).

## Release

- Decimal versioning and direct tags: [Release Process](RELEASE_PROCESS.md).
- CI and multi-architecture GHCR workflow:
  [`.github/workflows`](../.github/workflows).
- Deterministic AGPL source archives, release manifest, public artifact gate and
  Gitleaks: [`scripts`](../scripts) and [Testing and Release](TESTING_AND_RELEASE.md).
