#!/usr/bin/env sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

cd "$ROOT_DIR"

docker compose up -d postgres
docker compose build bot
docker compose run --rm --no-deps bot node scripts/resequence-receipts.cjs
