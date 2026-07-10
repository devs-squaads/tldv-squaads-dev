#!/bin/bash
set -euo pipefail

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log_info() { echo -e "[INFO] $1"; }
log_ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_err()  { echo -e "${RED}[ERROR]${NC} $1" >&2; }

ENVIRONMENT="${1:-}"
case "$ENVIRONMENT" in
  development)
    COMPOSE="-f docker-compose.worker.development.yml"
    ENV_FILE=".env.dev"
    CONTAINER="meeting-worker-dev"
    ;;
  production)
    COMPOSE="-f docker-compose.worker.production.yml"
    ENV_FILE=".env.prod"
    CONTAINER="meeting-worker-prod"
    ;;
  *)
    log_err "Usage: $0 <development|production>"
    exit 1
    ;;
esac

[ -f "$ENV_FILE" ] || { log_err "$ENV_FILE not found"; exit 1; }

log_info "Validating compose syntax..."
docker compose --env-file "$ENV_FILE" $COMPOSE config >/dev/null

log_info "Building image (no cache)..."
docker compose --env-file "$ENV_FILE" $COMPOSE build --no-cache --pull

log_info "Stopping previous stack..."
docker compose --env-file "$ENV_FILE" $COMPOSE down

log_info "Starting new stack..."
docker compose --env-file "$ENV_FILE" $COMPOSE up -d --force-recreate

log_info "Waiting 10s for boot..."
sleep 10

log_info "Health check..."
for i in {1..12}; do
  if docker exec "$CONTAINER" bun -e "fetch('http://localhost:4000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" >/dev/null 2>&1; then
    log_ok "Worker is healthy"
    docker compose --env-file "$ENV_FILE" $COMPOSE ps
    exit 0
  fi
  log_info "Attempt $i/12 — waiting 10s..."
  sleep 10
done

log_err "Healthcheck failed after 12 attempts — leaving stack up for diagnosis"
docker compose --env-file "$ENV_FILE" $COMPOSE logs --tail 100 meeting-worker
exit 1
