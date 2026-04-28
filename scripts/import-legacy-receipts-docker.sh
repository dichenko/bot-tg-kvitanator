#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

CSV_PATH=${1:-/root/File1.csv}
TELEGRAM_ID=${2:-19422781}

case "$CSV_PATH" in
  /*) ;;
  *) CSV_PATH="$ROOT_DIR/$CSV_PATH" ;;
esac

if [ ! -f "$CSV_PATH" ]; then
  echo "CSV file not found: $CSV_PATH" >&2
  exit 1
fi

cd "$ROOT_DIR"

docker compose up -d postgres

docker compose run --rm --no-deps \
  -v "$CSV_PATH:/tmp/legacy-receipts.csv:ro" \
  bot \
  node scripts/import-legacy-receipts.cjs --csv /tmp/legacy-receipts.csv --tg-id "$TELEGRAM_ID"
