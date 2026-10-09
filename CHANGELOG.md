# Changelog

## [Unreleased]

## [0.2.2] - 2026-10-09

### Fixed

- Added a Fresh Debian/Ubuntu bootstrap command that installs `curl` and CA certificates when absent before securely downloading the public installer.
- Added the Debian/Ubuntu `libatomic1` runtime dependency required by the bundled Node.js 26.10.0 binary on a minimal Debian 12 host.
- Added a bundled Node and production dependency preflight before the installer commits configuration, manager, systemd or release state.
- Removed the exact dx-dy import from the host Caddyfile during normal uninstall and Full Purge so Caddy never retains a dangling include.

### Compatibility

- No database, subscription, runtime, installation layout or backup format changed.
- Native systemd, Caddy, SQLite, manager delivery and release artifact behavior remain compatible with 0.2.1.

## [0.2.1] - 2026-10-09

### Fixed

- Fixed tag-triggered CI and release provenance validation under GitHub Actions detached HEAD checkouts.
- Release validation now fetches only `origin/master` and no longer attempts to overwrite the checked-out tag ref.

### Compatibility

- No database, subscription, runtime, installation or backup format changed.
- Native installation behavior introduced in 0.1.9 and hardened in 0.2.0 remains unchanged.

## [0.2.0] - 2026-10-09

### Fixed

- Made installer `-h`, `--help` and `--version` pure query paths that run before root, platform, network, package, Caddy, systemd, account, domain and secret setup. Unknown options now fail before installation preflight.
- Made release validation aware of master pushes, pull requests and detached tag checkouts. Direct release tags must match the product version and target the current `origin/master` commit.
- Made the single-file public installer download the manager from the same GitHub Release, verify its manifest SHA-256 and shell syntax, then install it atomically without relying on an adjacent source checkout.

### Compatibility

- Native systemd/Caddy/SQLite deployment, Node 26.10.0, database schemas, backup formats and all business behavior are unchanged. No database migration was added.

## [0.1.9] - 2026-10-08

### Changed

- Native systemd deployment with host Caddy is now the default installation and runtime model.
- Docker, Docker Compose, containerd and GHCR are no longer required for end-user installation, operation or updates.
- GitHub Releases now provide architecture-specific Linux artifacts with a bundled Node.js runtime.

### Added

- Added a hardened `dx-dy.service`, dedicated non-login service account, localhost-only listener and root-owned secret environment.
- Added host Caddy single/dual-domain fragments with validation and configuration rollback.
- Added version-directory updates, atomic `current` symlink switching, WAL-safe pre-update backup and database/symlink rollback.
- Added a guarded Docker 0.1.8 to Native 0.1.9 migration path that preserves the legacy stack.
- Added native artifact layout, dependency, manager, installer and release metadata validation for amd64 and arm64.

### Deprecated

- Docker-based end-user deployment introduced in 0.1.8. Historical files remain only for migration and recovery.

### Compatibility

- Existing SQLite databases, Tokens, subscriptions, Collections, Universal Base64 output, semantic duplicate behavior, portable backups and `.psmbackup` archives remain compatible. No database migration was added.

## [0.1.8] - 2026-10-08

### Added

- Added an owner-neutral one-command Docker installation workflow with interactive single/dual-domain setup, secure administrator initialization and Caddy automatic HTTPS.
- Added the `dx-dy` SSH management menu and non-interactive lifecycle, update, administrator recovery, domain, backup, migration, restore, logs, doctor and uninstall commands.
- Added an application-owned administrator CLI that reads credentials from stdin, uses the existing Argon2id policy and invalidates active sessions.
- Added public GitHub CI, multi-architecture GHCR release infrastructure, release manifests and public release checks.

### Changed

- Public product branding is now dx-dy; public deployment defaults contain only reserved example domains and no instance-specific identity.
- New installations use the dx-dy standard paths while the manager continues to recognize the legacy deployment path.
- Releases from 0.1.8 onward use direct annotated `vX.Y.Z` tags without an RC suffix.

### Security

