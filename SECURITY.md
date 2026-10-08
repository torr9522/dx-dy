# Security Policy

Security fixes are provided for the latest published dx-dy version.

Do not open a public issue containing credentials, subscription Tokens, node URIs, private keys, database files, backups, production domains or server addresses. Use the repository's private security advisory channel after the public repository is created. Include the affected version, impact and a synthetic reproduction.

- Keep `/etc/dx-dy` and Full Migration backups root-only.
- Never expose the application container directly to the Internet; use the bundled Caddy deployment.
- Never mount `/var/run/docker.sock` into the application container.
- Rotate affected credentials before sharing diagnostic artifacts.
- Subscription URLs are bearer credentials and must not appear in access logs.
