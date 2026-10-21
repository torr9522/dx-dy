# v0.2.9 Multi-Client Source Audit

Snapshot: 2026-10-21. Exact source identities are recorded below and in the
linked matrices. Research repositories live outside this product repository.
Repository push timestamps are not proof of meaningful code activity; the
dates below are commit dates at inspected HEAD. Default branches can move.

## Method and license boundary

Inspect representative upstream families, not hundreds of redundant forks.
Read client download/parser code and converter target/producer paths before
freezing a profile. Research is not real application acceptance. The existing
pinned Sub-Store parser remains unchanged. Two unchanged AGPL-compatible
producer modules from that same commit are reused with attribution and file
hash provenance. Other projects are behavioral references only.

Hiddify App's LICENSE is a custom Extended GPLv3 with additional conditions,
including naming/attribution and commercial-use restrictions; no source copied.
sing-box's LICENSE contains GPLv3-or-later plus an additional naming/association
condition; no source copied. SPDX NOASSERTION is not a license conclusion.
Other projects retain their own licenses; see the matrix below.

## Desktop/client source evidence

See [CLIENT_MATRIX.md](CLIENT_MATRIX.md) for exact SHA, UA, parser and format
mapping. Source-proven default identities exist for Clash Verge Rev, FlClash,
Clash Party and v2rayN, each with user-configurable overrides. The detector
matches complete evidenced patterns. It does not search for generic core
keywords inside browser or Hiddify UA. Unknown/ambiguous headers remain Generic.
Clash Nyanpasu receives only an explicit link; its updater UA is not evidence
for subscription requests. Throne is investigated as a current Neko-family
successor but has no frozen dedicated profile. NekoRay is archived.

## Repository license and source identities

| Project         | Repository                                         | Exact SHA                                | Branch     | License                          |
| --------------- | -------------------------------------------------- | ---------------------------------------- | ---------- | -------------------------------- |
| v2rayN          | https://github.com/2dust/v2rayN                    | 57f17d5939e88c8e643ab49b90869d637765e75a | master     | GPL-3.0                          |
| Clash Verge Rev | https://github.com/clash-verge-rev/clash-verge-rev | 5e6a696087a5c855f5fd1ab51f4a3f4c6451afc3 | dev        | GPL-3.0                          |
| FlClash         | https://github.com/FurryR/FlClash                  | 143ca1dfabb7e39524d294549498f3abcf15637d | main       | GPL-3.0                          |
| Clash Party     | https://github.com/mihomo-party-org/clash-party    | 0ad0acf8b55599cdf9d891dfa469deb53a3a9e84 | smart_core | GPL-3.0                          |
| Clash Nyanpasu  | https://github.com/libnyanpasu/clash-nyanpasu      | 28b875955f8e3206572d0a47c3afeb3c26789487 | main       | GPL-3.0                          |
| Hiddify App     | https://github.com/hiddify/hiddify-app             | f26aadb351fb23c222e06fcf4f5350d0ba596bb9 | main       | Custom Extended GPLv3            |
| Throne          | https://github.com/throneproj/Throne               | 72c70df49ffdf62acae65d7e732d7c154b4d1659 | dev        | GPL-3.0                          |
| Mihomo          | https://github.com/MetaCubeX/mihomo                | 008b91bfe8c0e2daca0ab69061efd9ea1ad71bd2 | main       | MIT                              |
| sing-box        | https://github.com/SagerNet/sing-box               | dfb80349bf5779ec0a3f834c9ec2794345bff8f0 | testing    | GPLv3+ with additional condition |
| Sub-Store       | https://github.com/sub-store-org/Sub-Store         | 1f0318bc6feb46fbe204836f32ca7acab37ea67e | master     | AGPL-3.0                         |
| subconverter    | https://github.com/tindy2013/subconverter          | a0d4eab28cb8b6c782d4ce5c3a918de4829b4a72 | master     | GPL-3.0                          |
| subconverter-ng | https://github.com/Jungley8/subconverter-ng        | 994cfc5ce05417aa94a1fa6376a537bc3a505d74 | main       | GPL-3.0                          |

Panel SHAs/licenses/source paths are in [PANEL_COMPARISON.md](PANEL_COMPARISON.md);
converter details in [CONVERTER_COMPARISON.md](CONVERTER_COMPARISON.md).
[RENDERER_FAMILIES.md](RENDERER_FAMILIES.md) records implementation boundaries.
No QR or deep-link product change is included.

## Evidence limits

Current upstream source contracts and released core parsers are separate
evidence. Core config validation does not establish remote-provider import in
every frontend. Only actually executed parser checks may be reported as parser
PASS. No desktop GUI client has been launched. Issues/docs are supplementary;
no speculative issue workaround is shipped.
