#!/bin/bash

set -euo pipefail

# Local helper to test the fully split topology with every service started
# from its own compose file and with the worker HTTP API published to the host.
#
# What it does:
# - starts postgres from docker-compose.postgres.yml
# - starts minio from docker-compose.minio.yml
# - starts web from docker-compose.web.yml
# - starts worker from docker-compose.worker.yml using a temporary override
#   that publishes WORKER_INTERNAL_PORT to the host
# - connects all services to a shared local bridge network
# - assigns aliases so existing env hostnames keep working:
#   - postgres
#   - minio
#
# Expected local env files:
# - .env
# - .env.development
#
# Usage:
#   ./scripts/test-production-split-stack.sh up
#   ./scripts/test-production-split-stack.sh up --build
#   ./scripts/test-production-split-stack.sh logs worker
#   ./scripts/test-production-split-stack.sh status
#   ./scripts/test-production-split-stack.sh down

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHARED_NETWORK="${LOCAL_SPLIT_NETWORK:-meeting-local-split}"
POSTGRES_CONTAINER="meeting-db-service"
MINIO_CONTAINER="meeting-storage-service"
WEB_CONTAINER="meeting-web-service"
WORKER_CONTAINER="meeting-worker-service"
BUILD_FLAG=""
TMP_DIR="$(mktemp -d /tmp/meeting-exposed-split.XXXXXX)"
WORKER_PORT="${WORKER_INTERNAL_PORT:-4000}"
WORKER_OVERRIDE_FILE="$TMP_DIR/docker-compose.worker.override.yml"

cleanup_tmp() {
  rm -rf "$TMP_DIR"
}

trap cleanup_tmp EXIT

write_worker_override() {
  cat > "$WORKER_OVERRIDE_FILE" <<EOF
services:
  meeting-worker:
    ports:
      - "${WORKER_PORT}:${WORKER_PORT}"
EOF
}

normalize_local_database_url() {
  local url="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:5432/meeting_bot}"
  url="${url//@postgres:/@127.0.0.1:}"
  url="${url//@db:/@127.0.0.1:}"
  url="${url//@meeting-db-service:/@127.0.0.1:}"
  echo "$url"
}

apply_db_schema() {
  if ! command -v bun >/dev/null 2>&1; then
    echo "Automatic schema load requires bun on the host."
    return 1
  fi

  echo "Database schema missing. Applying schema with drizzle-kit..."

  (
    cd "$ROOT_DIR"
    local database_url=""

    if [ -f ./.env ]; then
      database_url="$(grep -E '^DATABASE_URL=' ./.env | tail -n 1 | cut -d= -f2- || true)"
    fi

    if [ -f ./.env.development ]; then
      local development_database_url=""
      development_database_url="$(grep -E '^DATABASE_URL=' ./.env.development | tail -n 1 | cut -d= -f2- || true)"
      if [ -n "$development_database_url" ]; then
        database_url="$development_database_url"
      fi
    fi

    DATABASE_URL="${database_url:-postgresql://postgres:postgres@127.0.0.1:5432/meeting_bot}"
    export DATABASE_URL
    DATABASE_URL="$(normalize_local_database_url)"
    export DATABASE_URL

    bunx drizzle-kit push
  )
}

check_db_schema() {
  if ! docker inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1; then
    echo "Postgres container not found: $POSTGRES_CONTAINER"
    return 1
  fi

  local has_meetings
  has_meetings="$(docker exec "$POSTGRES_CONTAINER" sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT to_regclass('\''public.meetings'\'') IS NOT NULL;"' 2>/dev/null || true)"

  if [ "$has_meetings" != "t" ]; then
    apply_db_schema
    has_meetings="$(docker exec "$POSTGRES_CONTAINER" sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT to_regclass('\''public.meetings'\'') IS NOT NULL;"' 2>/dev/null || true)"

    if [ "$has_meetings" != "t" ]; then
      echo 'Database schema load failed. Expected table "public.meetings" to exist after drizzle-kit push.'
      return 1
    fi
  fi
}

compose_postgres() {
  POSTGRES_ENV_FILE=.env.development docker compose \
    --env-file "$ROOT_DIR/.env" \
    --env-file "$ROOT_DIR/.env.development" \
    -f "$ROOT_DIR/docker-compose.postgres.yml" \
    "$@"
}

