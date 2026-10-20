#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "Usage: $0 <domain>" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$ROOT_DIR/.env"
EXAMPLE_FILE="$ROOT_DIR/.env.example"
SERVER="$ROOT_DIR/run-server"

PG_DB="cworkplace"
MINIO_DATA="${MINIO_DATA:-$HOME/minio-data}"
COTURN_PID_FILE="/var/tmp/cworkplace-coturn.pid"
MINIO_PID_FILE="/var/tmp/cworkplace-minio.pid"

# ============================================================
# 1. Install everything that's missing
# ============================================================
APT_PACKAGES=()
command -v psql >/dev/null 2>&1 || APT_PACKAGES+=(postgresql)
command -v turnserver >/dev/null 2>&1 || APT_PACKAGES+=(coturn)
command -v caddy >/dev/null 2>&1 || APT_PACKAGES+=(caddy)
if [ "${#APT_PACKAGES[@]}" -gt 0 ]; then
  echo "Installing: ${APT_PACKAGES[*]}"
  sudo apt update
  sudo apt install -y "${APT_PACKAGES[@]}"
fi

install_bin() {
  local name="$1" url="$2"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Installing: $name"
    wget -q "$url" -O "/var/tmp/$name"
    chmod +x "/var/tmp/$name"
    sudo mv "/var/tmp/$name" /usr/local/bin/
  fi
}
install_bin minio https://dl.min.io/server/minio/release/linux-amd64/minio
install_bin mc https://dl.min.io/client/mc/release/linux-amd64/mc

if [ ! -x "$SERVER" ]; then
  echo "$SERVER not found or not executable; build it with 'bun run build' or download a release." >&2
  exit 1
fi

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

# Domain
set_env APP_URL "https://$DOMAIN"
set_env WEB_ORIGIN "https://$DOMAIN"
set_env BETTER_AUTH_URL "https://$DOMAIN"
set_env TRUST_PROXY "true"
secret BETTER_AUTH_SECRET

# PostgreSQL: reuse the password from a previous run so existing connections keep working.
PG_PASSWORD="$(sed -n 's|^postgresql://postgres:\([^@]*\)@127\.0\.0\.1:5432/.*|\1|p' <<<"${ENV[DATABASE_URL]:-}")"
PG_PASSWORD="${PG_PASSWORD:-$(openssl rand -hex 32)}"
set_env DATABASE_URL "postgresql://postgres:$PG_PASSWORD@127.0.0.1:5432/$PG_DB"

# coturn
secret TURN_SECRET
set_env TURN_URLS "turn:$DOMAIN:3478?transport=udp,turn:$DOMAIN:3478?transport=tcp"

# MinIO: the MiniStack dev keys (test/test) get replaced with real credentials.
if [ "${ENV[S3_ACCESS_KEY_ID]:-}" = "${EXAMPLE[S3_ACCESS_KEY_ID]:-}" ] || [ -z "${ENV[S3_ACCESS_KEY_ID]:-}" ]; then
  set_env S3_ACCESS_KEY_ID "cworkplace"
fi
secret S3_SECRET_ACCESS_KEY
set_env S3_BUCKET "${ENV[S3_BUCKET]:-cworkplace}"
set_env S3_REGION "us-east-1"
set_env S3_ENDPOINT "http://127.0.0.1:9000"
set_env S3_PUBLIC_URL "https://$DOMAIN/s3"

: >"$ENV_FILE"
chmod 600 "$ENV_FILE"
for k in "${KEYS[@]}"; do
  printf '%s=%s\n' "$k" "${ENV[$k]}" >>"$ENV_FILE"
done
echo "Wrote $ENV_FILE"

# ============================================================
# 3. Configure and start services
# ============================================================
stop_pid_file() {
  local pid
  pid="$(cat "$1" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" || true
    sleep 1
  fi
}

# --- PostgreSQL ---
sudo systemctl enable --now postgresql
sudo -u postgres psql -v ON_ERROR_STOP=1 -q -c "ALTER USER postgres WITH PASSWORD '$PG_PASSWORD';"
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$PG_DB'" | grep -q 1; then
  sudo -u postgres createdb "$PG_DB"
fi
echo "PostgreSQL ready, database '$PG_DB'"

# --- coturn ---
stop_pid_file "$COTURN_PID_FILE"
nohup turnserver \
  --listening-port=3478 \
  --fingerprint \
  --use-auth-secret \
  --static-auth-secret="${ENV[TURN_SECRET]}" \
  --realm="$DOMAIN" \
  --no-cli \
  --log-file=stdout \
  >/var/tmp/coturn.log 2>&1 &
echo $! >"$COTURN_PID_FILE"
echo "coturn running (pid $!), log: /var/tmp/coturn.log"

# --- MinIO ---
mkdir -p "$MINIO_DATA"
stop_pid_file "$MINIO_PID_FILE"
# Bound to loopback: browsers reach it only through Caddy at /s3/*.
MINIO_ROOT_USER="${ENV[S3_ACCESS_KEY_ID]}" MINIO_ROOT_PASSWORD="${ENV[S3_SECRET_ACCESS_KEY]}" \
  nohup minio server "$MINIO_DATA" \
  --address 127.0.0.1:9000 \
  --console-address 127.0.0.1:9001 \
  >/var/tmp/minio.log 2>&1 &
echo $! >"$MINIO_PID_FILE"

for _ in $(seq 1 30); do
  curl -sf http://127.0.0.1:9000/minio/health/live >/dev/null && break
  sleep 1
done
mc alias set cworkplace http://127.0.0.1:9000 "${ENV[S3_ACCESS_KEY_ID]}" "${ENV[S3_SECRET_ACCESS_KEY]}" >/dev/null
mc mb --ignore-existing "cworkplace/${ENV[S3_BUCKET]}" >/dev/null
echo "MinIO running (pid $(cat "$MINIO_PID_FILE")), bucket '${ENV[S3_BUCKET]}', log: /var/tmp/minio.log"

# --- Caddy ---
# The Caddyfile proxies /s3/* to MinIO and everything else to the API; Caddy handles TLS.
# Started in the background (caddy start) so the server below can run in the foreground.
caddy stop >/dev/null 2>&1 || true
DOMAIN="$DOMAIN" caddy start --config "$ROOT_DIR/Caddyfile" --adapter caddyfile

# --- Server ---
# The binary reads its config from the environment, so export everything in .env.
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
cd "$ROOT_DIR"
exec "$SERVER" --host 127.0.0.1 --port 3000
