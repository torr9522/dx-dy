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

- Unit/integration: protocol adapter, API/security, SQLite migration, backup/restore, selection and installer/manager fixtures.
- Playwright: complete desktop/mobile workflows at normal, 390px and 320px widths.
- Native artifacts: amd64/arm64 layout, target production dependencies, bundled Node launch, release metadata and checksums.
- systemd/Caddy: required unit hardening, ExecStart/environment/account paths, single/dual localhost proxy templates and change rollback.
- Fresh checkout: frozen dependency install, quality/build/source reproducibility, then native artifact builds.
- Staging: only explicit test/staging validation; GitHub Actions never SSH to a server.

Installer fixtures cover Debian 12, Ubuntu 22.04/24.04 and both architectures. They assert the fresh path contains no GHCR, Podman or Nerdctl dependency and creates native paths. A clean real Debian 12 host remains the final physical acceptance environment.

Installer query-path tests run `-h`, `--help`, `--version` and an invalid option
with an unsupported/missing OS fixture, non-root identity where available and
sentinel package/service/account commands. They require zero sentinel calls and
an unchanged fixture tree. CI ref-policy tests cover master push, pull request
base, detached direct tag, invalid/RC tag, off-master tag and ordinary local
detached contexts.

## Native Dependency Audit

The runtime uses Node `26.10.0`. SQLite is built-in `node:sqlite`. The only production native addon is `argon2@0.45.1`, loaded through `node-gyp-build`; official linux-x64 and linux-arm64 glibc prebuilds are selected in target-specific production dependency deployments. Tailwind, Lightning CSS and Rolldown native modules are build-time dependencies and are not required by the running server.

Official Node Linux binaries require at most GLIBC 2.28 and the selected Argon2 glibc prebuilds require at most GLIBC 2.34, within Debian 12 and Ubuntu 22.04/24.04. Each artifact is built and executed on its native architecture runner; target addons are prebuilt and the package is trimmed to that architecture rather than linked against runner libraries.

## Public Gate

The gate checks brand/version, required files, executable shell entrypoints, ShellCheck, workflow YAML, native systemd/Caddy invariants, forbidden artifacts, source archives, Gitleaks and an optional private all-object identity list stored outside the repository. No `.env`, DB/WAL/SHM, `.psmbackup`, credentials, logs, private bundle or mapping may be tracked or released.

## Release Policy

Historical 0.1.0-0.1.7 RC tags remain. From 0.1.8 onward:

1. update version, CHANGELOG, docs and tests;
2. stage intended files and run `pnpm source:manifest`;
3. commit and obtain a clean tree;
4. run Playwright, full/public gate and staging regression when available;
5. create an annotated unsigned `vX.Y.Z` and rescan all refs;
6. push only `master`, wait for CI, then push the reviewed tag;
7. verify the stable GitHub Release and anonymous downloads of installer, manager, manifest, checksums, source and both native artifacts.

Release workflow permissions are `contents: read` for builders and `contents: write` only for publication. It has no packages permission, deployment secret or GHCR step. Any source fix after public `v0.2.1` becomes `0.2.2`; public tags are never moved.
