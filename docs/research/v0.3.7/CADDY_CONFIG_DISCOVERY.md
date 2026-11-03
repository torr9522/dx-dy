# Caddy Main Configuration Discovery Research

## Scope

dx-dy v0.3.6 treated the directory containing `DXDY_CADDY_IMPORT` as if it
also contained the active main Caddyfile. On a host whose main configuration is
`/etc/caddy/Caddyfile` and whose managed fragment is
`/etc/caddy/sites-enabled/dx-dy.caddy`, that produced the nonexistent path
`/etc/caddy/sites-enabled/Caddyfile`.

This is a dx-dy Manager defect, not a Caddy upstream defect. There is therefore
no upstream Caddy fix commit or release that can be applied. The v0.3.7 fix is
the repository commit containing this document and the corresponding Manager
tests.

## Official Evidence

- The Caddy command documentation defines `run --config` and `--adapter`, says
  `reload` is the semantic configuration reload operation, and documents
  `validate` as loading and provisioning without starting the config:
  <https://caddyserver.com/docs/command-line>.
- Caddy v2.6.2 `cmdRun` reads `--resume` first and ignores `--config` when the
  autosave is successfully loaded. Its `LoadConfig` special case only infers
  the Caddyfile adapter for explicit filenames beginning with `Caddyfile` and
  not ending in `.json`:
  <https://github.com/caddyserver/caddy/blob/v2.6.2/cmd/commandfuncs.go> and
  <https://github.com/caddyserver/caddy/blob/v2.6.2/cmd/main.go>.
- The official Caddy systemd unit starts
  `/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile` and reloads with
  the same main path. Its comments distinguish file-driven service operation
  from `--resume`: <https://github.com/caddyserver/dist/blob/master/init/caddy.service>.
- The official `import` directive accepts files, snippets and glob patterns;
  relative file imports are resolved relative to the file containing the
  import: <https://caddyserver.com/docs/caddyfile/directives/import>.
- systemd documents `systemctl show` as exposing runtime properties including
  `MainPID`, and `ExecStart` as the main service process:
  <https://www.freedesktop.org/software/systemd/man/latest/systemctl.html> and
  <https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html>.
- Compatibility baselines were checked against the official Caddy v2.6.2 and
  v2.11.7 releases:
  <https://github.com/caddyserver/caddy/releases/tag/v2.6.2> and
  <https://github.com/caddyserver/caddy/releases/tag/v2.11.7>.

The v2.6.2 linux/amd64 archive was verified against the release's official
SHA-512 checksum list before use. Both v2.6.2 and v2.11.7 then passed isolated
`validate` and `adapt` checks for an absolute glob import whose fragment lives
in a different directory from the main Caddyfile.

The release notes and issue search did not identify an upstream bug matching
dx-dy's fragment-directory inference. Related upstream reload issues concern
socket activation rather than main-config discovery, for example
<https://github.com/caddyserver/caddy/issues/6631>; they are not used as a fix.

## Design Consequences

1. A valid persisted `DXDY_CADDYFILE` has first priority.
2. Otherwise, systemd metadata is collected for diagnostics and the effective
   running process is selected through `MainPID`.
3. `/proc/<pid>/cmdline` is parsed as argv, never reparsed from a rendered
   `ExecStart` string. This preserves spaces and quoting already resolved by
   systemd.
4. Relative `--config` paths are resolved against `/proc/<pid>/cwd`.
5. Duplicate config/adapter flags, `--resume`, missing process state,
   unsupported adapters and non-distinct main/fragment paths fail closed.
6. The candidate fragment is validated alone and as part of the complete main
   configuration. The real fragment path is overlaid only inside a private
   mount namespace during full validation.
7. Byte-identical fragments do not trigger reload. Changed fragments use
   `caddy reload`; reload or public-health failure restores the old fragment
   and reloads the verified prior configuration.

## Test Traceability

`tests/ops.test.ts` contains `CADDY-DISCOVERY-001` through
`CADDY-DISCOVERY-020`, covering standard/custom paths, glob imports, persisted
and live discovery, effective systemd process argv, symlinks, ambiguity,
missing state, fail-before-mutation, full validation, rollback, idempotency and
unrelated-site preservation.
