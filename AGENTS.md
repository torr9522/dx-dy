# Repository maintenance requirements

Read docs/RELEASE_PROCESS.md and docs/RELEASE_CHECKLIST.md before changes.

Each completed actual modification task increments product version by decimal 0.0.1 with carry at ten (0.1.9 → 0.2.0), per docs/RELEASE_PROCESS.md. The next task after 0.1.4 uses 0.1.5, not 0.1.4-rc.2. Canonical /s/:token must always be Universal standard Base64, independent of User-Agent; legacy auto/v2ray/shadowrocket aliases have byte-identical bodies. Raw is debug-only. Client-specific protocol changes require traced mature-source A/B evidence and regression tests; never guess using real node credentials.

Every completed feature/fix/behavior/security/migration/adapter/deployment task requires coherent Git commits, CHANGELOG, automatic tests, production build, applicable Docker and test deployment checks, an annotated vX.Y.Z-rc.N tag, and clean Git. Report both tag object and peeled commit target. Pure tooling/docs tasks need the release gate but do not justify production restarts.

Stable tags, remote repository/remote changes, pushes and external releases require explicit user approval. Never create a stable tag or push on the basis of perceived stability. Preserve existing master mainline, runtime data and credentials; never rewrite history or retarget tags to remove secrets without separately authorized remediation.

Do not commit real credentials or runtime databases. Keep Sub-Store pinned and preserve provenance. Refresh the Git source inventory with pnpm source:manifest after staging intended source and before the release commit. Product version source of truth is package.json. All generated/source archives must pass the release checks. Deployment copies are not source of truth.
