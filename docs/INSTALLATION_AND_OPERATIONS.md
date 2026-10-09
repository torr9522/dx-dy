# Installation And Operations

## Fresh Installation

Supported hosts are Debian 12 and Ubuntu 22.04/24.04 on amd64/arm64. From a root shell, including a minimal host without curl, use the primary README bootstrap command. It uses Bash and apt to install `ca-certificates` and `curl` only when required, downloads the installer over verified HTTPS to a temporary file, executes it and removes that file on exit. Hosts that already have curl and trusted CA certificates may use the shorter process-substitution command.

The installer verifies OS/architecture/network/disk/ports, installs required host libraries including `libatomic1` and the distribution Caddy package, then downloads the matching GitHub Release artifact and SHA-256. Node 26.10.0 is bundled in the release; Docker, Node, npm, pnpm, Git and a container runtime are not user prerequisites. Fresh installation does not add or depend on an external Caddy package repository.

Before committing installation state, the installer starts the staged bundled Node binary and imports the staged Argon2 production dependency. A missing host library or unusable native addon fails at this point without installing the manager, configuration, systemd unit or release directory.

The root manager is a separate `dx-dy` Release asset. The single-file installer downloads it into private staging, verifies `manager_asset` and `manager_sha256` from `release-manifest.json`, checks shell syntax, and only then atomically renames it into `/usr/local/bin/dx-dy`. It never assumes that `install.sh` is beside a Git checkout or an `ops/` directory.

The wizard accepts hostnames only, supports single/dual-domain mode, initializes one administrator through stdin and generates a protected `APP_MASTER_KEY`. The application account is a non-login `dx-dy` system user.

## Layout And Permissions

| Purpose               | Path / ownership                                      |
| --------------------- | ----------------------------------------------------- |
| Versioned program     | `/opt/dx-dy/releases/<version>`, root-owned/read-only |
| Atomic active version | `/opt/dx-dy/current` symlink                          |
| Secrets               | `/etc/dx-dy/dx-dy.env`, root `0600`                   |
| Installation metadata | `/etc/dx-dy/install.conf`, root `0600`                |
| Database              | `/var/lib/dx-dy/dx-dy.db`, service-user writable      |
| Backups               | `/var/backups/dx-dy`, service-user writable           |
| Unit                  | `/etc/systemd/system/dx-dy.service`                   |
| Manager               | `/usr/local/bin/dx-dy`, root-owned executable         |

## Caddy And Domains

Caddy owns HTTP/HTTPS, ACME and renewal. dx-dy adds `/etc/caddy/dx-dy.caddy` and one import line to the standard Caddyfile. Existing non-dx-dy content is backed up and retained. Single domain exposes all routes; a separate subscription host exposes only `/s/*` and `/health`. Domain changes render and validate a candidate before reload and restore old files on failure.

## Manager

```sh
dx-dy status
dx-dy start|stop|restart
dx-dy update
dx-dy admin reset-password|change-username
dx-dy domain
dx-dy backup db|full
dx-dy restore /var/backups/dx-dy/file
dx-dy logs app|caddy|all|follow 200
dx-dy doctor
dx-dy cleanup-legacy
dx-dy uninstall
```

`stop` stops only the application. Logs use `journalctl`. Doctor checks systemd, services, health, SQLite integrity/FKs, DNS/TLS, localhost binding, permissions, symlink/release metadata and disk. Default uninstall removes program/service/manager but preserves config, database and backups; full purge requires `DELETE`. Both modes remove the exact dx-dy import from the host Caddyfile while preserving unrelated Caddy configuration. Caddy is never uninstalled automatically.

Restore returns the complete application data directory, including internal
pre-restore snapshots, to the `dx-dy` service account before restarting the
application. Portable and Full Migration restores can therefore be used in
either order without a root-owned snapshot blocking the next operation.

Running the installer after default uninstall enters retained-data reinstall mode. It requires the manager, program tree and systemd unit to be absent while protected config, environment and database files remain present. It restores the native program and routing while retaining domains, administrator data, subscription Tokens and `APP_MASTER_KEY`. Any ambiguous partial layout is rejected instead of guessed.

## Update And Rollback

Update reads the latest public manifest, chooses the installed architecture, verifies SHA-256, creates a WAL-safe DB backup, extracts a new version directory, stops the app and atomically switches `current`. Failed start/health restores the old link and DB backup. Current, previous and a small recent set are retained.

## Docker 0.1.8 Migration

The installer recognizes the 0.1.8 standard Compose layout. Migration requires a password file for a Full Migration backup, creates both portable and encrypted backups, retains domains/key/database, stops only the legacy dx-dy app/Caddy, starts native services and restores the old stack on failure. Docker Engine, compose files, images and configuration remain for rollback until explicit `dx-dy cleanup-legacy` acceptance.
