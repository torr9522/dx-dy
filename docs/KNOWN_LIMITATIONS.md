# Known Limitations

- Shadowrocket named-subscription deep-link syntax is verified from mature OSS implementations and by payload decode, but has not been tested on a physical iPhone in this development environment.
- Stash and Surge installation schemes expect client configuration formats that differ from dx-dy's Universal Base64 URI feed, so 0.2.5 does not present misleading client buttons for them.
- sing-box remote-profile import expects a sing-box configuration document, not the current Universal Base64 feed. Hiddify supports several import forms, but no extra button is exposed until its exact feed contract is accepted end to end.
- Fresh installation is formally supported only on Debian 12, Ubuntu 22.04/24.04
  LTS and amd64/arm64. Other systems are best effort.
- The zero-prerequisite command assumes a root shell with working Debian/Ubuntu
  apt repositories. It bootstraps curl and CA certificates; DNS and outbound
  HTTPS must already work.
- dx-dy is a single-administrator private manager. It has no user registration,
  billing, plans, orders, traffic accounting, referrals or ticket system.
- SQLite is the only database. The application is not a horizontally scaled
  multi-writer service.
- dx-dy parses and distributes configuration but does not bundle Xray Core or
  perform live proxy connectivity tests.
- Protocol preservation is broader than editable fields; retaining an unknown
  private parameter does not certify client support for it.
- VMess accepts the established 8-4-4-4-12 hexadecimal credential shape without
  requiring RFC UUID version/variant bits; this does not permit arbitrary IDs.
- Conservative semantic fallback can miss an equivalent connection that cannot
  be safely canonicalized. It deliberately avoids suppressing distinct Nodes.
- Web settings can change the canonical subscription origin but cannot safely
  mutate host Caddy/DNS/TLS. Use the root `dx-dy domain` workflow.
- Built-in Caddy mode requires available ports 80/443 and externally correct DNS
  and cloud firewall rules. The installer never kills conflicting services.
- Physical fresh-VM and client behavior still require environment-specific
  acceptance; fixtures and CI runners do not replace those checks.
- Update and installation require reachable public GitHub Release assets;
  offline installation is not provided. GHCR is not required.
- Automatic rollback covers a failed update start/health check by restoring the
  previous release link and pre-update DB. An arbitrary user-requested downgrade
  command is not provided.
- Existing unrelated Caddy configurations are preserved and imported, but
  unusual custom package/layout configurations may require manual integration.

Historical note: public `v0.2.0` has failed tag workflow records caused by an
Actions local-tag fetch collision. The tag is intentionally immutable; 0.2.1
fixes the validation path without fetching or rewriting tag refs.
