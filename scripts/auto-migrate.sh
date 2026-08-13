#!/usr/bin/env bash
set -euo pipefail

started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "🧭 Auto migration started at ${started_at}"
if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "   DATABASE_URL=<configured>"
else
  echo "   DATABASE_URL=<default sqlite>"
fi

echo "🗄️  Syncing Prisma schema..."
prisma db push

echo "📦 Applying idempotent app migrations..."
tsx scripts/run-migrations.ts

completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "✅ Auto migration completed at ${completed_at}"
