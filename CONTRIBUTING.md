# Contributing

Use synthetic fixtures only. Never commit a real node URI, Token, password, domain, IP, database, backup, `.env`, log or instance key.

Before proposing a change, run `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`. Runtime, frontend and API changes also require `pnpm test:e2e`. Installer or manager changes require ShellCheck and the operations tests.

Preserve the AGPL license and Sub-Store provenance. Do not alter released migrations or subscription output semantics without focused compatibility tests. GitHub Actions build and publish artifacts only; server deployment is always an explicit administrator operation.