- Sanitized the complete public Git history before first publication while retaining all functional history and annotated historical tags.
- Password initialization and recovery avoid process arguments; the Web application receives neither host root privileges nor a Docker socket.
- Deployment configuration remains external to Git, and root-managed domain changes validate Caddy candidates before activation.

### Compatibility

- Existing database schema, nodes, Collections, subscriptions, Tokens, Universal Base64 output, semantic duplicate protection, `.psmbackup` files and dual-domain behavior remain compatible.

### Validation

- Made isolated installer and manager fixtures portable to non-root CI runners while retaining root requirements outside the explicitly constrained test path.

## [0.1.7-rc.1] - 2026-10-08

### Fixed

- Prevented semantically identical nodes from being emitted more than once in the same subscription while preserving the first node by subscription position.
- Added final deduplication to canonical Universal Base64, raw output and every legacy format alias through one shared renderer path.
- Prevented newly selected semantic duplicates from being saved to a Subscription with structured 422 validation and no partial write.

### Added

- Added runtime semantic fingerprints derived from current rendered connection semantics: URI fragments are excluded, VMess `ps` is excluded, and all other rendered fields and unknown/private parameters remain significant.
- Added semantic-aware manual, current-result, Shift-range and cross-Collection source selection, with duplicate feedback and deterministic first-visible selection.
- Added historical-conflict indicators plus selected, emitted and suppressed duplicate counts in Subscription management and Preview.

### Safety

- Duplicate detection ignores display names and node IDs; equal names with different connections remain distinct.
- Global Node Library and Collections continue to allow duplicate node records and memberships.
- Existing duplicate `subscription_nodes` relationships are never modified automatically; semantic keys remain transient and require no database migration.
- The staging Subscription containing four selected nodes and two equally named VMess nodes was compared safely; their current connection semantics differ, so the reported device behavior is not confirmed as a semantic-duplicate root cause.

### Validation

- Added protocol, unknown-parameter, ordered-renderer, raw/alias parity, 422 rollback, historical-relation and Collection-boundary regression coverage.
- Added Playwright coverage for equal-name/different-connection selection, different-name/equal-connection blocking, semantic-aware bulk/Shift/cross-source selection, historical warning, 2-to-1 Preview output and 390px/320px containment.

## [0.1.6-rc.1] - 2026-10-08

### Added

- Added a shared Set-based node selection engine with tri-state current-result selection, selected totals, clear controls and searchable selected-node review.
- Added desktop Shift-click range selection over the current visible order and row-click selection across node management workflows.
- Added responsive sticky bulk action controls for desktop and 390px/320px mobile layouts.

### Changed

- Search, protocol, Tag, status and Collection source changes now preserve selections while bulk select/deselect remains scoped to the current filtered results.
- Unified selection behavior across the global Node Library, Collection member view, Collection add dialog and subscription node selector.
- Improved selected-row feedback and allowed non-interactive row areas to toggle selection without removing keyboard-accessible checkboxes.

### Safety

- Disabled nodes already in a target Collection are excluded from selection totals, select-all state and Shift ranges.
- Selection remains transient UI state and adds no database migration or persisted selection metadata.
- Collection selection operations continue to leave `subscription_nodes`, canonical subscription bodies, Tokens and global node records unchanged.

### Validation

- Added unit coverage for visible Set operations, tri-state calculation, filter accumulation, Shift ranges, disabled-node skipping, anchor reset and selected-only ordering.
- Added Playwright coverage for filtered accumulation, indeterminate state, selected review, row and checkbox behavior, Shift range selection, disabled Collection members and 390px/320px bulk controls.

## [0.1.5-rc.1] - 2026-10-08

### Added

- Added searchable, filterable multi-node selection directly inside each Node Collection.
- Added transactional and idempotent bulk membership operations for adding or removing nodes from one or more Collections.
- Added Collection membership chips, single-node quick membership controls, Collection member search and batch removal.

### Changed

