#!/usr/bin/env bash
# Ubuntu server setup: installs Docker + Caddy, writes .env, starts the docker-compose stack,
# then runs Caddy (TLS reverse proxy) and the API binary.
#   ./setup.sh <domain>        # safe to re-run: secrets and running containers are kept
# Re-exec under bash when started as `sh setup.sh` (dash has no arrays or [[ ]]).
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -euo pipefail

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "Usage: $0 <domain>" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$ROOT_DIR/.env"
EXAMPLE_FILE="$ROOT_DIR/.env.example"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
SERVER="$ROOT_DIR/run-server"

# Long-running services the app needs; ministack-init is a one-shot job checked separately.
REQUIRED_CONTAINERS=(cworkplace-ministack cworkplace-coturn)
INIT_CONTAINER="cworkplace-ministack-init"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

# ============================================================
# 0. Preflight
# ============================================================
[ -r /etc/os-release ] || die "cannot detect the OS (/etc/os-release missing)"
# shellcheck disable=SC1091
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || die "this script supports Ubuntu only (found '${ID:-unknown}')"
UBUNTU_CODENAME="${UBUNTU_CODENAME:-$VERSION_CODENAME}"

[ -x "$SERVER" ] || die "$SERVER not found or not executable; build it with 'bun run build' or download a release."
[ -f "$COMPOSE_FILE" ] || die "$COMPOSE_FILE not found"

# ============================================================
# 1. Install everything that's missing
# ============================================================
APT_UPDATED=0
apt_install() {
  [ "$APT_UPDATED" = 1 ] || { sudo apt-get update; APT_UPDATED=1; }
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
}

APT_PACKAGES=()
command -v caddy >/dev/null 2>&1 || APT_PACKAGES+=(caddy)
command -v openssl >/dev/null 2>&1 || APT_PACKAGES+=(openssl)
command -v curl >/dev/null 2>&1 || APT_PACKAGES+=(curl)
command -v unzip >/dev/null 2>&1 || APT_PACKAGES+=(unzip)
if [ "${#APT_PACKAGES[@]}" -gt 0 ]; then
  log "Installing: ${APT_PACKAGES[*]}"
  apt_install "${APT_PACKAGES[@]}"
fi

# --- Bun (the installer needs unzip) ---
export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
if ! command -v bun >/dev/null 2>&1; then
  log "Installing Bun"
  # pinned to the repo's devEngines version (package.json)
  curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.3"
fi
log "Bun: $(bun --version)"

# --- Server binary: build it from source when no release binary is present ---
if [ ! -x "$SERVER" ]; then
  log "$SERVER not found; building from source"
  (cd "$ROOT_DIR" && bun install --frozen-lockfile && bun run build)
fi

