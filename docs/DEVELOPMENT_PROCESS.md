# Development Process

## Standard Flow

```text
Requirement and scope
  -> choose the decimal version
  -> inspect current code/tests and mature protocol sources where relevant
  -> implement in the existing ownership layer
  -> unit/integration/frontend tests
  -> Playwright for runtime/UI behavior
  -> optimized build and Docker validation
  -> isolated staging validation
  -> full/public release gate
  -> annotated direct tag
  -> intended branch push and CI
  -> intended tags and GitHub Release
```

An actual source change after a published release advances `0.0.1` with decimal
carry. Documentation needed to finish an untagged release remains in that same
release. Update CHANGELOG and focused regressions with behavior changes.

## Scope And Evidence

Start by locating the existing implementation and invariants. Protocol changes
require A/B evidence from pinned/current mature source, history, merged changes
and tests; issue claims alone are not device certification. Never use real node
credentials in fixtures.

Prefer one shared parser, renderer, backup implementation and selection engine.
Do not add client-specific output or infrastructure dependencies without a
demonstrated requirement.

## Database Decision

A change needs a new migration only when persisted schema must change. Runtime
fingerprints, UI state, computed counts, branding, installer/manager behavior
and routing configuration do not by themselves need a migration.

For a schema change: add the next numbered migration, never edit a released
migration, snapshot before applying, transact it, verify integrity/foreign keys,
test the previous release upgrade, failed rollback and newer-schema rejection.

## Verification And Commit

Run focused tests during implementation, then the complete commands in
[Testing and Release](TESTING_AND_RELEASE.md). Stage intended sources, run
`pnpm source:manifest`, review the diff and commit a coherent change. The release
gate runs only on a clean committed tree so its source archive and Docker image
can be tied to one commit.

## Publication

Verify the single intended remote, branch and tag list. Create an annotated,
unsigned `vX.Y.Z` only after gates and staging validation. Scan refs again, push
the current branch, wait for CI, then push approved tags. The tag workflow builds
GHCR images and Release assets; it never deploys the staging server.

Once a version is public, a source fix belongs to the next version. Never move a
public tag or force-push normal development history.