- Reworked Node Library navigation to separate the global “All Nodes” master pool from Node Collection management views.
- Reworked the subscription node selector to distinguish the global library from Collection candidate filters and search within the active source.
- Removed per-node membership queries from Node Library loading by returning the complete node-to-Collection mapping in one query.

### Safety

- Collection membership changes never modify `subscription_nodes`, node records, Tokens or canonical subscription bodies.
- Removing a node from a Collection never deletes the global node; deleting a Collection never changes an existing subscription.
- Collection membership remains an administrator organization tool with no automatic subscription behavior.

### Validation

- Added transactional rollback, idempotency, authentication, membership count and canonical-body regression coverage.
- Added desktop/mobile Playwright coverage for empty Collections, searchable multi-add, Collection removal, global bulk actions and cross-source subscription selection.
- Confirmed the existing `002_node_collections.sql` schema fully supports this release; no database migration was added.

## [0.1.4-rc.1] - 2026-10-08

### Added

- Node Collections with ordered many-to-many node membership, node-library navigation and multi-collection import/edit assignment.
- Collection filtering in the Node Library and subscription node selector without making Collections an authorization or automatic-distribution boundary.
- WAL-safe portable SQLite backup, guarded restore and a password-encrypted single-file full instance migration format.
- Version-aware forward migrations, pre-migration snapshots, transactional failure handling and newer-schema startup rejection.
- Separate administrator and subscription domains with subscription-host route isolation and legacy admin-host subscription compatibility.
- Runtime Subscription Domain management with environment bootstrap and database source-of-truth persistence.

### Changed

- Subscription copy links and QR payloads now use the database-backed Subscription Domain through the authenticated backend URL builder.
- The canonical database path is `/data/private-subscription-manager.db`; database and migration restores invalidate active administrator sessions.
- Database migration startup checks now include SQLite integrity and foreign-key validation.

### Security

- Full migration packages protect the SQLite snapshot and `APP_MASTER_KEY` with scrypt-derived AES-256-GCM authenticated encryption; Tokens remain encrypted in SQLite.
- Subscription-only hosts reject the administrator SPA and API, while administrator mutation Origin checks remain bound to `ADMIN_BASE_URL`.
- Loopback access is limited to `/health` so container health checks remain functional in dual-domain mode.
- Database, migration bundle and instance-key artifacts are excluded from Git, Docker context and corresponding-source archives.

### Validation

- Added collection CRUD/ordering/filter/boundary regression coverage, including deletion and membership changes that leave nodes and subscriptions intact.
- Added 0.1.3-to-0.1.4 migration, WAL snapshot, encrypted export/restore, schema guard, failure rollback, session invalidation, Token/body continuity and domain source-of-truth tests.
- Added desktop/mobile Playwright coverage for Collections, cross-collection subscription selection, editable Subscription Domain, immediate copy/QR updates and cleanup.
- Completed an isolated full migration simulation preserving administrator, node envelope/sidecar/Tag, Collection membership, subscription order, settings, Token and canonical body hash.
- Passed 82 unit/integration tests and 5 Playwright workflows before the staging release gate.

## [0.1.3-rc.1] - 2026-10-08

### Changed

- Replaced the subscription-card preview shortcut with a direct delete action; card actions are ordered Copy Subscription → QR Code → Delete Subscription.
- Kept universal subscription preview in the management page and preserved management navigation.
- Shared the deletion action and existing confirmation dialog between cards and management, explicitly naming the profile and explaining immediate link revocation and global-node preservation.
- Added balanced three-column shortcuts, destructive styling and focus restoration after cancellation or deletion.

### Validation

- Added desktop/mobile deletion flows for empty, mixed and disabled profiles, cancellation, immediate list updates, detail preview and shared-node preservation.
- Added API regression checks for empty/disabled deletion and pivot cleanup without global-node deletion.
- Passed 77 unit/integration tests and 4 Playwright workflows, including 1280px, 390px and 320px card layouts.

## [0.1.2-rc.1] - 2026-10-08

### Changed

