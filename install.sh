#!/usr/bin/env bash
set -Eeuo pipefail

readonly DXDY_VERSION="0.2.2"
readonly DXDY_DEFAULT_REPOSITORY="torr9522/dx-dy"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
ROOT_PREFIX="${DXDY_ROOT_PREFIX:-}"
TEST_MODE="${DXDY_TEST_MODE:-0}"
CONFIG_DIR="$ROOT_PREFIX/etc/dx-dy"
INSTALL_ROOT="$ROOT_PREFIX/opt/dx-dy"
DATA_DIR="$ROOT_PREFIX/var/lib/dx-dy"
BACKUP_DIR="$ROOT_PREFIX/var/backups/dx-dy"
MANAGER_PATH="$ROOT_PREFIX/usr/local/bin/dx-dy"
SYSTEMD_DIR="$ROOT_PREFIX/etc/systemd/system"
CADDY_DIR="$ROOT_PREFIX/etc/caddy"
CADDY_IMPORT="$CADDY_DIR/dx-dy.caddy"
STAGING=""
LEGACY_MODE=0
LEGACY_RUNNING=0
REINSTALL_MODE=0
GENERATED_PASSWORD=0
PRESERVED_MASTER_KEY=""
DXDY_REPOSITORY="${DXDY_REPOSITORY:-$DXDY_DEFAULT_REPOSITORY}"

