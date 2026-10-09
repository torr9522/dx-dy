# Release Process

`package.json.version` is the source of truth. The gate checks README, `/health`, ready event, source filename, native install metadata, installer and manager against it.

Versions use decimal carry (`0.1.8 -> 0.1.9 -> 0.2.0 -> 0.2.1 -> 0.2.2 -> 0.2.3 -> 0.2.4 -> 0.2.5`). Versions from 0.1.8 use direct annotated unsigned `vX.Y.Z` tags after the full gate; historical RC tags stay immutable. Never move a public tag or rewrite public history.

## Pre-Tag

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm source:manifest
git add --all && git commit
DXDY_PRIVATE_IDENTITIES_FILE=/private/path.json pnpm release:check --full --public
```

The final command requires a clean committed tree, repeats validation in a detached checkout, creates deterministic source archives, builds target-specific amd64 and arm64 artifacts and starts the matching bundled Node runtime with production dependencies. Docker/GHCR is not a release gate. GitHub validation distinguishes master pushes, pull requests and tag pushes; a direct tag must match the package version and its target must equal current `origin/master`.

## Tag And Publication

Create `git tag -a vX.Y.Z -m ...`, confirm its peeled target equals frozen HEAD, then repeat secret/identity scans including the tag. Push `master` only to the verified `origin`, wait for CI, then push the single tag. The tag workflow builds both native artifacts and creates one stable GitHub Release.

Verify unauthenticated downloads of `install.sh`, `dx-dy`, both Linux tarballs, the source tarball, `release-manifest.json` and `SHA256SUMS`. Check manifest commit/version/runtime/architecture/hashes and ensure no instance identity or secret appears. GHCR is neither produced nor checked from 0.1.9 onward.

## Staging And Failure Policy

Runtime changes need test/staging fingerprints for counts, database integrity/FKs, Token fingerprints and byte-identical subscription bodies. Native migration additionally verifies old Compose app/Caddy stopped, native services active, HTTPS/admin/subscriptions and restart. If no staging runtime is present, report that gate honestly and do not fabricate it.

Before a public tag, fix failures within the same version and recreate only an unpublished local tag. After publication, every code fix advances to the next decimal version.
