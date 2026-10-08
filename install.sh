#!/usr/bin/env bash
set -Eeuo pipefail

readonly DXDY_VERSION="0.1.8"
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
STAGING=""
GENERATED_PASSWORD="0"
DXDY_REPOSITORY="${DXDY_REPOSITORY:-$DXDY_DEFAULT_REPOSITORY}"
if [[ -z "${DXDY_RELEASE_BASE_URL:-}" && "$TEST_MODE" != 1 && \
  ! -f "${DXDY_ASSET_DIR:-$SCRIPT_DIR}/deploy/docker-compose.yml" ]]; then
  DXDY_RELEASE_BASE_URL="https://github.com/$DXDY_REPOSITORY/releases/latest/download"
fi

cleanup() { [[ -z "$STAGING" ]] || rm -rf -- "$STAGING"; }
trap cleanup EXIT
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
info() { printf '%s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
valid_hostname() {
  [[ ${#1} -le 253 && "$1" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$ ]]
}
require_root() {
  [[ "$TEST_MODE" == 1 || ${EUID:-$(id -u)} -eq 0 ]] ||
    die "Please run as root or sudo."
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
  OS_ID="$ID"
}

install_dependencies() {
  [[ "$TEST_MODE" == 1 ]] && return
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl gnupg jq openssl tar gzip coreutils iproute2 dnsutils
  if ! have docker; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/$OS_ID/gpg" -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    local codename
    codename="$(. /etc/os-release && printf '%s' "$VERSION_CODENAME")"
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
      "$ARCH" "$OS_ID" "$codename" >/etc/apt/sources.list.d/docker.list
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  systemctl enable --now docker
  docker compose version >/dev/null || die "Docker Compose v2 is unavailable."
}

check_port() {
  local port="$1" owner
  owner="$(ss -H -ltnp "sport = :$port" 2>/dev/null || true)"
  [[ -z "$owner" ]] || die "TCP port $port is already occupied: $owner"
}

preflight() {
  [[ ! -e "$CONFIG_DIR/install.conf" && ! -e "$MANAGER_PATH" ]] ||
    die $'dx-dy is already installed.\nUse: dx-dy update\nOr run: dx-dy'
  [[ "$TEST_MODE" == 1 ]] || {
    curl -fsSI --max-time 15 https://github.com >/dev/null || die "Network connectivity check failed."
    check_port 80; check_port 443
    local free_kb
    free_kb="$(df -Pk /opt | awk 'NR==2{print $4}')"
    [[ ${free_kb:-0} -ge 2097152 ]] || die "At least 2 GiB free disk space is required."
  }
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
  if [[ -z "$first" ]]; then
    first="$(openssl rand -base64 30 | tr -d '\n')"
    GENERATED_PASSWORD="1"
  else
    read -r -s -p "Confirm administrator password: " second; printf '\n'
    [[ "$first" == "$second" ]] || die "Passwords do not match."
  fi
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
  local name="$1" target="$2"
  if [[ -f "${DXDY_ASSET_DIR:-$SCRIPT_DIR}/$name" ]]; then
    cp "${DXDY_ASSET_DIR:-$SCRIPT_DIR}/$name" "$target"
  else
    [[ -n "${DXDY_RELEASE_BASE_URL:-}" ]] || die "Release asset URL is unavailable."
    curl -fsSL --proto '=https' --tlsv1.2 "${DXDY_RELEASE_BASE_URL%/}/$(basename "$name")" -o "$target"
  fi
}

resolve_image() {
  if [[ -n "${DXDY_IMAGE_REFERENCE:-}" ]]; then
    DXDY_IMAGE_DIGEST="${DXDY_IMAGE_REFERENCE##*@}"
  elif [[ -n "${DXDY_RELEASE_BASE_URL:-}" ]]; then
    curl -fsSL --proto '=https' --tlsv1.2 "${DXDY_RELEASE_BASE_URL%/}/release-manifest.json" -o "$STAGING/release-manifest.json"
    DXDY_IMAGE_REFERENCE="$(jq -er --arg version "$DXDY_VERSION" 'select(.version == $version) | .docker_image + "@" + .docker_image_digest' "$STAGING/release-manifest.json")" ||
      die "Release manifest validation failed."
    DXDY_IMAGE_DIGEST="${DXDY_IMAGE_REFERENCE##*@}"
    DXDY_REPOSITORY="${DXDY_REPOSITORY:-$(jq -er '.repository' "$STAGING/release-manifest.json")}" ||
      die "Release repository coordinate is missing."
  elif [[ "$TEST_MODE" == 1 ]]; then
    DXDY_IMAGE_REFERENCE="ghcr.io/example/dx-dy:0.1.8@sha256:$(printf '0%.0s' {1..64})"
    DXDY_IMAGE_DIGEST="${DXDY_IMAGE_REFERENCE##*@}"
  else
    die "A verified release manifest or DXDY_IMAGE_REFERENCE is required."
  fi
  [[ "$DXDY_IMAGE_REFERENCE" =~ @sha256:[a-f0-9]{64}$ ]] ||
    die "DXDY_IMAGE_REFERENCE must be pinned by sha256 digest."
}

verify_release_assets() {
  [[ -f "$STAGING/release-manifest.json" ]] || return 0
  local file field expected actual
  while read -r file field; do
    expected="$(jq -er ".$field" "$STAGING/release-manifest.json")"
    actual="$(sha256sum "$STAGING/$file" | cut -d' ' -f1)"
    [[ "$expected" =~ ^[a-f0-9]{64}$ && "$actual" == "$expected" ]] ||
      die "Release asset checksum failed: $file"
  done <<'EOF'
dx-dy manager_sha256
docker-compose.yml compose_sha256
Caddyfile.single caddy_single_sha256
Caddyfile.dual caddy_dual_sha256
EOF
}

render_caddy() {
  local template
  if [[ "$ADMIN_DOMAIN" == "$SUBSCRIPTION_DOMAIN" ]]; then template="$STAGING/Caddyfile.single"; else template="$STAGING/Caddyfile.dual"; fi
  sed -e "s/__ADMIN_DOMAIN__/$ADMIN_DOMAIN/g" -e "s/__SUBSCRIPTION_DOMAIN__/$SUBSCRIPTION_DOMAIN/g" \
    "$template" >"$STAGING/Caddyfile"
}

generate_configuration() {
  local master_key
  master_key="$(openssl rand -hex 32)"
  umask 077
  cat >"$STAGING/install.conf" <<EOF
DXDY_VERSION=$DXDY_VERSION
DXDY_REPOSITORY=${DXDY_REPOSITORY:-}
DXDY_INSTALL_CHANNEL=stable
DXDY_INSTALL_ROOT=/opt/dx-dy
DXDY_CONFIG_DIR=/etc/dx-dy
DXDY_DATA_DIR=/var/lib/dx-dy
DXDY_BACKUP_DIR=/var/backups/dx-dy
DXDY_COMPOSE_PROJECT=dx-dy
DXDY_IMAGE_REFERENCE=$DXDY_IMAGE_REFERENCE
DXDY_IMAGE_DIGEST=${DXDY_IMAGE_DIGEST:-}
DXDY_CADDY_IMAGE=caddy:2.10.2-alpine
DXDY_CADDYFILE=/etc/dx-dy/Caddyfile
DXDY_CADDY_DATA=/var/lib/dx-dy/caddy-data
DXDY_CADDY_CONFIG=/var/lib/dx-dy/caddy-config
DXDY_RUNTIME_ENV=/etc/dx-dy/runtime.env
DXDY_ADMIN_DOMAIN=$ADMIN_DOMAIN
DXDY_SUBSCRIPTION_DOMAIN=$SUBSCRIPTION_DOMAIN
EOF
  cat >"$STAGING/runtime.env" <<EOF
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
DATABASE_PATH=/data/private-subscription-manager.db
ADMIN_BASE_URL=https://$ADMIN_DOMAIN
SUBSCRIPTION_BASE_URL=https://$SUBSCRIPTION_DOMAIN
COOKIE_SECURE=true
TRUST_PROXY=1
APP_MASTER_KEY=$master_key
EOF
  chmod 600 "$STAGING/install.conf" "$STAGING/runtime.env"
  render_caddy
  chmod 644 "$STAGING/Caddyfile" "$STAGING/docker-compose.yml" "$STAGING/Caddyfile.single" "$STAGING/Caddyfile.dual"
  chmod 755 "$STAGING/dx-dy"
}

commit_installation() {
  install -d -m 0750 "$CONFIG_DIR" "$INSTALL_ROOT"
  install -d -m 0700 "$DATA_DIR" "$BACKUP_DIR" "$DATA_DIR/caddy-data" "$DATA_DIR/caddy-config"
  [[ "$TEST_MODE" == 1 ]] || chown 1000:1000 "$DATA_DIR" "$BACKUP_DIR"
  install -m 0600 "$STAGING/install.conf" "$CONFIG_DIR/install.conf"
  install -m 0600 "$STAGING/runtime.env" "$CONFIG_DIR/runtime.env"
  install -m 0644 "$STAGING/Caddyfile" "$CONFIG_DIR/Caddyfile"
  install -m 0644 "$STAGING/docker-compose.yml" "$INSTALL_ROOT/docker-compose.yml"
  install -m 0644 "$STAGING/Caddyfile.single" "$INSTALL_ROOT/Caddyfile.single"
  install -m 0644 "$STAGING/Caddyfile.dual" "$INSTALL_ROOT/Caddyfile.dual"
  install -D -m 0755 "$STAGING/dx-dy" "$MANAGER_PATH"
}

runtime_install() {
  [[ "$TEST_MODE" == 1 ]] && return
  local compose=(docker compose --project-name dx-dy --env-file "$CONFIG_DIR/install.conf" -f "$INSTALL_ROOT/docker-compose.yml")
  "${compose[@]}" pull
  printf '%s\n%s' "$ADMIN_USERNAME" "$ADMIN_PASSWORD" | "${compose[@]}" run --rm -T --no-deps app node dist/admin-cli.mjs init
  "${compose[@]}" up -d
  for _ in {1..60}; do
    if "${compose[@]}" exec -T app node -e 'fetch("http://127.0.0.1:3000/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' 2>/dev/null; then return; fi
    sleep 2
  done
  die "Application health check did not become ready; inspect with dx-dy logs."
}

main() {
  info "dx-dy Installer" "Version $DXDY_VERSION"
  require_root; detect_platform; preflight; install_dependencies
  if [[ -n "${DXDY_ADMIN_DOMAIN:-}" ]]; then
    valid_hostname "$DXDY_ADMIN_DOMAIN" || die "Invalid DXDY_ADMIN_DOMAIN."
    ADMIN_DOMAIN="${DXDY_ADMIN_DOMAIN,,}"
  else prompt_hostname "Admin domain"; ADMIN_DOMAIN="$REPLY"; fi
  printf 'Admin: https://%s\n' "$ADMIN_DOMAIN"
  if [[ -n "${DXDY_SUBSCRIPTION_DOMAIN:-}" ]]; then
    valid_hostname "$DXDY_SUBSCRIPTION_DOMAIN" || die "Invalid DXDY_SUBSCRIPTION_DOMAIN."
    SUBSCRIPTION_DOMAIN="${DXDY_SUBSCRIPTION_DOMAIN,,}"
  else
    local separate
    read -r -p "Use a separate subscription domain? [y/N] " separate
    if [[ "$separate" =~ ^[Yy]$ ]]; then prompt_hostname "Subscription domain"; SUBSCRIPTION_DOMAIN="$REPLY"; else SUBSCRIPTION_DOMAIN="$ADMIN_DOMAIN"; fi
  fi
  printf 'Subscription: https://%s\n' "$SUBSCRIPTION_DOMAIN"
  dns_report "$ADMIN_DOMAIN"; [[ "$SUBSCRIPTION_DOMAIN" == "$ADMIN_DOMAIN" ]] || dns_report "$SUBSCRIPTION_DOMAIN"
  configure_ufw
  ADMIN_USERNAME="${DXDY_ADMIN_USERNAME:-}"
  if [[ -z "$ADMIN_USERNAME" ]]; then read -r -p "Administrator username [admin]: " ADMIN_USERNAME; ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"; fi
  [[ "$ADMIN_USERNAME" =~ ^[A-Za-z0-9._-]{1,100}$ ]] || die "Invalid administrator username."
  if [[ -n "${DXDY_ADMIN_PASSWORD_FILE:-}" ]]; then
    [[ -f "$DXDY_ADMIN_PASSWORD_FILE" ]] || die "Password file does not exist."
    ADMIN_PASSWORD="$(<"$DXDY_ADMIN_PASSWORD_FILE")"
  else prompt_password; fi
  STAGING="$(mktemp -d)"
  resolve_image
  fetch_asset deploy/docker-compose.yml "$STAGING/docker-compose.yml"
  fetch_asset deploy/Caddyfile.single "$STAGING/Caddyfile.single"
  fetch_asset deploy/Caddyfile.dual "$STAGING/Caddyfile.dual"
  fetch_asset ops/dx-dy "$STAGING/dx-dy"
  verify_release_assets; generate_configuration; commit_installation; runtime_install
  printf '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\ndx-dy %s installed successfully\n\nAdmin:\nhttps://%s\n\nSubscription:\nhttps://%s\n\nUsername:\n%s\n' \
    "$DXDY_VERSION" "$ADMIN_DOMAIN" "$SUBSCRIPTION_DOMAIN" "$ADMIN_USERNAME"
  if [[ "$GENERATED_PASSWORD" == 1 ]]; then printf '\nPassword (shown once):\n%s\n' "$ADMIN_PASSWORD"; fi
  printf '\nManagement:\ndx-dy\n\nStatus:\ndx-dy status\n\nBackup:\ndx-dy backup db\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
  unset ADMIN_PASSWORD
}

main "$@"
