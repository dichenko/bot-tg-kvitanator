#!/usr/bin/env bash
# Called by the forced SSH entrypoint with its deployment lock already held.
set -Eeuo pipefail

readonly revision=${1:?Expected deployment commit SHA}
if [[ ! $revision =~ ^[0-9a-f]{40}$ ]]; then
  printf 'Invalid deployment commit SHA.\n' >&2
  exit 64
fi
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [[ $(pwd -P) != /opt/bot-tg-kvitanator || $(git rev-parse HEAD) != "$revision" ]]; then
  printf 'Deployment directory or revision does not match.\n' >&2
  exit 1
fi

dump_logs() {
  local status=$?
  trap - ERR
  printf 'Deployment failed for %s (exit %s).\n' "$revision" "$status" >&2
  docker compose ps || true
  docker compose logs --no-color --tail=60 bot renderer-worker || true
  exit "$status"
}
trap dump_logs ERR

printf 'Deploying %s\n' "$revision"
docker compose config --quiet
# Build before touching running services. Do not refresh unrelated images.
docker compose build bot renderer-worker

install -d -m 700 /var/backups/kvitanator
backup_file="/var/backups/kvitanator/predeploy-$(date -u +%Y%m%dT%H%M%SZ)-${revision:0:12}.dump"
readonly backup_file
umask 077
docker compose exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$backup_file"
test -s "$backup_file"
printf 'Database backup saved: %s\n' "$backup_file"

docker compose run --rm --no-deps bot node scripts/run-prisma.cjs migrate deploy

wait_for_health() {
  local url=$1
  for ((attempt=1; attempt<=30; attempt++)); do
    if curl --fail --silent --show-error --max-time 3 "$url" > /dev/null 2>&1; then
      return 0
    fi
    sleep 3
  done
  printf 'Health check failed: %s\n' "$url" >&2
  return 1
}
# Release order: renderer first (must be ready and accept the new payload), then the bot.
docker compose up -d --no-deps renderer-worker
wait_for_health http://127.0.0.1:3001/health
docker compose up -d --no-deps bot
wait_for_health http://127.0.0.1:3000/health

# Verify PostgreSQL and Telegram authentication without sending any messages.
docker compose exec -T bot node -e '
  const { prisma } = require("./packages/db/dist");
  const { Api } = require("./apps/bot/node_modules/grammy");
  const { config } = require("./apps/bot/dist/config");
  Promise.all([
    prisma.$queryRaw`SELECT 1`,
    new Api(config.botToken).getMe(AbortSignal.timeout(10000))
  ]).then(() => process.exit(0), () => {
    console.error("Bot database/Telegram readiness check failed");
    process.exit(1);
  });
'
docker compose ps
install -d -m 755 /var/lib/kvitanator
printf '%s\n' "$revision" > /var/lib/kvitanator/deployed-revision
# Refresh the small SSH bootstrap for future deployments, after exec released it.
install -m 755 scripts/deploy-entrypoint.sh /usr/local/sbin/kvitanator-deploy
printf 'Deployment verified: %s\n' "$revision"
