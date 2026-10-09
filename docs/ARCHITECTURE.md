# Architecture

## Runtime Topology

```text
Browser / subscription client
          |
       80 / 443
          |
  host Caddy service
    | admin host: UI/API/s/*/health/source
    | subscription host: /s/* and /health only
          |
  127.0.0.1:<internal-port>
          |
  dx-dy.service (User=dx-dy)
          |
       SQLite WAL
```

Caddy templates live in [`deploy/native`](../deploy/native). The application has no host-root, systemd/Caddy control or Docker socket. Root operations are isolated in [`ops/dx-dy`](../ops/dx-dy).

## Program Layout

`/opt/dx-dy/releases/<version>` contains an immutable architecture-specific release: `runtime/bin/node`, `app/dist`, production dependencies, migrations, templates and `RELEASE.json`. `/opt/dx-dy/current` is an atomic symlink. Configuration is in `/etc/dx-dy`, mutable SQLite in `/var/lib/dx-dy`, and backups in `/var/backups/dx-dy`.

## Application Layers

- [`apps/web`](../apps/web): React/Vite single-admin UI, bulk and Set-based selection.
- [`apps/api`](../apps/api): Express, authentication, routes, SQLite and output composition.
- [`packages/proxy-adapter`](../packages/proxy-adapter): pinned Sub-Store adapter, lossless envelope, rendering and semantic dedupe.
- [`scripts`](../scripts): application CLIs, WAL-safe backup/restore, native artifact/source/release gates.
- [`install.sh`](../install.sh) and [`ops/dx-dy`](../ops/dx-dy): root installation/operations boundary.

## Data Model

```text
Node * <-> * Subscription via subscription_nodes(position)
Node * <-> * Collection   via node_collection_members
Admin 1 -> * AdminSession
Settings(key, JSON value)
```

Collections are organizational only. `subscription_nodes.position` controls output order. Semantic dedupe preserves the first position without modifying stored relationships.

## Build And Release

GitHub Actions builds amd64 and arm64 artifacts separately on native architecture runners. Each artifact receives Node 26.10.0 and target-specific production dependencies, then launches its bundled Node and Argon2 addon on that architecture. The release job creates the source archive, manifest and checksums and publishes GitHub Release assets. GHCR is not part of the 0.2.3 distribution path.
