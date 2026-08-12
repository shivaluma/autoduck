#!/usr/bin/env bash
set -euo pipefail

started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "🧭 Auto migration started at ${started_at}"
echo "   DATABASE_URL=${DATABASE_URL:-<default sqlite>}"

echo "🗄️  Syncing Prisma schema..."
prisma db push

echo "📦 Applying idempotent app migrations..."
tsx scripts/run-migrations.ts

completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "✅ Auto migration completed at ${completed_at}"