cleanup() { [[ -z "$STAGING" ]] || rm -rf -- "$STAGING"; }
trap cleanup EXIT
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
info() { printf '%s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
usage() {
  cat <<'EOF'
Usage: install.sh [OPTIONS]

Install dx-dy as a native systemd service with host Caddy and SQLite.

Supported OS:
  Debian 12
  Ubuntu 22.04
  Ubuntu 24.04

Supported arch:
  amd64
  arm64

Options:
  -h, --help  Show this help and exit
  --version   Show the installer version and exit
EOF
}
parse_args() {
  case "${1:-}" in
    "") [[ $# -eq 0 ]] || { usage >&2; return 2; } ;;
    -h|--help) [[ $# -eq 1 ]] || { printf 'ERROR: --help does not accept arguments.\n' >&2; usage >&2; return 2; }; usage; exit 0 ;;
    --version) [[ $# -eq 1 ]] || { printf 'ERROR: --version does not accept arguments.\n' >&2; usage >&2; return 2; }; printf 'dx-dy installer %s\n' "$DXDY_VERSION"; exit 0 ;;
    *) printf 'ERROR: unknown option: %s\n' "$1" >&2; usage >&2; return 2 ;;
  esac
}
valid_hostname() {
  [[ ${#1} -le 253 && "$1" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$ ]]
}
require_root() {
  [[ "$TEST_MODE" == 1 || ${EUID:-$(id -u)} -eq 0 ]] || die "Please run as root or sudo."
}

detect_platform() {
  local os_release="${DXDY_OS_RELEASE_FILE:-/etc/os-release}"
  [[ -r "$os_release" ]] || die "Cannot identify the operating system."
  # shellcheck disable=SC1090
  source "$os_release"
  case "${ID:-}:${VERSION_ID:-}" in
    debian:12|ubuntu:22.04|ubuntu:24.04) ;;
    *) die "Unsupported operating system: ${ID:-unknown} ${VERSION_ID:-unknown}. Supported: Debian 12, Ubuntu 22.04/24.04." ;;
  esac
  case "${DXDY_ARCH:-$(uname -m)}" in
    x86_64|amd64) ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *) die "Unsupported architecture. Supported: amd64 and arm64." ;;
  esac
}

install_dependencies() {
  [[ "$TEST_MODE" == 1 ]] && return
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl gnupg jq openssl tar gzip xz-utils coreutils util-linux iproute2 dnsutils libatomic1
  if ! have caddy; then
    install -d -m 0755 /usr/share/keyrings
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
    apt-get update
    apt-get install -y caddy
  fi
  if ! have systemctl || ! have caddy; then die "systemd and Caddy are required."; fi
}

legacy_compose() {
  docker compose --project-name dx-dy --env-file "$CONFIG_DIR/install.conf" -f "$INSTALL_ROOT/docker-compose.yml" "$@"
}

detect_existing() {
  if [[ -f "$CONFIG_DIR/install.conf" ]]; then
    if grep -q '^DXDY_RELEASE_MODEL=native-systemd$' "$CONFIG_DIR/install.conf"; then
      if [[ -x "$MANAGER_PATH" && -L "$INSTALL_ROOT/current" && -f "$SYSTEMD_DIR/dx-dy.service" ]]; then
        die $'dx-dy native is already installed.\nUse: dx-dy update'
      fi
      if [[ ! -e "$MANAGER_PATH" && ! -e "$INSTALL_ROOT" && ! -e "$SYSTEMD_DIR/dx-dy.service" && -f "$CONFIG_DIR/dx-dy.env" && -f "$DATA_DIR/dx-dy.db" ]]; then
        REINSTALL_MODE=1
        ADMIN_DOMAIN="$(sed -n 's/^DXDY_ADMIN_DOMAIN=//p' "$CONFIG_DIR/install.conf" | head -1)"
        SUBSCRIPTION_DOMAIN="$(sed -n 's/^DXDY_SUBSCRIPTION_DOMAIN=//p' "$CONFIG_DIR/install.conf" | head -1)"
        DXDY_INTERNAL_PORT="$(sed -n 's/^DXDY_INTERNAL_PORT=//p' "$CONFIG_DIR/install.conf" | head -1)"
        PRESERVED_MASTER_KEY="$(sed -n 's/^APP_MASTER_KEY=//p' "$CONFIG_DIR/dx-dy.env" | head -1)"
        valid_hostname "$ADMIN_DOMAIN" || die "Retained admin domain is invalid."
        valid_hostname "$SUBSCRIPTION_DOMAIN" || die "Retained subscription domain is invalid."
        [[ "$PRESERVED_MASTER_KEY" =~ ^[a-f0-9]{64}$ ]] || die "Retained APP_MASTER_KEY is invalid."
        info "Retained native data detected; reinstalling without changing credentials."
      else
        die "An incomplete native installation exists; use a verified backup and Full Purge before reinstalling."
      fi
    elif [[ -f "$INSTALL_ROOT/docker-compose.yml" ]] && have docker; then
      LEGACY_MODE=1
      if legacy_compose ps -q app 2>/dev/null | grep -q .; then LEGACY_RUNNING=1; fi
    else die "An unrecognized dx-dy installation already exists."; fi
  elif [[ -e "$MANAGER_PATH" ]]; then die "A dx-dy manager already exists without an installation record."; fi
}

check_port() {
  local port="$1" owner
  owner="$(ss -H -ltnp "sport = :$port" 2>/dev/null || true)"
  if [[ -n "$owner" && "$owner" != *caddy* ]]; then
    die "TCP port $port is already occupied by a non-Caddy service: $owner"
  fi
}

select_internal_port() {
  INTERNAL_PORT="${DXDY_INTERNAL_PORT:-3000}"
  [[ "$INTERNAL_PORT" =~ ^[0-9]+$ && "$INTERNAL_PORT" -ge 1024 && "$INTERNAL_PORT" -le 65535 ]] || die "Invalid internal port."
  if [[ "$TEST_MODE" != 1 ]] && ss -H -ltn "sport = :$INTERNAL_PORT" 2>/dev/null | grep -q .; then
    local candidate
    for candidate in $(seq 3001 3099); do
      if ! ss -H -ltn "sport = :$candidate" 2>/dev/null | grep -q .; then INTERNAL_PORT="$candidate"; return; fi
    done
    die "No free internal port was found in 3000-3099."
  fi
}

preflight() {
  detect_existing
  [[ "$TEST_MODE" == 1 ]] || {
    curl -fsSI --max-time 15 https://github.com >/dev/null || die "Network connectivity check failed."
    if [[ "$LEGACY_MODE" != 1 ]]; then check_port 80; check_port 443; fi
    local free_kb
    free_kb="$(df -Pk /opt | awk 'NR==2{print $4}')"
    [[ ${free_kb:-0} -ge 2097152 ]] || die "At least 2 GiB free disk space is required."
  }
  select_internal_port
}

prompt_hostname() {
  local prompt="$1" value
  while true; do
    read -r -p "$prompt: " value
    if valid_hostname "$value"; then REPLY="${value,,}"; return; fi
    printf 'Enter a hostname only, for example panel.example.com.\n' >&2
  done
}

dns_report() {
  local host="$1" resolved
  resolved="$(getent ahosts "$host" 2>/dev/null | awk '{print $1}' | sort -u | paste -sd, - || true)"
  printf 'Domain: %s\nResolved: %s\n' "$host" "${resolved:-PENDING}"
}

prompt_password() {
  local first second
  read -r -s -p "Administrator password (Enter to generate): " first; printf '\n'
  if [[ -z "$first" ]]; then first="$(openssl rand -base64 30 | tr -d '\n')"; GENERATED_PASSWORD=1
  else read -r -s -p "Confirm administrator password: " second; printf '\n'; [[ "$first" == "$second" ]] || die "Passwords do not match."; fi
  [[ ${#first} -ge 12 ]] || die "Password must be at least 12 characters."
  ADMIN_PASSWORD="$first"
}

configure_ufw() {
  [[ "$TEST_MODE" == 1 ]] && return
  if have ufw && ufw status 2>/dev/null | head -1 | grep -q 'Status: active'; then
    if ! ufw status | grep -Eq '(^| )80(/tcp)? .*ALLOW' || ! ufw status | grep -Eq '(^| )443(/tcp)? .*ALLOW'; then
      local answer
      read -r -p "Open HTTP/HTTPS ports in UFW? [Y/n] " answer
      if [[ ! "$answer" =~ ^[Nn]$ ]]; then ufw allow 80/tcp; ufw allow 443/tcp; fi
    fi
  fi
  info "Ensure your cloud security group allows TCP 80 and 443 (and UDP 443 for HTTP/3)."
}

fetch_asset() {
  local name="$1" target="$2" base="${DXDY_RELEASE_BASE_URL:-https://github.com/$DXDY_REPOSITORY/releases/download/v$DXDY_VERSION}"
  if [[ -f "${DXDY_ASSET_DIR:-$SCRIPT_DIR}/$name" ]]; then cp "${DXDY_ASSET_DIR:-$SCRIPT_DIR}/$name" "$target"
  elif ! curl -fsSL --proto '=https' --tlsv1.2 "${base%/}/$(basename "$name")" -o "$target"; then
    die "Failed to download release asset: $name"
  fi
}

prepare_test_artifact() {
  local root="$STAGING/fake/dx-dy-$DXDY_VERSION-linux-$ARCH"
  mkdir -p "$root/app/dist" "$root/app/migrations" "$root/runtime/bin"
  printf '#!/bin/sh\nexit 0\n' >"$root/runtime/bin/node"; chmod 755 "$root/runtime/bin/node"
  : >"$root/app/dist/server.mjs"; : >"$root/app/dist/admin-cli.mjs"; : >"$root/app/dist/database.mjs"; : >"$root/app/dist/domain-cli.mjs"
  cp migrations/*.sql "$root/app/migrations/"
  cp deploy/native/dx-dy.service deploy/native/Caddyfile.single deploy/native/Caddyfile.dual "$root/"
  printf '{"version":"%s","release_model":"native-systemd","architecture":"%s"}\n' "$DXDY_VERSION" "$ARCH" >"$root/RELEASE.json"
  tar -czf "$STAGING/artifact.tar.gz" -C "$STAGING/fake" "$(basename "$root")"
}

download_release() {
  local artifact="dx-dy-$DXDY_VERSION-linux-$ARCH.tar.gz" manager_asset expected actual
  if [[ "$TEST_MODE" == 1 && -z "${DXDY_TEST_REAL_ARTIFACT:-}" ]]; then
    prepare_test_artifact
    printf '#!/usr/bin/env bash\nexit 0\n' >"$STAGING/dx-dy-manager"
  else
    fetch_asset release-manifest.json "$STAGING/release-manifest.json"
    jq -e --arg v "$DXDY_VERSION" --arg a "$ARCH" '.version==$v and .release_model=="native-systemd" and (.architectures|index($a))' "$STAGING/release-manifest.json" >/dev/null || die "Release manifest validation failed."
    fetch_asset "$artifact" "$STAGING/artifact.tar.gz"
    expected="$(jq -er --arg n "$artifact" '.artifacts[] | select(.name==$n) | .sha256' "$STAGING/release-manifest.json")"
    actual="$(sha256sum "$STAGING/artifact.tar.gz" | cut -d' ' -f1)"
    [[ "$expected" =~ ^[a-f0-9]{64}$ && "$actual" == "$expected" ]] || die "Native artifact checksum failed."
    manager_asset="$(jq -er '.manager_asset' "$STAGING/release-manifest.json")"
    [[ "$manager_asset" == "dx-dy" ]] || die "Release manifest manager asset is invalid."
    fetch_asset "$manager_asset" "$STAGING/dx-dy-manager"
    expected="$(jq -er '.manager_sha256' "$STAGING/release-manifest.json")"
    actual="$(sha256sum "$STAGING/dx-dy-manager" | cut -d' ' -f1)"
    [[ "$expected" =~ ^[a-f0-9]{64}$ && "$actual" == "$expected" ]] || die "Manager checksum failed."
  fi
  bash -n "$STAGING/dx-dy-manager" || die "Manager shell syntax validation failed."
  mkdir "$STAGING/extract"
  tar -xzf "$STAGING/artifact.tar.gz" -C "$STAGING/extract"
  RELEASE_SOURCE="$STAGING/extract/dx-dy-$DXDY_VERSION-linux-$ARCH"
  [[ -x "$RELEASE_SOURCE/runtime/bin/node" && -f "$RELEASE_SOURCE/app/dist/server.mjs" ]] || die "Native artifact layout is invalid."
}

validate_release_runtime() {
  if ! "$RELEASE_SOURCE/runtime/bin/node" --version >/dev/null; then
    die "Bundled Node runtime cannot start on this host."
  fi
  if ! (cd "$RELEASE_SOURCE/app" && "$RELEASE_SOURCE/runtime/bin/node" -e "import('argon2')") >/dev/null; then
    die "Bundled production dependencies cannot load on this host."
  fi
}

render_caddy() {
  local template
  if [[ "$ADMIN_DOMAIN" == "$SUBSCRIPTION_DOMAIN" ]]; then template="$RELEASE_SOURCE/Caddyfile.single"; else template="$RELEASE_SOURCE/Caddyfile.dual"; fi
  sed -e "s/__ADMIN_DOMAIN__/$ADMIN_DOMAIN/g" -e "s/__SUBSCRIPTION_DOMAIN__/$SUBSCRIPTION_DOMAIN/g" -e "s/__INTERNAL_PORT__/$INTERNAL_PORT/g" "$template" >"$STAGING/dx-dy.caddy"
}

write_config() {
  local master_key="${LEGACY_MASTER_KEY:-${PRESERVED_MASTER_KEY:-$(openssl rand -hex 32)}}"
  umask 077
  cat >"$STAGING/install.conf" <<EOF
DXDY_VERSION=$DXDY_VERSION
DXDY_RELEASE_MODEL=native-systemd
DXDY_REPOSITORY=$DXDY_REPOSITORY
DXDY_INSTALL_CHANNEL=stable
DXDY_INSTALL_ROOT=/opt/dx-dy
DXDY_CONFIG_DIR=/etc/dx-dy
DXDY_DATA_DIR=/var/lib/dx-dy
DXDY_BACKUP_DIR=/var/backups/dx-dy
DXDY_INTERNAL_PORT=$INTERNAL_PORT
DXDY_ADMIN_DOMAIN=$ADMIN_DOMAIN
DXDY_SUBSCRIPTION_DOMAIN=$SUBSCRIPTION_DOMAIN
DXDY_CADDY_IMPORT=/etc/caddy/dx-dy.caddy
DXDY_SERVICE=dx-dy.service
DXDY_ARCH=$ARCH
DXDY_PREVIOUS_RELEASE=
DXDY_LEGACY_ROOT=${LEGACY_ROOT_PATH:-}
EOF
  cat >"$STAGING/dx-dy.env" <<EOF
NODE_ENV=production
PORT=$INTERNAL_PORT
HOST=127.0.0.1
DATABASE_PATH=/var/lib/dx-dy/dx-dy.db
ADMIN_BASE_URL=https://$ADMIN_DOMAIN
SUBSCRIPTION_BASE_URL=https://$SUBSCRIPTION_DOMAIN
COOKIE_SECURE=true
TRUST_PROXY=1
APP_MASTER_KEY=$master_key
EOF
  chmod 600 "$STAGING/install.conf" "$STAGING/dx-dy.env"
  render_caddy
}

legacy_backup_and_stop() {
  [[ "$LEGACY_MODE" == 1 ]] || return 0
  local stamp db_backup full_backup password_file
  stamp="$(date -u +%Y%m%d-%H%M%SZ)"; mkdir -p "$BACKUP_DIR"
  db_backup="$BACKUP_DIR/pre-native-$stamp.db"; full_backup="$BACKUP_DIR/pre-native-$stamp.psmbackup"
  password_file="${DXDY_MIGRATION_PASSWORD_FILE:-}"
  [[ -n "$password_file" && -f "$password_file" ]] || die "Legacy migration requires DXDY_MIGRATION_PASSWORD_FILE for the encrypted rollback bundle."
  legacy_compose exec -T app node dist/database.mjs backup "/backups/$(basename "$db_backup")"
  printf '%s' "$(<"$password_file")" | legacy_compose exec -T -e BACKUP_PASSWORD_STDIN=true app node dist/database.mjs bundle "/backups/$(basename "$full_backup")"
  # shellcheck disable=SC1090,SC1091
  source "$CONFIG_DIR/runtime.env"
  LEGACY_MASTER_KEY="$APP_MASTER_KEY"
  LEGACY_DATABASE="$db_backup"
  LEGACY_ROOT_PATH="$INSTALL_ROOT"
  legacy_compose stop app caddy
}

install_caddy_fragment() {
  install -d -m 0755 "$CADDY_DIR"
  local main="$CADDY_DIR/Caddyfile" import_line="import /etc/caddy/dx-dy.caddy" had_main=0 had_fragment=0
  if [[ -e "$main" ]]; then cp -a "$main" "$STAGING/Caddyfile.before"; had_main=1; fi
  if [[ -e "$CADDY_IMPORT" ]]; then cp -a "$CADDY_IMPORT" "$STAGING/dx-dy.caddy.before"; had_fragment=1; fi
  if [[ -s "$main" ]] && ! grep -Fqx "$import_line" "$main"; then
    cp -a "$main" "$main.pre-dx-dy.$(date -u +%Y%m%d-%H%M%SZ).bak"
    [[ -z "$(tail -c 1 "$main")" ]] || printf '\n' >>"$main"
    printf '%s\n' "$import_line" >>"$main"
  elif [[ ! -s "$main" ]]; then printf '%s\n' "$import_line" >"$main"; fi
  install -m 0644 "$STAGING/dx-dy.caddy" "$CADDY_IMPORT"
  if [[ "$TEST_MODE" != 1 ]] && ! caddy validate --config /etc/caddy/Caddyfile >/dev/null; then
    if [[ $had_main -eq 1 ]]; then cp -a "$STAGING/Caddyfile.before" "$main"; else rm -f -- "$main"; fi
    if [[ $had_fragment -eq 1 ]]; then cp -a "$STAGING/dx-dy.caddy.before" "$CADDY_IMPORT"; else rm -f -- "$CADDY_IMPORT"; fi
    die "Caddy validation failed; previous configuration restored."
  fi
}

commit_installation() {
  local release="$INSTALL_ROOT/releases/$DXDY_VERSION" manager_temp="${MANAGER_PATH}.new.$$"
  install -d -m 0755 "$INSTALL_ROOT/releases" "$SYSTEMD_DIR"; install -d -m 0700 "$CONFIG_DIR"; install -d -m 0750 "$DATA_DIR" "$BACKUP_DIR"
  rm -rf -- "$release"; cp -a "$RELEASE_SOURCE" "$release"
  ln -sfn "releases/$DXDY_VERSION" "$INSTALL_ROOT/current.next"; mv -Tf "$INSTALL_ROOT/current.next" "$INSTALL_ROOT/current"
  install -m 0600 "$STAGING/install.conf" "$CONFIG_DIR/install.conf"; install -m 0600 "$STAGING/dx-dy.env" "$CONFIG_DIR/dx-dy.env"
  install -m 0644 "$release/dx-dy.service" "$SYSTEMD_DIR/dx-dy.service"
  install -D -m 0755 "$STAGING/dx-dy-manager" "$manager_temp"
  if [[ "$TEST_MODE" != 1 ]]; then chown root:root "$manager_temp"; fi
  mv -Tf "$manager_temp" "$MANAGER_PATH"
  install_caddy_fragment
  if [[ "$TEST_MODE" != 1 ]]; then
    chown -R root:root "$release"; chmod -R a-w "$release"
    getent group dx-dy >/dev/null || groupadd --system dx-dy
    id dx-dy >/dev/null 2>&1 || useradd --system --gid dx-dy --home-dir /var/lib/dx-dy --shell /usr/sbin/nologin dx-dy
    chown -R dx-dy:dx-dy "$DATA_DIR" "$BACKUP_DIR"; chmod 0600 "$CONFIG_DIR/dx-dy.env" "$CONFIG_DIR/install.conf"
  fi
}

run_app_cli() {
  local script="$1"; shift
  set -a
  # shellcheck disable=SC1090,SC1091
  source "$CONFIG_DIR/dx-dy.env"
  set +a
  (cd "$INSTALL_ROOT/current/app" && runuser -u dx-dy -- "$INSTALL_ROOT/current/runtime/bin/node" "$INSTALL_ROOT/current/app/dist/$script" "$@")
}

initialize_and_start() {
  if [[ "$TEST_MODE" == 1 ]]; then
    if [[ "$LEGACY_MODE" == 1 ]]; then cp -a "$LEGACY_DATABASE" "$DATA_DIR/dx-dy.db"; fi
    return
  fi
  if [[ "$LEGACY_MODE" == 1 ]]; then
    [[ -f "$LEGACY_DATABASE" ]] || die "Legacy database path was not found."
    cp -a "$LEGACY_DATABASE" "$DATA_DIR/dx-dy.db"; chown dx-dy:dx-dy "$DATA_DIR/dx-dy.db"
  elif [[ "$REINSTALL_MODE" == 1 ]]; then
    [[ -f "$DATA_DIR/dx-dy.db" ]] || die "Retained database was not found."
  else printf '%s\n%s' "$ADMIN_USERNAME" "$ADMIN_PASSWORD" | run_app_cli admin-cli.mjs init; fi
  systemctl daemon-reload
  if ! systemctl enable --now dx-dy.service || ! systemctl enable --now caddy.service || ! systemctl reload caddy.service; then
    systemctl stop dx-dy.service caddy.service || true
    if [[ "$LEGACY_MODE" == 1 && "$LEGACY_RUNNING" == 1 ]]; then legacy_compose up -d app caddy || true; fi
    die "Native services failed to start; legacy services were restored when available."
  fi
  for _ in {1..60}; do curl -fsS "http://127.0.0.1:$INTERNAL_PORT/health" >/dev/null 2>&1 && return; sleep 2; done
  systemctl stop dx-dy.service caddy.service || true
  if [[ "$LEGACY_MODE" == 1 && "$LEGACY_RUNNING" == 1 ]]; then legacy_compose up -d app caddy || true; fi
  die "Native health check failed; legacy services were restored when available."
}

main() {
  parse_args "$@"
  info "dx-dy Native Installer" "Version $DXDY_VERSION"
  require_root; detect_platform; preflight; install_dependencies
  if [[ "$LEGACY_MODE" == 1 || "$REINSTALL_MODE" == 1 ]]; then
    if [[ "$REINSTALL_MODE" == 1 ]]; then info "Reusing retained domains and administrator data."; fi
    ADMIN_DOMAIN="$(sed -n 's/^DXDY_ADMIN_DOMAIN=//p' "$CONFIG_DIR/install.conf" | head -1)"
    SUBSCRIPTION_DOMAIN="$(sed -n 's/^DXDY_SUBSCRIPTION_DOMAIN=//p' "$CONFIG_DIR/install.conf" | head -1)"
    valid_hostname "$ADMIN_DOMAIN" || die "Legacy admin domain is invalid."
    valid_hostname "$SUBSCRIPTION_DOMAIN" || die "Legacy subscription domain is invalid."
  else
    if [[ -n "${DXDY_ADMIN_DOMAIN:-}" ]]; then valid_hostname "$DXDY_ADMIN_DOMAIN" || die "Invalid DXDY_ADMIN_DOMAIN."; ADMIN_DOMAIN="${DXDY_ADMIN_DOMAIN,,}"; else prompt_hostname "Admin domain"; ADMIN_DOMAIN="$REPLY"; fi
    printf 'Admin: https://%s\n' "$ADMIN_DOMAIN"
    if [[ -n "${DXDY_SUBSCRIPTION_DOMAIN:-}" ]]; then valid_hostname "$DXDY_SUBSCRIPTION_DOMAIN" || die "Invalid DXDY_SUBSCRIPTION_DOMAIN."; SUBSCRIPTION_DOMAIN="${DXDY_SUBSCRIPTION_DOMAIN,,}"
    else local separate; read -r -p "Use a separate subscription domain? [y/N] " separate; if [[ "$separate" =~ ^[Yy]$ ]]; then prompt_hostname "Subscription domain"; SUBSCRIPTION_DOMAIN="$REPLY"; else SUBSCRIPTION_DOMAIN="$ADMIN_DOMAIN"; fi; fi
  fi
  dns_report "$ADMIN_DOMAIN"; [[ "$SUBSCRIPTION_DOMAIN" == "$ADMIN_DOMAIN" ]] || dns_report "$SUBSCRIPTION_DOMAIN"; configure_ufw
  ADMIN_USERNAME="${DXDY_ADMIN_USERNAME:-admin}"; [[ "$ADMIN_USERNAME" =~ ^[A-Za-z0-9._-]{1,100}$ ]] || die "Invalid administrator username."
  if [[ "$LEGACY_MODE" != 1 && "$REINSTALL_MODE" != 1 ]]; then
    if [[ -n "${DXDY_ADMIN_PASSWORD_FILE:-}" ]]; then [[ -f "$DXDY_ADMIN_PASSWORD_FILE" ]] || die "Password file does not exist."; ADMIN_PASSWORD="$(<"$DXDY_ADMIN_PASSWORD_FILE")"; else prompt_password; fi
    [[ ${#ADMIN_PASSWORD} -ge 12 ]] || die "Password must be at least 12 characters."
  fi
  STAGING="$(mktemp -d)"; download_release; validate_release_runtime; legacy_backup_and_stop; write_config; commit_installation; initialize_and_start
  printf '\ndx-dy %s native installation completed.\nAdmin: https://%s\nSubscription: https://%s\nManagement: dx-dy\n' "$DXDY_VERSION" "$ADMIN_DOMAIN" "$SUBSCRIPTION_DOMAIN"
  if [[ "$GENERATED_PASSWORD" == 1 ]]; then printf 'Password (shown once): %s\n' "$ADMIN_PASSWORD"; fi
  unset ADMIN_PASSWORD LEGACY_MASTER_KEY APP_MASTER_KEY || true
}

main "$@"
