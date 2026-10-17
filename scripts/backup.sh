#!/usr/bin/env bash
# Logical backup of the Postgres database (custom format, compressed). Keeps the newest $KEEP.
set -euo pipefail
COMPOSE=${COMPOSE:-"docker compose -f infra/docker-compose.prod.yml"}
KEEP=${KEEP:-14}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p infra/backups
$COMPOSE exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "infra/backups/zuno-$STAMP.dump"
echo "backup written: infra/backups/zuno-$STAMP.dump ($(du -h "infra/backups/zuno-$STAMP.dump" | cut -f1))"
ls -1t infra/backups/zuno-*.dump | tail -n +$((KEEP + 1)) | xargs -r rm --
