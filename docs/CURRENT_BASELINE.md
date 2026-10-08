# Current Baseline

## Release Identity

- Current release: **0.2.0**
- Brand/manager: **dx-dy**
- Release model: direct annotated unsigned `vX.Y.Z` tags
- Runtime model: **native-systemd**
- Bundled Node runtime: **26.10.0**

After publication, resolve the immutable release commit with `git rev-parse v0.2.0^{}`. This document intentionally does not embed a self-referential HEAD SHA.

## Persistence And Invariants

- SQLite WAL; schemas `001_initial.sql` and `002_node_collections.sql`
- Migration in 0.2.0: **NONE**
- Node/Subscription and Node/Collection are independent many-to-many relations
- **NO AUTO SUBSCRIPTION**: Collection changes never synchronize a Subscription
- Canonical `/s/:token` is standard Base64 of UTF-8 LF-separated share URIs
- Library/Collections may contain equivalent Nodes; Subscription output is semantically unique
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

## Next Version

`0.2.1` is the next code-change version **only after `v0.2.0` is released and a real source change is made**. Never move an existing public tag.
