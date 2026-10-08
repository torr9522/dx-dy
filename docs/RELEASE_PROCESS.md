# Development and local release process

## Authority and source of truth

The development Git repository is the source of truth. Deployment directories are disposable source copies plus protected runtime configuration/data. Never repair deployment source without committing the equivalent change here. Deploy a clean committed HEAD; record its commit, product version and eventual annotated tag. RC tags may be created after deployment validation.

Keep the existing `master` single mainline (no Git Flow). The release gate checks this branch. Detached temporary worktrees are allowed only for verification. Commit coherent changes; update CHANGELOG for every bugfix, feature, behavior/security/migration/adapter/deployment change. No unrelated dependency upgrades in a feature task.

## Version and tags

`package.json.version` is the product version source of truth, currently **0.1.7**. README, `/health`, ready event, source download filename and Compose image version are checked against it by the release gate. Update all copies together.

The user-approved policy is decimal task versioning, not ordinary SemVer increments: every completed actual modification/fix/feature task advances by 0.0.1, carrying at ten (`0.0.9 → 0.1.0`, `0.1.9 → 0.2.0`, `0.9.9 → 1.0.0`). This task is `0.1.6 → 0.1.7`; the next actual task is `0.1.8`, not another RC of 0.1.7. MINOR and PATCH are single decimal digits. Release identity remains separate: `vX.Y.Z-rc.N`, normally rc.1 for a new task version. Revalidation within that same task may use another RC; it cannot substitute for the next task's version increment.

After each completed task: commit + CHANGELOG + tests + production build + required Docker/deployment validation + **annotated unsigned RC tag** + clean Git. Record both tag object SHA and peeled commit target. Never move an existing published/approved tag. RC1/RC2 identify historical product states; RC3 adds release tooling and does not certify device acceptance.

**Stable tags require explicit user approval** (for example “publish vX.Y.Z” or “create stable tag”). Codex may create RC tags after passing checks; it may not independently create a stable tag, signing key, remote repository, remote configuration, GitHub/GitLab release or push. Annotated unsigned tags are sufficient unless the user supplies a signing policy/key.

## One-command local gate

```sh
pnpm release:check
pnpm release:check --full
```

The normal gate requires clean Git, expected branch, version/changelog/license/provenance checks, secret scans, frozen install, reviewed dependency audit, lint, typecheck, tests, production build and source archive validation. It installs **Gitleaks 8.30.0** as development tooling with a pinned archive checksum, outside the repository. Linux x64 auto-install is supported; other systems must supply the same version via `GITLEAKS_BIN`.

The full gate repeats install/quality/build in a fresh detached worktree, then performs a no-cache Docker build and isolated health/migration/backup/restart/persistence smoke test. It never deploys the image. If Docker is unavailable locally, an explicitly configured SSH build host can be used:

```sh
RELEASE_TMPDIR=/dev/shm pnpm release:check --full
# Optional remote Docker engine, no production Compose operations:
RELEASE_DOCKER_SSH=root@build-host.example pnpm release:check --full
```

SSH keys are preferred. For a temporary password-authenticated build host, the tool accepts `RELEASE_SSH_PASSWORD` from the caller environment and uses sshpass; never put it in repository files, command-line arguments or logs. The build host must already have Docker. Temporary worktrees, build directories, test containers, volumes and the generated image are removed by the gate. Failure exits nonzero; missing Docker in full mode is a failure, not a silent skip. E2E remains an explicit gate when runtime/frontend/API changes: `pnpm test:e2e`.

Edit → stage all intended source → `pnpm source:manifest` → commit → run the gate. Manifest generation intentionally uses the Git index, not arbitrary folders. If validation fails, fix and commit/amend before tagging; rerun affected checks and the full gate. The final tag is created only after success. Run `pnpm secret:scan` again after tag creation to cover tag messages/objects.

## Source archives and fresh installs

`pnpm source:archive` generates `dist/source.tar.gz` and `dist/private-subscription-manager-<version>-source.tar.gz`. `scripts/source-files.json` is the committed Git-tracked inventory. In Git checkouts, generation verifies it exactly matches `git ls-files`. In Docker/Git-free corresponding-source trees, the same committed inventory is used; unlisted files are never archived. Tar ordering, timestamps, file modes, owner/group and gzip encoding are normalized; symlinks and forbidden artifact paths are rejected. Release checks enforce clean committed content before building and confirm it stayed frozen through validation. Verify archives with `pnpm source:verify`; they must include all inventoried files, license, docs, lockfile and migrations and pass a secret scan. The full gate also compares archive hashes across the original checkout and fresh worktree.

Normal builds do not require an upstream checkout or hidden developer files. `pnpm vendor` is only an intentional adapter refresh, with `SUB_STORE_SOURCE` explicitly pointing to the exact audited upstream commit. The committed vendor closure is sufficient to reproduce builds.

## Secret and dependency discipline

Never commit real node URIs/UUIDs/passwords/tokens, administrator passwords, master/session keys, `.env`, databases, backups or runtime logs. Fixtures must remain synthetic. Scan tracked + nonignored untracked source, all-ref Git history, annotated tag messages and every local Git object (including unreachable objects). Ignored runtime/dependency artifacts are not publishable source. For known private values, `pnpm secret:scan --known-secrets-stdin` additionally accepts a JSON string array over stdin; do not save it. Reports show only rule/path/commit/line, not matches. Pattern scanning is a gate, not proof that all arbitrary secrets are detectable.

If real history contamination is found: mark release BLOCKED, report only location/type, do not push, and **do not rewrite history** without a separate user-approved remediation. No `filter-repo`, forced reset or tag retargeting as a shortcut.

Keep the lockfile committed. Review audit findings; never use force upgrades to chase a zero count. Dependency/adapter upgrades are separate scoped tasks unless indispensable to a change. Sub-Store upgrades record old/new commit, parser/producer diff, notices/license and protocol regressions in their own commit/release identity.

## Database discipline

Every schema change needs a new versioned migration. Do not edit migrations already in any RC/stable release. Back up before upgrade, test previous-version database → new migrations, verify integrity and failure behavior. Migration failures must prevent startup with a partially applied migration. Never delete a user's existing database to make development easier. Preserve master keys together with protected backups.

## Stable and remote gates

Stable requires real Shadowrocket device acceptance, other advertised device acceptance as requested, automated/E2E tests, full clean-checkout/Docker gate, previous-version upgrade tests, backups/integrity, all-ref secret scan, license/provenance/source offer, fresh-install documentation and clean Git **plus explicit user approval**. This baseline does not supply that approval.

Before any future explicitly approved push: rerun the full gate and all-ref/object scan; verify the user-selected remote URL. Push only the intended mainline, verify remote HEAD, then only individually approved stable/RC tags and verify remote tag objects/peeled targets. Never `push --mirror`, `push --tags` indiscriminately or publish an external release without authorization. Whether historical RC tags are uploaded is a user decision.
