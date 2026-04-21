#!/bin/bash
set -e

echo "🦆 AutoDuck Starting..."

# 1. Start Xvfb (virtual display for Playwright)
echo "🖥️  Starting Xvfb..."
Xvfb :99 -screen 0 1280x720x24 &
export DISPLAY=:99
sleep 1

# 2. Run Prisma DB push (auto-create/migrate tables)
echo "🗄️  Running Prisma DB push..."
npx prisma db push
echo "✅ Database ready!"

# 3. Seed data (only if DB is empty)
echo "🌱 Checking seed data..."
node --import tsx prisma/seed.ts

# 4. Start Next.js server
echo "🚀 Starting Next.js server on port ${PORT:-3000}..."
exec node server.js
