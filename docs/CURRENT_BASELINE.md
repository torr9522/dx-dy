# Current Baseline

## Release Identity

- Current public stable release: **0.2.6**
- Brand/manager: **dx-dy**
- Release model: direct annotated unsigned `vX.Y.Z` tags
- Runtime model: **native-systemd**
- Bundled Node runtime: **26.10.0**

The verified public baseline is the annotated `v0.2.6` release. Public tags are immutable.
Version 0.2.6 scopes semantic duplicate detection to the Global Library or one
Subscription's Local Nodes; cross-namespace Global/Local semantic overlap is
valid.

Development is now on the **0.2.7 LOCAL CANDIDATE**, limited to the
Subscription index row layout.

## Persistence And Invariants

- SQLite WAL; schemas `001_initial.sql`, `002_node_collections.sql` and `003_subscription_local_nodes.sql`
- Migration in 0.2.5: **003_subscription_local_nodes.sql**
- Global Node/Subscription and Node/Collection remain independent many-to-many relations
- Subscription Local Nodes belong to exactly one Subscription and share one ordered `subscription_entries` sequence with Global Nodes
- **NO AUTO SUBSCRIPTION**: Collection changes never synchronize a Subscription
- Canonical `/s/:token` is standard Base64 of UTF-8 LF-separated share URIs
- Library/Collections may contain equivalent Nodes. Global and Local entries in
  one Subscription use separate duplicate namespaces; equal Global/Local
  semantics remain two output entries in their saved order.
- Token plaintext is not stored or logged; continuity requires SQLite plus `APP_MASTER_KEY`

## Supported Installation

- Debian 12; Ubuntu 22.04 and 24.04 LTS
- linux/amd64 and linux/arm64
- GitHub Release artifact with bundled Node, native `dx-dy.service`, host Caddy and SQLite
- Application runs as non-login `dx-dy`, listens on `127.0.0.1`, and has no Docker/GHCR runtime dependency
- Docker 0.1.8 is a deprecated, detected migration source only

## Primary Verification

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
shellcheck -x install.sh ops/dx-dy
pnpm release:check --full --public
```

The full gate builds amd64/arm64 artifacts, starts the host-compatible bundled runtime, verifies source/archive privacy and runs private known-identity scanning when configured.

## Version Boundary

The 0.2.6 source remains frozen at the public release. Current source changes
belong to 0.2.7.
