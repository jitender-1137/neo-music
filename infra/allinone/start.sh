#!/usr/bin/env bash
# Starts the API, the website and Caddy in one container. If any of them stops, everything stops,
# so Docker's restart policy brings the whole app back cleanly.
set -euo pipefail

# Two ways to run:
#   HTTPS mode — set DOMAIN: Caddy serves ports 80/443 and gets the certificate itself.
#   HTTP mode  — no DOMAIN, set PUBLIC_ORIGIN (the https:// address people open): plain HTTP on
#                port 8080 inside the container, for running behind your own nginx / proxy.
: "${STREAM_SIGNING_SECRET:?Set STREAM_SIGNING_SECRET (32+ random characters): openssl rand -base64 32}"

mkdir -p /data/db /data/caddy /data/config

if [ -n "${DOMAIN:-}" ]; then
  # A real domain gets a free Let's Encrypt certificate automatically; "localhost" a self-signed one.
  export SITE_ADDRESS="${DOMAIN}"
  ORIGIN="https://${DOMAIN}"
  [ -n "${HTTPS_PORT:-}" ] && ORIGIN="${ORIGIN}:${HTTPS_PORT}"
  # ACME_EMAIL is optional (certificate expiry notices).
  export CADDY_GLOBAL_OPTIONS="${ACME_EMAIL:+email ${ACME_EMAIL}}"
elif [ -n "${PUBLIC_ORIGIN:-}" ]; then
  export SITE_ADDRESS="http://:8080"
  ORIGIN="${PUBLIC_ORIGIN%/}"
  # Behind a proxy: take the visitor's address from its X-Forwarded-For (proxies on private networks).
  export CADDY_GLOBAL_OPTIONS="auto_https off
	servers {
		trusted_proxies static private_ranges
		client_ip_headers X-Forwarded-For X-Real-IP
	}"
else
  echo "Set DOMAIN=music.example.com (HTTPS on ports 80/443), or PUBLIC_ORIGIN=https://music.example.com (plain HTTP on port 8080, behind your own proxy)." >&2
  exit 64
fi

# API: only reachable through Caddy on this machine, so it can trust Caddy's forwarded headers.
export HOST=127.0.0.1 PORT=4000 TRUST_PROXY=true WORKER_INLINE=true
export WEB_ORIGINS="${WEB_ORIGINS:-${ORIGIN}}"

# Music sources (Settings → Music source): youtubei (always), ytmusicapi, official (needs YOUTUBE_API_KEY).
export MUSIC_SOURCES="${MUSIC_SOURCES:-youtubei}"
pids=()
if [[ ",${MUSIC_SOURCES}," == *",ytmusicapi,"* ]]; then
  export YTMUSICAPI_URL=http://127.0.0.1:4200
  YTMUSICAPI_HOST=127.0.0.1 YTMUSICAPI_PORT=4200 /opt/ytmusicapi/bin/python /app/ytmusicapi/server.py &
  pids+=($!)
fi

cd /app/api
node --import ./dist/telemetry.js dist/index.js &
api=$!

cd /app/web
HOSTNAME=127.0.0.1 PORT=3000 API_ORIGIN=http://127.0.0.1:4000 node apps/web/server.js &
web=$!

caddy run --config /app/Caddyfile --adapter caddyfile &
caddy=$!

stop() { kill -TERM "$api" "$web" "$caddy" "${pids[@]}" 2>/dev/null || true; }
trap stop TERM INT
# Wait until any one of them exits, then stop the rest and exit with its status.
set +e
wait -n "$api" "$web" "$caddy" "${pids[@]}"
code=$?
stop
wait
exit "$code"
