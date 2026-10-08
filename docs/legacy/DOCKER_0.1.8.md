# Docker 0.1.8 Historical Deployment

This document records the 0.1.8 deployment model for migration and incident recovery. Do not use it for a new installation.

Version 0.1.8 ran the application and Caddy under Docker Compose and distributed multi-architecture images through GHCR. Its standard paths were `/opt/dx-dy`, `/etc/dx-dy`, `/var/lib/dx-dy` and `/var/backups/dx-dy`; the container database path was `/data/private-subscription-manager.db`.

Version 0.1.9 replaces this with architecture-specific GitHub Release artifacts, a bundled Node runtime, `dx-dy.service` and the host Caddy service. The 0.1.9 installer detects a 0.1.8 Compose installation and requires an encrypted Full Migration backup password file before migration. It retains the old stack for rollback and does not remove Docker or images.

The historical templates remain under `deploy/` and the repository root solely to preserve source/history and migration evidence. They are not release assets or current installation inputs.
