# Testing And Release

## Validation Layers

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
shellcheck -x install.sh ops/dx-dy
pnpm source:verify
pnpm secret:scan
pnpm release:check --full --public
```

- Unit/integration: adapter round trips, API/security, SQLite migration,
  backup/restore, frontend selection logic and installer/manager fixtures.
- Playwright: complete desktop/mobile workflows; use 390px and 320px checks for
  compact controls.
- Docker: no-cache image build, isolated health, migration, backup, restart and
  persistence.
- Fresh checkout: frozen install, lint, typecheck, tests, build and source hash
  reproducibility from a detached worktree.
- Deployment: only explicit staging validation; GitHub Actions never SSH to it.

## Public Gate

The public gate checks brand/version, mandatory public files, executable shell
entrypoints, ShellCheck, workflow YAML, safe Compose privileges, Caddy single/
dual validation, forbidden artifacts and an optional all-object known-identity
list stored outside the repository. The complete gate also runs Gitleaks against
tracked/untracked candidates, refs, tag messages, all objects and source archive.

No `.env`, DB, WAL/SHM, `.psmbackup`, instance key, browser secret artifact,
runtime log, private bundle or mapping may be tracked or released.

## Release Policy

Historical 0.1.0-0.1.7 RC tags remain annotated. From 0.1.8 onward:

1. update version/changelog/docs and focused tests;
2. stage intended files and run `pnpm source:manifest`;
3. commit and obtain a clean tree;
4. run E2E, full/public gate and staging regression as applicable;
5. create annotated unsigned `vX.Y.Z` and scan refs again;
6. push only the current branch, wait for CI, then push reviewed tags;
7. verify the tag Release, assets, manifest and anonymous multi-arch GHCR pull.

Tag workflow permissions are limited to `contents: write` and `packages: write`.
CI uses `contents: read`. Neither workflow has deployment credentials.

Once published, any code fix advances to the next decimal version. Do not move a
public tag. See [RELEASE_PROCESS.md](RELEASE_PROCESS.md) for operational detail.
