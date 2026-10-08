# Release checklist

Copy these checks into the release review; do not precheck them from an earlier RC.

## Source

- [ ] Git clean, expected master branch, no untracked release-critical files
- [ ] Product version consistent, CHANGELOG updated
- [ ] Each actual task increments decimal product version with carry at ten; no repeated RC substituted for a new task
- [ ] LICENSE and THIRD_PARTY_NOTICES correct
- [ ] Git source inventory refreshed and committed

## Secrets

- [ ] Tracked and nonignored untracked source scan
- [ ] All-ref history, tags/messages and all local Git objects scanned
- [ ] Known private values checked securely where available
- [ ] No tracked .env/database/backups/logs/real URIs/tokens/admin credentials

## Dependencies

- [ ] Frozen install passed, lockfile committed
- [ ] Audit reviewed; risks resolved or explicitly documented

## Quality

- [ ] lint, typecheck, unit/integration/frontend logic tests
- [ ] E2E if API/frontend/runtime changed
- [ ] Optimized release build

## Database

- [ ] Deterministic new migrations; released migrations unchanged
- [ ] Upgrade from previous release database tested if applicable
- [ ] Pre-migration and pre-restore backups tested
- [ ] Live WAL database snapshot tested with integrity and foreign-key checks
- [ ] Encrypted full migration bundle export/restore and Token continuity tested
- [ ] No database, `.psmbackup` or instance-key artifact is tracked or archived
- [ ] Newer-schema startup rejection and failed-migration rollback tested

## Docker

- [ ] No-cache build
- [ ] Isolated healthcheck/migration test
- [ ] Restart and persistence

## Fresh checkout

- [ ] Fresh detached worktree contains no env/database/dependencies/build artifacts
- [ ] Frozen install, lint, typecheck, tests, build
- [ ] Docker build from that checkout's tracked source

## License

- [ ] AGPL LICENSE and third-party provenance
- [ ] Safe complete corresponding-source archive
- [ ] Network source offer works for the actually deployed version

## Release

- [ ] Release commit frozen; tests correspond to that commit
- [ ] Runtime-changing release deployed/validated from clean committed HEAD
- [ ] Real Shadowrocket and other required device acceptance before stable
- [ ] Annotated direct version tag (0.1.8+) or historical RC tag, tag object and target recorded
- [ ] Publication coordinates and release metadata are final before tagging

## Public release

- [ ] Private pre-public bundle verified and stored outside the repository
- [ ] Complete reachable history and local objects contain no private deployment identities
- [ ] Historical tag names, chronology and annotated type preserved
- [ ] Public brand, installer, manager, Docker/Caddy templates and docs consistent
- [ ] ShellCheck and isolated installer/manager tests passed
- [ ] CI and release workflows use least privilege and never deploy a server
- [ ] Multi-architecture image and release manifest paths are owner-neutral
- [ ] No database, backup, `.env`, instance key, deployment log or Playwright secret artifact

## Remote — not authorized in this baseline

- [ ] User explicitly approved push and chosen tags
- [ ] Remote URL verified
- [ ] Mainline push and remote HEAD verified
- [ ] Approved tag pushes verified
- [ ] Remote tag object and peeled commit target verified
