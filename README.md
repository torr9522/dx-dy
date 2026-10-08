# Private Subscription Manager 0.1.7

单管理员的私人节点资产库、多订阅 Profile 与订阅分发系统。**不是机场**：无普通用户、注册、套餐、支付、订单、流量计费或运营模块。

## 功能

- 六协议 URI 粘贴、批量逐行预览、失败/警告/重复提示、事务导入。
- 全局节点库与 Profile 多对多，pivot 排序；共享节点编辑自动同步。
- Node Collections 多对多管理导航；集合用于人员/节点池归类，Tag 用于属性筛选，集合绝不是订阅权限或自动分发规则。
- 结构化 Drawer、高级 JSON、重新导入差异确认、恢复原始参数。
- original_uri / normalized_config / ordered raw sidecar 分离。
- 随机 Token、SHA-256 lookup、AES-256-GCM 密文保存、轮换/禁用/删除。
- 一个 Profile、一个正式 `/s/<TOKEN>` 通用标准 Base64 URI 订阅链接。
- 中文后台，搜索/筛选、拖拽排序、QR、Light/Dark/System、密码修改。
- WAL-safe 可迁移数据库快照、加密单文件实例迁移包、前向 migration 与新 schema 拒绝保护。
- 管理域和订阅域分离；订阅专用 Host 不暴露后台，管理域保留旧 `/s/*` 链接兼容。

### 节点库与节点集合

“全部节点”是 Global Node Library / Master Pool：每个节点只在这里保存一份。“节点集合”是从 Master Pool 中挑选出的管理视图，一个节点可以同时属于多个集合。管理员可在集合中搜索、按协议或 Tag 筛选并批量添加/移除节点，也可在全部节点中批量管理集合关联。

节点列表顶部的“全选当前结果”只选择当前 search/filter/source 匹配的可选节点；再次点击只取消这些当前结果。切换搜索、协议、Tag、状态或订阅候选来源时，先前选择会保留并持续显示总数。可随时查看或搜索全部已选节点、单个取消或清空选择；桌面端支持 Shift 连选当前可见范围，移动端可完整使用总选框和批量操作栏。选择状态仅存在于当前浏览器编辑会话，不写入数据库。

Collection 不是 Subscription，也不是访问权限或自动分发规则。集合只帮助缩小订阅编辑器中的候选范围；切换来源不会清除已选择节点，保存订阅时仍然只写入 `subscription_nodes`。向集合添加节点、从集合移除节点、重命名或删除集合，都不会改变任何已有订阅。

### Subscription 重复连接语义

Global Node Library 与 Collection 允许保留连接配置相同的多个 Node，系统不会自动合并或删除它们。Subscription selector 使用后端提供的 opaque semantic key 阻止新重复项；手动选择、全选当前结果、Shift 连选和跨 Collection 来源选择都会跳过已经选中的相同连接语义。名称相同但连接参数不同的节点仍可同时选择，名称不同但连接语义相同的节点会被视为重复。

判定以当前 Node → share URI renderer 为事实来源。VLESS、Trojan、Shadowsocks、Hysteria2 与 TUIC 只排除 URI fragment；VMess 只排除 JSON `ps`，其余连接字段、未知/私有参数、重复 query 及顺序均保留。无法安全判定的节点采用保守的单节点 fallback，不会因为名称、地址或部分字段相同而被抑制。

历史 `subscription_nodes` 重复关系不会自动清理。管理页会保留并标记全部显式关系，保存时要求管理员手工取消冲突；public Universal Base64、raw 调试输出与 legacy alias 则统一按 `subscription_nodes.position` 保留第一个连接语义并抑制后续重复。Preview 分别显示显式选择数、实际输出数和重复抑制数。Collection 变更继续不会自动影响 Subscription。

## 协议与客户端

VLESS (TLS/Reality/Vision/TCP/WS/gRPC/HTTPUpgrade/XHTTP)、VMess legacy JSON、Trojan、SS SIP002、Hysteria2、TUIC v5。固定 Sub-Store 源码提供 parser/producer。未知 query 保存原始编码与重复项；已知字段以当前结构化值为准。

