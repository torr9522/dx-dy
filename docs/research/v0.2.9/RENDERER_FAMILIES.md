# Renderer Families

The implementation has three shared families and eight client profiles:
Generic/Base64 (generic, v2rayn), Mihomo/YAML (clash-verge, flclash,
clash-nyanpasu, clash-party, mihomo), sing-box/JSON (singbox).
No client has a duplicate renderer implementation.

Pipeline: ordered Subscription entries → normalized envelopes → capability
checks → deterministic display names → shared producer → response and diagnostics.
Renderers never reparse original_uri. Database envelopes retain original URI,
unknown/private sidecars, parser identity and warnings.

Legacy /s/:token ignores UA and preserves its established serializer. The
new /smart/:token uses exact evidenced defaults for v2rayN, Clash Verge Rev,
FlClash and Clash Party. Other UA, including multi-core Hiddify identities,
falls back to Generic. /client/:profile/:token ignores UA. All routes share
one existing Subscription/token; no shadow subscriptions are created.

Structured producers are unchanged Sub-Store AGPL source from the existing
pinned commit a3e61061e50b40e5c5938969aab915d05d8d7069, not current upstream.
See THIRD_PARTY_NOTICES.md and vendor provenance. Input acceptance is not proof
of output fidelity: capability allowlists reject unknown and unverified owned
options, unsupported transport/flow and nested fields. Producer warnings also
reject the node. LOSSY is never silently emitted.

A nonempty compatible subset returns 200 plus total/rendered/skipped/lossy
headers; zero compatible nodes returns 422. Authenticated preview exposes
node ID, source, name and sanitized reason, never parameter values or tokens
inside diagnostics. Cross-group duplicates retain saved order. Structured
display names use Group name and stable record identity to resolve collisions;
persisted names are untouched.

Tokenized routes use private/no-store. Smart adds Vary: User-Agent. Caddy
single/dual templates permit the new routes and exclude tokenized feeds from
compression. No CDN/shared cache or remote conversion service is introduced.

QR/deep links, Surge and real desktop-client runtime testing are outside the
implemented renderer set. Real core parser checks are separate validation
evidence and must not be described as real frontend acceptance.
