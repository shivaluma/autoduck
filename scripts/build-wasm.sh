#!/usr/bin/env bash
# Build the browser engine package (plan D1, D27).
#
#   scripts/build-wasm.sh [--require-bindgen] [--bindgen-target web|nodejs|bundler] [--out-dir DIR]
#
# 1. `cargo build -p race-wasm --release --target wasm32-unknown-unknown` with
#    RUSTFLAGS='-C panic=abort' (D1: race-wasm alone aborts on panic; the rest
#    of the workspace keeps `panic = "unwind"`). It uses its own target dir so
#    the different RUSTFLAGS never invalidate the shared `target/` cache.
# 2. `wasm-bindgen --target web` into crates/race-wasm/pkg. The CLI version must
#    equal the `wasm-bindgen` version pinned in Cargo.lock (D27). If the CLI is
#    missing, step 2 is skipped with a warning (exit 0) unless
#    --require-bindgen or RACE_WASM_REQUIRE_BINDGEN=1 is set (CI sets it).
#
# Environment overrides: RACE_WASM_TARGET_DIR, RACE_WASM_OUT_DIR,
# RACE_WASM_BINDGEN_TARGET, RACE_WASM_REQUIRE_BINDGEN.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${RACE_WASM_TARGET_DIR:-$ROOT/target/race-wasm}"
OUT_DIR="${RACE_WASM_OUT_DIR:-$ROOT/crates/race-wasm/pkg}"
BINDGEN_TARGET="${RACE_WASM_BINDGEN_TARGET:-web}"
REQUIRE_BINDGEN="${RACE_WASM_REQUIRE_BINDGEN:-0}"

while [ $# -gt 0 ]; do
  case "$1" in
    --require-bindgen) REQUIRE_BINDGEN=1 ;;
    --bindgen-target) BINDGEN_TARGET="$2"; shift ;;
    --out-dir) OUT_DIR="$2"; shift ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "build-wasm: unknown argument $1" >&2; exit 2 ;;
  esac
  shift
done

cd "$ROOT"

# Exactly these flags: an inherited RUSTFLAGS/CARGO_ENCODED_RUSTFLAGS (or
# target-cpu=native) would change the shipped artifact. The path remaps keep
# local paths (and the username) out of panic messages, so the artifact is
# byte-identical on a dev machine and in CI.
unset CARGO_ENCODED_RUSTFLAGS
CARGO_HOME_DIR="${CARGO_HOME:-$HOME/.cargo}"
export RUSTFLAGS="-C panic=abort --remap-path-prefix=$CARGO_HOME_DIR/registry/src=/cargo/registry/src --remap-path-prefix=$CARGO_HOME_DIR/git/checkouts=/cargo/git/checkouts --remap-path-prefix=$ROOT=/src"
echo "build-wasm: cargo build -p race-wasm --release --target wasm32-unknown-unknown (RUSTFLAGS='$RUSTFLAGS', target dir $TARGET_DIR)"
cargo build -p race-wasm --release --locked --target wasm32-unknown-unknown --target-dir "$TARGET_DIR"

WASM="$TARGET_DIR/wasm32-unknown-unknown/release/race_wasm.wasm"
[ -f "$WASM" ] || { echo "build-wasm: missing $WASM" >&2; exit 1; }

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}
echo "build-wasm: $WASM ($(wc -c <"$WASM" | tr -d ' ') bytes, sha256 $(sha256_of "$WASM"))"

# The wasm-bindgen version pinned in Cargo.lock ([[package]] name = "wasm-bindgen").
PINNED="$(awk '/^\[\[package\]\]/{name=""} /^name = "wasm-bindgen"$/{name=$3} name!="" && /^version = /{gsub(/"/,"",$3); print $3; exit}' Cargo.lock)"
[ -n "$PINNED" ] || { echo "build-wasm: wasm-bindgen not found in Cargo.lock" >&2; exit 1; }

if ! command -v wasm-bindgen >/dev/null 2>&1; then
  if [ "$REQUIRE_BINDGEN" = "1" ]; then
    echo "build-wasm: wasm-bindgen CLI not found (need $PINNED: cargo install wasm-bindgen-cli --version $PINNED --locked)" >&2
    exit 1
  fi
  echo "build-wasm: WARNING wasm-bindgen CLI not found; skipped packaging (install wasm-bindgen-cli $PINNED)" >&2
  exit 0
fi

CLI_VERSION="$(wasm-bindgen --version | awk '{print $2}')"
if [ "$CLI_VERSION" != "$PINNED" ]; then
  echo "build-wasm: wasm-bindgen CLI $CLI_VERSION != crate $PINNED (D27 requires an exact match)" >&2
  exit 1
fi

rm -rf "$OUT_DIR"
wasm-bindgen --target "$BINDGEN_TARGET" --out-dir "$OUT_DIR" "$WASM"
# Build output: keep it out of git without touching the shared .gitignore.
printf '*\n' >"$OUT_DIR/.gitignore"
# Mark the generated JS as ESM so Node loads it without re-parsing (web/bundler targets).
if [ "$BINDGEN_TARGET" != "nodejs" ]; then
  printf '{ "name": "race-wasm", "private": true, "type": "module" }\n' >"$OUT_DIR/package.json"
fi
echo "build-wasm: wasm-bindgen $CLI_VERSION --target $BINDGEN_TARGET -> $OUT_DIR"
for file in "$OUT_DIR"/*.wasm; do
  echo "build-wasm:   $(basename "$file") $(wc -c <"$file" | tr -d ' ') bytes, sha256 $(sha256_of "$file")"
done
