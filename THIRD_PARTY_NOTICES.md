# Third-party notices and provenance

## Sub-Store

- Repository: https://github.com/sub-store-org/Sub-Store
- Fixed commit: `a3e61061e50b40e5c5938969aab915d05d8d7069` (2.42.3)
- License: GNU Affero General Public License v3.0; preserved in `vendor/sub-store/LICENSE`.
- Authors/attribution: Sub-Store contributors; package metadata credits Peng-YM. Original comments/headers are retained. See upstream history for the complete contributor record. These files are not our original work.
- Copied closure: `backend/src/core/proxy-utils/parsers/` (including Peggy grammars), `preprocessors/`, `producers/{uri,shadowrocket,utils}.js`, `{transport-path,xhttp-utils,ech-utils,vmess-security}.js`, `backend/src/utils/{index,yaml}.js`.
- Extracted from `backend/src/core/proxy-utils/index.js`: `formatTransportPath`, `lastParse` normalizer. Added dependency imports and a Node X509Certificate fingerprint adapter in place of jsrsasign. Local CA-file access is disabled by the runtime shim. The rest of the copied files are unchanged.
- Build adaptation: `@/core/app` resolves to a local silent diagnostic shim. No Sub-Store HTTP server, downloader, processor/script runtime, geo database or remote fetching is included. Diagnostics never include the original upstream message, URI or credentials.
- Application adaptation: a typed envelope validates normalized fields; ordered raw query entries and VMess extra fields are preserved. Known fields take precedence. Public Shadowrocket and V2Ray subscriptions share a standard Base64 URI feed. The native structured Shadowrocket producer remains available as an explicitly named internal adapter, never as the public Subscribe URL response.
- Reproduction: `pnpm adapter:build` uses the committed vendored sources. `pnpm vendor` refreshes them only from the exact audited commit and requires the local upstream path (or SUB_STORE_SOURCE).

## UI

XBoard was a visual/interaction reference only. No XBoard admin bundle, dist, component source, icons or assets were copied. This UI uses React, Radix Dialog, Tailwind, lucide-react and dnd-kit under their respective package licenses.

## Dependencies

Lockfile pins the actual dependency graph. Express, Helmet, express-rate-limit, cookie-parser, argon2, Zod, React, Radix, dnd-kit, qrcode, js-base64, JSON5, lodash, ip-address, yaml, Peggy and build/test tools retain their package licenses in node_modules. The Docker image includes those license files with dependencies. Corresponding application and vendor source is available at `/source.tar.gz` for all network users; an administrator can also obtain the complete local Git repository.
