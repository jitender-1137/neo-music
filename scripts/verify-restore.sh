#!/usr/bin/env bash
# Restores a backup into a throwaway database and checks row counts — proves backups are usable.
# Usage: scripts/verify-restore.sh infra/backups/zuno-XXXX.dump   (dev: COMPOSE="docker compose -f infra/docker-compose.yml")
set -euo pipefail
DUMP=${1:?backup file}
COMPOSE=${COMPOSE:-"docker compose -f infra/docker-compose.prod.yml"}
DB=zuno_restore_check_$$
$COMPOSE exec -T postgres sh -c "createdb -U \"\$POSTGRES_USER\" $DB"
trap '$COMPOSE exec -T postgres sh -c "dropdb -U \"\$POSTGRES_USER\" --if-exists $DB"' EXIT
$COMPOSE exec -T postgres sh -c "pg_restore -U \"\$POSTGRES_USER\" -d $DB --no-owner" < "$DUMP"
$COMPOSE exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d $DB -Atc \"select 'users', count(*) from users union all select 'playlists', count(*) from playlists union all select 'migrations', count(*) from drizzle.__drizzle_migrations\""
echo "restore verified into $DB (dropped on exit)"
