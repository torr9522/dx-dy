# Database and instance migration

## Storage contract

The canonical database path is `/data/private-subscription-manager.db` in every production mode. SQLite runs in WAL mode, so never copy the live database file with `cp` and never treat `-wal` or `-shm` as backup artifacts.

The application applies numbered migrations in order and records them in `schema_migrations`. Before an existing database is migrated, it creates a consistent `backups/pre-migration-*.sqlite` snapshot. A failed migration rolls back and startup stops. A database containing a migration unknown to the running application is rejected with `Database schema is newer than this application version.` Downgrades are not attempted.

## Database backup

Use a database backup for routine data recovery when the matching external `APP_MASTER_KEY` is already protected separately:

```sh
pnpm db:backup -- ./private-subscription-manager-0.1.5-YYYYMMDD-HHMMSS.db
```

The command uses the SQLite Backup API, validates `integrity_check` and `foreign_key_check`, produces one independent SQLite file, and removes active administrator sessions. Nodes, normalized/original data, sidecars, Tags, Collections, memberships, subscriptions, ordered `subscription_nodes`, settings, Token hashes/ciphertexts, administrators and migration history remain in the snapshot.

A DB-only backup cannot decrypt existing Token ciphertext on another instance without the original master key. The key is deliberately not stored in plaintext in SQLite.

## Full migration backup

Use a full migration backup when moving to another server and preserving all existing subscription Tokens:

```sh
read -rsp 'Backup password: ' BACKUP_PASSWORD; export BACKUP_PASSWORD
pnpm migration:export -- ./private-subscription-manager-0.1.5-YYYYMMDD-HHMMSS.psmbackup
unset BACKUP_PASSWORD
```

Format version 1 contains an authenticated manifest and an encrypted payload. The payload contains the consistent database snapshot and `APP_MASTER_KEY`; scrypt derives an encryption key from the backup password and AES-256-GCM authenticates and encrypts the payload. The manifest records application/schema/format versions, UTC creation time, database SHA-256, a non-secret instance ID and the minimum migration.

The package is a full credential backup. Loss exposes no plaintext key, but an attacker who obtains both it and its password can recover administrator data, subscription Tokens and node credentials. Store it like a private key. Losing its password makes it unrecoverable.

## Restore

Stop all application writers before restore. The CLI also takes a kernel `flock` and refuses to replace a database while the application holds the lock.

```sh
docker compose stop app

# DB-only restore: APP_MASTER_KEY in .env must match the backup.
DATABASE_PATH=/data/private-subscription-manager.db \
pnpm db:restore -- ./backup.db

# Full instance restore: updates only APP_MASTER_KEY in the protected env file.
read -rsp 'Backup password: ' BACKUP_PASSWORD; export BACKUP_PASSWORD
DATABASE_PATH=/data/private-subscription-manager.db \
INSTANCE_ENV_FILE=.env \
pnpm db:restore -- ./backup.psmbackup
unset BACKUP_PASSWORD

docker compose up -d
```

Set `DATABASE_PATH` to the actual mounted data path when running the host CLI. For a Docker-only restore, mount the bundle and protected `.env` into a one-shot container while the service is stopped:

```sh
docker compose stop app
read -rsp 'Backup password: ' BACKUP_PASSWORD; export BACKUP_PASSWORD
docker compose run --rm --no-deps --user root \
  -e BACKUP_PASSWORD -e INSTANCE_ENV_FILE=/instance/.env \
  -v "$PWD/.env:/instance/.env" \
  -v "$PWD/backup.psmbackup:/restore.psmbackup:ro" \
  app sh -c 'node dist/database.mjs restore /restore.psmbackup && chown node:node "$DATABASE_PATH"'
unset BACKUP_PASSWORD
docker compose up -d
```

Restore validates the source SQLite structure, migration history, checksum, bundle authentication, Token decryptability, integrity and foreign keys. It creates a WAL-safe `backups/pre-restore-*.db` copy of an existing target, applies forward migrations to a temporary candidate, clears all administrator sessions, and atomically renames the verified candidate. Administrators log in again after restore. No manual SQLite statements are required.

## Subscription domain identity

`ADMIN_BASE_URL` is deployment infrastructure and remains environment-controlled. `SUBSCRIPTION_BASE_URL` is only a bootstrap default. Once the database contains `subscription_base_url`, that database value is the runtime source of truth and survives backups/restores even if the new server has a different environment default.

The backend builds every copied link and QR payload as `<subscription_base_url>/s/<TOKEN>`. Changing the setting changes only future generated URLs; it never rotates a Token or modifies nodes, Collections, subscriptions or their relations. Previous subscription hosts are retained in an internal compatibility list that permits only `/s/*` and `/health`; DNS, TLS and reverse-proxy service for those hosts must still be maintained during the transition.

Use separate reverse-proxy hosts in production:

```caddyfile
panel.example.com {
    @compressible not path /s/*
    encode @compressible zstd gzip
    reverse_proxy 127.0.0.1:3000
}

sub.example.com {
    @subscription path /s/* /health
    handle @subscription {
        reverse_proxy 127.0.0.1:3000
    }
    respond 404
}
```

The admin host deliberately retains `/s/*` during a legacy-link transition. The subscription host exposes neither the SPA nor administrator APIs. In a single-domain compatibility deployment, use one site block and configure both base URLs to the same origin.

## Zero-touch server migration

Scenario A, move servers without changing the subscription domain:

1. Lower the subscription DNS TTL ahead of time when practical; 300 seconds is a suggestion, not a requirement.
2. Export one encrypted full migration backup while the old server remains online.
3. Deploy the same or a newer compatible application on the new server.
4. Stop the new application, restore the package, and start it. Forward migrations run automatically.
5. Keep the restored `subscription_base_url` unchanged. The admin domain may change.
6. Configure HTTPS and test the subscription endpoint on the new server using controlled DNS/Host resolution.
7. Point the existing subscription domain DNS to the new IP.
8. Keep the old server available through the DNS cache transition, then retire it after validation.

The client URL and Token do not change. Only DNS moves.

Scenario B, intentionally change the subscription domain:

1. Configure DNS and HTTPS for the new domain first.
2. Save the new origin in Settings → Subscription Domain.
3. New copy and QR actions immediately use the new host with the same Token.
4. Keep the old host serving `/s/*` during the transition because already-configured clients cannot be rewritten remotely.

Do not use the Settings field merely because the server IP or admin domain changed.
