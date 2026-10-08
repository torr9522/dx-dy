# dx-dy 0.1.9

Private Node & Subscription Manager

dx-dy 是面向个人和小范围自用的轻量级自托管节点库与通用订阅管理器。它是单管理员工具，不是机场、销售、计费或用户注册系统。

## 功能

- Global Node Library、Node Collections 与可排序 Subscription Profiles
- VLESS、VMess、Trojan、Shadowsocks、Hysteria2 和 TUIC URI 兼容
- Universal Base64 subscription 与连接语义重复保护
- Portable SQLite backup 与加密 Full Migration backup
- 单域或后台/订阅双域部署
- Native systemd service、Caddy 自动 HTTPS 与 `dx-dy` SSH 管理

Global Node Library 和 Collections 可以保留连接配置相同的节点；同一个 Subscription 只分发一次相同连接语义。判断基于当前 share URI 的连接语义，不按名称或 Node ID 判断。Collections 不会自动同步到 Subscription。

## 一键原生安装

```bash
bash <(curl -fsSL https://github.com/torr9522/dx-dy/releases/latest/download/install.sh)
```

要求：root、已指向服务器的域名、Debian 12 或 Ubuntu 22.04/24.04，以及 amd64 或 arm64。安装器按架构下载校验过的 GitHub Release artifact，内含固定 Node.js runtime；服务器不需要预装 Node.js、npm、pnpm、Docker、Docker Compose、containerd 或 Caddy。

安装器会安装宿主 Caddy，询问管理域名、可选独立订阅域名和管理员凭据，然后创建：

```text
/opt/dx-dy/releases/0.1.9/
/opt/dx-dy/current -> releases/0.1.9
/etc/dx-dy/
/var/lib/dx-dy/dx-dy.db
/var/backups/dx-dy/
/etc/systemd/system/dx-dy.service
/usr/local/bin/dx-dy
```

应用以无登录权限的 `dx-dy` 系统用户运行，只监听 `127.0.0.1`。Caddy 管理 80/443、ACME、续期和反向代理。若宿主已有 Caddy 配置，安装器备份主配置并只增加独立的 dx-dy import，不覆盖其它站点。

## SSH 管理

```bash
dx-dy status
dx-dy restart
dx-dy update
dx-dy doctor
dx-dy backup db
dx-dy backup full
dx-dy logs app 200
```

`dx-dy admin reset-password` 通过隐藏 stdin 调用应用 CLI，不把密码放进 argv 或日志。更新从 GitHub Release 选择当前架构 artifact，校验 SHA-256，做 WAL-safe backup，安装到新版本目录并原子切换 `current`；启动或健康检查失败时恢复数据库和旧链接。

## 域名、备份与迁移

单域模式提供管理 UI/API、`/s/*`、`/health` 和 AGPL source endpoint。双域订阅 Host 只开放 `/s/*` 与 `/health`；其它路径返回 404。基础设施域名通过 `dx-dy domain` 修改。

`dx-dy backup db` 创建 WAL-safe portable SQLite backup。`dx-dy backup full` 创建以 scrypt + AES-256-GCM 保护数据库和 `APP_MASTER_KEY` 的 `.psmbackup`。0.1.9 保持 0.1.8 数据库、Token、订阅和备份格式兼容。

检测到 0.1.8 Docker 安装时，0.1.9 installer 进入显式迁移模式：先创建 portable/full backups，保留旧 Compose 栈和 image，停止旧 app/Caddy 后启动 native services；失败会恢复旧栈。成功后也不会自动卸载 Docker，只有 `dx-dy cleanup-legacy` 会在再次确认后清理旧 dx-dy containers。

## Docker 历史模型

Docker/Compose/GHCR 从 0.1.9 起不再是终端用户安装或运行依赖。0.1.8 的历史部署说明保留在 [docs/legacy/DOCKER_0.1.8.md](docs/legacy/DOCKER_0.1.8.md)，不要用于新安装。

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

开发环境固定版本见 `package.json`。原生 release builder 会为 amd64/arm64 分别解析生产依赖并打包 Node `26.10.0`。唯一运行时原生 addon 是 Argon2 的架构对应 glibc prebuild；SQLite 使用 `node:sqlite`。

## 项目知识

新开发者与 coding agent 先阅读 [AGENTS.md](AGENTS.md)、[docs/README.md](docs/README.md) 和 [docs/CURRENT_BASELINE.md](docs/CURRENT_BASELINE.md)。

## License 与来源

dx-dy 使用 AGPL-3.0-only。网络用户可从 `/source.tar.gz` 获取对应源码。Sub-Store adapter 固定到 `a3e61061e50b40e5c5938969aab915d05d8d7069`；见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
