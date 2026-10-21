# Panel Comparison

Snapshot: 2026-10-21. Dates below are inspected HEAD commit dates. A recent
repository push alone is not meaningful source activity. No panel code copied.

| Project / lineage | Repository, branch, exact commit                                       | License / HEAD date   | Endpoint / source / renderer and fallback                                                                                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3x-ui             | MHSanaei/3x-ui, main, a8d0700bf2ed06d77c077fc45fc0387d9abdbaab         | GPL-3.0 / 2026-10-17  | Subscription server/settings expose raw/JSON/Clash views and configurable client patterns; explicit settings are preferable to copying broad heuristics.                                                                                                        |
| s-ui              | alireza0/s-ui, main, 0160e451e5c1d270da01de495d57a70eeb1f02eb          | GPL-3.0 / 2026-10-21  | sub/subHandler.go GET/HEAD /:subid; explicit format=json or clash; absent format uses SubService URI subscription; invalid explicit format fails400. jsonService.go and clashService.go share data, linkService.go has deterministic unique names.              |
| Marzban           | Gozargah/Marzban, master, 7f396db3e703d71a28060bc9ce4a532ec64cb1f4     | AGPL-3.0 / 2025-01-09 | app/routers/subscription.py uses ordered UA regexes for clash-meta, clash and sing-box; app/subscription/share.py generation; legacy formats coexist. Snapshot source is older than repository push activity.                                                   |
| XBoard            | cedar2025/Xboard, master, 4f48e61a2cbc6db5338872b6bdb45ef954ec1256     | MIT / 2026-08-30      | app/Http/Controllers/V1/Client/ClientController.php subscribe/doSubscribe selects protocols.manager from client flag with General fallback; app/Protocols provides family outputs; request types/filter are independent. Active V2Board lineage representative. |
| V2Board           | v2board/v2board, master, 0ca47622a50116d0ddd7ffb316b157afb57d25e8      | MIT / 2023-06-04      | Historical family reference; not evidence of current client compatibility. XBoard inspected separately rather than cloning duplicate forks.                                                                                                                     |
| SSPanel-UIM       | Anankke/SSPanel-Uim, master, c2ab3003cc4bf70237eb6ae82b3c65f31fb1f051  | MIT / 2026-09-11      | app/routes.php, src/Controllers/SubController.php, Services/Subscribe.php; /sub/{token}/{subtype} explicit subtype selection; observed V2Ray path emits VMess lines.                                                                                            |
| Remnawave         | remnawave/panel, main, 79a7542f5929734a67b8bfb5c381261aff0d9584        | AGPL-3.0 / 2026-09-12 | Template/UA-dependent Mihomo, Stash, Xray JSON, sing-box and Clash views; account/token stays shared; fallback should be deliberate.                                                                                                                            |
| Hiddify Manager   | hiddify/Hiddify-Manager, dev, 00982c406529ddadd45563a56be7cee4f1211e2f | GPL-3.0 / 2026-10-20  | Multi-client subscription/conversion code; manager is distinct from desktop app. A shared backend does not establish frontend parser behavior.                                                                                                                  |

URLs are https://github.com/ followed by the listed repository coordinate.
Each representative is cloned outside dx-dy. The family selection avoids
redundant forks; s-ui and current XBoard provide distinct explicit-format
implementations worth inspecting in addition to older families.

Common architecture: one subscription/account identity, multiple output views,
explicit target precedence, shared family producers, and deliberate unknown-UA
fallback. dx-dy adopts that structure without sales, accounts, billing or remote
conversion. Caching upstream fetched templates in panels/converters is not a
reason to cache private tokenized responses; dx-dy retains private/no-store.
No issue-specific patch or panel source is reused.
