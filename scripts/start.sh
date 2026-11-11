#!/bin/bash
set -e

echo "🦆 AutoDuck Starting..."

# 1. Back up, sync schema and run idempotent app migrations
bash scripts/auto-migrate.sh

# 2. Historical replay tracks (artifacts/replay-tracks): idempotent, never fails the boot
echo "🎞️  Importing historical replay tracks..."
env TSX_TSCONFIG_PATH=scripts/replay-tracks/tsconfig.import.json tsx scripts/replay-tracks/ensure-imported.ts \
  || echo "⚠️  Replay-track import crashed; continuing without it"

# 3. Seed data (only if DB is empty)
echo "🌱 Checking seed data..."
tsx prisma/seed.ts

# 4. Start Next.js server
echo "🚀 Starting Next.js server on port ${PORT:-3000}..."
exec node server.js
