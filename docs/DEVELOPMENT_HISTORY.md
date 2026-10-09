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

## 0.1.9 - Native Deployment Era

Replaced the end-user Docker/Compose/GHCR runtime with architecture-specific
GitHub Release artifacts containing Node 26.10.0 and production dependencies.
Added a hardened systemd service, dedicated account, localhost-only listener,
host Caddy integration, atomic version-directory updates and database/link
rollback. The guarded 0.1.8 migration path creates portable and encrypted
backups and retains the legacy stack. Business schema and output are unchanged.

## 0.2.0 - Release Hygiene

Made installer help and version queries exit before every privileged or
state-changing preflight step, with non-root and command-sentinel regression
coverage. Replaced branch-name assumptions in CI with event/ref-aware policy:
master pushes and pull requests are validated from their GitHub context, while
direct version tags are validated in detached HEAD and must target the current
`origin/master` commit. The public single-file installer now obtains its manager
from the GitHub Release manifest, verifies its SHA-256 and shell syntax, and
installs it atomically without a source checkout. Runtime architecture, schema,
backup formats and business behavior are unchanged.

The public `v0.2.0` tag remains immutable. Its tag CI and Release workflow
failed because provenance validation fetched all remote tags into an Actions
checkout whose local tag ref was already peeled to the release commit.

## 0.2.1 - Tag Workflow Provenance Fix

Changed tag provenance validation to fetch only `origin/master` with tag
following disabled. The validator reads the public annotated tag object and
peeled target through `git ls-remote`, preserves the checked-out local tag ref,
and retains the strict requirement that the release target equal current
`origin/master`. Runtime architecture, schema, installation and business
behavior are unchanged.