# --- Docker Engine (https://docs.docker.com/engine/install/ubuntu/) ---
install_docker() {
  log "Installing Docker Engine"
  # Distro packages conflict with Docker's own; removing absent ones is a no-op.
  local pkg conflicting=()
  for pkg in docker.io docker-compose docker-compose-v2 docker-doc podman-docker containerd runc; do
    dpkg -s "$pkg" >/dev/null 2>&1 && conflicting+=("$pkg")
  done
  [ "${#conflicting[@]}" -eq 0 ] || sudo apt-get remove -y "${conflicting[@]}"

  apt_install ca-certificates curl
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $UBUNTU_CODENAME
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  APT_UPDATED=0
  apt_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  install_docker
fi
sudo systemctl enable --now docker >/dev/null
if ! id -nG "$USER" | grep -qw docker; then
  sudo usermod -aG docker "$USER"
  log "Added $USER to the 'docker' group (takes effect on next login)"
fi

# A fresh group membership isn't active in this shell yet; fall back to sudo until it is.
if docker info >/dev/null 2>&1; then
  DOCKER=(docker)
else
  DOCKER=(sudo --preserve-env=HOME docker)
fi
# HOME is passed explicitly: the compose file mounts ${HOME}/.ministack and sudo may reset it.
compose() { "${DOCKER[@]}" compose --project-directory "$ROOT_DIR" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }
log "Docker: $("${DOCKER[@]}" --version)"

# ============================================================
# 2. Build .env from .env.example
# ============================================================
# Keys in .env.example order; values from the current .env win so secrets survive re-runs.
declare -A ENV
KEYS=()

load_env_file() {
  local file="$1" line key
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    key="${line%%=*}"
    [ -v "ENV[$key]" ] || KEYS+=("$key")
    ENV[$key]="${line#*=}"
  done <"$file"
}
load_env_file "$EXAMPLE_FILE"
declare -A EXAMPLE
for k in "${KEYS[@]}"; do EXAMPLE[$k]="${ENV[$k]}"; done
load_env_file "$ENV_FILE"

set_env() {
  [ -v "ENV[$1]" ] || KEYS+=("$1")
  ENV[$1]="$2"
}

# Generate a secret unless .env already holds one that isn't the example placeholder.
secret() {
  local key="$1" current="${ENV[$1]:-}"
  if [ -z "$current" ] || [ "$current" = "${EXAMPLE[$key]:-}" ]; then
    set_env "$key" "$(openssl rand -hex 32)"
  fi
}

write_env() {
  local tmp k
  tmp="$(mktemp "$ENV_FILE.XXXXXX")"
  chmod 600 "$tmp"
  for k in "${KEYS[@]}"; do printf '%s=%s\n' "$k" "${ENV[$k]}" >>"$tmp"; done
  mv "$tmp" "$ENV_FILE"
}

database_url() {
  set_env DATABASE_URL "postgresql://${ENV[POSTGRES_USER]}:${ENV[POSTGRES_PASSWORD]}@127.0.0.1:$1/${ENV[POSTGRES_DB]}"
}

# Domain
set_env DOMAIN "$DOMAIN"
set_env APP_URL "https://$DOMAIN"
set_env WEB_ORIGIN "https://$DOMAIN"
set_env BETTER_AUTH_URL "https://$DOMAIN"
set_env TRUST_PROXY "true"
# production defaults in the API (e.g. /openapi off unless OPENAPI_ENABLED=true)
set_env NODE_ENV "production"
secret BETTER_AUTH_SECRET

# PostgreSQL (MiniStack RDS): the password is fixed when the instance is first created, so never rotate it.
set_env POSTGRES_USER "${ENV[POSTGRES_USER]:-cworkplace}"
set_env POSTGRES_DB "${ENV[POSTGRES_DB]:-cworkplace}"
if [ ! -d "$HOME/.ministack" ]; then
  secret POSTGRES_PASSWORD
else
  set_env POSTGRES_PASSWORD "${ENV[POSTGRES_PASSWORD]:-cworkplace}"
fi
PG_PORT="$(sed -n 's|^postgresql://[^@]*@[^:/]*:\([0-9]*\)/.*|\1|p' <<<"${ENV[DATABASE_URL]:-}")"
database_url "${PG_PORT:-15432}"

# coturn
secret TURN_SECRET
set_env TURN_URLS "turn:$DOMAIN:3478?transport=udp,turn:$DOMAIN:3478?transport=tcp"
# coturn runs on the host network and must advertise the public IP; keep an existing value on re-runs.
PUBLIC_IP="${ENV[TURN_EXTERNAL_IP]:-}"
[ -n "$PUBLIC_IP" ] || PUBLIC_IP="$(curl -fsS4 --max-time 5 https://api.ipify.org || curl -fsS4 --max-time 5 https://ifconfig.me || true)"
[ -n "$PUBLIC_IP" ] || die "cannot detect the public IP; set TURN_EXTERNAL_IP in $ENV_FILE"
set_env TURN_EXTERNAL_IP "$PUBLIC_IP"
set_env TURN_MIN_PORT "${ENV[TURN_MIN_PORT]:-49152}"
set_env TURN_MAX_PORT "${ENV[TURN_MAX_PORT]:-65535}"
if command -v ufw >/dev/null 2>&1 && sudo ufw status | grep -q "Status: active"; then
  log "Opening TURN ports in ufw"
  sudo ufw allow 3478/tcp >/dev/null
  sudo ufw allow 3478/udp >/dev/null
  sudo ufw allow "${ENV[TURN_MIN_PORT]}:${ENV[TURN_MAX_PORT]}/udp" >/dev/null
fi
log "TURN: $PUBLIC_IP:3478 (also allow 3478/tcp+udp and ${ENV[TURN_MIN_PORT]}-${ENV[TURN_MAX_PORT]}/udp in your cloud firewall)"

# S3 (MiniStack accepts any credentials; they only have to match between API and compose)
set_env S3_ACCESS_KEY_ID "${ENV[S3_ACCESS_KEY_ID]:-cworkplace}"
set_env S3_SECRET_ACCESS_KEY "${ENV[S3_SECRET_ACCESS_KEY]:-cworkplace}"
set_env S3_BUCKET "${ENV[S3_BUCKET]:-cworkplace}"
set_env S3_REGION "${ENV[S3_REGION]:-us-east-1}"
set_env S3_ENDPOINT "http://127.0.0.1:4566"
set_env S3_PUBLIC_URL "https://$DOMAIN/s3"

write_env
log "Wrote $ENV_FILE"

# ============================================================
# 3. Docker containers
# ============================================================
container_running() {
  [ "$("${DOCKER[@]}" inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = "true" ]
}

MISSING=()
for c in "${REQUIRED_CONTAINERS[@]}"; do container_running "$c" || MISSING+=("$c"); done
# The init job must have finished successfully at least once (bucket + database exist).
INIT_EXIT="$("${DOCKER[@]}" inspect -f '{{.State.Status}}:{{.State.ExitCode}}' "$INIT_CONTAINER" 2>/dev/null || true)"
[ "$INIT_EXIT" = "exited:0" ] || MISSING+=("$INIT_CONTAINER")

if [ "${#MISSING[@]}" -gt 0 ]; then
  log "Starting containers (not running: ${MISSING[*]})"
  compose up -d --remove-orphans
else
  log "Containers already running: ${REQUIRED_CONTAINERS[*]}"
  # Recreates coturn only when its config changed (e.g. a new public IP).
  compose up -d coturn
fi

log "Waiting for $INIT_CONTAINER (bucket + RDS instance)"
if [ "$("${DOCKER[@]}" wait "$INIT_CONTAINER")" != "0" ]; then
  "${DOCKER[@]}" logs --tail 50 "$INIT_CONTAINER" >&2 || true
  die "$INIT_CONTAINER failed"
fi
for c in "${REQUIRED_CONTAINERS[@]}"; do
  container_running "$c" || { "${DOCKER[@]}" logs --tail 50 "$c" >&2 || true; die "$c is not running"; }
done

# The init job prints the RDS port last; keep DATABASE_URL in sync with it.
RDS_PORT="$("${DOCKER[@]}" logs "$INIT_CONTAINER" 2>/dev/null | grep -E '^[0-9]+$' | tail -n1 || true)"
if [ -n "$RDS_PORT" ] && [ "$RDS_PORT" != "${PG_PORT:-15432}" ]; then
  database_url "$RDS_PORT"
  write_env
  log "DATABASE_URL now points at port $RDS_PORT"
fi
RDS_PORT="${RDS_PORT:-${PG_PORT:-15432}}"

log "Waiting for PostgreSQL on 127.0.0.1:$RDS_PORT"
for _ in $(seq 1 60); do
  (exec 3<>"/dev/tcp/127.0.0.1/$RDS_PORT") 2>/dev/null && break
  sleep 1
done
(exec 3<>"/dev/tcp/127.0.0.1/$RDS_PORT") 2>/dev/null || die "PostgreSQL did not come up on port $RDS_PORT"

# DATABASE_URL in .env is final now; bring the schema up to date.
log "Updating the database schema"
(cd "$ROOT_DIR" && bun run --filter @app/api db:push)

# ============================================================
# 4. Caddy + server
# ============================================================
# run-server stays in the foreground (exec), so Caddy is started as a background daemon right before it.
# Caddy proxies /s3/* to MiniStack and everything else to the API; it handles TLS.
log "Starting Caddy for $DOMAIN"
caddy stop >/dev/null 2>&1 || true
DOMAIN="$DOMAIN" caddy start --config "$ROOT_DIR/Caddyfile" --adapter caddyfile

# The binary reads its config from the environment, so export everything in .env.
log "Starting $SERVER on 127.0.0.1:3000"
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
cd "$ROOT_DIR"
exec "$SERVER" --host 127.0.0.1 --port 3000
