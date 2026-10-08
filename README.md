# dx-dy 0.1.8

Private Node & Subscription Manager

dx-dy 是面向个人和小范围自用的轻量级自托管节点库与通用订阅管理器。它是单管理员工具，不是机场、销售、计费或用户注册系统。

## 功能

- Global Node Library 与 Node Collections
- 可排序的 Subscription Profiles 与连接语义重复保护
- Shadowrocket、v2rayN、v2rayNG 共用 Universal Base64 订阅
- Portable SQLite backup 与加密 Full Migration backup
- 单域或后台/订阅双域部署
- Docker + Caddy 自动 HTTPS
- SSH 管理入口 `dx-dy`

Global Node Library 和 Collections 可以保留连接配置相同的节点；同一个 Subscription 只分发一次相同连接语义。判断基于当前 share URI 的连接语义，不按名称或 Node ID 判断。历史重复关系不会被自动删除。

## 一键安装

公开 Release 中的 `install.sh` 是普通用户的安装入口；本 README 中的命令始终指向正式仓库坐标和校验过的 Release 资产。

安装器支持 Debian 12、Ubuntu 22.04/24.04 LTS，以及 amd64 和 arm64。它负责安装 Docker Engine、Docker Compose plugin、`curl`、证书、DNS 和必要系统工具；宿主机不需要 Node.js、pnpm、npm 或 Caddy binary。

安装流程会询问管理后台域名、是否使用独立订阅域名、管理员用户名和隐藏密码。密码留空时会生成强随机密码并只显示一次。应用密钥不会输出。

从已审核的本地源码测试安装器：

```bash
sudo DXDY_ASSET_DIR="$PWD" DXDY_IMAGE_REFERENCE='verified-image@sha256:verified-digest' ./install.sh
```

这条命令是高级本地验证入口，不是公开 Release 安装命令。

## SSH 管理

安装后执行 `dx-dy` 进入菜单。常用非交互命令：

```bash
dx-dy status
dx-dy restart
dx-dy update
dx-dy doctor
dx-dy backup db
dx-dy backup full
dx-dy logs app 200
```

管理员忘记密码时使用 `dx-dy admin reset-password`。密码通过隐藏 stdin 输入，不进入 argv 或 shell history；成功后所有管理员会话立即失效。

## 域名与 HTTPS

新安装使用 Caddy 容器监听 80/443 并自动申请、续期证书。单域模式在同一 Host 提供管理界面、API、`/s/*`、`/health` 和 AGPL source endpoint。双域模式下订阅 Host 只开放 `/s/*` 与 `/health`，其它路径返回 404；后台 Host 保留旧同域订阅链接兼容。

基础设施域名应通过 root SSH 执行 `dx-dy domain` 修改。Web 设置中的 Subscription Domain 只修改 canonical subscription URL，不能安全地修改 Caddy 或证书配置。应用容器不挂载 Docker socket、不使用 privileged，也不能写宿主 Caddy 配置。

## Backup 与 Migration

`dx-dy backup db` 创建 WAL-safe portable SQLite backup，不含活动管理员会话。`dx-dy backup full` 创建 `.psmbackup`，以 scrypt + AES-256-GCM 保护数据库与 `APP_MASTER_KEY`。

Full Migration backup 等价于完整实例凭证，必须像私钥一样保管。恢复继续兼容历史 `.psmbackup` 文件与旧文件名。

## 高级 Docker 部署

公开模板位于 `deploy/docker-compose.yml`、`deploy/Caddyfile.single` 和 `deploy/Caddyfile.dual`。模板不含实例域名、密码、Token、数据库或密钥。安装器生成 `/opt/dx-dy`、`/etc/dx-dy`、`/var/lib/dx-dy`、`/var/backups/dx-dy` 和 `/usr/local/bin/dx-dy`。

旧 `/opt/private-subscription-manager` 实例和 `/data/private-subscription-manager.db` 继续受管理器识别；0.1.8 没有数据库 migration 或表名变更。

## 开发与验证

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm release:check --full --public
```

Node 与 pnpm 的固定版本见 `package.json` 和 `Dockerfile`。部署配置必须保存在 Git 之外。

## 项目知识与开发

新开发者先阅读 [AGENTS.md](AGENTS.md) 和
[docs/README.md](docs/README.md)。它们索引当前架构、能力树、版本历史、设计决策、协议兼容、数据库、备份、安全和 Release 流程；不依赖任何私人 AI 会话上下文。

## License 与来源

dx-dy 使用 AGPL-3.0-only。网络用户可从 `/source.tar.gz` 获取与运行版本对应的完整源码。Sub-Store adapter 固定到 `a3e61061e50b40e5c5938969aab915d05d8d7069`；文件范围和修改说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
