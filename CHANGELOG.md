# Changelog

## [Unreleased]

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
