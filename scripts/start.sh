#!/bin/bash
set -e

echo "🦆 AutoDuck Starting..."

# 1. Start Xvfb (virtual display for Playwright)
echo "🖥️  Starting Xvfb..."
Xvfb :99 -screen 0 1280x720x24 &
export DISPLAY=:99
sleep 1

# 2. Sync schema and run idempotent app migrations
bash scripts/auto-migrate.sh

# 3. Seed data (only if DB is empty)
echo "🌱 Checking seed data..."
tsx prisma/seed.ts

# 4. Start Next.js server
echo "🚀 Starting Next.js server on port ${PORT:-3000}..."
exec node server.js
