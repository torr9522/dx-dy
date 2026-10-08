# Current Baseline

## Release Identity

- Current release: **0.1.8**
- Brand and external manager command: **dx-dy**
- Purpose: Private Node & Subscription Manager
- Release model: direct annotated unsigned `vX.Y.Z` tags from 0.1.8 onward
- Historical RC tags: retained, never renamed

Resolve the immutable release commit with `git rev-parse v0.1.8^{}` after the tag
exists. This document intentionally does not embed a self-referential HEAD SHA.

## Persistence

- Database: SQLite WAL
- Released schemas: `001_initial.sql`, `002_node_collections.sql`
- Migration in 0.1.8: **NONE**
- Node <-> Subscription and Node <-> Collection are separate many-to-many
  relationships; Collections never auto-synchronize Subscriptions.

## Core Invariants

- Universal standard Base64 is canonical for `/s/:token` and legacy aliases.
- Library/Collections may contain equivalent Nodes; each Subscription output is
  semantically unique and preserves the first selected position.
- Semantic identity excludes display name/URI fragment or VMess `ps`, retains
  connection and unknown/private parameters, and is computed at runtime.
- Token plaintext is neither stored nor logged. Full Token continuity needs the
  encrypted database and matching `APP_MASTER_KEY`.
- Web containers never receive Docker socket or host infrastructure privilege.

## Supported Installation

- Debian 12; Ubuntu 22.04 LTS and 24.04 LTS
- linux/amd64 and linux/arm64
- Docker Engine, Compose v2 and Caddy container
- Single-domain and isolated dual-domain modes
- Legacy install paths remain detectable by the manager

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

Before release, also run private known-identity scanning, source/archive checks,
Docker no-cache/multi-arch verification and staging regression. Tag, scan refs,
push the intended branch, wait for CI, push intended tags and verify public
Release/GHCR artifacts.

## Current Limitations

See [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md). In particular, no commercial
multi-user system, no server database, no Xray Core and no web-controlled root
infrastructure are included.

## Next Version

`0.1.9` is the next development version **only after `v0.1.8` is released and a
real new source change is made**. Work required to finish the still-untagged
0.1.8 release remains 0.1.8.
