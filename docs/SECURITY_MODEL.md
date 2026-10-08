# Security Model

## Trust Boundaries

- The administrator is trusted and authenticates to the admin host.
- Subscription URLs are bearer credentials: possession grants feed access.
- The subscription host is intentionally untrusted for admin routing and exposes
  only `/s/*` and `/health`.
- The app container is unprivileged; the root-owned SSH manager is a separate
  operations boundary.

## Authentication And Sessions

Admin passwords use Argon2id. Session identifiers are random and only their
SHA-256 hashes are stored; cookies are HTTP-only, SameSite and secure in HTTPS
deployments. Mutations require the session CSRF value and valid admin origin.
Login/admin/subscription routes are rate-limited. Password or username recovery
uses the application CLI over stdin and invalidates every active session.

## Subscription Tokens And Keys

Subscription Tokens are 32 random bytes encoded base64url. SQLite stores their
SHA-256 lookup hash plus AES-256-GCM ciphertext under the external 32-byte
`APP_MASTER_KEY`; plaintext Tokens are not stored or logged. The key lives in a
root-readable environment file, never in Git or the image.

## Host And Container Isolation

Caddy terminates TLS and enforces host routing. The app receives no Docker
socket, privileged flag, host root or writable Caddy configuration. Web settings
cannot mutate infrastructure. The `dx-dy` manager validates hostnames and Caddy
candidates, uses no `eval`, and coordinates root-only changes over SSH.

## Backup Sensitivity

Portable DB backups contain encrypted Tokens and Node credentials and need the
matching master key for Token recovery. Full Migration bundles also contain that
key inside scrypt/AES-256-GCM encryption. Treat both as sensitive; treat a Full
Migration file and its password together as complete instance access.

## Logging And Public Source

Do not log passwords, master/session keys, Tokens, node URIs or canonical
semantic strings. Public errors and subscription bodies contain no duplicate
diagnostics. Public Git/source/images/assets must contain only reserved example
identities and no databases, backups, `.env`, auth material or runtime logs.

Before release, scan tracked/untracked candidates, all refs, tag messages, all
objects, Docker context and source/release archives with Gitleaks plus the private
known-identity list. Report vulnerabilities through the GitHub private security
advisory channel described in [`SECURITY.md`](../SECURITY.md), not a public issue.
