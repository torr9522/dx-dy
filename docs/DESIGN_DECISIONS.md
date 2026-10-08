# Design Decisions

Each accepted decision records why the boundary exists and what future changes
must preserve or deliberately revisit.

## 1. Single Administrator, Private Use

**Context:** The product manages one person's or a small trusted group's private
nodes. **Decision:** One administrator account and no customer lifecycle.
**Why:** Keeps authentication, data ownership and UX understandable.
**Consequences:** Registration, billing, packages, orders, traffic accounting,
referrals and tickets are out of scope.

## 2. SQLite Instead Of A Server Database

**Context:** One-instance workloads need portability more than horizontal write
scale. **Decision:** SQLite in WAL mode. **Why:** Transactional, reliable and
easy to back up/migrate. **Consequences:** One application writer; migration and
backup code must respect WAL and locking. MySQL/Postgres are not supported.

## 3. No Redis Or Queue

**Context:** Current work is synchronous CRUD/rendering. **Decision:** Do not add
Redis, brokers or background workers. **Why:** They add failure modes without a
demonstrated need. **Consequences:** Revisit only for measured product demand.

## 4. Sub-Store Adapter Over A Custom Parser

**Context:** Proxy URI formats have mature, changing conventions. **Decision:**
Adapt a pinned, attributed Sub-Store subset and retain a lossless sidecar.
**Why:** Avoid a second speculative protocol implementation. **Consequences:**
Upgrades require provenance and protocol regression review.

## 5. No Xray Core In v0.x

**Context:** dx-dy distributes configuration; it does not run proxy traffic.
**Decision:** Do not bundle Xray Core in v0.x. **Why:** It would expand privilege,
network and lifecycle scope. **Consequences:** Runtime connection testing is not
an advertised capability.

## 6. Universal Base64 Is Canonical

**Context:** Supported clients accept standard URI subscriptions. **Decision:**
One LF-separated UTF-8 URI body encoded with standard Base64 for `/s/:token` and
legacy aliases. **Why:** Stable shared behavior avoids UA branches.
**Consequences:** Raw is admin debugging only; format changes need evidence.

## 7. Collections Are Management Only

**Context:** Collections organize a global library. **Decision:** Collection
membership never grants access or changes a Subscription. **Why:** Automation
would create surprising distribution changes. **Consequences:** Users explicitly
select Subscription Nodes.

## 8. NO AUTO SUBSCRIPTION

**Context:** Bulk Collection operations and Subscriptions have different intent.
**Decision:** No trigger or service synchronizes them. **Why:** Subscription
changes must be deliberate. **Consequences:** Tests assert relationship hashes
stay unchanged after Collection edits.

## 9. Semantic Duplicate Means Connection Semantics

**Context:** Names and IDs are display/storage identity. **Decision:** Compare
the current rendered connection after removing only display identity. **Why:**
Same names may be different connections; different names may be identical.
**Consequences:** Unknown/private connection parameters remain significant and
false-positive suppression is avoided.

## 10. Semantic Keys Are Runtime Values

**Context:** Renderer behavior can evolve. **Decision:** Compute SHA-256 semantic
keys at runtime; do not persist or globally constrain them. **Why:** Avoid stale
database identity and preserve Library duplicates. **Consequences:** Selector
and final renderer share the same implementation; historical pivots remain.

## 11. Caddy Provides Automatic HTTPS

**Context:** Public installs need TLS and host routing. **Decision:** A Caddy
container owns ports 80/443, ACME and proxying. **Why:** A small declarative
surface handles renewal and dual hosts. **Consequences:** DNS/ports must be
correct; no certbot, acme.sh or Nginx is installed.

## 12. The Web Container Does Not Manage Infrastructure

**Context:** Caddy/domain mutation needs host privilege. **Decision:** Never give
the app Docker socket, privileged mode or writable root config. **Why:** An admin
web compromise must not become host control. **Consequences:** Web settings can
change canonical URL only; root infrastructure uses SSH.

## 13. `dx-dy` Is The Privileged Operations Layer

**Context:** Administrators need safe lifecycle and recovery workflows.
**Decision:** A root-owned shell manager coordinates Docker/Caddy while invoking
application CLIs for business mutations. **Why:** Keeps hash/database policy in
the app and privilege outside it. **Consequences:** Passwords use hidden stdin,
not argv or direct SQL.

## 14. Full Migration Is An Encrypted Credential Bundle

**Context:** Token continuity needs both SQLite and `APP_MASTER_KEY`.
**Decision:** `.psmbackup` encrypts an authenticated payload with scrypt and
AES-256-GCM. **Why:** One portable file can restore the complete instance.
**Consequences:** The file is as sensitive as credentials and requires a separate
password; DB-only backup still needs the matching key.

## 15. Direct Version Tags From 0.1.8

**Context:** Pre-public 0.1.0-0.1.7 used RC tags. **Decision:** Starting at 0.1.8,
completed releases use annotated unsigned `vX.Y.Z` directly. **Why:** The public
release process has one full gate. **Consequences:** Historical RC tags remain;
no new RC tags or moved public tags.
