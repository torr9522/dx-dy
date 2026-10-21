# Desktop Client Matrix

Source snapshot: 2026-10-21. This records source contracts, not real desktop
application acceptance. User-configured UA overrides can always cause Generic
fallback. Deep links and QR are research-only; no product changes are included.

| Client                             | Platforms              | Repository and exact commit                                                | Subscription request / parser evidence                                                                                                                                                                            | Preferred / fallback               | Auto / explicit |
| ---------------------------------- | ---------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | --------------- |
| v2rayN                             | Windows, desktop ports | 2dust/v2rayN @ 57f17d5939e88c8e643ab49b90869d637765e75a                    | v2rayN/ServiceLib/Services/DownloadService.cs defaults to Utils.GetVersion(false); Common/Utils.cs and Global.cs yield v2rayN/version; custom UA supported; Handler/SubscriptionHandler.cs handles refresh/import | Generic URI/Base64 / Generic       | YES / YES       |
| Clash Verge Rev                    | Windows/macOS/Linux    | clash-verge-rev/clash-verge-rev @ 5e6a696087a5c855f5fd1ab51f4a3f4c6451afc3 | src-tauri/src/utils/network.rs defaults clash-verge/vVERSION; config/prfitem.rs downloads and parses YAML; custom UA supported                                                                                    | Mihomo YAML / explicit Mihomo link | YES / YES       |
| FlClash                            | desktop/mobile         | FurryR/FlClash @ 143ca1dfabb7e39524d294549498f3abcf15637d                  | lib/common/package.dart: FlClash/vVERSION clash-verge Platform/OS; state.dart override; common/request.dart uses that UA; models/profile.dart invokes clashCore.validateConfig                                    | Mihomo YAML / explicit Mihomo link | YES / YES       |
| Clash Party (Mihomo Party lineage) | Windows/macOS/Linux    | mihomo-party-org/clash-party @ 0ad0acf8b55599cdf9d891dfa469deb53a3a9e84    | src/main/config/profile.ts defaults mihomo.party/vVERSION (clash.meta); item/global custom UA overrides                                                                                                           | Mihomo YAML / explicit Mihomo link | YES / YES       |
| Clash Nyanpasu                     | Windows/macOS/Linux    | libnyanpasu/clash-nyanpasu @ 28b875955f8e3206572d0a47c3afeb3c26789487      | backend/nyanpasu-config/src/profile/source.rs optional configurable UA; updater UA is not profile UA evidence                                                                                                     | Mihomo YAML / explicit Mihomo link | NO / YES        |
| Hiddify App                        | Windows/macOS/Linux    | hiddify/hiddify-app @ f26aadb351fb23c222e06fcf4f5350d0ba596bb9             | lib/core/model/app_info_entity.dart: HiddifyNext/VERSION (OS) like ClashMeta v2ray sing-box; profile_parser.dart changes prefix for Xray mode; multi-core identity is ambiguous                                   | No dedicated profile frozen        | NO / NO         |
| Throne                             | Windows/macOS/Linux    | throneproj/Throne @ 72c70df49ffdf62acae65d7e732d7c154b4d1659               | src/database/SettingsRepo.cpp defaults Throne/VERSION; configs/sub/GroupUpdater.cpp permits per-group override; HTTPRequestHelper.cpp sets UA; native format acceptance still requires dedicated verification     | No dedicated profile frozen        | NO / NO         |
| NekoRay                            | historical desktop     | MatsuriDayo/nekoray                                                        | Archived; superseded Neko-family implementation, not current active support                                                                                                                                       | Historical only                    | NO / NO         |
| Mihomo core                        | core                   | MetaCubeX/mihomo @ 008b91bfe8c0e2daca0ab69061efd9ea1ad71bd2                | Config parser is YAML; core does not establish frontend subscription UA                                                                                                                                           | Mihomo YAML                        | NO / YES        |
| sing-box core                      | core/frontends         | SagerNet/sing-box @ dfb80349bf5779ec0a3f834c9ec2794345bff8f0               | JSON configuration parser; frontend refresh/provider semantics are not a universal UA contract                                                                                                                    | sing-box JSON                      | NO / YES        |

No special Accept-header inference is enabled. Unknown, empty, ambiguous or
custom UA returns Generic. HTTP redirect/refresh behavior remains client-owned;
dx-dy serves direct HTTP representations without redirect or remote providers.
No new deep-link/QR handler is implemented.

| Capability                                | Generic                   | Mihomo                                    | sing-box                                  |
| ----------------------------------------- | ------------------------- | ----------------------------------------- | ----------------------------------------- |
| VLESS / VMess / Trojan / SS / HY2 / TUIC  | Existing lossless adapter | Shared producer, per-node capability gate | Shared producer, per-node capability gate |
| SS2022                                    | URI preserved             | Requires valid cipher/key contract tests  | Requires valid method/key contract tests  |
| REALITY / Vision                          | Preserved                 | Basic modeled fields only                 | Basic modeled fields only                 |
| IPv6 / WS / gRPC / HTTPUpgrade            | Preserved                 | Modeled fields tested                     | Modeled fields tested                     |
| XHTTP                                     | Preserved                 | Basic modeled subset                      | Unsupported                               |
| Unknown/private params, unverified extras | Preserved                 | LOSSY; skipped                            | LOSSY; skipped                            |

These are bounded supported subsets, not a promise that every client/core
version accepts every combination. Custom fingerprint/transport variants require
a diagnostic until proven. Actual desktop apps have not been launched.
