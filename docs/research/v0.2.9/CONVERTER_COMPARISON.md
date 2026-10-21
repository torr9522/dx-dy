# Converter Comparison

Snapshot: 2026-10-21. No remote converter is used at runtime.

| Project                    | Repository, branch, exact commit                                          | License/activity             | Source and findings                                                                                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sub-Store                  | sub-store-org/Sub-Store, master, 1f0318bc6feb46fbe204836f32ca7acab37ea67e | AGPL-3.0, active 2026-10-21  | backend/src/utils/user-agent.js and restful/download.js: explicit platform/target precedes broad UA/Accept heuristics; unknown V2Ray fallback. Producers centralize families, with warning/filtering behavior needing application-level diagnostics. |
| subconverter               | tindy2013/subconverter, master, a0d4eab28cb8b6c782d4ce5c3a918de4829b4a72  | GPL-3.0, activity 2026-07-09 | src/handler/interfaces.cpp, parser/, generator/config/: explicit target pipeline; parsing and conversion are distinct; template/provider and fetch cache do not belong in private tokenized response caches.                                         |
| subconverter-ng            | Jungley8/subconverter-ng, main, 994cfc5ce05417aa94a1fa6376a537bc3a505d74  | GPL-3.0, active 2026-10-18   | Modern Go implementation; internal/server/server.go /sub?target=...; internal/generator/{clash,singbox}.go; internal/fetch/fetch.go caches upstream fetches, cache tests cover nocache override. Research only.                                      |
| Panel-integrated producers | See PANEL_COMPARISON.md                                                   | Various                      | s-ui JsonService/ClashService and XBoard Protocols implement explicit family conversion; do not assume the original URI semantics all survive every family.                                                                                          |

Implementation reuse is limited to two unchanged Sub-Store producer modules
from the already audited pinned commit a3e61061e50b40e5c5938969aab915d05d8d7069.
All licenses/attribution remain preserved; no GPL client or custom-license app
code was copied.

Conversion hazards audited: REALITY/Vision, WS/gRPC/HTTPUpgrade/XHTTP, IPv6,
SS2022, HY2/TUIC options, unknown/private sidecars, and name collisions. A
parser-owned option can still be ignored by a producer. Capability checking
therefore runs before conversion and rejects unverified options instead of
silently downgrading. Stable output aliases preserve distinct cross-group
records without mutating their persisted names.

Upstream source paths above are reproducible evidence. Issues/docs are
supplementary; no unverified issue workaround is incorporated. Current
research commits do not replace the application's pinned parser identity.
