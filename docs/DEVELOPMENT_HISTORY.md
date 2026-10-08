# Development History

This is an engineering milestone record derived from the sanitized Git history
and CHANGELOG. It intentionally excludes private conversations, deployment
identities and pre-public commit mappings.

## 0.1.0 - Core Manager

Established the pinned Sub-Store adapter, lossless Node envelope, secure
single-admin Node Library and ordered Subscription profiles. RC2 standardized
the Shadowrocket/V2Ray subscription as Base64 URI lines; RC3 added deterministic
source archives, secret scanning and release hygiene. Public history:
`v0.1.0-rc.1`, `v0.1.0-rc.2`, `v0.1.0-rc.3`.

## 0.1.1 - Universal Subscription

Made one canonical Universal Base64 body independent of User-Agent and kept
legacy aliases byte-identical. Raw became admin-only debugging. Mature-source
compatibility evidence was recorded rather than adding speculative client
branches. Tag: `v0.1.1-rc.1`.

## 0.1.2 - Subscription Quick Actions

Added reusable copy, preview and QR actions to Subscription cards, including
empty profiles, with responsive and accessible Playwright coverage. Tag:
`v0.1.2-rc.1`.

## 0.1.3 - Subscription Card UX

Refined cards around copy, QR and explicit profile deletion. Deletion revokes
the profile Token and pivot rows but preserves global Nodes. Tag:
`v0.1.3-rc.1`.

## 0.1.4 - Portability And Domains

Added Node Collections, portable WAL-safe SQLite backups, encrypted Full
Migration, forward migration safety and dual-domain route isolation. Collections
were deliberately management-only. Tags/commits culminate in `v0.1.4-rc.1`.

## 0.1.5 - Collection UX

Added searchable bulk membership management and cross-source Subscription
selection while preserving the no-auto-subscription boundary. Tag:
`v0.1.5-rc.1`.

## 0.1.6 - Selection UX

Introduced a shared Set-based selection engine: tri-state filtered selection,
selected review, row interaction, Shift ranges and disabled-node skipping across
desktop and mobile. Tag: `v0.1.6-rc.1`.

## 0.1.7 - Semantic Duplicate Protection

Added two layers of Subscription protection: duplicate-aware selection/save and
final output deduplication. Identity is derived from current rendered connection
semantics, not Node name/ID; Library and Collection duplicates remain allowed.
Tag: `v0.1.7-rc.1`.

## 0.1.8 - First Public Release Foundation

Renamed the public product to dx-dy without changing business schema or routes.
Added the Docker/Caddy installer, root SSH manager, application-owned admin
recovery, domain/backup/restore/update/doctor workflows, public CI, multi-arch
GHCR Release automation and public privacy gates. Before first publication, the
complete Git history was sanitized while retaining functional commits and every
annotated historical tag. Releases use direct `vX.Y.Z` tags from this version.
