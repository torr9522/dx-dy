# Architecture

## Runtime Topology

```text
Browser / subscription client
            |
         80 / 443
            |
          Caddy
     +------+------+
     |             |
 Admin host   Subscription host
 UI/API/s/*   /s/* and /health only
     |             |
     +------+------+
            |
      Node/Express app
            |
          SQLite
```

Caddy templates are in [`deploy/`](../deploy). The dual-host template rejects
the SPA, login, API, settings and source endpoint on the subscription host. The
application container has no Docker socket, host root or writable Caddy config.

## Application Layers

- [`apps/web`](../apps/web): React/Vite single-administrator interface. Node
  Library, Collections, profiles and Set-based selection live primarily in
  `NodeLibrary.tsx` and `nodeSelection.tsx`.
- [`apps/api`](../apps/api): Express HTTP application, authentication, routing,
  domain handling, migrations and SQLite access. `app.ts` is the API/output
  composition root; `db.ts` owns transactions and relationship queries.
- [`packages/proxy-adapter`](../packages/proxy-adapter): shared Node envelope,
  pinned Sub-Store parser/renderer adapter, Universal Base64 output and runtime
  semantic deduplication.
- [`packages/shared/schema.ts`](../packages/shared/schema.ts): Zod schemas and
  shared TypeScript contracts.
- [`scripts`](../scripts): application-owned administrator/domain commands,
  WAL-safe backup/restore, source archives, secret scans and release gates.
- [`install.sh`](../install.sh), [`ops/dx-dy`](../ops/dx-dy): public installer
  and root-owned operations layer.

## Data Model

```text
Node * <-> * Subscription   via subscription_nodes(position)
Node * <-> * Collection     via node_collection_members
Admin 1 -> * AdminSession
Settings(key, JSON value)
```

`subscription_nodes.position` is the stable distribution order. Collections
are organizational filters only; they do not copy or synchronize memberships
into Subscriptions. Deleting a Collection does not delete Nodes or alter
Subscriptions.

A Node stores the original share URI, normalized configuration and a lossless
unknown/private sidecar. Rendering always uses the current envelope. Public
subscription output deduplicates enabled selected Nodes by current connection
semantics, preserving the first position without modifying database relations.

## Request Boundaries

- Admin routes require a hashed session cookie and CSRF token for mutations.
- `/s/:token` is a bearer URL, rate-limited and resolved by SHA-256 token hash.
- Recoverable Token ciphertext uses `APP_MASTER_KEY` so administrators can copy
  existing URLs; plaintext is not stored or logged.
- The database-backed subscription origin is the canonical copied URL. Caddy
  infrastructure changes remain a privileged SSH operation.

## Build And Release

The multi-stage [`Dockerfile`](../Dockerfile) builds the frontend/backend/source
archive with locked dependencies and runs the app as an unprivileged user. CI
tests source; tag-triggered Release builds amd64/arm64 images, produces a
manifest/checksums/assets and creates the GitHub Release. It never connects to a
deployment server.