- Added copy, universal preview and QR quick actions directly to subscription list cards, including empty profiles.
- Reused the same action/dialog component in list cards and the existing management page; canonical URLs are fetched on demand to avoid stale links after rotation.
- Preserved management navigation and added compact responsive button groups with accessible labels and keyboard focus.

### Validation

- Added desktop/mobile Playwright coverage for list actions, empty/mixed profiles, canonical links, dialogs, management navigation and button containment.
- Passed 75 unit/integration tests and all 3 Playwright flows, lint, typecheck and optimized build.
- Shadowrocket device acceptance was confirmed PASS by the user before this UI task; no protocol or subscription format changes were made.

## [0.1.1-rc.1] - 2026-10-08

### Changed

- Consolidated client-specific links into one canonical Universal Base64 subscription URL.
- Legacy Shadowrocket, V2Ray and auto format parameters directly resolve to the identical canonical feed.
- Removed User-Agent/default-setting-dependent rendering from the subscription route.
- Simplified distribution UI to one universal copy/preview/QR entry; raw remains debug API only.
- Added ordered decoded node summaries to authenticated preview.
- Adopted decimal task version increments with carry at ten; product version is 0.1.1.

### Research

- Traced nine upstream subscription implementations, protocol fields, HTTP code, Git history and relevant issues/PRs; evidence is recorded in docs/SUBSCRIPTION_FORMAT.md.
- Standard Base64 URI subscriptions are supported by mature source implementations. Shadowrocket device failure root cause remains unconfirmed; no speculative protocol/HTTP workaround or adapter upgrade was made.

### Validation

- Regression coverage includes byte-identical aliases and UAs, empty/disabled authorization, six mixed protocols, Unicode, current edits, repeated unknown parameters, Reality/Vision/SpiderX and VMess TLS.
- lint, typecheck, 75 unit/integration tests, optimized build and one complete Playwright workflow passed; QR module pixels verify the canonical URL payload.
- Server validation does not certify a physical client; Shadowrocket device acceptance remains pending.
- Stable tag and remote push remain unapproved.

## [0.1.0-rc.3] - 2026-10-08

### Added

- Local release gate, pinned secret scanning, clean checkout verification and isolated Docker build checks.
- Annotated RC history, version/stable/push policies and a release checklist.
- Git-tracked source inventory and deterministic, validated source archives.

### Changed

- Generalized installation examples and repository ignore rules; no product behavior changes.

### Validation

- Product behavior remains based on RC2. Shadowrocket device acceptance remains pending.
- Stable tags and remote publication require explicit user approval.

## [0.1.0-rc.2] - 2026-10-08

### Fixed

- Unified public Shadowrocket responses to a standard Base64 URI feed shared with V2Ray.
- Removed structured `proxies:` output from the public Shadowrocket subscription endpoint.
- Added UA, explicit format priority, subscription envelope and semantic regression coverage.
- Disabled compression for `/s/*` to reduce native-client compatibility differences.
- Preserved Reality/Vision/SpiderX and VMess TLS semantics; made the TCP no-camouflage default explicit in generated links.

### Validation

- Server-side format validation passed; 69 automated tests and one browser E2E passed.
- The existing two-node profile already used Base64 before this fix; the exact device failure was not reproduced on a physical device.
- Device acceptance remains pending.

## [0.1.0-rc.1] - 2026-10-08

### Added

- Single-admin opaque sessions, Argon2id, CSRF and bearer subscription tokens.
- Global node library and subscription profiles with many-to-many pivot ordering.
- URI paste/bulk preview and transactional import, structured editing, reimport and original restore.
- Lossless original/normalized/ordered-sidecar envelope and a pinned Sub-Store adapter.
- Raw, V2Ray and initial Shadowrocket output paths.
- SQLite versioned migrations, backup, React Chinese admin, themes, QR and Docker/Caddy deployment.
- AGPL licensing, third-party provenance and network corresponding-source distribution.

### Validation

- Initial server-side implementation validation passed; 60 automated tests and one browser E2E passed.

### Known Issues

- Shadowrocket device subscription acceptance was not achieved; some Shadowrocket branches returned a structured list rather than a URI subscription.