目标客户端 Shadowrocket、v2rayN、v2rayNG，以及支持标准 Base64 URI Subscription 的客户端。服务器格式支持已验证；Shadowrocket 真机验收已由用户确认通过。正式 URL 只有 `/s/<TOKEN>`：当前 normalized 配置 + unknown sidecar 生成 URI，按授权 position 排序、LF 拼接、UTF-8 整体标准 Base64；不随 UA、Accept 或旧默认格式设置变化。空订阅返回空文本。旧 `?format=v2ray`、`?format=shadowrocket`、`?format=auto` 不重定向，返回相同 body。`?format=raw` 仅作开发调试，不是主 UI 入口。订阅列表快捷操作依次为复制订阅、二维码、删除订阅；详情页保留预览。两处共用链接、二维码及删除确认逻辑，删除 Profile 和关联关系不会删除全局节点。管理预览显示节点顺序/协议/名称，高级区域可查看解码 URI（含凭据）。

Sub-Store structured Shadowrocket producer 仅保留内部用途，不用于公网订阅响应。没有 Clash rules、策略组、DNS 模板，不安装 Xray Core。详见 [订阅格式契约与兼容证据](docs/SUBSCRIPTION_FORMAT.md)。

## 技术栈

Node 26.10.0、TypeScript strict、Express、React、Tailwind、Radix、SQLite (WAL/foreign_keys)、Sub-Store adapter。Node 标准库负责随机数、AES-GCM、Base64 和 SQLite；Argon2id 保存管理员密码。

## 本地开发

```sh
# Node 26.10.0 and pnpm 12.6.0 are required (packageManager is pinned).
pnpm install --frozen-lockfile
pnpm adapter:build
export APP_MASTER_KEY=$(openssl rand -hex 32)
export ADMIN_INITIAL_PASSWORD=$(openssl rand -base64 24)
export ADMIN_BASE_URL=http://localhost:5173
export SUBSCRIPTION_BASE_URL=http://localhost:5173
pnpm dev
# Another terminal:
pnpm dev:web
```

使用 Vite 的开发反代时，两个 URL 可设成浏览器实际访问 origin（例如 `http://localhost:5173`）。管理员用户名默认 admin。初始化密码只在数据库为空时使用，必须至少20字符。已有数据库启动不需要初始密码。

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

E2E 使用隔离的本地测试数据库与虚构凭据，需要 Playwright Chromium。node_modules、数据库、环境、测试输出都忽略。

## Docker Compose

在源码根目录生成 `.env`（不会覆盖现有文件）：

```sh
ADMIN_BASE_URL=https://panel.example.com \
SUBSCRIPTION_BASE_URL=https://sub.example.com \
node scripts/init-env.mjs
```

替换示例为自己的域名。也可以把 `.env.example` 复制到 `.env`，用 `openssl rand -hex 32` 生成 APP_MASTER_KEY、`openssl rand -base64 24` 生成初始密码。`.env` 权限600，不提交。初始化工具不会输出密码；由管理员安全读取本地文件，首次登录后修改。只有一个管理员，用户名默认 admin；首次启动自动执行 migration 并初始化管理员，已有数据库不会重建管理员。

```sh
docker compose build
docker compose up -d
```

Debian 的 legacy Compose 可使用 `docker-compose`。应用端口只发布到127.0.0.1:3000，容器非root、只读根文件系统，数据库持久化到app-data volume。`GET /health` 返回状态与版本。

使用 `docker/Caddyfile` 配置 Caddy：`PSM_ADMIN_DOMAIN` 指向后台域名，`PSM_SUBSCRIPTION_DOMAIN` 指向订阅域名。订阅 Host 仅开放 `/s/*` 和 `/health`；后台 Host 继续开放 `/s/*`，用于旧客户端链接兼容。开放80/443，DNS 正确后 Caddy 自动取得可信证书。单域兼容部署应改用一个站点块反代全部路由，且两个应用 URL 使用相同 origin。不要开启记录 `/s/` 原始 URI 的代理、CDN 或 WAF access log。

非 Docker 生产运行：`pnpm build`，设置 `APP_MASTER_KEY`、初始化密码、`ADMIN_BASE_URL`、首次订阅域名 `SUBSCRIPTION_BASE_URL`、`COOKIE_SECURE=true`、`DATABASE_PATH` 与 `TRUST_PROXY`，再 `pnpm start`。正式数据库路径统一为 `/data/private-subscription-manager.db`，Compose 使用持久化 `app-data` volume。不要把数据库放在源码归档或公网静态目录。

