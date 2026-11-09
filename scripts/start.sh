#!/bin/bash
set -e

echo "🦆 AutoDuck Starting..."

# 1. Back up, sync schema and run idempotent app migrations
bash scripts/auto-migrate.sh

# 2. Seed data (only if DB is empty)
echo "🌱 Checking seed data..."
tsx prisma/seed.ts

# 3. Start Next.js server
echo "🚀 Starting Next.js server on port ${PORT:-3000}..."
exec node server.js
