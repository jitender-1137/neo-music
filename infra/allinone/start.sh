#!/usr/bin/env bash
# Starts the API, the website and Caddy in one container. If any of them stops, everything stops,
# so Docker's restart policy brings the whole app back cleanly.
set -euo pipefail

: "${DOMAIN:?Set DOMAIN to the domain of your site, e.g. -e DOMAIN=music.example.com (or DOMAIN=localhost to try it)}"
: "${STREAM_SIGNING_SECRET:?Set STREAM_SIGNING_SECRET (32+ random characters): openssl rand -base64 32}"

mkdir -p /data/db /data/caddy /data/config

# Site address for Caddy. A real domain gets a free Let's Encrypt certificate automatically;
# "localhost" gets a self-signed one (for trying it out). ACME_EMAIL is optional (expiry notices).
export SITE_ADDRESS="${DOMAIN}"
export CADDY_GLOBAL_OPTIONS="${ACME_EMAIL:+email ${ACME_EMAIL}}"
ORIGIN="https://${DOMAIN}"
[ -n "${HTTPS_PORT:-}" ] && ORIGIN="${ORIGIN}:${HTTPS_PORT}"

# API: only reachable through Caddy on this machine, so it can trust Caddy's forwarded headers.
export HOST=127.0.0.1 PORT=4000 TRUST_PROXY=true WORKER_INLINE=true
export WEB_ORIGINS="${WEB_ORIGINS:-${ORIGIN}}"

cd /app/api
node --import ./dist/telemetry.js dist/index.js &
api=$!

cd /app/web
HOSTNAME=127.0.0.1 PORT=3000 API_ORIGIN=http://127.0.0.1:4000 node apps/web/server.js &
web=$!

caddy run --config /app/Caddyfile --adapter caddyfile &
caddy=$!

stop() { kill -TERM "$api" "$web" "$caddy" 2>/dev/null || true; }
trap stop TERM INT
# Wait until any one of them exits, then stop the rest and exit with its status.
set +e
wait -n "$api" "$web" "$caddy"
code=$?
stop
wait
exit "$code"