compose_minio() {
  MINIO_ENV_FILE=.env.development docker compose \
    --env-file "$ROOT_DIR/.env" \
    --env-file "$ROOT_DIR/.env.development" \
    -f "$ROOT_DIR/docker-compose.minio.yml" \
    "$@"
}

compose_web() {
  WEB_ENV_FILE=.env.development docker compose \
    --env-file "$ROOT_DIR/.env" \
    --env-file "$ROOT_DIR/.env.development" \
    -f "$ROOT_DIR/docker-compose.web.yml" \
    "$@"
}

compose_worker() {
  write_worker_override
  WORKER_ENV_FILE=.env.development docker compose \
    --env-file "$ROOT_DIR/.env" \
    --env-file "$ROOT_DIR/.env.development" \
    -f "$ROOT_DIR/docker-compose.worker.yml" \
    -f "$WORKER_OVERRIDE_FILE" \
    "$@"
}

ensure_shared_network() {
  if ! docker network inspect "$SHARED_NETWORK" >/dev/null 2>&1; then
    docker network create "$SHARED_NETWORK" >/dev/null
  fi
}

ensure_connected() {
  local container="$1"
  shift

  if ! docker inspect "$container" >/dev/null 2>&1; then
    return 1
  fi

  if docker inspect "$container" --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' | grep -qx "$SHARED_NETWORK"; then
    return 0
  fi

  docker network connect "$@" "$SHARED_NETWORK" "$container"
}

connect_services() {
  ensure_shared_network
  ensure_connected "$POSTGRES_CONTAINER" --alias postgres
  ensure_connected "$MINIO_CONTAINER" --alias minio
  ensure_connected "$WEB_CONTAINER"
  ensure_connected "$WORKER_CONTAINER"
}

print_endpoints() {
  cat <<EOF
Split stack running with exposed ports:
  web:      http://localhost:3000
  worker:   http://localhost:${WORKER_PORT}
  postgres: localhost:5432
  minio:    http://localhost:9000
  console:  http://localhost:9001
EOF
}

up() {
  compose_postgres up -d
  compose_minio up -d
  ensure_shared_network
  ensure_connected "$POSTGRES_CONTAINER" --alias postgres
  ensure_connected "$MINIO_CONTAINER" --alias minio
  check_db_schema
  compose_web up -d $BUILD_FLAG --no-start
  compose_worker up -d $BUILD_FLAG --no-start
  connect_services
  docker start "$WEB_CONTAINER" "$WORKER_CONTAINER" >/dev/null
  print_endpoints
}

down() {
  compose_worker down
  compose_web down
  compose_minio down
  compose_postgres down
  docker network rm "$SHARED_NETWORK" >/dev/null 2>&1 || true
  echo "Exposed split stack stopped"
}

logs() {
  case "${2:-}" in
    web) docker logs -f "$WEB_CONTAINER" ;;
    worker) docker logs -f "$WORKER_CONTAINER" ;;
    postgres) docker logs -f "$POSTGRES_CONTAINER" ;;
    minio) docker logs -f "$MINIO_CONTAINER" ;;
    *)
      echo "Usage: $0 logs [web|worker|postgres|minio]"
      exit 1
      ;;
  esac
}

status() {
  docker ps -a --format '{{.Names}}\t{{.Status}}\t{{.Ports}}' | grep '^meeting-'
}

usage() {
  cat <<'EOF'
Usage: scripts/test-production-split-stack.sh [up|down|logs|status] [service] [--build]

  up               Start postgres, minio, web and worker with separated compose files
  up --build       Rebuild web and worker images before starting
  down             Stop the full exposed split stack and remove the shared test network
  logs web         Follow web logs
  logs worker      Follow worker logs
  logs postgres    Follow postgres logs
  logs minio       Follow minio logs
  status           Show current meeting-* container status
EOF
}

for arg in "$@"; do
  if [ "$arg" = "--build" ]; then
    BUILD_FLAG="--build"
  fi
done

case "${1:-up}" in
  up) up ;;
  down) down ;;
  logs) logs "$@" ;;
  status) status ;;
  *)
    usage
    exit 1
    ;;
esac
