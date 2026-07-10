#!/bin/bash

set -e

echo "Starting in web mode..."

if [ "${NODE_ENV:-development}" = "development" ]; then
  echo "Installing dependencies..."
  bun install
  echo "Running database schema sync (drizzle-kit push)..."
  bunx drizzle-kit push
  exec bun run --cwd apps/web dev -- --hostname 0.0.0.0 --webpack
else
  export HOSTNAME=0.0.0.0
  export PORT=3000
  exec node /app/apps/web/.next/standalone/apps/web/server.js
fi
