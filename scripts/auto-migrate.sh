#!/usr/bin/env bash
set -euo pipefail

# Env switches:
#   SKIP_DB_PUSH=1     skip `prisma db push` entirely (app migrations still run)
#   ALLOW_DATA_LOSS=1  pass --accept-data-loss to `prisma db push` (otherwise a
#                      schema change that would drop data fails the boot)

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "🧭 Auto migration started at ${started_at}"
if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "   DATABASE_URL=<configured>"
else
  echo "   DATABASE_URL=<default sqlite>"
fi

# Best effort: backup.mjs logs and exits 0 on every failure, never blocking boot.
echo "💾 Backing up database before migrations..."
node "${script_dir}/ops/backup.mjs" || echo "⚠️  Backup step crashed; continuing without a fresh backup"

if [[ "${SKIP_DB_PUSH:-}" == "1" ]]; then
  echo "⏭️  SKIP_DB_PUSH=1: skipping Prisma schema sync"
else
  push_args=()
  if [[ "${ALLOW_DATA_LOSS:-}" == "1" ]]; then
    echo "⚠️  ALLOW_DATA_LOSS=1: prisma db push may drop columns/tables"
    push_args+=(--accept-data-loss)
  fi
  echo "🗄️  Syncing Prisma schema..."
  # stdin from /dev/null: never let prisma fall back to an interactive data-loss prompt.
  if ! prisma db push ${push_args[@]+"${push_args[@]}"} </dev/null; then
    echo "❌ prisma db push FAILED. If it reported data-loss warnings, the schema change would drop data." >&2
    echo "   Boot aborted to protect the database. Restore/inspect from <db dir>/backups, or set ALLOW_DATA_LOSS=1 for one boot if the loss is intended." >&2
    exit 1
  fi
fi

echo "📦 Applying idempotent app migrations..."
tsx scripts/run-migrations.ts

completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "✅ Auto migration completed at ${completed_at}"
