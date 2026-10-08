# Private Subscription Manager 0.1.3

单管理员的私人节点资产库、多订阅 Profile 与订阅分发系统。**不是机场**：无普通用户、注册、套餐、支付、订单、流量计费或运营模块。

## 功能

- 六协议 URI 粘贴、批量逐行预览、失败/警告/重复提示、事务导入。
- 全局节点库与 Profile 多对多，pivot 排序；共享节点编辑自动同步。
- 结构化 Drawer、高级 JSON、重新导入差异确认、恢复原始参数。
- original_uri / normalized_config / ordered raw sidecar 分离。
- 随机 Token、SHA-256 lookup、AES-256-GCM 密文保存、轮换/禁用/删除。
- 一个 Profile、一个正式 `/s/<TOKEN>` 通用标准 Base64 URI 订阅链接。
- 中文后台，搜索/筛选、拖拽排序、QR、Light/Dark/System、密码修改。

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
export PUBLIC_BASE_URL=http://localhost:5173
pnpm dev
# Another terminal:
pnpm dev:web
```

使用 Vite 的开发反代时，PUBLIC_BASE_URL 设成浏览器实际访问 origin（例如 http://localhost:5173）。管理员用户名默认 admin。初始化密码只在数据库为空时使用，必须至少20字符。已有数据库启动不需要初始密码。

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
PUBLIC_BASE_URL=https://sub.example.com node scripts/init-env.mjs
```

替换示例为自己的域名。也可以把 `.env.example` 复制到 `.env`，用 `openssl rand -hex 32` 生成 APP_MASTER_KEY、`openssl rand -base64 24` 生成初始密码。`.env` 权限600，不提交。初始化工具不会输出密码；由管理员安全读取本地文件，首次登录后修改。只有一个管理员，用户名默认 admin；首次启动自动执行 migration 并初始化管理员，已有数据库不会重建管理员。

```sh
docker compose build
docker compose up -d
```

Debian 的 legacy Compose 可使用 `docker-compose`。应用端口只发布到127.0.0.1:3000，容器非root、只读根文件系统，数据库持久化到app-data volume。`GET /health` 返回状态与版本。

使用 `docker/Caddyfile` 配置 Caddy，将 `PSM_DOMAIN` 设置为自己的域名（作为 Caddy 服务环境变量），或在配置副本中替换示例域名。开放80/443，域名解析正确后自动取得可信证书。不要原样部署示例域名。没有 access log，并排除可能包含敏感 URL 的代理错误日志。不要开启记录 /s/ 原始 URI 的外部 CDN/WAF/代理日志。

非 Docker 生产运行：`pnpm build`，设置 `APP_MASTER_KEY`、初始化密码、`PUBLIC_BASE_URL`、`COOKIE_SECURE=true`、`DATABASE_PATH`、反代对应的 `TRUST_PROXY`，再 `pnpm start`。使用进程管理器与 HTTPS 反代；Node 不自动读取 `.env`，可用 Node `--env-file` 或系统服务注入环境。数据默认本地 `data/`，Compose 使用持久化 `app-data` volume 下 `/data/app.sqlite`。不要把数据库放在源码归档或公网静态目录。

## 数据、备份、升级

迁移位于 migrations，schema_migrations记录版本；每个migration在事务内执行，失败不启动。已有nodes表时在迁移前执行 SQLite backup。

容器中：

```sh
docker compose exec app node dist/backup.mjs /data/backups/manual.sqlite
```

使用SQLite backup API，不直接复制运行中的WAL数据库。备份同时保护APP_MASTER_KEY：丢失key后数据库Token无法解密复制（可重新轮换）；旧Token哈希lookup仍需要原数据。不要删除volume。升级前备份、保留.env和volume，build并up后验证health和真实订阅。

## 安全

服务器端opaque session，HttpOnly/Secure/SameSite Strict cookie；CSRF、同源、登录/订阅限流、Helmet/CSP、no-referrer、no-store。密码修改撤销所有会话。Token轮换撤销旧URL，但不能撤销客户端已经持有的节点凭据。

未知参数会保留，但客户端可能不认识它们；已知重复query输出由normalized值控制并给出warning。不要公开数据库、管理输出预览、订阅链接和QR。v0.1不抓取远程订阅，避免SSRF。管理列表会向已认证管理员返回节点凭据，不向公网提供。

## License / 对应源码

本项目 AGPL-3.0-only。见 LICENSE 与 THIRD_PARTY_NOTICES.md。网络用户可在 `/source.tar.gz` 获取实际构建所用对应源码（排除secret、数据库与用户节点）。许可证和Sub-Store固定来源必须保留。

## 开发与发布

产品版本来源为 `package.json`。使用 `master` 主线和 annotated RC tags；stable tag 与 remote push 必须用户明确批准。

每轮实际修改版本固定 +0.0.1，十进制进位（0.1.9 → 0.2.0），下一轮为 0.1.4；不能用重复 RC 代替任务版本递增。

```sh
pnpm release:check
pnpm release:check --full
```

详见 [发布流程](docs/RELEASE_PROCESS.md) 和 [发布清单](docs/RELEASE_CHECKLIST.md)。一键 gate 包括秘密扫描、frozen install、质量检查及安全源码包；full 增加干净 checkout、无缓存 Docker 构建与隔离持久化验证。

`pnpm source:archive` 按 Git 来源清单生成安全、确定性的源码包，`pnpm source:verify` 验证内容。源码清单在 stage 新文件后用 `pnpm source:manifest` 更新并提交。正常构建只依赖已提交 vendor，不需要额外 upstream 仓库；仅更新 adapter 时设置 `SUB_STORE_SOURCE`。
