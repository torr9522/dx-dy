# Backup And Recovery

## Portable Database Backup

A DB backup is a WAL-safe independent SQLite file containing Nodes, envelopes,
Collections, memberships, ordered Subscriptions, settings, administrators,
Token hashes/ciphertexts and schema history. Active administrator sessions are
removed.

It does **not** contain `APP_MASTER_KEY`. Existing Token ciphertext is usable on
another instance only with the matching external key. Use it for routine recovery
when instance secrets are protected separately.

```sh
dx-dy backup db
```

## Full Migration Backup

A `.psmbackup` contains the consistent database plus `APP_MASTER_KEY`. Format v1
uses scrypt (`N=32768`, `r=8`, `p=1`) to derive a 256-bit key and AES-256-GCM to
authenticate/encrypt the payload. The outer manifest carries non-secret format,
schema, checksum and compatibility metadata.

```sh
dx-dy backup full
```

The password is read twice through hidden stdin and never accepted as a command
argument. A Full Migration bundle is a complete credential asset: anyone with
the file and password can recover Node credentials and subscription Tokens.
Protect it like a private key. A lost password cannot be recovered.

## Restore

```sh
dx-dy restore /var/backups/dx-dy/<backup-file>
```

The manager requires an absolute path inside its configured backup directory,
creates a current DB backup, stops writers, validates/decrypts the candidate,
applies forward migrations, clears sessions, starts the app and checks health.
The database CLI uses locking, integrity/foreign-key checks and atomic replacement
so a failed candidate leaves the prior database available.

After either portable or Full Migration restore, the manager normalizes the
complete application data directory back to the unprivileged `dx-dy` account.
This includes internal pre-restore snapshots and keeps a later restore usable
regardless of which backup type was restored first.

Restore accepts historical `.psmbackup` names and extension. Branding did not
change the backup format. Test restore procedures regularly; possession of a
backup alone is not proof of recoverability.
