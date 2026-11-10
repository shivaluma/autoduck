#!/bin/bash
# Admin Season 3 diff (rewrite plan Phase 3 stage B): the TS route handler of main (in-process, with
# docs/rewrite/patches/main-test-ids.patch applied) vs Rust `autoduck serve` built with `test-rng`,
# replaying spec.mjs on two copies of one base DB, then comparing every response and every table.
#
#   env TSREF=<main checkout, patched, node_modules installed> \
#       SNAPSHOT=<bootstrapped dev.db copy> \
#       BIN=<target/debug/autoduck built with --features test-rng> \
#       OUT=<work dir> scripts/ops/admin-season3-diff/run.sh
#
# Both sides get AUTODUCK_TEST_RNG_SEED, so race/Chaos seeds and the set-chaos clock are identical
# (crates/server/src/season3/admin/seed.rs, lib/test-ids.ts). TS runs with TZ=UTC (the production
# container has no TZ; `new Date().getFullYear()` is the create-season default year).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
: "${TSREF:?}" "${SNAPSHOT:?}" "${BIN:?}" "${OUT:?}"
SECRET=admin-s3-diff-secret-0123456789
SEED=20261109
PORT=${PORT:-3594}
rm -rf "$OUT"; mkdir -p "$OUT/data" "$OUT/dist"
echo '<!doctype html><title>dist</title>' > "$OUT/dist/index.html"
python3 "$HERE/prepare.py" "$OUT/base.sql"
sqlite3 "$SNAPSHOT" ".backup $OUT/base.db"
sqlite3 "$OUT/base.db" < "$OUT/base.sql"
sqlite3 "$OUT/base.db" ".backup $OUT/ts.db"
sqlite3 "$OUT/base.db" ".backup $OUT/rust.db"
mkdir -p "$TSREF/.admin-s3-harness" && cp "$HERE/run-ts.ts" "$TSREF/.admin-s3-harness/run-ts.ts"
STARTED=$(node -e 'console.log(Date.now())')
(cd "$TSREF" && env TZ=UTC NODE_ENV=test AUTODUCK_TEST_RNG_SEED=$SEED DATABASE_URL="file:$OUT/ts.db" ADMIN_S3_SPEC="$HERE/spec.mjs" \
  node --import tsx .admin-s3-harness/run-ts.ts "$OUT/ts.json" 2> "$OUT/ts.log")
env DATABASE_URL="file:$OUT/rust.db" AUTODUCK_ENV=dev HOST=127.0.0.1 PORT=$PORT RACE_SECRET_KEY=$SECRET \
  AUTODUCK_TEST_RNG_SEED=${RSEED:-$SEED} AUTODUCK_LOCK_PATH="$OUT/data/autoduck.lock" AUTODUCK_BACKUP=0 \
  AUTODUCK_DIST_DIR="$OUT/dist" RUST_LOG=info "$BIN" serve > "$OUT/rust.log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT
for _ in $(seq 1 100); do curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break; sleep 0.2; done
node "$HERE/run-rust.mjs" "http://127.0.0.1:$PORT" "$OUT/rust.db" "$OUT/rust.json"
kill $PID; wait $PID 2>/dev/null || true
node "$HERE/compare.mjs" "$OUT/ts.json" "$OUT/rust.json" "$OUT/ts.db" "$OUT/rust.db" "$OUT/base.db" "$STARTED" "$TSREF" | tee "$OUT/report.txt"
