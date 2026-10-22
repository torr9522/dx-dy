# Database And Migration

## 0.3.0

Version 0.3.0 adds no migration. Schema 004 remains current. The web application
no longer loads or mutates Legacy Collections, but `node_collections` and
`node_collection_members` remain part of database validation, portable backup,
Full Migration backup, restore and old-client API compatibility. Existing rows
must not be deleted or inferred into Groups. New nodes and cross-group copies do
not receive Collection membership unless an old client explicitly uses the
deprecated compatibility API or compatibility request field.

## Migration 004 (released in 0.2.9)

Migration 004 adds node_groups and nodes.group_id. A foreign key plus insert
and ownership-update triggers require exactly one valid Group per Global Node.
The nullable SQLite ALTER column is never valid as NULL after migration.
Only populated legacy libraries receive 原节点库; empty/fresh instances retain
zero Groups. Groups have unique case-insensitive trimmed names and positions.
Deleting a nonempty Group requires explicit confirmation. One immediate
transaction re-reads ownership/references, reuses Global detach deletion,
deletes the Group and normalizes affected Subscription positions/mirrors.
Other Groups (including semantic-equal records), Local Nodes and Subscription
identities remain intact. Collections remain; only deleted-node memberships
are removed. The migration's empty-only DELETE trigger remains unchanged:
the service deletes owned nodes before deleting their Group.
原节点库 is an ordinary migration-created Group, with no runtime name/ID
protection, fallback or automatic recreation. It can be renamed or deleted.

Schema 004 cannot run on a pre-0.2.9 binary. A v0.3.0 to v0.2.9 rollback uses
the same schema and still requires the verified manager recovery path and the
pre-update database/config snapshot. Portable/full restore applies forward
migrations and preserves Group ownership, order, legacy Collections,
Subscription tokens and mixed entry ordering.

## Storage Model

The native database path is `/var/lib/dx-dy/dx-dy.db`, supplied through
`DATABASE_PATH`. Historical 0.1.8 containers used
`/data/private-subscription-manager.db`; migration preserves its schema and
content. SQLite enables foreign keys, WAL and a busy timeout in
[`db.ts`](../apps/api/src/db.ts).

## Released Schemas

- [`001_initial.sql`](../migrations/001_initial.sql): administrator/session,
  lossless Nodes, Subscriptions, ordered `subscription_nodes` and settings.
- [`002_node_collections.sql`](../migrations/002_node_collections.sql): ordered
  Collections and many-to-many members.
- [`003_subscription_local_nodes.sql`](../migrations/003_subscription_local_nodes.sql):
  Subscription-owned Local Nodes and one ordered Global/Local entry sequence.
- [`004_node_groups.sql`](../migrations/004_node_groups.sql): independent Group
  ownership for every Global Node.

Migration `003` copies every existing `subscription_nodes` relationship and
position into `subscription_entries` without changing Tokens or Global Nodes.
Released migration files are immutable.

## Forward Migration Safety

Startup discovers numbered migrations, rejects unknown newer schema versions,
creates a WAL-consistent pre-migration snapshot for existing databases, then
applies pending migrations in one immediate transaction. Failure rolls back and
prevents startup. Successful migration ends with `integrity_check` and
`foreign_key_check`.

A future persistent schema change must add the next migration and test previous
release -> current, transaction failure, snapshot integrity and newer-schema
rejection. Computed/runtime state does not justify a column.

## Commands

```sh
pnpm db:backup -- /absolute/path/backup.db
pnpm db:restore -- /absolute/path/backup.db
pnpm migration:export -- /absolute/path/backup.psmbackup
```

Normal operators should use `dx-dy backup db`, `dx-dy backup full` and
`dx-dy restore`, which coordinate systemd and health checks.

## Backup Rules

Never copy a live SQLite main file or archive `-wal`/`-shm`. The backup API
creates an independent snapshot, removes active sessions and validates integrity
and foreign keys. Restore locks writers, validates migrations and Token
decryptability, creates a pre-restore backup, migrates a temporary candidate and
atomically replaces the database only after validation.

See [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md) and the lower-level legacy
reference [DATABASE_MIGRATION.md](DATABASE_MIGRATION.md).