`ADMIN_BASE_URL` 始终由部署环境控制。`SUBSCRIPTION_BASE_URL` 只在数据库尚无该设置时作为 bootstrap default；初始化后数据库中的 `subscription_base_url` 是运行时唯一真相，管理员可在“设置 → 订阅域名”修改，不需重新构建或重启。输入仅允许 HTTPS origin（开发环境可用 localhost HTTP），系统负责追加 `/s/<TOKEN>`。换服务器而不换订阅域名时不要修改此设置，只切 DNS；主动换域名时系统保留旧订阅 Host 的 `/s/*` 兼容记录，但旧 DNS/TLS/代理仍需继续运行一段过渡期。

## 数据、备份、升级

迁移位于 `migrations/`，`schema_migrations` 记录有序版本；migration 在事务内执行，失败回滚并阻止启动。迁移前自动用 SQLite Backup API 创建一致性快照。数据库包含未知或更高 migration 时明确拒绝启动，不自动降级。

容器中：

```sh
docker compose exec app node dist/database.mjs backup /data/backups/manual.db
```

这会从在线 WAL 数据库生成单文件一致性 SQLite 快照，并清除 active admin sessions。数据库备份不包含 `APP_MASTER_KEY`；恢复时必须提供匹配的 key，否则加密 Token 无法继续使用。

跨服务器迁移使用受密码保护的单文件包：

```sh
BACKUP_PASSWORD='use-a-long-backup-password' \
pnpm migration:export -- ./private-subscription-manager-0.1.7.psmbackup

# 停止应用写入后恢复；工具会校验、备份当前 DB、前向迁移、清除会话并原子替换。
BACKUP_PASSWORD='use-a-long-backup-password' \
INSTANCE_ENV_FILE=.env \
pnpm db:restore -- ./private-subscription-manager-0.1.7.psmbackup
```

`.psmbackup` 使用 scrypt 和 AES-256-GCM 加密，内含数据库与 instance master key；它等价于完整账户凭证，必须像私钥一样保存。不要复制在线 `.db`、`-wal` 或 `-shm` 文件。完整备份、恢复、Docker volume 操作、schema 兼容与 DNS 无感迁移步骤见 [数据库与实例迁移](docs/DATABASE_MIGRATION.md)。

## 安全

服务器端opaque session，HttpOnly/Secure/SameSite Strict cookie；CSRF、同源、登录/订阅限流、Helmet/CSP、no-referrer、no-store。密码修改撤销所有会话。Token轮换撤销旧URL，但不能撤销客户端已经持有的节点凭据。

未知参数会保留，但客户端可能不认识它们；已知重复query输出由normalized值控制并给出warning。不要公开数据库、管理输出预览、订阅链接和QR。v0.1不抓取远程订阅，避免SSRF。管理列表会向已认证管理员返回节点凭据，不向公网提供。

## License / 对应源码

本项目 AGPL-3.0-only。见 LICENSE 与 THIRD_PARTY_NOTICES.md。网络用户可在 `/source.tar.gz` 获取实际构建所用对应源码（排除secret、数据库与用户节点）。许可证和Sub-Store固定来源必须保留。

## 开发与发布

产品版本来源为 `package.json`。使用 `master` 主线和 annotated RC tags；stable tag 与 remote push 必须用户明确批准。

每轮实际修改版本固定 +0.0.1，十进制进位（0.1.9 → 0.2.0），下一轮为 0.1.8；不能用重复 RC 代替任务版本递增。

```sh
pnpm release:check
pnpm release:check --full
```

详见 [发布流程](docs/RELEASE_PROCESS.md) 和 [发布清单](docs/RELEASE_CHECKLIST.md)。一键 gate 包括秘密扫描、frozen install、质量检查及安全源码包；full 增加干净 checkout、无缓存 Docker 构建与隔离持久化验证。

`pnpm source:archive` 按 Git 来源清单生成安全、确定性的源码包，`pnpm source:verify` 验证内容。源码清单在 stage 新文件后用 `pnpm source:manifest` 更新并提交。正常构建只依赖已提交 vendor，不需要额外 upstream 仓库；仅更新 adapter 时设置 `SUB_STORE_SOURCE`。
