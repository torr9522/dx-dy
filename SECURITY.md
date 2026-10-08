# Security Policy

Security fixes are provided for the latest published dx-dy version.

Do not open a public issue containing credentials, subscription Tokens, node URIs, private keys, database files, backups, deployment domains or server addresses. Use the repository's private security advisory channel. Include the affected version, impact and a synthetic reproduction.

- Keep `/etc/dx-dy` and Full Migration backups root-only.
- Never expose the localhost application port directly to the Internet; use the managed host Caddy service.
- Never grant the `dx-dy` service account systemd, Caddy, Docker socket or host-root control.
- Rotate affected credentials before sharing diagnostic artifacts.
- Subscription URLs are bearer credentials and must not appear in access logs.
