#!/usr/bin/env bash
# D4(b): no `usize` in hashed or serialized engine structs (its width differs
# between native and wasm32). Clippy can't express this, so CI greps for
# struct/variant fields of type usize in race-core and race-protocol. A field
# that is never hashed or serialized (an error detail) is allowed with a
# trailing `// usize-ok: <reason>` comment.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
hits="$(grep -rnE '\b[a-z_0-9]+: [^=;(]*\busize\b' "$ROOT/crates/race-core/src" "$ROOT/crates/race-protocol/src" \
  | grep -vE '\bfn |\blet |->|usize-ok|^[^:]+:[0-9]+:\s*//' || true)"
if [ -n "$hits" ]; then
  echo "usize fields in engine/protocol types (use u32, or mark '// usize-ok: <reason>'):" >&2
  echo "$hits" >&2
  exit 1
fi
echo "check-wire-usize: ok"
