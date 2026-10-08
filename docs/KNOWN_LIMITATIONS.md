# Known Limitations

- Fresh installation is formally supported only on Debian 12, Ubuntu 22.04/24.04
  LTS and amd64/arm64. Other systems are best effort.
- dx-dy is a single-administrator private manager. It has no user registration,
  billing, plans, orders, traffic accounting, referrals or ticket system.
- SQLite is the only database. The application is not a horizontally scaled
  multi-writer service.
- dx-dy parses and distributes configuration but does not bundle Xray Core or
  perform live proxy connectivity tests.
- Protocol preservation is broader than editable fields; retaining an unknown
  private parameter does not certify client support for it.
- Conservative semantic fallback can miss an equivalent connection that cannot
  be safely canonicalized. It deliberately avoids suppressing distinct Nodes.
- Web settings can change the canonical subscription origin but cannot safely
  mutate host Caddy/DNS/TLS. Use the root `dx-dy domain` workflow.
- Built-in Caddy mode requires available ports 80/443 and externally correct DNS
  and cloud firewall rules. The installer never kills conflicting services.
- Physical fresh-VM and client behavior still require environment-specific
  acceptance; containerized/preflight tests do not replace those checks.
- Update and installation require a reachable GitHub stable Release and public
  GHCR package; offline installation is not provided.
- There is no automatic downgrade. Restore and update rollbacks use backups and
  the previously pinned image/configuration.
