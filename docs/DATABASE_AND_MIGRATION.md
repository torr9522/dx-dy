# Database And Migration

## Storage Model

The container database path is `/data/private-subscription-manager.db`. Fresh
installs bind persistent data from `/var/lib/dx-dy`; legacy layouts remain
manager-compatible. SQLite enables foreign keys, WAL and a busy timeout in
[`db.ts`](../apps/api/src/db.ts).

## Released Schemas

- [`001_initial.sql`](../migrations/001_initial.sql): administrator/session,
  lossless Nodes, Subscriptions, ordered `subscription_nodes` and settings.
- [`002_node_collections.sql`](../migrations/002_node_collections.sql): ordered
  Collections and many-to-many members.

There is no migration after `002` in 0.1.8. Released migration files are
immutable.

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
`dx-dy restore`, which coordinate Compose and health checks.

## Backup Rules

Never copy a live SQLite main file or archive `-wal`/`-shm`. The backup API
creates an independent snapshot, removes active sessions and validates integrity
and foreign keys. Restore locks writers, validates migrations and Token
decryptability, creates a pre-restore backup, migrates a temporary candidate and
atomically replaces the database only after validation.

See [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md) and the lower-level legacy
reference [DATABASE_MIGRATION.md](DATABASE_MIGRATION.md).
