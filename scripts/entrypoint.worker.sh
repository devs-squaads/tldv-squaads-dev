#!/bin/bash

set -e

start_multimedia_stack() {
  rm -rf /tmp/* /tmp/.*-lock /var/run/pulse/* /run/pulse/* || true
  mkdir -p /var/run/pulse /run/pulse
  chown -R pulse:pulse /var/run/pulse /run/pulse || true

  Xvfb :99 -screen 0 1920x1080x24 &
  export DISPLAY=:99

  pulseaudio --system -D --disallow-exit --exit-idle-time=-1 --disable-shm \
    --load="module-native-protocol-unix auth-anonymous=1 socket=/tmp/pulseaudio.socket" \
    --load="module-null-sink sink_name=SpeakerOutput sink_properties=device.description=SpeakerOutput"

  sleep 5

  export PULSE_SERVER=unix:/tmp/pulseaudio.socket
  pactl set-default-sink SpeakerOutput || true
  pactl set-default-source SpeakerOutput.monitor || true
}

validate_worker_secrets() {
  if [ "${AUTO_JOIN_ENABLED:-false}" != "true" ]; then
    return 0
  fi

  if [ -n "${GOOGLE_SERVICE_ACCOUNT_JSON:-}" ]; then
    return 0
  fi

  local creds_file="${GOOGLE_SERVICE_ACCOUNT_FILE:-}"
  if [ -z "$creds_file" ]; then
    echo "ERROR: AUTO_JOIN_ENABLED=true but neither GOOGLE_SERVICE_ACCOUNT_JSON nor GOOGLE_SERVICE_ACCOUNT_FILE is set."
    exit 1
  fi

  if [ ! -f "$creds_file" ]; then
    echo "ERROR: AUTO_JOIN_ENABLED=true but credentials file does not exist: $creds_file"
    exit 1
  fi
}

echo "Starting in worker mode..."
validate_worker_secrets
start_multimedia_stack

if [ "${NODE_ENV:-development}" = "development" ]; then
  # Local dev bind-mounts the full monorepo package.json over the image's reduced
  # worker+shared one (Dockerfile.worker), so node_modules goes stale on every
  # container start — resync it here instead of requiring a manual `bun i`.
  bun install
  exec bun run --cwd apps/worker dev
else
  exec bun run --cwd apps/worker start
fi
