# Current Baseline

## Release Boundary

The immutable public baseline is v0.2.9 at commit
`e6e627d75eaf5c04d1599048af746005e8be0f93`. Version 0.3.0 removes the
Legacy Collections user interface without changing the database schema.
Independent Node Groups remain the sole user-visible Global Node ownership and
organization model. Generic, Smart and explicit client subscription routes
retain their v0.2.9 behavior.

## Release Identity

- Current source version: **0.3.0**
- Previous stable: **v0.2.9**
- Brand/manager: **dx-dy**
- Release model: direct annotated unsigned `vX.Y.Z` tags
- Runtime model: **native-systemd**
- Bundled Node runtime: **26.10.0**
- Database schema: **004**

Public tags are immutable. Version 0.3.0 does not rewrite migrations 001-004,
drop a table, or transform existing business data.

## Persistence And Invariants

- SQLite WAL with immutable `001_initial.sql`, `002_node_collections.sql`,
  `003_subscription_local_nodes.sql` and `004_node_groups.sql` migrations
- Migration in 0.2.5: **003_subscription_local_nodes.sql**
- Migration in 0.2.9: **004_node_groups.sql**
- Every Global Node belongs to exactly one Node Group
- Same-Group semantic duplicates are blocked; equivalent records in different
  Groups are independent IDs
- Historical Collections and memberships remain in backups and restores, but
  the v0.3.0 web application does not load or mutate them
- Deprecated Collection APIs remain available for old-client compatibility
- Subscription Local Nodes belong to one Subscription and share the ordered
  `subscription_entries` sequence with Global Nodes
- **NO AUTO SUBSCRIPTION**: historical Collection changes never synchronize a
  Subscription
- Canonical `/s/:token` is standard Base64 of UTF-8 LF-separated share URIs
- Token plaintext is not stored or logged; continuity requires SQLite plus
  `APP_MASTER_KEY`

## Supported Installation

- Debian 12; Ubuntu 22.04 and 24.04 LTS
- linux/amd64 and linux/arm64
- GitHub Release artifact with bundled Node, native `dx-dy.service`, host Caddy
  and SQLite
- Application runs as non-login `dx-dy`, listens on `127.0.0.1`, and has no
  Docker/GHCR runtime dependency
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

The full gate builds amd64/arm64 artifacts, starts the host-compatible bundled
runtime, verifies source/archive privacy, exercises backup/restore and update
rollback, and runs private known-identity scanning when configured.

## Version Boundary

The v0.2.9 source, tag and Release remain immutable. The approved next source
version is v0.3.0. No v0.2.10 release exists or is planned by this baseline.
