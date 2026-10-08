# Installation And Operations

## Supported Fresh Installs

- Debian 12
- Ubuntu 22.04 LTS and 24.04 LTS
- amd64/x86_64 and arm64/aarch64

Other systems are unsupported/best effort. The installer requires root, checks
network/disk/ports/existing installs and bootstraps Docker Engine, Compose v2,
curl, CA certificates, OpenSSL, archive and DNS/network tools. Host Node.js,
pnpm, npm and Caddy are not required.

The public Release command for `torr9522/dx-dy` is documented in the root
README. The wizard accepts
hostnames only, reports A/AAAA results, supports optional UFW rules with consent,
initializes an administrator and creates a protected random `APP_MASTER_KEY`.
An automatically generated admin password is displayed once; the master key is
never displayed.

## Domain Modes

- Single domain: one host serves UI/API, `/s/*`, `/health` and source.
- Dual domain: the admin host retains all features and legacy `/s/*`; the
  subscription host allows only `/s/*` and `/health` and returns 404 elsewhere.

Caddy owns ports 80/443, HTTP redirects, ACME and renewal. If DNS is pending,
Caddy retries; the installer does not loop forever or destroy state. Domain
changes use `dx-dy domain`: a candidate is rendered and validated before config,
runtime origin, app and Caddy are coordinated, with rollback on failure.

## Filesystem Layout

| Purpose | Fresh-install path |
| --- | --- |
| Compose/templates | `/opt/dx-dy` |
| Root configuration/secrets | `/etc/dx-dy` |
| SQLite/Caddy state | `/var/lib/dx-dy` |
| Backups | `/var/backups/dx-dy` |
| Manager | `/usr/local/bin/dx-dy` |

Secret configuration is mode `0600`; data/backup directories are protected. The
manager also detects the historical `/opt/private-subscription-manager` layout.
It does not relocate a legacy database merely for branding.

## Manager

Run `dx-dy` for the menu or use:

```sh
dx-dy status
dx-dy start|stop|restart
dx-dy update
dx-dy admin reset-password
dx-dy admin change-username
dx-dy domain
dx-dy backup db|full
dx-dy restore /absolute/backup/path
dx-dy logs app 200
dx-dy doctor
dx-dy uninstall
```

`status` reports app/Caddy/health/URLs/ports/database/backups/project/image without
secrets. `doctor` checks Docker, Compose, containers, health, DNS/TLS, ports,
database integrity/foreign keys, disk and backup directory. Logs are bounded by
default. Uninstall preserves data by default; full deletion lists targets and
requires the exact word `DELETE`.

Updates query the configured GitHub repository, require a checksum-verified
manifest and digest-pinned image, back up first and roll configuration back after
failed health. Fresh installs default to `torr9522/dx-dy`; forks may override
the repository coordinate and Release base URL.
