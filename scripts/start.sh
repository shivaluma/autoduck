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
node --experimental-require-module ./node_modules/.bin/prisma db push --skip-generate 2>/dev/null || \
  npx prisma db push --skip-generate
echo "✅ Database ready!"

# 3. Start commentary worker in background
echo "🎙️  Starting commentary worker..."
node --import tsx scripts/commentary-worker.ts &
WORKER_PID=$!
echo "✅ Commentary worker started (PID: $WORKER_PID)"

# 4. Start Next.js server
echo "🚀 Starting Next.js server on port ${PORT:-3000}..."
exec node server.js
