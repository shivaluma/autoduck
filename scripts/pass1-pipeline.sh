#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p artifacts/pass1

WORKERS="${WORKERS:-4}"
PLAYERS="${PLAYERS:-8}"

echo "[pass1] waiting for Pass 1A (pid ${PASS1A_PID:-unknown}) to finish..."
if [[ -n "${PASS1A_PID:-}" ]]; then
  while kill -0 "$PASS1A_PID" 2>/dev/null; do
    sleep 120
    echo "[pass1] Pass 1A still running $(date -u +%H:%M:%S)"
  done
fi

echo "[pass1] starting Pass 1B matrix 2k/pair @ workers=$WORKERS"
node --import tsx scripts/race-simulate-balance.ts \
  --mode matrix \
  --matrix-seeds 2000 \
  --workers "$WORKERS" \
  --bootstrap-matrix 0 \
  --players "$PLAYERS" \
  2>&1 | tee artifacts/pass1/pass1b-matrix-2k.log

echo "[pass1] Pass 1B complete $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[pass1] extract summary:"
grep -E "Aggregate matrix|Counter mechanic|Feather:|Outliers|paired-races/s" artifacts/pass1/pass1a-archetype-10k.log artifacts/pass1/pass1b-matrix-2k.log || true
