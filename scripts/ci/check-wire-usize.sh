#!/usr/bin/env bash
# D4(b): no `usize` in hashed or serialized engine structs (its width differs
# between native and wasm32). Clippy can't express this, so CI scans the
# bodies of every struct, enum and union in race-core and race-protocol
# (including tuple structs and struct-like variants) for `usize`. Function
# parameters, locals and return types are not wire data and are not scanned,
# however the signature is wrapped (Phase 2 review 2 MAJOR 1: the old
# line-based grep only skipped one-line `fn` signatures). A field that is
# never hashed or serialized (an error detail) is allowed with a trailing
# `// usize-ok: <reason>` comment.
#
# Usage: check-wire-usize.sh [dir...] (default: the two engine crates' src).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [ "$#" -eq 0 ]; then
  set -- "$ROOT/crates/race-core/src" "$ROOT/crates/race-protocol/src"
fi
files=()
while IFS= read -r file; do files+=("$file"); done < <(find "$@" -name '*.rs' | LC_ALL=C sort)
if [ "${#files[@]}" -eq 0 ]; then
  echo "check-wire-usize: no .rs files under $*" >&2
  exit 2
fi
hits="$(awk '
  FNR == 1 { pending = 0; depth = 0 }
  {
    code = $0
    sub(/\/\/.*/, "", code)                # line and doc comments
    gsub(/"([^"\\]|\\.)*"/, "\"\"", code)  # string literals
    if (pending == 0 && depth == 0 && code ~ /(^|[^A-Za-z0-9_])(struct|enum|union)[ \t]+[A-Za-z_]/) {
      pending = 1
    }
    if (pending || depth > 0) {
      if (code ~ /(^|[^A-Za-z0-9_])usize([^A-Za-z0-9_]|$)/ && $0 !~ /usize-ok/) {
        printf "%s:%d:%s\n", FILENAME, FNR, $0
      }
      opens = gsub(/\{/, "{", code)
      closes = gsub(/\}/, "}", code)
      if (pending && opens > 0) {
        pending = 0
      } else if (pending && code ~ /;[ \t]*$/) {
        pending = 0                        # tuple or unit struct
      }
      depth += opens - closes
      if (depth < 0) depth = 0
    }
  }
' "${files[@]}")"
if [ -n "$hits" ]; then
  echo "usize fields in engine/protocol types (use u32, or mark '// usize-ok: <reason>'):" >&2
  echo "$hits" >&2
  exit 1
fi
echo "check-wire-usize: ok (${#files[@]} files)"
