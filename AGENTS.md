# dx-dy Agent Development Guide

Read this file first, then [docs/README.md](docs/README.md) and
[docs/CURRENT_BASELINE.md](docs/CURRENT_BASELINE.md). This is a public engineering
guide, not a record of private conversations or deployment data.

## Project Identity

- Brand: **dx-dy**
- Purpose: Private Node & Subscription Manager
- License: AGPL-3.0-only
- Product scope: one administrator, a private node library, Collections and
  Subscription profiles. It is not an airport/panel, commercial sales system,
  or multi-tenant service.

Do not add registration, billing, packages, orders, traffic accounting,
referrals or tickets without an explicit product decision.

## Core Invariants

- A Node record is stored once and can be related many-to-many to Subscriptions
  through `subscription_nodes` and to Collections through
  `node_collection_members`.
- Collections are management-only. Membership changes never synchronize a
  Subscription: **NO AUTO SUBSCRIPTION**.
- Subscription Tokens are looked up by a hash and their recoverable value is
  encrypted with `APP_MASTER_KEY`; do not store or log plaintext Tokens.
- Canonical `/s/:token` output is UTF-8 LF-separated share URIs encoded with
  standard Base64. Legacy client aliases are byte-identical. Raw output is an
  authenticated debugging view only.
- Global Library Nodes and each Subscription's Local Nodes are separate
  semantic duplicate namespaces. Global/Global duplicates are blocked in the
  Library; Local/Local duplicates are blocked within one Subscription. A
  Global and Local Node with equal connection semantics may coexist and both
  render in their saved order.
- Historical same-namespace duplicate relationships are not automatically
  deleted. At output, the lowest position within that namespace wins.

## Protocol Source of Truth

Parsing/rendering uses the vendored Sub-Store adapter pinned to
`a3e61061e50b40e5c5938969aab915d05d8d7069`; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and
[docs/PROTOCOL_COMPATIBILITY.md](docs/PROTOCOL_COMPATIBILITY.md). Before changing
protocol behavior, inspect the pinned source, mature implementations, history,
issues and merged PRs. Do not guess protocol mappings or test with real node
credentials.

## Database And Runtime

- SQLite with immutable released migrations
  [`001_initial.sql`](migrations/001_initial.sql) and
  [`002_node_collections.sql`](migrations/002_node_collections.sql) and
  [`003_subscription_local_nodes.sql`](migrations/003_subscription_local_nodes.sql).
- Backend: Node.js/TypeScript, Express, Zod and `node:sqlite`.
- Frontend: React/TypeScript and Vite.
- Deployment: architecture-specific native artifact, bundled Node 26.10.0,
  `dx-dy.service`, host Caddy and SQLite. The app runs as the unprivileged
  `dx-dy` user and listens only on localhost.
- Privileged infrastructure actions belong in the root-owned `dx-dy` manager.
  The Web process never controls systemd/Caddy or receives host root privilege.
  Docker is a deprecated 0.1.8 migration source, not a current runtime.

## Version Rule

The project uses decimal increments with carry: `0.1.8`, `0.1.9`, `0.2.0`,
`0.2.1`. Every completed real source change after a release increments `0.0.1`.
Versions from 0.1.8 onward use one annotated, unsigned `vX.Y.Z` tag after the
full gate; no new RC tags. Historical RC tags remain part of history.

The current public stable release is `v0.2.7`. Never move an existing public
tag. The next source change is `0.2.8`.

## Git Safety And Privacy

The public repository is `dx-dy`. After first publication, its GitHub remote is
the source of truth. Do not force-push or rewrite public history except for an
explicitly managed security emergency.

Tracked content, source archives and build contexts must never contain real
deployment domains/IPs, node URIs, passwords, Tokens, keys, `.env`, databases,
backups or logs. Use `panel.example.com`, `sub.example.com` and reserved example
addresses such as `203.0.113.10`. Never commit AI sessions, private mappings,
local skills or authentication files.

## Development Commands

Use the scripts defined in [`package.json`](package.json):

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm source:manifest
pnpm source:verify
pnpm secret:scan
pnpm release:check --full --public
```

Runtime/UI changes require Playwright. Release candidates require ShellCheck,
amd64/arm64 native artifact and bundled-runtime checks, database backup/restore
tests, source verification, Gitleaks and known-identity scanning. Details are in
[docs/TESTING_AND_RELEASE.md](docs/TESTING_AND_RELEASE.md).

## Change Discipline

- Do not rename tables or rewrite released migrations for branding.
- Add a migration only for a persistent schema change; backup and test upgrade,
  rollback, integrity, foreign keys and newer-schema rejection.
- Do not introduce Redis, a queue, another database, parser, backup format or
  deployment control plane when the shared implementation already serves the
  requirement.
- Preserve lossless `original_uri`, normalized config and unknown/private
  sidecars. Keep focused regression tests with protocol changes.
- Prefer shared backend behavior over client-specific branches.
- Keep UX simple, modern and efficient for private administration; prioritize
  searchable bulk operations and mobile containment.

## Release Gate

Before tagging: update CHANGELOG/docs, refresh the staged source manifest,
commit, obtain a clean tree, run all required gates, validate the test/staging
deployment when runtime behavior changed, and scan again after the annotated
tag enters refs. Push only the intended branch/tags to the verified `dx-dy`
remote. GitHub Actions build/test/release; they never deploy a server.

## Current Architecture Documents

Use [docs/README.md](docs/README.md) as the maintained project knowledge index.
